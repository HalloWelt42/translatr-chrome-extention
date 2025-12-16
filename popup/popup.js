// Popup
// Refactored: Nutzt SWT.Utils, SWT.Toast, SWT.ApiBadge

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await checkPageCache();
  setupEventListeners();
  updateActionStates();
  
  // Regelmäßig Status aktualisieren
  setInterval(updateActionStates, 2000);
  
  // Auf Status-Änderungen vom Content-Script reagieren
  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'PAGE_STATUS_CHANGED') {
      updateActionStates();
    }
  });
});

async function updateActionStates() {
  const translateBtn = document.getElementById('translatePage');
  const restoreBtn = document.getElementById('restorePage');
  
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) return;
    
    // Nur bei normalen Webseiten
    if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
      translateBtn.classList.add('disabled');
      restoreBtn.classList.add('disabled');
      return;
    }
    
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'GET_PAGE_INFO' }).catch(() => null);
    
    if (!response) {
      translateBtn.classList.remove('disabled', 'active');
      restoreBtn.classList.add('disabled');
      return;
    }
    
    // Translate Button: grün wenn übersetzt
    if (response.isTranslated) {
      translateBtn.classList.add('active');
      translateBtn.classList.remove('disabled');
      restoreBtn.classList.remove('disabled');
    } else {
      translateBtn.classList.remove('active');
      translateBtn.classList.remove('disabled');
      restoreBtn.classList.add('disabled');
    }
  } catch (e) {
    // Bei Fehler: Standard-Zustand
  }
}

async function loadSettings() {
  const settings = await chrome.storage.sync.get([
    'sourceLang', 'targetLang', 'apiType',
    'serviceUrl', 'lmStudioUrl',
    'cacheServerEnabled', 'cacheServerMode'
  ]);
  document.getElementById('sourceLang').value = settings.sourceLang || 'auto';
  document.getElementById('targetLang').value = settings.targetLang || 'de';

  // Pruefen ob API konfiguriert
  const apiType = settings.apiType || 'libretranslate';
  const apiConfigured = (apiType === 'libretranslate' && settings.serviceUrl)
    || (apiType === 'lmstudio' && settings.lmStudioUrl);

  if (!apiConfigured) {
    // Uebersetzen-Buttons deaktivieren
    document.querySelectorAll('#translateBtn, #translatePage').forEach(el => {
      el.classList.add('disabled');
      el.style.opacity = '0.4';
    });
  }

  // API-Badge aktualisieren
  SWT.ApiBadge.update(apiType);

  // LED-Status aktualisieren
  updateLedStatus(settings);
}

function updateLedStatus(settings) {
  const apiLed = document.getElementById('apiLed');
  const cacheLed = document.getElementById('cacheLed');
  const cacheBadgeText = document.getElementById('cacheBadgeText');

  // API LED: gruen = Typ gesetzt
  if (apiLed) {
    apiLed.className = 'led led-green';
  }

  // Cache LED
  if (cacheLed && cacheBadgeText) {
    const mode = settings.cacheServerMode || 'server-only';
    const enabled = settings.cacheServerEnabled !== false;

    if (!enabled) {
      cacheLed.className = 'led led-off';
      cacheBadgeText.textContent = 'Cache aus';
    } else if (mode === 'local-only') {
      cacheLed.className = 'led led-green';
      cacheBadgeText.textContent = 'Lokal';
    } else if (mode === 'server-only') {
      cacheLed.className = 'led led-green';
      cacheBadgeText.textContent = 'Server';
    } else {
      cacheLed.className = 'led led-yellow';
      cacheBadgeText.textContent = 'Hybrid';
    }
  }
}

async function checkPageCache() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    const response = await chrome.tabs.sendMessage(tab.id, { action: 'GET_CACHE_INFO' });

    if (response && response.currentPageHasCache) {
      const cacheStatus = document.getElementById('cacheStatus');
      const cacheSize = document.getElementById('cacheSize');
      const cacheHint = document.getElementById('cacheHint');

      cacheStatus.style.display = 'flex';
      cacheStatus.classList.add('has-cache');
      cacheSize.textContent = SWT.Utils.formatBytes(response.size);
      cacheHint.textContent = `${response.entries.length} Seite(n) gecacht`;
    }
  } catch (e) {
    // Content script nicht geladen
  }
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

    translateBtn.disabled = true;
    translateBtn.innerHTML = '<div class="spinner"></div> Übersetze...';

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'TRANSLATE',
        text,
        source: sourceLang,
        target: targetLang
      });

      resultBox.classList.add('show');
      resultBox.classList.remove('error');

      if (response.success) {
        resultBox.textContent = response.translatedText;
        resultActions.style.display = 'flex';

        await chrome.runtime.sendMessage({
          action: 'ADD_TO_HISTORY',
          entry: {
            original: text,
            translated: response.translatedText,
            source: sourceLang,
            target: targetLang,
            timestamp: Date.now()
          }
        });
      } else {
        resultBox.textContent = 'Fehler: ' + (response.error || 'Unbekannt');
        resultBox.classList.add('error');
      }
    } catch (error) {
      resultBox.classList.add('show', 'error');
      resultBox.textContent = 'Verbindungsfehler: ' + error.message;
    }

    translateBtn.disabled = false;
    translateBtn.innerHTML = `
      ${SWT.Icons.svg('translate')}
      Übersetzen
    `;
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
  document.getElementById('speakResult').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    
    // Wenn gerade spricht → stoppen
    if (speechSynthesis.speaking) {
      speechSynthesis.cancel();
      btn.innerHTML = `
        ${SWT.Icons.svg('volumeUp')}
        Vorlesen
      `;
      return;
    }
    
    // Button auf Stop ändern
    btn.innerHTML = `
      ${SWT.Icons.svg('stop')}
      Stoppen
    `;
    
    const targetLang = document.getElementById('targetLang').value;
    const utterance = new SpeechSynthesisUtterance(resultBox.textContent);
    utterance.lang = SWT.Utils.getLangCode(targetLang);
    
    // Wenn fertig, Button zurücksetzen
    utterance.onend = () => {
      btn.innerHTML = `
        ${SWT.Icons.svg('volumeUp')}
        Vorlesen
      `;
    };
    
    speechSynthesis.speak(utterance);
  });

  // Cache laden
  document.getElementById('loadCacheBtn')?.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.tabs.sendMessage(tab.id, { action: 'LOAD_CACHED_TRANSLATION' });
    window.close();
  });

  // Page Actions
  document.getElementById('translatePage').addEventListener('click', async () => {
    const btn = document.getElementById('translatePage');
    if (btn.classList.contains('disabled')) return;
    
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.tabs.sendMessage(tab.id, { action: 'TRANSLATE_PAGE', mode: 'replace' }).catch(() => {});
    window.close();
  });

  document.getElementById('restorePage').addEventListener('click', async () => {
    const btn = document.getElementById('restorePage');
    if (btn.classList.contains('disabled')) return;
    
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.tabs.sendMessage(tab.id, { action: 'RESTORE_PAGE' });
    window.close();
  });

  document.getElementById('exportPdf').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.tabs.sendMessage(tab.id, { action: 'EXPORT_PDF' });
    window.close();
  });

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
    // Signal zum Side Panel, Cache-Tab zu öffnen
    setTimeout(() => {
      chrome.runtime.sendMessage({ action: 'SIDEPANEL_SHOW_CACHE' });
    }, 300);
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
