# Smart Web Translator

Browser-Erweiterung (Manifest V3) für Übersetzungen über die eigene Leitstelle; ohne eigene Leitstelle alternativ mit LM Studio direkt oder LibreTranslate.

![Bildschirmfoto 2026-04-04 um 03.49.26.png](media/Bildschirmfoto%202026-04-04%20um%2003.49.26.png)


## Ergenisse Beispiel mit svelte-Doku

### Original

![Bildschirmfoto 2026-04-04 um 05.12.12.png](media/Bildschirmfoto%202026-04-04%20um%2005.12.12.png)

### mit LM Studio und Qwen3.5 80b

![Bildschirmfoto 2026-04-04 um 05.11.49.png](media/Bildschirmfoto%202026-04-04%20um%2005.11.49.png)

## Voraussetzungen

Vorgabe ist die eigene **Leitstelle**: sie vermittelt die Übersetzung an das passende Sprachmodell im Heimnetz (Fassade im OpenAI-Format, Schlüssel der Anwendung als Bearer). In der Erweiterung werden nur Adresse und Schlüssel eingetragen; der Schlüssel bleibt im lokalen Speicher des Browsers.

Ohne eigene Leitstelle wird eines der folgenden Übersetzungs-Backends benötigt (nicht enthalten):

- **[LibreTranslate](https://github.com/LibreTranslate/LibreTranslate)** -- Open-Source Übersetzungsserver, selbst gehostet oder öffentliche Instanz ([Installationsanleitung für Raspberry Pi](https://github.com/HalloWelt42/raspberry_pi_projects/tree/main/libretranslate_projekt))
- **[LM Studio](https://lmstudio.ai/)** -- Lokales LLM mit OpenAI-kompatibler API (für Fachübersetzungen mit Kfz, IT, Medizin, Recht)

Optional:

- **SWT Cache Server** -- Eigener Cache-Server für persistente Übersetzungsspeicherung. Übersetzungen werden serverseitig als Hash-basierte Textdateien abgelegt und stehen so geräte- und browserübergreifend zur Verfügung. Ohne Cache Server werden Übersetzungen nur lokal im Browser gespeichert. Siehe `docs/CACHE_STORE_API.md` für die Server-Spezifikation.

## Features

- **Auswahl-Übersetzung** -- Text markieren, Icon klicken, sofort übersetzen
- **Seiten-Übersetzung** -- Ganze Seite batch-weise übersetzen mit Fortschrittsanzeige
- **Side Panel** -- Erweiterte Funktionen, Cache-Verwaltung, Pipeline-Anzeige
- **Übersetzungs-Cache** -- Browsercache (LocalStorage), Server (SWT Cache Server) oder beides
- **Fachkontexte** -- Spezialisierte System-Prompts für Kfz, IT, Medizin, Recht (nur LM Studio)
- **Text-to-Speech** -- Vorlesefunktion über Browser-Sprachsynthese
- **Hover-Original** -- Originaltext beim Überfahren übersetzter Elemente anzeigen
- **Markdown-Export** -- Übersetzte Seiten als Markdown exportieren
- **Domain-Strategien** -- Angepasste Filter für Wikipedia, GitHub, StackOverflow u.a.

## Installation

1. `chrome://extensions` öffnen
2. "Entwicklermodus" aktivieren
3. "Entpackte Erweiterung laden"
4. Diesen Ordner auswählen

## Einstellungen

### Übersetzungs-Backend

Leitstelle, LibreTranslate und LM Studio werden als Accordion-Panels konfiguriert. Das aktive Backend ist aufgeklappt, die anderen eingeklappt. Klick auf den Header wechselt.

- **Leitstelle** (Vorgabe): Adresse und Schlüssel eintragen, "Verbindung prüfen"; Modell leer lassen, dann wählt die Leitstelle über ihre Kette. Ist sie ausgelastet oder schläft der Rechner mit dem Modell, wartet die Erweiterung und zeigt den Grund an.
- **LibreTranslate**: Server-URL eingeben, optional API-Key
- **LM Studio**: Server-URL eingeben, Modell auswählen
- Temperatur, Max Tokens und Sprachliste gelten für beide Sprachmodell-Wege (Leitstelle und LM Studio)

### Übersetzungs-Cache

| Modus | Beschreibung |
|-------|-------------|
| Nur Browsercache | Nur im Browser (LocalStorage) |
| Nur Server | Nur auf dem Cache-Server |
| Server + Browser | Beides, Server wird zuerst abgefragt |

## Projektstruktur

```
manifest.json
service-worker.js                 # Service Worker (Background)
content/
  translator.js                   # Haupt-Content-Script (SmartTranslator)
  translator-ui.js                # UI-Elemente (Tooltip, Icon, Progress)
  translator-cache.js             # Cache-Check, Cache-Laden
  translator-dom.js               # DOM-Manipulation, Text-Node-Suche
  translator-export.js            # Markdown-Export
  domain-strategies.js            # Domain-spezifische Filter
  translator.css                  # Content-Styles
shared/
  providers.js                    # Übersetzungswege (Vorgabe, Sprachmodell-Wege, Wartestand)
  storage.js                      # Vorgaben der Einstellungen
  cache-server.js                 # Cache Server API Client
  cache-local.js                  # LocalStorage Cache-Backend
  cache-manager.js                # Cache-Orchestrierung (lokal + Server)
  icons.js                        # SVG Icon-Bibliothek (SWT.Icons)
  toast.js                        # Toast-Benachrichtigungen
  utils.js                        # Hilfsfunktionen
  api-badge.js                    # API-Badge Komponente
background/
  providers/
    chat-provider.js              # Gemeinsamer Kern der Chat-Anbieter (Prompts, Antwortschema)
    leitstelle.js                 # Leitstelle (Vorgabe, Warten bei 429/503)
    lm-studio.js                  # LM Studio direkt
    libre-translate.js            # LibreTranslate
popup/
  popup.html/js/css               # Browser-Action Popup
pages/
  sidepanel.html/js/css           # Side Panel
  options.html/js/css             # Einstellungen
  guide.html/css                  # Anleitung
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

**Nicht-kommerzielle Nutzung** -- Siehe [LICENSE](LICENSE) · [Datenschutz](PRIVACY.md) · [Nutzungsbedingungen](TERMS.md)

Erlaubt: Private Nutzung, Installation, persönliche Anpassungen, Teilen mit Quellenangabe

Verboten: Kommerzielle Nutzung, Verkauf, Einbindung in kommerzielle Produkte

---

![Bildschirmfoto 2026-04-04 um 03.48.40.png](media/Bildschirmfoto%202026-04-04%20um%2003.48.40.png)

![Bildschirmfoto 2026-04-04 um 03.48.55.png](media/Bildschirmfoto%202026-04-04%20um%2003.48.55.png)

---

## Unterstützen

Smart Translator ist ein privates Open-Source-Projekt. Kein Tracking, keine Werbung, keine Kompromisse.

Wenn dir das Projekt gefällt, kannst du über die Danke-Seite in der Extension "Danke sagen" -- oder direkt hier:

[![Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/HalloWelt42)

**Crypto:**

| Coin | Adresse |
|------|---------|
| BTC | `bc1qnd599khdkv3v3npmj9ufxzf6h4fzanny2acwqr` |
| DOGE | `DL7tuiYCqm3xQjMDXChdxeQxqUGMACn1ZV` |
| ETH | `0x8A28fc47bFFFA03C8f685fa0836E2dBe1CA14F27` |

Copyright (c) 2025-2026 HalloWelt42
