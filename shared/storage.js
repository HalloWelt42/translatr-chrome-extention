/**
 * Smart Translator - Vorgaben der Einstellungen
 *
 * Eine Wahrheit für Service Worker (Erstinstallation), Einstellungen (Zurücksetzen)
 * und Oberflächen. Gespeichert wird jede Einstellung als eigener Schlüssel in
 * chrome.storage.sync; der Schlüssel der Leitstelle liegt nur in chrome.storage.local.
 */

(function (root) {
  const SWT = root.SWT = root.SWT || {};

  SWT.Storage = {
    defaultSettings: {
      // API
      apiType: SWT.Providers.DEFAULT,
      serviceUrl: '',
      apiKey: '',

      // Leitstelle (Schlüssel nur in chrome.storage.local)
      leitstelleUrl: SWT.Providers.LEITSTELLE_DEFAULT_URL,
      leitstelleModel: '',

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
      showOriginalInTooltip: true,
      showAlternatives: true,
      highlightTranslated: false,
      enableTTS: true,

      // Inhaltsfilter
      skipCodeBlocks: true,
      skipBlockquotes: true,
      fixInlineSpacing: true,

      // Batch
      pageBatchSize: 20,
      useCacheFirst: true,

      // Cache
      autoLoadCache: false,
      cacheServerEnabled: true,
      cacheServerUrl: '',
      cacheServerMode: 'server-only',
      cacheServerTimeout: 5000
    }
  };
})(globalThis);
