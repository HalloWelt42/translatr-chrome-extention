# SWT Cache Store API

Spezifikation für kompatible Cache-Server Implementierungen.
Jeder Server der diese API implementiert kann als Cache-Backend genutzt werden.

## Architektur: Zwei-Hash-System

```
/data/
  {url_hash}/                    # 12 Zeichen, SHA256 des Hostnamens
    {translation_hash}.txt       # 64 Zeichen, SHA256 von URL+Text+Sprachpaar
    {translation_hash}.txt
    ...
```

- **url_hash** (12 Zeichen): SHA256 des normalisierten Hostnamens (`www.` entfernt, lowercase)
- **translation_hash** (64 Zeichen): SHA256 von `normalizedUrl + text + langPair`

### Hash-Berechnung

**url_hash:**
```
Input:  hostname.toLowerCase().replace(/^www\./, '')
Output: SHA256(input).substring(0, 12)
```

**translation_hash:**
```
Input:  origin + pathname + text + ':' + langPair
        z.B. "https://example.com/pageHello Worlden:de"
Output: SHA256(input)  (64 Zeichen hex)
```

### Dateiformat (2 Zeilen, Base64)

```
T3JpZ2luYWwgVGV4dA==           # Zeile 1: Original (Base64)
w5xiZXJzZXR6dW5n               # Zeile 2: Übersetzung (Base64)
```

---

## API Endpunkte

### POST /cache/bulk -- Übersetzungen speichern

**Request:**
```json
{
  "hash1": ["originalBase64", "translatedBase64"],
  "hash2": ["originalBase64", "translatedBase64"]
}
```

**Response (200):**
```json
{
  "url_hash": "a1b2c3d4e5f6",
  "created": 2,
  "total": 145
}
```

### POST /cache/get -- Übersetzungen abrufen (Bulk)

**Request:**
```json
{
  "url_hash": "a1b2c3d4e5f6",
  "hashes": ["hash1", "hash2", "hash3"]
}
```

**Response (200):**
```json
{
  "url_hash": "a1b2c3d4e5f6",
  "found": 2,
  "translations": {
    "hash1": {
      "original": "T3JpZ2luYWw=",
      "translated": "w5xiZXJzZXR6dW5n"
    },
    "hash2": {
      "original": "QW5vdGhlcg==",
      "translated": "Tm9jaCBlaW5z"
    }
  }
}
```

### GET /cache/{hash} -- Einzelne Übersetzung abrufen

**Response (200):** Plain Text, 2 Zeilen Base64
```
T3JpZ2luYWw=
w5xiZXJzZXR6dW5n
```

**Response (404):** Nicht gefunden

### POST /cache/{hash} -- Einzelne Übersetzung speichern

**Request Body:** Plain Text, 2 Zeilen Base64
```
T3JpZ2luYWw=
w5xiZXJzZXR6dW5n
```

**Response (200/201):**
```json
{
  "hash": "f1e2d3...",
  "created": true
}
```

### GET /cache/url/{url_hash}/all -- Alle Einträge einer Domain

**Response (200):**
```json
{
  "url_hash": "a1b2c3d4e5f6",
  "translations": {
    "hash1": { "original": "...", "translated": "..." },
    "hash2": { "original": "...", "translated": "..." }
  }
}
```

### DELETE /cache/url/{url_hash} -- Domain-Cache löschen

**Response (200):**
```json
{
  "url_hash": "a1b2c3d4e5f6",
  "deleted": 145
}
```

### DELETE /cache/url/{url_hash}/{translation_hash} -- Einzelnen Eintrag löschen

**Response (200):**
```json
{
  "deleted": true
}
```

### GET /stats -- Server-Statistiken

**Response (200):**
```json
{
  "total_urls": 42,
  "total_entries": 12345,
  "db_size": 5678901
}
```

### GET /health -- Health-Check

**Response (200):**
```json
{
  "status": "ok",
  "version": "1.0.0"
}
```

---

## Eigene Implementierung

### Mindestanforderungen

Ein kompatibler Server muss mindestens implementieren:

1. `POST /cache/bulk` -- Bulk-Speichern
2. `POST /cache/get` -- Bulk-Abrufen
3. `GET /health` -- Health-Check
4. `GET /stats` -- Statistiken

### Optionale Endpunkte

- `GET /cache/{hash}` -- Einzel-Abrufen
- `POST /cache/{hash}` -- Einzel-Speichern
- `DELETE /cache/url/{url_hash}` -- Domain löschen
- `GET /cache/url/{url_hash}/all` -- Domain auflisten

### Base64-Kodierung

```javascript
// Kodieren
function encode(text) {
  return btoa(unescape(encodeURIComponent(text)));
}

// Dekodieren
function decode(base64) {
  return decodeURIComponent(escape(atob(base64)));
}
```

### Referenz-Implementierung

Python/FastAPI Server: siehe `docs/SERVER_IMPLEMENTATION.md`
