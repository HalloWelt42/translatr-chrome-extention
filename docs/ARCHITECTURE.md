# Smart Web Translator - Architektur (v3.13.38+)

## Übersicht

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CONTENT SCRIPT                                  │
│                                                                             │
│  translatePage() / translateEbookBlocks() / translatePlainText()            │
│      │                                                                      │
│      ├─ findTranslatableTextNodes()                                        │
│      │                                                                      │
│      └─ FOR EACH node:                                                      │
│           chrome.runtime.sendMessage({                                      │
│             action: 'translate',      ← Einzel-Request (für ALLE Provider) │
│             text: originalText,                                             │
│             pageUrl: url                                                    │
│           })                                                                │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            BACKGROUND SCRIPT                                 │
│                                                                             │
│  translateText(text, source, target, pageUrl)                               │
│      │                                                                      │
│      ├─ Cache-Server Check (wenn aktiviert)                                │
│      │                                                                      │
│      ├─ LibreTranslate → translateWithLibreTranslate() → Direkt            │
│      │                                                                      │
│      └─ LM Studio → translateWithLMStudioQueue() ─────────────────┐        │
│                                                                    │        │
│  ┌─────────────────────────────────────────────────────────────────▼──────┐ │
│  │                      TRANSLATION QUEUE                                 │ │
│  │                                                                        │ │
│  │  translateWithLMStudioQueue(text, ...)                                │ │
│  │      │                                                                 │ │
│  │      ├─ 1. Buffer-Check (lokaler RAM-Cache)                           │ │
│  │      ├─ 2. Cache-Server-Check (wenn aktiviert)                        │ │
│  │      └─ 3. Zur Queue hinzufügen mit Promise                           │ │
│  │                                                                        │ │
│  │  scheduleQueueProcessing()                                            │ │
│  │      └─ Nach 50ms ODER wenn 20 Texte: processTranslationQueue()       │ │
│  │                                                                        │ │
│  │  processTranslationQueue()                                            │ │
│  │      │                                                                 │ │
│  │      ├─ Snapshot: max 20 Texte aus Queue                              │ │
│  │      ├─ batchTranslateWithLMStudio(texts[])                           │ │
│  │      ├─ Für jeden Text: Promise resolven                              │ │
│  │      ├─ In Buffer speichern                                           │ │
│  │      ├─ CacheServer.bulkStore() (async, nicht blockierend)            │ │
│  │      └─ Falls noch Items: scheduleQueueProcessing()                   │ │
│  │                                                                        │ │
│  │  Queue-Struktur:                                                       │ │
│  │  {                                                                     │ │
│  │    pending: Map<bufferKey, { text, resolve, reject, promise, ... }>,  │ │
│  │    buffer: Map<bufferKey, translation>,                               │ │
│  │    batchDelay: 50,     // ms                                          │ │
│  │    maxBatchSize: 20    // Texte                                       │ │
│  │  }                                                                     │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CACHE SERVER                                    │
│                              (FastAPI)                                       │
│                                                                             │
│  POST /cache/bulk    ← bulkStore() speichert neue Übersetzungen            │
│  POST /cache/get     ← bulkGet() holt gecachte Übersetzungen               │
│                                                                             │
│  Struktur:                                                                  │
│  /data/cache/{url_hash}/{trans_hash}.txt                                   │
│       │           │                                                         │
│       │           └─ SHA256(url + text + langPair)                         │
│       └─ SHA256(hostname)[:12]                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Datenfluss: Übersetzen einer Seite

```
1. User klickt "Übersetzen"
   │
   ▼
2. Content: findTranslatableTextNodes() → 65 Nodes
   │
   ▼
3. Content: Parallel-Loop (5er Batches)
   │
   FOR i = 0; i < 65; i += 5:
   │   Promise.all([
   │     translate(node[i].text),
   │     translate(node[i+1].text),
   │     ...
   │   ])
   │
   ▼
4. Background: translateText() aufgerufen (65x)
   │
   ├─ LM Studio? → translateWithLMStudioQueue()
   │   │
   │   ├─ Schon im Buffer? → Sofort returnen
   │   ├─ Im Cache-Server? → Sofort returnen
   │   └─ Zur Queue hinzufügen
   │
   └─ LibreTranslate? → Direkt übersetzen
   │
   ▼
5. Queue sammelt (50ms oder 20 Texte)
   │
   ▼
6. processTranslationQueue()
   │
   ├─ batchTranslateWithLMStudio([20 Texte])
   │   │
   │   └─ Ein LLM-Call mit JSON-Format:
   │      { items: [{ original, translation }, ...] }
   │
   ├─ Promises resolven (20x)
   │
   ├─ Buffer aktualisieren
   │
   └─ CacheServer.bulkStore() → POST /cache/bulk
   │
   ▼
7. Content erhält Übersetzungen (Promises resolved)
   │
   ▼
8. Content: wrapWithHoverOriginal() → DOM aktualisieren
```

---

## Datenfluss: Seite mit Cache neu laden

```
1. Seite geladen
   │
   ▼
2. Content: checkForCachedTranslation()
   │
   ├─ findTranslatableTextNodes() → Sample (50 Texte)
   │
   └─ SMT.Cache.checkCache(url, sampleTexts)
       │
       ├─ _checkLocalCache() → localStorage
       │
       └─ _checkServerCache() → 
           │
           ├─ Hashes berechnen (50x)
           │
           └─ SMT.CacheServer.bulkGet(hashes)
               │
               └─ chrome.runtime.sendMessage({
                    action: 'cacheServerBulkGet',
                    hashes: [...]
                  })
                  │
                  ▼
               Background: CacheServer.bulkGet()
                  │
                  └─ POST /cache/get → Server
   │
   ▼
3. Cache gefunden? (≥30% Match)
   │
   ├─ JA → setCacheAvailable(true)
   │        │
   │        └─ autoLoadCache? → loadCachedTranslation()
   │                            │
   │                            └─ Alle Texte laden & anwenden
   │
   └─ NEIN → checkAutoTranslateDomain()
```

---

## Komponenten

### Content Script (`content.js` + `content/*.js`)

| Datei | Verantwortung |
|-------|---------------|
| `content.js` | Haupt-Klasse SmartTranslator, Event-Handler |
| `content/content-dom.js` | DOM-Manipulation, Text-Node-Suche |
| `content/content-cache.js` | Cache-Check, Cache-Laden |
| `content/content-ui.js` | UI-Elemente (Tooltip, Icon, Progress) |
| `content/content-export.js` | PDF/HTML Export |

### Background Script (`background.js`)

| Bereich | Verantwortung |
|---------|---------------|
| `CacheServer` | Objekt für Server-Kommunikation |
| `TranslatorModule` | Übersetzungs-Logik |
| `translationQueue` | Queue-basiertes Batching für LM Studio |
| Message Handler | `chrome.runtime.onMessage` |

### Shared (`shared/*.js`)

| Datei | Verantwortung |
|-------|---------------|
| `cache-server.js` | CacheServer-API für Content-Script |
| `cache-api.js` | Abstrakte Cache-API (lokal + Server) |
| `utils.js` | Hilfsfunktionen |
| `toast.js` | Toast-Notifications |

---

## Cache-Server API

| Methode | Endpunkt | Beschreibung |
|---------|----------|--------------|
| POST | `/cache/bulk` | Mehrere Übersetzungen speichern |
| POST | `/cache/get` | Mehrere Übersetzungen abrufen |
| GET | `/cache/url/{hash}/all` | Alle Einträge einer URL |
| DELETE | `/cache/url/{hash}` | Alle Einträge löschen |
| GET | `/stats` | Statistiken |
| GET | `/health` | Health-Check |

---

## Hash-Berechnung

### url_hash (12 Zeichen)
```javascript
SHA256(hostname.toLowerCase())[:12]

// Beispiel:
// "https://svelte.dev/docs" → SHA256("svelte.dev")[:12] → "a1b2c3d4e5f6"
```

### trans_hash (64 Zeichen)
```javascript
SHA256(normalizedUrl + text + langPair)

// Für E-Books: epubcfi auf Kapitel normalisieren
// epubcfi(/6/14!/4/2/...) → epubcfi(/6/14)

// Beispiel:
// "https://site.com/page" + "Hello" + "en:de" → "f1e2d3c4b5a6..."
```

---

## Konfiguration

### Settings (chrome.storage.sync)

| Key | Default | Beschreibung |
|-----|---------|--------------|
| `cacheServerEnabled` | `true` | Cache-Server aktiv |
| `cacheServerUrl` | `http://192.168.178.49:8083` | Server-URL |
| `cacheServerMode` | `server-only` | `local-only`, `server-only`, `both` |
| `apiType` | `libretranslate` | `libretranslate` oder `lmstudio` |
| `useCacheFirst` | `true` | Cache vor Übersetzung prüfen |

### Queue-Konstanten (in code)

| Konstante | Wert | Beschreibung |
|-----------|------|--------------|
| `batchDelay` | 50ms | Warten vor Batch-Verarbeitung |
| `maxBatchSize` | 20 | Max Texte pro LLM-Call |
| `parallelSize` | 5 | Parallele Requests im Content |

---

## Version History

| Version | Änderung |
|---------|----------|
| v3.13.35 | Queue-basiertes Batching eingeführt |
| v3.13.37 | Cache-Server Integration in Queue |
| v3.13.38 | 162 Zeilen toter Code entfernt |
| v3.13.39 | Debug-Logging für Cache-Probleme |
