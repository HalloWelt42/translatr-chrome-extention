// Content UI Module - Smart Web Translator v3.7.0
// Progress, Notifications, TTS und Formatierung

(function() {
  'use strict';

  // Guard gegen doppeltes Laden
  if (window.__swtUILoaded) return;
  window.__swtUILoaded = true;

  if (typeof SmartTranslator === 'undefined') {
    console.warn('SmartTranslator nicht gefunden - content-ui.js muss nach content.js geladen werden');
    return;
  }

  /**
   * Progress-Overlay anzeigen/verstecken
   */
  SmartTranslator.prototype.showProgress = function(show) {
    if (show) {
      if (!this.progressOverlay) {
        this.abortController = new AbortController();
        this.translationAborted = false;
        this.totalTokens = 0;
        this.currentTokens = 0;
        this.isPaused = false;
        this.translationStartTime = Date.now();
        this.processedItems = 0;
        
        this.progressOverlay = document.createElement('div');
        this.progressOverlay.className = 'swt-ui swt-progress';
        this.progressOverlay.innerHTML = `
          <div class="swt-progress-content">
            <div class="swt-progress-header">
              <div class="swt-progress-title-wrap">
                <span class="swt-progress-title"><span class="swt-status-dot" id="swtStatusDot"></span>Übersetze...</span>
                <span class="swt-progress-meta">
                  <span class="swt-progress-provider"></span>
                  <span class="swt-progress-direction"></span>
                </span>
                <span class="swt-progress-eta">
                  ${SWT.Icons.svg('clock', 'swt-eta-icon')}
                  <span class="swt-eta-text">berechne...</span>
                </span>
              </div>
              <div class="swt-progress-actions">
                <button class="swt-progress-minimize">−</button>
                <button class="swt-progress-pause">
                  ${SWT.Icons.svg('pause')}
                </button>
                <button class="swt-progress-stop">
                  ${SWT.Icons.svg('stop')}
                </button>
              </div>
            </div>
            <div class="swt-progress-body">
              <div class="swt-progress-bar"><div class="swt-progress-fill"></div></div>
              <div class="swt-progress-info">
                <span class="swt-progress-text">0%</span>
                <span class="swt-progress-stats">0 / 0</span>
              </div>
              <div class="swt-progress-tokens">
                <span class="swt-token-current">0</span>
                <span class="swt-token-divider">•</span>
                <span class="swt-token-total">0</span>
              </div>
            </div>
          </div>
          <div class="swt-progress-ring">
            <svg viewBox="0 0 36 36">
              <path class="swt-ring-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"/>
              <path class="swt-ring-fill" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" stroke-dasharray="0, 100"/>
            </svg>
            <span class="swt-ring-percent">0%</span>
          </div>
        `;
        document.body.appendChild(this.progressOverlay);
        
        const self = this;
        
        // Event-Listener: Minimieren
        this.progressOverlay.querySelector('.swt-progress-minimize').addEventListener('click', () => {
          self.progressOverlay.classList.toggle('swt-minimized');
        });
        
        // Pause/Resume Button
        const pauseBtn = this.progressOverlay.querySelector('.swt-progress-pause');
        const setPauseState = (paused) => {
          const icon = paused ? 'play' : 'pause';
          const label = paused ? 'Fortsetzen' : 'Pausieren';
          pauseBtn.innerHTML = SWT.Icons.svg(icon);
          pauseBtn.title = label;
          pauseBtn.classList.toggle('swt-paused', paused);
          self.progressOverlay.classList.toggle('swt-paused', paused);
        };

        pauseBtn.addEventListener('click', () => {
          self.isPaused = !self.isPaused;
          setPauseState(self.isPaused);
          if (self.isPaused) {
            self.pauseStartTime = Date.now();
          } else if (self.pauseStartTime) {
            self.translationStartTime += (Date.now() - self.pauseStartTime);
          }
        });
        
        // Stop Button (Abbruch)
        const stopBtn = this.progressOverlay.querySelector('.swt-progress-stop');
        stopBtn.addEventListener('click', () => {
          self.translationAborted = true;
          self.abortController?.abort();
          self.showProgress(false);
          self.showNotification('Übersetzung abgebrochen', 'error');
        });
        
        // Minimierter Ring klickbar
        this.progressOverlay.querySelector('.swt-progress-ring').addEventListener('click', () => {
          self.progressOverlay.classList.remove('swt-minimized');
        });
      }
      requestAnimationFrame(() => this.progressOverlay?.classList.add('swt-visible'));
    } else {
      this._lastBadgePercent = 0;
      if (this.progressOverlay) {
        this.progressOverlay.classList.remove('swt-visible');
        const overlay = this.progressOverlay;
        setTimeout(() => {
          overlay?.remove();
          if (this.progressOverlay === overlay) {
            this.progressOverlay = null;
            this.abortController = null;
            this.isPaused = false;
          }
        }, 300);
      }
    }
  };

  /**
   * Progress-Anzeige aktualisieren
   */
  SmartTranslator.prototype.updateProgress = function(current, total, tokenInfo = null) {
    if (!this.progressOverlay) return;
    
    // Debug: Prüfen ob total sich ändert
    if (this._lastTotal && this._lastTotal !== total) {
    }
    this._lastTotal = total;
    
    const percent = Math.round((current / total) * 100);

    // Extension-Badge aktualisieren (throttled: alle 5%)
    if (!this._lastBadgePercent || percent >= this._lastBadgePercent + 5 || percent >= 100) {
      this._lastBadgePercent = percent;
      chrome.runtime.sendMessage({ action: 'BADGE_PROGRESS', percent }).catch(() => {});
    }

    // Balken
    const fill = this.progressOverlay.querySelector('.swt-progress-fill');
    if (fill) fill.style.width = `${percent}%`;
    
    // Text
    const text = this.progressOverlay.querySelector('.swt-progress-text');
    if (text) text.textContent = `${percent}%`;
    
    // Stats
    const stats = this.progressOverlay.querySelector('.swt-progress-stats');
    if (stats) stats.textContent = `${current} / ${total}`;
    
    // Ring (minimierte Ansicht)
    const ringFill = this.progressOverlay.querySelector('.swt-ring-fill');
    if (ringFill) ringFill.setAttribute('stroke-dasharray', `${percent}, 100`);
    
    const ringPercent = this.progressOverlay.querySelector('.swt-ring-percent');
    if (ringPercent) ringPercent.textContent = `${percent}%`;
    
    // ETA
    const etaText = this.progressOverlay.querySelector('.swt-eta-text');
    if (etaText) {
      const eta = this.calculateETA(current, total);
      if (eta !== null) {
        etaText.textContent = this.formatETA(eta);
      } else if (current < 3) {
        etaText.textContent = 'berechne...';
      }
    }
    
    // Token-Info
    if (tokenInfo) {
      this.currentTokens = tokenInfo.tokens || 0;
      this.totalTokens += this.currentTokens;
      
      const currentEl = this.progressOverlay.querySelector('.swt-token-current');
      const totalEl = this.progressOverlay.querySelector('.swt-token-total');
      if (currentEl) currentEl.textContent = this.formatTokens(this.currentTokens, false);
      if (totalEl) totalEl.textContent = this.formatTokens(this.totalTokens, false);
      
      // Status-Indikator: Wechselt nur wenn sich der Zustand ändert
      const cacheHits = tokenInfo.cacheHits || 0;
      
      if (this.currentTokens > 0) {
        // KI aktiv (Tokens verbraucht)
        this.updateSourceStatus?.('ai', true);
      } else if (cacheHits > 0) {
        // Cache aktiv (keine Tokens, aber Cache-Hits)
        this.updateSourceStatus?.('cache', true);
      }
      // Sonst: Status bleibt wie er ist
    }
  };

  /**
   * Zeitschätzung berechnen
   */
  SmartTranslator.prototype.calculateETA = function(current, total) {
    if (current < 3 || !this.translationStartTime) return null;
    
    const elapsed = Date.now() - this.translationStartTime;
    const avgTimePerItem = elapsed / current;
    const remaining = total - current;
    return remaining * avgTimePerItem;
  };

  /**
   * Zeit formatieren für ETA
   */
  SmartTranslator.prototype.formatETA = function(ms) {
    if (!ms || ms < 0) return '';
    
    const seconds = Math.ceil(ms / 1000);
    if (seconds < 60) return `ca. ${seconds} Sek.`;
    
    const minutes = Math.ceil(seconds / 60);
    if (minutes < 60) return `ca. ${minutes} Min.`;
    
    const hours = Math.floor(minutes / 60);
    const remainingMins = minutes % 60;
    return `ca. ${hours}h ${remainingMins}m`;
  };


  /**
   * Token-Formatierung mit Tausendertrenner
   */
  SmartTranslator.prototype.formatTokens = function(num, useShort = false) {
    if (useShort && num >= 1000000000) {
      return (num / 1000000000).toFixed(1) + 'G';
    } else if (useShort && num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    } else if (useShort && num >= 10000) {
      return (num / 1000).toFixed(1) + 'K';
    } else {
      return num.toLocaleString('de-DE');
    }
  };

  /**
   * Toast-Benachrichtigung anzeigen
   */
  SmartTranslator.prototype.showNotification = function(message, type = 'info') {
    let container = document.querySelector('.swt-notification-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'swt-ui swt-notification-container';
      document.body.appendChild(container);
    }

    const notification = document.createElement('div');
    notification.className = `swt-ui swt-notification swt-notification-${type}`;
    notification.textContent = message;
    container.appendChild(notification);

    requestAnimationFrame(() => notification.classList.add('swt-visible'));

    setTimeout(() => {
      notification.classList.remove('swt-visible');
      setTimeout(() => {
        notification.remove();
        if (container.children.length === 0) {
          container.remove();
        }
      }, 300);
    }, 3000);
  };

  /**
   * Text vorlesen (TTS)
   */
  SmartTranslator.prototype.speak = function(text, onEnd = null) {
    speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = this.settings.ttsLanguage || 'de-DE';
    
    if (onEnd) {
      utterance.onend = onEnd;
      utterance.onerror = onEnd;
    }
    
    speechSynthesis.speak(utterance);
  };

  /**
   * HTML escapen
   */
  SmartTranslator.prototype.escapeHtml = function(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  };

  /**
   * Aktualisiert den Status-Indikator (Cache/KI)
   * @param {string} type - 'loading', 'cache', 'ai', oder null
   * @param {boolean} active - Ob Animation angezeigt werden soll
   */
  const STATUS_TYPES = ['loading', 'cache', 'ai'];
  const STATUS_LABELS = { loading: 'Lade...', cache: 'Aus Server-Cache', ai: 'KI-Übersetzung' };

  /**
   * Provider-Info und Übersetzungsrichtung im Overlay setzen
   */
  SmartTranslator.prototype.updateProgressMeta = function(apiType, sourceLang, targetLang, extra) {
    if (!this.progressOverlay) return;

    const providerEl = this.progressOverlay.querySelector('.swt-progress-provider');
    const directionEl = this.progressOverlay.querySelector('.swt-progress-direction');

    if (providerEl) {
      let label = apiType === 'lmstudio' ? 'LM Studio' : 'LibreTranslate';
      if (apiType === 'lmstudio' && extra?.model) {
        label += ' -- ' + extra.model.split('/').pop();
      }
      if (apiType === 'lmstudio' && extra?.context && extra.context !== 'general') {
        const names = { automotive: 'Kfz', technical: 'IT', medical: 'Medizin', legal: 'Recht' };
        label += ' (' + (names[extra.context] || extra.context) + ')';
      }
      providerEl.textContent = label;
    }

    if (directionEl) {
      const langName = (code) => {
        const map = { auto: 'Auto', en: 'EN', de: 'DE', fr: 'FR', es: 'ES', it: 'IT',
          pt: 'PT', nl: 'NL', pl: 'PL', ru: 'RU', zh: 'ZH', ja: 'JA', ko: 'KO',
          ar: 'AR', tr: 'TR', uk: 'UK', cs: 'CS', sv: 'SV', da: 'DA', fi: 'FI', hi: 'HI' };
        return map[code] || code.toUpperCase();
      };
      directionEl.textContent = langName(sourceLang) + ' \u2192 ' + langName(targetLang);
    }
  };

  SmartTranslator.prototype.updateSourceStatus = function(type, active = true) {
    if (!this.progressOverlay) return;

    // Status-Dot
    const dot = this.progressOverlay.querySelector('.swt-status-dot');
    if (dot) {
      for (const t of STATUS_TYPES) dot.classList.toggle(t, t === type);
      dot.classList.toggle('active', !!type && active);
      dot.title = STATUS_LABELS[type] || 'Bereit';
    }

    // Ring-Farbe
    for (const t of STATUS_TYPES) {
      this.progressOverlay.classList.toggle('status-' + t, t === type);
    }
  };

})();
