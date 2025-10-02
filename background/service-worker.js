// Background Script - Smart Web Translator v3.12.1 mit Queue-Batching
// v3.12.1: Middleware-Batching mit Index-basierter Reihenfolge-Garantie
// v3.12.0: Zwei-Hash-System (url_hash + translation_hash), neues API-Format

// ==========================================================================
// CACHE SERVER INTEGRATION
// ==========================================================================

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
          console.error('[CacheServer] Speichern fehlgeschlagen:', response.status);
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

// ==========================================================================
// FACHKONTEXT SYSTEM-PROMPTS
// ==========================================================================

// Fachkontext System-Prompts (identisch mit options.js für Konsistenz)
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

  custom: ''
};

// Batch-Übersetzungs-Prompt für Seitenübersetzung
const BATCH_PROMPT = `Du bist ein Batch-Übersetzer {source} → {target}.
Du erhältst ein JSON-Array mit Texten.
Übersetze jeden Text einzeln und behalte die EXAKTE Reihenfolge bei.
Antworte NUR mit JSON im Format:
{"items": [{"original": "...", "translation": "..."}, ...]}
WICHTIG: Die Anzahl der Ausgabe-Items MUSS der Anzahl der Eingabe-Items entsprechen.`;

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
    } else if (details.reason === 'update') {
      // Migration für bestehende Nutzer
      await this.migrateSettings();
    }
    await this.setupContextMenu();
  }

  async migrateSettings() {
    const settings = await chrome.storage.sync.get();
    
    // Wenn alte Settings, aber kein apiType → Default auf LibreTranslate
    if (!settings.apiType) {
      await chrome.storage.sync.set({
        apiType: 'libretranslate',
        lmStudioUrl: 'http://192.168.178.45:1234',
        lmStudioModel: '',
        lmStudioTemperature: 0.1,
        lmStudioMaxTokens: 2000,
        lmStudioContext: 'general',
        lmStudioCustomPrompt: ''
      });
    }
  }

  async setupContextMenu() {
    try {
      await chrome.contextMenus.removeAll();

      chrome.contextMenus.create({
        id: 'translate-selection',
        title: '🌐 "%s" übersetzen',
        contexts: ['selection']
      });

      chrome.contextMenus.create({
        id: 'translate-word',
        title: '🌐 Wort übersetzen',
        contexts: ['page']
      });

      chrome.contextMenus.create({
        id: 'translate-page',
        title: '🌐 Seite übersetzen',
        contexts: ['page']
      });

      chrome.contextMenus.create({
        id: 'separator1',
        type: 'separator',
        contexts: ['page', 'selection']
      });

      // Export-Untermenü
      chrome.contextMenus.create({
        id: 'export-menu',
        title: '📥 Exportieren',
        contexts: ['page']
      });

      chrome.contextMenus.create({
        id: 'export-pdf',
        parentId: 'export-menu',
        title: 'Als PDF (Standard)',
        contexts: ['page']
      });

      chrome.contextMenus.create({
        id: 'export-pdf-simple',
        parentId: 'export-menu',
        title: 'Als PDF (Vereinfacht)',
        contexts: ['page']
      });

      chrome.contextMenus.create({
        id: 'export-markdown',
        parentId: 'export-menu',
        title: 'Als Markdown',
        contexts: ['page']
      });

      chrome.contextMenus.create({
        id: 'export-text',
        parentId: 'export-menu',
        title: 'Als Text',
        contexts: ['page']
      });

      chrome.contextMenus.create({
        id: 'separator2',
        type: 'separator',
        contexts: ['page']
      });

      chrome.contextMenus.create({
        id: 'open-sidepanel',
        title: '📋 Side Panel öffnen',
        contexts: ['page', 'selection']
      });

      chrome.contextMenus.create({
        id: 'open-options',
        title: '⚙️ Einstellungen',
        contexts: ['page']
      });

      chrome.contextMenus.onClicked.addListener((info, tab) => {
        this.handleContextMenuClick(info, tab);
      });
    } catch (e) {
      console.error('Context menu error:', e);
    }
  }

  async handleContextMenuClick(info, tab) {
    try {
      switch (info.menuItemId) {
        case 'translate-selection':
          await this.translateAndShowResult(info.selectionText, tab);
          break;
        case 'translate-word':
          await this.sendToContentScript(tab.id, { 
            action: 'translateWordAtCursor',
            x: info.pageX || 0,
            y: info.pageY || 0
          });
          break;
        case 'translate-page':
          await this.sendToContentScript(tab.id, { action: 'translatePage', mode: 'replace' });
          break;
        case 'export-pdf':
          await this.sendToContentScript(tab.id, { action: 'exportPdf', simplified: false });
          break;
        case 'export-pdf-simple':
          await this.sendToContentScript(tab.id, { action: 'exportPdf', simplified: true });
          break;
        case 'export-markdown':
          await this.sendToContentScript(tab.id, { action: 'exportMarkdown' });
          break;
        case 'export-text':
          await this.sendToContentScript(tab.id, { action: 'exportText' });
          break;
        case 'open-sidepanel':
          await chrome.sidePanel.open({ tabId: tab.id });
          if (info.selectionText) {
            setTimeout(() => {
              chrome.runtime.sendMessage({ action: 'sidepanel-translate', text: info.selectionText });
            }, 300);
          }
          break;
        case 'open-options':
          chrome.runtime.openOptionsPage();
          break;
      }
    } catch (e) {
      console.error('Context menu click error:', e);
    }
  }

  async handleCommand(command) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return;

      switch (command) {
        case 'translate-selection':
          const response = await this.sendToContentScript(tab.id, { action: 'getSelection' });
          if (response?.text) {
            await this.translateAndShowResult(response.text, tab);
          }
          break;
        case 'translate-page':
          await this.sendToContentScript(tab.id, { action: 'translatePage', mode: 'replace' });
          break;
        case 'toggle-sidepanel':
          await chrome.sidePanel.open({ tabId: tab.id });
          break;
      }
    } catch (e) {
      console.error('Command error:', e);
    }
  }

  async handleMessage(request, sender, sendResponse) {
    try {
      switch (request.action) {
        case 'translate':
          const result = await this.translateText(request.text, request.source, request.target, request.pageUrl);
          sendResponse(result);
          break;

        case 'translateBatch':
          const batchResult = await this.translateBatch(
            request.texts, 
            request.source, 
            request.target, 
            request.pageUrl,
            request.cacheOnly || false
          );
          sendResponse(batchResult);
          break;

        case 'getSettings':
          const settings = await chrome.storage.sync.get();
          sendResponse({ success: true, settings });
          break;

        case 'getHistory':
          const history = await this.getHistory();
          sendResponse({ success: true, history });
          break;

        case 'clearHistory':
          await this.clearHistory();
          sendResponse({ success: true });
          break;

        case 'addToHistory':
          await this.addToHistory(request.entry);
          sendResponse({ success: true });
          break;

        case 'openSidePanel':
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab) await chrome.sidePanel.open({ tabId: tab.id });
          sendResponse({ success: true });
          break;

        case 'getApiType':
          const apiSettings = await chrome.storage.sync.get(['apiType']);
          sendResponse({ success: true, apiType: apiSettings.apiType || 'libretranslate' });
          break;

        case 'getTokenStats':
          const tokenStats = await this.getTokenStats();
          sendResponse({ success: true, stats: tokenStats });
          break;

        case 'updateTokenStats':
          const updatedStats = await this.updateTokenStats(request.usage);
          sendResponse({ success: true, stats: updatedStats });
          break;

        case 'resetTokenStats':
          await this.resetTokenStats();
          sendResponse({ success: true });
          break;

        case 'page-status-changed':
          // Status-Änderung an alle Extension-Pages weiterleiten
          chrome.runtime.sendMessage({ action: 'page-status-changed' }).catch(() => {});
          sendResponse({ success: true });
          break;

        // === Cache Server Proxy (für Mixed Content) ===
        case 'cacheServerBulkGet':
          console.log('[Background] cacheServerBulkGet:', request.hashes?.length, 'hashes');
          const bulkGetResult = await CacheServer.bulkGet(request.hashes, request.pageUrl);
          console.log('[Background] bulkGet result:', Object.keys(bulkGetResult?.translations || {}).length, 'translations');
          sendResponse({ success: true, result: bulkGetResult });
          break;

        case 'cacheServerBulkStore':
          const storeResult = await CacheServer.bulkStore(request.translations, request.langPair);
          sendResponse({ success: true, result: storeResult });
          break;

        case 'cacheServerBulkDelete':
          const deleteResult = await CacheServer.bulkDelete(request.hashes);
          sendResponse({ success: true, result: deleteResult });
          break;

        case 'cacheServerDeleteByUrl':
          const urlDeleteResult = await CacheServer.deleteByUrl(request.pageUrl);
          sendResponse({ success: true, result: urlDeleteResult });
          break;

        case 'cacheServerGetUrlStats':
          const urlStatsResult = await CacheServer.getUrlStats(request.pageUrl);
          sendResponse({ success: true, result: urlStatsResult });
          break;

        case 'cacheServerGetAllByUrl':
          const allByUrlResult = await CacheServer.getAllByUrl(request.pageUrl);
          sendResponse({ success: true, result: allByUrlResult });
          break;

        case 'cacheServerDeleteByHash':
          const deleteByHashResult = await CacheServer.deleteByHash(request.pageUrl, request.hash);
          sendResponse({ success: true, result: deleteByHashResult });
          break;

        case 'cacheServerDeleteByDomain':
          const domainDeleteResult = await CacheServer.deleteByDomain(request.domain);
          sendResponse({ success: true, ...domainDeleteResult });
          break;

        case 'cacheServerListUrls':
          const urlsResult = await CacheServer.listCachedUrls();
          sendResponse({ success: true, result: urlsResult });
          break;

        case 'cacheServerClearAll':
          const clearResult = await CacheServer.clearAll();
          sendResponse({ success: true, result: clearResult });
          break;

        case 'getCacheServerStats':
          const cacheStats = await CacheServer.getStats();
          sendResponse({ success: true, stats: cacheStats });
          break;

        default:
          sendResponse({ success: false, error: 'Unknown action' });
      }
    } catch (e) {
      console.error('Message handler error:', e);
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
        action: 'showTranslation',
        original: text.trim(),
        translated: result.translatedText,
        alternatives: result.alternatives,
        contextNotes: result.contextNotes
      });
    } else {
      await this.sendToContentScript(tab.id, {
        action: 'showError',
        message: result.error || 'Übersetzungsfehler'
      });
    }
  }

  async translateText(text, source = 'auto', target = 'de', pageUrl = null) {
    // Sprachrichtung für Cache-Hash - MUSS mit content-cache.js übereinstimmen
    const langPair = `${source || 'auto'}:${target || 'de'}`;
    
    // E-Book Erkennung
    const isEbook = pageUrl?.includes('#epubcfi');
    
    // 1. Cache-Server prüfen (wenn aktiviert und URL vorhanden)
    if (CacheServer.config.enabled && CacheServer.config.mode !== 'local-only' && pageUrl) {
      try {
        const hash = await CacheServer.computeHash(pageUrl, text, langPair, isEbook);
        const cached = await CacheServer.get(hash, pageUrl);  // pageUrl für url_hash
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

    // 2. Normale Übersetzung
    const settings = await chrome.storage.sync.get([
      'apiType', 'serviceUrl', 'apiKey',
      'lmStudioUrl', 'lmStudioModel', 'lmStudioTemperature',
      'lmStudioMaxTokens', 'lmStudioContext', 'lmStudioCustomPrompt',
      'enableLLMFallback'
    ]);

    const apiType = settings.apiType || 'libretranslate';
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
    try {
      const serviceUrl = settings.serviceUrl || 'http://localhost:5000/translate';

      const response = await fetch(serviceUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          q: text,
          source: source,
          target: target,
          format: 'text',
          alternatives: 3,
          api_key: settings.apiKey || ''
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      return {
        success: true,
        translatedText: result.translatedText || text,
        alternatives: result.alternatives || [],
        detectedLanguage: result.detectedLanguage,
        apiType: 'libretranslate',
        tokens: 0 // LibreTranslate hat keine Token-Info
      };
    } catch (e) {
      console.error('LibreTranslate error:', e);
      return { success: false, error: e.message };
    }
  }

  async translateWithLMStudio(text, source, target, settings) {
    try {
      const url = settings.lmStudioUrl || 'http://192.168.178.45:1234';
      const model = settings.lmStudioModel;
      
      if (!model) {
        throw new Error('Kein LM Studio Modell ausgewählt');
      }

      const systemPrompt = this.buildSystemPrompt(settings, source, target);

      const response = await fetch(`${url}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: text }
          ],
          temperature: settings.lmStudioTemperature || 0.1,
          max_tokens: settings.lmStudioMaxTokens || 16000,
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
        throw new Error('Ungültige Antwort vom LM Studio Server');
      }

      const content = result.choices[0].message.content;
      
      // Token-Usage extrahieren und persistent speichern
      const usage = result.usage || {};
      const tokens = usage.total_tokens || 
                    (usage.prompt_tokens || 0) + (usage.completion_tokens || 0);
      
      // Globale Token-Stats aktualisieren
      if (usage.total_tokens) {
        await this.updateTokenStats(usage);
      }
      
      try {
        const parsed = JSON.parse(content);
        // Escaped Newlines zurückwandeln (falls LLM \n statt echtem Newline zurückgibt)
        let translation = parsed.translation;
        translation = translation.replace(/\\n/g, '\n');
        
        return {
          success: true,
          translatedText: translation,
          alternatives: parsed.alternatives || [],
          contextNotes: parsed.context_notes,
          apiType: 'lmstudio',
          tokens: tokens,
          usage: usage
        };
      } catch (parseError) {
        // Fallback: Wenn kein JSON, nutze die rohe Antwort
        // Escaped Newlines zurückwandeln
        let translation = content.trim().replace(/\\n/g, '\n');
        return {
          success: true,
          translatedText: translation,
          alternatives: [],
          apiType: 'lmstudio',
          tokens: tokens,
          usage: usage
        };
      }
    } catch (e) {
      console.error('LM Studio error:', e);
      return { success: false, error: e.message };
    }
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
        const isEbook = pageUrl?.includes('#epubcfi');
        const hash = await CacheServer.computeHash(pageUrl, normalizedText, langPair, isEbook);
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
      console.error('[Queue] Kritischer Fehler:', e);
      
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
    
    // Sprachrichtung für Cache-Hash - MUSS mit content-cache.js übereinstimmen
    const langPair = `${source || 'auto'}:${target || 'de'}`;
    
    // E-Book Erkennung für korrekte Hash-Berechnung
    const isEbook = pageUrl?.includes('#epubcfi');
    if (isEbook) {
      console.log('[Background] E-Book erkannt, verwende Kapitel-normalisierte Hashes');
    }

    if (CacheServer.config.enabled && CacheServer.config.mode !== 'local-only' && pageUrl) {
      try {
        console.log(`[translateBatch] Cache-Check für pageUrl: ${pageUrl}`);
        
        // Hashes für alle Texte berechnen (URL + Text + Sprachrichtung)
        for (const text of texts) {
          // WICHTIG: includeHash für E-Books setzen!
          const hash = await CacheServer.computeHash(pageUrl, text, langPair, isEbook);
          textHashMap.set(text, hash);
          hashTextMap.set(hash, text);
        }
        
        // Debug: Ersten Hash loggen
        if (texts.length > 0) {
          const firstHash = textHashMap.get(texts[0]);
          console.log(`[translateBatch] Erster Hash: ${firstHash} für "${texts[0].substring(0, 40)}..."`);
          console.log(`[translateBatch] langPair: ${langPair}, isEbook: ${isEbook}`);
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
        console.log('[Background] isEbook:', pageUrl.includes('#epubcfi'), 'langPair:', langPair);
        
        const toStore = translatedResults
          .filter(r => r.original.trim() !== r.translation.trim()) // Keine identischen
          .map(r => ({
            pageUrl,
            original: r.original,
            translated: r.translation
          }));
        
        if (toStore.length > 0) {
          console.log('[Background] toStore:', toStore.length, 'Items, erster Text:', toStore[0].original.substring(0, 50));
          CacheServer.bulkStore(toStore, langPair).catch((e) => console.error('[Background] bulkStore Fehler:', e));
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
      const url = settings.lmStudioUrl || 'http://192.168.178.45:1234';
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
        const sourceLabel = source === 'auto' ? 'der Quellsprache' : this.getLanguageName(source);
        const targetLabel = this.getLanguageName(target);
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
      console.error('LM Studio batch error:', e);
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
    const context = settings.lmStudioContext || 'general';
    const customPrompt = settings.lmStudioCustomPrompt;
    
    let prompt = context === 'custom' && customPrompt 
      ? customPrompt 
      : CONTEXT_PROMPTS[context] || CONTEXT_PROMPTS.general;
    
    // Sprachbezeichnungen ersetzen
    const sourceLabel = source === 'auto' ? 'der Quellsprache' : this.getLanguageName(source);
    const targetLabel = this.getLanguageName(target);
    
    return prompt
      .replace(/{source}/g, sourceLabel)
      .replace(/{target}/g, targetLabel);
  }

  getLanguageName(code) {
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

  async sendToContentScript(tabId, message) {
    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (e) {
      console.error('Content script unreachable:', e);
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
    
    // Kosten aktualisieren wenn aktiviert
    await this.updateCost(usage.total_tokens || 0);
    
    return stats;
  }

  async updateCost(newTokens) {
    const settings = await chrome.storage.sync.get([
      'enableTokenCost', 'tokenCostAmount', 'tokenCostPer'
    ]);
    
    // Default: enableTokenCost = true
    if (settings.enableTokenCost === false) return;
    
    const costAmount = settings.tokenCostAmount || 1;
    const costPer = settings.tokenCostPer || 10000;
    
    // Cent pro X Tokens -> Hauptwährung
    const costPerToken = (costAmount / 100) / costPer;
    const addedCost = newTokens * costPerToken;
    
    const costData = await chrome.storage.local.get(['totalCost']);
    const newTotalCost = (costData.totalCost || 0) + addedCost;
    
    await chrome.storage.local.set({ totalCost: newTotalCost });
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
      serviceUrl: 'http://localhost:5000/translate',
      apiKey: '',
      
      // LM Studio (neu)
      lmStudioUrl: 'http://192.168.178.45:1234',
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
