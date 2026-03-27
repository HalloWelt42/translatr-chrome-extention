// Popup
// Refactored: Nutzt SWT.Utils, SWT.Toast, SWT.ApiBadge

// ==========================================================================
// State-Ableitung: Reine Logik, kein DOM
// ==========================================================================
const PopupState = {
  derivePage(response) {
    if (!response) return { translate: true, restore: false, active: false };
    return {
      translate: true,
      restore: response.isTranslated || response.translatedCount > 0,
      active: !!response.isTranslated
    };
  },

  deriveLed(settings) {
    const mode = settings.cacheServerMode || 'server-only';
    const enabled = settings.cacheServerEnabled !== false;
    const map = {
      disabled:    { led: 'led-off',    text: 'Cache aus' },
      'local-only':  { led: 'led-green',  text: 'Lokal' },
      'server-only': { led: 'led-green',  text: 'Server' },
      fallback:    { led: 'led-yellow', text: 'Hybrid' }
    };
    const key = !enabled ? 'disabled' : (map[mode] ? mode : 'fallback');
    return map[key];
  }
};

// ==========================================================================
// Renderer: Wendet State auf DOM an, keine Logik
// ==========================================================================
const PopupRenderer = {
  applyPageState(state) {
    const translateBtn = document.getElementById('translatePage');
    const restoreBtn = document.getElementById('restorePage');
    translateBtn.classList.toggle('disabled', !state.translate);
    translateBtn.classList.toggle('active', state.active);
    restoreBtn.classList.toggle('disabled', !state.restore);
  },

  applyLed(state) {
    const led = document.getElementById('cacheLed');
    const text = document.getElementById('cacheBadgeText');
    if (led) led.className = `led ${state.led}`;
    if (text) text.textContent = state.text;
  },

  setButtonLoading(btn, loading) {
    btn.disabled = loading;
    btn.innerHTML = loading
      ? '<div class="spinner"></div> Übersetze...'
      : `${SWT.Icons.svg('translate')} Übersetzen`;
  },

  setSpeakButton(btn, mode) {
    const icons = { idle: 'volumeUp', speaking: 'stop' };
    const labels = { idle: 'Vorlesen', speaking: 'Stoppen' };
    btn.innerHTML = `${SWT.Icons.svg(icons[mode])} ${labels[mode]}`;
  },

  showResult(box, text, isError) {
    box.classList.add('show');
    box.classList.toggle('error', isError);
    box.textContent = text;
  },

  showCache(count, size) {
    const el = document.getElementById('cacheStatus');
    if (!el) return;
    el.style.display = 'flex';
    document.getElementById('cacheSize').textContent = SWT.Utils.formatBytes(size);
    document.getElementById('cacheHint').textContent = `${count} Seite(n) gecacht`;
  }
};

// ==========================================================================
// Controller
// ==========================================================================
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await checkPageCache();
  setupEventListeners();
  updateActionStates();

  setInterval(updateActionStates, 5000);

  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'PAGE_STATUS_CHANGED') {
      updateActionStates();
    }
  });
});

async function updateActionStates() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
      PopupRenderer.applyPageState({ translate: false, restore: false, active: false });
      return;
    }

    const response = await chrome.tabs.sendMessage(tab.id, { action: 'GET_PAGE_INFO' }).catch(() => null);
    PopupRenderer.applyPageState(PopupState.derivePage(response));
  } catch (e) {}
}

async function loadSettings() {
  const settings = await chrome.storage.sync.get([
    'sourceLang', 'targetLang', 'apiType',
    'serviceUrl', 'lmStudioUrl',
    'cacheServerEnabled', 'cacheServerMode'
  ]);
  document.getElementById('sourceLang').value = settings.sourceLang || 'auto';
  document.getElementById('targetLang').value = settings.targetLang || 'de';

  const apiType = settings.apiType || 'libretranslate';
  const apiConfigured = (apiType === 'libretranslate' && settings.serviceUrl)
    || (apiType === 'lmstudio' && settings.lmStudioUrl);

  if (!apiConfigured) {
    document.querySelectorAll('#translateBtn, #translatePage').forEach(el => {
      el.classList.add('disabled');
      el.style.opacity = '0.4';
    });
  }

  SWT.ApiBadge.update(apiType);

  // LED-Status
  const apiLed = document.getElementById('apiLed');
  if (apiLed) apiLed.className = 'led led-green';
  PopupRenderer.applyLed(PopupState.deriveLed(settings));
}

async function checkPageCache() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    const response = await chrome.tabs.sendMessage(tab.id, { action: 'GET_CACHE_INFO' });
    if (response?.currentPageHasCache) {
      PopupRenderer.showCache(response.entries.length, response.size);
    }
  } catch (e) {}
}

function setupEventListeners() {
  const translateBtn = document.getElementById('translateBtn');
  const inputText = document.getElementById('inputText');
  const resultBox = document.getElementById('resultBox');
  const resultActions = document.getElementById('resultActions');

  // Quick Translate
  translateBtn.addEventListener('click', async () => {
    const text = inputText.value.trim();
    if (!text) return;

    const sourceLang = document.getElementById('sourceLang').value;
    const targetLang = document.getElementById('targetLang').value;

    PopupRenderer.setButtonLoading(translateBtn, true);

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'TRANSLATE', text, source: sourceLang, target: targetLang
      });

      if (response.success) {
        PopupRenderer.showResult(resultBox, response.translatedText, false);
        resultActions.style.display = 'flex';

        await chrome.runtime.sendMessage({
          action: 'ADD_TO_HISTORY',
          entry: { original: text, translated: response.translatedText,
                   source: sourceLang, target: targetLang, timestamp: Date.now() }
        });
      } else {
        PopupRenderer.showResult(resultBox, 'Fehler: ' + (response.error || 'Unbekannt'), true);
      }
    } catch (error) {
      PopupRenderer.showResult(resultBox, 'Verbindungsfehler: ' + error.message, true);
    }

    PopupRenderer.setButtonLoading(translateBtn, false);
  });

  // Enter zum Übersetzen
  inputText.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      translateBtn.click();
    }
  });

  // Sprachen speichern
  document.getElementById('sourceLang').addEventListener('change', saveLanguages);
  document.getElementById('targetLang').addEventListener('change', saveLanguages);

  // Sprachen tauschen
  document.getElementById('swapLangs').addEventListener('click', () => {
    const source = document.getElementById('sourceLang');
    const target = document.getElementById('targetLang');
    if (source.value !== 'auto') {
      const temp = source.value;
      source.value = target.value;
      target.value = temp;
      saveLanguages();
    }
  });

  // Kopieren
  document.getElementById('copyResult').addEventListener('click', () => {
    navigator.clipboard.writeText(resultBox.textContent);
    SWT.Toast.show('Kopiert!');
  });

  // Click-to-Copy auf resultBox
  resultBox.addEventListener('click', () => {
    const text = resultBox.textContent.trim();
    if (text && !resultBox.classList.contains('error')) {
      navigator.clipboard.writeText(text);
      resultBox.classList.add('copied');
      SWT.Toast.show('Übersetzung kopiert!');
      setTimeout(() => resultBox.classList.remove('copied'), 1500);
    }
  });

  // Vorlesen mit Toggle
  const speakBtn = document.getElementById('speakResult');
  speakBtn.addEventListener('click', () => {
    if (speechSynthesis.speaking) {
      speechSynthesis.cancel();
      PopupRenderer.setSpeakButton(speakBtn, 'idle');
      return;
    }

    PopupRenderer.setSpeakButton(speakBtn, 'speaking');

    const targetLang = document.getElementById('targetLang').value;
    const utterance = new SpeechSynthesisUtterance(resultBox.textContent);
    utterance.lang = SWT.Utils.getLangCode(targetLang);
    utterance.onend = () => PopupRenderer.setSpeakButton(speakBtn, 'idle');
    speechSynthesis.speak(utterance);
  });

  // Cache laden
  document.getElementById('loadCacheBtn')?.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.tabs.sendMessage(tab.id, { action: 'LOAD_CACHED_TRANSLATION' });
    window.close();
  });

  // Page Actions -- datengetrieben
  const pageActions = {
    translatePage: { action: 'TRANSLATE_PAGE', data: { mode: 'replace' } },
    restorePage:   { action: 'RESTORE_PAGE' },
    exportPdf:     { action: 'EXPORT_PDF' }
  };

  for (const [id, cfg] of Object.entries(pageActions)) {
    document.getElementById(id).addEventListener('click', async () => {
      const btn = document.getElementById(id);
      if (btn.classList.contains('disabled')) return;
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.tabs.sendMessage(tab.id, { action: cfg.action, ...(cfg.data || {}) }).catch(() => {});
      window.close();
    });
  }

  // Sidepanel öffnen
  document.getElementById('openSidepanel').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.sidePanel.open({ tabId: tab.id });
    window.close();
  });

  // Footer Links
  document.getElementById('openOptions').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  document.getElementById('manageCache').addEventListener('click', async (e) => {
    e.preventDefault();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.sidePanel.open({ tabId: tab.id });
    setTimeout(() => chrome.runtime.sendMessage({ action: 'SIDEPANEL_SHOW_CACHE' }), 300);
    window.close();
  });

  document.getElementById('openDonate').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('pages/donate.html') });
  });
}

async function saveLanguages() {
  const sourceLang = document.getElementById('sourceLang').value;
  const targetLang = document.getElementById('targetLang').value;
  await chrome.storage.sync.set({ sourceLang, targetLang });
}
