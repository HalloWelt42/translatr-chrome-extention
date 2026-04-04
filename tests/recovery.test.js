/**
 * Recovery Tests
 * Testet recoverFromBrokenMigration() mit verschiedenen Storage-Zuständen
 */

const { createChromeMock } = require('./chrome-mock');

// Recovery-Funktion extrahiert (identisch zu service-worker.js:74-101)
async function recoverFromBrokenMigration() {
  try {
    const all = await chrome.storage.sync.get(null);
    const bundle = all['swt-settings'];
    if (!bundle) return { action: 'skip', reason: 'no-bundle' };

    if (all.apiType && all.serviceUrl !== undefined) {
      await chrome.storage.sync.remove('swt-settings');
      return { action: 'cleanup', reason: 'keys-exist' };
    }

    const restored = {};
    for (const [key, value] of Object.entries(bundle)) {
      if (!(key in all) || key === 'swt-settings') {
        restored[key] = value;
      }
    }

    if (Object.keys(restored).length > 0) {
      await chrome.storage.sync.set(restored);
    }

    await chrome.storage.sync.remove('swt-settings');
    return { action: 'restored', keys: Object.keys(restored) };
  } catch (e) {
    return { action: 'error', error: e.message };
  }
}

// migrateSettings (identisch zu service-worker.js:103-118)
async function migrateSettings() {
  const settings = await chrome.storage.sync.get();

  if (!settings.apiType) {
    await chrome.storage.sync.set({
      apiType: 'libretranslate',
      lmStudioUrl: '',
      lmStudioModel: '',
      lmStudioTemperature: 0.1,
      lmStudioMaxTokens: 2000,
      lmStudioContext: 'general',
      lmStudioCustomPrompt: ''
    });
    return { action: 'defaults-set' };
  }
  return { action: 'skip' };
}


describe('recoverFromBrokenMigration', () => {
  beforeEach(() => {
    global.chrome = createChromeMock();
  });

  test('Szenario 1: Kein Bundle vorhanden -> Skip', async () => {
    chrome.storage.sync._reset({
      apiType: 'libretranslate',
      serviceUrl: 'https://translate.max',
      sourceLang: 'en',
      targetLang: 'de'
    });

    const result = await recoverFromBrokenMigration();
    expect(result.action).toBe('skip');
    expect(result.reason).toBe('no-bundle');

    // Storage unverändert
    const stored = await chrome.storage.sync.get(null);
    expect(stored.apiType).toBe('libretranslate');
  });

  test('Szenario 2: Bundle vorhanden, keine individuellen Keys -> Recovery', async () => {
    chrome.storage.sync._reset({
      'swt-settings': {
        apiType: 'libretranslate',
        serviceUrl: 'https://translate.max',
        sourceLang: 'en',
        targetLang: 'de',
        cacheServerEnabled: true,
        cacheServerMode: 'server-only'
      }
    });

    const result = await recoverFromBrokenMigration();
    expect(result.action).toBe('restored');
    expect(result.keys).toContain('apiType');
    expect(result.keys).toContain('serviceUrl');
    expect(result.keys).toContain('sourceLang');

    // Individuelle Keys müssen existieren
    const stored = await chrome.storage.sync.get(null);
    expect(stored.apiType).toBe('libretranslate');
    expect(stored.serviceUrl).toBe('https://translate.max');
    expect(stored.sourceLang).toBe('en');
    expect(stored.targetLang).toBe('de');
    expect(stored.cacheServerMode).toBe('server-only');

    // Bundle muss entfernt sein
    expect(stored['swt-settings']).toBeUndefined();
  });

  test('Szenario 3: Bundle + individuelle Keys -> Nur Cleanup', async () => {
    chrome.storage.sync._reset({
      apiType: 'lmstudio',
      serviceUrl: 'https://my-url',
      'swt-settings': {
        apiType: 'libretranslate',
        serviceUrl: 'https://old-url'
      }
    });

    const result = await recoverFromBrokenMigration();
    expect(result.action).toBe('cleanup');

    // Individuelle Keys unverändert (nicht vom Bundle überschrieben)
    const stored = await chrome.storage.sync.get(null);
    expect(stored.apiType).toBe('lmstudio');
    expect(stored.serviceUrl).toBe('https://my-url');

    // Bundle entfernt
    expect(stored['swt-settings']).toBeUndefined();
  });

  test('Szenario 4: Bundle + teilweise Keys -> Fehlende wiederherstellen', async () => {
    chrome.storage.sync._reset({
      apiType: 'libretranslate',
      // serviceUrl FEHLT (kritisch!)
      'swt-settings': {
        apiType: 'libretranslate',
        serviceUrl: 'https://translate.max',
        sourceLang: 'en',
        targetLang: 'de'
      }
    });

    const result = await recoverFromBrokenMigration();

    // apiType existiert, aber serviceUrl === undefined -> Guard greift nicht
    // Recovery läuft und stellt fehlende Keys wieder her
    const stored = await chrome.storage.sync.get(null);
    expect(stored.serviceUrl).toBe('https://translate.max');
    expect(stored.sourceLang).toBe('en');
    expect(stored['swt-settings']).toBeUndefined();
  });

  test('Szenario 5: Leeres Bundle -> Skip nach Cleanup', async () => {
    chrome.storage.sync._reset({
      'swt-settings': {}
    });

    const result = await recoverFromBrokenMigration();
    // Leeres Bundle, keine Keys zum Wiederherstellen
    expect(result.action).toBe('restored');
    expect(result.keys).toEqual([]);

    const stored = await chrome.storage.sync.get(null);
    expect(stored['swt-settings']).toBeUndefined();
  });
});


describe('migrateSettings (nach Recovery)', () => {
  beforeEach(() => {
    global.chrome = createChromeMock();
  });

  test('apiType existiert -> Skip', async () => {
    chrome.storage.sync._reset({ apiType: 'lmstudio' });

    const result = await migrateSettings();
    expect(result.action).toBe('skip');
  });

  test('kein apiType -> Defaults setzen', async () => {
    chrome.storage.sync._reset({});

    const result = await migrateSettings();
    expect(result.action).toBe('defaults-set');

    const stored = await chrome.storage.sync.get(null);
    expect(stored.apiType).toBe('libretranslate');
    expect(stored.lmStudioContext).toBe('general');
  });

  test('vollständiger Update-Flow: Recovery + Migration', async () => {
    // Ausgangszustand: Kaputte Migration hat alles in Bundle gesteckt
    chrome.storage.sync._reset({
      'swt-settings': {
        apiType: 'libretranslate',
        serviceUrl: 'https://translate.max',
        sourceLang: 'en',
        targetLang: 'de'
      }
    });

    // Schritt 1: Recovery
    await recoverFromBrokenMigration();

    // Schritt 2: Migration
    await migrateSettings();

    // Ergebnis: Individuelle Keys vorhanden, kein Bundle
    const stored = await chrome.storage.sync.get(null);
    expect(stored.apiType).toBe('libretranslate');
    expect(stored.serviceUrl).toBe('https://translate.max');
    expect(stored['swt-settings']).toBeUndefined();
  });
});
