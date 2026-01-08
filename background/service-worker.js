importScripts('cache-server-bg.js', 'prompts.js', 'providers/libre-translate.js', 'providers/lm-studio.js');

// ==========================================================================
// TRANSLATOR BACKGROUND
// ==========================================================================

class TranslatorBackground {
  constructor() {
    this.init();
    
    // Translation Queue für LM Studio Batch-Prefetch
    this.translationQueue = {
      pending: new Map(),      // text → { resolve, reject, source, target, pageUrl }
      buffer: new Map(),       // text → translation (Cache für bereits übersetzte)
      // NEU v3.11.5: Geordnete Queue für exakte Reihenfolge
      orderedQueue: [],        // Array von { index, text, source, target, pageUrl, resolve, reject }
      nextIndex: 0,            // Sequenznummer für strikte Reihenfolge
      batchTimeout: null,
      batchDelay: 50,          // ms warten bevor Batch gesendet wird
      maxBatchSize: 20,        // Max Texte pro Batch (Default 20, via pageBatchSize konfigurierbar)
      isProcessing: false
    };
    
    // Batch-Größe aus Storage laden (async)
    this.loadBatchSettings();
    
    // Bei Settings-Änderungen aktualisieren
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && (changes.pageBatchSize || changes.lmBatchSize)) {
        const newSize = changes.pageBatchSize?.newValue || changes.lmBatchSize?.newValue || 20;
        this.translationQueue.maxBatchSize = Math.max(1, Math.min(50, newSize));
        console.log(`[Queue] Batch-Größe geändert auf ${this.translationQueue.maxBatchSize}`);
      }
    });
  }
  
  async loadBatchSettings() {
    try {
      const settings = await chrome.storage.sync.get(['pageBatchSize', 'lmBatchSize']);
      const batchSize = settings.pageBatchSize || settings.lmBatchSize || 20;
      this.translationQueue.maxBatchSize = Math.max(1, Math.min(50, batchSize));
      console.log(`[Queue] Batch-Größe geladen: ${this.translationQueue.maxBatchSize}`);
    } catch (e) {
      console.warn('[Queue] Settings-Laden fehlgeschlagen:', e);
    }
  }

  init() {
    chrome.runtime.onInstalled.addListener((details) => this.handleInstall(details));
    chrome.runtime.onStartup.addListener(() => this.setupContextMenu());
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      this.handleMessage(request, sender, sendResponse);
      return true;
    });
    chrome.commands.onCommand.addListener((command) => this.handleCommand(command));
    this.setupContextMenu();
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
  }

  async handleInstall(details) {
    if (details.reason === 'install') {
      await this.setDefaultSettings();
      // Bei Erstinstallation: Einstellungen öffnen
      chrome.tabs.create({ url: chrome.runtime.getURL('pages/options.html') });
    } else if (details.reason === 'update') {
      await this.migrateToUnifiedStorage();
      await this.migrateSettings();
      // Alle Tabs mit alten Content-Scripts neu laden
      this.reloadContentScripts();
    }
    await this.setupContextMenu();
  }

  async migrateToUnifiedStorage() {
    try {
      const check = await chrome.storage.sync.get('swt-settings');
      if (check['swt-settings']) return; // Bereits migriert

      const oldSync = await chrome.storage.sync.get(null);
      if (!oldSync || Object.keys(oldSync).length === 0) return;

      // Settings-Keys sammeln
      const settingsKeys = [
        'apiType', 'serviceUrl', 'apiKey', 'sourceLang', 'targetLang',
        'lmStudioUrl', 'lmStudioModel', 'lmStudioTemperature', 'lmStudioMaxTokens',
        'lmStudioContext', 'lmStudioCustomPrompt',
        'showSelectionIcon', 'selectionIconDelay', 'showOriginalInTooltip',
        'showAlternatives', 'tooltipPosition', 'highlightTranslated',
        'enableTTS', 'ttsLanguage', 'excludedDomains',
        'skipCodeBlocks', 'skipBlockquotes', 'fixInlineSpacing',
        'simplifyPdfExport', 'useTabsForAlternatives', 'tabWordThreshold',
        'lmBatchSize', 'lmMaxBatchTokens', 'pageBatchSize',
        'enableTrueBatch', 'enableSmartChunking', 'useCacheFirst',
        'cacheServerEnabled', 'cacheServerUrl', 'cacheServerMode', 'cacheServerTimeout',
        'filterEmbeddingModels', 'enableAbortTranslation', 'enableLLMFallback'
      ];

      const settings = {};
      for (const key of settingsKeys) {
        if (key in oldSync) settings[key] = oldSync[key];
      }

      // Data-Keys aus local
      const oldLocal = await chrome.storage.local.get(null);
      const data = {};
      for (const key of ['translationHistory', 'tokenStats']) {
        if (key in oldLocal) data[key] = oldLocal[key];
      }

      if (Object.keys(settings).length > 0) {
        await chrome.storage.sync.set({ 'swt-settings': settings });
      }
      if (Object.keys(data).length > 0) {
        await chrome.storage.local.set({ 'swt-data': data });
      }

      // Alte Keys entfernen
      const oldSyncKeys = Object.keys(oldSync).filter(k => k !== 'swt-settings');
      if (oldSyncKeys.length > 0) await chrome.storage.sync.remove(oldSyncKeys);
      const oldLocalKeys = Object.keys(oldLocal).filter(k => k !== 'swt-data');
      if (oldLocalKeys.length > 0) await chrome.storage.local.remove(oldLocalKeys);

      console.log('[SWT] Storage-Migration:', Object.keys(settings).length, 'Settings migriert');
    } catch (e) {
      console.warn('[SWT] Storage-Migration fehlgeschlagen:', e.message);
    }
  }

  async migrateSettings() {
    const settings = await chrome.storage.sync.get();
    
    // Wenn alte Settings, aber kein apiType → Default auf LibreTranslate
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
    }
  }

  async reloadContentScripts() {
    try {
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (tab.url && (tab.url.startsWith('http://') || tab.url.startsWith('https://'))) {
          chrome.tabs.reload(tab.id).catch(() => {});
        }
      }
    } catch (e) {}
  }

  async setupContextMenu() {
    try {
      await chrome.contextMenus.removeAll();

      chrome.contextMenus.create({
        id: 'TRANSLATE_SELECTION',
        title: '"%s" übersetzen',
        contexts: ['selection']
      });

      chrome.contextMenus.create({
        id: 'TRANSLATE_WORD',
        title: 'Wort übersetzen',
        contexts: ['page']
      });

      chrome.contextMenus.create({
        id: 'TRANSLATE_PAGE_CMD',
        title: 'Seite übersetzen',
        contexts: ['page']
      });

      chrome.contextMenus.create({
        id: 'separator1',
        type: 'separator',
        contexts: ['page', 'selection']
      });

      // Export-Untermenü
      chrome.contextMenus.create({
        id: 'EXPORT_MENU',
        title: 'Exportieren',
        contexts: ['page']
      });

      chrome.contextMenus.create({
        id: 'EXPORT_PDF_CMD',
        parentId: 'EXPORT_MENU',
        title: 'Als PDF (Standard)',
        contexts: ['page']
      });

      chrome.contextMenus.create({
        id: 'EXPORT_PDF_SIMPLE',
        parentId: 'EXPORT_MENU',
        title: 'Als PDF (Vereinfacht)',
        contexts: ['page']
      });

      chrome.contextMenus.create({
        id: 'EXPORT_MARKDOWN_CMD',
        parentId: 'EXPORT_MENU',
        title: 'Als Markdown',
        contexts: ['page']
      });

      chrome.contextMenus.create({
        id: 'EXPORT_TEXT_CMD',
        parentId: 'EXPORT_MENU',
        title: 'Als Text',
        contexts: ['page']
      });

      chrome.contextMenus.create({
        id: 'separator2',
        type: 'separator',
        contexts: ['page']
      });

      chrome.contextMenus.create({
        id: 'OPEN_SIDEPANEL_CMD',
        title: 'Side Panel öffnen',
        contexts: ['page', 'selection']
      });

      chrome.contextMenus.create({
        id: 'OPEN_OPTIONS',
        title: 'Einstellungen',
        contexts: ['page']
      });

      chrome.contextMenus.onClicked.addListener((info, tab) => {
        this.handleContextMenuClick(info, tab);
      });
    } catch (e) {
      console.warn('Context menu error:', e);
    }
  }

  async handleContextMenuClick(info, tab) {
    try {
      switch (info.menuItemId) {
        case 'TRANSLATE_SELECTION':
          await this.translateAndShowResult(info.selectionText, tab);
          break;
        case 'TRANSLATE_WORD':
          await this.sendToContentScript(tab.id, { 
            action: 'TRANSLATE_WORD_AT_CURSOR',
            x: info.pageX || 0,
            y: info.pageY || 0
          });
          break;
        case 'TRANSLATE_PAGE_CMD':
          await this.sendToContentScript(tab.id, { action: 'TRANSLATE_PAGE', mode: 'replace' });
          break;
        case 'EXPORT_PDF_CMD':
          await this.sendToContentScript(tab.id, { action: 'EXPORT_PDF', simplified: false });
          break;
        case 'EXPORT_PDF_SIMPLE':
          await this.sendToContentScript(tab.id, { action: 'EXPORT_PDF', simplified: true });
          break;
        case 'EXPORT_MARKDOWN_CMD':
          await this.sendToContentScript(tab.id, { action: 'EXPORT_MARKDOWN' });
          break;
        case 'EXPORT_TEXT_CMD':
          await this.sendToContentScript(tab.id, { action: 'EXPORT_TEXT' });
          break;
        case 'OPEN_SIDEPANEL_CMD':
          await chrome.sidePanel.open({ tabId: tab.id });
          if (info.selectionText) {
            setTimeout(() => {
              chrome.runtime.sendMessage({ action: 'SIDEPANEL_TRANSLATE', text: info.selectionText });
            }, 300);
          }
          break;
        case 'OPEN_OPTIONS':
          chrome.runtime.openOptionsPage();
          break;
      }
    } catch (e) {
      console.warn('Context menu click error:', e);
    }
  }

  async handleCommand(command) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return;

      switch (command) {
        case 'TRANSLATE_SELECTION':
          const response = await this.sendToContentScript(tab.id, { action: 'GET_SELECTION' });
          if (response?.text) {
            await this.translateAndShowResult(response.text, tab);
          }
          break;
        case 'TRANSLATE_PAGE_CMD':
          await this.sendToContentScript(tab.id, { action: 'TRANSLATE_PAGE', mode: 'replace' });
          break;
        case 'TOGGLE_SIDEPANEL':
          await chrome.sidePanel.open({ tabId: tab.id });
          break;
      }
    } catch (e) {
      console.warn('Command error:', e);
    }
  }

  async handleMessage(request, sender, sendResponse) {
    try {
      switch (request.action) {
        case 'TRANSLATE':
          const result = await this.translateText(request.text, request.source, request.target, request.pageUrl);
          sendResponse(result);
          break;

        case 'TRANSLATE_BATCH':
          const batchResult = await this.translateBatch(
            request.texts, 
            request.source, 
            request.target, 
            request.pageUrl,
            request.cacheOnly || false
          );
          sendResponse(batchResult);
          break;

        case 'GET_SETTINGS':
          const settings = await chrome.storage.sync.get();
          sendResponse({ success: true, settings });
          break;

        case 'GET_HISTORY':
          const history = await this.getHistory();
          sendResponse({ success: true, history });
          break;

        case 'CLEAR_HISTORY':
          await this.clearHistory();
          sendResponse({ success: true });
          break;

        case 'DELETE_HISTORY_ENTRY':
          await this.deleteHistoryEntry(request.index);
          sendResponse({ success: true });
          break;

        case 'ADD_TO_HISTORY':
          await this.addToHistory(request.entry);
          sendResponse({ success: true });
          break;

        case 'OPEN_SIDE_PANEL':
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab) await chrome.sidePanel.open({ tabId: tab.id });
          sendResponse({ success: true });
          break;

        case 'GET_API_TYPE':
          const apiSettings = await chrome.storage.sync.get(['apiType']);
          sendResponse({ success: true, apiType: apiSettings.apiType || 'libretranslate' });
          break;

        case 'GET_TOKEN_STATS':
          const tokenStats = await this.getTokenStats();
          sendResponse({ success: true, stats: tokenStats });
          break;

        case 'UPDATE_TOKEN_STATS':
          const updatedStats = await this.updateTokenStats(request.usage);
          sendResponse({ success: true, stats: updatedStats });
          break;

        case 'RESET_TOKEN_STATS':
          await this.resetTokenStats();
          sendResponse({ success: true });
          break;

        case 'PAGE_STATUS_CHANGED':
          // Status-Änderung an alle Extension-Pages weiterleiten
          chrome.runtime.sendMessage({ action: 'PAGE_STATUS_CHANGED' }).catch(() => {});
          sendResponse({ success: true });
          break;

        // === Cache Server Proxy (für Mixed Content) ===
        case 'CACHE_SERVER_BULK_GET':
          console.log('[Background] cacheServerBulkGet:', request.hashes?.length, 'hashes');
          const bulkGetResult = await CacheServer.bulkGet(request.hashes, request.pageUrl);
          console.log('[Background] bulkGet result:', Object.keys(bulkGetResult?.translations || {}).length, 'translations');
          sendResponse({ success: true, result: bulkGetResult });
          break;

        case 'CACHE_SERVER_BULK_STORE':
          const storeResult = await CacheServer.bulkStore(request.translations, request.langPair);
          sendResponse({ success: true, result: storeResult });
          break;

        case 'CACHE_SERVER_BULK_DELETE':
          const deleteResult = await CacheServer.bulkDelete(request.hashes);
          sendResponse({ success: true, result: deleteResult });
          break;

        case 'CACHE_SERVER_DELETE_BY_URL':
          const urlDeleteResult = await CacheServer.deleteByUrl(request.pageUrl);
          sendResponse({ success: true, result: urlDeleteResult });
          break;

        case 'CACHE_SERVER_GET_URL_STATS':
          const urlStatsResult = await CacheServer.getUrlStats(request.pageUrl);
          sendResponse({ success: true, result: urlStatsResult });
          break;

        case 'CACHE_SERVER_GET_ALL_BY_URL':
          const allByUrlResult = await CacheServer.getAllByUrl(request.pageUrl);
          sendResponse({ success: true, result: allByUrlResult });
          break;

        case 'CACHE_SERVER_DELETE_BY_HASH':
          const deleteByHashResult = await CacheServer.deleteByHash(request.pageUrl, request.hash);
          sendResponse({ success: true, result: deleteByHashResult });
          break;

        case 'CACHE_SERVER_DELETE_BY_DOMAIN':
          const domainDeleteResult = await CacheServer.deleteByDomain(request.domain);
          sendResponse({ success: true, ...domainDeleteResult });
          break;

        case 'CACHE_SERVER_LIST_URLS':
          const urlsResult = await CacheServer.listCachedUrls();
          sendResponse({ success: true, result: urlsResult });
          break;

        case 'CACHE_SERVER_CLEAR_ALL':
          const clearResult = await CacheServer.clearAll();
          sendResponse({ success: true, result: clearResult });
          break;

        case 'GET_CACHE_SERVER_STATS':
          const cacheStats = await CacheServer.getStats();
          sendResponse({ success: true, stats: cacheStats });
          break;

        default:
          sendResponse({ success: false, error: 'Unknown action' });
      }
    } catch (e) {
      console.warn('Message handler error:', e);
      sendResponse({ success: false, error: e.message });
    }
  }

  async translateAndShowResult(text, tab) {
    if (!text?.trim()) return;

    const settings = await chrome.storage.sync.get(['sourceLang', 'targetLang']);
    const result = await this.translateText(
      text.trim(),
      settings.sourceLang || 'auto',
      settings.targetLang || 'de'
    );

    if (result.success) {
      await this.addToHistory({
        original: text.trim(),
        translated: result.translatedText,
        source: settings.sourceLang || 'auto',
        target: settings.targetLang || 'de',
        timestamp: Date.now(),
        apiType: result.apiType
      });

      await this.sendToContentScript(tab.id, {
        action: 'SHOW_TRANSLATION',
        original: text.trim(),
        translated: result.translatedText,
        alternatives: result.alternatives,
        contextNotes: result.contextNotes
      });
    } else {
      await this.sendToContentScript(tab.id, {
        action: 'SHOW_ERROR',
        message: result.error || 'Übersetzungsfehler'
      });
    }
  }

  async translateText(text, source = 'auto', target = 'de', pageUrl = null) {
    // Leere/ungültige Texte sofort abweisen
    if (!text || text.trim().length < 2) {
      return { success: false, error: 'Text zu kurz oder leer' };
    }

    // Sprachrichtung für Cache-Hash
    const langPair = `${source || 'auto'}:${target || 'de'}`;
    
    
    // 1. Cache-Server prüfen (wenn aktiviert und URL vorhanden)
    if (CacheServer.config.enabled && CacheServer.config.mode !== 'local-only' && pageUrl) {
      try {
        const hash = await CacheServer.computeHash(pageUrl, text, langPair);
        const cached = await CacheServer.get(hash, pageUrl);
        if (cached) {
          return {
            success: true,
            translatedText: cached.translated,
            alternatives: [],
            apiType: 'cache',
            tokens: 0,
            fromCache: true
          };
        }
      } catch (e) {
        console.warn('[CacheServer] Cache-Check fehlgeschlagen:', e);
      }
    }

    // 2. Normale Übersetzung -- nur wenn API konfiguriert
    const settings = await chrome.storage.sync.get([
      'apiType', 'serviceUrl', 'apiKey',
      'lmStudioUrl', 'lmStudioModel', 'lmStudioTemperature',
      'lmStudioMaxTokens', 'lmStudioContext', 'lmStudioCustomPrompt',
      'enableLLMFallback'
    ]);

    const apiType = settings.apiType || 'libretranslate';

    // Prüfen ob API konfiguriert ist
    if (apiType === 'libretranslate' && !settings.serviceUrl) {
      return { success: false, error: 'LibreTranslate nicht konfiguriert. Bitte URL in den Einstellungen setzen.' };
    }
    if (apiType === 'lmstudio' && !settings.lmStudioUrl) {
      return { success: false, error: 'LM Studio nicht konfiguriert. Bitte URL in den Einstellungen setzen.' };
    }

    let result;

    if (apiType === 'lmstudio') {
      // Nutze Queue für Batch-Prefetch (effizienter als Einzel-Requests)
      result = await this.translateWithLMStudioQueue(text, source, target, pageUrl, settings);
      
      // Fallback auf LibreTranslate wenn aktiviert und Fehler
      if (!result.success && settings.enableLLMFallback) {
        result = await this.translateWithLibreTranslate(text, source, target, settings);
        result.fallbackUsed = true;
      }
    } else {
      result = await this.translateWithLibreTranslate(text, source, target, settings);
    }

    // 3. Bei Erfolg im Cache speichern (nur wenn original ≠ translated)
    if (result.success && pageUrl && CacheServer.config.enabled && CacheServer.config.mode !== 'local-only') {
      // Nicht cachen wenn keine echte Übersetzung
      if (text.trim() !== result.translatedText.trim()) {
        CacheServer.store(pageUrl, text, result.translatedText, langPair).catch(() => {});
      }
    }

    return result;
  }

  async translateWithLibreTranslate(text, source, target, settings) {
    return LibreTranslateProvider.translate(text, source, target, settings);
  }

  async translateWithLMStudio(text, source, target, settings) {
    return LMStudioProvider.translate(
      text, source, target, settings,
      (usage) => this.updateTokenStats(usage)
    );
  }

  /**
   * Translation Queue für LM Studio (v3.11.5)
   * Sammelt einzelne Übersetzungsanfragen in GEORDNETER Queue
   * Sendet sie als Batch und gibt Ergebnisse in EXAKT gleicher Reihenfolge zurück
   * Index-basierte Zuordnung statt Text-Matching für 100% Reihenfolge-Garantie
   */
  async translateWithLMStudioQueue(text, source, target, pageUrl, settings) {
    const queue = this.translationQueue;
    const normalizedText = text.trim();
    const langPair = `${source || 'auto'}:${target || 'de'}`;
    
    // URL normalisieren für Buffer-Key (ohne Hash/Query für normale Seiten)
    let normalizedUrl = '';
    if (pageUrl) {
      try {
        const url = new URL(pageUrl);
        normalizedUrl = url.origin + url.pathname;
      } catch (e) {
        normalizedUrl = pageUrl;
      }
    }
    
    // 1. Schon im lokalen Buffer? → Sofort zurückgeben
    const bufferKey = `${normalizedUrl}:${normalizedText}:${source}:${target}`;
    if (queue.buffer.has(bufferKey)) {
      const cached = queue.buffer.get(bufferKey);
      return {
        success: true,
        translatedText: cached,
        apiType: 'lmstudio',
        fromBuffer: true,
        tokens: 0
      };
    }
    
    // 2. Cache-Server prüfen (wenn aktiviert)
    if (CacheServer.config.enabled && CacheServer.config.mode !== 'local-only' && pageUrl) {
      try {
        const hash = await CacheServer.computeHash(pageUrl, normalizedText, langPair);
        const cached = await CacheServer.get(hash, pageUrl);
        
        if (cached && cached.translated) {
          queue.buffer.set(bufferKey, cached.translated);
          return {
            success: true,
            translatedText: cached.translated,
            apiType: 'lmstudio',
            fromCache: true,
            tokens: 0
          };
        }
      } catch (e) {
        console.warn('[Queue] Cache-Check Fehler:', e.message);
      }
    }
    
    // 3. Bereits in der (alten) pending Map? → Auf selbes Promise warten
    if (queue.pending.has(bufferKey)) {
      return queue.pending.get(bufferKey).promise;
    }
    
    // 4. Neuen Request in GEORDNETE Queue einfügen (mit Sequenznummer)
    let resolvePromise, rejectPromise;
    const promise = new Promise((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    
    const queueIndex = queue.nextIndex++;
    const entry = {
      index: queueIndex,
      bufferKey,
      text: normalizedText,
      source,
      target,
      pageUrl,
      langPair,
      settings,
      resolve: resolvePromise,
      reject: rejectPromise,
      promise
    };
    
    // In beide Strukturen einfügen (Map für Duplikat-Check, Array für Reihenfolge)
    queue.pending.set(bufferKey, entry);
    queue.orderedQueue.push(entry);
    
    // 5. Verarbeitung planen (maxBatchSize wird zentral verwaltet)
    this.scheduleQueueProcessing();
    
    return promise;
  }

  /**
   * Plant die Batch-Verarbeitung der Queue (v3.11.5)
   */
  scheduleQueueProcessing() {
    const queue = this.translationQueue;
    
    // Bereits in Verarbeitung?
    if (queue.isProcessing) return;
    
    // Timer zurücksetzen
    if (queue.batchTimeout) {
      clearTimeout(queue.batchTimeout);
    }
    
    // Sofort senden wenn maxBatchSize erreicht
    if (queue.orderedQueue.length >= queue.maxBatchSize) {
      this.processTranslationQueue();
      return;
    }
    
    // Sonst nach kurzer Verzögerung (sammelt weitere Requests)
    queue.batchTimeout = setTimeout(() => {
      this.processTranslationQueue();
    }, queue.batchDelay);
  }


  /**
   * Verarbeitet die Translation Queue (v3.11.5)
   * GARANTIERT: Ergebnisse werden in EXAKT der Reihenfolge zurückgegeben,
   * in der die Requests eingegangen sind (Index-basierte Zuordnung)
   */
  async processTranslationQueue() {
    const queue = this.translationQueue;
    
    if (queue.orderedQueue.length === 0 || queue.isProcessing) return;
    
    queue.isProcessing = true;
    
    // Aus geordneter Queue die ersten N Elemente nehmen (strikt in Reihenfolge!)
    // Die Queue ist bereits nach Eingangsreihenfolge sortiert
    const batchSize = Math.min(queue.maxBatchSize, queue.orderedQueue.length);
    const entries = queue.orderedQueue.splice(0, batchSize); // Entfernt und gibt zurück
    
    // Texte in EXAKTER Reihenfolge extrahieren
    const texts = entries.map(entry => entry.text);
    const { source, target, pageUrl, langPair, settings } = entries[0];
    
    console.log(`[Queue] Verarbeite Batch: ${texts.length} Texte (Index ${entries[0].index} bis ${entries[entries.length-1].index})`);
    
    // Sammle Übersetzungen für Bulk-Cache-Speicherung
    const toCache = [];
    
    try {
      // Batch-Übersetzung mit LM Studio
      const result = await this.batchTranslateWithLMStudio(texts, source, target, settings);
      
      if (result.success && result.items && result.items.length === texts.length) {
        // INDEX-BASIERTE Zuordnung: result.items[i] gehört zu entries[i]
        console.log(`[Queue] Batch erfolgreich: ${result.items.length} Ergebnisse in Reihenfolge`);
        
        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i];
          const resultItem = result.items[i];
          const translation = resultItem?.translation || entry.text;
          
          // In lokalen Buffer speichern
          queue.buffer.set(entry.bufferKey, translation);
          
          // Für Cache-Server sammeln (nur wenn unterschiedlich)
          if (entry.text.trim() !== translation.trim() && entry.pageUrl) {
            toCache.push({
              pageUrl: entry.pageUrl,
              original: entry.text,
              translated: translation,
              langPair: entry.langPair
            });
          }
          
          // Promise auflösen - IN REIHENFOLGE
          entry.resolve({
            success: true,
            translatedText: translation,
            apiType: 'lmstudio',
            tokens: Math.floor((result.tokens || 0) / texts.length)
          });
          
          // Aus pending Map entfernen
          queue.pending.delete(entry.bufferKey);
        }
        
      } else if (result.success && result.items) {
        // Fallback: Anzahl stimmt nicht - Text-basiertes Matching als Backup
        console.warn(`[Queue] Batch-Größe mismatch: erwartet ${texts.length}, erhalten ${result.items.length} - Fallback auf Text-Matching`);
        
        const resultMap = new Map();
        result.items.forEach(item => {
          resultMap.set(item.original.trim(), item.translation);
        });
        
        for (const entry of entries) {
          let translation = resultMap.get(entry.text) || entry.text;
          
          queue.buffer.set(entry.bufferKey, translation);
          
          if (entry.text.trim() !== translation.trim() && entry.pageUrl) {
            toCache.push({
              pageUrl: entry.pageUrl,
              original: entry.text,
              translated: translation,
              langPair: entry.langPair
            });
          }
          
          entry.resolve({
            success: true,
            translatedText: translation,
            apiType: 'lmstudio',
            tokens: Math.floor((result.tokens || 0) / texts.length)
          });
          
          queue.pending.delete(entry.bufferKey);
        }
        
      } else {
        // Batch fehlgeschlagen - einzeln übersetzen (in Reihenfolge!)
        console.warn('[Queue] Batch fehlgeschlagen, Fallback auf sequentielle Einzelübersetzung');
        
        for (const entry of entries) {
          try {
            const singleResult = await this.translateWithLMStudio(entry.text, source, target, settings);
            const translation = singleResult.success ? singleResult.translatedText : entry.text;
            
            queue.buffer.set(entry.bufferKey, translation);
            
            if (entry.text.trim() !== translation.trim() && entry.pageUrl) {
              toCache.push({
                pageUrl: entry.pageUrl,
                original: entry.text,
                translated: translation,
                langPair: entry.langPair
              });
            }
            
            entry.resolve(singleResult.success ? singleResult : {
              success: true,
              translatedText: entry.text,
              apiType: 'lmstudio',
              tokens: 0
            });
          } catch (e) {
            entry.resolve({ success: true, translatedText: entry.text, apiType: 'lmstudio', tokens: 0 });
          }
          
          queue.pending.delete(entry.bufferKey);
        }
      }
      
      // Cache-Server Bulk-Store (async, nicht blockierend)
      if (toCache.length > 0 && CacheServer.config.enabled && CacheServer.config.mode !== 'local-only') {
        CacheServer.bulkStore(toCache).catch(e => {
          console.warn('[Queue] Cache-Server Speicherung fehlgeschlagen:', e);
        });
      }
      
    } catch (e) {
      console.warn('[Queue] Kritischer Fehler:', e);
      
      // Alle entries mit Fehler auflösen (nicht ablehnen, damit Content-Script weiterarbeitet)
      for (const entry of entries) {
        entry.resolve({ success: true, translatedText: entry.text, apiType: 'lmstudio', tokens: 0, error: e.message });
        queue.pending.delete(entry.bufferKey);
      }
    }
    
    queue.isProcessing = false;
    
    // Weitere Items in Queue? → Nächsten Batch starten
    if (queue.orderedQueue.length > 0) {
      this.scheduleQueueProcessing();
    }
  }

  async translateBatch(texts, source, target, pageUrl = null, cacheOnly = false) {
    // 1. Cache-Bulk-Check wenn aktiviert und URL vorhanden
    const textHashMap = new Map(); // text → hash
    const hashTextMap = new Map(); // hash → text
    let cachedResults = [];
    let textsToTranslate = [...texts];
    
    const langPair = `${source || 'auto'}:${target || 'de'}`;

    if (CacheServer.config.enabled && CacheServer.config.mode !== 'local-only' && pageUrl) {
      try {
        for (const text of texts) {
          const hash = await CacheServer.computeHash(pageUrl, text, langPair);
          textHashMap.set(text, hash);
          hashTextMap.set(hash, text);
        }
        
        // Debug: Ersten Hash loggen
        if (texts.length > 0) {
          const firstHash = textHashMap.get(texts[0]);
          console.log(`[translateBatch] Erster Hash: ${firstHash} für "${texts[0].substring(0, 40)}..."`);
        }
        
        // Bulk-Abfrage - WICHTIG: pageUrl für url_hash übergeben!
        const hashes = Array.from(textHashMap.values());
        const cacheResult = await CacheServer.bulkGet(hashes, pageUrl);
        
        console.log(`[translateBatch] Server returned: ${Object.keys(cacheResult.translations || {}).length} translations`);
        
        // Gecachte Ergebnisse extrahieren
        for (const [hash, cached] of Object.entries(cacheResult.translations || {})) {
          const originalText = hashTextMap.get(hash);
          if (originalText && cached.translated) {
            cachedResults.push({
              original: originalText,
              translation: cached.translated,
              fromCache: true
            });
          }
        }
        
        // Nur fehlende Texte übersetzen
        if (cachedResults.length > 0) {
          const cachedTexts = new Set(cachedResults.map(r => r.original));
          textsToTranslate = texts.filter(t => !cachedTexts.has(t));
          // console.log(`[CacheServer] Batch: ${cachedResults.length} aus Cache, ${textsToTranslate.length} zu übersetzen`);
        }
      } catch (e) {
        console.warn('[CacheServer] Batch-Cache-Check fehlgeschlagen:', e);
      }
    }

    // Cache-Only Modus: Nur gecachte Ergebnisse zurückgeben (keine Übersetzung)
    if (cacheOnly) {
      console.log(`[Background] cacheOnly: ${cachedResults.length} aus Cache`);
      return {
        success: true,
        items: cachedResults,
        cacheHits: cachedResults.length,
        translated: 0,
        tokens: 0
      };
    }

    // 2. Fehlende Texte übersetzen
    let translatedResults = [];
    let totalTokens = 0;
    
    if (textsToTranslate.length > 0) {
      const settings = await chrome.storage.sync.get([
        'apiType', 'serviceUrl', 'apiKey',
        'lmStudioUrl', 'lmStudioModel', 'lmStudioTemperature',
        'lmStudioMaxTokens', 'lmStudioContext', 'lmStudioCustomPrompt',
        'lmBatchSize', 'lmMaxBatchTokens', 'enableTrueBatch', 'enableSmartChunking'
      ]);

      const apiType = settings.apiType || 'libretranslate';

      if (apiType === 'lmstudio') {
        const result = await this.batchTranslateWithLMStudio(textsToTranslate, source, target, settings);
        if (result.success) {
          translatedResults = result.items;
          totalTokens = result.tokens || 0;
        }
      } else {
        // LibreTranslate: Einzeln übersetzen
        for (const text of textsToTranslate) {
          const result = await this.translateWithLibreTranslate(text, source, target, settings);
          translatedResults.push({
            original: text,
            translation: result.success ? result.translatedText : text
          });
        }
      }

      // 3. Neue Übersetzungen im Cache speichern (nur wenn original ≠ translated)
      if (translatedResults.length > 0 && pageUrl && CacheServer.config.enabled && CacheServer.config.mode !== 'local-only') {
        console.log('[Background] Speichere Übersetzungen, pageUrl:', pageUrl);
        
        const toStore = translatedResults
          .filter(r => r.original.trim() !== r.translation.trim()) // Keine identischen
          .map(r => ({
            pageUrl,
            original: r.original,
            translated: r.translation
          }));
        
        if (toStore.length > 0) {
          console.log('[Background] toStore:', toStore.length, 'Items, erster Text:', toStore[0].original.substring(0, 50));
          CacheServer.bulkStore(toStore, langPair).catch((e) => console.warn('[Background] bulkStore Fehler:', e));
        }
      }
    }

    // 4. Ergebnisse zusammenführen (in Original-Reihenfolge)
    const resultMap = new Map();
    for (const r of [...cachedResults, ...translatedResults]) {
      resultMap.set(r.original, r);
    }
    
    const orderedResults = texts.map(text => 
      resultMap.get(text) || { original: text, translation: text }
    );

    return {
      success: true, 
      items: orderedResults,
      cacheHits: cachedResults.length,
      translated: translatedResults.length,
      tokens: totalTokens
    };
  }

  async batchTranslateWithLMStudio(texts, source, target, settings) {
    try {
      const url = settings.lmStudioUrl;
      const model = settings.lmStudioModel;
      
      if (!model) {
        throw new Error('Kein LM Studio Modell ausgewählt');
      }

      // Batch-Einstellungen laden (v3.5)
      const maxBatchTokens = settings.lmMaxBatchTokens || 128000;
      const enableSmartChunking = settings.enableSmartChunking !== false;
      
      // Smart Chunking: Texte in optimale Sub-Batches aufteilen
      const chunks = enableSmartChunking 
        ? this.createSmartChunks(texts, maxBatchTokens)
        : [texts];
      
      const allResults = [];
      let totalTokensUsed = 0;  // Token-Summe über alle Chunks
      let totalPromptTokens = 0;
      let totalCompletionTokens = 0;
      
      for (const chunk of chunks) {
        // Newlines durch Platzhalter ersetzen (verhindert Escape-Probleme)
        const NEWLINE_PLACEHOLDER = '⏎';
        const chunkWithPlaceholders = chunk.map(text => text.replace(/\n/g, NEWLINE_PLACEHOLDER));
        
        // Batch-Prompt mit Sprachplatzhaltern
        const sourceLabel = source === 'auto' ? 'der Quellsprache' : LMStudioProvider._getLanguageName(source);
        const targetLabel = LMStudioProvider._getLanguageName(target);
        const systemPrompt = BATCH_PROMPT
          .replace(/{source}/g, sourceLabel)
          .replace(/{target}/g, targetLabel)
          + `\n\nWICHTIG: Das Zeichen "${NEWLINE_PLACEHOLDER}" markiert Zeilenumbrüche. Behalte sie exakt an der gleichen Position in der Übersetzung bei.`;

        // Dynamisches Token-Limit basierend auf Chunk-Größe
        // ~4 chars = 1 Token (grobe Schätzung), Output ca. 1.5x Input
        const estimatedInputTokens = chunkWithPlaceholders.reduce((sum, t) => sum + Math.ceil(t.length / 4), 0);
        const estimatedOutputTokens = Math.ceil(estimatedInputTokens * 1.5) + 1000; // Buffer für JSON
        const dynamicMaxTokens = Math.min(
          Math.max(estimatedOutputTokens, 8000),  // Minimum 8000
          maxBatchTokens
        );

        const response = await fetch(`${url}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: JSON.stringify(chunkWithPlaceholders) }
            ],
            temperature: settings.lmStudioTemperature || 0.1,
            max_tokens: dynamicMaxTokens,
            response_format: {
              type: 'json_schema',
              json_schema: {
                name: 'translations',
                strict: true,
                schema: {
                  type: 'object',
                  properties: {
                    items: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          original: { type: 'string' },
                          translation: { type: 'string' }
                        },
                        required: ['original', 'translation'],
                        additionalProperties: false
                      }
                    }
                  },
                  required: ['items'],
                  additionalProperties: false
                }
              }
            }
          })
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const result = await response.json();
        const content = result.choices[0].message.content;
        const parsed = JSON.parse(content);
        
        // Token-Stats sammeln und aktualisieren
        if (result.usage) {
          totalTokensUsed += result.usage.total_tokens || 0;
          totalPromptTokens += result.usage.prompt_tokens || 0;
          totalCompletionTokens += result.usage.completion_tokens || 0;
          await this.updateTokenStats(result.usage);
        }
        
        // VALIDIERUNG: Prüfen ob alle Texte übersetzt wurden
        const receivedItems = parsed.items || [];
        
        // Normalisierungs-Funktion für Vergleich
        const normalizeText = (text) => text?.trim().replace(/\s+/g, ' ') || '';
        
        // Map für Platzhalter-Texte → Original-Texte
        // Key: Text MIT Platzhaltern (wie von LLM empfangen)
        // Value: Original-Text OHNE Platzhalter
        const placeholderToOriginalMap = new Map();
        chunk.forEach((originalText, idx) => {
          const withPlaceholder = chunkWithPlaceholders[idx];
          placeholderToOriginalMap.set(normalizeText(withPlaceholder), originalText);
        });
        
        if (receivedItems.length !== chunk.length) {
          console.warn(`[Batch] WARNUNG: Erwartet ${chunk.length} Übersetzungen, erhalten: ${receivedItems.length}`);
          
          // Finde fehlende Texte (mit normalisiertem Vergleich)
          // Vergleiche mit Platzhalter-Versionen, da LLM diese zurückgibt
          const receivedNormalized = new Set(receivedItems.map(item => normalizeText(item.original)));
          const missingIndices = chunkWithPlaceholders
            .map((text, idx) => receivedNormalized.has(normalizeText(text)) ? -1 : idx)
            .filter(idx => idx !== -1);
          
          if (missingIndices.length > 0) {
            const missingTexts = missingIndices.map(idx => chunk[idx]);
            console.log(`[Batch] Fehlende Texte (${missingTexts.length}):`, missingTexts.map(t => t.substring(0, 50)));
            
            // Retry: Fehlende Texte einzeln übersetzen (Original ohne Platzhalter)
            for (const missingText of missingTexts) {
              console.log(`[Batch] Retry für fehlenden Text:`, missingText.substring(0, 50));
              const retryResult = await this.translateWithLMStudio(missingText, source, target, settings);
              if (retryResult.success) {
                receivedItems.push({
                  original: missingText.replace(/\n/g, NEWLINE_PLACEHOLDER), // Für Map-Lookup
                  translation: retryResult.translatedText
                });
                totalTokensUsed += retryResult.tokens || 0;
              } else {
                // Fallback: Original Text verwenden
                console.warn(`[Batch] Retry fehlgeschlagen für:`, missingText.substring(0, 50));
                receivedItems.push({
                  original: missingText.replace(/\n/g, NEWLINE_PLACEHOLDER),
                  translation: missingText
                });
              }
            }
          }
        }
        
        // Original-Texte korrigieren (KI könnte sie verändert haben)
        // UND Platzhalter zurück zu echten Newlines wandeln
        const correctedItems = receivedItems.map(item => {
          const normalized = normalizeText(item.original);
          const originalText = placeholderToOriginalMap.get(normalized);
          
          // Platzhalter zurückwandeln
          let correctedOriginal = originalText || item.original;
          let correctedTranslation = item.translation;
          
          // Original: Platzhalter → echte Newlines (falls aus chunk)
          correctedOriginal = correctedOriginal.replace(new RegExp(NEWLINE_PLACEHOLDER, 'g'), '\n');
          // Translation: Platzhalter → echte Newlines
          correctedTranslation = correctedTranslation.replace(new RegExp(NEWLINE_PLACEHOLDER, 'g'), '\n');
          // Auch escaped variants behandeln
          correctedTranslation = correctedTranslation.replace(/\\n/g, '\n');
          
          return { 
            original: correctedOriginal, 
            translation: correctedTranslation 
          };
        });
        
        allResults.push(...correctedItems);
      }
      
      // Token-Info in Antwort zurückgeben für content.js
      return { 
        success: true, 
        items: allResults,
        tokens: totalTokensUsed,
        usage: {
          total_tokens: totalTokensUsed,
          prompt_tokens: totalPromptTokens,
          completion_tokens: totalCompletionTokens
        }
      };
    } catch (e) {
      console.warn('LM Studio batch error:', e);
      // Fallback: Einzeln übersetzen
      const results = [];
      let fallbackTokens = 0;
      for (const text of texts) {
        const result = await this.translateWithLMStudio(text, source, target, settings);
        results.push({
          original: text,
          translation: result.success ? result.translatedText : text
        });
        fallbackTokens += result.tokens || 0;
      }
      return { success: true, items: results, tokens: fallbackTokens };
    }
  }

  // Smart Chunking: Optimale Sub-Batches basierend auf Token-Limits
  createSmartChunks(texts, maxBatchTokens) {
    const chunks = [];
    let currentChunk = [];
    let currentTokens = 0;
    
    // System-Prompt Overhead (~500 Tokens) + JSON Overhead
    const overheadTokens = 800;
    const availableTokens = maxBatchTokens - overheadTokens;
    
    for (const text of texts) {
      // Schätzung: ~4 chars = 1 Token, Output ca. 1.5x
      const textTokens = Math.ceil(text.length / 4) * 2.5;
      
      // Einzelner Text zu lang? → Trotzdem hinzufügen (wird vom LLM gekürzt)
      if (textTokens > availableTokens && currentChunk.length === 0) {
        chunks.push([text]);
        continue;
      }
      
      // Würde Token-Limit überschreiten? → Neuen Chunk starten
      if (currentTokens + textTokens > availableTokens && currentChunk.length > 0) {
        chunks.push(currentChunk);
        currentChunk = [];
        currentTokens = 0;
      }
      
      currentChunk.push(text);
      currentTokens += textTokens;
    }
    
    // Restlichen Chunk hinzufügen
    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
    }
    
    // console.log(`[Batch] ${texts.length} Texte → ${chunks.length} Chunks (max ${maxBatchTokens} Tokens)`);
    return chunks;
  }

  buildSystemPrompt(settings, source, target) {
    return LMStudioProvider.buildSystemPrompt(settings, source, target);
  }

  async sendToContentScript(tabId, message) {
    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (e) {
      console.warn('Content script unreachable:', e);
      return null;
    }
  }

  async getHistory() {
    const data = await chrome.storage.local.get(['translationHistory']);
    return data.translationHistory || [];
  }

  async addToHistory(entry) {
    const history = await this.getHistory();
    history.unshift(entry);
    await chrome.storage.local.set({ translationHistory: history.slice(0, 100) });
  }

  async clearHistory() {
    await chrome.storage.local.set({ translationHistory: [] });
  }

  async deleteHistoryEntry(index) {
    const data = await chrome.storage.local.get(['translationHistory']);
    const history = data.translationHistory || [];
    if (index >= 0 && index < history.length) {
      history.splice(index, 1);
      await chrome.storage.local.set({ translationHistory: history });
    }
  }

  // === Token Statistics ===
  async getTokenStats() {
    const data = await chrome.storage.local.get(['tokenStats']);
    return data.tokenStats || {
      totalTokens: 0,
      promptTokens: 0,
      completionTokens: 0,
      requestCount: 0,
      lastUpdated: null
    };
  }

  async updateTokenStats(usage) {
    if (!usage) return;
    
    const stats = await this.getTokenStats();
    stats.totalTokens += usage.total_tokens || 0;
    stats.promptTokens += usage.prompt_tokens || 0;
    stats.completionTokens += usage.completion_tokens || 0;
    stats.requestCount += 1;
    stats.lastUpdated = Date.now();
    
    await chrome.storage.local.set({ tokenStats: stats });

    return stats;
  }

  async resetTokenStats() {
    await chrome.storage.local.set({ 
      tokenStats: {
        totalTokens: 0,
        promptTokens: 0,
        completionTokens: 0,
        requestCount: 0,
        lastUpdated: null
      }
    });
  }

  async setDefaultSettings() {
    const defaults = {
      // API-Typ (neu)
      apiType: 'libretranslate',
      
      // LibreTranslate
      serviceUrl: '',
      apiKey: '',
      
      // LM Studio (neu)
      lmStudioUrl: '',
      lmStudioModel: '',
      lmStudioTemperature: 0.1,
      lmStudioMaxTokens: 2000,
      lmStudioContext: 'general',
      lmStudioCustomPrompt: '',
      
      // Batch-Einstellungen (v3.5)
      lmBatchSize: 20,
      lmMaxBatchTokens: 128000,
      enableTrueBatch: true,
      enableSmartChunking: true,
      
      // Sprachen
      sourceLang: 'auto',
      targetLang: 'de',
      
      // UI
      showSelectionIcon: true,
      selectionIconDelay: 200,
      tooltipPosition: 'below',
      tooltipAutoHide: true,
      tooltipAutoHideDelay: 5000,
      enableDoubleClick: false,
      showOriginalInTooltip: true,
      showAlternatives: true,
      enableTTS: false,
      ttsLanguage: 'de-DE',
      skipCodeBlocks: true,
      skipBlockquotes: true,
      highlightTranslated: true,
      useTabsForAlternatives: true,
      simplifyPdfExport: false,
      fixInlineSpacing: true,
      tabWordThreshold: 20,
      excludedDomains: ''
    };
    await chrome.storage.sync.set(defaults);
  }
}

new TranslatorBackground();
