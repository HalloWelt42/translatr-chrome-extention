// Options
// Refactored: Nutzt SWT.Toast

document.addEventListener('DOMContentLoaded', async () => {
  const versionEl = document.getElementById('appVersion');
  if (versionEl) versionEl.textContent = chrome.runtime.getManifest().version;
  await loadSettings();
  setupEventListeners();
});

// Fachkontext System-Prompts
const CONTEXT_PROMPTS = {
  general: `Du bist ein präziser Übersetzer. Übersetze den folgenden Text von {source} nach {target}.
Gib eine natürliche, flüssige Übersetzung. Behalte die Formatierung bei.
Antworte NUR mit einem JSON-Objekt im Format: {"translation": "deine Übersetzung", "alternatives": ["alternative1", "alternative2"]}`,

  automotive: `Du bist ein Kfz-Fachübersetzer für {source} nach {target}.
WICHTIGE REGELN:
- NIEMALS übersetzen: Teilenummern, OE-Nummern, Codes, Abkürzungen (ABS, ESP, etc.), Markennamen
- Verwende korrekte deutsche Kfz-Fachbegriffe:
  • Control arm → Querlenker
  • Tie rod end → Spurstangenkopf
  • Ball joint → Traggelenk
  • Wheel bearing → Radlager
  • Brake caliper → Bremssattel
  • Strut mount → Domlager
- Bei Unsicherheit: technisch korrekte Variante bevorzugen
Antworte NUR mit JSON: {"translation": "...", "alternatives": ["...", "..."], "context_notes": "Fachhinweise falls relevant"}`,

  technical: `Du bist ein technischer Fachübersetzer {source} → {target}.
REGELN:
- Bewahre absolute technische Präzision
- Belasse etablierte englische Fachbegriffe (API, Cache, Backend, Framework, etc.)
- Verwende korrekte deutsche IT-Terminologie wo üblich
- Code-Beispiele und Variablennamen NIEMALS übersetzen
Antworte NUR mit JSON: {"translation": "...", "alternatives": ["..."]}`,

  medical: `Du bist ein medizinischer Fachübersetzer {source} → {target}.
REGELN:
- Verwende exakte medizinische Terminologie
- Lateinische/griechische Fachbegriffe beibehalten wenn in der Medizin üblich
- Höchste Präzision bei Dosierungen, Maßeinheiten und Anweisungen
- Anatomische Begriffe korrekt übersetzen
Antworte NUR mit JSON: {"translation": "...", "alternatives": ["..."], "context_notes": "Medizinische Hinweise"}`,

  legal: `Du bist ein juristischer Fachübersetzer {source} → {target}.
REGELN:
- Verwende exakte juristische Terminologie des Zielrechtssystems
- Beachte länderspezifische Rechtsbegriffe (deutsches Recht)
- Gesetzesnamen und Paragraphen korrekt übertragen
- Im Zweifel: wörtliche Übersetzung mit erklärender Anmerkung
Antworte NUR mit JSON: {"translation": "...", "alternatives": ["..."], "context_notes": "Rechtliche Anmerkungen"}`,

  custom: '' // Wird vom Benutzer definiert
};

async function loadSettings() {
  try {
    const settings = await chrome.storage.sync.get([
      // API
      'apiType', 'serviceUrl', 'apiKey',
      'lmStudioUrl', 'lmStudioModel', 'lmStudioTemperature', 'lmStudioMaxTokens',
      // Anzeige
      'showSelectionIcon', 'enableTTS', 'showAlternatives',
      // Inhaltsfilter
      'skipCodeBlocks', 'skipBlockquotes', 'fixInlineSpacing',
      // Batch
      'pageBatchSize', 'useCacheFirst',
      // Cache
      'cacheServerEnabled', 'cacheServerUrl', 'cacheServerMode',
      'cacheServerTimeout', 'autoLoadCache',
    ]);

    // Hilfsfunktion für sicheres Setzen
    const setVal = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.value = value;
    };
    const setChecked = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.checked = value;
    };

    // LibreTranslate Werte
    setVal('serviceUrl', settings.serviceUrl);
    setVal('apiKey', settings.apiKey || '');
    
    // LM Studio Werte
    setVal('lmStudioUrl', settings.lmStudioUrl);
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
    const apiType = settings.apiType || 'libretranslate';
    setApiType(apiType);
    
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
    setVal('cacheServerUrl', settings.cacheServerUrl);
    setVal('cacheServerMode', settings.cacheServerMode || 'server-only');
    setVal('cacheServerTimeout', settings.cacheServerTimeout || 5000);
    setChecked('autoLoadCache', settings.autoLoadCache || false);
    updateCacheServerUI(settings.cacheServerEnabled !== false);
    
  } catch (e) {
    console.warn('Smart Translator: Error loading settings', e);
  }
}

function setupEventListeners() {
  // Speichern
  const saveBtn = document.getElementById('saveBtn');
  if (saveBtn) {
    saveBtn.addEventListener('click', saveSettings);
  }

  // Zurücksetzen
  const resetBtn = document.getElementById('resetBtn');
  if (resetBtn) {
    resetBtn.addEventListener('click', resetSettings);
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
  
  // API-Typ Buttons
  document.querySelectorAll('.api-type-option').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.type;
      setApiType(type);
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
  
  // Cache-Server Test Button
  const testCacheBtn = document.getElementById('testCacheServer');
  if (testCacheBtn) {
    testCacheBtn.addEventListener('click', testCacheServer);
  }
  
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

function setApiType(type) {
  // Buttons aktualisieren
  document.querySelectorAll('.api-type-option').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.type === type);
  });
  
  // Einstellungsbereiche umschalten (mit CSS-Klassen)
  const librePanel = document.getElementById('libretranslate-settings');
  const lmPanel = document.getElementById('lmstudio-settings');
  
  if (librePanel) librePanel.classList.toggle('active', type === 'libretranslate');
  if (lmPanel) lmPanel.classList.toggle('active', type === 'lmstudio');
  
  // Wenn LM Studio ausgewählt, Modelle laden
  if (type === 'lmstudio') {
    loadLMStudioModels();
  }
}


async function loadLMStudioModels() {
  const urlEl = document.getElementById('lmStudioUrl');
  const modelSelect = document.getElementById('lmStudioModel');
  const refreshBtn = document.getElementById('refreshModelsBtn');
  
  const url = urlEl ? urlEl.value.trim() : '';
  
  if (!url || !modelSelect) {
    return;
  }
  
  // Loading-State
  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.innerHTML = '<div class="spinner-small"></div>';
  }
  modelSelect.innerHTML = '<option value="">Lade...</option>';
  
  try {
    // Timeout nach 5 Sekunden
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(`${url}/v1/models`, {
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const data = await response.json();
    modelSelect.innerHTML = '';
    
    if (data.data && data.data.length > 0) {
      data.data.forEach(model => {
        const option = document.createElement('option');
        option.value = model.id;
        option.textContent = model.id.split('/').pop();
        modelSelect.appendChild(option);
      });
      // Gespeichertes Modell wiederherstellen (einmalig nach Seitenaufruf)
      const savedModel = modelSelect.dataset.savedModel;
      if (savedModel && Array.from(modelSelect.options).some(o => o.value === savedModel)) {
        modelSelect.value = savedModel;
        delete modelSelect.dataset.savedModel;
      }
      SWT.Toast.show(`${data.data.length} Modell(e) geladen`, 'success');
    } else {
      modelSelect.innerHTML = '<option value="">Keine Modelle</option>';
    }
  } catch (error) {
    console.warn('LM Studio:', error);
    modelSelect.innerHTML = '<option value="">Nicht erreichbar</option>';
    if (error.name === 'AbortError') {
      SWT.Toast.show('Timeout - Server nicht erreichbar');
    }
  }
  
  // Loading-State zurücksetzen
  if (refreshBtn) {
    refreshBtn.disabled = false;
    refreshBtn.innerHTML = SWT.Icons.svg('sync');
  }
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
    const activeOption = document.querySelector('.api-type-option.active');
    const apiType = activeOption ? activeOption.dataset.type : 'libretranslate';
    
    const settings = {
      // API-Typ
      apiType: apiType,
      
      // LibreTranslate
      serviceUrl: getVal('serviceUrl', '').trim(),
      apiKey: getVal('apiKey', '').trim(),
      
      // LM Studio
      lmStudioUrl: getVal('lmStudioUrl', '').trim(),
      lmStudioModel: getVal('lmStudioModel', ''),
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
      autoLoadCache: getChecked('autoLoadCache', false)
    };

    await chrome.storage.sync.set(settings);
    SWT.Toast.show('Einstellungen gespeichert!');
  } catch (error) {
    SWT.Toast.show('Fehler beim Speichern: ' + error.message, 'error');
  }
}

async function resetSettings() {
  const defaultSettings = {
    apiType: 'libretranslate',
    serviceUrl: '',
    apiKey: '',
    lmStudioUrl: '',
    lmStudioModel: '',
    lmStudioTemperature: 0.1,
    lmStudioMaxTokens: 2000,
    pageBatchSize: 20,
    useCacheFirst: true,
    showSelectionIcon: true,
    enableTTS: true,
    showAlternatives: true,
    skipCodeBlocks: true,
    skipBlockquotes: true,
    fixInlineSpacing: true,
    cacheServerEnabled: true,
    cacheServerUrl: '',
    cacheServerMode: 'server-only',
    cacheServerTimeout: 5000,
    autoLoadCache: false
  };

  try {
    await chrome.storage.sync.set(defaultSettings);
    await loadSettings();
    SWT.Toast.show('Einstellungen zurückgesetzt!');
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
  testBtn.textContent = 'Teste...';
  testResultEl.style.display = 'inline-block';
  testResultEl.textContent = '...';
  testResultEl.className = 'test-result';

  try {
    let result;
    
    if (apiType === 'libretranslate') {
      result = await testLibreTranslate(testInput);
    } else {
      result = await testLMStudio(testInput);
    }

    if (result.success) {
      testResultEl.textContent = `✓ OK: "${result.translation}"`;
      testResultEl.classList.add('success');
    } else {
      throw new Error(result.error);
    }

  } catch (error) {
    testResultEl.textContent = `✗ ${error.message}`;
    testResultEl.classList.add('error');
  }

  testBtn.disabled = false;
  testBtn.textContent = 'Verbindung testen';
}

async function testLibreTranslate(testInput) {
  const serviceUrl = document.getElementById('serviceUrl').value.trim();
  const apiKey = document.getElementById('apiKey').value.trim();

  const response = await fetch(serviceUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      q: testInput,
      source: 'auto',
      format: 'text',
      api_key: apiKey
    })
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const result = await response.json();

  if (result.translatedText) {
    return {
      success: true,
      translation: result.translatedText,
      alternatives: result.alternatives || []
    };
  } else {
    throw new Error('Keine Übersetzung in der Antwort');
  }
}

async function testLMStudio(testInput) {
  const url = document.getElementById('lmStudioUrl').value.trim();
  const model = document.getElementById('lmStudioModel').value;
  const temperature = parseFloat(document.getElementById('lmStudioTemperature').value);
  const maxTokens = parseInt(document.getElementById('lmStudioMaxTokens').value);
  
  if (!url) throw new Error('LM Studio URL fehlt');
  if (!model) throw new Error('Kein Modell ausgewählt');
  
  const systemPrompt = CONTEXT_PROMPTS.general
    .replace(/{source}/g, 'Englisch')
    .replace(/{target}/g, 'Deutsch');

  const response = await fetch(`${url}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: testInput }
      ],
      temperature: temperature,
      max_tokens: maxTokens,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'translation',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              translation: { type: 'string' },
              alternatives: { 
                type: 'array',
                items: { type: 'string' }
              },
              context_notes: { type: 'string' }
            },
            required: ['translation'],
            additionalProperties: false
          }
        }
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  const result = await response.json();
  
  if (!result.choices || !result.choices[0]) {
    throw new Error('Ungültige Antwort vom Server');
  }
  
  const content = result.choices[0].message.content;
  
  try {
    const parsed = JSON.parse(content);
    return {
      success: true,
      translation: parsed.translation,
      alternatives: parsed.alternatives || [],
      contextNotes: parsed.context_notes
    };
  } catch (e) {
    // Fallback: Wenn kein JSON, nutze die rohe Antwort
    return {
      success: true,
      translation: content.trim(),
      alternatives: []
    };
  }
}

function getLanguageName(code) {
  const names = {
    'auto': 'Automatisch',
    'en': 'Englisch',
    'de': 'Deutsch',
    'fr': 'Französisch',
    'es': 'Spanisch',
    'it': 'Italienisch',
    'pt': 'Portugiesisch',
    'nl': 'Niederländisch',
    'pl': 'Polnisch',
    'ru': 'Russisch',
    'zh': 'Chinesisch',
    'ja': 'Japanisch',
    'ko': 'Koreanisch',
    'ar': 'Arabisch',
    'tr': 'Türkisch'
  };
  return names[code] || code;
}

function showStatus(message, type) {
  const status = document.getElementById('status');
  if (status) {
    status.textContent = message;
    status.className = 'status ' + type;
    setTimeout(() => {
      status.className = 'status';
    }, 4000);
  }
}

// ============================================================================
// Cache-Backend Funktionen (v3.8)
// ============================================================================

/**
 * Cache-Server UI aktualisieren
 */
function updateCacheServerUI(enabled) {
  const serverPanel = document.getElementById('cacheserver-settings');
  if (serverPanel) {
    serverPanel.classList.toggle('active', enabled);
  }
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
      resultEl.textContent = 'Bitte URL eingeben';
      resultEl.className = 'test-result error';
      resultEl.classList.remove('hidden');
    }
    return;
  }
  
  if (resultEl) {
    resultEl.textContent = 'Teste...';
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
      SWT.Toast.show('Kein lokaler Cache vorhanden', 'warning');
      return;
    }
    
    const url = document.getElementById('cacheServerUrl')?.value?.trim()?.replace(/\/$/, '');
    if (!url) {
      SWT.Toast.show('Bitte Server-URL eingeben', 'error');
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
    SWT.Toast.show('Upload fehlgeschlagen: ' + error.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

/**
 * Server-Cache lokal speichern (Placeholder - benötigt Search-API)
 */
async function syncServerToLocal() {
  SWT.Toast.show('Download-Funktion wird in zukünftiger Version implementiert', 'warning');
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
