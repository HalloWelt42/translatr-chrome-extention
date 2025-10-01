# SWT Cache Server - Implementierung

## Konzept

```
Extension berechnet:
├── url_hash = SHA256(hostname)[:12]           → Ordnername
└── trans_hash = SHA256(url + text + langPair) → Dateiname (langPair ist IM Hash)
```

## Verzeichnisstruktur

```
/data/cache/
└── a1b2c3d4e5f6/            # url_hash (12 Zeichen)
    ├── f1e2d3c4b5a6...txt   # trans_hash (64 Zeichen)
    └── 1a2b3c4d5e6f...txt
```

## Dateiformat (2 Zeilen, Base64)

```
T3JpZ2luYWwgVGV4dA==      # Original
w5xiZXJzZXR6dW5n          # Übersetzung
```

---

## MUST-Endpunkte

| # | Methode | Endpunkt | Beschreibung |
|---|---------|----------|--------------|
| 1 | POST | `/cache/bulk` | Übersetzungen speichern |
| 2 | POST | `/cache/get` | Übersetzungen abrufen |
| 3 | GET | `/cache/url/{url_hash}/all` | Alle Einträge einer URL |
| 4 | DELETE | `/cache/url/{url_hash}` | Alle Einträge einer URL löschen |
| 5 | DELETE | `/cache/url/{url_hash}/{trans_hash}` | Einzelnen Eintrag löschen |
| 6 | GET | `/stats` | Gesamtstatistik |
| 7 | GET | `/health` | Health-Check |

---

### 1. POST /cache/bulk — Speichern

```json
// Request
{
  "url_hash": "a1b2c3d4e5f6",
  "items": {
    "f1e2d3c4b5a6...": ["T3JpZ2luYWw=", "w5xiZXJzZXR6dW5n"],
    "1a2b3c4d5e6f...": ["QW5vdGhlcg==", "Tm9jaCBlaW5z"]
  }
}

// Response
{"url_hash": "a1b2c3d4e5f6", "created": 2, "total": 145}
```

### 2. POST /cache/get — Abrufen

```json
// Request
{
  "url_hash": "a1b2c3d4e5f6",
  "hashes": ["f1e2d3c4b5a6...", "1a2b3c4d5e6f..."]
}

// Response
{
  "url_hash": "a1b2c3d4e5f6",
  "found": 2,
  "translations": {
    "f1e2d3c4b5a6...": {"original": "T3JpZ2luYWw=", "translated": "w5xiZXJzZXR6dW5n"},
    "1a2b3c4d5e6f...": {"original": "QW5vdGhlcg==", "translated": "Tm9jaCBlaW5z"}
  }
}
```

### 3. GET /cache/url/{url_hash}/all — Alle einer URL

```json
// Response
{
  "url_hash": "a1b2c3d4e5f6",
  "count": 145,
  "translations": {
    "f1e2d3c4b5a6...": {"original": "T3JpZ2luYWw=", "translated": "w5xiZXJzZXR6dW5n"},
    ...
  }
}
```

### 4. DELETE /cache/url/{url_hash} — URL löschen

```json
// Response
{"url_hash": "a1b2c3d4e5f6", "deleted": 145}
```

### 5. DELETE /cache/url/{url_hash}/{trans_hash} — Einzeln löschen

```json
// Response
{"deleted": true, "hash": "f1e2d3c4b5a6..."}
```

### 6. GET /stats — Statistik

```json
// Response
{"total_urls": 42, "total_entries": 12345, "db_size": 5678901}
```

### 7. GET /health — Health-Check

```json
// Response
{"status": "ok"}
```

---

## FastAPI Server

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path
import shutil

app = FastAPI()
DATA_DIR = Path("/data/cache")
DATA_DIR.mkdir(parents=True, exist_ok=True)

app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# 1. POST /cache/bulk
@app.post("/cache/bulk")
async def bulk_store(data: dict):
    url_hash = data.get("url_hash", "")
    items = data.get("items", {})
    if not url_hash or len(url_hash) != 12:
        return {"error": "url_hash muss 12 Zeichen haben"}
    
    url_dir = DATA_DIR / url_hash
    url_dir.mkdir(exist_ok=True)
    created = 0
    
    for trans_hash, values in items.items():
        if len(values) == 2:
            (url_dir / f"{trans_hash}.txt").write_text(f"{values[0]}\n{values[1]}")
            created += 1
    
    return {"url_hash": url_hash, "created": created, "total": len(list(url_dir.glob("*.txt")))}

# 2. POST /cache/get
@app.post("/cache/get")
async def bulk_get(data: dict):
    url_hash = data.get("url_hash", "")
    hashes = data.get("hashes", [])
    url_dir = DATA_DIR / url_hash
    translations = {}
    
    for h in hashes:
        f = url_dir / f"{h}.txt"
        if f.exists():
            lines = f.read_text().strip().split("\n")
            if len(lines) >= 2:
                translations[h] = {"original": lines[0], "translated": lines[1]}
    
    return {"url_hash": url_hash, "found": len(translations), "translations": translations}

# 3. GET /cache/url/{url_hash}/all
@app.get("/cache/url/{url_hash}/all")
async def get_all(url_hash: str):
    url_dir = DATA_DIR / url_hash
    if not url_dir.exists():
        return {"url_hash": url_hash, "count": 0, "translations": {}}
    
    translations = {}
    for f in url_dir.glob("*.txt"):
        lines = f.read_text().strip().split("\n")
        if len(lines) >= 2:
            translations[f.stem] = {"original": lines[0], "translated": lines[1]}
    
    return {"url_hash": url_hash, "count": len(translations), "translations": translations}

# 4. DELETE /cache/url/{url_hash}
@app.delete("/cache/url/{url_hash}")
async def delete_url(url_hash: str):
    url_dir = DATA_DIR / url_hash
    if not url_dir.exists():
        return {"url_hash": url_hash, "deleted": 0}
    count = len(list(url_dir.glob("*.txt")))
    shutil.rmtree(url_dir)
    return {"url_hash": url_hash, "deleted": count}

# 5. DELETE /cache/url/{url_hash}/{trans_hash}
@app.delete("/cache/url/{url_hash}/{trans_hash}")
async def delete_one(url_hash: str, trans_hash: str):
    f = DATA_DIR / url_hash / f"{trans_hash}.txt"
    deleted = f.exists()
    if deleted:
        f.unlink()
    return {"deleted": deleted, "hash": trans_hash}

# 6. GET /stats
@app.get("/stats")
async def stats():
    total_urls = total_entries = total_size = 0
    for d in DATA_DIR.iterdir():
        if d.is_dir():
            total_urls += 1
            for f in d.glob("*.txt"):
                total_entries += 1
                total_size += f.stat().st_size
    return {"total_urls": total_urls, "total_entries": total_entries, "db_size": total_size}

# 7. GET /health
@app.get("/health")
async def health():
    return {"status": "ok"}
```

---

## Start

```bash
pip install fastapi uvicorn
uvicorn server:app --host 0.0.0.0 --port 8083
```

## Docker

```dockerfile
FROM python:3.11-slim
WORKDIR /app
RUN pip install fastapi uvicorn
COPY server.py .
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8083"]
```

```bash
docker build -t swt-cache .
docker run -d -p 8083:8083 -v /data/swt-cache:/data/cache swt-cache
```
