/**
 * Smart Web Translator - Cache Server Integration
 * Version: 1.3.0
 * 
 * Kommuniziert mit SWT Cache Server (FastAPI)
 * API: http://192.168.178.49:8083/
 * 
 * v1.3.0: Base64-Encoding, Mixed-Content-Fix (Requests über Background)
 * v1.2.0: Ready-Promise für async Init, langPair konsistent
 * v1.1.0: Hash mit Sprachrichtung (langPair)
 */

window.SMT = window.SMT || {};

SMT.CacheServer = {
  // Konfiguration (wird aus chrome.storage geladen)
  config: {
    enabled: true,  // Default: aktiviert
    serverUrl: 'http://192.168.178.49:8083',
    mode: 'server-only', // server-only als Default (localStorage nur Notlösung)
    timeout: 5000,
    translator: 'unknown'
  },
  
  // Ready-Promise für async Init
  _initPromise: null,
  _ready: false,

  /**
   * Initialisiert das Modul mit gespeicherten Einstellungen
   * Gibt Promise zurück, die resolved wenn fertig
   */
  async init() {
    if (this._initPromise) return this._initPromise;
    
    this._initPromise = (async () => {
      try {
        const stored = await chrome.storage.sync.get({
          cacheServerEnabled: true,  // Default: aktiviert
          cacheServerUrl: 'http://192.168.178.49:8083',
          cacheServerMode: 'server-only',  // Default: nur Server
          cacheServerTimeout: 5000
        });
        
        this.config.enabled = stored.cacheServerEnabled;
        this.config.serverUrl = stored.cacheServerUrl.replace(/\/$/, ''); // trailing slash entfernen
        this.config.mode = stored.cacheServerMode;
        this.config.timeout = stored.cacheServerTimeout;
        
        // Translator-ID aus API-Einstellungen
        const apiSettings = await chrome.storage.sync.get({
          apiType: 'libretranslate',
          lmStudioModel: ''
        });
        this.config.translator = this._buildTranslatorId(apiSettings);
        
        this._ready = true;
      } catch (e) {
        console.warn('[CacheServer] Init-Fehler:', e);
        this._ready = true; // Trotzdem ready markieren, mit Defaults
      }
    })();
    
    return this._initPromise;
  },
  
  /**
   * Wartet bis Init abgeschlossen
   */
  async waitForReady() {
    if (this._ready) return;
    await this.init();
  },

  /**
   * Baut Translator-ID aus Einstellungen
   */
  _buildTranslatorId(settings) {
    if (settings.apiType === 'lmstudio' && settings.lmStudioModel) {
      return `lmstudio:${settings.lmStudioModel}`;
    }
    return settings.apiType || 'unknown';
  },

  // ==========================================================================
  // HASH-BERECHNUNG (identisch zum Server)
  // ==========================================================================

  /**
   * Berechnet SHA-256 Hash
   * Format: URL + Original-Text + Sprachrichtung (z.B. "en:de")
   */
  async computeHash(pageUrl, text, langPair = null, includeHash = false) {
    // URL normalisieren
    const url = new URL(pageUrl);
    
    // Für E-Books (epubcfi): Nur Spine-Pfad (vor !) verwenden
    // Für normale Seiten: Hash ignorieren (Anchor-Links)
    let normalizedUrl;
    if (includeHash && url.hash && url.hash.includes('epubcfi')) {
      // epubcfi(/6/14!/...) → nur /6/14 verwenden (= Kapitel)
      const match = url.hash.match(/epubcfi\(([^!]+)!/);
      if (match) {
        const spinePath = match[1];
        normalizedUrl = url.origin + url.pathname + '#epubcfi(' + spinePath + ')';
        console.log('[SWT Cache] E-Book Kapitel-URL:', normalizedUrl);
      } else {
        // Fallback: kompletten Hash verwenden
        normalizedUrl = url.origin + url.pathname + url.hash;
      }
    } else {
      // Normal: Ohne Hash
      normalizedUrl = url.origin + url.pathname;
    }
    
    // Sprachrichtung hinzufügen
    const langSuffix = langPair ? `:${langPair}` : '';
    
    // Hash aus URL + Text + Sprachrichtung
    const content = normalizedUrl + text + langSuffix;
    
    // SHA-256 via Web Crypto API
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    
    // Buffer zu Hex-String
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    return hashHex;
  },

  // ==========================================================================
  // API-KOMMUNIKATION
  // ==========================================================================

  /**
   * Fetch mit Timeout
   */
  async _fetch(url, options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);
    
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      return response;
    } catch (e) {
      clearTimeout(timeoutId);
      if (e.name === 'AbortError') {
        throw new Error('Timeout');
      }
      throw e;
    }
  },

  /**
   * Text für Cache als Base64 codieren
   */
  _encodeText(text) {
    return btoa(unescape(encodeURIComponent(text)));
  },
  
  /**
   * Text aus Cache von Base64 decodieren
   */
  _decodeText(base64) {
    return decodeURIComponent(escape(atob(base64)));
  },

  /**
   * Prüft Server-Erreichbarkeit
   */
  async checkHealth() {
    if (!this.config.enabled) return { ok: false, reason: 'disabled' };
    
    try {
      const response = await this._fetch(`${this.config.serverUrl}/health`);
      if (response.ok) {
        const data = await response.json();
        return { ok: true, data };
      }
      return { ok: false, reason: 'unhealthy', status: response.status };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  },

  // ==========================================================================
  // SINGLE TRANSLATION
  // ==========================================================================

  /**
   * Holt eine Übersetzung aus dem Server-Cache
   * Neue API: GET /cache/{hash} gibt 3 Zeilen Plain-Text zurück (base64)
   * @returns {Object|null} { original, translated, timestamp } oder null
   */
  async get(hash) {
    if (!this.config.enabled) return null;
    
    try {
      const response = await this._fetch(`${this.config.serverUrl}/cache/${hash}`);
      
      if (response.ok) {
        const text = await response.text();
        const lines = text.split('\n');
        
        if (lines.length >= 2) {
          return {
            original: this._decodeText(lines[0]),
            translated: this._decodeText(lines[1]),
            timestamp: lines[2] || null
          };
        }
        return null;
      }
      
      if (response.status === 404) {
        return null;
      }
      
      console.warn('[CacheServer] HTTP', response.status); return null;
    } catch (e) {
      console.warn('[CacheServer] Get-Fehler:', e.message);
      return null;
    }
  },

  /**
   * Speichert eine Übersetzung im Server-Cache
   * Neue API: POST /cache/{hash} mit 2 Zeilen Body (base64)
   * @returns {Object|null} Response mit hash und created
   */
  async store(pageUrl, original, translated) {
    if (!this.config.enabled) return null;
    
    // Nicht speichern wenn original === translated
    if (original.trim() === translated.trim()) {
      return null;
    }
    
    try {
      // E-Book-Erkennung für korrekte Hash-Berechnung
      const isEbook = pageUrl?.includes('#epubcfi');
      const hash = await this.computeHash(pageUrl, original, null, isEbook);
      
      // Texte escapen für 2-Zeilen-Format
      const base64Original = this._encodeText(original);
      const base64Translated = this._encodeText(translated);
      
      const response = await this._fetch(`${this.config.serverUrl}/cache/${hash}`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: `${base64Original}\n${base64Translated}`
      });
      
      if (response.ok) {
        return { hash, created: true };
      }
      
      console.warn('[CacheServer] HTTP', response.status); return null;
    } catch (e) {
      console.warn('[CacheServer] Store-Fehler:', e.message);
      return null;
    }
  },

  /**
   * Löscht eine Übersetzung aus dem Server-Cache
   */
  async delete(hash) {
    if (!this.config.enabled) return false;
    
    try {
      const response = await this._fetch(`${this.config.serverUrl}/cache/${hash}`, {
        method: 'DELETE'
      });
      return response.ok;
    } catch (e) {
      console.warn('[CacheServer] Delete-Fehler:', e.message);
      return false;
    }
  },

  // ==========================================================================
  // BULK OPERATIONS (über Background Script wegen Mixed Content)
  // ==========================================================================

  /**
   * Holt mehrere Übersetzungen auf einmal
   * Leitet Request an Background Script weiter (vermeidet Mixed Content)
   * @param {string[]} hashes - Array von Hashes
   * @param {string} pageUrl - URL der Seite (für url_hash)
   * @returns {Object} { translations: {hash: {original, translated}}, missing: [hash] }
   */
  async bulkGet(hashes, pageUrl = null) {
    // Auf Init warten
    await this.waitForReady();
    
    
    if (!this.config.enabled || !hashes.length) {
      return { translations: {}, missing: hashes };
    }
    
    try {
      // Request über Background Script leiten (kein Mixed Content Problem)
      const response = await chrome.runtime.sendMessage({
        action: 'CACHE_SERVER_BULK_GET',
        hashes: hashes,
        pageUrl: pageUrl
      });
      
      
      if (response && response.success) {
        return response.result;
      }
      
      return { translations: {}, missing: hashes };
    } catch (e) {
      console.warn('[CacheServer Content] BulkGet-Fehler:', e.message);
      return { translations: {}, missing: hashes };
    }
  },

  /**
   * Speichert mehrere Übersetzungen auf einmal
   * Neue API: POST /cache/bulk mit { "hash": ["original (base64)", "translated (base64)"], ... }
   * @param {Array} translations - [{ pageUrl, original, translated }]
   * @returns {Object} { created }
   */
  async bulkStore(translations) {
    if (!this.config.enabled || !translations.length) {
      return { created: 0 };
    }
    
    try {
      // Format: { "hash": ["original (base64)", "translated (base64)"], ... }
      const data = {};
      
      for (const t of translations) {
        // Nicht speichern wenn original === translated
        if (t.original.trim() === t.translated.trim()) continue;
        
        // E-Book-Erkennung für korrekte Hash-Berechnung
        const isEbook = t.pageUrl?.includes('#epubcfi');
        const hash = await this.computeHash(t.pageUrl, t.original, null, isEbook);
        data[hash] = [this._encodeText(t.original), this._encodeText(t.translated)];
      }
      
      if (Object.keys(data).length === 0) {
        return { created: 0 };
      }
      
      const response = await this._fetch(`${this.config.serverUrl}/cache/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      
      if (response.ok) {
        const count = Object.keys(data).length;
        return { created: count };
      }
      
      console.warn('[CacheServer] HTTP', response.status); return null;
    } catch (e) {
      console.warn('[CacheServer] BulkStore-Fehler:', e.message);
      return { created: 0, error: e.message };
    }
  },

  // ==========================================================================
  // STATISTIKEN
  // ==========================================================================

  /**
   * Holt Server-Statistiken
   */
  async getStats() {
    if (!this.config.enabled) return null;
    
    try {
      const response = await this._fetch(`${this.config.serverUrl}/stats`);
      if (response.ok) {
        return await response.json();
      }
      return null;
    } catch (e) {
      console.warn('[CacheServer] Stats-Fehler:', e.message);
      return null;
    }
  },

  /**
   * Health-Check
   */
  async checkHealth() {
    if (!this.config.enabled) return { ok: false, reason: 'disabled' };
    
    try {
      const response = await this._fetch(`${this.config.serverUrl}/health`);
      if (response.ok) {
        return { ok: true, data: await response.json() };
      }
      return { ok: false, reason: `HTTP ${response.status}` };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  }
};

// Auto-Init
SMT.CacheServer.init();
