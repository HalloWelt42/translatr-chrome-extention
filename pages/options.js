// Options
// Refactored: Nutzt SWT.Toast

// Validierungsstatus der Provider
const providerState = {
  leitstelle: { configured: false, tested: null },
  libretranslate: { configured: false, tested: null },  // tested: true/false/null
  lmstudio: { configured: false, tested: null },
  cacheServer: { configured: false, tested: null }
};

// Sprachenlisten (wird aus Storage geladen)
let languagesLibre = [];
let languagesLM = [];

document.addEventListener('DOMContentLoaded', async () => {
  const versionEl = document.getElementById('appVersion');
  if (versionEl) versionEl.textContent = chrome.runtime.getManifest().version;
  await loadSettings();
  setupEventListeners();
  updateProviderStates();
});

async function loadSettings() {
  try {
    const settings = await chrome.storage.sync.get([
      // API
      'apiType', 'serviceUrl', 'apiKey',
      'leitstelleUrl', 'leitstelleModel',
      'lmStudioUrl', 'lmStudioModel', 'lmStudioTemperature', 'lmStudioMaxTokens',
      // Anzeige
      'showSelectionIcon', 'enableTTS', 'showAlternatives',
      // Inhaltsfilter
      'skipCodeBlocks', 'skipBlockquotes', 'fixInlineSpacing',
      // Batch
      'pageBatchSize', 'useCacheFirst',
      // Cache
      'cacheServerEnabled', 'cacheServerUrl', 'cacheServerMode',
      'cacheServerTimeout',
      // Sprachen
      'languagesLibre', 'languagesLM',
    ]);

    // Hilfsfunktion für sicheres Setzen
    const setVal = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.value = value ?? '';
    };
    const setChecked = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.checked = value;
    };

    // Leitstelle (Schlüssel liegt nur im lokalen Speicher der Erweiterung)
    setVal('leitstelleUrl', settings.leitstelleUrl ?? SWT.Storage.defaultSettings.leitstelleUrl);
    const { leitstelleKey } = await chrome.storage.local.get('leitstelleKey');
    setVal('leitstelleKey', leitstelleKey || '');
    const leitstelleModelEl = document.getElementById('leitstelleModel');
    if (leitstelleModelEl) {
      setModelSelectOptions(leitstelleModelEl, settings.leitstelleModel ? [settings.leitstelleModel] : []);
      leitstelleModelEl.value = settings.leitstelleModel || '';
    }

    // LibreTranslate Werte
    setVal('serviceUrl', settings.serviceUrl || '');
    setVal('apiKey', settings.apiKey || '');

    // LM Studio Werte
    setVal('lmStudioUrl', settings.lmStudioUrl || '');
    setVal('lmStudioTemperature', settings.lmStudioTemperature ?? 0.1);
    setVal('lmStudioMaxTokens', settings.lmStudioMaxTokens || 2000);

    // Gespeichertes Modell merken (wird nach dem Laden der Modellliste angewendet)
    const modelEl = document.getElementById('lmStudioModel');
    if (modelEl) modelEl.dataset.savedModel = settings.lmStudioModel || '';

    // Batch
    const pageBatchSize = settings.pageBatchSize || 20;
    setVal('pageBatchSize', pageBatchSize);
    const pageBatchSizeValueEl = document.getElementById('pageBatchSizeValue');
    if (pageBatchSizeValueEl) pageBatchSizeValueEl.textContent = pageBatchSize;
    setChecked('useCacheFirst', settings.useCacheFirst !== false);
    
    // API-Typ setzen und UI aktualisieren
    setApiType(SWT.Providers.current(settings.apiType));
    
    // UI Optionen
    setChecked('showSelectionIcon', settings.showSelectionIcon !== false);
    setChecked('enableTTS', settings.enableTTS !== false);
    setChecked('showAlternatives', settings.showAlternatives !== false);
    
    // Inhaltsfilter
    setChecked('skipCodeBlocks', settings.skipCodeBlocks !== false);
    setChecked('skipBlockquotes', settings.skipBlockquotes !== false);
    setChecked('fixInlineSpacing', settings.fixInlineSpacing !== false);
    
    // Cache-Server
    setChecked('cacheServerEnabled', settings.cacheServerEnabled !== false);
    setVal('cacheServerUrl', settings.cacheServerUrl || '');
    setVal('cacheServerMode', settings.cacheServerMode || 'server-only');
    setVal('cacheServerTimeout', settings.cacheServerTimeout || 5000);
    updateCacheServerUI(settings.cacheServerEnabled !== false);
    updateCacheServerFields();

    // Sprachenlisten laden
    languagesLibre = settings.languagesLibre || SWT.Storage.defaultSettings.languagesLibre;
    languagesLM = settings.languagesLM || SWT.Storage.defaultSettings.languagesLM;
    renderLanguageList('Libre', languagesLibre);
    renderLanguageList('LM', languagesLM);

  } catch (e) {
    console.warn('Smart Translator: Error loading settings', e);
  }
}

function setupEventListeners() {
  // Anleitung öffnen
  const guideBtn = document.getElementById('openGuide');
  if (guideBtn) {
    guideBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const guidePage = chrome.i18n.getUILanguage().startsWith('de') ? 'guide.html' : 'guide_en.html';
      chrome.tabs.create({ url: chrome.runtime.getURL('pages/' + guidePage) });
    });
  }

  // Auto-Save: alle Eingaben speichern automatisch
  let saveTimer = null;
  const autoSave = (delay = 400) => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveSettings, delay);
  };
  document.querySelectorAll('.container input[type="text"], .container input[type="url"], .container input[type="number"]').forEach(el => {
    el.addEventListener('input', () => {
      autoSave();
      // URL-Felder: Status zurücksetzen und Provider-State aktualisieren
      if (el.id === 'serviceUrl' || el.id === 'lmStudioUrl' || el.id === 'leitstelleUrl' || el.id === 'cacheServerUrl') {
        if (el.id === 'leitstelleUrl') providerState.leitstelle.tested = null;
        if (el.id === 'serviceUrl') providerState.libretranslate.tested = null;
        if (el.id === 'lmStudioUrl') providerState.lmstudio.tested = null;
        if (el.id === 'cacheServerUrl') providerState.cacheServer.tested = null;
        updateProviderStates();
      }
    });
  });
  document.querySelectorAll('.container input[type="checkbox"], .container select, .container input[type="range"]').forEach(el => {
    el.addEventListener('change', () => autoSave(0));
  });

  // Zurücksetzen
  const resetBtn = document.getElementById('resetBtn');
  if (resetBtn) {
    resetBtn.addEventListener('click', resetSettings);
  }

  // Leitstelle: Schlüssel nur lokal speichern (nie sync), dann Verbindung prüfen
  const leitstelleKeyEl = document.getElementById('leitstelleKey');
  if (leitstelleKeyEl) {
    let keyTimer = null;
    leitstelleKeyEl.addEventListener('input', () => {
      providerState.leitstelle.tested = null;
      updateProviderStates();
      clearTimeout(keyTimer);
      keyTimer = setTimeout(saveLeitstelleKey, 400);
    });
  }
  const testLeitstelleBtn = document.getElementById('testLeitstelle');
  if (testLeitstelleBtn) {
    testLeitstelleBtn.addEventListener('click', () => checkLeitstelle(false));
  }

  // Testen - LibreTranslate
  const testLibreBtn = document.getElementById('testLibre');
  if (testLibreBtn) {
    testLibreBtn.addEventListener('click', () => testConnection('libretranslate'));
  }
  
  // Testen - LM Studio  
  const testLmBtn = document.getElementById('testLmStudio');
  if (testLmBtn) {
    testLmBtn.addEventListener('click', () => testConnection('lmstudio'));
  }
  
  // Provider-Sections (Accordion-Auswahl)
  document.querySelectorAll('.provider-section .section-header').forEach(header => {
    header.addEventListener('click', () => {
      const section = header.closest('.provider-section');
      if (section && !section.classList.contains('active')) {
        setApiType(section.dataset.provider, true);
      }
    });
  });
  
  // Modelle laden Button (falls vorhanden)
  const refreshModelsBtn = document.getElementById('refreshModelsBtn');
  if (refreshModelsBtn) {
    refreshModelsBtn.addEventListener('click', loadLMStudioModels);
  }
  
  // Temperatur Slider (falls Label vorhanden)
  const tempSlider = document.getElementById('lmStudioTemperature');
  const tempValue = document.getElementById('temperatureValue');
  if (tempSlider && tempValue) {
    tempSlider.addEventListener('input', (e) => {
      tempValue.textContent = e.target.value;
    });
  }
  
  // Seiten-Batch-Größe Slider (v3.11.5)
  const pageBatchSlider = document.getElementById('pageBatchSize');
  const pageBatchValue = document.getElementById('pageBatchSizeValue');
  if (pageBatchSlider && pageBatchValue) {
    pageBatchSlider.addEventListener('input', (e) => {
      pageBatchValue.textContent = e.target.value;
    });
  }
  
  // Cache-Server Enabled Checkbox (v3.8)
  const cacheServerEnabledEl = document.getElementById('cacheServerEnabled');
  if (cacheServerEnabledEl) {
    cacheServerEnabledEl.addEventListener('change', (e) => {
      updateCacheServerUI(e.target.checked);
    });
  }

  // Cache-Modus: Server-Felder ein/ausblenden + sofort speichern
  const cacheModeEl = document.getElementById('cacheServerMode');
  if (cacheModeEl) {
    cacheModeEl.addEventListener('change', () => {
      updateCacheServerFields();
      chrome.storage.sync.set({ cacheServerMode: cacheModeEl.value });
    });
  }
  
  // Cache-Server Test Button
  const testCacheBtn = document.getElementById('testCacheServer');
  if (testCacheBtn) {
    testCacheBtn.addEventListener('click', testCacheServer);
  }
  
  // Sprachen hinzufügen
  setupLanguageAdd('Libre');
  setupLanguageAdd('LM');

  // Sync Buttons
  const syncUploadBtn = document.getElementById('syncUpload');
  const syncDownloadBtn = document.getElementById('syncDownload');
  if (syncUploadBtn) {
    syncUploadBtn.addEventListener('click', syncLocalToServer);
  }
  if (syncDownloadBtn) {
    syncDownloadBtn.addEventListener('click', syncServerToLocal);
  }
  
}

function setApiType(type, save = false) {
  // Provider-Sections umschalten (Accordion)
  document.querySelectorAll('.provider-section').forEach(section => {
    section.classList.toggle('active', section.dataset.provider === type);
  });

  // Aktiv-Badges umschalten
  const badges = { leitstelle: 'leitstelleBadge', libretranslate: 'libreBadge', lmstudio: 'lmBadge' };
  for (const [provider, id] of Object.entries(badges)) {
    document.getElementById(id)?.classList.toggle('hidden', type !== provider);
  }

  // Gewählten Weg gleich prüfen, damit der Status stimmt (lädt kein Modell)
  if (type === 'leitstelle') {
    checkLeitstelle(true);
  }
  if (type === 'lmstudio') {
    loadLMStudioModels();
  }

  // Sofort speichern wenn vom User geklickt
  if (save) {
    chrome.storage.sync.set({ apiType: type });
  }
}


// Modell-Select Rendering -- getrennt von Datenlogik
function setModelSelectState(select, state, models = []) {
  const states = {
    loading: '<option value="">Lade...</option>',
    empty:   '<option value="">Keine Modelle</option>',
    error:   '<option value="">Nicht erreichbar</option>'
  };

  if (states[state]) {
    select.innerHTML = states[state];
    return;
  }

  // state === 'loaded'
  select.innerHTML = '';
  for (const model of models) {
    const option = document.createElement('option');
    option.value = model.id;
    option.textContent = model.id.split('/').pop();
    select.appendChild(option);
  }

  // Gespeichertes Modell wiederherstellen (einmalig nach Seitenaufruf)
  const saved = select.dataset.savedModel;
  if (saved && Array.from(select.options).some(o => o.value === saved)) {
    select.value = saved;
    delete select.dataset.savedModel;
  }
}

function setRefreshBtnState(btn, loading) {
  if (!btn) return;
  btn.disabled = loading;
  btn.innerHTML = loading ? '<div class="spinner-small"></div>' : SWT.Icons.svg('sync');
}

async function loadLMStudioModels() {
  const urlEl = document.getElementById('lmStudioUrl');
  const modelSelect = document.getElementById('lmStudioModel');
  const refreshBtn = document.getElementById('refreshModelsBtn');
  const url = urlEl ? urlEl.value.trim() : '';

  if (!url || !modelSelect) return;

  setRefreshBtnState(refreshBtn, true);
  setModelSelectState(modelSelect, 'loading');

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`${url}/v1/models`, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();

    setProviderTested('lmstudio', true);
    if (data.data && data.data.length > 0) {
      setModelSelectState(modelSelect, 'loaded', data.data);
      SWT.Toast.show(`${data.data.length} Modell(e) geladen`, 'success');
    } else {
      setModelSelectState(modelSelect, 'empty');
    }
  } catch (error) {
    console.warn('LM Studio:', error);
    setProviderTested('lmstudio', false);
    setModelSelectState(modelSelect, 'error');
    if (error.name === 'AbortError') {
      SWT.Toast.show(chrome.i18n.getMessage('errTimeout'));
    }
  }

  setRefreshBtnState(refreshBtn, false);
}

// ============================================================================
// Leitstelle
// ============================================================================

async function saveLeitstelleKey() {
  const key = document.getElementById('leitstelleKey')?.value.trim() || '';
  if (key) {
    await chrome.storage.local.set({ leitstelleKey: key });
  } else {
    await chrome.storage.local.remove('leitstelleKey');
  }
}

/** Optionen der Modellwahl: erste Option bleibt "Kette der Leitstelle" */
function setModelSelectOptions(select, models) {
  const chain = select.options[0];
  select.replaceChildren(chain);
  for (const id of models) {
    select.appendChild(new Option(id.split('/').pop(), id));
  }
}

/**
 * Verbindung prüfen: GET /v1/models mit Schlüssel über den Service Worker (dort liegt der Anbieter).
 * silent: beim Öffnen der Seite ohne Hinweise, nur Status und Modellliste
 */
async function checkLeitstelle(silent) {
  const url = document.getElementById('leitstelleUrl')?.value.trim();
  const key = document.getElementById('leitstelleKey')?.value.trim();
  const btn = document.getElementById('testLeitstelle');
  const resultEl = document.getElementById('leitstelleTestResult');
  const select = document.getElementById('leitstelleModel');
  if (!url || !key || !select) {
    if (!silent) showTestResult(resultEl, false, chrome.i18n.getMessage(url ? 'errLeitstelleNoKey' : 'errLeitstelleNoUrl'));
    return;
  }

  await saveLeitstelleKey();
  if (btn) btn.disabled = true;
  if (!silent) showTestResult(resultEl, null, '...');

  const result = await chrome.runtime.sendMessage({ action: 'TEST_LEITSTELLE', url })
    .catch(e => ({ success: false, error: e.message }));

  if (result.success) {
    const chosen = select.value;
    setModelSelectOptions(select, result.models);
    select.value = result.models.includes(chosen) ? chosen : '';
    if (!silent) showTestResult(resultEl, true, chrome.i18n.getMessage('msgLeitstelleConnected', [String(result.models.length)]));
  } else if (!silent) {
    showTestResult(resultEl, false, result.error);
  }
  setProviderTested('leitstelle', result.success);
  if (btn) btn.disabled = false;
}

function showTestResult(el, success, text) {
  if (!el) return;
  el.style.display = 'inline-block';
  el.className = 'test-result' + (success === true ? ' success' : success === false ? ' error' : '');
  el.textContent = success === true ? `✓ ${text}` : success === false ? `✗ ${text}` : text;
}

async function saveSettings() {
  try {
    // Hilfsfunktion für sichere Wertabfrage
    const getVal = (id, defaultVal = '') => {
      const el = document.getElementById(id);
      return el ? el.value : defaultVal;
    };
    const getChecked = (id, defaultVal = false) => {
      const el = document.getElementById(id);
      return el ? el.checked : defaultVal;
    };
    const getInt = (id, defaultVal) => {
      const el = document.getElementById(id);
      return el ? (parseInt(el.value) || defaultVal) : defaultVal;
    };
    const getFloat = (id, defaultVal) => {
      const el = document.getElementById(id);
      return el ? (parseFloat(el.value) || defaultVal) : defaultVal;
    };

    // Aktiven API-Typ ermitteln
    const activeSection = document.querySelector('.provider-section.active');
    const apiType = SWT.Providers.current(activeSection?.dataset.provider);

    const settings = {
      // API-Typ
      apiType: apiType,

      // Leitstelle (ohne Schlüssel: der liegt nur in chrome.storage.local)
      leitstelleUrl: getVal('leitstelleUrl', '').trim(),
      leitstelleModel: getVal('leitstelleModel', ''),
      
      // LibreTranslate
      serviceUrl: getVal('serviceUrl', '').trim(),
      apiKey: getVal('apiKey', '').trim(),
      
      // LM Studio
      lmStudioUrl: getVal('lmStudioUrl', '').trim(),
      lmStudioModel: getVal('lmStudioModel', '') || (await chrome.storage.sync.get('lmStudioModel')).lmStudioModel || '',
      lmStudioTemperature: getFloat('lmStudioTemperature', 0.1),
      lmStudioMaxTokens: getInt('lmStudioMaxTokens', 2000),
      
      // Batch
      pageBatchSize: getInt('pageBatchSize', 20),
      useCacheFirst: getChecked('useCacheFirst', true),
      
      // UI Optionen
      showSelectionIcon: getChecked('showSelectionIcon', true),
      enableTTS: getChecked('enableTTS', true),
      showAlternatives: getChecked('showAlternatives', true),
      
      // Inhaltsfilter
      skipCodeBlocks: getChecked('skipCodeBlocks', true),
      skipBlockquotes: getChecked('skipBlockquotes', true),
      fixInlineSpacing: getChecked('fixInlineSpacing', true),
      
      // Cache-Server
      cacheServerEnabled: getChecked('cacheServerEnabled', true),
      cacheServerUrl: getVal('cacheServerUrl', '').trim(),
      cacheServerMode: getVal('cacheServerMode', 'server-only'),
      cacheServerTimeout: getInt('cacheServerTimeout', 5000),

      // Sprachenlisten
      languagesLibre,
      languagesLM
    };

    await chrome.storage.sync.set(settings);
    SWT.Toast.show(chrome.i18n.getMessage('msgSettingsSaved'));
  } catch (error) {
    SWT.Toast.show('Fehler beim Speichern: ' + error.message, 'error');
  }
}

async function resetSettings() {
  // Wie nach der Installation: alle Vorgaben aus einer Quelle (der Schlüssel der Leitstelle bleibt)
  const defaultSettings = SWT.Storage.defaultSettings;

  try {
    await chrome.storage.sync.set(defaultSettings);
    await loadSettings();
    SWT.Toast.show(chrome.i18n.getMessage('msgSettingsReset'));
  } catch (error) {
    SWT.Toast.show('Fehler beim Zurücksetzen: ' + error.message, 'error');
  }
}

async function testConnection(apiType) {
  const testInput = 'Hello, world!';
  
  // Buttons und Results je nach Typ
  let testBtn, testResultEl;
  if (apiType === 'libretranslate') {
    testBtn = document.getElementById('testLibre');
    testResultEl = document.getElementById('libreTestResult');
  } else {
    testBtn = document.getElementById('testLmStudio');
    testResultEl = document.getElementById('lmTestResult');
  }
  
  if (!testBtn || !testResultEl) return;

  testBtn.disabled = true;
  testBtn.textContent = chrome.i18n.getMessage('btnTesting');
  testResultEl.style.display = 'inline-block';
  testResultEl.textContent = '...';
  testResultEl.className = 'test-result';

  try {
    let result;
    
    result = await testTranslate(apiType, testInput);

    if (result.success) {
      testResultEl.textContent = `✓ OK: "${result.translation}"`;
      testResultEl.classList.add('success');
      setProviderTested(apiType === 'libretranslate' ? 'libretranslate' : 'lmstudio', true);
    } else {
      throw new Error(result.error);
    }

  } catch (error) {
    testResultEl.textContent = `✗ ${error.message}`;
    testResultEl.classList.add('error');
    setProviderTested(apiType === 'libretranslate' ? 'libretranslate' : 'lmstudio', false);
  }

  testBtn.disabled = false;
  testBtn.textContent = chrome.i18n.getMessage('btnTestConnection');
}

/**
 * Probeübersetzung über den Service Worker: derselbe Anbieter-Code wie beim echten Übersetzen
 */
async function testTranslate(apiType, testInput) {
  const getVal = (id) => document.getElementById(id)?.value.trim() || '';
  const settings = apiType === 'libretranslate'
    ? { apiType, serviceUrl: getVal('serviceUrl'), apiKey: getVal('apiKey') }
    : {
        apiType,
        lmStudioUrl: getVal('lmStudioUrl'),
        lmStudioModel: getVal('lmStudioModel'),
        lmStudioTemperature: parseFloat(getVal('lmStudioTemperature')) || 0.1,
        lmStudioMaxTokens: parseInt(getVal('lmStudioMaxTokens')) || 2000
      };

  const result = await chrome.runtime.sendMessage({ action: 'TEST_TRANSLATE', text: testInput, settings });
  if (!result?.success) throw new Error(result?.error || chrome.i18n.getMessage('errNoTranslation'));
  return { success: true, translation: result.translatedText };
}

// ============================================================================
// Cache-Backend Funktionen (v3.8)
// ============================================================================

/**
 * Cache-Server UI aktualisieren
 */
function updateCacheServerUI(enabled) {
  const panel = document.getElementById('cacheserver-settings');
  if (panel) panel.classList.toggle('active', enabled);
  updateCacheServerFields();
}

function updateCacheServerFields() {
  const mode = document.getElementById('cacheServerMode')?.value || 'server-only';
  const needsServer = mode !== 'local-only';
  const serverFields = document.getElementById('cacheServerFields');
  if (serverFields) serverFields.classList.toggle('hidden', !needsServer);

  // Server-Optionen im Dropdown deaktivieren wenn keine Cache-URL
  const url = document.getElementById('cacheServerUrl')?.value.trim();
  const modeSelect = document.getElementById('cacheServerMode');
  if (modeSelect) {
    for (const opt of modeSelect.options) {
      if (opt.value !== 'local-only') {
        opt.disabled = !url;
      }
    }
  }
}

// === Provider-Status ===

function updateProviderStates() {
  const leitstelleUrl = document.getElementById('leitstelleUrl')?.value.trim();
  const leitstelleKey = document.getElementById('leitstelleKey')?.value.trim();
  const libreUrl = document.getElementById('serviceUrl')?.value.trim();
  const lmUrl = document.getElementById('lmStudioUrl')?.value.trim();
  const cacheUrl = document.getElementById('cacheServerUrl')?.value.trim();

  providerState.leitstelle.configured = !!(leitstelleUrl && leitstelleKey);
  providerState.libretranslate.configured = !!libreUrl;
  providerState.lmstudio.configured = !!lmUrl;
  providerState.cacheServer.configured = !!cacheUrl;

  // URL geändert -> Test-Status zurücksetzen
  updateStatusBadge('leitstelleStatus', providerState.leitstelle);
  updateStatusBadge('libreStatus', providerState.libretranslate);
  updateStatusBadge('lmStatus', providerState.lmstudio);

  updateCacheServerFields();
}

function updateStatusBadge(id, state) {
  const el = document.getElementById(id);
  if (!el) return;

  // Gewählte Wege werden beim Öffnen geprüft; eingetragene, aber nicht geprüfte zeigen nur "eingetragen"
  const status = !state.configured ? ['statusUnconfigured', 'unconfigured']
    : state.tested === true ? ['statusConnected', 'ok']
    : state.tested === false ? ['statusUnreachable', 'error']
    : ['statusConfigured', 'pending'];
  el.textContent = chrome.i18n.getMessage(status[0]);
  el.className = `api-status ${status[1]}`;
}

function setProviderTested(provider, success) {
  providerState[provider].tested = success;
  if (provider === 'leitstelle') updateStatusBadge('leitstelleStatus', providerState.leitstelle);
  if (provider === 'libretranslate') updateStatusBadge('libreStatus', providerState.libretranslate);
  if (provider === 'lmstudio') updateStatusBadge('lmStatus', providerState.lmstudio);
}

/**
 * Cache-Server Verbindung testen
 */
async function testCacheServer() {
  const urlEl = document.getElementById('cacheServerUrl');
  const resultEl = document.getElementById('cacheServerTestResult');
  const statsEl = document.getElementById('cacheServerStats');
  const totalEl = document.getElementById('cacheServerTotal');
  const sizeEl = document.getElementById('cacheServerSize');
  
  const url = (urlEl ? urlEl.value.trim() : '').replace(/\/$/, '');
  
  if (!url) {
    if (resultEl) {
      resultEl.textContent = chrome.i18n.getMessage('errEnterUrl');
      resultEl.className = 'test-result error';
      resultEl.classList.remove('hidden');
    }
    return;
  }
  
  if (resultEl) {
    resultEl.textContent = chrome.i18n.getMessage('btnTesting');
    resultEl.className = 'test-result';
    resultEl.classList.remove('hidden');
  }
  
  try {
    // Health-Check
    const healthResponse = await fetch(`${url}/health`, {
      signal: AbortSignal.timeout(5000)
    });
    
    if (!healthResponse.ok) {
      throw new Error(`HTTP ${healthResponse.status}`);
    }
    
    const healthData = await healthResponse.json();
    
    // Stats abrufen
    const statsResponse = await fetch(`${url}/stats`, {
      signal: AbortSignal.timeout(5000)
    });
    
    if (resultEl) {
      // Version nur anzeigen wenn vorhanden
      const versionStr = healthData.version ? ` (v${healthData.version})` : '';
      resultEl.textContent = `✓ Verbunden${versionStr}`;
      resultEl.className = 'test-result success';
    }
    
    if (statsResponse.ok && statsEl) {
      const stats = await statsResponse.json();
      statsEl.classList.remove('hidden');
      
      // Verschiedene mögliche Feldnamen unterstützen
      const total = stats.total_translations || stats.total_entries || stats.entries || 0;
      const sizeMb = stats.cache_size_mb || (stats.db_size ? stats.db_size / 1024 / 1024 : 0) || 0;
      
      if (totalEl) totalEl.textContent = total.toLocaleString();
      if (sizeEl) sizeEl.textContent = sizeMb.toFixed(1);
    }
  } catch (error) {
    if (resultEl) {
      resultEl.textContent = '✗ ' + (error.message || 'Verbindungsfehler');
      resultEl.className = 'test-result error';
    }
    if (statsEl) statsEl.classList.add('hidden');
  }
}

/**
 * Lokalen Cache zum Server hochladen
 */
async function syncLocalToServer() {
  const btn = document.getElementById('syncUpload');
  if (btn) btn.disabled = true;
  
  try {
    // Lokalen Cache aus chrome.storage.local laden
    const localData = await chrome.storage.local.get(null);
    const translations = [];
    
    // Übersetzungs-Einträge filtern (Format: translation_hash_xxx)
    for (const [key, value] of Object.entries(localData)) {
      if (key.startsWith('translation_') && value.original && value.translated) {
        translations.push({
          original: value.original,
          translated: value.translated,
          translator: value.translator || 'local'
        });
      }
    }
    
    if (translations.length === 0) {
      SWT.Toast.show(chrome.i18n.getMessage('errNoLocalCache'), 'warning');
      return;
    }
    
    const url = document.getElementById('cacheServerUrl')?.value?.trim()?.replace(/\/$/, '');
    if (!url) {
      SWT.Toast.show(chrome.i18n.getMessage('errEnterServerUrl'), 'error');
      return;
    }
    
    const response = await fetch(`${url}/cache/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ translations })
    });
    
    if (response.ok) {
      const result = await response.json();
      SWT.Toast.show(`Upload: ${result.created} neu, ${result.updated} aktualisiert`);
    } else {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (error) {
    SWT.Toast.show(chrome.i18n.getMessage('errUploadFailed') + ': ' + error.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

/**
 * Server-Cache lokal speichern (Placeholder - benötigt Search-API)
 */
async function syncServerToLocal() {
  SWT.Toast.show(chrome.i18n.getMessage('errDownloadNotImpl'), 'warning');
}

// ============================================================================
// Sprachenlisten-Verwaltung
// ============================================================================

const PROTECTED_LANG_CODES = ['auto', 'en', 'de'];

function renderLanguageList(provider, languages) {
  const container = document.getElementById(`languages${provider}List`);
  if (!container) return;
  container.innerHTML = '';
  languages.forEach((lang, index) => {
    const tag = document.createElement('span');
    const isProtected = PROTECTED_LANG_CODES.includes(lang.code);
    tag.className = 'language-tag' + (isProtected ? ' protected' : '');
    const codeSpan = document.createElement('span');
    codeSpan.className = 'lang-code';
    codeSpan.textContent = lang.code;
    tag.appendChild(codeSpan);
    tag.appendChild(document.createTextNode(lang.name));
    if (!isProtected) {
      const removeBtn = document.createElement('button');
      removeBtn.className = 'lang-remove';
      removeBtn.dataset.index = index;
      removeBtn.textContent = '\u00d7';
      tag.appendChild(removeBtn);
    }
    container.appendChild(tag);
  });

  // Remove-Handler
  container.querySelectorAll('.lang-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.index);
      const list = provider === 'Libre' ? languagesLibre : languagesLM;
      list.splice(idx, 1);
      renderLanguageList(provider, list);
      saveSettings();
    });
  });
}

function setupLanguageAdd(provider) {
  const addBtn = document.getElementById(`languages${provider}Add`);
  const codeInput = document.getElementById(`languages${provider}Code`);
  const nameInput = document.getElementById(`languages${provider}Name`);
  if (!addBtn || !codeInput || !nameInput) return;

  const doAdd = () => {
    const code = codeInput.value.trim().toLowerCase();
    const name = nameInput.value.trim();
    if (!code || !name) return;

    const list = provider === 'Libre' ? languagesLibre : languagesLM;
    if (list.some(l => l.code === code)) {
      SWT.Toast.show(`Sprache "${code}" existiert bereits`, 'error');
      return;
    }
    list.push({ code, name });
    renderLanguageList(provider, list);
    codeInput.value = '';
    nameInput.value = '';
    saveSettings();
  };

  addBtn.addEventListener('click', doAdd);
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAdd(); });
  codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') nameInput.focus(); });
}

// CSS für Spinner
const style = document.createElement('style');
style.textContent = `
  @keyframes spin { to { transform: rotate(360deg); } }
  .spinner-small {
    width: 14px;
    height: 14px;
    border: 2px solid #D1D5DB;
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
`;
document.head.appendChild(style);
