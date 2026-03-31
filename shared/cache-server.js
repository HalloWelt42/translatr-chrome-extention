/**
 * Smart Web Translator - Cache Server Integration
 * Version: 1.3.0
 * 
 * Kommuniziert mit SWT Cache Server (FastAPI)
 *
 * 
 * v1.3.0: Base64-Encoding, Mixed-Content-Fix (Requests über Background)
 * v1.2.0: Ready-Promise für async Init, langPair konsistent
 * v1.1.0: Hash mit Sprachrichtung (langPair)
 */

window.SWT = window.SWT || {};

SWT.CacheServer = {
  // Konfiguration (wird aus chrome.storage geladen)
  config: {
    enabled: true,  // Default: aktiviert
    serverUrl: '',
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
          cacheServerUrl: '',
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
        // Still bei Extension-Reload
        if (!String(e).includes('invalidated')) {
          // still bei Extension-Reload
        }
        this._ready = true;
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
  async computeHash(pageUrl, text, langPair = null) {
    const url = new URL(pageUrl);
    const normalizedUrl = url.origin + url.pathname;
    
    // Sprachrichtung hinzufügen
    const langSuffix = langPair ? `:${langPair}` : '';
    
    // Hash aus URL + Text + Sprachrichtung
    const content = normalizedUrl + text + langSuffix;

    // SHA-256 via Web Crypto API (nur auf HTTPS verfügbar)
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const encoder = new TextEncoder();
      const data = encoder.encode(content);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    // Fallback für HTTP-Seiten: einfacher String-Hash (djb2)
    let hash = 5381;
    for (let i = 0; i < content.length; i++) {
      hash = ((hash << 5) + hash + content.charCodeAt(i)) >>> 0;
    }
    return hash.toString(16).padStart(16, '0');
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
      
      return null;
    } catch (e) {
      // still
      return null;
    }
  },

  /**
   * Speichert eine Übersetzung im Server-Cache
   * Neue API: POST /cache/{hash} mit 2 Zeilen Body (base64)
   * @returns {Object|null} Response mit hash und created
   */
  async store(pageUrl, original, translated, langPair = null) {
    if (!this.config.enabled) return null;

    // Nicht speichern wenn original === translated
    if (original.trim() === translated.trim()) {
      return null;
    }

    try {
      const hash = await this.computeHash(pageUrl, original, langPair);
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
      
      return null;
    } catch (e) {
      // still
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
      // still
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
    var empty = { translations: {}, missing: hashes };
    try {
      if (!chrome.runtime?.id) return empty;
      await this.waitForReady();
      if (!this.config.enabled || !hashes?.length) return empty;
      if (!this.config.serverUrl) return empty;

      var response = await chrome.runtime.sendMessage({
        action: 'CACHE_SERVER_BULK_GET',
        hashes: hashes,
        pageUrl: pageUrl
      });

      if (response && response.success) {
        return response.result || empty;
      }
      
      return { translations: {}, missing: hashes };
    } catch (e) {
      return empty;
    }
  },

  /**
   * Speichert mehrere Übersetzungen auf einmal
   * Neue API: POST /cache/bulk mit { "hash": ["original (base64)", "translated (base64)"], ... }
   * @param {Array} translations - [{ pageUrl, original, translated }]
   * @returns {Object} { created }
   */
  async bulkStore(translations, defaultLangPair = null) {
    if (!this.config.enabled || !translations.length) {
      return { created: 0 };
    }

    try {
      // Format: { "hash": ["original (base64)", "translated (base64)"], ... }
      const data = {};

      for (const t of translations) {
        if (t.original.trim() === t.translated.trim()) continue;
        const langPair = t.langPair || defaultLangPair || 'auto:de';
        const hash = await this.computeHash(t.pageUrl, t.original, langPair);
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
      
      return null;
    } catch (e) {
      // still
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
      // still
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

// Auto-Init (nur wenn Extension-Kontext gültig)
try {
  if (chrome.runtime?.id) SWT.CacheServer.init();
} catch (e) {}
