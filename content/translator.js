// Content Script - Smart Web Translator v3.11.6
// Mit LocalStorage Cache, Hover-Original, Toggle
// v3.11.6: Middleware-Batching - Content sendet sequentiell, Background sammelt & batcht
// v3.11.5: Konfigurierbare Batch-Größe (1-50) mit exakter Reihenfolge
// v3.11.1: Abstrakte Cache-API (SWT.Cache), async loadCachedTranslation
// v3.8: Cache Server Integration
// v3.7: Export-Funktionen ausgelagert nach content/content-export.js
// v3.6: Pin-Funktion entfernt, TTS-Toggle, Abbruch-Logik überarbeitet
// v3.5: Echte Batch-Übersetzung, Smart Chunking, URL-Tracking für SPAs

class SmartTranslator {
  constructor() {
    this.settings = {};
    this.originalTexts = new Map();
    this.translatedTexts = new Map();
    this.isTranslated = false;
    this.translationMode = null;
    this.selectionIcon = null;
    this.tooltip = null;
    this.progressOverlay = null;
    this.cacheIndicator = null;
    this.pageUrl = window.location.href;
    this.cacheKey = this.generateCacheKey();
    this.translationRequestId = 0; // Für Request-Tracking
    
    // URL-Tracking für SPAs (v3.5.3)
    this.lastUrl = window.location.href;
    this.urlCheckInterval = null;

    this.init();
  }

  /**
   * Robuster sendMessage Wrapper mit Retry-Logik
   * Fängt "message channel closed" Fehler ab und versucht erneut
   * @param {Object} message - Die Nachricht
   * @param {number} maxRetries - Maximale Wiederholungen (default: 2)
   * @param {number} retryDelay - Verzögerung zwischen Retries in ms (default: 100)
   * @returns {Promise<Object>} - Die Antwort oder {success: false, error: ...}
   */
  async sendMessageSafe(message, maxRetries = 2, retryDelay = 100) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await chrome.runtime.sendMessage(message);
        // Erfolg - prüfe auf undefined (Service Worker nicht verfügbar)
        if (result === undefined) {
          throw new Error('No response from service worker');
        }
        return result;
      } catch (error) {
        const errorMsg = error?.message || String(error);
        const isChannelClosed = errorMsg.includes('message channel closed') ||
                                errorMsg.includes('Receiving end does not exist') ||
                                errorMsg.includes('Extension context invalidated') ||
                                errorMsg.includes('No response from service worker');
        
        if (isChannelClosed && attempt < maxRetries) {
          // Kurz warten und erneut versuchen
          await new Promise(r => setTimeout(r, retryDelay * (attempt + 1)));
          continue;
        }
        
        // Fehler nach allen Retries oder anderer Fehlertyp
        console.warn(`[SWT] sendMessage failed (attempt ${attempt + 1}/${maxRetries + 1}):`, errorMsg);
        return { success: false, error: errorMsg };
      }
    }
    return { success: false, error: 'Max retries exceeded' };
  }

  // Status-Änderung an Sidepanel/Popup melden
  notifyStatusChange() {
    chrome.runtime.sendMessage({ action: 'PAGE_STATUS_CHANGED' }).catch(() => {});
  }

  generateCacheKey() {
    // Prüfe ob Domain-Strategie einen speziellen Cache-Key benötigt
    const url = window.location.href;
    const hostname = new URL(url).hostname;
    
    console.log('[SWT] generateCacheKey für:', hostname);
    
    if (typeof DomainStrategies !== 'undefined') {
      const strategy = DomainStrategies.getStrategy(url);
      console.log('[SWT] Gefundene Strategie:', strategy?.name || 'default');
      
      if (strategy?.name === 'E-Book Reader') {
        console.log('[SWT] E-Book Domains:', strategy.ebookDomains);
      }
      
      // Strategie mit eigener Cache-Key-Generierung?
      if (strategy && typeof strategy.generateCacheKey === 'function') {
        const customKey = strategy.generateCacheKey(url);
        console.log('[SWT] Custom Cache-Key:', customKey);
        return 'swt_cache_' + btoa(customKey).replace(/[^a-zA-Z0-9]/g, '').slice(0, 80);
      }
    } else {
      console.log('[SWT] DomainStrategies nicht verfügbar!');
    }
    
    // Standard: hostname + pathname (ohne Hash)
    return 'swt_cache_' + btoa(window.location.hostname + window.location.pathname).replace(/[^a-zA-Z0-9]/g, '').slice(0, 50);
  }
  
  /**
   * Prüft ob aktuelle Seite eine spezielle Strategie verwendet
   */
  getActiveStrategy() {
    if (typeof DomainStrategies !== 'undefined') {
      const strategy = DomainStrategies.getStrategy(window.location.href);
      console.log('[SWT] getActiveStrategy:', strategy?.name || 'default');
      return strategy;
    }
    console.log('[SWT] DomainStrategies nicht verfügbar in getActiveStrategy!');
    return null;
  }
  
  /**
   * Prüft ob aktuelle Seite iframe-basierten Content hat (E-Books etc.)
   */
  hasIframeContent() {
    const strategy = this.getActiveStrategy();
    return strategy?.usesIframeContent === true;
  }

  async init() {
    console.log('[SWT] === INIT START ===');
    console.log('[SWT] URL:', window.location.href);
    console.log('[SWT] Hostname:', window.location.hostname);
    
    await this.loadSettings();
    await this.loadEbookDomains(); // E-Book-Domains laden
    
    // Debug: Strategie prüfen
    const strategy = this.getActiveStrategy?.();
    console.log('[SWT] Aktive Strategie nach init:', strategy?.name || 'keine');
    
    this.setupEventListeners();
    this.setupUrlTracking();  // NEU: URL-Tracking für SPAs
    
    // Für E-Books: Warten bis iframes geladen sind
    if (strategy?.name === 'E-Book Reader') {
      console.log('[SWT E-Book] Warte auf iframes...');
      await this.waitForEbookIframes();
    }
    
    this.checkForCachedTranslation();

    // Message Listener nur einmal registrieren (global)
    if (!window.__swtMessageListenerAdded) {
      window.__swtMessageListenerAdded = true;
      chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (window.swtInstance) {
          window.swtInstance.handleMessage(request, sender, sendResponse);
        } else {
        }
        return true;
      });
    } else {
    }

    // Storage Listener auch nur einmal
    if (!window.__swtStorageListenerAdded) {
      window.__swtStorageListenerAdded = true;
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'sync') return;
        
        if (window.swtInstance) {
          for (const [key, { newValue }] of Object.entries(changes)) {
            // Logging für Debug
            console.log(`[SWT] Setting changed: ${key} =`, newValue, 'Type:', typeof newValue);
            
            // Boolean-Settings explizit casten
            const booleanSettings = [
              'showSelectionIcon', 'enableTTS', 'showOriginalInTooltip',
              'showAlternatives', 'highlightTranslated', 'skipCodeBlocks',
              'skipBlockquotes', 'fixInlineSpacing', 'useCacheFirst',
              'autoLoadCache', 'enableTokenCost', 'enableTrueBatch',
              'enableSmartChunking', 'cacheServerEnabled', 'extractIframeContent'
            ];
            
            if (booleanSettings.includes(key)) {
              // Expliziter Boolean-Cast
              window.swtInstance.settings[key] = newValue === true;
            } else {
              window.swtInstance.settings[key] = newValue;
            }
            
            // E-Book-Domains dynamisch aktualisieren
            if (key === 'ebookReaderDomains' && typeof DomainStrategies !== 'undefined') {
              if (DomainStrategies.strategies.ebook) {
                DomainStrategies.strategies.ebook.ebookDomains = newValue || [];
              }
            }
          }
        }
      });
    }
    
    console.log('[SWT] === INIT COMPLETE ===');
  }
  
  /**
   * E-Book-Reader-Domains aus Settings laden und in DomainStrategies setzen
   */
  async loadEbookDomains() {
    console.log('[SWT] loadEbookDomains gestartet...');
    try {
      const settings = await chrome.storage.sync.get(['ebookReaderDomains', 'extractIframeContent']);
      const domains = settings.ebookReaderDomains || ['books.mac']; // Default
      
      if (typeof DomainStrategies !== 'undefined' && DomainStrategies.strategies.ebook) {
        DomainStrategies.strategies.ebook.ebookDomains = domains;
        console.log('[SWT] E-Book-Reader-Domains geladen:', domains);
      }
      
      this.settings.ebookReaderDomains = domains;
      this.settings.extractIframeContent = settings.extractIframeContent !== false;
    } catch (e) {
      console.warn('[SWT] E-Book-Domains laden fehlgeschlagen:', e);
    }
  }
  
  /**
   * Wartet bis E-Book iframes geladen sind
   * Manche Reader laden iframes dynamisch nach dem DOM ready
   */
  async waitForEbookIframes(maxWait = 5000, checkInterval = 200) {
    const startTime = Date.now();
    
    return new Promise((resolve) => {
      const check = () => {
        // Suche nach iframes mit srcdoc oder epubjs
        const iframes = document.querySelectorAll('iframe[srcdoc], iframe.epub-view, iframe[id*="epub"]');
        
        if (iframes.length > 0) {
          console.log('[SWT E-Book] iframes gefunden:', iframes.length);
          resolve(true);
          return;
        }
        
        // Timeout erreicht?
        if (Date.now() - startTime > maxWait) {
          console.log('[SWT E-Book] Timeout - keine iframes gefunden nach', maxWait, 'ms');
          resolve(false);
          return;
        }
        
        // Weiter warten
        setTimeout(check, checkInterval);
      };
      
      check();
    });
  }
  
  // === URL-Tracking für SPAs (v3.5.3, v3.8 Debouncing) ===
  setupUrlTracking() {
    // 1. History API Hooks (pushState, replaceState)
    const self = this;
    
    const originalPushState = history.pushState;
    history.pushState = function(...args) {
      originalPushState.apply(this, args);
      self.handleUrlChange('pushState');
    };
    
    const originalReplaceState = history.replaceState;
    history.replaceState = function(...args) {
      originalReplaceState.apply(this, args);
      self.handleUrlChange('replaceState');
    };
    
    // 2. popstate Event (Back/Forward Navigation)
    window.addEventListener('popstate', () => {
      this.handleUrlChange('popstate');
    });
    
    // 3. hashchange Event (für Hash-basierte Router)
    window.addEventListener('hashchange', () => {
      this.handleUrlChange('hashchange');
    });
    
    // 4. Fallback: Polling für Edge Cases (manche Frameworks)
    this.urlCheckInterval = setInterval(() => {
      if (window.location.href !== this.lastUrl) {
        this.handleUrlChange('polling');
      }
    }, 1000);
    
    // 5. E-Book spezifisch: Beobachte iframe srcdoc Änderungen
    this.setupEbookObserver();
    
    // console.log('[SWT] URL-Tracking aktiviert');
  }
  
  /**
   * MutationObserver für E-Book iframe-Änderungen
   * Erkennt wenn Calibre-Web den srcdoc ändert (Blättern)
   * SMART: Triggert nur bei echtem URL-Wechsel
   */
  setupEbookObserver() {
    const strategy = this.getActiveStrategy?.();
    if (strategy?.name !== 'E-Book Reader') return;
    
    console.log('[SWT] E-Book Observer wird eingerichtet...');
    
    // Speichere aktuelle URL für Vergleich
    this._lastEbookUrl = window.location.href;
    this._ebookObserverBusy = false;
    
    // Beobachte den Container für neue/geänderte iframes
    const observer = new MutationObserver((mutations) => {
      // Verhindere Mehrfach-Trigger während Verarbeitung
      if (this._ebookObserverBusy) return;
      
      // Prüfe ob URL sich geändert hat (= echter Seitenwechsel)
      const currentUrl = window.location.href;
      if (currentUrl === this._lastEbookUrl) {
        // Gleiche URL - kein echter Seitenwechsel, ignorieren
        return;
      }
      
      let shouldTrigger = false;
      
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.attributeName === 'srcdoc') {
          shouldTrigger = true;
          break;
        }
        if (mutation.type === 'childList') {
          const hasNewIframe = Array.from(mutation.addedNodes).some(
            node => node.nodeName === 'IFRAME' || node.querySelector?.('iframe')
          );
          if (hasNewIframe) {
            shouldTrigger = true;
            break;
          }
        }
      }
      
      if (shouldTrigger) {
        console.log('[SWT E-Book] Seitenwechsel:', this._lastEbookUrl.split('#')[1]?.substring(0,30), '→', currentUrl.split('#')[1]?.substring(0,30));
        this._lastEbookUrl = currentUrl;
        this.handleEbookPageChange();
      }
    });
    
    // Beobachte den gesamten Body für iframe-Änderungen
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['srcdoc']
    });
    
    this._ebookObserver = observer;
    console.log('[SWT] E-Book Observer aktiviert');
  }
  
  /**
   * Handler für E-Book Seitenwechsel (Blättern)
   */
  handleEbookPageChange() {
    // Verhindere Mehrfach-Trigger
    if (this._ebookObserverBusy) return;
    this._ebookObserverBusy = true;
    
    // Debounce
    if (this._ebookChangeTimeout) {
      clearTimeout(this._ebookChangeTimeout);
    }
    
    this._ebookChangeTimeout = setTimeout(async () => {
      console.log('[SWT E-Book] Verarbeite Seitenwechsel...');
      
      // State zurücksetzen
      this.resetTranslationState();
      
      // Cache-Key neu generieren
      this.pageUrl = window.location.href;
      this.cacheKey = this.generateCacheKey();
      this.lastUrl = window.location.href;
      
      console.log('[SWT E-Book] Cache-Key:', this.cacheKey.substring(0, 60));
      
      // Warten bis iframes neu geladen sind
      await this.waitForEbookIframes(3000, 100);
      
      // Cache prüfen
      this.checkForCachedTranslation();
      this._ebookObserverBusy = false;
    }, 300);
  }
  
  // Debounce Timer für URL-Änderungen
  _urlChangeTimeout = null;
  _pendingUrlChange = null;
  
  handleUrlChange(source) {
    const newUrl = window.location.href;
    
    // Nur reagieren wenn URL sich wirklich geändert hat
    if (newUrl === this.lastUrl) return;
    
    // Debounce: Bei schnellen Änderungen (SPA-Routing) warten
    this._pendingUrlChange = { source, url: newUrl };
    
    if (this._urlChangeTimeout) {
      clearTimeout(this._urlChangeTimeout);
    }
    
    this._urlChangeTimeout = setTimeout(() => {
      this._executeUrlChange();
    }, 500); // 500ms Debounce
  }
  
  _executeUrlChange() {
    if (!this._pendingUrlChange) return;
    
    const { source, url } = this._pendingUrlChange;
    this._pendingUrlChange = null;
    
    // Nochmal prüfen ob URL sich wirklich geändert hat
    if (url === this.lastUrl) return;
    
    console.log(`[SWT] URL-Wechsel erkannt (${source}): ${this.lastUrl} → ${url}`);
    console.log(`[SWT] isTranslated vor Reset: ${this.isTranslated}`);
    
    // Bei SPA-Navigation mit aktiver Übersetzung: Seite neu laden
    // Verhindert "Schatten" von alten Übersetzungen
    if (this.isTranslated && !this._reloadPending) {
      console.log('[SWT] Übersetzung aktiv bei URL-Wechsel → Seite wird neu geladen');
      this._reloadPending = true;
      window.location.reload();
      return;
    }
    
    this.lastUrl = url;
    
    // State zurücksetzen
    this.resetTranslationState();
    
    // Cache-Key für neue URL generieren
    this.pageUrl = url;
    this.cacheKey = this.generateCacheKey();
    console.log(`[SWT] Neuer cacheKey: ${this.cacheKey?.substring(0, 30)}...`);
    
    // Nach kurzer Verzögerung (DOM muss sich aufbauen) Cache prüfen
    setTimeout(() => {
      console.log(`[SWT] Cache-Check für: ${window.location.href}`);
      console.log(`[SWT] pageUrl gespeichert: ${this.pageUrl}`);
      this.checkForCachedTranslation();
    }, 300);
  }
  
  resetTranslationState() {
    console.log('[SWT] resetTranslationState aufgerufen');
    
    // Übersetzungs-State zurücksetzen
    this.isTranslated = false;
    this.translationMode = null;
    this.originalTexts.clear();
    this.translatedTexts.clear();
    this.totalTokens = 0;
    this.currentTokens = 0;
    this.pageTokens = 0;
    this._plannedNodes = 0;  // Geplante Nodes zurücksetzen
    
    // UI-Elemente entfernen
    if (this.progressOverlay) {
      this.progressOverlay.remove();
      this.progressOverlay = null;
    }
    if (this.cacheIndicator) {
      this.cacheIndicator.remove();
      this.cacheIndicator = null;
    }
    
    // Übersetzungs-Wrapper entfernen - auch in iframes!
    const removeWrappers = (doc) => {
      doc.querySelectorAll('.swt-translated-text').forEach(el => {
        const original = el.dataset.original;
        if (original && el.parentNode) {
          el.parentNode.replaceChild(doc.createTextNode(original), el);
        } else {
          el.remove();
        }
      });
    };
    
    // Haupt-Dokument
    removeWrappers(document);
    
    // Auch in iframes (für E-Books)
    const strategy = this.getActiveStrategy?.();
    if (strategy?.usesIframeContent) {
      document.querySelectorAll('iframe').forEach(iframe => {
        try {
          if (iframe.contentDocument) {
            removeWrappers(iframe.contentDocument);
            console.log('[SWT] Wrapper aus iframe entfernt');
          }
        } catch (e) {
          // Cross-origin
        }
      });
    }
    
    console.log('[SWT] Translation-State zurückgesetzt');
  }

  async loadSettings() {
    this.settings = await chrome.storage.sync.get([
      'serviceUrl', 'apiKey', 'sourceLang', 'targetLang',
      'showSelectionIcon', 'selectionIconDelay', 'tooltipPosition',
      'showOriginalInTooltip', 'showAlternatives', 'enableTTS',
      'skipCodeBlocks', 'skipBlockquotes', 'useTabsForAlternatives',
      'simplifyPdfExport', 'fixInlineSpacing', 'tabWordThreshold',
      // LM Studio Settings
      'apiType', 'lmStudioUrl', 'lmStudioModel', 'lmStudioContext',
      // Neue v3.1 Settings
      'autoLoadCache', 'autoTranslateDomains', 'enableAbortTranslation',
    ]);

    // String-Settings mit Defaults
    this.settings.serviceUrl = this.settings.serviceUrl || 'http://localhost:5000/translate';
    this.settings.targetLang = this.settings.targetLang || 'de';
    this.settings.sourceLang = this.settings.sourceLang || 'auto';
    this.settings.apiType = this.settings.apiType || 'libretranslate';
    
    // Number-Settings mit Defaults
    this.settings.selectionIconDelay = this.settings.selectionIconDelay || 200;
    this.settings.tabWordThreshold = this.settings.tabWordThreshold || 20;
    
    // Boolean-Settings: Expliziter Cast, Default true
    this.settings.showSelectionIcon = this.settings.showSelectionIcon === true || this.settings.showSelectionIcon === undefined;
    this.settings.skipCodeBlocks = this.settings.skipCodeBlocks === true || this.settings.skipCodeBlocks === undefined;
    this.settings.skipBlockquotes = this.settings.skipBlockquotes === true || this.settings.skipBlockquotes === undefined;
    this.settings.useTabsForAlternatives = this.settings.useTabsForAlternatives === true || this.settings.useTabsForAlternatives === undefined;
    this.settings.fixInlineSpacing = this.settings.fixInlineSpacing === true || this.settings.fixInlineSpacing === undefined;
    
    // Boolean-Settings: Expliziter Cast, Default false
    this.settings.simplifyPdfExport = this.settings.simplifyPdfExport === true;
    this.settings.autoLoadCache = this.settings.autoLoadCache === true;
    
    // Array-Settings
    this.settings.autoTranslateDomains = this.settings.autoTranslateDomains || [];
    
    // Debug: Settings ausgeben
    console.log('[SWT] Settings geladen - showSelectionIcon:', this.settings.showSelectionIcon);
  }


  // === Event Listeners ===
  setupEventListeners() {
    document.addEventListener('mouseup', (e) => this.handleMouseUp(e));
    document.addEventListener('mousedown', (e) => this.handleMouseDown(e));

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.hideSelectionIcon();
        this.hideTooltip();
      }
    });

    document.addEventListener('scroll', () => {
      this.hideSelectionIcon();
    }, { passive: true });
  }

  handleMouseDown(e) {
    if (!e.target.closest('.swt-ui')) {
      this.hideSelectionIcon();
      // Tooltip schließen wenn woanders geklickt
      if (this.tooltip) {
        this.hideTooltip();
      }
      // Laufende Übersetzung abbrechen
      this.hideLoadingTooltip();
      this.translationRequestId++;
    }
  }

  handleMouseUp(e) {
    if (e.target.closest('.swt-ui')) return;

    setTimeout(() => {
      const selection = window.getSelection();
      const text = selection.toString().trim();

      // Debug: Einstellung prüfen
      console.log('[SWT] handleMouseUp - showSelectionIcon:', this.settings.showSelectionIcon, 'Type:', typeof this.settings.showSelectionIcon);

      // Expliziter Boolean-Check (nicht nur truthy/falsy)
      const showIcon = this.settings.showSelectionIcon === true;
      
      if (text.length > 0 && showIcon) {
        this.showSelectionIcon(selection, e);
      } else {
        this.hideSelectionIcon();
      }
    }, this.settings.selectionIconDelay);
  }

  // === Selection Icon ===
  showSelectionIcon(selection, mouseEvent) {
    this.hideSelectionIcon();

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    // WICHTIG: Text und Position JETZT speichern, bevor die Selection verloren geht
    const selectedText = selection.toString().trim();
    const savedPosition = {
      top: rect.bottom + window.scrollY + 10,
      left: rect.left + (rect.width / 2)
    };

    this.selectionIcon = document.createElement('div');
    this.selectionIcon.className = 'swt-ui swt-selection-icon';
    this.selectionIcon.innerHTML = SWT.Icons.svg('translate');

    const iconSize = 32;
    let left = rect.right + 8;
    let top = rect.top + window.scrollY - 4;

    if (left + iconSize > window.innerWidth) {
      left = rect.left - iconSize - 8;
    }

    this.selectionIcon.style.cssText = `position: absolute; left: ${left}px; top: ${top}px;`;

    this.selectionIcon.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Verwende die GESPEICHERTEN Werte, nicht die aktuelle Selection
      if (selectedText) {
        this.translateSelection(selectedText, savedPosition);
      }
      this.hideSelectionIcon();
    });

    document.body.appendChild(this.selectionIcon);
    requestAnimationFrame(() => this.selectionIcon?.classList.add('swt-visible'));
  }

  hideSelectionIcon() {
    if (this.selectionIcon) {
      this.selectionIcon.remove();
      this.selectionIcon = null;
    }
  }

  // === Tooltip ===
  showTooltip(original, translated, alternatives = [], position = null) {
    // Vorherigen Tooltip entfernen
    if (this.tooltip) {
      this.tooltip.remove();
    }

    const tooltip = document.createElement('div');
    tooltip.className = 'swt-ui swt-tooltip';

    const hasAlternatives = this.settings.showAlternatives && alternatives?.length > 0;
    
    // Wörter zählen
    const wordCount = original ? original.trim().split(/\s+/).length : 0;
    const tabThreshold = this.settings.tabWordThreshold || 20;
    
    // Tabs nur bei langen Texten (> threshold Wörter) UND wenn Alternativen vorhanden
    const useTabs = hasAlternatives && this.settings.useTabsForAlternatives && wordCount > tabThreshold;

    // Aktionsleiste OBEN
    let content = `
      <div class="swt-tooltip-actions">
        <button class="swt-action swt-copy" title="Kopieren">
          ${SWT.Icons.svg('copy')}
        </button>
        ${this.settings.enableTTS ? `
        <button class="swt-action swt-speak" title="Vorlesen">
          ${SWT.Icons.svg('volumeUp')}
        </button>
        ` : ''}
        <button class="swt-action swt-close" title="Schließen">
          ${SWT.Icons.svg('close')}
        </button>
      </div>
    `;

    // Original anzeigen
    if (this.settings.showOriginalInTooltip && original) {
      content += `<div class="swt-tooltip-original">${this.escapeHtml(original)}</div>`;
    }

    // Mit Tabs für Alternativen (bei längeren Texten)
    if (useTabs) {
      content += `<div class="swt-tooltip-tabs">`;
      content += `<button class="swt-tab active" data-index="0">1</button>`;
      alternatives.slice(0, 3).forEach((_, i) => {
        content += `<button class="swt-tab" data-index="${i + 1}">${i + 2}</button>`;
      });
      content += `</div>`;

      content += `<div class="swt-tooltip-content">`;
      content += `<div class="swt-tab-panel active" data-index="0">${this.escapeHtml(translated)}</div>`;
      alternatives.slice(0, 3).forEach((alt, i) => {
        content += `<div class="swt-tab-panel" data-index="${i + 1}">${this.escapeHtml(alt)}</div>`;
      });
      content += `</div>`;
    } else {
      // Standard-Layout ohne Tabs
      content += `<div class="swt-tooltip-content">`;
      content += `<div class="swt-translated">${this.escapeHtml(translated)}</div>`;

      if (hasAlternatives) {
        content += `<div class="swt-alternatives">`;
        alternatives.slice(0, 3).forEach(alt => {
          content += `<span class="swt-alt">${this.escapeHtml(alt)}</span>`;
        });
        content += `</div>`;
      }
      content += `</div>`;
    }

    tooltip.innerHTML = content;

    // Position - verwende übergebene Position oder berechne aus Selection
    let top, left;

    if (position) {
      top = position.top;
      left = position.left;
    } else {
      const selection = window.getSelection();
      if (selection.rangeCount > 0 && selection.toString().trim().length > 0) {
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        top = rect.bottom + window.scrollY + 10;
        left = rect.left + (rect.width / 2);
      } else {
        top = window.innerHeight / 3 + window.scrollY;
        left = window.innerWidth / 2;
      }
    }

    tooltip.style.cssText = `position: absolute; left: ${left}px; top: ${top}px; transform: translateX(-50%);`;

    document.body.appendChild(tooltip);

    // Tab-Switching
    if (useTabs) {
      tooltip.querySelectorAll('.swt-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          const index = tab.dataset.index;
          tooltip.querySelectorAll('.swt-tab').forEach(t => t.classList.remove('active'));
          tooltip.querySelectorAll('.swt-tab-panel').forEach(p => p.classList.remove('active'));
          tab.classList.add('active');
          tooltip.querySelector(`.swt-tab-panel[data-index="${index}"]`)?.classList.add('active');
        });
      });
    }

    // Alternative klickbar zum Kopieren
    tooltip.querySelectorAll('.swt-alt').forEach(alt => {
      alt.addEventListener('click', () => {
        navigator.clipboard.writeText(alt.textContent);
        this.showNotification('Alternative kopiert!', 'success');
      });
    });

    // Event Listener für Buttons
    tooltip.querySelector('.swt-copy').addEventListener('click', () => {
      // Bei Tabs: aktiven Tab kopieren
      const activePanel = tooltip.querySelector('.swt-tab-panel.active');
      const textToCopy = activePanel ? activePanel.textContent : translated;
      navigator.clipboard.writeText(textToCopy);
      this.showNotification('Kopiert!', 'success');
    });

    tooltip.querySelector('.swt-speak')?.addEventListener('click', (e) => {
      const btn = e.currentTarget;
      
      // Wenn gerade spricht → stoppen
      if (speechSynthesis.speaking) {
        speechSynthesis.cancel();
        btn.innerHTML = SWT.Icons.svg('volumeUp');
        btn.title = 'Vorlesen';
        return;
      }
      
      const activePanel = tooltip.querySelector('.swt-tab-panel.active');
      const textToSpeak = activePanel ? activePanel.textContent : translated;
      
      // Button auf Stop ändern
      btn.innerHTML = SWT.Icons.svg('stop');
      btn.title = 'Stoppen';
      
      this.speak(textToSpeak, () => {
        // Zurück auf Play wenn fertig
        btn.innerHTML = SWT.Icons.svg('volumeUp');
        btn.title = 'Vorlesen';
      });
    });

    tooltip.querySelector('.swt-close').addEventListener('click', () => {
      tooltip.classList.remove('swt-visible');
      setTimeout(() => tooltip.remove(), 200);
    });

    this.tooltip = tooltip;

    requestAnimationFrame(() => tooltip.classList.add('swt-visible'));
    this.adjustTooltipPosition(tooltip);
  }

  makeDraggable(element) {
    let isDragging = false;
    let startX, startY, startLeft, startTop;

    const header = element.querySelector('.swt-tooltip-content') || element;

    header.style.cursor = 'move';

    header.addEventListener('mousedown', (e) => {
      if (e.target.closest('.swt-tooltip-actions')) return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = element.getBoundingClientRect();
      startLeft = rect.left + window.scrollX;
      startTop = rect.top + window.scrollY;
      element.style.transform = 'none';
      element.style.left = startLeft + 'px';
      element.style.top = startTop + 'px';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      element.style.left = (startLeft + dx) + 'px';
      element.style.top = (startTop + dy) + 'px';
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
    });
  }

  adjustTooltipPosition(tooltip) {
    const rect = tooltip.getBoundingClientRect();
    const padding = 10;

    if (rect.right > window.innerWidth - padding) {
      tooltip.style.left = (parseFloat(tooltip.style.left) - (rect.right - window.innerWidth + padding)) + 'px';
    }
    if (rect.left < padding) {
      tooltip.style.left = (parseFloat(tooltip.style.left) + (padding - rect.left)) + 'px';
    }
  }

  hideTooltip() {
    if (this.tooltip) {
      this.tooltip.classList.remove('swt-visible');
      setTimeout(() => {
        this.tooltip?.remove();
        this.tooltip = null;
      }, 200);
    }
  }

  // === Übersetzungsfunktionen ===
  async translateSelection(text, position = null) {
    if (!text || text.trim().length === 0) return;

    // Request-ID um veraltete Antworten zu ignorieren
    const requestId = ++this.translationRequestId;

    // Zeige Loading-Spinner sofort
    this.showLoadingTooltip(position);

    try {
      const result = await this.sendMessageSafe({
        action: 'TRANSLATE',
        text: text.trim(),
        source: this.settings.sourceLang,
        target: this.settings.targetLang,
        pageUrl: window.location.href
      });

      // Prüfe ob dies noch die aktuelle Anfrage ist
      if (requestId !== this.translationRequestId) {
        // console.log('Veraltete Übersetzungsantwort ignoriert');
        return;
      }

      // Entferne Loading-Tooltip
      this.hideLoadingTooltip();

      // Prüfe ob result existiert und success hat
      if (result && result.success) {
        this.showTooltip(text.trim(), result.translatedText, result.alternatives, position);
      } else if (result && result.error) {
        this.showNotification(result.error, 'error');
      }
    } catch (error) {
      // Nur Fehler anzeigen wenn noch aktuelle Anfrage
      if (requestId === this.translationRequestId) {
        this.hideLoadingTooltip();
        console.warn('translateSelection error:', error);
        this.showNotification('Fehler: ' + error.message, 'error');
      }
    }
  }

  // Loading-Spinner Tooltip
  showLoadingTooltip(position) {
    this.hideLoadingTooltip();
    
    const loader = document.createElement('div');
    loader.className = 'swt-ui swt-loading-tooltip';
    loader.innerHTML = `
      <div class="swt-spinner"></div>
      <span>Übersetze...</span>
    `;

    let top, left;
    if (position) {
      top = position.top;
      left = position.left;
    } else {
      const selection = window.getSelection();
      if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        top = rect.bottom + window.scrollY + 10;
        left = rect.left + (rect.width / 2);
      } else {
        top = window.innerHeight / 3 + window.scrollY;
        left = window.innerWidth / 2;
      }
    }

    loader.style.cssText = `position: absolute; left: ${left}px; top: ${top}px; transform: translateX(-50%);`;
    document.body.appendChild(loader);
    this._loadingTooltip = loader;
    
    requestAnimationFrame(() => loader.classList.add('swt-visible'));
  }

  hideLoadingTooltip() {
    if (this._loadingTooltip) {
      this._loadingTooltip.remove();
      this._loadingTooltip = null;
    }
  }

  // === Seitenübersetzung ===
  async translatePage(mode = 'replace') {
    console.log(`[SWT] translatePage aufgerufen - mode: ${mode}, isTranslated: ${this.isTranslated}`);
    console.log(`[SWT] pageUrl: ${this.pageUrl}`);
    console.log(`[SWT] window.location.href: ${window.location.href}`);
    
    // WICHTIG: Prüfen ob URL sich geändert hat aber State nicht zurückgesetzt wurde
    if (this.pageUrl !== window.location.href) {
      console.log('[SWT] URL Mismatch! Reset State...');
      this.resetTranslationState();
      this.pageUrl = window.location.href;
      this.cacheKey = this.generateCacheKey();
    }
    
    // E-Book-Reader: Immer frischen State beim Übersetzen
    const strategy = this.getActiveStrategy?.();
    if (strategy?.name === 'E-Book Reader') {
      console.log('[SWT E-Book] translatePage: Reset für frischen Scan');
      // State zurücksetzen (entfernt alte Wrapper)
      this.resetTranslationState();
      // Cache-Key neu generieren
      this.cacheKey = this.generateCacheKey();
      console.log('[SWT E-Book] Neuer Cache-Key:', this.cacheKey);
    }
    
    // Bei Continue-Mode: Nicht zurücksetzen wenn schon übersetzt
    if (this.isTranslated && mode !== 'continue') {
      this.toggleTranslation();
      return;
    }
    
    // Continue-Mode: Übersetzung fortsetzen ohne Reset
    if (mode === 'continue') {
      console.log('[SWT] Continue-Mode: Übersetze nur fehlende Texte');
    }

    const apiSettings = await chrome.storage.sync.get([
      'apiType', 'lmStudioContext', 
      'lmBatchSize', 'enableTrueBatch', 'useCacheFirst',
    ]);
    this.settings.apiType = apiSettings.apiType || 'libretranslate';
    this.settings.lmStudioContext = apiSettings.lmStudioContext || 'general';
    // Continue-Mode impliziert Cache-First
    this.settings.useCacheFirst = mode === 'continue' ? true : apiSettings.useCacheFirst !== false;

    this.showProgress(true);
    this.translationMode = mode;

    try {
      // Prüfe ob Plain-Text Seite
      const isPlainText = this.detectPlainTextPage();
      
      // Cache-Objekt für Übersetzungen
      const cacheTranslations = {};
      
      // E-Book Reader: Spezielle Block-basierte Übersetzung
      const strategy = this.getActiveStrategy?.();
      const isEbook = strategy?.name === 'E-Book Reader';
      
      let textNodes;
      let ebookBlocks = null;
      
      if (isEbook) {
        console.log('[SWT E-Book] Verwende Block-Element-Übersetzung');
        ebookBlocks = this.findTranslatableBlockElements();
        
        if (ebookBlocks.length === 0) {
          console.log('[SWT E-Book] Keine Block-Elemente gefunden, Fallback zu Text-Nodes');
          textNodes = this.findTranslatableTextNodes();
        } else {
          // Für E-Books: Block-Elemente direkt übersetzen
          await this.translateEbookBlocks(ebookBlocks, cacheTranslations);
          return; // E-Book-Übersetzung abgeschlossen
        }
      } else if (isPlainText) {
        textNodes = this.handlePlainTextPage();
      } else {
        // Leerzeichen bei Inline-Tags normalisieren
        if (this.settings.fixInlineSpacing) {
          this.normalizeInlineSpacing();
        }
        textNodes = this.findTranslatableTextNodes();
      }

      const total = textNodes ? textNodes.length : 0;
      let translated = 0;

      if (total === 0) {
        this.showProgress(false);
        return;
      }

      this._plannedNodes = total;

      const batchSettings = await chrome.storage.sync.get(['pageBatchSize', 'lmBatchSize']);
      const batchSize = Math.max(1, Math.min(50, batchSettings.pageBatchSize || batchSettings.lmBatchSize || 20));

      console.log(`[SWT] Übersetzung gestartet: ${total} Text-Nodes (Batch-Größe: ${batchSize})`);

      // Batch-weise Übersetzung: Requests gleichzeitig abfeuern, Ergebnisse in Reihenfolge anwenden
      for (let i = 0; i < textNodes.length; i += batchSize) {
        // Abbruch-Check
        if (this.translationAborted) break;
        
        // Pause-Check
        while (this.isPaused && !this.translationAborted) {
          await new Promise(r => setTimeout(r, 200));
        }
        if (this.translationAborted) break;
        
        // Aktuelles Batch
        const batch = textNodes.slice(i, i + batchSize);
        
        // ALLE Requests des Batches GLEICHZEITIG abfeuern (ohne await!)
        const batchPromises = batch.map((node, idx) => {
          const originalText = node.textContent.trim();
          if (originalText.length < 2) {
            return Promise.resolve({ node, originalText, result: null, skipped: true, index: idx });
          }
          
          // Request abfeuern - NICHT awaiten!
          return this.sendMessageSafe({
            action: 'TRANSLATE',
            text: originalText,
            source: this.settings.sourceLang,
            target: this.settings.targetLang,
            pageUrl: window.location.href
          }).then(result => ({ node, originalText, result, skipped: false, index: idx }))
            .catch(e => ({ node, originalText, result: null, error: e, skipped: false, index: idx }));
        });
        
        // Auf ALLE Ergebnisse des Batches warten
        const batchResults = await Promise.all(batchPromises);
        
        if (this.translationAborted) break;
        
        // Ergebnisse in EXAKTER Reihenfolge (sortiert nach index) anwenden
        batchResults.sort((a, b) => a.index - b.index);
        
        for (const { node, originalText, result, skipped, error } of batchResults) {
          if (this.translationAborted) break;
          
          if (!skipped && result && result.success && result.translatedText !== originalText) {
            cacheTranslations[originalText] = result.translatedText;

            this.originalTexts.set(node, {
              text: originalText,
              element: node.parentElement
            });
            this.translatedTexts.set(node, result.translatedText);

            this.wrapWithHoverOriginal(node, originalText, result.translatedText);
          }
          
          translated++;
          this.updateProgress(translated, total, { tokens: result?.tokens || 0 });
        }
      }

      // Nur speichern wenn nicht abgebrochen
      if (!this.translationAborted) {
        // Cache speichern
        this.saveToCache(cacheTranslations);

        this.isTranslated = true;
        this.showProgress(false);
        this.notifyStatusChange();
        
        // Notification mit Token-Info
        const tokenInfo = this.totalTokens > 0 
          ? ` (${this.formatTokens(this.totalTokens)} Tokens)` 
          : '';
        this.showNotification(`${translated} Textblöcke übersetzt${tokenInfo}`, 'success');
        
        // Seiten-Token-Stats für späteren Abruf speichern
        this.pageTokens = this.totalTokens;
      }

    } catch (error) {
      this.showProgress(false);
      if (!this.translationAborted) {
        console.warn('translatePage error:', error);
        this.showNotification('Fehler bei Seitenübersetzung', 'error');
      }
    }
  }

  /**
   * E-Book-spezifische Block-Übersetzung
   * Übersetzt ganze Absätze statt einzelner Text-Nodes
   * Nutzt Queue-basiertes Batching im Background
   */
  async translateEbookBlocks(blocks, cacheTranslations) {
    console.log('[SWT E-Book] translateEbookBlocks:', blocks.length, 'Blöcke');
    
    const total = blocks.length;
    let translated = 0;
    let cachedCount = 0;
    let aiCount = 0;
    
    // Status-Update Funktion (lokal + Sidepanel)
    const updateStatus = (type, active = true, complete = false) => {
      // Lokaler Status-Indikator im Progress-Popup
      this.updateSourceStatus?.(type, active);
      
      // Sidepanel benachrichtigen
      chrome.runtime.sendMessage({
        action: 'TRANSLATION_STATUS',
        type,      // 'loading', 'cache', 'ai'
        active,
        complete,
        cached: cachedCount,
        ai: aiCount,
        total
      }).catch(() => {}); // Sidepanel evtl. nicht offen
    };
    
    // Cache-First: Gecachte Übersetzungen zuerst laden und anwenden
    if (this.settings.useCacheFirst) {
      console.log('[SWT E-Book] Cache-First aktiviert, lade gecachte Übersetzungen...');
      updateStatus('cache', true);
      
      // Alle Texte sammeln
      const allTexts = blocks.map(b => b.text).filter(t => t.length >= 2);
      
      // Cache abfragen (nur Cache, keine Übersetzung)
      const cacheResult = await this.sendMessageSafe({
        action: 'TRANSLATE_BATCH',
        texts: allTexts,
        source: this.settings.sourceLang,
        target: this.settings.targetLang,
        pageUrl: window.location.href,
        cacheOnly: true
      });
      
      if (cacheResult && cacheResult.success && cacheResult.items) {
        // Gecachte Übersetzungen in Map speichern
        const cachedTranslations = new Map();
        for (const item of cacheResult.items) {
          if (item.fromCache && item.translation !== item.original) {
            cachedTranslations.set(item.original, item.translation);
          }
        }
        
        console.log(`[SWT E-Book] ${cachedTranslations.size} Übersetzungen aus Cache`);
        
        // Gecachte sofort anwenden
        for (const block of blocks) {
          const cachedText = cachedTranslations.get(block.text);
          if (cachedText) {
            cacheTranslations[block.text] = cachedText;
            this.replaceEbookBlockContent(block, cachedText);
            cachedCount++;
            translated++;
          }
        }
        
        // Fortschritt aktualisieren
        this.updateProgress(translated, total);
        
        // Blöcke filtern - nur nicht-gecachte übersetzen
        blocks = blocks.filter(b => !cachedTranslations.has(b.text));
        console.log(`[SWT E-Book] ${blocks.length} Blöcke noch zu übersetzen`);
        
        // Wenn alles gecacht war, fertig!
        if (blocks.length === 0) {
          updateStatus('cache', false, true); // Complete
          this.isTranslated = true;
          this.showProgress(false);
          this.notifyStatusChange();
          this.showNotification(`${cachedCount} E-Book-Absätze aus Cache geladen`, 'success');
          return;
        }
      }
    }
    
    // Status: AI-Übersetzung startet
    updateStatus('ai', true);
    
    // Batch-Größe aus Settings laden
    const batchSettings = await chrome.storage.sync.get(['pageBatchSize', 'lmBatchSize']);
    const batchSize = Math.max(1, Math.min(50, batchSettings.pageBatchSize || batchSettings.lmBatchSize || 20));
    
    console.log(`[SWT E-Book] Übersetzung: ${blocks.length} Blöcke (Batch-Größe: ${batchSize})`);
    
    // Batch-weise Übersetzung
    for (let i = 0; i < blocks.length; i += batchSize) {
      // Abbruch-Check
      if (this.translationAborted) break;
      
      // Pause-Check
      while (this.isPaused && !this.translationAborted) {
        await new Promise(r => setTimeout(r, 200));
      }
      if (this.translationAborted) break;
      
      // Aktuelles Batch
      const batch = blocks.slice(i, i + batchSize);
      
      // ALLE Requests des Batches GLEICHZEITIG abfeuern
      const batchPromises = batch.map((block, idx) => {
        const text = block.text;
        if (text.length < 2) {
          return Promise.resolve({ block, text, result: null, skipped: true, index: idx });
        }
        
        return this.sendMessageSafe({
          action: 'TRANSLATE',
          text: text,
          source: this.settings.sourceLang,
          target: this.settings.targetLang,
          pageUrl: window.location.href
        }).then(result => ({ block, text, result, skipped: false, index: idx }))
          .catch(e => ({ block, text, result: null, error: e, skipped: false, index: idx }));
      });
      
      // Auf ALLE Ergebnisse warten
      const batchResults = await Promise.all(batchPromises);
      
      if (this.translationAborted) break;
      
      // Ergebnisse in EXAKTER Reihenfolge anwenden
      batchResults.sort((a, b) => a.index - b.index);
      
      for (const { block, text, result, skipped } of batchResults) {
        if (this.translationAborted) break;
        
        if (!skipped && result && result.success && result.translatedText !== text) {
          cacheTranslations[text] = result.translatedText;
          this.replaceEbookBlockContent(block, result.translatedText);
          aiCount++;
        }
        
        translated++;
        this.updateProgress(cachedCount + translated, total, {
          tokens: result?.tokens || 0
        });
      }
    }
    
    // Nur speichern wenn nicht abgebrochen
    if (!this.translationAborted) {
      // Status: Letzter aktiver Status bleibt (ai oder cache)
      const finalType = aiCount > 0 ? 'ai' : 'cache';
      updateStatus(finalType, false); // Animation stoppen
      
      this.saveToCache(cacheTranslations);
      this.isTranslated = true;
      this.showProgress(false);
      this.notifyStatusChange();
      
      const tokenInfo = this.totalTokens > 0 
        ? ` (${this.formatTokens(this.totalTokens)} Tokens)` 
        : '';
      const cacheInfo = cachedCount > 0 ? ` (${cachedCount} aus Cache)` : '';
      this.showNotification(`${translated} E-Book-Absätze übersetzt${cacheInfo}${tokenInfo}`, 'success');
      this.pageTokens = this.totalTokens;
    } else {
      // Bei Abbruch auch Status zurücksetzen
      updateStatus(null, false, true);
    }
  }
  
  /**
   * Ersetzt den Inhalt eines E-Book Block-Elements mit der Übersetzung
   */
  replaceEbookBlockContent(block, translatedText) {
    const el = block.element;
    if (!el) return;
    
    // Original speichern
    const originalHtml = el.innerHTML;
    const originalText = block.text;
    
    // Neuen Inhalt setzen - einfacher Text ohne innere Struktur
    // Die komplexen span-Strukturen werden durch die Übersetzung ersetzt
    el.innerHTML = `<span class="swt-translated-text" data-original="${this.escapeHtml(originalText)}" data-original-html="${this.escapeHtml(originalHtml)}">${this.escapeHtml(translatedText)}</span>`;
    
    // Tracking
    this.originalTexts.set(el, originalHtml);
    this.translatedTexts.set(el, translatedText);
    
    console.log('[SWT E-Book] Block übersetzt:', translatedText.substring(0, 50) + '...');
  }
  
  /**
   * HTML-Escape für sichere Einbettung
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Lädt gecachte Übersetzungen für eine Liste von Texten
   * @param {string[]} texts - Liste der zu prüfenden Texte
   * @returns {Promise<Map<string, string>>} - Map von Original → Übersetzung
   */
  async loadCachedTranslationsForTexts(texts) {
    const cachedTranslations = new Map();
    
    if (!texts || texts.length === 0) {
      return cachedTranslations;
    }
    
    try {
      // Über Background-Script den Cache abfragen
      const result = await this.sendMessageSafe({
        action: 'TRANSLATE_BATCH',
        texts: texts,
        source: this.settings.sourceLang,
        target: this.settings.targetLang,
        pageUrl: window.location.href,
        cacheOnly: true  // Nur Cache prüfen, nicht übersetzen
      });
      
      if (result && result.success && result.items) {
        for (const item of result.items) {
          if (item.fromCache && item.translation !== item.original) {
            cachedTranslations.set(item.original, item.translation);
          }
        }
      }
      
      console.log(`[SWT] Cache-First: ${cachedTranslations.size} von ${texts.length} aus Cache geladen`);
    } catch (e) {
      console.warn('[SWT] Cache-First Fehler:', e);
    }
    
    return cachedTranslations;
  }

  // Erkennt Plain-Text Seiten (RFC, .txt, Pre-Only)
  detectPlainTextPage() {
    const url = window.location.href.toLowerCase();
    const hostname = window.location.hostname.toLowerCase();
    
    // URL-basierte Erkennung
    if (url.endsWith('.txt') || url.endsWith('.text')) return true;
    
    // RFC-Seiten
    if (hostname.includes('ietf.org') || hostname.includes('rfc-editor.org')) return true;
    if (url.includes('/rfc/') || url.includes('/doc/rfc')) return true;
    
    // Content-Type Check (wenn verfügbar)
    const contentType = document.contentType || '';
    if (contentType.includes('text/plain')) return true;
    
    // DOM-basierte Erkennung: Nur ein Pre-Element mit viel Text?
    const body = document.body;
    const preElements = body.querySelectorAll('pre');
    
    if (preElements.length === 1) {
      const pre = preElements[0];
      const preText = pre.textContent.length;
      const bodyText = body.textContent.length;
      // Wenn Pre mehr als 80% des Seiteninhalts ausmacht
      if (preText > 1000 && preText / bodyText > 0.8) return true;
    }
    
    // Keine anderen Block-Elemente außer Pre?
    const blocks = body.querySelectorAll('p, div, article, section, h1, h2, h3, h4, h5, h6');
    if (blocks.length < 3 && preElements.length > 0) return true;
    
    return false;
  }

  // Behandelt Plain-Text Seiten speziell
  handlePlainTextPage() {
    const preElements = document.querySelectorAll('pre');
    const textNodes = [];
    
    preElements.forEach(pre => {
      // Pre-Element in logische Abschnitte aufteilen
      const text = pre.textContent;
      const paragraphs = this.splitIntoParagraphs(text);
      
      // Erstelle für jeden Absatz einen virtuellen Container
      pre.innerHTML = ''; // Leeren
      
      paragraphs.forEach(para => {
        if (para.trim().length < 3) {
          // Leerzeilen beibehalten
          pre.appendChild(document.createTextNode(para + '\n\n'));
          return;
        }
        
        const span = document.createElement('span');
        span.className = 'swt-pre-paragraph';
        span.textContent = para;
        pre.appendChild(span);
        pre.appendChild(document.createTextNode('\n\n'));
        
        // TextNode aus dem Span für Übersetzung
        if (span.firstChild) {
          textNodes.push(span.firstChild);
        }
      });
    });
    
    // Falls keine Pre-Elemente, versuche Body-Text
    if (textNodes.length === 0) {
      return this.findTranslatableTextNodes();
    }
    
    return textNodes;
  }

  // Teilt Text in logische Absätze (für Plain-Text/RFC)
  splitIntoParagraphs(text) {
    // Strategie:
    // 1. Doppelte Leerzeilen = eindeutige Absatzgrenze
    // 2. Satzende (. ! ?) + einzelne Newline + Großbuchstabe = Absatzgrenze
    // 3. Mindestlänge für sinnvolle Übersetzung
    
    const paragraphs = [];
    let currentParagraph = '';
    
    // Erst bei doppelten Newlines splitten
    const blocks = text.split(/\n\s*\n/);
    
    blocks.forEach(block => {
      const trimmed = block.trim();
      if (!trimmed) return;
      
      // Block ist kurz genug → direkt verwenden
      if (trimmed.length < 500) {
        paragraphs.push(trimmed);
        return;
      }
      
      // Langer Block → bei Satzenden + Newlines aufteilen
      const lines = trimmed.split('\n');
      let currentChunk = '';
      
      lines.forEach((line, idx) => {
        const trimmedLine = line.trim();
        if (!trimmedLine) return;
        
        if (currentChunk) {
          currentChunk += '\n';
        }
        currentChunk += trimmedLine;
        
        // Prüfe ob Satzende und nächste Zeile mit Großbuchstabe beginnt
        const endsWithSentence = trimmedLine.match(/[.!?]$/);
        const nextLine = lines[idx + 1]?.trim();
        const nextStartsWithCapital = nextLine?.match(/^[A-ZÄÖÜ]/);
        
        if (endsWithSentence && (!nextLine || nextStartsWithCapital)) {
          // Mindestlänge prüfen
          if (currentChunk.length >= 50) {
            paragraphs.push(currentChunk);
            currentChunk = '';
          }
        }
      });
      
      // Rest hinzufügen
      if (currentChunk.trim()) {
        paragraphs.push(currentChunk.trim());
      }
    });
    
    return paragraphs.filter(p => p.length > 0);
  }


  // === Message Handler ===
  handleMessage(request, sender, sendResponse) {
    switch (request.action) {
      case 'GET_SELECTION':
        sendResponse({ text: window.getSelection().toString().trim() });
        break;

      case 'SHOW_TRANSLATION':
        this.showTooltip(request.original, request.translated, request.alternatives);
        sendResponse({ success: true });
        break;

      case 'SHOW_ERROR':
        this.showNotification(request.message, 'error');
        sendResponse({ success: true });
        break;

      case 'TRANSLATE_PAGE':
        this.translatePage(request.mode || 'replace');
        sendResponse({ success: true });
        break;

      case 'RESTORE_PAGE':
        this.restorePage();
        sendResponse({ success: true });
        break;

      case 'TOGGLE_TRANSLATION':
        this.toggleTranslation();
        sendResponse({ success: true });
        break;

      case 'EXPORT_PDF':
        if (!this._exportLock) {
          this._exportLock = true;
          this.exportAsPdf(request.simplified);
          setTimeout(() => this._exportLock = false, 500);
        }
        sendResponse({ success: true });
        break;

      case 'EXPORT_MARKDOWN':
        if (!this._exportLock) {
          this._exportLock = true;
          this.exportAsMarkdown();
          setTimeout(() => this._exportLock = false, 500);
        }
        sendResponse({ success: true });
        break;

      case 'EXPORT_TEXT':
        if (!this._exportLock) {
          this._exportLock = true;
          this.exportAsText();
          setTimeout(() => this._exportLock = false, 500);
        }
        sendResponse({ success: true });
        break;

      case 'LOAD_CACHED_TRANSLATION':
        this.loadCachedTranslation().then(loaded => {
          sendResponse({ success: loaded });
        });
        return true; // Async response
        break;

      case 'GET_CACHE_INFO':
        sendResponse({
          size: this.getCacheSize(),
          entries: this.getCacheInfo(),
          currentPageHasCache: this.hasValidCache()
        });
        break;

      case 'CLEAR_CACHE':
        this.clearCache(request.key).then(() => {
          sendResponse({ success: true });
        }).catch(e => {
          console.warn('[SWT] clearCache Fehler:', e);
          sendResponse({ success: false, error: e.message });
        });
        return true; // Async response

      case 'GET_PAGE_INFO':
        // Schnelle synchrone Antwort - keine teuren Berechnungen
        // serverCacheCount wird aus dem beim Seitenload gesetzten Wert genommen
        // remaining = geplante Nodes - übersetzte Nodes (für "Fortsetzen")
        const remaining = this._plannedNodes 
          ? Math.max(0, this._plannedNodes - this.originalTexts.size)
          : 0;
        sendResponse({
          isTranslated: this.isTranslated,
          mode: this.translationMode,
          count: this.originalTexts.size,
          plannedNodes: this._plannedNodes || 0,
          remaining: remaining,
          hasCache: this.hasValidCache(),
          serverCacheCount: this._serverCacheCount || 0,
          cacheProgress: this._cacheProgress || 0
        });
        break;

      case 'TRANSLATE_WORD_AT_CURSOR':
        this.translateWordAtPosition(request.x, request.y);
        sendResponse({ success: true });
        break;

      case 'updateEbookDomains':
        // E-Book-Reader-Domains dynamisch aktualisieren
        if (typeof DomainStrategies !== 'undefined' && 
            DomainStrategies.strategies.ebook) {
          DomainStrategies.strategies.ebook.ebookDomains = request.domains || [];
          console.log('[SWT] E-Book-Domains aktualisiert:', request.domains);
        }
        sendResponse({ success: true });
        break;

      default:
        sendResponse({ success: false });
    }
  }

  // Wort an Position übersetzen (für Rechtsklick ohne Markierung)
  async translateWordAtPosition(x, y) {
    const element = document.elementFromPoint(x, y);
    if (!element) return;

    // Finde das Wort an der Position
    const range = document.caretRangeFromPoint(x, y);
    if (!range) return;

    const textNode = range.startContainer;
    if (textNode.nodeType !== Node.TEXT_NODE) return;

    const text = textNode.textContent;
    const offset = range.startOffset;

    // Wortgrenzen finden
    let start = offset;
    let end = offset;

    // Nach links
    while (start > 0 && /\w/.test(text[start - 1])) start--;
    // Nach rechts
    while (end < text.length && /\w/.test(text[end])) end++;

    const word = text.substring(start, end).trim();
    if (!word || word.length < 2) return;

    // Position für Tooltip
    const rect = element.getBoundingClientRect();
    const savedPosition = {
      top: rect.bottom + window.scrollY + 10,
      left: x
    };

    // Übersetzen
    await this.translateSelection(word, savedPosition);
  }
}

// Initialisieren
if (!window.swtInstance) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (!window.swtInstance) {
        window.swtInstance = new SmartTranslator();
      }
    });
  } else {
    window.swtInstance = new SmartTranslator();
  }
}

// === DIAGNOSE === (nach Instanziierung und Sub-Modul-Laden)
