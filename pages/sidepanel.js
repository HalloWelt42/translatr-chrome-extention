// Side Panel
// Refactored: Nutzt SWT.Utils, SWT.Toast, SWT.ApiBadge

// ==========================================================================
// PageState: Reine Logik, leitet Aktionszustaende aus Seitendaten ab.
// Kein DOM, kein Rendering -- nur Daten rein, Zustand raus.
// ==========================================================================
const PageState = {
  // Hauptzustand der Seite
  derive(response) {
    if (!response) return 'unavailable';
    if (response.isTranslating) return 'translating';
    if (response.isTranslated) return 'translated';
    if (response.translatedCount > 0 || response.remaining > 0) return 'partial';
    return 'idle';
  },

  // Zustand aller Aktions-Buttons ableiten
  deriveActions(response) {
    const state = this.derive(response);
    const hasCache = response?.cacheAvailable || response?.serverCacheCount > 0;
    const busy = state === 'translating';

    return {
      translate: {
        enabled: !busy && state !== 'unavailable',
        active: state === 'translated',
        label: (state === 'translated' || state === 'partial') ? 'Erneut übersetzen' : 'Seite übersetzen'
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
      }
    };
  }
};

// ==========================================================================
// ActionRenderer: Wendet Zustandsobjekte auf DOM-Elemente an.
// Keine Logik -- nur Zustand rein, DOM-Aenderungen raus.
// ==========================================================================
const ActionRenderer = {
  _els: null,

  init() {
    this._els = {
      translate: document.getElementById('translatePage'),
      continue: document.getElementById('continuePage'),
      restore: document.getElementById('restorePage'),
      loadCache: document.getElementById('loadCache'),
      badge: document.getElementById('cacheProgress')
    };
  },

  apply(actions) {
    this._setButton(this._els.translate, actions.translate);
    this._setButton(this._els.continue, actions.continue);
    this._setButton(this._els.restore, actions.restore);
    this._setButton(this._els.loadCache, actions.loadCache);
    this._setBadge(actions.continue.badge);
    // Label des Übersetzen-Buttons dynamisch anpassen
    const labelSpan = this._els.translate.querySelector('span:last-child');
    if (labelSpan && actions.translate.label) {
      labelSpan.textContent = actions.translate.label;
    }
  },

  disableAll() {
    for (const [key, el] of Object.entries(this._els)) {
      if (key === 'badge') continue;
      el.classList.add('disabled');
      el.classList.remove('active');
      const svg = el.querySelector('svg');
      if (svg) svg.style.fill = '';
    }
    this._setBadge({ text: '–', type: 'empty' });
  },

  _setButton(el, state) {
    el.classList.toggle('disabled', !state.enabled);
    el.classList.toggle('active', !!state.active);
    const svg = el.querySelector('svg');
    if (svg) svg.style.fill = state.active ? 'var(--green)' : '';
  },

  _setBadge(badge) {
    const el = this._els.badge;
    el.textContent = badge.text || '';
    el.className = `action-badge ${badge.type}`;
    el.classList.toggle('hidden', !badge.text);
  }
};

// ==========================================================================

class SidePanelController {
  constructor() {
    this.currentTranslation = '';
    this.init();
  }

  async init() {
    await this.loadSettings();
    this.setupTabs();
    this.setupTranslation();
    this.setupContextSelector();
    this.setupHistory();
    this.setupCache();
    this.setupStats();
    this.setupActions();
    this.setupMessageListener();
  }

  async loadSettings() {
    const settings = await chrome.storage.sync.get([
      'sourceLang', 'targetLang', 'apiType', 'lmStudioContext',
      'languagesLibre', 'languagesLM'
    ]);

    // Sprachenlisten dynamisch befüllen
    const apiType = settings.apiType || 'libretranslate';
    const defaults = SWT.Storage.defaultSettings;
    const languages = apiType === 'lmstudio'
      ? (settings.languagesLM || defaults.languagesLM)
      : (settings.languagesLibre || defaults.languagesLibre);
    this.populateLanguageSelects(languages, settings.sourceLang || 'auto', settings.targetLang || 'de');

    // API-Badge aktualisieren
    SWT.ApiBadge.update(apiType);
    
    // Kontext-Schalter laden und Sichtbarkeit steuern (v3.5.4)
    const contextRow = document.getElementById('contextRow');
    const contextSelect = document.getElementById('contextSelect');
    
    if (contextRow && contextSelect) {
      // Nur bei LLM anzeigen
      if (apiType === 'lmstudio') {
        contextRow.classList.remove('hidden');
        contextSelect.value = settings.lmStudioContext || 'general';
      } else {
        contextRow.classList.add('hidden');
      }
    }
  }

  populateLanguageSelects(languages, selectedSource, selectedTarget) {
    const sourceEl = document.getElementById('sourceLang');
    const targetEl = document.getElementById('targetLang');
    sourceEl.innerHTML = '';
    targetEl.innerHTML = '';

    for (const lang of languages) {
      sourceEl.appendChild(new Option(lang.name, lang.code));
      if (lang.code !== 'auto') {
        targetEl.appendChild(new Option(lang.name, lang.code));
      }
    }

    sourceEl.value = selectedSource;
    targetEl.value = selectedTarget;
    if (!sourceEl.value) sourceEl.value = 'auto';
    if (!targetEl.value) targetEl.value = 'de';
  }

  setupContextSelector() {
    const contextSelect = document.getElementById('contextSelect');
    if (!contextSelect) return;
    
    contextSelect.addEventListener('change', async () => {
      const newContext = contextSelect.value;
      
      // Automatisch speichern
      await chrome.storage.sync.set({ lmStudioContext: newContext });
      
      // Toast anzeigen
      const contextNames = {
        'general': 'Allgemein',
        'automotive': 'Kfz / Automotive',
        'technical': 'Technisch / IT',
        'medical': 'Medizin',
        'legal': 'Recht / Juristisch'
      };
      SWT.Toast.show(`Kontext: ${contextNames[newContext] || newContext}`);
    });
    
    // Storage-Listener für Änderungen von Options-Seite oder Popup
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'sync') return;

      if (changes.lmStudioContext) {
        contextSelect.value = changes.lmStudioContext.newValue || 'general';
      }
      if (changes.apiType) {
        const contextRow = document.getElementById('contextRow');
        if (contextRow) {
          if (changes.apiType.newValue === 'lmstudio') {
            contextRow.classList.remove('hidden');
          } else {
            contextRow.classList.add('hidden');
          }
        }
        SWT.ApiBadge.update(changes.apiType.newValue);
        this.hidePipeline();
        this.loadSettings();
      }
      if (changes.languagesLibre || changes.languagesLM) {
        this.loadSettings();
      }
      if (changes.sourceLang || changes.targetLang) {
        const srcEl = document.getElementById('sourceLang');
        const tgtEl = document.getElementById('targetLang');
        if (changes.sourceLang && srcEl) srcEl.value = changes.sourceLang.newValue;
        if (changes.targetLang && tgtEl) tgtEl.value = changes.targetLang.newValue;
      }
      if (changes.cacheServerMode || changes.cacheServerEnabled) {
        const newMode = changes.cacheServerMode?.newValue;
        if (newMode === 'local-only') {
          this._cacheSource = 'local';
        } else if (newMode === 'server-only') {
          this._cacheSource = 'server';
        }
        // Cache-Tab neu laden wenn aktiv
        if (this.activeTab === 'cache') {
          this.loadCache();
        }
        // Pipeline-Anzeige live aktualisieren
        this.updateActionStates();
      }
    });
  }

  setupTabs() {
    const tabs = document.querySelectorAll('.tab');
    const contents = document.querySelectorAll('.tab-content');

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const targetId = tab.dataset.tab;

        tabs.forEach(t => t.classList.remove('active'));
        contents.forEach(c => c.classList.remove('active'));

        tab.classList.add('active');
        document.getElementById(targetId).classList.add('active');
        
        // Aktiven Tab merken für Auto-Refresh
        this.activeTab = targetId;

        if (targetId === 'cache') this.loadCache();
        if (targetId === 'stats') { this.loadStats(); this.loadHistory(); }
      });
    });
    
    // Auto-Refresh: Stats live aktualisieren, Cache-Liste nie (nur Stats-Zahlen)
    this.activeTab = 'translate';
    setInterval(() => {
      if (this.activeTab === 'cache') this.refreshCacheStats();
      if (this.activeTab === 'stats') this.loadStats();
    }, 2000);
  }

  setupTranslation() {
    const sourceText = document.getElementById('sourceText');
    const translateBtn = document.getElementById('translateBtn');
    const resultBox = document.getElementById('resultBox');
    const resultActions = document.getElementById('resultActions');

    translateBtn.addEventListener('click', () => this.translate());

    sourceText.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.translate();
      }
    });

    // Click-to-Copy für sourceText
    sourceText.addEventListener('click', (e) => {
      const text = sourceText.value.trim();
      if (text && e.detail === 2) { // Doppelklick
        navigator.clipboard.writeText(text);
        SWT.Toast.show('Quelltext kopiert!');
      }
    });

    // Click-to-Copy für resultBox
    resultBox.addEventListener('click', () => {
      if (this.currentTranslation) {
        navigator.clipboard.writeText(this.currentTranslation);
        resultBox.classList.add('copied');
        SWT.Toast.show('Übersetzung kopiert!');
        setTimeout(() => resultBox.classList.remove('copied'), 1500);
      }
    });

    document.getElementById('swapLangs').addEventListener('click', () => {
      const source = document.getElementById('sourceLang');
      const target = document.getElementById('targetLang');
      if (source.value !== 'auto') {
        const temp = source.value;
        source.value = target.value;
        target.value = temp;
        this.saveLanguages();
      }
    });

    document.getElementById('copyResult').addEventListener('click', () => {
      navigator.clipboard.writeText(this.currentTranslation);
      SWT.Toast.show('Kopiert!');
    });

    const speakBtn = document.getElementById('speakResult');
    const setSpeakState = (mode) => {
      const icons = { idle: 'volumeUp', speaking: 'stop' };
      const labels = { idle: 'Vorlesen', speaking: 'Stoppen' };
      speakBtn.innerHTML = `${SWT.Icons.svg(icons[mode])} ${labels[mode]}`;
    };

    speakBtn.addEventListener('click', () => {
      if (speechSynthesis.speaking) {
        speechSynthesis.cancel();
        setSpeakState('idle');
        return;
      }
      setSpeakState('speaking');
      const targetLang = document.getElementById('targetLang').value;
      const utterance = new SpeechSynthesisUtterance(this.currentTranslation);
      utterance.lang = SWT.Utils.getLangCode(targetLang);
      utterance.onend = () => setSpeakState('idle');
      speechSynthesis.speak(utterance);
    });

    document.getElementById('sourceLang').addEventListener('change', () => this.saveLanguages());
    document.getElementById('targetLang').addEventListener('change', () => this.saveLanguages());

    // Clear-Buttons
    document.getElementById('clearSource').addEventListener('click', () => {
      document.getElementById('sourceText').value = '';
      document.getElementById('sourceText').focus();
    });

    document.getElementById('clearResult').addEventListener('click', () => {
      document.getElementById('resultBox').innerHTML = '<span class="placeholder">Übersetzung erscheint hier...</span>';
      document.getElementById('resultActions').style.display = 'none';
      this.currentTranslation = '';
    });
  }

  async translate() {
    const sourceText = document.getElementById('sourceText').value.trim();
    if (!sourceText) return;

    const translateBtn = document.getElementById('translateBtn');
    const resultBox = document.getElementById('resultBox');
    const resultActions = document.getElementById('resultActions');
    const contextNotes = document.getElementById('contextNotes');
    const contextNotesText = document.getElementById('contextNotesText');

    const sourceLang = document.getElementById('sourceLang').value;
    const targetLang = document.getElementById('targetLang').value;

    const setTranslateLoading = (loading) => {
      translateBtn.disabled = loading;
      if (loading) {
        const from = SWT.Utils.getLangName(sourceLang);
        const to = SWT.Utils.getLangName(targetLang);
        translateBtn.innerHTML = `<div class="spinner"></div> ${from} \u2192 ${to}`;
      } else {
        translateBtn.innerHTML = `${SWT.Icons.svg('translate')} Übersetzen`;
      }
    };

    const showResult = (text, isError) => {
      resultBox.classList.toggle('error', isError);
      resultBox.textContent = text;
      if (!isError) resultActions.style.display = 'flex';
    };

    setTranslateLoading(true);
    if (contextNotes) contextNotes.classList.remove('show');

    try {
      const result = await chrome.runtime.sendMessage({
        action: 'TRANSLATE', text: sourceText, source: sourceLang, target: targetLang
      });

      if (result.success) {
        showResult(result.translatedText, false);
        this.currentTranslation = result.translatedText;

        // Source-Indikator im Badge und Pipeline
        SWT.ApiBadge.showSource(result.source || null);
        this.showPipeline(result);

        if (result.contextNotes && contextNotes && contextNotesText) {
          contextNotesText.textContent = result.contextNotes;
          contextNotes.classList.add('show');
        }

        await chrome.runtime.sendMessage({
          action: 'ADD_TO_HISTORY',
          entry: { original: sourceText, translated: result.translatedText,
                   source: sourceLang, target: targetLang,
                   timestamp: Date.now(), apiType: result.apiType }
        });
      } else {
        showResult('Fehler: ' + (result.error || 'Unbekannt'), true);
      }
    } catch (error) {
      showResult('Verbindungsfehler: ' + error.message, true);
    }

    setTranslateLoading(false);
  }

  async saveLanguages() {
    const sourceLang = document.getElementById('sourceLang').value;
    const targetLang = document.getElementById('targetLang').value;
    await chrome.storage.sync.set({ sourceLang, targetLang });
  }

  setupActions() {
    ActionRenderer.init();

    const actions = {
      translatePage:    { action: 'TRANSLATE_PAGE', data: { mode: 'replace' }, delays: [500] },
      continuePage:     { action: 'TRANSLATE_PAGE', data: { mode: 'continue' }, delays: [500] },
      restorePage:      { action: 'RESTORE_PAGE', data: {}, delays: [500] },
      loadCache:        { action: 'LOAD_CACHED_TRANSLATION', data: {}, delays: [2000, 5000] }
    };

    for (const [id, cfg] of Object.entries(actions)) {
      document.getElementById(id).addEventListener('click', async () => {
        if (document.getElementById(id).classList.contains('disabled')) return;
        await this.sendPageAction(cfg.action, cfg.data);
        for (const ms of cfg.delays) {
          setTimeout(() => this.updateActionStates(), ms);
        }
      });
    }

    // Toggles: ID -> { storageKey, default }
    const toggles = {
      toggleHoverOriginal: { key: 'showOriginalInTooltip', default: true },
      toggleHighlight:     { key: 'highlightTranslated',   default: true },
      toggleAutoLoadCache: { key: 'autoLoadCache',         default: false }
    };

    for (const [id, cfg] of Object.entries(toggles)) {
      const el = document.getElementById(id);
      if (!el) continue;
      chrome.storage.sync.get([cfg.key], (s) => {
        el.checked = cfg.default ? s[cfg.key] !== false : s[cfg.key] === true;
      });
      el.addEventListener('change', () => {
        chrome.storage.sync.set({ [cfg.key]: el.checked });
      });
    }

    // Donate Link
    document.getElementById('donateLink')?.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: chrome.runtime.getURL('pages/donate.html') });
    });

    document.getElementById('openOptions').addEventListener('click', (e) => {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    });

    document.getElementById('openGuide')?.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: chrome.runtime.getURL('pages/guide.html') });
    });

    // Initial Status prüfen
    setTimeout(() => this.updateActionStates(), 300);

    // Regelmäßig Status aktualisieren (alle 10 Sekunden - reduziert für Performance)
    setInterval(() => this.updateActionStates(), 10000);

    // Bei Tab-Wechsel oder Sichtbarkeit aktualisieren
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        this.updateActionStates();
      }
    });

    // Bei Tab-Aktivierung im Browser
    chrome.tabs.onActivated?.addListener(() => {
      setTimeout(() => this.updateActionStates(), 100);
    });
  }

  async updateActionStates() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;

      if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
        ActionRenderer.disableAll();
        return;
      }

      const response = await chrome.tabs.sendMessage(tab.id, { action: 'GET_PAGE_INFO' }).catch(() => null);
      if (!response) return;

      ActionRenderer.apply(PageState.deriveActions(response));

      // Quelle-Anzeige: immer aktuelle Konfiguration zeigen
      const state = PageState.derive(response);
      const pipelineSettings = await chrome.storage.sync.get(['apiType', 'cacheServerMode', 'cacheServerEnabled']);
      if (state === 'translated' || state === 'partial') {
        this.showPipeline({
          apiType: response.apiType || pipelineSettings.apiType || 'libretranslate',
          source: response.lastSource || 'api',
          tokens: response.lastTokens || 0
        }, pipelineSettings);
      } else {
        this.showPipeline({
          apiType: pipelineSettings.apiType || 'libretranslate',
          source: 'config'
        }, pipelineSettings);
      }
    } catch (e) {}
  }

  async sendPageAction(action, data = {}) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        await chrome.tabs.sendMessage(tab.id, { action, ...data });
        // Kein Toast hier -- die Aktion zeigt eigenes Feedback
      }
    } catch (e) {
      SWT.Toast.show('Fehler: Seite nicht erreichbar');
    }
  }

  setupHistory() {
    document.getElementById('clearHistory').addEventListener('click', async () => {
      await chrome.runtime.sendMessage({ action: 'CLEAR_HISTORY' });
      this.loadHistory();
      SWT.Toast.show('Verlauf gelöscht');
    });

    // Event-Delegation: Einmal binden, funktioniert auch nach innerHTML-Rebuild
    const historyList = document.getElementById('historyList');
    historyList.addEventListener('click', async (e) => {
      // Löschen
      const deleteBtn = e.target.closest('.delete-history');
      if (deleteBtn) {
        e.stopPropagation();
        const idx = parseInt(deleteBtn.dataset.index);
        await chrome.runtime.sendMessage({ action: 'DELETE_HISTORY_ENTRY', index: idx });
        this.loadHistory();
        return;
      }

      // Klick auf Eintrag -> in Übersetzen-Tab übernehmen
      const content = e.target.closest('.history-item-content');
      if (content) {
        const item = content.closest('.history-item');
        document.getElementById('sourceText').value = item.dataset.original;
        document.getElementById('resultBox').textContent = item.dataset.translated;
        this.currentTranslation = item.dataset.translated;
        document.getElementById('resultActions').style.display = 'flex';
        document.querySelector('.tab[data-tab="translate"]').click();
      }
    });
  }

  async loadHistory() {
    const historyList = document.getElementById('historyList');

    try {
      const response = await chrome.runtime.sendMessage({ action: 'GET_HISTORY' });
      const history = response.history || [];

      const clearBtn = document.getElementById('clearHistory');
      if (history.length === 0) {
        if (clearBtn) clearBtn.disabled = true;
        historyList.innerHTML = `
          <div class="history-empty">
            ${SWT.Icons.svg('history')}
            <p>Noch keine Übersetzungen</p>
          </div>
        `;
        return;
      }
      if (clearBtn) clearBtn.disabled = false;

      historyList.innerHTML = history.map((item, idx) => `
        <div class="history-item" data-index="${idx}" data-original="${SWT.Utils.escapeAttr(item.original)}" data-translated="${SWT.Utils.escapeAttr(item.translated)}">
          <div class="history-item-content">
            <div class="history-original">${SWT.Utils.escapeHtml(item.original)}</div>
            <div class="history-translated">${SWT.Utils.escapeHtml(item.translated)}</div>
            <div class="history-meta">${SWT.Utils.formatDate(item.timestamp)} · ${item.source} -> ${item.target}</div>
          </div>
          <button class="cache-item-btn delete-history" data-index="${idx}">${SWT.Icons.svg('trash')}</button>
        </div>
      `).join('');

      // Event-Handling per Delegation in setupHistory()
    } catch (e) {
      console.warn('History error:', e);
    }
  }

  async setupCache() {
    // Cache-Source initial aus Settings ableiten
    const cacheSettings = await chrome.storage.sync.get(['cacheServerMode']);
    const mode = cacheSettings.cacheServerMode || 'server-only';
    this._cacheSource = mode === 'local-only' ? 'local' : 'server';

    // Aktiven Tab visuell setzen
    document.querySelectorAll('.cache-source-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.source === this._cacheSource);
    });

    // Cache-Source-Tabs (Server / Lokal)
    document.querySelectorAll('.cache-source-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        if (tab.classList.contains('disabled')) return;
        document.querySelectorAll('.cache-source-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this._cacheSource = tab.dataset.source;
        this.loadCache();
      });
    });

    document.getElementById('refreshCache').addEventListener('click', async () => {
      await this.loadCache();
      SWT.Toast.show('Cache aktualisiert');
    });
    
    // Cache dieser Seite löschen
    document.getElementById('clearPageCache').addEventListener('click', async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return;
      
      try {
        // Über Content-Script mit cacheKey der aktuellen Seite löschen
        await chrome.tabs.sendMessage(tab.id, { action: 'CLEAR_CACHE', key: null });
        this.loadCache();
        this.updateActionStates();
        SWT.Toast.show('Cache dieser Seite gelöscht');
      } catch (e) {
        SWT.Toast.show('Fehler: ' + e.message, 'error');
      }
    });
    
    // Domain-weiten Cache löschen
    document.getElementById('clearDomainCache').addEventListener('click', async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return;
      
      try {
        const url = new URL(tab.url);
        const domain = url.hostname;

        const result = await chrome.runtime.sendMessage({
          action: 'CACHE_SERVER_DELETE_BY_DOMAIN',
          domain: domain
        });

        await this.sendPageAction('CLEAR_CACHE');
        this.loadCache();
        this.updateActionStates();

        const count = result?.deleted || 0;
        SWT.Toast.show(`${count} Einträge für ${domain} gelöscht`);
      } catch (e) {
        SWT.Toast.show('Fehler: ' + e.message, 'error');
      }
    });
  }

  setupStats() {
    // Token Reset Button
    const resetTokensBtn = document.getElementById('resetTokens');
    if (resetTokensBtn) {
      resetTokensBtn.addEventListener('click', async () => {
        await chrome.runtime.sendMessage({ action: 'RESET_TOKEN_STATS' });
        this.loadStats();
        SWT.Toast.show('Token-Zähler zurückgesetzt');
      });
    }
    
  }

  async loadStats() {
    try {
      // Token-Stats laden
      const response = await chrome.runtime.sendMessage({ action: 'GET_TOKEN_STATS' });
      
      if (response.success && response.stats) {
        const stats = response.stats;

        const totalEl = document.getElementById('totalTokens');
        const promptEl = document.getElementById('promptTokens');
        const completionEl = document.getElementById('completionTokens');
        const requestEl = document.getElementById('requestCount');

        if (totalEl) totalEl.textContent = this.formatNumber(stats.totalTokens);
        if (promptEl) promptEl.textContent = this.formatNumber(stats.promptTokens);
        if (completionEl) completionEl.textContent = this.formatNumber(stats.completionTokens);
        if (requestEl) requestEl.textContent = this.formatNumber(stats.requestCount);
        
        // Letzte Aktualisierung anzeigen
        const lastUpdateEl = document.getElementById('statsLastUpdate');
        if (lastUpdateEl) {
          const now = new Date();
          lastUpdateEl.textContent = `Aktualisiert: ${now.toLocaleTimeString('de-DE')}`;
        }
      }
    } catch (e) {
      console.warn('Stats error:', e);
    }
  }

  formatNumber(num) {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 10000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num.toLocaleString('de-DE');
  }

  // Nur Stat-Zahlen aktualisieren, Liste/Scroll unangetastet
  async refreshCacheStats() {
    try {
      const settings = await chrome.storage.sync.get(['cacheServerMode', 'cacheServerEnabled']);
      if (settings.cacheServerEnabled === false || settings.cacheServerMode === 'local-only') return;

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const el = (id) => document.getElementById(id);

      // Server-Stats
      const serverStats = await chrome.runtime.sendMessage({ action: 'GET_CACHE_SERVER_STATS' });
      if (serverStats?.success && serverStats.stats) {
        const s = serverStats.stats;
        if (el('cacheTotalSize')) el('cacheTotalSize').textContent = SWT.Utils.formatBytes(s.db_size || 0);
        if (el('cachePageCount')) el('cachePageCount').textContent = s.total_entries || 0;
        if (el('cacheStatTotal')) el('cacheStatTotal').textContent = `${s.total_entries || 0} Einträge · ${SWT.Utils.formatBytes(s.db_size || 0)}`;
      }

      // Domain-Einträge (url_hash = Domain-Hash, nicht seitenspezifisch)
      if (tab?.url) {
        try {
          const domainStats = await chrome.runtime.sendMessage({
            action: 'CACHE_SERVER_GET_URL_STATS', pageUrl: tab.url
          });
          if (el('cacheStatDomain')) el('cacheStatDomain').textContent = `${domainStats?.result?.count || 0} Einträge`;
        } catch (e) {}
      }
    } catch (e) {}
  }

  async loadCache() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) {
        return;
      }

      // Cache-Modus prüfen
      const settings = await chrome.storage.sync.get(['cacheServerMode', 'cacheServerEnabled']);
      const mode = settings.cacheServerMode || 'server-only';
      const serverEnabled = settings.cacheServerEnabled !== false;
      
      // Server-Cache-Stats holen
      let serverStats = null;
      if (serverEnabled && mode !== 'local-only') {
        try {
          serverStats = await chrome.runtime.sendMessage({ action: 'GET_CACHE_SERVER_STATS' });
        } catch (e) {
          console.warn('Server stats error:', e);
        }
      }
      
      // Page-Info holen (inkl. Cache-Status für aktuelle Seite)
      let pageInfo = null;
      try {
        pageInfo = await chrome.tabs.sendMessage(tab.id, { action: 'GET_PAGE_INFO' });
      } catch (e) {
        // still ignorieren
      }
      
      // Lokale Cache-Info holen (wenn nicht server-only)
      let localResponse = null;
      if (mode !== 'server-only') {
        try {
          localResponse = await chrome.tabs.sendMessage(tab.id, { action: 'GET_CACHE_INFO' });
        } catch (e) {
          console.warn('Local cache error:', e);
        }
      }

      // Server-Eintraege fuer aktuelle Seite laden (vor der Anzeige)
      let serverEntries = null;
      let entryCount = 0;
      if (serverStats?.success) {
        try {
          serverEntries = await chrome.runtime.sendMessage({
            action: 'CACHE_SERVER_GET_ALL_BY_URL',
            pageUrl: tab.url
          });
          entryCount = serverEntries?.result?.count || 0;
        } catch (e) {}
      }

      // Source-Tabs Status aktualisieren
      const serverTab = document.getElementById('cacheTabServer');
      const localTab = document.getElementById('cacheTabLocal');
      const serverOk = serverStats?.success;
      const hasLocal = localResponse?.entries?.length > 0;

      if (serverTab) {
        const statusEl = document.getElementById('cacheServerStatus');
        if (!serverEnabled || mode === 'local-only') {
          serverTab.classList.add('disabled');
          if (statusEl) statusEl.textContent = 'aus';
        } else {
          serverTab.classList.remove('disabled');
          if (statusEl) statusEl.textContent = serverOk ? '' : 'offline';
        }
      }
      if (localTab) {
        const statusEl = document.getElementById('cacheLocalStatus');
        if (mode === 'server-only') {
          localTab.classList.add('disabled');
          if (statusEl) statusEl.textContent = 'aus';
        } else {
          localTab.classList.remove('disabled');
          if (statusEl) statusEl.textContent = '';
        }
      }

      // Aktiven Source-Tab bestimmen -- ggf. korrigieren wenn deaktiviert
      if (this._cacheSource === 'server' && (!serverEnabled || mode === 'local-only')) {
        this._cacheSource = 'local';
      } else if (this._cacheSource === 'local' && mode === 'server-only') {
        this._cacheSource = 'server';
      }
      const source = this._cacheSource || 'server';
      const showServer = source === 'server';

      // Tab-Anzeige synchronisieren
      document.querySelectorAll('.cache-source-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.source === source);
      });

      // Header-Stats
      if (showServer && serverOk) {
        const stats = serverStats.stats;
        document.getElementById('cacheTotalSize').textContent = SWT.Utils.formatBytes(stats.db_size || 0);
        document.getElementById('cachePageCount').textContent = stats.total_entries || 0;
      } else if (!showServer) {
        const localEntries = localResponse?.entries || [];
        const totalSize = localEntries.reduce((sum, e) => sum + (e.size || 0), 0);
        const totalCount = localEntries.reduce((sum, e) => sum + (e.count || 0), 0);
        document.getElementById('cacheTotalSize').textContent = SWT.Utils.formatBytes(totalSize);
        document.getElementById('cachePageCount').textContent = totalCount;
      } else {
        document.getElementById('cacheTotalSize').textContent = '0 KB';
        document.getElementById('cachePageCount').textContent = '0';
      }

      // Anzeige aktualisieren
      const cacheList = document.getElementById('cacheList');
      let html = '';

      if (pageInfo) {
        const hasCache = pageInfo.cacheAvailable || entryCount > 0;
        const cacheStatus = hasCache
          ? `<span class="cache-badge available">Cache verfügbar</span>`
          : `<span class="cache-badge none">Kein Cache</span>`;

        html += `
          <div class="cache-current-page">
            <h4>Aktuelle Seite</h4>
            <div class="cache-page-info">
              <div class="cache-page-url">${SWT.Utils.escapeHtml(this.truncateUrl(tab.url))}</div>
              ${cacheStatus}
              <div class="cache-page-status">
                ${pageInfo.isTranslated ? 'Übersetzt' : 'Original'}
              </div>
            </div>
          </div>
        `;
      }

      // Server-Stats anzeigen (nur wenn Server-Tab aktiv)
      if (showServer && serverStats && serverStats.success && serverStats.stats) {
        const stats = serverStats.stats;
        
        html += `
          <div class="cache-server-info">
            <h4>Server-Cache</h4>
            <div class="server-stat">
              <span class="stat-label">Gesamt:</span>
              <span class="stat-value" id="cacheStatTotal">${stats.total_entries || 0} Einträge · ${SWT.Utils.formatBytes(stats.db_size || 0)}</span>
            </div>
            <div class="server-stat">
              <span class="stat-label">Diese Domain:</span>
              <span class="stat-value" id="cacheStatDomain">${entryCount} Einträge</span>
            </div>
          </div>
        `;
        
        // Server-Eintraege mit Lazy Loading (max 20 initial)
        if (serverEntries?.result?.translations && entryCount > 0) {
          const allEntries = Object.entries(serverEntries.result.translations);
          const INITIAL_LIMIT = 20;
          const visible = allEntries.slice(0, INITIAL_LIMIT);
          const hasMore = allEntries.length > INITIAL_LIMIT;

          html += `<div class="cache-server-entries"><h4>Einträge (${entryCount})</h4>`;
          html += `<div id="cacheEntryList">`;
          for (const [hash, entry] of visible) {
            const orig = entry.original?.length > 35 ? entry.original.slice(0, 32) + '...' : entry.original;
            const trans = entry.translated?.length > 35 ? entry.translated.slice(0, 32) + '...' : entry.translated;
            html += `
              <div class="cache-item server" data-hash="${hash}">
                <div class="cache-item-info">
                  <div class="cache-item-text">${SWT.Utils.escapeHtml(orig)}</div>
                  <div class="cache-item-meta">${SWT.Utils.escapeHtml(trans)}</div>
                </div>
                <div class="cache-item-actions">
                  <button class="cache-item-btn delete-server">${SWT.Icons.svg('delete')}</button>
                </div>
              </div>
            `;
          }
          html += `</div></div>`;

          // Alle Eintraege fuer spaeteres Nachladen speichern
          this._allCacheEntries = allEntries;
          this._cacheOffset = INITIAL_LIMIT;
        }
      } else if (showServer) {
        html += `<div class="cache-empty">Server nicht erreichbar</div>`;
      }

      // Lokale Cache-Einträge (nur bei Lokal-Tab)
      if (!showServer && localResponse?.entries?.length > 0) {
        const currentUrl = tab.url;
        const normalizeUrl = (url) => url.replace(/\/$/, '').split('#')[0].split('?')[0];
        const currentNormalized = normalizeUrl(currentUrl);

        const sortedEntries = [...localResponse.entries].sort((a, b) => {
          const aMatch = normalizeUrl(a.url) === currentNormalized;
          const bMatch = normalizeUrl(b.url) === currentNormalized;
          if (aMatch && !bMatch) return -1;
          if (!aMatch && bMatch) return 1;
          return b.timestamp - a.timestamp;
        });

        html += sortedEntries.map(entry => {
          const isCurrentPage = normalizeUrl(entry.url) === currentNormalized;
          return `
          <div class="cache-item${isCurrentPage ? ' current' : ''}" data-key="${entry.key}">
            <div class="cache-item-info">
              <a href="${SWT.Utils.escapeAttr(entry.url)}" class="cache-item-url" target="_blank">${SWT.Utils.escapeHtml(this.truncateUrl(entry.url))}</a>
              <div class="cache-item-meta">${entry.count} Übersetzungen · ${SWT.Utils.formatBytes(entry.size)} · ${SWT.Utils.formatDate(entry.timestamp)}</div>
            </div>
            <div class="cache-item-actions">
              <button class="cache-item-btn delete">
                ${SWT.Icons.svg('delete')}
              </button>
            </div>
          </div>
        `}).join('');
      } else if (!showServer) {
        html += `<div class="cache-empty">Kein lokaler Cache vorhanden</div>`;
      }
      
      // Fallback wenn nichts da
      if (!html) {
        html = `<div class="cache-empty">Kein Cache vorhanden</div>`;
      }
      
      cacheList.innerHTML = html;

      // Löschbuttons aktivieren/deaktivieren
      const clearPageBtn = document.getElementById('clearPageCache');
      const clearDomainBtn = document.getElementById('clearDomainCache');
      if (clearPageBtn) clearPageBtn.disabled = entryCount === 0;
      if (clearDomainBtn) clearDomainBtn.disabled = entryCount === 0;

      // Delete-Button Handler (lokal)
      cacheList.querySelectorAll('.cache-item-btn.delete').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const item = btn.closest('.cache-item');
          const key = item.dataset.key;
          await chrome.tabs.sendMessage(tab.id, { action: 'CLEAR_CACHE', key });
          item.remove();
          this.loadCache();
          SWT.Toast.show('Cache-Eintrag gelöscht');
        });
      });
      
      // Infinite Scroll auf der Eintrags-Liste
      const entryList = document.getElementById('cacheEntryList');
      if (entryList && this._allCacheEntries && this._cacheOffset < this._allCacheEntries.length) {
        const loadMore = () => {
          if (this._cacheOffset >= this._allCacheEntries.length) return;
          const BATCH = 20;
          const next = this._allCacheEntries.slice(this._cacheOffset, this._cacheOffset + BATCH);
          for (const [hash, entry] of next) {
            const orig = entry.original?.length > 35 ? entry.original.slice(0, 32) + '...' : entry.original;
            const trans = entry.translated?.length > 35 ? entry.translated.slice(0, 32) + '...' : entry.translated;
            entryList.insertAdjacentHTML('beforeend', `
              <div class="cache-item server" data-hash="${hash}">
                <div class="cache-item-info">
                  <div class="cache-item-text">${SWT.Utils.escapeHtml(orig)}</div>
                  <div class="cache-item-meta">${SWT.Utils.escapeHtml(trans)}</div>
                </div>
                <div class="cache-item-actions">
                  <button class="cache-item-btn delete-server">${SWT.Icons.svg('delete')}</button>
                </div>
              </div>
            `);
          }
          this._cacheOffset += BATCH;
        };
        entryList.addEventListener('scroll', () => {
          const { scrollTop, scrollHeight, clientHeight } = entryList;
          if (scrollTop + clientHeight >= scrollHeight - 80) {
            loadMore();
          }
        });
      }

      // Event-Delegation für Server-Delete-Buttons (auch für nachgeladene Einträge)
      cacheList.addEventListener('click', async (e) => {
        const btn = e.target.closest('.cache-item-btn.delete-server');
        if (!btn) return;
        e.stopPropagation();
        const item = btn.closest('.cache-item');
        const hash = item.dataset.hash;
        await chrome.runtime.sendMessage({
          action: 'CACHE_SERVER_DELETE_BY_HASH',
          pageUrl: tab.url,
          hash
        });
        item.remove();
        SWT.Toast.show('Server-Cache-Eintrag gelöscht');
        this.loadCache();
      });
    } catch (e) {
      console.warn('Cache error:', e);
      document.getElementById('cacheList').innerHTML = '<div class="cache-empty">Fehler beim Laden</div>';
    }
  }

  // URL kürzen für Anzeige
  truncateUrl(url) {
    if (url.length <= 60) return url;
    const parsed = new URL(url);
    const path = parsed.pathname + parsed.search;
    if (path.length > 40) {
      return parsed.host + path.slice(0, 35) + '...';
    }
    return url.slice(0, 57) + '...';
  }

  setupMessageListener() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'SIDEPANEL_TRANSLATE') {
        document.getElementById('sourceText').value = request.text;
        this.translate();
      } else if (request.action === 'SIDEPANEL_SHOW_CACHE') {
        document.querySelector('.tab[data-tab="cache"]').click();
      } else if (request.action === 'PAGE_STATUS_CHANGED') {
        // Status-Update vom Content-Script
        this.updateActionStates();
      } else if (request.action === 'TRANSLATION_STATUS') {
        // Live Status-Update während Übersetzung
        this.updateTranslationStatus(request);
      }
    });
  }

  /**
   * Aktualisiert den Status-Indikator während der Übersetzung
   * @param {Object} status - {type: 'loading'|'cache'|'ai', active: boolean, complete: boolean}
   */
  updateTranslationStatus(status) {
    // Sidepanel zeigt Status nicht mehr an - wird nur im Content-Popup angezeigt
  }

  /**
   * Zeigt den Übersetzungspfad als Pipeline-Visualisierung
   * @param {Object} result - { apiType, source, fromCache, tokens }
   */
  showPipeline(result, settings) {
    const view = document.getElementById('pipelineView');
    const steps = document.getElementById('pipelineSteps');
    if (!view || !steps) return;

    const source = result.source || 'api';
    const apiType = result.apiType || 'libretranslate';
    const apiLabel = apiType === 'lmstudio' ? 'LM Studio' : 'LibreTranslate';

    const mode = settings?.cacheServerMode || 'server-only';
    const cacheEnabled = settings?.cacheServerEnabled !== false;

    const parts = [];

    // Quelle
    if (source === 'cache') {
      parts.push({ label: 'Server-Cache', css: 'source-cache' });
    } else if (source === 'buffer') {
      parts.push({ label: 'Buffer', css: 'source-buffer' });
    } else {
      let lbl = apiLabel;
      if (result.tokens > 0) lbl += ' (' + result.tokens + ' Tokens)';
      parts.push({ label: lbl, css: 'source-api' });
    }

    // Cache-Ziel (immer anzeigen wenn Cache aktiv)
    if (cacheEnabled) {
      if (mode === 'local-only') {
        parts.push({ label: 'Browsercache', css: 'step-save' });
      } else if (mode === 'server-only') {
        parts.push({ label: 'Server-Cache', css: 'step-save' });
      } else {
        parts.push({ label: 'Server + Browser', css: 'step-save' });
      }
    }

    steps.innerHTML = parts.map((p, i) =>
      (i > 0 ? '<span class="pipeline-arrow">\u2192</span>' : '') +
      `<span class="pipeline-step ${p.css}">${p.label}</span>`
    ).join('');
    view.classList.remove('hidden');
  }

  hidePipeline() {
    const view = document.getElementById('pipelineView');
    if (view) view.classList.add('hidden');
  }
}

new SidePanelController();
