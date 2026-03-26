/**
 * Smart Translator - Cache Manager
 * Orchestriert lokalen und Server-Cache basierend auf Modus-Einstellung.
 *
 * Modi: 'local-only', 'server-only', 'server-first', 'local-first'
 * Delegiert an SWT.CacheLocal und SWT.CacheServer.
 */

window.SWT = window.SWT || {};

SWT.Cache = {
  config: {
    mode: 'server-only',
    enabled: true
  },

  _initPromise: null,
  _ready: false,

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

        if (SWT.CacheServer?.init) {
          await SWT.CacheServer.init();
        }

        this._ready = true;
      } catch (e) {
        if (!String(e).includes('invalidated')) {
          // still bei Extension-Reload
        }
        this._ready = true;
      }
    })();

    return this._initPromise;
  },

  async waitForReady() {
    if (this._ready) return;
    await this.init();
  },

  // === Hilfsmethoden ===

  _useLocal() {
    return this.config.mode !== 'server-only';
  },

  _useServer() {
    return this.config.mode !== 'local-only';
  },

  _localFirst() {
    return this.config.mode === 'local-first' || this.config.mode === 'local-only';
  },

  // ==========================================================================
  // CHECK CACHE
  // ==========================================================================

  async checkCache(pageUrl, cacheKey, settings, sampleTexts) {
    if (!chrome.runtime?.id) return { hasCache: false, source: null, count: 0, percentage: 0 };
    await this.waitForReady();

    if (!this.config.enabled) {
      return { hasCache: false, source: null, count: 0, percentage: 0 };
    }

    // Bei local-first oder local-only: Lokal zuerst
    if (this._useLocal()) {
      const localResult = SWT.CacheLocal.checkCache(cacheKey);
      if (localResult.hasCache) {
        return { ...localResult, source: 'local' };
      }
    }

    // Server prüfen
    if (this._useServer() && sampleTexts?.length > 0) {
      const serverResult = await this._checkServerCache(pageUrl, settings, sampleTexts);
      if (serverResult.hasCache) {
        return { ...serverResult, source: 'server' };
      }
    }

    return { hasCache: false, source: null, count: 0, percentage: 0 };
  },

  // ==========================================================================
  // LOAD TRANSLATIONS
  // ==========================================================================

  async loadTranslations(pageUrl, cacheKey, settings, allTexts) {
    await this.waitForReady();

    const translations = new Map();
    let source = null;

    // Lokal laden
    if (this._useLocal()) {
      const localData = SWT.CacheLocal.loadTranslations(cacheKey);
      if (localData && Object.keys(localData).length > 0) {
        for (const [original, translated] of Object.entries(localData)) {
          translations.set(original, translated);
        }
        source = 'local';

        if (this.config.mode === 'local-only') {
          return { translations, source };
        }
      }
    }

    // Server laden
    if (this._useServer() && allTexts?.length > 0) {
      const serverTranslations = await this._loadServerCache(pageUrl, settings, allTexts);
      if (serverTranslations.size > 0) {
        for (const [original, translated] of serverTranslations) {
          translations.set(original, translated);
        }
        source = 'server';
      }
    }

    return { translations, source };
  },

  // ==========================================================================
  // SAVE TRANSLATIONS
  // ==========================================================================

  async saveTranslations(pageUrl, cacheKey, settings, items) {
    await this.waitForReady();

    if (!this.config.enabled || !items?.length) return;

    if (this._useLocal()) {
      SWT.CacheLocal.saveTranslations(cacheKey, pageUrl, items);
    }

    if (this._useServer()) {
      await this._saveServerCache(pageUrl, settings, items);
    }
  },

  // ==========================================================================
  // CLEAR CACHE
  // ==========================================================================

  async clearCache(options = {}) {
    await this.waitForReady();

    const {
      scope = 'page',
      pageUrl = null,
      cacheKey = null
    } = typeof options === 'string' ? { cacheKey: options } : options;

    const results = { local: null, server: null };

    // Lokaler Cache
    if (this._useLocal()) {
      if (scope === 'all' || scope === 'local-all') {
        results.local = SWT.CacheLocal.clearCache(null);
      } else if (scope === 'page' && cacheKey) {
        results.local = SWT.CacheLocal.clearCache(cacheKey);
      }
    }

    // Server Cache
    if (this._useServer() && SWT.CacheServer?.config?.enabled) {
      if (scope === 'all' || scope === 'server-all') {
        try {
          const response = await chrome.runtime.sendMessage({
            action: 'CACHE_SERVER_CLEAR_ALL'
          });
          results.server = response?.result || { error: 'Nicht unterstuetzt' };
        } catch (e) {
          results.server = { error: e.message };
        }
      } else if (scope === 'page' && pageUrl) {
        try {
          const response = await chrome.runtime.sendMessage({
            action: 'CACHE_SERVER_DELETE_BY_URL',
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
  // SERVER CACHE (intern)
  // ==========================================================================

  async _checkServerCache(pageUrl, settings, sampleTexts) {
    if (!SWT.CacheServer?.bulkGet) {
      return { hasCache: false, count: 0, percentage: 0 };
    }

    try {
      const langPair = `${settings.sourceLang || 'auto'}:${settings.targetLang || 'de'}`;

      const hashes = [];
      for (const text of sampleTexts.slice(0, 50)) {
        if (text.length >= 2) {
          const hash = await SWT.CacheServer.computeHash(pageUrl, text, langPair);
          hashes.push(hash);
        }
      }

      if (hashes.length === 0) {
        return { hasCache: false, count: 0, percentage: 0 };
      }

      const result = await SWT.CacheServer.bulkGet(hashes, pageUrl);
      const count = Object.keys(result.translations || {}).length;
      const percentage = Math.round((count / hashes.length) * 100);

      return {
        hasCache: percentage >= 30,
        count,
        percentage,
        matchedTexts: count
      };
    } catch (e) {
      // still
      return { hasCache: false, count: 0, percentage: 0 };
    }
  },

  async _loadServerCache(pageUrl, settings, allTexts) {
    const translations = new Map();

    if (!SWT.CacheServer?.bulkGet) return translations;

    try {
      const langPair = `${settings.sourceLang || 'auto'}:${settings.targetLang || 'de'}`;

      const hashToText = new Map();
      const hashes = [];

      for (const text of allTexts) {
        if (text.length >= 2) {
          const hash = await SWT.CacheServer.computeHash(pageUrl, text, langPair);
          if (!hashToText.has(hash)) {
            hashToText.set(hash, text);
            hashes.push(hash);
          }
        }
      }

      if (hashes.length === 0) return translations;

      const result = await SWT.CacheServer.bulkGet(hashes, pageUrl);

      for (const [hash, data] of Object.entries(result.translations || {})) {
        if (data.original && data.translated) {
          translations.set(data.original, data.translated);
        }
      }
    } catch (e) {
      // still
    }

    return translations;
  },

  async _saveServerCache(pageUrl, settings, items) {
    if (!SWT.CacheServer?.bulkStore) return;

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
        await chrome.runtime.sendMessage({
          action: 'CACHE_SERVER_BULK_STORE',
          translations: toStore,
          langPair
        });
      }
    } catch (e) {
      // still
    }
  },

  // ==========================================================================
  // CACHE-INFO (für UI)
  // ==========================================================================

  async getCacheInfo() {
    await this.waitForReady();

    const info = {
      mode: this.config.mode,
      enabled: this.config.enabled,
      localEntries: [],
      localUsage: { bytes: 0, entries: 0 },
      serverStats: null
    };

    if (this._useLocal()) {
      info.localEntries = SWT.CacheLocal.getEntries();
      info.localUsage = SWT.CacheLocal.getStorageUsage();
    }

    if (this._useServer()) {
      try {
        const response = await chrome.runtime.sendMessage({ action: 'GET_CACHE_SERVER_STATS' });
        if (response?.success) {
          info.serverStats = response.stats;
        }
      } catch (e) {}
    }

    return info;
  }
};

// Auto-Init (nur wenn Extension-Kontext gültig)
try {
  if (chrome.runtime?.id) {
    SWT.Cache.init();
    chrome.storage.onChanged.addListener((changes, area) => {
      try {
        if (!chrome.runtime?.id) return;
        if (area === 'sync' && (changes.cacheServerEnabled || changes.cacheServerMode)) {
          SWT.Cache._ready = false;
          SWT.Cache._initPromise = null;
          SWT.Cache.init();
        }
      } catch (e) {}
    });
  }
} catch (e) {}
