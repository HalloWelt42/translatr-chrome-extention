# Smart Web Translator

Chrome Extension (Manifest V3) für intelligente Übersetzungen mit LibreTranslate und LM Studio.

## Features

- **LibreTranslate** -- Open-Source Übersetzungsserver, selbst gehostet oder öffentliche Instanz
- **LM Studio** -- Lokales LLM mit Fachkontexten (Kfz/Automotive, Technik/IT, Medizin, Recht)
- **Auswahl-Übersetzung** -- Text markieren, Icon klicken, sofort übersetzen
- **Seiten-Übersetzung** -- Ganze Seite batch-weise übersetzen mit Fortschrittsanzeige
- **Side Panel** -- Erweiterte Funktionen, Statistiken, Cache-Verwaltung, Pipeline-Ansicht
- **Übersetzungs-Cache** -- Lokal (LocalStorage), Server (SWT Cache Server) oder beides
- **Fachkontexte** -- Spezialisierte System-Prompts für Kfz, IT, Medizin, Recht (nur LM Studio)
- **Text-to-Speech** -- Vorlesefunktion über Browser-Sprachsynthese
- **Hover-Original** -- Originaltext beim Überfahren übersetzter Elemente anzeigen
- **Domain-Strategien** -- Angepasste Filter für Wikipedia, GitHub, StackOverflow u.a.

## Installation

1. `chrome://extensions` öffnen
2. "Entwicklermodus" aktivieren
3. "Entpackte Erweiterung laden"
4. Diesen Ordner auswählen

## Einstellungen

### Übersetzungs-Backend

LibreTranslate und LM Studio werden als Accordion-Panels konfiguriert. Das aktive Backend ist aufgeklappt, das inaktive eingeklappt. Klick auf den Header wechselt.

- **LibreTranslate**: Server-URL eingeben (z.B. `https://translate.max`), optional API-Key
- **LM Studio**: Server-URL (z.B. `http://192.168.178.45:1234`), Modell auswählen, Temperatur und Max Tokens einstellen. Empfohlen: Qwen 3 Instruct-Modelle ab 12B+

### Übersetzungs-Cache

Vier Modi verfügbar:

| Modus | Beschreibung |
|-------|-------------|
| `local-only` | Nur im Browser (LocalStorage) |
| `server-only` | Nur auf dem Cache-Server |
| `local-first` | Erst lokal, Server als Fallback |
| `server-first` | Erst Server, lokal als Fallback |

### Tastenkürzel

- `Ctrl+Shift+T` -- Auswahl übersetzen
- `Ctrl+Shift+P` -- Seite übersetzen
- `Ctrl+Shift+S` -- Side Panel öffnen

## Projektstruktur

```
manifest.json
service-worker.js                 # Service Worker (Background)
content/
  translator.js                   # Haupt-Content-Script (SmartTranslator)
  translator-ui.js                # UI-Elemente (Tooltip, Icon, Progress)
  translator-cache.js             # Cache-Check, Cache-Laden
  translator-dom.js               # DOM-Manipulation, Text-Node-Suche
  translator-export.js            # PDF/HTML Export
  domain-strategies.js            # Domain-spezifische Filter
  translator.css                  # Content-Styles
shared/
  storage.js                      # Storage-Abstraction (sync + local)
  cache-server.js                 # Cache Server API Client
  cache-local.js                  # LocalStorage Cache-Backend
  cache-manager.js                # Cache-Orchestrierung (lokal + Server)
  icons.js                        # SVG Icon-Bibliothek (SWT.Icons)
  toast.js                        # Toast-Benachrichtigungen
  utils.js                        # Hilfsfunktionen
  api-badge.js                    # API-Badge Komponente
background/
  providers/
    libre-translate.js            # LibreTranslate Provider
    lm-studio.js                  # LM Studio Provider
popup/
  popup.html/js/css               # Browser-Action Popup
pages/
  sidepanel.html/js/css           # Side Panel
  options.html/js/css             # Einstellungen
  guide.html                      # Anleitung
  donate.html                     # Spendenseite
  page-common.css                 # Gemeinsame Styles
```

## Cache Server API

Der SWT Cache Server nutzt ein Zwei-Hash-System:

- **url_hash** (12 Zeichen): `SHA256(hostname ohne www)[:12]`
- **trans_hash** (64 Zeichen): `SHA256(origin + pathname + text + ":" + langPair)`

Dateien werden als Base64-kodierte Textdateien gespeichert (2 Zeilen: Original + Übersetzung).

Vollständige API-Dokumentation: `docs/CACHE_STORE_API.md`

## Domain-Strategien

| Strategie | Domains | Besonderheiten |
|-----------|---------|----------------|
| Wikipedia | *.wikipedia.org | Infoboxen, Referenzen ausschließen |
| GitHub | *.github.com | Markdown-Content |
| StackOverflow | *.stackoverflow.com | Code-Blöcke ausschließen |
| News | cnn.com, bbc.com, ... | Artikel-Content |

## Lizenz

MIT License
