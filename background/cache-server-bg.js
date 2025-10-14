const CacheServer = {
  config: {
    enabled: true,  // Default: aktiviert
    serverUrl: 'http://192.168.178.49:8083',
    mode: 'server-only',  // Default: nur Server (localStorage nur bei Fehler)
    timeout: 5000,
    translator: 'unknown'
  },

  // Status-Tracking
  status: {
    online: null,        // null = unbekannt, true/false
    lastCheck: 0,
    failCount: 0,
    lastError: null
  },

  async init() {
    try {
      const stored = await chrome.storage.sync.get({
        cacheServerEnabled: true,  // Default: aktiviert
        cacheServerUrl: 'http://192.168.178.49:8083',
        cacheServerMode: 'server-only',  // Default: nur Server
        cacheServerTimeout: 5000,
        apiType: 'libretranslate',
        lmStudioModel: ''
      });
      
      this.config.enabled = stored.cacheServerEnabled;
      this.config.serverUrl = stored.cacheServerUrl.replace(/\/$/, '');
      this.config.mode = stored.cacheServerMode;
      this.config.timeout = stored.cacheServerTimeout;
      this.config.translator = stored.apiType === 'lmstudio' && stored.lmStudioModel
        ? `lmstudio:${stored.lmStudioModel}`
        : stored.apiType || 'unknown';
      
      // Status zurücksetzen bei Neuinitialisierung
      this.status = { online: null, lastCheck: 0, failCount: 0, lastError: null };
      
      // console.log('[CacheServer] Initialisiert:', this.config.enabled ? 'aktiviert' : 'deaktiviert');
    } catch (e) {
      console.warn('[CacheServer] Init-Fehler:', e);
    }
  },

  // Text normalisieren - NICHT mehr, jedes Zeichen zählt!
  // normalizeText entfernt - wir wollen exakte Matches

  // SHA-256 Hash berechnen: URL + Text + Sprachrichtung (für Übersetzung)
  async computeHash(pageUrl, text, langPair = null, includeHash = false) {
    // URL normalisieren
    const url = new URL(pageUrl);
    
    // Für E-Books (epubcfi): Hash auf Kapitel-Ebene einbeziehen!
    // Für normale Seiten: Hash ignorieren (Anchor-Links)
    let normalizedUrl;
    if (includeHash && url.hash && url.hash.includes('epubcfi')) {
      // E-Book: epubcfi auf KAPITEL-EBENE normalisieren (Teil vor !)
      // epubcfi(/6/14!/...) → nur /6/14 verwenden
      const match = url.hash.match(/epubcfi\(([^!]+)!/);
      if (match) {
        const spinePath = match[1];
        normalizedUrl = url.origin + url.pathname + '#epubcfi(' + spinePath + ')';
      } else {
        normalizedUrl = url.origin + url.pathname + url.hash;
      }
    } else {
      // Normal: Ohne Hash
      normalizedUrl = url.origin + url.pathname;
    }
    
    // Sprachrichtung hinzufügen (z.B. "en:de")
    const langSuffix = langPair ? `:${langPair}` : '';
    
    // Hash aus URL + Text + Sprachrichtung (jedes Zeichen zählt)
    const content = normalizedUrl + text + langSuffix;
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    // Debug-Log nur für E-Books beim ersten Aufruf
    if (includeHash && !this._hashLogDone) {
      console.log('[Background computeHash] normalizedUrl:', normalizedUrl);
      console.log('[Background computeHash] langPair:', langPair);
      console.log('[Background computeHash] text (50):', text.substring(0, 50));
      console.log('[Background computeHash] → hash:', hash);
      this._hashLogDone = true;
    }
    
    return hash;
  },

  // URL-Hash berechnen: Nur Host/Domain (12 Zeichen)
  // Wird als Ordnername auf dem Server verwendet
  async computeUrlHash(pageUrl) {
    const url = new URL(pageUrl);
    let host = url.hostname.toLowerCase();
    
    // www. entfernen
    if (host.startsWith('www.')) {
      host = host.slice(4);
    }
    
    // Port hinzufügen wenn nicht Standard
    if (url.port && !['80', '443', ''].includes(url.port)) {
      host += ':' + url.port;
    }
    
    // SHA-256, erste 12 Zeichen
    const encoder = new TextEncoder();
    const data = encoder.encode(host);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const fullHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return fullHash.substring(0, 12);
  },

  // Prüfen ob Server wahrscheinlich erreichbar ist
  shouldTryServer() {
    if (!this.config.enabled) return false;
    
    // Bei zu vielen Fehlern: Backoff
    if (this.status.failCount >= 3) {
      const backoffMs = Math.min(30000, 1000 * Math.pow(2, this.status.failCount - 3));
      const elapsed = Date.now() - this.status.lastCheck;
      if (elapsed < backoffMs) {
        return false; // Noch im Backoff
      }
    }
    
    return true;
  },

  // Fehler registrieren
  registerError(error) {
    this.status.failCount++;
    this.status.lastCheck = Date.now();
    this.status.lastError = error.message;
    this.status.online = false;
    
    if (this.status.failCount === 3) {
      console.warn('[CacheServer] Mehrere Fehler - aktiviere Backoff');
    }
  },

  // Erfolg registrieren
  registerSuccess() {
    this.status.failCount = 0;
    this.status.lastCheck = Date.now();
    this.status.lastError = null;
    this.status.online = true;
  },

  // Fetch mit Timeout und Retry
  async fetchWithRetry(url, options = {}, maxRetries = 2) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timeout = this.config.timeout + (attempt * 2000); // Timeout steigt
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      
      try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(timeoutId);
        
        if (response.ok) {
          this.registerSuccess();
          return response;
        }
        
        // 429 Too Many Requests
        if (response.status === 429 && attempt < maxRetries) {
          const retryAfter = parseInt(response.headers.get('Retry-After') || '2');
          await new Promise(r => setTimeout(r, retryAfter * 1000));
          continue;
        }
        
        // 5xx Server Error → Retry
        if (response.status >= 500 && attempt < maxRetries) {
          await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
          continue;
        }
        
        // Anderer Fehler
        throw new Error(`HTTP ${response.status}`);
        
      } catch (e) {
        clearTimeout(timeoutId);
        
        if (attempt === maxRetries) {
          this.registerError(e);
          throw e;
        }
        
        // Bei Timeout oder Netzwerkfehler: Retry
        if (e.name === 'AbortError' || e.message.includes('fetch')) {
          await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
          continue;
        }
        
        throw e;
      }
    }
  },

  // Übersetzung aus Cache holen (MIT url_hash für korrekten Ordner!)
  async get(hash, pageUrl = null) {
    if (!this.shouldTryServer()) return null;
    
    try {
      // NEUE API: POST /cache/get mit url_hash
      if (pageUrl) {
        const urlHash = await this.computeUrlHash(pageUrl);
        const response = await this.fetchWithRetry(
          `${this.config.serverUrl}/cache/get`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url_hash: urlHash, hashes: [hash] })
          },
          1
        );
        
        if (response.ok) {
          const data = await response.json();
          if (data.translations && data.translations[hash]) {
            const entry = data.translations[hash];
            return {
              original: this.decodeText(entry.original),
              translated: this.decodeText(entry.translated)
            };
          }
        }
        return null;
      }
      
      // Fallback: Alter Endpunkt (ohne url_hash - sollte vermieden werden!)
      console.warn('[CacheServer] get() ohne pageUrl aufgerufen - URL-spezifisches Caching nicht möglich!');
      const response = await this.fetchWithRetry(
        `${this.config.serverUrl}/cache/${hash}`,
        {},
        1 // Nur 1 Retry für Single-Requests
      );
      
      if (response.ok) {
        // Response ist Text: Zeile1=original (base64), Zeile2=translated (base64), Zeile3=timestamp
        const text = await response.text();
        const lines = text.split('\n');
        
        if (lines.length >= 2) {
          return {
            original: this.decodeText(lines[0]),
            translated: this.decodeText(lines[1]),
            timestamp: lines[2] || null
          };
        }
        return null;
      }
      return null;
    } catch (e) {
      // 404 ist kein Fehler, nur Cache-Miss
      if (e.message === 'HTTP 404') {
        this.registerSuccess(); // Server ist erreichbar
        return null;
      }
      console.warn('[CacheServer] Get-Fehler:', e.message);
      return null;
    }
  },

  // Text für Cache als Base64 codieren
  encodeText(text) {
    return btoa(unescape(encodeURIComponent(text)));
  },
  
  // Text aus Cache von Base64 decodieren
  decodeText(base64) {
    return decodeURIComponent(escape(atob(base64)));
  },

  // Übersetzung im Cache speichern (pageUrl + original + langPair → hash)
  async store(pageUrl, original, translated, langPair = null) {
    if (!this.shouldTryServer()) return null;
    
    // Nicht speichern wenn original === translated
    if (original.trim() === translated.trim()) {
      return null;
    }
    
    try {
      // E-Book Erkennung für korrekte Hash-Berechnung
      const isEbook = pageUrl?.includes('#epubcfi');
      const hash = await this.computeHash(pageUrl, original, langPair, isEbook);
      
      // Texte Base64-codieren für 2-Zeilen-Format
      const encodedOriginal = this.encodeText(original);
      const encodedTranslated = this.encodeText(translated);
      
      const response = await this.fetchWithRetry(
        `${this.config.serverUrl}/cache/${hash}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: `${encodedOriginal}\n${encodedTranslated}`
        },
        1
      );
      
      if (response.ok) {
        return { hash, created: true };
      }
      return null;
    } catch (e) {
      console.warn('[CacheServer] Store-Fehler:', e.message);
      return null;
    }
  },

  // Bulk-Abfrage: Mehrere Hashes auf einmal prüfen
  // Neues Format: url_hash + hashes Array
  async bulkGet(hashes, pageUrl = null) {
    if (!this.shouldTryServer() || !hashes.length) {
      return { translations: {}, missing: hashes };
    }
    
    try {
      // url_hash berechnen wenn pageUrl gegeben
      const urlHash = pageUrl ? await this.computeUrlHash(pageUrl) : null;
      
      const chunkSize = 100;
      const results = { translations: {}, missing: [] };
      
      for (let i = 0; i < hashes.length; i += chunkSize) {
        const chunk = hashes.slice(i, i + chunkSize);
        
        try {
          // Neues Format: POST mit url_hash und hashes
          const requestBody = urlHash 
            ? { url_hash: urlHash, hashes: chunk }
            : { hashes: chunk };
          
          const response = await this.fetchWithRetry(
            `${this.config.serverUrl}/cache/get`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(requestBody)
            },
            2
          );
          
          if (response.ok) {
            // Response: { url_hash, found, translations: { hash: {original, translated} } }
            const data = await response.json();
            
            for (const [hash, entry] of Object.entries(data.translations || {})) {
              if (entry.original && entry.translated) {
                results.translations[hash] = {
                  original: this.decodeText(entry.original),
                  translated: this.decodeText(entry.translated)
                };
              }
            }
            
            // Missing = angefordert aber nicht in Response
            const foundHashes = new Set(Object.keys(data.translations || {}));
            chunk.forEach(h => {
              if (!foundHashes.has(h)) {
                results.missing.push(h);
              }
            });
          } else {
            results.missing.push(...chunk);
          }
        } catch (chunkError) {
          // Chunk fehlgeschlagen, als missing markieren
          results.missing.push(...chunk);
        }
      }
      
      return results;
    } catch (e) {
      console.warn('[CacheServer] BulkGet-Fehler:', e.message);
      return { translations: {}, missing: hashes };
    }
  },

  // Bulk-Speichern: Mehrere Übersetzungen auf einmal
  // translations: [{ pageUrl, original, translated, langPair }]
  // Format: { url_hash, items: { trans_hash: [original_b64, translated_b64] } }
  async bulkStore(translations, defaultLangPair = null) {
    console.log('[CacheServer] bulkStore aufgerufen:', translations.length, 'Übersetzungen');
    
    if (!this.shouldTryServer() || !translations.length) {
      console.log('[CacheServer] bulkStore abgebrochen - shouldTryServer:', this.shouldTryServer());
      return null;
    }
    
    try {
      // Gruppiere nach URL (normalerweise alle gleich)
      const byUrl = new Map();
      
      for (const t of translations) {
        // Nicht speichern wenn original === translated
        if (t.original.trim() === t.translated.trim()) {
          console.log('[CacheServer] Überspringe identisch:', t.original.substring(0, 30));
          continue;
        }
        
        const urlHash = await this.computeUrlHash(t.pageUrl);
        if (!byUrl.has(urlHash)) {
          byUrl.set(urlHash, { pageUrl: t.pageUrl, items: {} });
        }
        
        const langPair = t.langPair || defaultLangPair || 'auto:de';
        // E-Book Erkennung für korrekte Hash-Berechnung
        const isEbook = t.pageUrl?.includes('#epubcfi');
        const transHash = await this.computeHash(t.pageUrl, t.original, langPair, isEbook);
        
        // Ersten Hash mit Details loggen
        if (byUrl.get(urlHash) && Object.keys(byUrl.get(urlHash).items).length === 0) {
          console.log('[CacheServer] Erster Store-Hash:', transHash);
          console.log('[CacheServer] pageUrl:', t.pageUrl);
          console.log('[CacheServer] langPair:', langPair, 'isEbook:', isEbook);
          console.log('[CacheServer] Text:', t.original.substring(0, 50));
        }
        
        // Nur 2 Felder: original + translated (langPair ist im Hash codiert)
        byUrl.get(urlHash).items[transHash] = [
          this.encodeText(t.original),
          this.encodeText(t.translated)
        ];
      }
      
      if (byUrl.size === 0) {
        console.log('[CacheServer] Nichts zu speichern');
        return null;
      }
      
      let totalCreated = 0;
      
      // Für jede URL einen Request (normalerweise nur einer)
      for (const [urlHash, { items }] of byUrl) {
        if (Object.keys(items).length === 0) continue;
        
        console.log('[CacheServer] Speichere', Object.keys(items).length, 'Items für urlHash:', urlHash);
        
        const response = await this.fetchWithRetry(
          `${this.config.serverUrl}/cache/bulk`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url_hash: urlHash, items })
          },
          2
        );
        
        if (response.ok) {
          const result = await response.json();
          totalCreated += result.created || Object.keys(items).length;
          console.log('[CacheServer] Gespeichert:', result.created || Object.keys(items).length);
        } else {
          console.warn('[CacheServer] Speichern fehlgeschlagen:', response.status);
        }
      }
      
      return { created: totalCreated };
    } catch (e) {
      console.warn('[CacheServer] BulkStore-Fehler:', e.message);
      return null;
    }
  },

  // Health-Check
  async checkHealth() {
    if (!this.config.enabled) return { ok: false, reason: 'disabled' };
    
    try {
      const response = await this.fetchWithRetry(
        `${this.config.serverUrl}/health`,
        {},
        0 // Kein Retry für Health-Check
      );
      
      if (response.ok) {
        const data = await response.json();
        return { ok: true, data };
      }
      return { ok: false, reason: 'unhealthy' };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  },

  // Server-Statistiken holen
  async getStats() {
    if (!this.config.enabled) return null;
    
    try {
      const response = await this.fetchWithRetry(
        `${this.config.serverUrl}/stats`,
        {},
        0
      );
      
      if (response.ok) {
        return await response.json();
      }
      return null;
    } catch (e) {
      console.warn('[CacheServer] Stats-Fehler:', e.message);
      return null;
    }
  },

  // Bulk-Delete: Mehrere Cache-Einträge löschen (per Hash)
  async bulkDelete(hashes) {
    if (!this.shouldTryServer() || !hashes?.length) {
      return { deleted: 0, error: 'Nicht verfügbar' };
    }
    
    try {
      const response = await this.fetchWithRetry(
        `${this.config.serverUrl}/cache/bulk`,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hashes })
        },
        1
      );
      
      if (response.ok) {
        const result = await response.json();
        return { deleted: result.deleted || hashes.length };
      }
      return { deleted: 0, error: 'Server-Fehler' };
    } catch (e) {
      console.warn('[CacheServer] BulkDelete-Fehler:', e.message);
      return { deleted: 0, error: e.message };
    }
  },

  // Cache für eine URL löschen
  // Berechnet url_hash und ruft DELETE /cache/url/{url_hash}
  async deleteByUrl(pageUrl) {
    if (!this.shouldTryServer() || !pageUrl) {
      return { deleted: 0, error: 'Nicht verfügbar' };
    }
    
    try {
      const urlHash = await this.computeUrlHash(pageUrl);
      const response = await this.fetchWithRetry(
        `${this.config.serverUrl}/cache/url/${urlHash}`,
        {
          method: 'DELETE'
        },
        1
      );
      
      if (response.ok) {
        const result = await response.json();
        console.log(`[CacheServer] URL-Cache gelöscht: ${result.url_hash}, ${result.deleted} Einträge`);
        return result;
      }
      return { deleted: 0, error: 'Server-Fehler oder Endpunkt nicht verfügbar' };
    } catch (e) {
      console.warn('[CacheServer] DeleteByUrl-Fehler:', e.message);
      return { deleted: 0, error: e.message };
    }
  },
  
  // Stats für eine URL abrufen
  async getUrlStats(pageUrl) {
    if (!this.shouldTryServer() || !pageUrl) {
      return { count: 0 };
    }
    
    try {
      const urlHash = await this.computeUrlHash(pageUrl);
      const response = await this.fetchWithRetry(
        `${this.config.serverUrl}/cache/url/${urlHash}`,
        {},
        0
      );
      
      if (response.ok) {
        return await response.json();
      }
      return { url_hash: urlHash, count: 0 };
    } catch (e) {
      console.warn('[CacheServer] GetUrlStats-Fehler:', e.message);
      return { count: 0, error: e.message };
    }
  },

  // ALLE Übersetzungen einer URL abrufen
  async getAllByUrl(pageUrl) {
    if (!this.shouldTryServer() || !pageUrl) {
      return { translations: {}, count: 0 };
    }
    
    try {
      const urlHash = await this.computeUrlHash(pageUrl);
      const response = await this.fetchWithRetry(
        `${this.config.serverUrl}/cache/url/${urlHash}/all`,
        {},
        1
      );
      
      if (response.ok) {
        const data = await response.json();
        // Übersetzungen decodieren (nur original + translated)
        const decoded = {};
        for (const [hash, entry] of Object.entries(data.translations || {})) {
          decoded[hash] = {
            original: this.decodeText(entry.original),
            translated: this.decodeText(entry.translated)
          };
        }
        return { url_hash: urlHash, translations: decoded, count: data.count || Object.keys(decoded).length };
      }
      return { url_hash: urlHash, translations: {}, count: 0 };
    } catch (e) {
      console.warn('[CacheServer] GetAllByUrl-Fehler:', e.message);
      return { translations: {}, count: 0, error: e.message };
    }
  },

  // Einzelnen Cache-Eintrag löschen
  async deleteByHash(pageUrl, hash) {
    if (!this.shouldTryServer() || !hash) {
      return { deleted: false };
    }
    
    try {
      const urlHash = await this.computeUrlHash(pageUrl);
      const response = await this.fetchWithRetry(
        `${this.config.serverUrl}/cache/url/${urlHash}/${hash}`,
        { method: 'DELETE' },
        1
      );
      
      return { deleted: response.ok };
    } catch (e) {
      console.warn('[CacheServer] DeleteByHash-Fehler:', e.message);
      return { deleted: false, error: e.message };
    }
  },

  // Alle gecachten URLs auflisten
  async listCachedUrls() {
    if (!this.shouldTryServer()) {
      return { urls: [], error: 'Nicht verfügbar' };
    }
    
    try {
      const response = await this.fetchWithRetry(
        `${this.config.serverUrl}/cache/urls`,
        {},
        0
      );
      
      if (response.ok) {
        return await response.json();
      }
      return { urls: [], error: 'Server-Fehler' };
    } catch (e) {
      console.warn('[CacheServer] ListCachedUrls-Fehler:', e.message);
      return { urls: [], error: e.message };
    }
  },

  // Domain-weiten Cache löschen
  async deleteByDomain(domain) {
    if (!this.shouldTryServer() || !domain) {
      return { deleted: 0, error: 'Nicht verfügbar' };
    }
    
    try {
      // Alle gecachten URLs abrufen
      const urlsResult = await this.listCachedUrls();
      if (!urlsResult.urls || urlsResult.urls.length === 0) {
        return { deleted: 0 };
      }
      
      // URLs dieser Domain filtern
      const domainUrls = urlsResult.urls.filter(entry => {
        try {
          const url = new URL(entry.url);
          return url.hostname === domain || url.hostname.endsWith('.' + domain);
        } catch {
          return false;
        }
      });
      
      console.log(`[CacheServer] Domain ${domain}: ${domainUrls.length} URLs gefunden`);
      
      if (domainUrls.length === 0) {
        return { deleted: 0 };
      }
      
      // Alle URLs dieser Domain löschen
      let totalDeleted = 0;
      for (const entry of domainUrls) {
        const result = await this.deleteByUrl(entry.url);
        totalDeleted += result.deleted || 0;
      }
      
      console.log(`[CacheServer] Domain ${domain}: ${totalDeleted} Einträge gelöscht`);
      return { deleted: totalDeleted, urls: domainUrls.length };
      
    } catch (e) {
      console.warn('[CacheServer] DeleteByDomain-Fehler:', e.message);
      return { deleted: 0, error: e.message };
    }
  },

  // Gesamten Cache löschen (Admin-Funktion)
  async clearAll() {
    if (!this.shouldTryServer()) {
      return { deleted: 0, error: 'Nicht verfügbar' };
    }
    
    try {
      const response = await this.fetchWithRetry(
        `${this.config.serverUrl}/cache/all`,
        {
          method: 'DELETE'
        },
        1
      );
      
      if (response.ok) {
        const result = await response.json();
        return { deleted: result.deleted || 0, success: true };
      }
      return { deleted: 0, error: 'Server-Fehler oder Endpunkt nicht verfügbar' };
    } catch (e) {
      console.warn('[CacheServer] ClearAll-Fehler:', e.message);
      return { deleted: 0, error: e.message };
    }
  }
};

// Cache-Server beim Start initialisieren
CacheServer.init();

// Bei Settings-Änderung neu initialisieren
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && (changes.cacheServerEnabled || changes.cacheServerUrl || 
      changes.cacheServerMode || changes.apiType || changes.lmStudioModel)) {
    CacheServer.init();
  }
});

export { CacheServer };
