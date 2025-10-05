// Content UI
// Progress, Notifications, TTS und Formatierung

(function() {
  'use strict';

  // Guard gegen doppeltes Laden
  if (window._smtUILoaded) return;
  window._smtUILoaded = true;

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
        this.progressOverlay.className = 'smt-ui smt-progress';
        this.progressOverlay.innerHTML = `
          <div class="smt-progress-content">
            <div class="smt-progress-header">
              <div class="smt-progress-title-wrap">
                <div class="smt-status-dot" id="smtStatusDot" title="Bereit"></div>
                <span class="smt-progress-title">Übersetze...</span>
                <span class="smt-progress-eta" title="Geschätzte Restzeit">
                  ${SMT.Icons.svg('clock', 'smt-eta-icon')}
                  <span class="smt-eta-text">berechne...</span>
                </span>
              </div>
              <div class="smt-progress-actions">
                <button class="smt-progress-minimize" title="Minimieren">−</button>
                <button class="smt-progress-pause" title="Pausieren">
                  ${SMT.Icons.svg('pause')}
                </button>
                <button class="smt-progress-stop" title="Abbrechen">
                  ${SMT.Icons.svg('stop')}
                </button>
              </div>
            </div>
            <div class="smt-progress-body">
              <div class="smt-progress-bar"><div class="smt-progress-fill"></div></div>
              <div class="smt-progress-info">
                <span class="smt-progress-text">0%</span>
                <span class="smt-progress-stats">0 / 0</span>
              </div>
              <div class="smt-progress-tokens">
                <span class="smt-token-current" title="Tokens letzte Anfrage">0</span>
                <span class="smt-token-divider">•</span>
                <span class="smt-token-total" title="Tokens gesamt">0</span>
                <span class="smt-token-cost-divider">|</span>
                <span class="smt-token-cost" title="Geschätzte Kosten">~$0.00</span>
              </div>
            </div>
          </div>
          <div class="smt-progress-ring">
            <svg viewBox="0 0 36 36">
              <path class="smt-ring-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"/>
              <path class="smt-ring-fill" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" stroke-dasharray="0, 100"/>
            </svg>
            <span class="smt-ring-percent">0%</span>
          </div>
        `;
        document.body.appendChild(this.progressOverlay);
        
        const self = this;
        
        // Event-Listener: Minimieren
        this.progressOverlay.querySelector('.smt-progress-minimize').addEventListener('click', () => {
          self.progressOverlay.classList.toggle('smt-minimized');
        });
        
        // Pause/Resume Button
        const pauseBtn = this.progressOverlay.querySelector('.smt-progress-pause');
        pauseBtn.addEventListener('click', () => {
          self.isPaused = !self.isPaused;
          if (self.isPaused) {
            pauseBtn.innerHTML = SMT.Icons.svg('play');
            pauseBtn.title = 'Fortsetzen';
            pauseBtn.classList.add('smt-paused');
            self.progressOverlay.classList.add('smt-paused');
            self.pauseStartTime = Date.now();
          } else {
            pauseBtn.innerHTML = SMT.Icons.svg('pause');
            pauseBtn.title = 'Pausieren';
            pauseBtn.classList.remove('smt-paused');
            self.progressOverlay.classList.remove('smt-paused');
            if (self.pauseStartTime) {
              self.translationStartTime += (Date.now() - self.pauseStartTime);
            }
          }
        });
        
        // Stop Button (Abbruch)
        const stopBtn = this.progressOverlay.querySelector('.smt-progress-stop');
        stopBtn.addEventListener('click', () => {
          self.translationAborted = true;
          self.abortController?.abort();
          self.showProgress(false);
          self.showNotification('Übersetzung abgebrochen', 'error');
        });
        
        // Minimierter Ring klickbar
        this.progressOverlay.querySelector('.smt-progress-ring').addEventListener('click', () => {
          self.progressOverlay.classList.remove('smt-minimized');
        });
      }
      requestAnimationFrame(() => this.progressOverlay?.classList.add('smt-visible'));
    } else {
      if (this.progressOverlay) {
        this.progressOverlay.classList.remove('smt-visible');
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
    const fill = this.progressOverlay.querySelector('.smt-progress-fill');
    if (fill) fill.style.width = `${percent}%`;
    
    // Text
    const text = this.progressOverlay.querySelector('.smt-progress-text');
    if (text) text.textContent = `${percent}%`;
    
    // Stats
    const stats = this.progressOverlay.querySelector('.smt-progress-stats');
    if (stats) stats.textContent = `${current} / ${total}`;
    
    // Ring (minimierte Ansicht)
    const ringFill = this.progressOverlay.querySelector('.smt-ring-fill');
    if (ringFill) ringFill.setAttribute('stroke-dasharray', `${percent}, 100`);
    
    const ringPercent = this.progressOverlay.querySelector('.smt-ring-percent');
    if (ringPercent) ringPercent.textContent = `${percent}%`;
    
    // ETA
    const etaText = this.progressOverlay.querySelector('.smt-eta-text');
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
      
      const currentEl = this.progressOverlay.querySelector('.smt-token-current');
      const totalEl = this.progressOverlay.querySelector('.smt-token-total');
      const costEl = this.progressOverlay.querySelector('.smt-token-cost');
      
      if (currentEl) currentEl.textContent = this.formatTokens(this.currentTokens, false);
      if (totalEl) totalEl.textContent = this.formatTokens(this.totalTokens, false);
      
      if (costEl) {
        const cost = this.calculateCost(this.totalTokens);
        costEl.textContent = this.formatCost(cost);
      }
      
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
   * Kosten berechnen basierend auf API-Typ
   */
  SmartTranslator.prototype.calculateCost = function(tokens) {
    // Benutzerdefinierte Kosten
    if (this.settings.enableTokenCost) {
      const costAmount = this.settings.tokenCostAmount || 1;
      const costPer = this.settings.tokenCostPer || 10000;
      const costPerToken = costAmount / costPer;
      return tokens * costPerToken;
    }
    
    // Standard-Preise pro 1M Tokens
    const pricing = {
      'openai': { input: 0.50, output: 1.50 },
      'claude': { input: 3.00, output: 15.00 },
      'deepl': { perChar: 0.00002 },
      'libretranslate': { free: true },
      'lmstudio': { free: true }
    };
    
    const apiType = this.settings.apiType || 'libretranslate';
    const price = pricing[apiType];
    
    if (!price || price.free) return null;
    
    if (price.perChar) {
      return tokens * 4 * price.perChar * 100;
    }
    
    const avgPrice = (price.input + price.output) / 2;
    return (tokens / 1000000) * avgPrice * 100;
  };

  /**
   * Kosten formatieren (Eingabe in Cent)
   */
  SmartTranslator.prototype.formatCost = function(cost) {
    if (cost === null) return 'kostenlos';
    
    const currency = this.settings.tokenCostCurrency || 'EUR';
    const symbol = currency === 'EUR' ? '€' : '$';
    
    if (cost < 0.01) {
      return `~0,0001 ${symbol}`;
    } else if (cost < 1) {
      return `~${cost.toFixed(4)} ct`;
    } else if (cost < 100) {
      return `~${cost.toFixed(2)} ct`;
    } else {
      const euros = cost / 100;
      return `~${euros.toFixed(2)} ${symbol}`;
    }
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
    let container = document.querySelector('.smt-notification-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'smt-ui smt-notification-container';
      document.body.appendChild(container);
    }

    const notification = document.createElement('div');
    notification.className = `smt-ui smt-notification smt-notification-${type}`;
    notification.textContent = message;
    container.appendChild(notification);

    requestAnimationFrame(() => notification.classList.add('smt-visible'));

    setTimeout(() => {
      notification.classList.remove('smt-visible');
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
    
    const statusDot = this.progressOverlay.querySelector('.smt-status-dot');
    
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
