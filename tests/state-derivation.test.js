/**
 * State-Derivation Tests
 * Testet die reine Zustandslogik: PageState, PopupState, Action-Ableitung
 */

// --- PageState (aus sidepanel.js extrahiert) ---
const PageState = {
  derive(response) {
    if (!response) return 'unavailable';
    if (response.isTranslating) return 'translating';
    if (response.isTranslated) return 'translated';
    if (response.translatedCount > 0 || response.remaining > 0) return 'partial';
    return 'idle';
  },

  deriveActions(response) {
    const state = this.derive(response);
    const hasCache = response?.cacheAvailable || response?.serverCacheCount > 0;
    const busy = state === 'translating';

    return {
      translate: {
        enabled: !busy && state !== 'unavailable',
        active: state === 'translated'
      },
      continue: {
        enabled: !busy && state === 'partial',
        badge: busy
          ? { text: response.translatedCount || '', type: 'partial' }
          : state === 'partial'
            ? { text: response.remaining, type: 'partial' }
            : { text: '', type: '' }
      },
      restore: {
        enabled: !busy && (state === 'translated' || state === 'partial')
      },
      loadCache: {
        enabled: !busy && state === 'idle' && hasCache
      },
      retranslate: {
        enabled: !busy && (state === 'translated' || state === 'partial')
      }
    };
  }
};

// --- PopupState (aus popup.js extrahiert) ---
const PopupState = {
  derivePage(response) {
    if (!response) return { translate: true, restore: false, active: false };
    const busy = !!response.isTranslating;
    return {
      translate: !busy,
      restore: !busy && (response.isTranslated || response.translatedCount > 0),
      active: !!response.isTranslated
    };
  },

  deriveLed(settings) {
    const mode = settings.cacheServerMode || 'server-only';
    const enabled = settings.cacheServerEnabled !== false;
    const map = {
      disabled:      { led: 'led-off',    text: 'Cache aus' },
      'local-only':  { led: 'led-green',  text: 'Lokal' },
      'server-only': { led: 'led-green',  text: 'Server' },
      fallback:      { led: 'led-yellow', text: 'Hybrid' }
    };
    const key = !enabled ? 'disabled' : (map[mode] ? mode : 'fallback');
    return map[key];
  }
};


// ==========================================================================
// TESTS
// ==========================================================================

describe('PageState.derive', () => {
  test('null/undefined Response -> unavailable', () => {
    expect(PageState.derive(null)).toBe('unavailable');
    expect(PageState.derive(undefined)).toBe('unavailable');
  });

  test('idle: keine Übersetzung aktiv', () => {
    expect(PageState.derive({
      isTranslated: false,
      isTranslating: false,
      translatedCount: 0,
      remaining: 0
    })).toBe('idle');
  });

  test('translating: Übersetzung läuft', () => {
    expect(PageState.derive({
      isTranslated: false,
      isTranslating: true,
      translatedCount: 5,
      remaining: 15
    })).toBe('translating');
  });

  test('translated: vollständig übersetzt', () => {
    expect(PageState.derive({
      isTranslated: true,
      isTranslating: false,
      translatedCount: 20,
      remaining: 0
    })).toBe('translated');
  });

  test('partial: teilweise übersetzt (translatedCount > 0)', () => {
    expect(PageState.derive({
      isTranslated: false,
      isTranslating: false,
      translatedCount: 10,
      remaining: 5
    })).toBe('partial');
  });

  test('partial: remaining > 0 aber kein translatedCount', () => {
    expect(PageState.derive({
      isTranslated: false,
      isTranslating: false,
      translatedCount: 0,
      remaining: 5
    })).toBe('partial');
  });

  test('Priorität: translating schlägt translated', () => {
    // Während Übersetzung kann isTranslated kurz true sein (z.B. Neu-Übersetzen)
    expect(PageState.derive({
      isTranslated: true,
      isTranslating: true,
      translatedCount: 20
    })).toBe('translating');
  });
});


describe('PageState.deriveActions', () => {
  test('idle ohne Cache: nur translate aktiv', () => {
    const actions = PageState.deriveActions({
      isTranslated: false, isTranslating: false,
      translatedCount: 0, remaining: 0,
      cacheAvailable: false, serverCacheCount: 0
    });

    expect(actions.translate.enabled).toBe(true);
    expect(actions.translate.active).toBe(false);
    expect(actions.continue.enabled).toBe(false);
    expect(actions.restore.enabled).toBe(false);
    expect(actions.loadCache.enabled).toBe(false);
    expect(actions.retranslate.enabled).toBe(false);
  });

  test('idle mit Cache: translate + loadCache aktiv', () => {
    const actions = PageState.deriveActions({
      isTranslated: false, isTranslating: false,
      translatedCount: 0, remaining: 0,
      cacheAvailable: true, serverCacheCount: 15
    });

    expect(actions.translate.enabled).toBe(true);
    expect(actions.loadCache.enabled).toBe(true);
  });

  test('idle mit serverCacheCount > 0 (ohne cacheAvailable): loadCache aktiv', () => {
    const actions = PageState.deriveActions({
      isTranslated: false, isTranslating: false,
      translatedCount: 0, remaining: 0,
      cacheAvailable: false, serverCacheCount: 5
    });

    expect(actions.loadCache.enabled).toBe(true);
  });

  test('translating: alle Buttons disabled', () => {
    const actions = PageState.deriveActions({
      isTranslated: false, isTranslating: true,
      translatedCount: 5, remaining: 15,
      cacheAvailable: true
    });

    expect(actions.translate.enabled).toBe(false);
    expect(actions.continue.enabled).toBe(false);
    expect(actions.restore.enabled).toBe(false);
    expect(actions.loadCache.enabled).toBe(false);
    expect(actions.retranslate.enabled).toBe(false);
  });

  test('translated: translate (aktiv), restore, retranslate', () => {
    const actions = PageState.deriveActions({
      isTranslated: true, isTranslating: false,
      translatedCount: 20, remaining: 0,
      cacheAvailable: false
    });

    expect(actions.translate.enabled).toBe(true);
    expect(actions.translate.active).toBe(true);
    expect(actions.restore.enabled).toBe(true);
    expect(actions.retranslate.enabled).toBe(true);
    expect(actions.loadCache.enabled).toBe(false);
    expect(actions.continue.enabled).toBe(false);
  });

  test('partial: continue + restore + retranslate aktiv', () => {
    const actions = PageState.deriveActions({
      isTranslated: false, isTranslating: false,
      translatedCount: 10, remaining: 5,
      cacheAvailable: false
    });

    expect(actions.continue.enabled).toBe(true);
    expect(actions.continue.badge.text).toBe(5);
    expect(actions.restore.enabled).toBe(true);
    expect(actions.retranslate.enabled).toBe(true);
  });

  test('unavailable: alles disabled', () => {
    const actions = PageState.deriveActions(null);

    expect(actions.translate.enabled).toBe(false);
    expect(actions.restore.enabled).toBe(false);
    expect(actions.loadCache.enabled).toBe(false);
  });

  test('translating: Badge zeigt translatedCount', () => {
    const actions = PageState.deriveActions({
      isTranslating: true, translatedCount: 42
    });

    expect(actions.continue.badge.text).toBe(42);
    expect(actions.continue.badge.type).toBe('partial');
  });
});


describe('PopupState.derivePage', () => {
  test('null Response: translate aktiv, Rest aus', () => {
    const state = PopupState.derivePage(null);
    expect(state.translate).toBe(true);
    expect(state.restore).toBe(false);
    expect(state.active).toBe(false);
  });

  test('idle: translate an, restore aus', () => {
    const state = PopupState.derivePage({
      isTranslated: false, isTranslating: false, translatedCount: 0
    });
    expect(state.translate).toBe(true);
    expect(state.restore).toBe(false);
    expect(state.active).toBe(false);
  });

  test('translating: alles aus', () => {
    const state = PopupState.derivePage({
      isTranslated: false, isTranslating: true, translatedCount: 5
    });
    expect(state.translate).toBe(false);
    expect(state.restore).toBe(false);
  });

  test('translated: translate + restore an, active true', () => {
    const state = PopupState.derivePage({
      isTranslated: true, isTranslating: false, translatedCount: 20
    });
    expect(state.translate).toBe(true);
    expect(state.restore).toBe(true);
    expect(state.active).toBe(true);
  });

  test('partial (translatedCount > 0): restore aktiv', () => {
    const state = PopupState.derivePage({
      isTranslated: false, isTranslating: false, translatedCount: 10
    });
    expect(state.restore).toBe(true);
    expect(state.active).toBe(false);
  });
});


describe('PopupState.deriveLed', () => {
  test('server-only -> grün, Server', () => {
    const led = PopupState.deriveLed({ cacheServerEnabled: true, cacheServerMode: 'server-only' });
    expect(led.led).toBe('led-green');
    expect(led.text).toBe('Server');
  });

  test('local-only -> grün, Lokal', () => {
    const led = PopupState.deriveLed({ cacheServerEnabled: true, cacheServerMode: 'local-only' });
    expect(led.led).toBe('led-green');
    expect(led.text).toBe('Lokal');
  });

  test('disabled -> off', () => {
    const led = PopupState.deriveLed({ cacheServerEnabled: false, cacheServerMode: 'server-only' });
    expect(led.led).toBe('led-off');
    expect(led.text).toBe('Cache aus');
  });

  test('unbekannter Modus -> Hybrid (gelb)', () => {
    const led = PopupState.deriveLed({ cacheServerEnabled: true, cacheServerMode: 'server-first' });
    expect(led.led).toBe('led-yellow');
    expect(led.text).toBe('Hybrid');
  });

  test('fehlende Felder -> Defaults', () => {
    const led = PopupState.deriveLed({});
    // cacheServerMode undefined -> fallback 'server-only', cacheServerEnabled undefined -> !== false -> enabled
    expect(led.led).toBe('led-green');
    expect(led.text).toBe('Server');
  });
});


// ==========================================================================
// KONSISTENZ: Popup und Sidepanel müssen gleiche Zustände abbilden
// ==========================================================================

describe('Konsistenz: Popup <-> Sidepanel', () => {
  const scenarios = [
    { name: 'idle', response: { isTranslated: false, isTranslating: false, translatedCount: 0, remaining: 0 } },
    { name: 'translating', response: { isTranslated: false, isTranslating: true, translatedCount: 5, remaining: 15 } },
    { name: 'translated', response: { isTranslated: true, isTranslating: false, translatedCount: 20, remaining: 0 } },
    { name: 'partial', response: { isTranslated: false, isTranslating: false, translatedCount: 10, remaining: 5 } },
  ];

  test.each(scenarios)('$name: translate-Button Konsistenz', ({ response }) => {
    const popupState = PopupState.derivePage(response);
    const sideActions = PageState.deriveActions(response);

    // Wenn Popup translate disabled, muss Sidepanel auch disabled sein
    if (!popupState.translate) {
      expect(sideActions.translate.enabled).toBe(false);
    }

    // active-Flag muss übereinstimmen
    expect(popupState.active).toBe(sideActions.translate.active);
  });

  test.each(scenarios)('$name: restore-Button Konsistenz', ({ response }) => {
    const popupState = PopupState.derivePage(response);
    const sideActions = PageState.deriveActions(response);

    expect(popupState.restore).toBe(sideActions.restore.enabled);
  });

  test('unavailable: beide alles disabled', () => {
    const popupState = PopupState.derivePage(null);
    const sideActions = PageState.deriveActions(null);

    // Popup: translate ist true bei null (Fallback-Verhalten)
    // Sidepanel: translate ist false bei unavailable
    // Das ist ein bewusster Unterschied: Popup zeigt immer Translate-Button
    expect(popupState.translate).toBe(true);
    expect(sideActions.translate.enabled).toBe(false);
  });
});
