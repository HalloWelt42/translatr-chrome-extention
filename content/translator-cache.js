// Content Cache Module - Smart Web Translator v3.12.0
// Cache-Verwaltung für Übersetzungen (Lokal + Server)
// v3.12.0: Abstrakte Cache-Löschung mit SWT.Cache.clearCache()
// v3.11.2: Bereinigung - deprecated Funktionen entfernt, konsistente Keys

(function() {
  'use strict';

  // Guard gegen doppeltes Laden
  if (window.__swtCacheLoaded) return;
  window.__swtCacheLoaded = true;

  if (typeof SmartTranslator === 'undefined') {
    console.warn('SmartTranslator nicht gefunden - content-cache.js muss nach content.js geladen werden');
    return;
  }

  /**
   * Prüft auf gecachte Übersetzung für aktuelle Seite
   * Nutzt die abstrakte Cache-API
   */
  SmartTranslator.prototype.checkForCachedTranslation = async function() {
    if (!chrome.runtime?.id) return; // Extension-Kontext ungültig
    try {
    // WICHTIG: URL-Konsistenz prüfen
    if (this.pageUrl !== window.location.href) {
      this.pageUrl = window.location.href;
      this.cacheKey = this.generateCacheKey();
    }
    
    // Auf Cache-API warten
    if (SWT.Cache?.waitForReady) {
      await SWT.Cache.waitForReady();
    }
    let sampleTexts = [];
    const isPlainText = typeof this.detectPlainTextPage === 'function' && this.detectPlainTextPage();

    if (isPlainText) {
      const preElements = document.querySelectorAll('pre');
      preElements.forEach(pre => {
        const text = pre.textContent || '';
        const paragraphs = typeof this.splitIntoParagraphs === 'function'
          ? this.splitIntoParagraphs(text) : text.split(/\n\s*\n/).filter(t => t.trim());
        sampleTexts.push(...paragraphs.slice(0, 20));
      });
      sampleTexts = sampleTexts.filter(t => t.length >= 10);
    } else {
      const textNodes = this.findTranslatableTextNodes();
      sampleTexts = textNodes.slice(0, 50).map(n => n.textContent.trim()).filter(t => t.length >= 2);
    }
    
    if (sampleTexts.length === 0) {
      // Retry nach 500ms -- Seite war evtl. noch nicht fertig gerendert
      if (!this._cacheCheckRetried) {
        this._cacheCheckRetried = true;
        await new Promise(r => setTimeout(r, 500));
        return this.checkForCachedTranslation();
      }
      this.setCacheAvailable(false);
      return;
    }
    
    // Cache-Key Debug
    const currentUrl = window.location.href;
    
    // Cache prüfen - WICHTIG: aktuelle URL verwenden!
    const cacheResult = await SWT.Cache.checkCache(
      currentUrl,
      this.cacheKey,
      { sourceLang: this.settings.sourceLang, targetLang: this.settings.targetLang },
      sampleTexts
    );
    
    if (cacheResult.hasCache) {
      // Cache-Status setzen
      this.setCacheAvailable(true, cacheResult.source, cacheResult.count || 0);

      if (this.settings.autoLoadCache) {
        await this.loadCachedTranslation();
      } else {
        this.showCacheIndicator(cacheResult.source, cacheResult.count, sampleTexts.length);
      }
      return;
    }

    this.setCacheAvailable(false);
    } catch (e) {
      if (!String(e).includes('invalidated')) console.warn('[SWT] Cache-Check:', e.message);
    }
  };

  /**
   * Cache-Indikator anzeigen
   * @param {string} source - 'local' oder 'server'
   * @param {number} count - Anzahl gecachter Texte
   * @param {number} total - Gesamtanzahl (optional, für Server)
   */
  SmartTranslator.prototype.showCacheIndicator = function(source = 'local', count = 0, total = 0) {
    if (this.cacheIndicator) return;

    this.cacheIndicator = document.createElement('div');
    this.cacheIndicator.className = 'swt-ui swt-cache-indicator';
    this.cacheIndicator.innerHTML = `
      ${SWT.Icons.svg('translate')}
      <span>Übersetzung verfügbar</span>
    `;

    const self = this;
    this.cacheIndicator.addEventListener('click', () => {
      self.loadCachedTranslation();
      self.hideCacheIndicator();
    });

    document.body.appendChild(this.cacheIndicator);

    requestAnimationFrame(() => {
      this.cacheIndicator?.classList.add('swt-visible');
    });

    setTimeout(() => {
      this.hideCacheIndicator();
    }, 10000);
  };

  /**
   * Cache-Indikator verstecken
   */
  SmartTranslator.prototype.hideCacheIndicator = function() {
    if (this.cacheIndicator) {
      this.cacheIndicator.classList.remove('swt-visible');
      const indicator = this.cacheIndicator;
      setTimeout(() => {
        indicator?.remove();
        if (this.cacheIndicator === indicator) {
          this.cacheIndicator = null;
        }
      }, 300);
    }
  };

  /**
   * Übersetzungen im lokalen Cache speichern
   * Nur wenn mode nicht 'server-only' ist
   */
  SmartTranslator.prototype.saveToCache = function(translations) {
    // Bei server-only: kein localStorage
    if (SWT.CacheServer?.config?.mode === 'server-only') {
      return;
    }
    
    try {
      const data = {
        url: this.pageUrl,
        timestamp: Date.now(),
        targetLang: this.settings.targetLang,
        translations: translations
      };
      localStorage.setItem(this.cacheKey, JSON.stringify(data));
    } catch (e) {
      console.warn('Cache save error:', e);
    }
  };

  /**
   * Lädt gecachte Übersetzungen (lokal oder Server)
   * Nutzt die abstrakte Cache-API
   */
  SmartTranslator.prototype.loadCachedTranslation = async function() {
    // URL-Konsistenz prüfen
    const currentUrl = window.location.href;
    if (this.pageUrl !== currentUrl) {
      return false;
    }
    
    try {
      // Texte der Seite sammeln
      const textNodes = this.findTranslatableTextNodes();
      const allTexts = textNodes.map(n => n.textContent.trim()).filter(t => t.length >= 2);
      
      if (allTexts.length === 0) {
        return false;
      }
      
      // Übersetzungen aus Cache laden (lokal oder Server)
      const result = await SWT.Cache.loadTranslations(
        currentUrl,  // WICHTIG: Aktuelle URL verwenden!
        this.cacheKey,
        { sourceLang: this.settings.sourceLang, targetLang: this.settings.targetLang },
        allTexts
      );
      
      if (result.translations.size === 0) {
        this.showNotification('Kein Cache gefunden', 'info');
        return false;
      }
      
      // Übersetzungen anwenden
      let applied = 0;
      textNodes.forEach(node => {
        const originalText = node.textContent.trim();
        const translatedText = result.translations.get(originalText);
        
        if (translatedText && translatedText !== originalText) {
          this.originalTexts.set(node, {
            text: originalText,
            element: node.parentElement
          });
          this.translatedTexts.set(node, translatedText);
          this.wrapWithHoverOriginal(node, originalText, translatedText);
          applied++;
        }
      });
      
      if (applied > 0) {
        this.isTranslated = true;
        this.translationMode = 'replace';
        this.notifyStatusChange();

        const sourceText = result.source === 'server' ? 'Server-Cache' : 'Lokalem Cache';
        this.showNotification(`${applied} von ${allTexts.length} Texten geladen`, 'success');
        return true;
      }
      
      return false;
    } catch (e) {
      console.warn('[SWT] Cache load error:', e);
      return false;
    }
  };

  /**
   * Gesamt-Cache-Größe berechnen (nur localStorage)
   */
  SmartTranslator.prototype.getCacheSize = function() {
    // Bei server-only: kein localStorage
    if (SWT.CacheServer?.config?.mode === 'server-only') {
      return 0;
    }
    
    let totalSize = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('swt_cache_')) {
        const value = localStorage.getItem(key);
        totalSize += (key.length + (value?.length || 0)) * 2;
      }
    }
    return totalSize;
  };

  /**
   * Cache-Einträge auflisten (nur localStorage)
   */
  SmartTranslator.prototype.getCacheInfo = function() {
    // Bei server-only: keine localStorage-Einträge
    if (SWT.CacheServer?.config?.mode === 'server-only') {
      return [];
    }
    
    const entries = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('swt_cache_')) {
        try {
          const data = JSON.parse(localStorage.getItem(key));
          const translationCount = Object.keys(data.translations || {}).length;
          if (translationCount > 0) {
            entries.push({
              key,
              url: data.url,
              timestamp: data.timestamp,
              size: (key.length + JSON.stringify(data).length) * 2,
              count: translationCount
            });
          }
        } catch (e) {}
      }
    }
    return entries.sort((a, b) => b.timestamp - a.timestamp);
  };

  /**
   * Prüft ob aktuelle Seite gültigen lokalen Cache hat
   */
  /**
   * Prüft ob gültiger Cache vorhanden ist
   * Nutzt den beim Seitenlade gesetzten Status
   */
  SmartTranslator.prototype.hasValidCache = function() {
    // Wenn beim Seitenlade Cache gefunden wurde
    if (this._cacheAvailable) {
      return true;
    }
    
    // Fallback: Lokalen Cache prüfen (wenn nicht server-only)
    const mode = SWT.Cache?.config?.mode || SWT.CacheServer?.config?.mode || 'server-only';
    if (mode === 'server-only') {
      return false;
    }
    
    try {
      const cached = localStorage.getItem(this.cacheKey);
      if (!cached) return false;
      
      const data = JSON.parse(cached);
      return data && data.translations && Object.keys(data.translations).length > 0;
    } catch (e) {
      return false;
    }
  };
  
  /**
   * Berechnet wie viel Prozent der Seite bereits im Cache sind
   * @returns {Promise<number>} 0-100
   */
  SmartTranslator.prototype.calculateCacheProgress = async function() {
    try {
      // Alle übersetzbaren Texte sammeln
      const strategy = this.getActiveStrategy?.();
      
      const nodes = this.findTranslatableTextNodes();
      const totalTexts = nodes.map(n => n.textContent?.trim()).filter(t => t && t.length >= 2);
      
      if (totalTexts.length === 0) {
        return 0;
      }
      
      // Cache-Einträge für diese Seite abrufen
      const settings = await chrome.storage.sync.get(['sourceLang', 'targetLang']);
      const source = settings.sourceLang || 'auto';
      const target = settings.targetLang || 'de';
      
      // Nur Cache abfragen (cacheOnly)
      const cacheResult = await chrome.runtime.sendMessage({
        action: 'TRANSLATE_BATCH',
        texts: totalTexts.slice(0, 500), // Limit für Performance
        source,
        target,
        pageUrl: window.location.href,
        cacheOnly: true
      });
      
      if (!cacheResult.success || !cacheResult.items) {
        return 0;
      }
      
      // Zähle Cache-Hits
      const cacheHits = cacheResult.items.filter(item => 
        item.fromCache && item.translation !== item.original
      ).length;
      
      // Prozent berechnen (auf Basis der abgefragten Texte)
      const queriedCount = Math.min(totalTexts.length, 500);
      const progress = Math.round((cacheHits / queriedCount) * 100);
      
      return progress;
      
    } catch (e) {
      console.warn('[SWT] Cache-Progress Fehler:', e);
      return 0;
    }
  };
  
  /**
   * Setzt den Cache-Verfügbarkeits-Status
   * Wird von checkForCachedTranslation aufgerufen
   */
  SmartTranslator.prototype.setCacheAvailable = function(available, source = null, count = 0) {
    this._cacheAvailable = available;
    this._cacheSource = source; // 'local' oder 'server'
    this._serverCacheCount = count; // Anzahl Einträge im Cache
    this.notifyStatusChange();
  };

  /**
   * Cache löschen (einzeln oder komplett)
   * Respektiert Cache-Modus
   */
  /**
   * Cache löschen (lokal und/oder Server)
   * @param {string|null} key - Spezifischer localStorage-Key oder null für aktuelle Seite
   */
  SmartTranslator.prototype.clearCache = async function(key = null) {
    const options = {
      scope: key ? 'page' : 'page',  // Immer Seiten-Scope
      pageUrl: window.location.href,
      cacheKey: key || this.cacheKey
    };
    
    const results = await SWT.Cache.clearCache(options);

    // Cache-Status zurücksetzen
    this.setCacheAvailable(false);
    
    return results;
  };

})();
