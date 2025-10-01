# SWT Cache Server - Zwei-Hash-System

## Konzept

Jede Anfrage enthält zwei Hash-Ebenen:
1. **url_hash**: SHA256 der normalisierten Domain (Ordnername)
2. **translation_hash**: SHA256 von URL+Text+LangPair (Dateiname)

```
/data/
└── {url_hash}/                    # Ordner = Hash der Domain
    ├── {translation_hash_1}.txt   # Datei = Übersetzungsdaten
    ├── {translation_hash_2}.txt
    └── ...
```

### Vorteile
- **Filesystem = Index**: Kein separater Index nötig
- **Effizientes Löschen**: `rm -rf /data/{url_hash}/`
- **Schnelle Stats**: `ls /data/{url_hash}/ | wc -l`
- **Client-seitig berechenbar**: Beide Hashes können vom Client berechnet werden

---

## Hash-Berechnung

### url_hash (12 Zeichen)
```javascript
// Client-seitig
function computeUrlHash(pageUrl) {
  const url = new URL(pageUrl);
  // Nur Host (ohne www, ohne Port wenn Standard)
  let host = url.hostname.toLowerCase();
  if (host.startsWith('www.')) host = host.slice(4);
  
  // SHA256, erste 12 Zeichen
  const hash = await sha256(host);
  return hash.substring(0, 12);
}

// Beispiele:
// https://svelte.dev/docs/intro     → sha256("svelte.dev")[:12]
// https://www.github.com/user/repo  → sha256("github.com")[:12]
// http://localhost:3000/page        → sha256("localhost:3000")[:12]
```

### translation_hash (wie bisher)
```javascript
function computeTranslationHash(pageUrl, text, langPair) {
  const normalized = `${pageUrl}|${text.trim()}|${langPair}`;
  return await sha256(normalized);
}
```

---

## Datenstrukturen

### POST /cache/bulk - Speichern

**Request:**
```json
{
  "url_hash": "a1b2c3d4e5f6",
  "items": {
    "f1e2d3c4b5a6...": ["T3JpZ2luYWwgVGV4dA==", "w5xiZXJzZXR6dW5n", "YXV0bzpkZQ=="],
    "1a2b3c4d5e6f...": ["QW5vdGhlciB0ZXh0", "Tm9jaCBlaW4gVGV4dA==", "YXV0bzpkZQ=="]
  }
}
```

| Feld | Beschreibung |
|------|--------------|
| `url_hash` | 12-Zeichen Hash der Domain |
| `items` | Map von translation_hash → [original_b64, translated_b64, langPair_b64] |

**Response:**
```json
{
  "url_hash": "a1b2c3d4e5f6",
  "created": 2,
  "total": 145
}
```

| Feld | Beschreibung |
|------|--------------|
| `created` | Neu erstellte Einträge |
| `total` | Gesamtanzahl für diese URL nach dem Speichern |

---

### POST /cache/bulk - Abrufen (Bulk-Get)

**Request:**
```json
{
  "url_hash": "a1b2c3d4e5f6",
  "hashes": ["f1e2d3c4b5a6...", "1a2b3c4d5e6f...", "nonexistent..."]
}
```

**Response:**
```json
{
  "url_hash": "a1b2c3d4e5f6",
  "found": 2,
  "translations": {
    "f1e2d3c4b5a6...": {
      "original": "T3JpZ2luYWwgVGV4dA==",
      "translated": "w5xiZXJzZXR6dW5n"
    },
    "1a2b3c4d5e6f...": {
      "original": "QW5vdGhlciB0ZXh0",
      "translated": "Tm9jaCBlaW4gVGV4dA=="
    }
  }
}
```

---

### GET /cache/url/{url_hash} - Stats für URL

**Request:**
```
GET /cache/url/a1b2c3d4e5f6
```

**Response:**
```json
{
  "url_hash": "a1b2c3d4e5f6",
  "count": 145,
  "size_bytes": 45678
}
```

---

### GET /cache/url/{url_hash}/all - Alle Übersetzungen abrufen

**Response:**
```json
{
  "url_hash": "a1b2c3d4e5f6",
  "count": 145,
  "translations": {
    "f1e2d3...": ["T3JpZ2luYWw=", "w5xiZXJzZXR6dW5n", "YXV0bzpkZQ=="],
    "1a2b3c...": ["QW5vdGhlcg==", "Tm9jaCBlaW5z", "YXV0bzpkZQ=="]
  }
}
```

**Server-Implementierung:**
```python
@app.get("/cache/url/{url_hash}/all")
async def get_all_translations(url_hash: str):
    url_dir = DATA_DIR / url_hash
    if not url_dir.exists():
        return {"url_hash": url_hash, "count": 0, "translations": {}}
    
    translations = {}
    for f in url_dir.glob("*.txt"):
        lines = f.read_text().strip().split("\n")
        if len(lines) >= 2:
            translations[f.stem] = {
                "original": lines[0],
                "translated": lines[1],
                "lang_pair": lines[2] if len(lines) > 2 else None
            }
    
    return {"url_hash": url_hash, "count": len(translations), "translations": translations}
```

---

### DELETE /cache/url/{url_hash}/{trans_hash} - Einzelnen Eintrag löschen

**Server-Implementierung:**
```python
@app.delete("/cache/url/{url_hash}/{trans_hash}")
async def delete_single(url_hash: str, trans_hash: str):
    file_path = DATA_DIR / url_hash / f"{trans_hash}.txt"
    if file_path.exists():
        file_path.unlink()
        return {"deleted": True, "hash": trans_hash}
    return {"deleted": False, "hash": trans_hash}
```

---

### DELETE /cache/url/{url_hash} - URL-Cache löschen

**Request:**
```
DELETE /cache/url/a1b2c3d4e5f6
```

**Response:**
```json
{
  "url_hash": "a1b2c3d4e5f6",
  "deleted": 145
}
```

---

### GET /cache/urls - Alle URLs auflisten

**Response:**
```json
{
  "urls": [
    {"url_hash": "a1b2c3d4e5f6", "count": 145},
    {"url_hash": "9f8e7d6c5b4a", "count": 89},
    {"url_hash": "1234567890ab", "count": 23}
  ],
  "total_urls": 3,
  "total_entries": 257
}
```

---

### GET /stats - Gesamtstatistik

**Response:**
```json
{
  "total_urls": 42,
  "total_entries": 12345,
  "db_size": 5678901,
  "hits_today": 234
}
```

---

## Server-Implementierung (Python/FastAPI)

```python
from fastapi import FastAPI, HTTPException
from pathlib import Path
import json
import base64

app = FastAPI()
DATA_DIR = Path("/data/cache")

# ============================================================
# POST /cache/bulk - Speichern
# ============================================================
@app.post("/cache/bulk")
async def bulk_store(data: dict):
    url_hash = data.get("url_hash", "")
    items = data.get("items", {})
    
    if not url_hash or len(url_hash) != 12:
        raise HTTPException(400, "url_hash muss 12 Zeichen haben")
    
    if not items:
        return {"url_hash": url_hash, "created": 0, "total": 0}
    
    # Ordner erstellen
    url_dir = DATA_DIR / url_hash
    url_dir.mkdir(parents=True, exist_ok=True)
    
    created = 0
    for trans_hash, values in items.items():
        if len(values) != 3:
            continue
        
        file_path = url_dir / f"{trans_hash}.txt"
        
        # Nur neu erstellen wenn nicht existiert
        if not file_path.exists():
            # 3 Zeilen: original, translated, langPair (alle Base64)
            content = "\n".join(values)
            file_path.write_text(content)
            created += 1
    
    total = len(list(url_dir.glob("*.txt")))
    return {"url_hash": url_hash, "created": created, "total": total}

# ============================================================
# POST /cache/get - Bulk-Abruf (POST weil Body mit Hashes)
# ============================================================
@app.post("/cache/get")
async def bulk_get(data: dict):
    url_hash = data.get("url_hash", "")
    hashes = data.get("hashes", [])
    
    if not url_hash:
        raise HTTPException(400, "url_hash erforderlich")
    
    url_dir = DATA_DIR / url_hash
    translations = {}
    
    for trans_hash in hashes:
        file_path = url_dir / f"{trans_hash}.txt"
        if file_path.exists():
            lines = file_path.read_text().strip().split("\n")
            if len(lines) >= 2:
                translations[trans_hash] = {
                    "original": lines[0],
                    "translated": lines[1]
                }
    
    return {
        "url_hash": url_hash,
        "found": len(translations),
        "translations": translations
    }

# ============================================================
# GET /cache/url/{url_hash} - Stats
# ============================================================
@app.get("/cache/url/{url_hash}")
async def url_stats(url_hash: str):
    url_dir = DATA_DIR / url_hash
    
    if not url_dir.exists():
        return {"url_hash": url_hash, "count": 0, "size_bytes": 0}
    
    files = list(url_dir.glob("*.txt"))
    size = sum(f.stat().st_size for f in files)
    
    return {
        "url_hash": url_hash,
        "count": len(files),
        "size_bytes": size
    }

# ============================================================
# DELETE /cache/url/{url_hash} - Löschen
# ============================================================
@app.delete("/cache/url/{url_hash}")
async def delete_url(url_hash: str):
    url_dir = DATA_DIR / url_hash
    
    if not url_dir.exists():
        return {"url_hash": url_hash, "deleted": 0}
    
    count = len(list(url_dir.glob("*.txt")))
    
    # Ordner komplett löschen
    import shutil
    shutil.rmtree(url_dir)
    
    return {"url_hash": url_hash, "deleted": count}

# ============================================================
# GET /cache/urls - Alle URLs
# ============================================================
@app.get("/cache/urls")
async def list_urls():
    urls = []
    total_entries = 0
    
    if DATA_DIR.exists():
        for url_dir in DATA_DIR.iterdir():
            if url_dir.is_dir() and len(url_dir.name) == 12:
                count = len(list(url_dir.glob("*.txt")))
                urls.append({"url_hash": url_dir.name, "count": count})
                total_entries += count
    
    urls.sort(key=lambda x: -x["count"])
    
    return {
        "urls": urls,
        "total_urls": len(urls),
        "total_entries": total_entries
    }

# ============================================================
# GET /stats - Gesamtstatistik
# ============================================================
@app.get("/stats")
async def stats():
    total_urls = 0
    total_entries = 0
    total_size = 0
    
    if DATA_DIR.exists():
        for url_dir in DATA_DIR.iterdir():
            if url_dir.is_dir():
                total_urls += 1
                for f in url_dir.glob("*.txt"):
                    total_entries += 1
                    total_size += f.stat().st_size
    
    return {
        "total_urls": total_urls,
        "total_entries": total_entries,
        "db_size": total_size,
        "hits_today": 0  # Optional: Tracking implementieren
    }

# ============================================================
# GET /health
# ============================================================
@app.get("/health")
async def health():
    return {"status": "ok", "data_dir": str(DATA_DIR)}
```

---

## Verzeichnisstruktur auf Server

```
/data/cache/
├── a1b2c3d4e5f6/           # svelte.dev
│   ├── f1e2d3c4b5a6....txt
│   ├── 1a2b3c4d5e6f....txt
│   └── ...
├── 9f8e7d6c5b4a/           # github.com  
│   ├── abcdef123456....txt
│   └── ...
└── 1234567890ab/           # docs.python.org
    └── ...
```

### Cache-Datei Format (3 Zeilen)
```
T3JpZ2luYWwgVGV4dA==       # Zeile 1: Original (Base64)
w5xiZXJzZXR6dW5n           # Zeile 2: Übersetzung (Base64)
YXV0bzpkZQ==               # Zeile 3: LangPair (Base64)
```

---

## Migration vom alten Format

Falls bereits Cache-Dateien mit 4 Zeilen (inkl. URL) existieren:

```python
def migrate_old_format():
    """Migriert alte 4-Zeilen-Dateien ins neue 2-Hash-System."""
    import hashlib
    
    OLD_DIR = Path("/data/old_cache")
    NEW_DIR = Path("/data/cache")
    
    for old_file in OLD_DIR.glob("*.txt"):
        lines = old_file.read_text().strip().split("\n")
        if len(lines) != 4:
            continue
        
        original, translated, lang_pair, url_b64 = lines
        
        try:
            # URL decodieren und url_hash berechnen
            url = base64.b64decode(url_b64).decode('utf-8')
            from urllib.parse import urlparse
            host = urlparse(url).hostname.lower()
            if host.startswith('www.'):
                host = host[4:]
            
            url_hash = hashlib.sha256(host.encode()).hexdigest()[:12]
            trans_hash = old_file.stem
            
            # Neuen Ordner erstellen
            url_dir = NEW_DIR / url_hash
            url_dir.mkdir(parents=True, exist_ok=True)
            
            # Neue Datei mit 3 Zeilen
            new_file = url_dir / f"{trans_hash}.txt"
            new_file.write_text(f"{original}\n{translated}\n{lang_pair}")
            
        except Exception as e:
            print(f"Fehler bei {old_file}: {e}")
```

---

## Frontend-Änderungen (v3.13.38+)

### Neue Architektur: Queue-basiertes Batching

Ab v3.13.35 verwendet der Smart Web Translator eine **Queue-basierte Architektur** für LM Studio:

```
Content Script                    Background Script
─────────────                    ─────────────────
translate(text1) ──┐
translate(text2) ──┼──► Queue sammelt ──► Batch (20 Texte) ──► LLM
translate(text3) ──┘         │
      ▲                      │
      └──── Promises ◄───────┘
```

**Vorteile:**
- Kein Matching-Problem mehr (jeder Text hat sein Promise)
- Batch-Effizienz bleibt erhalten
- Cache-Server Integration in der Queue-Schicht

### Queue-Struktur in background.js

```javascript
this.translationQueue = {
  pending: new Map(),      // bufferKey → { text, resolve, reject, pageUrl, langPair, ... }
  buffer: new Map(),       // bufferKey → translation (RAM-Cache)
  batchTimeout: null,
  batchDelay: 50,          // ms warten vor Batch
  maxBatchSize: 20         // Max Texte pro LLM-Call
};
```

### translateWithLMStudioQueue()

```javascript
async translateWithLMStudioQueue(text, source, target, pageUrl, settings) {
  const queue = this.translationQueue;
  const normalizedText = text.trim();
  const langPair = `${source || 'auto'}:${target || 'de'}`;
  const bufferKey = `${normalizedText}:${source}:${target}`;
  
  // 1. Buffer-Check (RAM)
  if (queue.buffer.has(bufferKey)) {
    return { success: true, translatedText: queue.buffer.get(bufferKey), fromBuffer: true };
  }
  
  // 2. Cache-Server-Check
  if (CacheServer.config.enabled && pageUrl) {
    const isEbook = pageUrl?.includes('#epubcfi');
    const hash = await CacheServer.computeHash(pageUrl, normalizedText, langPair, isEbook);
    const cached = await CacheServer.get(hash);
    if (cached?.translated) {
      queue.buffer.set(bufferKey, cached.translated);
      return { success: true, translatedText: cached.translated, fromCache: true };
    }
  }
  
  // 3. Schon in Queue? → Gleiches Promise zurückgeben
  if (queue.pending.has(bufferKey)) {
    return queue.pending.get(bufferKey).promise;
  }
  
  // 4. Neues Promise erstellen und zur Queue
  let resolvePromise, rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  
  queue.pending.set(bufferKey, {
    text: normalizedText,
    source, target, pageUrl, langPair, settings,
    resolve: resolvePromise,
    reject: rejectPromise,
    promise
  });
  
  // 5. Batch-Verarbeitung planen
  this.scheduleQueueProcessing();
  
  return promise;
}
```

### processTranslationQueue()

```javascript
async processTranslationQueue() {
  const queue = this.translationQueue;
  if (queue.pending.size === 0 || queue.isProcessing) return;
  
  queue.isProcessing = true;
  
  // Snapshot: Max 20 Texte
  const entries = Array.from(queue.pending.entries()).slice(0, 20);
  const texts = entries.map(([, e]) => e.text);
  const { source, target, langPair, settings } = entries[0][1];
  
  const toCache = []; // Für Cache-Server
  
  try {
    // Batch-Übersetzung
    const result = await this.batchTranslateWithLMStudio(texts, source, target, settings);
    
    if (result.success && result.items) {
      const resultMap = new Map(result.items.map(i => [i.original.trim(), i.translation]));
      
      for (const [bufferKey, entry] of entries) {
        let translation = resultMap.get(entry.text);
        
        if (translation) {
          queue.buffer.set(bufferKey, translation);
          
          // Für Cache-Server sammeln
          if (entry.text !== translation && entry.pageUrl) {
            toCache.push({
              pageUrl: entry.pageUrl,
              original: entry.text,
              translated: translation,
              langPair: entry.langPair
            });
          }
          
          entry.resolve({ success: true, translatedText: translation });
        } else {
          // Fallback: Einzelübersetzung
          const single = await this.translateWithLMStudio(entry.text, source, target, settings);
          entry.resolve(single);
        }
        
        queue.pending.delete(bufferKey);
      }
    }
    
    // Cache-Server Bulk-Store (async)
    if (toCache.length > 0 && CacheServer.config.enabled) {
      CacheServer.bulkStore(toCache).catch(console.warn);
    }
    
  } finally {
    queue.isProcessing = false;
    if (queue.pending.size > 0) {
      this.scheduleQueueProcessing();
    }
  }
}
```

### CacheServer in background.js (Auszug)

```javascript
const CacheServer = {
  // URL-Hash berechnen (12 Zeichen)
  async computeUrlHash(pageUrl) {
    const url = new URL(pageUrl);
    let host = url.hostname.toLowerCase();
    if (host.startsWith('www.')) host = host.slice(4);
    const hash = await this.sha256(host);
    return hash.substring(0, 12);
  },
  
  // Translation-Hash (64 Zeichen)
  async computeHash(pageUrl, text, langPair, isEbook = false) {
    const url = new URL(pageUrl);
    let normalizedUrl;
    
    // E-Book: Nur Kapitel-Teil verwenden
    if (isEbook && url.hash?.includes('epubcfi')) {
      const match = url.hash.match(/epubcfi\(([^!]+)!/);
      normalizedUrl = url.origin + url.pathname + 
        (match ? '#epubcfi(' + match[1] + ')' : url.hash);
    } else {
      normalizedUrl = url.origin + url.pathname;
    }
    
    const content = normalizedUrl + text.trim() + (langPair ? ':' + langPair : '');
    return await this.sha256(content);
  },
  
  // Bulk-Store
  async bulkStore(translations) {
    const byUrl = new Map();
    
    for (const t of translations) {
      if (t.original === t.translated) continue;
      
      const urlHash = await this.computeUrlHash(t.pageUrl);
      if (!byUrl.has(urlHash)) {
        byUrl.set(urlHash, { items: {} });
      }
      
      const isEbook = t.pageUrl?.includes('#epubcfi');
      const transHash = await this.computeHash(t.pageUrl, t.original, t.langPair, isEbook);
      
      byUrl.get(urlHash).items[transHash] = [
        this.encodeText(t.original),
        this.encodeText(t.translated)
      ];
    }
    
    for (const [urlHash, { items }] of byUrl) {
      await fetch(`${this.serverUrl}/cache/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url_hash: urlHash, items })
      });
    }
  },
  
  // Bulk-Get
  async bulkGet(hashes, pageUrl) {
    const urlHash = await this.computeUrlHash(pageUrl);
    
    const response = await fetch(`${this.serverUrl}/cache/get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url_hash: urlHash, hashes })
    });
    
    return await response.json();
  }
};
```

---

## API-Endpunkte Zusammenfassung

| Methode | Endpunkt | Beschreibung |
|---------|----------|--------------|
| POST | `/cache/bulk` | Übersetzungen speichern |
| POST | `/cache/get` | Übersetzungen abrufen (Bulk) |
| GET | `/cache/url/{url_hash}` | Stats für eine URL |
| DELETE | `/cache/url/{url_hash}` | Cache für URL löschen |
| GET | `/cache/urls` | Alle URLs auflisten |
| GET | `/stats` | Gesamtstatistik |
| GET | `/health` | Health-Check |
