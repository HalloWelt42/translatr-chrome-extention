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
    sourceLang: 'auto',
    targetLang: 'de',

    // Sprachenlisten pro Provider (bearbeitbar)
    languagesLibre: [
      { code: 'auto', name: 'Automatisch' },
      { code: 'en', name: 'Englisch' },
      { code: 'de', name: 'Deutsch' },
      { code: 'fr', name: 'Französisch' },
      { code: 'es', name: 'Spanisch' },
      { code: 'it', name: 'Italienisch' },
      { code: 'pt', name: 'Portugiesisch' },
      { code: 'nl', name: 'Niederländisch' },
      { code: 'pl', name: 'Polnisch' },
      { code: 'ru', name: 'Russisch' },
      { code: 'zh', name: 'Chinesisch' },
      { code: 'ja', name: 'Japanisch' },
      { code: 'ko', name: 'Koreanisch' },
      { code: 'ar', name: 'Arabisch' },
      { code: 'tr', name: 'Türkisch' }
    ],
    languagesLM: [
      { code: 'auto', name: 'Automatisch' },
      { code: 'en', name: 'Englisch' },
      { code: 'de', name: 'Deutsch' },
      { code: 'fr', name: 'Französisch' },
      { code: 'es', name: 'Spanisch' },
      { code: 'it', name: 'Italienisch' },
      { code: 'pt', name: 'Portugiesisch' },
      { code: 'nl', name: 'Niederländisch' },
      { code: 'pl', name: 'Polnisch' },
      { code: 'ru', name: 'Russisch' },
      { code: 'zh', name: 'Chinesisch' },
      { code: 'ja', name: 'Japanisch' },
      { code: 'ko', name: 'Koreanisch' },
      { code: 'ar', name: 'Arabisch' },
      { code: 'tr', name: 'Türkisch' },
      { code: 'uk', name: 'Ukrainisch' },
      { code: 'cs', name: 'Tschechisch' },
      { code: 'sv', name: 'Schwedisch' },
      { code: 'da', name: 'Dänisch' },
      { code: 'fi', name: 'Finnisch' },
      { code: 'hi', name: 'Hindi' }
    ],

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

  // === Migration entfernt ===
  // Die alte migrateFromOldFormat() bündelte Settings in 'swt-settings'
  // und löschte einzelne Keys. Da der gesamte Code einzelne Keys liest,
  // führte das zum Verlust aller Einstellungen.
  // Recovery passiert im Service Worker (recoverFromBrokenMigration).
};
