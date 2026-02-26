// Side Panel
// Refactored: Nutzt SWT.Utils, SWT.Toast, SWT.ApiBadge

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
      'sourceLang', 'targetLang', 'apiType', 'lmStudioContext'
    ]);
    document.getElementById('sourceLang').value = settings.sourceLang || 'auto';
    document.getElementById('targetLang').value = settings.targetLang || 'de';
    
    // API-Badge aktualisieren
    const apiType = settings.apiType || 'libretranslate';
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
  
  // NEU: Kontext-Schnellwahl Setup (v3.5.4)
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
    
    // Storage-Listener für Änderungen von Options-Seite
    chrome.storage.onChanged.addListener((changes) => {
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

        if (targetId === 'history') this.loadHistory();
        if (targetId === 'cache') this.loadCache();
        if (targetId === 'stats') this.loadStats();
      });
    });
    
    // Auto-Refresh alle 2 Sekunden für aktive Daten-Tabs
    this.activeTab = 'translate';
    setInterval(() => {
      if (this.activeTab === 'history') this.loadHistory();
      if (this.activeTab === 'cache') this.loadCache();
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
      const utterance = new SpeechSynthesisUtterance(this.currentTranslation);
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

    translateBtn.disabled = true;
    translateBtn.innerHTML = '<div class="spinner"></div> Übersetze...';
    
    // Context Notes ausblenden während der Übersetzung
    if (contextNotes) contextNotes.classList.remove('show');

    try {
      const result = await chrome.runtime.sendMessage({
        action: 'TRANSLATE',
        text: sourceText,
        source: sourceLang,
        target: targetLang
      });

      resultBox.classList.remove('error');

      if (result.success) {
        resultBox.textContent = result.translatedText;
        this.currentTranslation = result.translatedText;
        resultActions.style.display = 'flex';

        // Kontext-Notizen anzeigen (nur bei LM Studio)
        if (result.contextNotes && contextNotes && contextNotesText) {
          contextNotesText.textContent = result.contextNotes;
          contextNotes.classList.add('show');
        }

        await chrome.runtime.sendMessage({
          action: 'ADD_TO_HISTORY',
          entry: {
            original: sourceText,
            translated: result.translatedText,
            source: sourceLang,
            target: targetLang,
            timestamp: Date.now(),
            apiType: result.apiType
          }
        });
      } else {
        resultBox.textContent = 'Fehler: ' + (result.error || 'Unbekannt');
        resultBox.classList.add('error');
      }
    } catch (error) {
      resultBox.textContent = 'Verbindungsfehler: ' + error.message;
      resultBox.classList.add('error');
    }

    translateBtn.disabled = false;
    translateBtn.innerHTML = `
      ${SWT.Icons.svg('translate')}
      Übersetzen
    `;
  }

  async saveLanguages() {
    const sourceLang = document.getElementById('sourceLang').value;
    const targetLang = document.getElementById('targetLang').value;
    await chrome.storage.sync.set({ sourceLang, targetLang });
  }

  setupActions() {
    const translateBtn = document.getElementById('translatePage');
    const continueBtn = document.getElementById('continuePage');
    const restoreBtn = document.getElementById('restorePage');
    const loadCacheBtn = document.getElementById('loadCache');

    translateBtn.addEventListener('click', async () => {
      if (translateBtn.classList.contains('disabled')) return;
      await this.sendPageAction('TRANSLATE_PAGE', { mode: 'replace' });
      setTimeout(() => this.updateActionStates(), 500);
    });

    continueBtn.addEventListener('click', async () => {
      if (continueBtn.classList.contains('disabled')) return;
      await this.sendPageAction('TRANSLATE_PAGE', { mode: 'continue' });
      setTimeout(() => this.updateActionStates(), 500);
    });

    restoreBtn.addEventListener('click', async () => {
      if (restoreBtn.classList.contains('disabled')) return;
      await this.sendPageAction('RESTORE_PAGE');
      setTimeout(() => this.updateActionStates(), 500);
    });

    loadCacheBtn.addEventListener('click', async () => {
      if (loadCacheBtn.classList.contains('disabled')) return;
      await this.sendPageAction('LOAD_CACHED_TRANSLATION');
      setTimeout(() => this.updateActionStates(), 2000);
      setTimeout(() => this.updateActionStates(), 5000);
    });

    // Hover-Original Toggle
    const hoverToggle = document.getElementById('toggleHoverOriginal');
    if (hoverToggle) {
      chrome.storage.sync.get(['showOriginalInTooltip'], (s) => {
        hoverToggle.checked = s.showOriginalInTooltip !== false;
      });
      hoverToggle.addEventListener('change', () => {
        chrome.storage.sync.set({ showOriginalInTooltip: hoverToggle.checked });
      });
    }

    // Markierung Toggle
    const highlightToggle = document.getElementById('toggleHighlight');
    if (highlightToggle) {
      chrome.storage.sync.get(['highlightTranslated'], (s) => {
        highlightToggle.checked = s.highlightTranslated !== false;
      });
      highlightToggle.addEventListener('change', () => {
        chrome.storage.sync.set({ highlightTranslated: highlightToggle.checked });
      });
    }

    // Auto-Load Cache Toggle
    const autoLoadToggle = document.getElementById('toggleAutoLoadCache');
    if (autoLoadToggle) {
      chrome.storage.sync.get(['autoLoadCache'], (s) => {
        autoLoadToggle.checked = s.autoLoadCache === true;
      });
      autoLoadToggle.addEventListener('change', () => {
        chrome.storage.sync.set({ autoLoadCache: autoLoadToggle.checked });
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
    const translateBtn = document.getElementById('translatePage');
    const continueBtn = document.getElementById('continuePage');
    const restoreBtn = document.getElementById('restorePage');
    const loadCacheBtn = document.getElementById('loadCache');
    const cacheProgress = document.getElementById('cacheProgress');

    // NICHT mehr alle Buttons zurücksetzen - das verursacht Flackern!

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) return;

      // Nur versuchen wenn es eine normale Webseite ist
      if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
        // Alle Buttons deaktivieren für Nicht-Webseiten
        translateBtn.classList.add('disabled');
        continueBtn.classList.add('disabled');
        restoreBtn.classList.add('disabled');
        loadCacheBtn.classList.add('disabled');
        cacheProgress.textContent = '–';
        cacheProgress.className = 'action-badge empty';
        return;
      }

      const response = await chrome.tabs.sendMessage(tab.id, { action: 'GET_PAGE_INFO' }).catch(() => null);
      
      if (!response) {
        // Content-Script nicht bereit - Buttons bleiben im aktuellen Zustand
        return;
      }

      // === FORTSETZEN-BUTTON ===
      // Enabled wenn: hasCache ODER cacheProgress > 0 ODER serverCacheCount > 0
      // Fortsetzen: Aktiv wenn Texte fehlen (Abbruch oder teilweise Cache-Load)
      if (response.remaining > 0) {
        continueBtn.classList.remove('disabled');
        cacheProgress.textContent = response.remaining;
        cacheProgress.className = 'action-badge partial';
      } else {
        continueBtn.classList.add('disabled');
        cacheProgress.textContent = '';
        cacheProgress.className = 'action-badge empty';
      }

      // === TRANSLATE-BUTTON ===
      if (response.isTranslated) {
        translateBtn.classList.add('active');
        translateBtn.classList.remove('disabled');
        const svg = translateBtn.querySelector('svg');
        if (svg) svg.style.fill = '#22c55e';
      } else {
        translateBtn.classList.remove('active');
        translateBtn.classList.remove('disabled');
        const svg = translateBtn.querySelector('svg');
        if (svg) svg.style.fill = '';
      }

      // === RESTORE-BUTTON ===
      if (response.isTranslated) {
        restoreBtn.classList.remove('disabled');
      } else {
        restoreBtn.classList.add('disabled');
      }

      // === CACHE-LADEN-BUTTON ===
      // Aktiv wenn Cache vorhanden UND noch nichts geladen (weder voll noch teil)
      const alreadyLoaded = response.isTranslated || response.translatedCount > 0;
      if (!alreadyLoaded && (response.cacheAvailable || response.serverCacheCount > 0)) {
        loadCacheBtn.classList.remove('disabled');
      } else {
        loadCacheBtn.classList.add('disabled');
      }

    } catch (e) {
      // Bei Fehler: Buttons nicht ändern
      console.log('updateActionStates Fehler:', e.message);
    }
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
      if (confirm('Verlauf wirklich löschen?')) {
        await chrome.runtime.sendMessage({ action: 'CLEAR_HISTORY' });
        this.loadHistory();
        SWT.Toast.show('Verlauf gelöscht');
      }
    });
  }

  async loadHistory() {
    const historyList = document.getElementById('historyList');

    try {
      const response = await chrome.runtime.sendMessage({ action: 'GET_HISTORY' });
      const history = response.history || [];

      if (history.length === 0) {
        historyList.innerHTML = `
          <div class="history-empty">
            ${SWT.Icons.svg('history')}
            <p>Noch keine Übersetzungen</p>
          </div>
        `;
        return;
      }

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

      historyList.querySelectorAll('.history-item-content').forEach(content => {
        content.addEventListener('click', () => {
          const item = content.closest('.history-item');
          document.getElementById('sourceText').value = item.dataset.original;
          document.getElementById('resultBox').textContent = item.dataset.translated;
          this.currentTranslation = item.dataset.translated;
          document.getElementById('resultActions').style.display = 'flex';
          document.querySelector('.tab[data-tab="translate"]').click();
        });
      });

      historyList.querySelectorAll('.delete-history').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const idx = parseInt(btn.dataset.index);
          await chrome.runtime.sendMessage({ action: 'DELETE_HISTORY_ENTRY', index: idx });
          this.loadHistory();
        });
      });
    } catch (e) {
      console.warn('History error:', e);
    }
  }

  setupCache() {
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
        
        if (confirm(`Cache für "${domain}" löschen?\n(Alle Seiten dieser Domain)`)) {
          // Server-Cache für Domain löschen
          const result = await chrome.runtime.sendMessage({ 
            action: 'CACHE_SERVER_DELETE_BY_DOMAIN', 
            domain: domain 
          });
          
          // Lokalen Cache auch löschen
          await this.sendPageAction('CLEAR_CACHE');
          
          this.loadCache();
          this.updateActionStates();
          
          const count = result?.deleted || 0;
          SWT.Toast.show(`${count} Einträge für ${domain} gelöscht`);
        }
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

  async loadCache() {
    console.log('[SWT Sidepanel] loadCache called');
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) {
        console.log('[SWT Sidepanel] No active tab');
        return;
      }

      // Cache-Modus prüfen
      const settings = await chrome.storage.sync.get(['cacheServerMode', 'cacheServerEnabled']);
      const mode = settings.cacheServerMode || 'server-only';
      const serverEnabled = settings.cacheServerEnabled !== false;
      console.log('[SWT Sidepanel] Mode:', mode, 'ServerEnabled:', serverEnabled);
      
      // Server-Cache-Stats holen
      let serverStats = null;
      if (serverEnabled && mode !== 'local-only') {
        try {
          serverStats = await chrome.runtime.sendMessage({ action: 'GET_CACHE_SERVER_STATS' });
          console.log('[SWT Sidepanel] Server stats:', serverStats);
        } catch (e) {
          console.warn('Server stats error:', e);
        }
      }
      
      // Page-Info holen (inkl. Cache-Status für aktuelle Seite)
      let pageInfo = null;
      try {
        pageInfo = await chrome.tabs.sendMessage(tab.id, { action: 'GET_PAGE_INFO' });
        console.log('[SWT Sidepanel] Page info:', pageInfo);
      } catch (e) {
        // still ignorieren
      }
      
      // Lokale Cache-Info holen (wenn nicht server-only)
      let localResponse = null;
      if (mode !== 'server-only') {
        try {
          localResponse = await chrome.tabs.sendMessage(tab.id, { action: 'GET_CACHE_INFO' });
          console.log('[SWT Sidepanel] Local cache:', localResponse);
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
      
      // Server-Stats anzeigen
      if (serverStats && serverStats.success && serverStats.stats) {
        const stats = serverStats.stats;
        document.getElementById('cacheTotalSize').textContent = SWT.Utils.formatBytes(stats.db_size || 0);
        document.getElementById('cachePageCount').textContent = stats.total_entries || 0;
        
        html += `
          <div class="cache-server-info">
            <h4>Server-Cache</h4>
            <div class="server-stat">
              <span class="stat-label">Gesamt:</span>
              <span class="stat-value">${stats.total_entries || 0} Einträge · ${SWT.Utils.formatBytes(stats.db_size || 0)}</span>
            </div>
            <div class="server-stat">
              <span class="stat-label">Diese Seite:</span>
              <span class="stat-value">${entryCount} Einträge</span>
            </div>
          </div>
        `;
        
        // Server-Eintraege mit Lazy Loading (max 20 initial)
        if (serverEntries?.result?.translations && entryCount > 0) {
          const allEntries = Object.entries(serverEntries.result.translations);
          const INITIAL_LIMIT = 20;
          const visible = allEntries.slice(0, INITIAL_LIMIT);
          const hasMore = allEntries.length > INITIAL_LIMIT;

          html += `<div class="cache-server-entries"><h4>Diese Seite (${entryCount})</h4>`;
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
          html += `</div>`;
          if (hasMore) {
            html += `<button class="btn btn-secondary fullwidth mt-sm" id="loadMoreCache">
              ${allEntries.length - INITIAL_LIMIT} weitere laden
            </button>`;
          }
          html += `</div>`;

          // Alle Eintraege fuer spaeteres Nachladen speichern
          this._allCacheEntries = allEntries;
          this._cacheOffset = INITIAL_LIMIT;
        }
      } else if (mode !== 'local-only' && serverEnabled) {
        html += `
          <div class="cache-server-info">
            <h4>Server-Cache</h4>
            <div class="cache-empty">Server nicht erreichbar</div>
          </div>
        `;
      }
      
      // Lokale Cache-Einträge
      if (localResponse && localResponse.entries && localResponse.entries.length > 0) {
        if (mode === 'server-only') {
          // Bei server-only nicht anzeigen
        } else {
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

          html += `<div class="cache-local-section"><h4>Lokaler Cache</h4>`;
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
          html += `</div>`;
        }
      }
      
      // Fallback wenn nichts da
      if (!html) {
        html = `<div class="cache-empty">Kein Cache vorhanden</div>`;
      }
      
      cacheList.innerHTML = html;

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
      
      // Delete-Button Handler (Server)
      // "Mehr laden" Button
      const loadMoreBtn = document.getElementById('loadMoreCache');
      if (loadMoreBtn && this._allCacheEntries) {
        loadMoreBtn.addEventListener('click', () => {
          const BATCH = 20;
          const next = this._allCacheEntries.slice(this._cacheOffset, this._cacheOffset + BATCH);
          const list = document.getElementById('cacheEntryList');
          for (const [hash, entry] of next) {
            const orig = entry.original?.length > 35 ? entry.original.slice(0, 32) + '...' : entry.original;
            const trans = entry.translated?.length > 35 ? entry.translated.slice(0, 32) + '...' : entry.translated;
            list.insertAdjacentHTML('beforeend', `
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
          if (this._cacheOffset >= this._allCacheEntries.length) {
            loadMoreBtn.remove();
          } else {
            loadMoreBtn.textContent = `${this._allCacheEntries.length - this._cacheOffset} weitere laden`;
          }
        });
      }

      cacheList.querySelectorAll('.cache-item-btn.delete-server').forEach(btn => {
        btn.addEventListener('click', async (e) => {
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
          this.loadCache(); // Stats aktualisieren
        });
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
    // Diese Methode bleibt für eventuelle zukünftige Erweiterungen
  }
}

new SidePanelController();
