/**
 * Cache-Mode Tests
 * Testet die saveToCache-Logik und Zustandsübergänge bei Cache-Operationen
 */

const { createChromeMock } = require('./chrome-mock');

// saveToCache-Logik extrahiert (aus translator-cache.js:145-178)
function saveToCacheLogic(translations, mode, pageUrl, settings, runtimeId) {
  const results = { local: false, server: false };

  if (!translations || Object.keys(translations).length === 0) {
    return { saved: false, results };
  }

  // Lokal speichern (nur wenn nicht server-only)
  if (mode !== 'server-only') {
    results.local = true;
  }

  // Server speichern (nur wenn nicht local-only und runtime gültig)
  if (mode !== 'local-only' && runtimeId) {
    results.server = true;
  }

  return { saved: true, results };
}

// Cache-Check-Logik (aus cache-manager.js)
function cacheCheckLogic(mode, enabled) {
  return {
    useLocal: mode !== 'server-only',
    useServer: mode !== 'local-only',
    localFirst: mode === 'local-first' || mode === 'local-only'
  };
}


describe('saveToCache Mode-Logik', () => {
  const testTranslations = { 'Hello': 'Hallo', 'World': 'Welt' };
  const pageUrl = 'https://example.com/page';
  const settings = { sourceLang: 'en', targetLang: 'de' };

  test('server-only: nur Server, kein localStorage', () => {
    const result = saveToCacheLogic(testTranslations, 'server-only', pageUrl, settings, 'ext-id');
    expect(result.saved).toBe(true);
    expect(result.results.local).toBe(false);
    expect(result.results.server).toBe(true);
  });

  test('local-only: nur localStorage, kein Server', () => {
    const result = saveToCacheLogic(testTranslations, 'local-only', pageUrl, settings, 'ext-id');
    expect(result.saved).toBe(true);
    expect(result.results.local).toBe(true);
    expect(result.results.server).toBe(false);
  });

  test('server-first: beides', () => {
    const result = saveToCacheLogic(testTranslations, 'server-first', pageUrl, settings, 'ext-id');
    expect(result.saved).toBe(true);
    expect(result.results.local).toBe(true);
    expect(result.results.server).toBe(true);
  });

  test('local-first: beides', () => {
    const result = saveToCacheLogic(testTranslations, 'local-first', pageUrl, settings, 'ext-id');
    expect(result.saved).toBe(true);
    expect(result.results.local).toBe(true);
    expect(result.results.server).toBe(true);
  });

  test('server-only ohne Runtime: nichts gespeichert', () => {
    const result = saveToCacheLogic(testTranslations, 'server-only', pageUrl, settings, null);
    expect(result.results.local).toBe(false);
    expect(result.results.server).toBe(false);
  });

  test('leere Translations: nichts speichern', () => {
    const result = saveToCacheLogic({}, 'server-only', pageUrl, settings, 'ext-id');
    expect(result.saved).toBe(false);
  });

  test('null Translations: nichts speichern', () => {
    const result = saveToCacheLogic(null, 'server-only', pageUrl, settings, 'ext-id');
    expect(result.saved).toBe(false);
  });
});


describe('Cache-Check Mode-Logik', () => {
  test('server-only: nur Server, nicht lokal', () => {
    const check = cacheCheckLogic('server-only', true);
    expect(check.useLocal).toBe(false);
    expect(check.useServer).toBe(true);
    expect(check.localFirst).toBe(false);
  });

  test('local-only: nur lokal, nicht Server', () => {
    const check = cacheCheckLogic('local-only', true);
    expect(check.useLocal).toBe(true);
    expect(check.useServer).toBe(false);
    expect(check.localFirst).toBe(true);
  });

  test('local-first: beides, lokal zuerst', () => {
    const check = cacheCheckLogic('local-first', true);
    expect(check.useLocal).toBe(true);
    expect(check.useServer).toBe(true);
    expect(check.localFirst).toBe(true);
  });

  test('server-first: beides, Server zuerst', () => {
    const check = cacheCheckLogic('server-first', true);
    expect(check.useLocal).toBe(true);
    expect(check.useServer).toBe(true);
    expect(check.localFirst).toBe(false);
  });
});


describe('Konsistenz: Save-Mode und Check-Mode', () => {
  const modes = ['server-only', 'local-only', 'server-first', 'local-first'];

  test.each(modes)('Mode %s: was gespeichert wird, muss auch gesucht werden', (mode) => {
    const save = saveToCacheLogic({ 'test': 'Test' }, mode, 'url', {}, 'ext-id');
    const check = cacheCheckLogic(mode, true);

    // Wenn lokal gespeichert wird, muss auch lokal gesucht werden
    if (save.results.local) {
      expect(check.useLocal).toBe(true);
    }

    // Wenn auf Server gespeichert wird, muss auch auf Server gesucht werden
    if (save.results.server) {
      expect(check.useServer).toBe(true);
    }
  });
});


describe('translateText Routing-Logik', () => {
  // Routing-Logik extrahiert
  function routeTranslation(text, settings, bypassCache, cacheServerConfig) {
    // Validierung
    if (!text || text.trim().length < 2) {
      return { action: 'reject', reason: 'too-short' };
    }

    // Cache-Check
    if (!bypassCache && cacheServerConfig.enabled && cacheServerConfig.mode !== 'local-only') {
      // Würde Cache prüfen
      return { action: 'check-cache-then-translate', provider: settings.apiType };
    }

    // Direkt übersetzen
    if (settings.apiType === 'lmstudio') {
      if (!settings.lmStudioUrl) return { action: 'reject', reason: 'not-configured' };
      return { action: 'translate', provider: 'lmstudio' };
    }

    if (!settings.serviceUrl) return { action: 'reject', reason: 'not-configured' };
    return { action: 'translate', provider: 'libretranslate' };
  }

  test('leerer Text -> reject', () => {
    expect(routeTranslation('', {}, false, {})).toEqual({ action: 'reject', reason: 'too-short' });
    expect(routeTranslation('a', {}, false, {})).toEqual({ action: 'reject', reason: 'too-short' });
    expect(routeTranslation('  ', {}, false, {})).toEqual({ action: 'reject', reason: 'too-short' });
  });

  test('LibreTranslate ohne URL -> not-configured', () => {
    const result = routeTranslation('Hello World', { apiType: 'libretranslate', serviceUrl: '' }, true, {});
    expect(result.reason).toBe('not-configured');
  });

  test('LM Studio ohne URL -> not-configured', () => {
    const result = routeTranslation('Hello World', { apiType: 'lmstudio', lmStudioUrl: '' }, true, {});
    expect(result.reason).toBe('not-configured');
  });

  test('LibreTranslate konfiguriert -> translate', () => {
    const result = routeTranslation('Hello World', { apiType: 'libretranslate', serviceUrl: 'https://translate.max' }, true, {});
    expect(result.action).toBe('translate');
    expect(result.provider).toBe('libretranslate');
  });

  test('LM Studio konfiguriert -> translate', () => {
    const result = routeTranslation('Hello World', { apiType: 'lmstudio', lmStudioUrl: 'http://localhost:1234' }, true, {});
    expect(result.action).toBe('translate');
    expect(result.provider).toBe('lmstudio');
  });

  test('Cache aktiviert, kein Bypass -> Cache-Check zuerst', () => {
    const result = routeTranslation('Hello World', { apiType: 'libretranslate', serviceUrl: 'url' }, false, { enabled: true, mode: 'server-only' });
    expect(result.action).toBe('check-cache-then-translate');
  });

  test('Cache aktiviert aber Bypass -> direkt übersetzen', () => {
    const result = routeTranslation('Hello World', { apiType: 'libretranslate', serviceUrl: 'url' }, true, { enabled: true, mode: 'server-only' });
    expect(result.action).toBe('translate');
  });

  test('Cache local-only -> kein Server-Cache-Check', () => {
    const result = routeTranslation('Hello World', { apiType: 'libretranslate', serviceUrl: 'url' }, false, { enabled: true, mode: 'local-only' });
    expect(result.action).toBe('translate');
  });
});


describe('State nach Übersetzung', () => {
  // Simuliert den Zustandsübergang nach translatePage()
  function simulateTranslationComplete(aborted, translatedCount) {
    const state = {
      isTranslated: false,
      isTranslating: true,
      _cacheAvailable: false,
      translatedCount: 0,
      progressOverlay: {}
    };

    if (aborted) {
      state.isTranslating = false;
      state.progressOverlay = null;
      return state;
    }

    // WICHTIG: Reihenfolge wie im Code
    // 1. isTranslated ZUERST
    state.isTranslated = true;
    state.translatedCount = translatedCount;
    // 2. Progress ausblenden
    state.progressOverlay = null;
    state.isTranslating = false;
    // 3. Cache-Status (ruft notifyStatusChange auf)
    state._cacheAvailable = true;

    return state;
  }

  test('erfolgreiche Übersetzung: korrekter Endzustand', () => {
    const state = simulateTranslationComplete(false, 20);

    expect(state.isTranslated).toBe(true);
    expect(state.isTranslating).toBe(false);
    expect(state._cacheAvailable).toBe(true);
    expect(state.progressOverlay).toBeNull();
    expect(state.translatedCount).toBe(20);
  });

  test('abgebrochene Übersetzung: kein translated-State', () => {
    const state = simulateTranslationComplete(true, 0);

    expect(state.isTranslated).toBe(false);
    expect(state.isTranslating).toBe(false);
    expect(state._cacheAvailable).toBe(false);
  });

  test('State-Invariante: isTranslated vor cacheAvailable', () => {
    // Simuliere den kritischen Moment wenn notifyStatusChange gefeuert wird
    let stateAtNotify = null;

    const state = { isTranslated: false, _cacheAvailable: false };

    // setCacheAvailable würde notifyStatusChange aufrufen
    function setCacheAvailable(available) {
      state._cacheAvailable = available;
      // Snapshot zum Zeitpunkt des Notify
      stateAtNotify = { ...state };
    }

    // Korrekte Reihenfolge (wie im Code)
    state.isTranslated = true;    // ZUERST
    setCacheAvailable(true);      // DANN (ruft notify auf)

    // Zum Zeitpunkt des Notify muss isTranslated schon true sein
    expect(stateAtNotify.isTranslated).toBe(true);
    expect(stateAtNotify._cacheAvailable).toBe(true);
  });

  test('State-Invariante: falsche Reihenfolge würde Bug erzeugen', () => {
    let stateAtNotify = null;

    const state = { isTranslated: false, _cacheAvailable: false };

    function setCacheAvailable(available) {
      state._cacheAvailable = available;
      stateAtNotify = { ...state };
    }

    // FALSCHE Reihenfolge (alter Bug)
    setCacheAvailable(true);        // ZUERST (notify feuert)
    state.isTranslated = true;      // ZU SPAET

    // Zum Zeitpunkt des Notify war isTranslated noch false!
    expect(stateAtNotify.isTranslated).toBe(false);
    expect(stateAtNotify._cacheAvailable).toBe(true);

    // Das Sidepanel würde "idle + cacheAvailable" sehen statt "translated"
    const derivedState = derivePage(stateAtNotify);
    expect(derivedState).toBe('idle'); // BUG: sollte 'translated' sein
  });
});

// Hilfs-Funktion für den State-Invariante-Test
function derivePage(state) {
  if (state.isTranslating) return 'translating';
  if (state.isTranslated) return 'translated';
  return 'idle';
}
