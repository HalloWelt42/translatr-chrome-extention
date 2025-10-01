/**
 * Smart Web Translator - Unified Cache API
 * Version: 1.0.0
 * 
 * Abstrakte Cache-Schicht die localStorage und Server-Cache kapselt.
 * Die Implementierung wählt automatisch basierend auf Konfiguration.
 * 
 * Modi:
 * - 'local-only': Nur localStorage
 * - 'server-only': Nur Server-Cache
 * - 'both': Server bevorzugt, localStorage als Fallback
 */

window.SMT = window.SMT || {};

SMT.Cache = {
  // Konfiguration
  config: {
    mode: 'server-only',  // 'local-only', 'server-only', 'both'
    enabled: true
  },
  
  // Initialisierung
  _initPromise: null,
  _ready: false,
  
  /**
   * Initialisiert das Cache-Modul
   */
  async init() {
    if (this._initPromise) return this._initPromise;
    
    this._initPromise = (async () => {
      try {
        const stored = await chrome.storage.sync.get({
          cacheServerEnabled: true,
          cacheServerMode: 'server-only'
        });
        
        this.config.enabled = stored.cacheServerEnabled;
        this.config.mode = stored.cacheServerMode;
        
        // CacheServer auch initialisieren wenn vorhanden
        if (SMT.CacheServer?.init) {
          await SMT.CacheServer.init();
        }
        
        this._ready = true;
        console.log('[Cache] Initialisiert:', this.config.mode);
      } catch (e) {
        console.warn('[Cache] Init-Fehler:', e);
        this._ready = true;
      }
    })();
    
    return this._initPromise;
  },
  
  /**
   * Wartet auf Initialisierung
   */
  async waitForReady() {
    if (this._ready) return;
    await this.init();
  },
  
  // ==========================================================================
  // ABSTRAKTE CACHE-METHODEN
  // ==========================================================================
  
  /**
   * Prüft ob Cache für aktuelle Seite vorhanden ist
   * @param {string} pageUrl - URL der Seite
   * @param {string} cacheKey - localStorage Key (für lokalen Cache)
   * @param {Object} settings - Sprach-Einstellungen {sourceLang, targetLang}
   * @param {Array} sampleTexts - Stichprobe von Texten zum Prüfen
   * @returns {Object} { hasCache: boolean, source: 'local'|'server'|null, count: number, percentage: number }
   */
  async checkCache(pageUrl, cacheKey, settings, sampleTexts) {
    await this.waitForReady();
    
    console.log('[Cache] checkCache aufgerufen');
    console.log('[Cache] config.enabled:', this.config.enabled, 'mode:', this.config.mode);
    
    if (!this.config.enabled) {
      console.log('[Cache] Cache ist deaktiviert!');
      return { hasCache: false, source: null, count: 0, percentage: 0 };
    }
    
    const mode = this.config.mode;
    
    // 1. Lokalen Cache prüfen (wenn nicht server-only)
    if (mode !== 'server-only') {
      console.log('[Cache] Prüfe lokalen Cache...');
      const localResult = this._checkLocalCache(cacheKey);
      if (localResult.hasCache) {
        console.log('[Cache] Lokaler Cache gefunden!');
        return { ...localResult, source: 'local' };
      }
    }
    
    // 2. Server-Cache prüfen (wenn nicht local-only)
    if (mode !== 'local-only' && sampleTexts?.length > 0) {
      console.log('[Cache] Prüfe Server-Cache...');
      const serverResult = await this._checkServerCache(pageUrl, settings, sampleTexts);
      if (serverResult.hasCache) {
        console.log('[Cache] Server-Cache gefunden!');
        return { ...serverResult, source: 'server' };
      }
      console.log('[Cache] Kein Server-Cache gefunden');
    }
    
    console.log('[Cache] Kein Cache gefunden');
    return { hasCache: false, source: null, count: 0, percentage: 0 };
  },
  
  /**
   * Lädt alle Cache-Einträge für eine Seite
   * @param {string} pageUrl - URL der Seite
   * @param {string} cacheKey - localStorage Key
   * @param {Object} settings - Sprach-Einstellungen
   * @param {Array} allTexts - Alle Texte der Seite
   * @returns {Object} { translations: Map<originalText, translatedText>, source: 'local'|'server' }
   */
  async loadTranslations(pageUrl, cacheKey, settings, allTexts) {
    await this.waitForReady();
    
    const mode = this.config.mode;
    const translations = new Map();
    let source = null;
    
    // 1. Lokalen Cache laden (wenn nicht server-only)
    if (mode !== 'server-only') {
      const localData = this._loadLocalCache(cacheKey);
      if (localData && Object.keys(localData).length > 0) {
        for (const [original, translated] of Object.entries(localData)) {
          translations.set(original, translated);
        }
        source = 'local';
        
        // Bei 'local-only' hier aufhören
        if (mode === 'local-only') {
          return { translations, source };
        }
      }
    }
    
    // 2. Server-Cache laden (wenn nicht local-only)
    if (mode !== 'local-only' && allTexts?.length > 0) {
      const serverTranslations = await this._loadServerCache(pageUrl, settings, allTexts);
      if (serverTranslations.size > 0) {
        // Server-Übersetzungen haben Priorität
        for (const [original, translated] of serverTranslations) {
          translations.set(original, translated);
        }
        source = 'server';
      }
    }
    
    return { translations, source };
  },
  
  /**
   * Speichert Übersetzungen im Cache
   * @param {string} pageUrl - URL der Seite
   * @param {string} cacheKey - localStorage Key
   * @param {Object} settings - Sprach-Einstellungen
   * @param {Array} items - Array von {original, translated}
   */
  async saveTranslations(pageUrl, cacheKey, settings, items) {
    await this.waitForReady();
    
    if (!this.config.enabled || !items?.length) return;
    
    const mode = this.config.mode;
    
    // Lokal speichern (wenn nicht server-only)
    if (mode !== 'server-only') {
      this._saveLocalCache(cacheKey, pageUrl, items);
    }
    
    // Server speichern (wenn nicht local-only)
    if (mode !== 'local-only') {
      await this._saveServerCache(pageUrl, settings, items);
    }
  },
  
  /**
   * Löscht Cache
   * @param {Object} options - Lösch-Optionen
   * @param {string} options.scope - 'all' | 'page' | 'local-all' | 'server-all'
   * @param {string} options.pageUrl - URL der Seite (für scope='page')
   * @param {string} options.cacheKey - localStorage Key (für lokalen Cache)
   */
  async clearCache(options = {}) {
    await this.waitForReady();
    
    const { 
      scope = 'page', 
      pageUrl = null, 
      cacheKey = null
    } = typeof options === 'string' ? { cacheKey: options } : options;
    
    const mode = this.config.mode;
    const results = { local: null, server: null };
    
    // === LOKALER CACHE ===
    if (mode !== 'server-only') {
      if (scope === 'all' || scope === 'local-all') {
        // Alle lokalen Cache-Einträge löschen
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key?.startsWith('smt_cache_')) {
            keys.push(key);
          }
        }
        keys.forEach(k => localStorage.removeItem(k));
        results.local = { deleted: keys.length };
      } else if (scope === 'page' && cacheKey) {
        // Einzelne Seite löschen
        localStorage.removeItem(cacheKey);
        results.local = { deleted: 1 };
      }
    }
    
    // === SERVER CACHE ===
    if (mode !== 'local-only' && SMT.CacheServer?.config?.enabled) {
      if (scope === 'all' || scope === 'server-all') {
        // Server-Cache komplett löschen (braucht Admin-Endpunkt)
        try {
          const response = await chrome.runtime.sendMessage({
            action: 'cacheServerClearAll'
          });
          results.server = response?.result || { error: 'Nicht unterstützt' };
        } catch (e) {
          results.server = { error: e.message };
        }
      } else if (scope === 'page' && pageUrl) {
        // Server nutzt URL-Index - effizientes Löschen nach URL/Domain
        try {
          const response = await chrome.runtime.sendMessage({
            action: 'cacheServerDeleteByUrl',
            pageUrl: pageUrl
          });
          results.server = response?.result || { deleted: 0 };
        } catch (e) {
          results.server = { error: e.message };
        }
      }
    }
    
    return results;
  },
  
  // ==========================================================================
  // LOKALER CACHE (localStorage)
  // ==========================================================================
  
  _checkLocalCache(cacheKey) {
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const data = JSON.parse(cached);
        if (data?.translations && Object.keys(data.translations).length > 0) {
          return {
            hasCache: true,
            count: Object.keys(data.translations).length,
            percentage: 100
          };
        }
      }
    } catch (e) {
      console.warn('[Cache] Local check error:', e);
    }
    return { hasCache: false, count: 0, percentage: 0 };
  },
  
  _loadLocalCache(cacheKey) {
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const data = JSON.parse(cached);
        return data?.translations || {};
      }
    } catch (e) {
      console.warn('[Cache] Local load error:', e);
    }
    return {};
  },
  
  _saveLocalCache(cacheKey, pageUrl, items) {
    try {
      // Bestehenden Cache laden oder neu erstellen
      let data = { url: pageUrl, translations: {}, timestamp: Date.now() };
      try {
        const existing = localStorage.getItem(cacheKey);
        if (existing) {
          data = JSON.parse(existing);
        }
      } catch (e) {}
      
      // Neue Übersetzungen hinzufügen
      for (const item of items) {
        if (item.original && item.translated && item.original !== item.translated) {
          data.translations[item.original] = item.translated;
        }
      }
      
      data.timestamp = Date.now();
      localStorage.setItem(cacheKey, JSON.stringify(data));
    } catch (e) {
      console.warn('[Cache] Local save error:', e);
    }
  },
  
  // ==========================================================================
  // SERVER CACHE
  // ==========================================================================
  
  async _checkServerCache(pageUrl, settings, sampleTexts) {
    console.log('[Cache] _checkServerCache aufgerufen');
    console.log('[Cache] pageUrl:', pageUrl);
    console.log('[Cache] sampleTexts count:', sampleTexts?.length);
    if (sampleTexts?.length > 0) {
      console.log('[Cache] Erster Sample-Text:', sampleTexts[0]?.substring(0, 60));
    }
    
    if (!SMT.CacheServer?.bulkGet) {
      console.log('[Cache] SMT.CacheServer.bulkGet nicht verfügbar!');
      return { hasCache: false, count: 0, percentage: 0 };
    }
    
    try {
      const langPair = `${settings.sourceLang || 'auto'}:${settings.targetLang || 'de'}`;
      
      // E-Book-Erkennung: epubcfi im Hash
      const isEbook = pageUrl.includes('#epubcfi');
      console.log('[Cache] _checkServerCache - isEbook:', isEbook, 'langPair:', langPair);
      
      // Hashes für Stichprobe berechnen
      const hashes = [];
      for (const text of sampleTexts.slice(0, 50)) {
        if (text.length >= 2) {
          const hash = await SMT.CacheServer.computeHash(pageUrl, text, langPair, isEbook);
          hashes.push(hash);
          // Nur ersten Hash loggen
          if (hashes.length === 1) {
            console.log('[Cache] Erster Check-Hash:', hash, 'für Text:', text.substring(0, 50));
          }
        }
      }
      
      if (hashes.length === 0) {
        return { hasCache: false, count: 0, percentage: 0 };
      }
      
      // Bulk-Check mit pageUrl für url_hash
      const result = await SMT.CacheServer.bulkGet(hashes, pageUrl);
      const count = Object.keys(result.translations || {}).length;
      const percentage = Math.round((count / hashes.length) * 100);
      
      console.log('[Cache] Server-Check:', count, 'von', hashes.length, `(${percentage}%)`);
      
      return {
        hasCache: percentage >= 30,
        count,
        percentage,
        matchedTexts: count // Für E-Book-Validierung
      };
    } catch (e) {
      console.warn('[Cache] Server check error:', e);
      return { hasCache: false, count: 0, percentage: 0 };
    }
  },
  
  async _loadServerCache(pageUrl, settings, allTexts) {
    const translations = new Map();
    
    if (!SMT.CacheServer?.bulkGet) {
      return translations;
    }
    
    try {
      const langPair = `${settings.sourceLang || 'auto'}:${settings.targetLang || 'de'}`;
      
      // E-Book-Erkennung
      const isEbook = pageUrl.includes('#epubcfi');
      
      // Hashes für alle Texte berechnen (dedupliziert)
      const hashToText = new Map();
      const hashes = [];
      
      for (const text of allTexts) {
        if (text.length >= 2) {
          const hash = await SMT.CacheServer.computeHash(pageUrl, text, langPair, isEbook);
          if (!hashToText.has(hash)) {
            hashToText.set(hash, text);
            hashes.push(hash);
          }
        }
      }
      
      if (hashes.length === 0) {
        return translations;
      }
      
      // Bulk-Get mit pageUrl für url_hash
      const result = await SMT.CacheServer.bulkGet(hashes, pageUrl);
      
      // Übersetzungen in Map umwandeln
      for (const [hash, data] of Object.entries(result.translations || {})) {
        if (data.original && data.translated) {
          translations.set(data.original, data.translated);
        }
      }
      
      console.log('[Cache] Server loaded:', translations.size, 'translations');
    } catch (e) {
      console.warn('[Cache] Server load error:', e);
    }
    
    return translations;
  },
  
  async _saveServerCache(pageUrl, settings, items) {
    if (!SMT.CacheServer?.bulkStore) {
      return;
    }
    
    try {
      const langPair = `${settings.sourceLang || 'auto'}:${settings.targetLang || 'de'}`;
      
      const toStore = items
        .filter(item => item.original && item.translated && item.original !== item.translated)
        .map(item => ({
          pageUrl,
          original: item.original,
          translated: item.translated,
          langPair
        }));
      
      if (toStore.length > 0) {
        // Über Background Script speichern
        await chrome.runtime.sendMessage({
          action: 'cacheServerBulkStore',
          translations: toStore,
          langPair
        });
      }
    } catch (e) {
      console.warn('[Cache] Server save error:', e);
    }
  },
  
  // ==========================================================================
  // CACHE-INFO FÜR UI
  // ==========================================================================
  
  /**
   * Holt Cache-Informationen für Sidepanel
   * @returns {Object} { mode, localEntries, serverStats }
   */
  async getCacheInfo() {
    await this.waitForReady();
    
    const info = {
      mode: this.config.mode,
      enabled: this.config.enabled,
      localEntries: [],
      serverStats: null
    };
    
    // Lokale Einträge sammeln
    if (this.config.mode !== 'server-only') {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith('smt_cache_')) {
          try {
            const data = JSON.parse(localStorage.getItem(key));
            if (data?.translations) {
              info.localEntries.push({
                key,
                url: data.url || 'Unbekannt',
                count: Object.keys(data.translations).length,
                timestamp: data.timestamp || 0,
                size: localStorage.getItem(key).length
              });
            }
          } catch (e) {}
        }
      }
    }
    
    // Server-Stats holen
    if (this.config.mode !== 'local-only') {
      try {
        const response = await chrome.runtime.sendMessage({ action: 'getCacheServerStats' });
        if (response?.success) {
          info.serverStats = response.stats;
        }
      } catch (e) {}
    }
    
    return info;
  }
};

// Auto-Init
SMT.Cache.init();

// Bei Settings-Änderung neu initialisieren
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && (changes.cacheServerEnabled || changes.cacheServerMode)) {
    SMT.Cache._ready = false;
    SMT.Cache._initPromise = null;
    SMT.Cache.init();
  }
});
