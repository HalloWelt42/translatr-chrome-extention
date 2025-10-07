// Side Panel
// Refactored: Nutzt SMT.Utils, SMT.Toast, SMT.ApiBadge

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
    SMT.ApiBadge.update(apiType);
    
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
      SMT.Toast.show(`Kontext: ${contextNames[newContext] || newContext}`);
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
        SMT.ApiBadge.update(changes.apiType.newValue);
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
        SMT.Toast.show('Quelltext kopiert!');
      }
    });

    // Click-to-Copy für resultBox
    resultBox.addEventListener('click', () => {
      if (this.currentTranslation) {
        navigator.clipboard.writeText(this.currentTranslation);
        resultBox.classList.add('copied');
        SMT.Toast.show('Übersetzung kopiert!');
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
      SMT.Toast.show('Kopiert!');
    });

    document.getElementById('speakResult').addEventListener('click', (e) => {
      const btn = e.currentTarget;
      
      // Wenn gerade spricht → stoppen
      if (speechSynthesis.speaking) {
        speechSynthesis.cancel();
        btn.innerHTML = `
          ${SMT.Icons.svg('volumeUp')}
          Vorlesen
        `;
        return;
      }
      
      // Button auf Stop ändern
      btn.innerHTML = `
        ${SMT.Icons.svg('stop')}
        Stoppen
      `;
      
      const targetLang = document.getElementById('targetLang').value;
      const utterance = new SpeechSynthesisUtterance(this.currentTranslation);
      utterance.lang = SMT.Utils.getLangCode(targetLang);
      
      // Wenn fertig, Button zurücksetzen
      utterance.onend = () => {
        btn.innerHTML = `
          ${SMT.Icons.svg('volumeUp')}
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
      ${SMT.Icons.svg('translate')}
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
      await this.sendPageAction('translatePage', { mode: 'replace' });
      setTimeout(() => this.updateActionStates(), 500);
    });

    continueBtn.addEventListener('click', async () => {
      if (continueBtn.classList.contains('disabled')) return;
      await this.sendPageAction('translatePage', { mode: 'continue' });
      setTimeout(() => this.updateActionStates(), 500);
    });

    restoreBtn.addEventListener('click', async () => {
      if (restoreBtn.classList.contains('disabled')) return;
      await this.sendPageAction('restorePage');
      setTimeout(() => this.updateActionStates(), 500);
    });

    loadCacheBtn.addEventListener('click', async () => {
      if (loadCacheBtn.classList.contains('disabled')) return;
      await this.sendPageAction('loadCachedTranslation');
      setTimeout(() => this.updateActionStates(), 500);
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
      // Oder wenn übersetzt aber noch verbleibende Texte
      const hasCacheEntries = response.hasCache || 
                              (response.cacheProgress && response.cacheProgress > 0) ||
                              (response.serverCacheCount && response.serverCacheCount > 0);
      
      // Wenn übersetzt und noch verbleibende Texte: Zeige remaining
      if (response.isTranslated && response.remaining > 0) {
        continueBtn.classList.remove('disabled');
        cacheProgress.textContent = response.remaining;
        cacheProgress.className = 'action-badge partial';
        continueBtn.title = `${response.remaining} Texte noch zu übersetzen`;
      } else if (response.isTranslated && response.remaining === 0) {
        // Vollständig übersetzt - Fortsetzen deaktivieren
        continueBtn.classList.add('disabled');
        cacheProgress.textContent = '✓';
        cacheProgress.className = 'action-badge complete';
        continueBtn.title = 'Übersetzung vollständig';
      } else if (hasCacheEntries) {
        continueBtn.classList.remove('disabled');
        // Badge zeigen
        if (response.serverCacheCount > 0) {
          cacheProgress.textContent = response.serverCacheCount;
          cacheProgress.className = 'action-badge partial';
          continueBtn.title = `${response.serverCacheCount} Einträge im Cache`;
        } else if (response.cacheProgress >= 100) {
          cacheProgress.textContent = '✓';
          cacheProgress.className = 'action-badge complete';
          continueBtn.title = 'Cache vollständig';
        } else if (response.cacheProgress > 0) {
          cacheProgress.textContent = `${response.cacheProgress}%`;
          cacheProgress.className = 'action-badge partial';
          continueBtn.title = `${response.cacheProgress}% im Cache`;
        } else {
          cacheProgress.textContent = '✓';
          cacheProgress.className = 'action-badge complete';
          continueBtn.title = 'Cache verfügbar';
        }
      } else {
        continueBtn.classList.add('disabled');
        cacheProgress.textContent = '–';
        cacheProgress.className = 'action-badge empty';
        continueBtn.title = 'Kein Cache vorhanden';
      }

      // === TRANSLATE-BUTTON ===
      if (response.isTranslated) {
        translateBtn.classList.add('active');
        translateBtn.classList.remove('disabled');
        const svg = translateBtn.querySelector('svg');
        if (svg) svg.style.fill = 'var(--md-success)';
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
      if (hasCacheEntries) {
        loadCacheBtn.classList.remove('disabled');
        loadCacheBtn.title = response.isTranslated ? 'Erneut aus Cache laden' : 'Übersetzung aus Cache laden';
      } else {
        loadCacheBtn.classList.add('disabled');
        loadCacheBtn.title = 'Kein Cache verfügbar';
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
        SMT.Toast.show('Aktion ausgeführt');
      }
    } catch (e) {
      SMT.Toast.show('Fehler: Seite nicht erreichbar');
    }
  }

  setupHistory() {
    document.getElementById('clearHistory').addEventListener('click', async () => {
      if (confirm('Verlauf wirklich löschen?')) {
        await chrome.runtime.sendMessage({ action: 'CLEAR_HISTORY' });
        this.loadHistory();
        SMT.Toast.show('Verlauf gelöscht');
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
            ${SMT.Icons.svg('history')}
            <p>Noch keine Übersetzungen</p>
          </div>
        `;
        return;
      }

      historyList.innerHTML = history.map(item => `
        <div class="history-item" data-original="${SMT.Utils.escapeAttr(item.original)}" data-translated="${SMT.Utils.escapeAttr(item.translated)}">
          <div class="history-original">${SMT.Utils.escapeHtml(item.original)}</div>
          <div class="history-translated">${SMT.Utils.escapeHtml(item.translated)}</div>
          <div class="history-meta">${SMT.Utils.formatDate(item.timestamp)} · ${item.source} → ${item.target}</div>
        </div>
      `).join('');

      historyList.querySelectorAll('.history-item').forEach(item => {
        item.addEventListener('click', () => {
          document.getElementById('sourceText').value = item.dataset.original;
          document.getElementById('resultBox').textContent = item.dataset.translated;
          this.currentTranslation = item.dataset.translated;
          document.getElementById('resultActions').style.display = 'flex';
          document.querySelector('.tab[data-tab="translate"]').click();
        });
      });
    } catch (e) {
      console.warn('History error:', e);
    }
  }

  setupCache() {
    document.getElementById('refreshCache').addEventListener('click', async () => {
      await this.loadCache();
      SMT.Toast.show('Cache aktualisiert');
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
        SMT.Toast.show('Cache dieser Seite gelöscht');
      } catch (e) {
        SMT.Toast.show('Fehler: ' + e.message, 'error');
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
          await this.sendPageAction('clearCache');
          
          this.loadCache();
          this.updateActionStates();
          
          const count = result?.deleted || 0;
          SMT.Toast.show(`${count} Einträge für ${domain} gelöscht`);
        }
      } catch (e) {
        SMT.Toast.show('Fehler: ' + e.message, 'error');
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
        SMT.Toast.show('Token-Zähler zurückgesetzt');
      });
    }
    
    // Kosten Reset Button (setzt auch Tokens zurück, da Kosten = Tokens * Rate)
    const resetCostBtn = document.getElementById('resetCost');
    if (resetCostBtn) {
      resetCostBtn.addEventListener('click', async () => {
        await chrome.runtime.sendMessage({ action: 'RESET_TOKEN_STATS' });
        this.loadStats();
        SMT.Toast.show('Kosten zurückgesetzt');
      });
    }
    
    // Alles Reset Button
    const resetAllBtn = document.getElementById('resetAll');
    if (resetAllBtn) {
      resetAllBtn.addEventListener('click', async () => {
        if (confirm('Alle Statistiken (Tokens + Kosten) zurücksetzen?')) {
          await chrome.runtime.sendMessage({ action: 'RESET_TOKEN_STATS' });
          this.loadStats();
          SMT.Toast.show('Alle Statistiken zurückgesetzt');
        }
      });
    }
  }

  async loadStats() {
    try {
      // Token-Stats laden
      const response = await chrome.runtime.sendMessage({ action: 'GET_TOKEN_STATS' });
      
      // Kosten-Einstellungen laden
      const settings = await chrome.storage.sync.get([
        'enableTokenCost', 'tokenCostAmount', 'tokenCostPer', 'tokenCostCurrency'
      ]);
      
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
        
        // Kosten-Anzeige
        const costCard = document.getElementById('costCard');
        const totalCostEl = document.getElementById('totalCost');
        const costCurrencyEl = document.getElementById('costCurrency');
        
        // Default: enableTokenCost = true
        const showCost = settings.enableTokenCost !== false;
        
        if (showCost && costCard) {
          costCard.classList.remove('hidden');
          
          // Kosten berechnen basierend auf aktuellen Tokens
          const costAmount = settings.tokenCostAmount || 1;
          const costPer = settings.tokenCostPer || 10000;
          const currency = settings.tokenCostCurrency || 'EUR';
          
          // Cent pro X Tokens -> Euro/Dollar
          const costPerToken = (costAmount / 100) / costPer;
          const totalCost = stats.totalTokens * costPerToken;
          
          if (totalCostEl) {
            totalCostEl.textContent = totalCost.toLocaleString('de-DE', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 4
            });
          }
          
          if (costCurrencyEl) {
            const symbols = { 'EUR': '€', 'USD': '$', 'CHF': 'CHF' };
            costCurrencyEl.textContent = symbols[currency] || '€';
          }
        } else if (costCard) {
          costCard.classList.add('hidden');
        }
        
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
        console.warn('Page info error:', e);
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

      // Anzeige aktualisieren
      const cacheList = document.getElementById('cacheList');
      let html = '';
      
      // Status für aktuelle Seite
      if (pageInfo) {
        const cacheStatus = pageInfo.hasCache 
          ? `<span class="cache-status available">Cache verfügbar</span>`
          : `<span class="cache-status none">Kein Cache</span>`;
        
        html += `
          <div class="cache-current-page">
            <h4>Aktuelle Seite</h4>
            <div class="cache-page-info">
              <div class="cache-page-url">${SMT.Utils.escapeHtml(this.truncateUrl(tab.url))}</div>
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
        document.getElementById('cacheTotalSize').textContent = SMT.Utils.formatBytes(stats.db_size || 0);
        document.getElementById('cachePageCount').textContent = stats.total_entries || 0;
        
        // Server-Einträge für aktuelle Seite laden
        let serverEntries = null;
        try {
          serverEntries = await chrome.runtime.sendMessage({ 
            action: 'CACHE_SERVER_GET_ALL_BY_URL', 
            pageUrl: tab.url 
          });
        } catch (e) {}
        
        const entryCount = serverEntries?.result?.count || 0;
        
        html += `
          <div class="cache-server-info">
            <h4>Server-Cache</h4>
            <div class="server-stat">
              <span class="stat-label">Gesamt:</span>
              <span class="stat-value">${stats.total_entries || 0} Einträge · ${SMT.Utils.formatBytes(stats.db_size || 0)}</span>
            </div>
            <div class="server-stat">
              <span class="stat-label">Diese Seite:</span>
              <span class="stat-value">${entryCount} Einträge</span>
            </div>
          </div>
        `;
        
        // Server-Einträge für aktuelle Seite als Liste
        if (serverEntries?.result?.translations && entryCount > 0) {
          html += `<div class="cache-server-entries"><h4>Diese Seite (${entryCount})</h4>`;
          for (const [hash, entry] of Object.entries(serverEntries.result.translations)) {
            const orig = entry.original?.length > 35 ? entry.original.slice(0, 32) + '...' : entry.original;
            const trans = entry.translated?.length > 35 ? entry.translated.slice(0, 32) + '...' : entry.translated;
            html += `
              <div class="cache-item server" data-hash="${hash}">
                <div class="cache-item-info">
                  <div class="cache-item-text" title="${SMT.Utils.escapeAttr(entry.original)}">${SMT.Utils.escapeHtml(orig)}</div>
                  <div class="cache-item-meta" title="${SMT.Utils.escapeAttr(entry.translated)}">${SMT.Utils.escapeHtml(trans)}</div>
                </div>
                <div class="cache-item-actions">
                  <button class="cache-item-btn delete-server" title="Löschen">${SMT.Icons.svg('delete')}</button>
                </div>
              </div>
            `;
          }
          html += `</div>`;
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
                <a href="${SMT.Utils.escapeAttr(entry.url)}" class="cache-item-url" target="_blank" title="${SMT.Utils.escapeAttr(entry.url)}">${SMT.Utils.escapeHtml(this.truncateUrl(entry.url))}</a>
                <div class="cache-item-meta">${entry.count} Übersetzungen · ${SMT.Utils.formatBytes(entry.size)} · ${SMT.Utils.formatDate(entry.timestamp)}</div>
              </div>
              <div class="cache-item-actions">
                <button class="cache-item-btn delete" title="Löschen">
                  ${SMT.Icons.svg('delete')}
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
          SMT.Toast.show('Cache-Eintrag gelöscht');
        });
      });
      
      // Delete-Button Handler (Server)
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
          SMT.Toast.show('Server-Cache-Eintrag gelöscht');
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
