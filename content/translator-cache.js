// Content Cache
// Cache-Verwaltung für Übersetzungen (Lokal + Server)

(function() {
  'use strict';

  // Guard gegen doppeltes Laden
  if (window._smtCacheLoaded) return;
  window._smtCacheLoaded = true;

  if (typeof SmartTranslator === 'undefined') {
    console.warn('SmartTranslator nicht gefunden - content-cache.js muss nach content.js geladen werden');
    return;
  }

  /**
   * Prüft auf gecachte Übersetzung für aktuelle Seite
   * Nutzt die abstrakte Cache-API
   */
  SmartTranslator.prototype.checkForCachedTranslation = async function() {
    console.log('[SWT] checkForCachedTranslation gestartet...');
    console.log('[SWT] Current URL:', window.location.href);
    console.log('[SWT] this.pageUrl:', this.pageUrl);
    console.log('[SWT] this.isTranslated:', this.isTranslated);
    console.log('[SWT] Settings - sourceLang:', this.settings.sourceLang, 'targetLang:', this.settings.targetLang);
    
    // WICHTIG: URL-Konsistenz prüfen
    if (this.pageUrl !== window.location.href) {
      console.log('[SWT] URL Mismatch in checkForCachedTranslation! Aktualisiere...');
      this.pageUrl = window.location.href;
      this.cacheKey = this.generateCacheKey();
    }
    
    // Auf Cache-API warten
    if (SMT.Cache?.waitForReady) {
      await SMT.Cache.waitForReady();
    }
    console.log('[SWT] Cache-API ready, mode:', SMT.Cache?.config?.mode);
    
    // Strategie und Seitentyp erkennen
    const strategy = this.getActiveStrategy?.();
    console.log('[SWT] checkForCachedTranslation - Strategie:', strategy?.name || 'keine', 'usesIframeContent:', strategy?.usesIframeContent);
    
    const isEbook = strategy?.name === 'E-Book Reader';
    const isPlainText = strategy?.name === 'Plain Text' || this.detectPlainTextPage();
    
    let sampleTexts = [];
    
    if (isEbook) {
      // E-Book: Block-Elemente als Stichprobe
      console.log('[SWT E-Book] Cache-Check mit Block-Elementen');
      const blocks = this.findTranslatableBlockElements();
      sampleTexts = blocks.slice(0, 20).map(b => b.text).filter(t => t.length >= 10);
      console.log('[SWT E-Book] Sample-Texte für Cache:', sampleTexts.length);
      if (sampleTexts.length > 0) {
        console.log('[SWT E-Book] Erster Sample:', sampleTexts[0].substring(0, 60));
      }
    } else if (isPlainText) {
      // Plain-Text: Absätze aus <pre> extrahieren
      console.log('[SWT PlainText] Cache-Check mit Pre-Elementen');
      const preElements = document.querySelectorAll('pre');
      preElements.forEach(pre => {
        const text = pre.textContent || '';
        const paragraphs = this.splitIntoParagraphs(text);
        sampleTexts.push(...paragraphs.slice(0, 20));
      });
      sampleTexts = sampleTexts.filter(t => t.length >= 10);
      console.log('[SWT PlainText] Sample-Texte für Cache:', sampleTexts.length);
      if (sampleTexts.length > 0) {
        console.log('[SWT PlainText] Erster Sample:', sampleTexts[0].substring(0, 60));
      }
    } else {
      // Standard: Text-Nodes als Stichprobe
      console.log('[SWT] Standard Cache-Check mit Text-Nodes');
      const textNodes = this.findTranslatableTextNodes();
      sampleTexts = textNodes.slice(0, 50).map(n => n.textContent.trim()).filter(t => t.length >= 2);
      console.log('[SWT] Gefundene Sample-Texte:', sampleTexts.length);
    }
    
    if (sampleTexts.length === 0) {
      console.log('[SWT] Keine Sample-Texte gefunden, kein Cache-Check');
      this.setCacheAvailable(false);
      this.checkAutoTranslateDomain();
      return;
    }
    
    // Cache-Key Debug
    const currentUrl = window.location.href;
    console.log('[SWT] Cache-Check mit Key:', this.cacheKey);
    console.log('[SWT] URL für Cache:', currentUrl);
    
    // Cache prüfen - WICHTIG: aktuelle URL verwenden!
    const cacheResult = await SMT.Cache.checkCache(
      currentUrl,
      this.cacheKey,
      { sourceLang: this.settings.sourceLang, targetLang: this.settings.targetLang },
      sampleTexts
    );
    
    console.log('[SWT] Cache check result:', cacheResult);
    
    if (cacheResult.hasCache) {
      // Für E-Books: Zusätzliche Validierung - stimmen die Texte überein?
      if (isEbook && cacheResult.matchedTexts) {
        const matchRatio = cacheResult.matchedTexts / sampleTexts.length;
        console.log('[SWT E-Book] Cache Match-Ratio:', matchRatio);
        
        // Nur wenn mindestens 30% der Texte übereinstimmen
        if (matchRatio < 0.3) {
          console.log('[SWT E-Book] Cache ungültig (zu wenig Übereinstimmung)');
          this.setCacheAvailable(false);
          this.checkAutoTranslateDomain();
          return;
        }
      }
      
      // Cache-Status setzen für UI (mit Anzahl)
      this.setCacheAvailable(true, cacheResult.source, cacheResult.count || 0);
      
      if (this.settings.autoLoadCache) {
        // Automatisch laden (nur wenn explizit aktiviert)
        await this.loadCachedTranslation();
      } else {
        // Nur Indikator anzeigen - NICHT automatisch laden!
        this.showCacheIndicator(cacheResult.source, cacheResult.count, sampleTexts.length);
      }
      return; // Cache gefunden, nicht auto-translate
    }
    
    // Kein Cache gefunden
    this.setCacheAvailable(false);
    
    // Auto-Translate Domain prüfen
    this.checkAutoTranslateDomain();
  };

  /**
   * Prüft ob aktuelle Domain automatisch übersetzt werden soll
   */
  SmartTranslator.prototype.checkAutoTranslateDomain = async function() {
    const hostname = window.location.hostname.toLowerCase();
    const domains = this.settings.autoTranslateDomains || [];
    
    if (domains.some(d => hostname === d || hostname.endsWith('.' + d))) {
      if (!this.isTranslated) {
        setTimeout(() => {
          if (!this.isTranslated) {
            this.translatePage('replace');
          }
        }, 1000);
      }
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

    const isServer = source === 'server';
    const label = isServer 
      ? `Server-Cache: ${count}/${total} Texte`
      : 'Übersetzung verfügbar';

    this.cacheIndicator = document.createElement('div');
    this.cacheIndicator.className = 'smt-ui smt-cache-indicator';
    this.cacheIndicator.innerHTML = `
      ${SMT.Icons.svg('translate')}
      <span>${label}</span>
    `;
    this.cacheIndicator.title = isServer 
      ? 'Klicken zum Übersetzen (nutzt Server-Cache)'
      : 'Gecachte Übersetzung für diese Seite verfügbar';

    const self = this;
    this.cacheIndicator.addEventListener('click', () => {
      if (isServer) {
        // Server-Cache: Seite übersetzen (Bulk-Check holt gecachte)
        self.translatePage('replace');
      } else {
        // Lokaler Cache: Direkt laden
        self.loadCachedTranslation();
      }
      self.hideCacheIndicator();
    });

    document.body.appendChild(this.cacheIndicator);

    requestAnimationFrame(() => {
      this.cacheIndicator?.classList.add('smt-visible');
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
      this.cacheIndicator.classList.remove('smt-visible');
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
    if (SMT.CacheServer?.config?.mode === 'server-only') {
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
    console.log('[SWT Cache] loadCachedTranslation gestartet');
    console.log('[SWT Cache] window.location.href:', window.location.href);
    console.log('[SWT Cache] this.pageUrl:', this.pageUrl);
    
    // URL-Konsistenz prüfen
    const currentUrl = window.location.href;
    if (this.pageUrl !== currentUrl) {
      console.log('[SWT Cache] URL Mismatch! Abbruch.');
      return false;
    }
    
    try {
      // Texte der Seite sammeln
      const textNodes = this.findTranslatableTextNodes();
      const allTexts = textNodes.map(n => n.textContent.trim()).filter(t => t.length >= 2);
      
      if (allTexts.length === 0) {
        console.log('[SWT Cache] Keine Texte gefunden');
        return false;
      }
      
      console.log('[SWT Cache] Lade Übersetzungen für', allTexts.length, 'Texte');
      console.log('[SWT Cache] Erster Text:', allTexts[0]?.substring(0, 50));
      
      // Übersetzungen aus Cache laden (lokal oder Server)
      const result = await SMT.Cache.loadTranslations(
        currentUrl,  // WICHTIG: Aktuelle URL verwenden!
        this.cacheKey,
        { sourceLang: this.settings.sourceLang, targetLang: this.settings.targetLang },
        allTexts
      );
      
      if (result.translations.size === 0) {
        console.log('[SWT Cache] Keine Übersetzungen im Cache gefunden');
        this.showNotification('Kein Cache gefunden', 'info');
        return false;
      }
      
      console.log('[SWT Cache] Cache enthält', result.translations.size, 'Übersetzungen');
      
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
      
      const coveragePercent = Math.round((applied / allTexts.length) * 100);
      console.log(`[SWT Cache] ${applied} von ${allTexts.length} Texten aus Cache (${coveragePercent}%)`);
      
      if (applied > 0) {
        // Nur als "übersetzt" markieren wenn mindestens 50% abgedeckt
        // Bei weniger: Teilübersetzung, User sollte nochmal "Übersetzen" klicken können
        if (coveragePercent >= 50) {
          this.isTranslated = true;
          this.translationMode = 'replace';
          this.notifyStatusChange();
          console.log('[SWT Cache] isTranslated = true (>= 50%)');
        } else {
          console.log('[SWT Cache] Nur teilweise gecacht, isTranslated bleibt false');
        }
        
        const sourceText = result.source === 'server' ? 'Server-Cache' : 'Lokalem Cache';
        this.showNotification(`${applied} Übersetzungen aus ${sourceText} geladen (${coveragePercent}%)`, 'success');
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
    if (SMT.CacheServer?.config?.mode === 'server-only') {
      return 0;
    }
    
    let totalSize = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('smt_cache_')) {
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
    if (SMT.CacheServer?.config?.mode === 'server-only') {
      return [];
    }
    
    const entries = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('smt_cache_')) {
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
    const mode = SMT.Cache?.config?.mode || SMT.CacheServer?.config?.mode || 'server-only';
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
      const isEbook = strategy?.name === 'E-Book Reader';
      
      let totalTexts = [];
      
      if (isEbook) {
        // E-Book: Block-Elemente
        const blocks = this.findTranslatableBlockElements();
        totalTexts = blocks.map(b => b.text).filter(t => t && t.length >= 2);
      } else {
        // Normal: Text-Nodes
        const nodes = this.findTranslatableTextNodes();
        totalTexts = nodes.map(n => n.textContent?.trim()).filter(t => t && t.length >= 2);
      }
      
      if (totalTexts.length === 0) {
        return 0;
      }
      
      // Cache-Einträge für diese Seite abrufen
      const settings = await chrome.storage.sync.get(['sourceLang', 'targetLang']);
      const source = settings.sourceLang || 'auto';
      const target = settings.targetLang || 'de';
      
      // Nur Cache abfragen (cacheOnly)
      const cacheResult = await chrome.runtime.sendMessage({
        action: 'translateBatch',
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
      
      console.log(`[SWT] Cache-Progress: ${cacheHits}/${queriedCount} = ${progress}%`);
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
    
    const results = await SMT.Cache.clearCache(options);
    console.log('[SWT] Cache gelöscht:', results);
    
    // Cache-Status zurücksetzen
    this.setCacheAvailable(false);
    
    return results;
  };

})();
