/**
 * Smart Translator - Einheitliche Storage-Verwaltung
 *
 * Zwei Keys:
 * - chrome.storage.sync  'swt-settings'  (Einstellungen, max 8KB)
 * - chrome.storage.local 'swt-data'      (Verlauf, Token-Stats, kein Limit)
 */

window.SWT = window.SWT || {};

SWT.Storage = {
  SETTINGS_KEY: 'swt-settings',
  DATA_KEY: 'swt-data',

  // === Default-Werte ===

  defaultSettings: {
    // API
    apiType: 'libretranslate',
    serviceUrl: '',
    apiKey: '',

    // LM Studio
    lmStudioUrl: '',
    lmStudioModel: '',
    lmStudioTemperature: 0.1,
    lmStudioMaxTokens: 2000,
    lmStudioContext: 'general',
    lmStudioCustomPrompt: '',

    // Sprachen
    sourceLang: 'en',
    targetLang: 'de',

    // UI
    showSelectionIcon: true,
    selectionIconDelay: 300,
    showOriginalInTooltip: true,
    showAlternatives: true,
    tooltipPosition: 'auto',
    highlightTranslated: false,
    enableTTS: true,
    ttsLanguage: 'auto',

    // Inhaltsfilter
    skipCodeBlocks: true,
    skipBlockquotes: true,
    fixInlineSpacing: true,
    simplifyPdfExport: false,
    useTabsForAlternatives: false,
    tabWordThreshold: 5,
    excludedDomains: '',

    // Batch
    lmBatchSize: 20,
    lmMaxBatchTokens: 128000,
    pageBatchSize: 20,
    enableTrueBatch: true,
    enableSmartChunking: true,
    useCacheFirst: true,

    // Cache
    autoLoadCache: false,
    cacheServerEnabled: true,
    cacheServerUrl: '',
    cacheServerMode: 'server-only',
    cacheServerTimeout: 5000,


    // Sonstiges
    filterEmbeddingModels: true,
    enableAbortTranslation: true,
    enableLLMFallback: false,

  },

  defaultData: {
    translationHistory: [],
    tokenStats: {
      totalTokens: 0,
      promptTokens: 0,
      completionTokens: 0,
      requestCount: 0,
      lastUpdated: null
    },
  },

  // === Settings (chrome.storage.sync) ===

  async loadSettings() {
    try {
      const result = await chrome.storage.sync.get(this.SETTINGS_KEY);
      const stored = result[this.SETTINGS_KEY] || {};
      return { ...this.defaultSettings, ...stored };
    } catch (e) {
      console.warn('[SWT Storage] loadSettings:', e.message);
      return { ...this.defaultSettings };
    }
  },

  async saveSettings(settings) {
    try {
      await chrome.storage.sync.set({ [this.SETTINGS_KEY]: settings });
      return { success: true };
    } catch (e) {
      console.warn('[SWT Storage] saveSettings:', e.message);
      return { success: false, error: e.message };
    }
  },

  async updateSettings(partial) {
    const current = await this.loadSettings();
    const merged = { ...current, ...partial };
    return this.saveSettings(merged);
  },

  // === Data (chrome.storage.local) ===

  async loadData() {
    try {
      const result = await chrome.storage.local.get(this.DATA_KEY);
      const stored = result[this.DATA_KEY] || {};
      return { ...this.defaultData, ...stored };
    } catch (e) {
      console.warn('[SWT Storage] loadData:', e.message);
      return { ...this.defaultData };
    }
  },

  async saveData(data) {
    try {
      await chrome.storage.local.set({ [this.DATA_KEY]: data });
      return { success: true };
    } catch (e) {
      console.warn('[SWT Storage] saveData:', e.message);
      return { success: false, error: e.message };
    }
  },

  async updateData(partial) {
    const current = await this.loadData();
    const merged = { ...current, ...partial };
    return this.saveData(merged);
  },

  // === Migration von alten Keys ===

  async migrateFromOldFormat() {
    try {
      // Prüfen ob bereits migriert
      const check = await chrome.storage.sync.get(this.SETTINGS_KEY);
      if (check[this.SETTINGS_KEY]) {
        return false; // Bereits migriert
      }

      // Alle alten Sync-Keys lesen
      const oldSync = await chrome.storage.sync.get(null);
      if (!oldSync || Object.keys(oldSync).length === 0) {
        return false; // Nichts zu migrieren
      }

      // Settings zusammenbauen aus alten Keys
      const settings = {};
      const settingsKeys = Object.keys(this.defaultSettings);
      for (const key of settingsKeys) {
        if (key in oldSync) {
          settings[key] = oldSync[key];
        }
      }

      // Alle alten Local-Keys lesen
      const oldLocal = await chrome.storage.local.get(null);
      const data = {};
      const dataKeys = Object.keys(this.defaultData);
      for (const key of dataKeys) {
        if (key in oldLocal) {
          data[key] = oldLocal[key];
        }
      }

      // Neue Struktur speichern
      if (Object.keys(settings).length > 0) {
        await chrome.storage.sync.set({ [this.SETTINGS_KEY]: settings });
      }
      if (Object.keys(data).length > 0) {
        await chrome.storage.local.set({ [this.DATA_KEY]: data });
      }

      // Alte Keys entfernen (sync)
      const oldSyncKeys = Object.keys(oldSync).filter(k => k !== this.SETTINGS_KEY);
      if (oldSyncKeys.length > 0) {
        await chrome.storage.sync.remove(oldSyncKeys);
      }

      // Alte Keys entfernen (local)
      const oldLocalKeys = Object.keys(oldLocal).filter(k => k !== this.DATA_KEY);
      if (oldLocalKeys.length > 0) {
        await chrome.storage.local.remove(oldLocalKeys);
      }

      return true;
    } catch (e) {
      console.warn('[SWT Storage] Migration fehlgeschlagen:', e.message);
      return false;
    }
  }
};
