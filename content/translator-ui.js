// Content UI
// Progress, Notifications, TTS und Formatierung

(function() {
  'use strict';

  // Guard gegen doppeltes Laden
  var guardKey = chrome.runtime.id + "_" + chrome.runtime.getManifest().version;
  if (window.__swtUIGuardKey === guardKey) return;
  window.__swtUIGuardKey = guardKey;

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
                <div class="swt-status-dot" id="smtStatusDot" title="Bereit"></div>
                <span class="swt-progress-title">Übersetze...</span>
                <span class="swt-progress-eta" title="Geschätzte Restzeit">
                  ${SWT.Icons.svg('clock', 'swt-eta-icon')}
                  <span class="swt-eta-text">berechne...</span>
                </span>
              </div>
              <div class="swt-progress-actions">
                <button class="swt-progress-minimize" title="Minimieren">−</button>
                <button class="swt-progress-pause" title="Pausieren">
                  ${SWT.Icons.svg('pause')}
                </button>
                <button class="swt-progress-stop" title="Abbrechen">
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
                <span class="swt-token-current" title="Tokens letzte Anfrage">0</span>
                <span class="swt-token-divider">•</span>
                <span class="swt-token-total" title="Tokens gesamt">0</span>
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
        pauseBtn.addEventListener('click', () => {
          self.isPaused = !self.isPaused;
          if (self.isPaused) {
            pauseBtn.innerHTML = SWT.Icons.svg('play');
            pauseBtn.title = 'Fortsetzen';
            pauseBtn.classList.add('swt-paused');
            self.progressOverlay.classList.add('swt-paused');
            self.pauseStartTime = Date.now();
          } else {
            pauseBtn.innerHTML = SWT.Icons.svg('pause');
            pauseBtn.title = 'Pausieren';
            pauseBtn.classList.remove('swt-paused');
            self.progressOverlay.classList.remove('swt-paused');
            if (self.pauseStartTime) {
              self.translationStartTime += (Date.now() - self.pauseStartTime);
            }
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
      console.warn(`[SWT Debug] WARNUNG: total hat sich geändert! ${this._lastTotal} → ${total}`);
    }
    this._lastTotal = total;
    
    const percent = Math.round((current / total) * 100);
    
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
  SmartTranslator.prototype.updateSourceStatus = function(type, active = true) {
    if (!this.progressOverlay) return;
    
    const statusDot = this.progressOverlay.querySelector('.swt-status-dot');
    
    if (statusDot) {
      // Klassen zurücksetzen
      statusDot.classList.remove('loading', 'cache', 'ai', 'active');
      
      if (type) {
        statusDot.classList.add(type);
        if (active) {
          statusDot.classList.add('active');
        }
        
        // Tooltip
        const tooltips = {
          loading: 'Lade...',
          cache: 'Aus Server-Cache',
          ai: 'KI-Übersetzung'
        };
        statusDot.title = tooltips[type] || '';
      } else {
        statusDot.title = 'Bereit';
      }
    }
    
    // Ring-Farbe auch anpassen
    if (this.progressOverlay) {
      this.progressOverlay.classList.remove('status-loading', 'status-cache', 'status-ai');
      if (type) {
        this.progressOverlay.classList.add('status-' + type);
      }
    }
  };

})();
