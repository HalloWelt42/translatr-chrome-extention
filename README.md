# Smart Web Translator v3.13.0

Chrome Extension für intelligente Übersetzungen mit LibreTranslate, LM Studio und SWT Cache Server.

## Features

### Übersetzungs-Backends
- **LibreTranslate** - Open-Source, selbst-gehostet
- **LM Studio** - Lokales LLM mit Fachkontexten (Kfz, IT, Medizin, Recht)

### Cache Server Integration (v3.8)
- Zentraler Übersetzungs-Cache (SWT Cache Server)
- SHA-256 Hash-basierte Deduplizierung
- Bulk-Operationen für Seitenübersetzung
- Fallback-Modi: server-first, local-first, server-only, local-only

### E-Book Reader Support (NEU in v3.13)
- Spezielle Behandlung für E-Book-Reader wie `books.mac`
- **epubcfi-Fragment als Cache-Key** - Jede Buchseite wird individuell gecacht
- **iframe-Content-Extraktion** - Texte aus `srcdoc` iframes werden erkannt
- Konfigurierbare E-Book-Reader-Domains in den Einstellungen
- Intelligente Hash-Änderungs-Erkennung (nur strukturelle Änderungen triggern Reload)

### Funktionen
- Auswahl-Übersetzung mit Icon
- Seiten-Übersetzung (Batch)
- Side Panel für erweiterte Funktionen
- Verlauf & Statistiken
- PDF Export
- Text-to-Speech

## Installation

1. `chrome://extensions` öffnen
2. "Entwicklermodus" aktivieren
3. "Entpackte Erweiterung laden"
4. Diesen Ordner auswählen

## Einstellungen

### E-Book Reader (NEU)
1. Einstellungen → E-Book Reader
2. Domains hinzufügen (z.B. `books.mac`, `reader.local`)
3. "iframe-Content extrahieren" aktiviert lassen für EPUB.js-Reader

Der URL-Hash (`#epubcfi(...)`) wird automatisch für die Cache-Identifikation verwendet.

### Cache Server
1. Server aktivieren (Toggle)
2. Server URL eingeben: `http://192.168.178.49:8083`
3. Cache-Modus wählen:
   - **Server → Lokal**: Erst Server prüfen, dann LocalStorage
   - **Lokal → Server**: Erst LocalStorage, dann Server
   - **Nur Server**: Kein lokaler Cache
   - **Nur Lokal**: Komplett offline

### Tastenkürzel
- `Ctrl+Shift+T` - Auswahl übersetzen
- `Ctrl+Shift+P` - Seite übersetzen
- `Ctrl+Shift+S` - Side Panel öffnen

## Architektur

```
├── manifest.json
├── background.js          # Service Worker + Cache-Integration
├── content.js             # Content Script
├── domain-strategies.js   # Domain-spezifische Strategien (Wikipedia, E-Book, etc.)
├── content/
│   ├── content-ui.js      # UI-Komponenten
│   ├── content-cache.js   # LocalStorage Cache
│   ├── content-dom.js     # DOM-Manipulation + iframe-Extraktion
│   └── content-export.js  # PDF Export
├── shared/
│   ├── cache-server.js    # Cache Server API Client
│   ├── cache-api.js       # Abstrakte Cache-API
│   ├── toast.js           # Benachrichtigungen
│   ├── api-badge.js       # API-Badge
│   └── utils.js           # Hilfsfunktionen
├── media/
│   └── icons.js           # SVG Icons (SMT.Icons)
├── sidepanel.html/js
├── popup.html/js
└── options.html/js
```

## Domain-Strategien

Die Extension unterstützt domainspezifische Anpassungen:

| Strategie | Domains | Besonderheiten |
|-----------|---------|----------------|
| Wikipedia | *.wikipedia.org | Infoboxen, Referenzen ausschließen |
| GitHub | *.github.com | Markdown-Content |
| StackOverflow | *.stackoverflow.com | Code-Blöcke ausschließen |
| E-Book | books.mac (konfigurierbar) | epubcfi-Hashes, iframe-Content |
| News | cnn.com, bbc.com, ... | Artikel-Content |

## Cache Server API

```javascript
// Einzelne Übersetzung
const hash = await SMT.CacheServer.computeHash(text, 'en', 'de');
const cached = await SMT.CacheServer.get(hash);
await SMT.CacheServer.store(original, translated, 'en', 'de');

// Bulk-Operationen
const result = await SMT.CacheServer.bulkGet(hashes);
await SMT.CacheServer.bulkStore(translations);
```

## Changelog

### v3.13.0
- **E-Book Reader Support**
  - Neue Domain-Strategie für E-Book-Reader
  - epubcfi-Fragment als Cache-Key für Buchseiten
  - iframe srcdoc Content-Extraktion
  - Konfigurierbare E-Book-Reader-Domains
  - Intelligente Hash-Änderungs-Erkennung

### v3.12.0
- Abstrakte Cache-API (SMT.Cache)
- Konsistente Cache-Keys basierend auf Original-Text

### v3.8.0
- Cache Server Integration
- Bulk-Cache-Operationen für Seitenübersetzung
- SHA-256 Hash-Berechnung (identisch zum Server)
- Fallback-Modi konfigurierbar

### v3.7.0
- SVG Icon System (SMT.Icons)
- Modulares CSS-System
- Code-Cleanup

### v3.6.0
- Batch-Übersetzung mit Smart Chunking
- Token-Statistiken
- Kostenberechnung (experimentell)

## Lizenz

MIT License
