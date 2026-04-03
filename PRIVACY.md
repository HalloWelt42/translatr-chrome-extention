# Datenschutzerklärung / Privacy Policy

## Deutsch

### Welche Daten werden gespeichert?
- **Einstellungen** (API-URLs, Sprachen, UI-Präferenzen) -- lokal im Browser via `chrome.storage.sync`
- **Übersetzungsverlauf** (letzte 100 Einträge) -- lokal via `chrome.storage.local`
- **Token-Statistiken** (Anzahl Anfragen, Token-Verbrauch) -- lokal via `chrome.storage.local`
- **Übersetzungs-Cache** -- je nach Modus:
  - Nur Browsercache: nur im Browser (LocalStorage)
  - Nur Server: nur auf dem selbst gehosteten Cache-Server
  - Browsercache + Server: in beiden Speichern

### Welche externen Requests werden gemacht?
- **LibreTranslate-Server**: Texte werden zur Übersetzung an den vom Nutzer konfigurierten Server gesendet
- **LM Studio**: Texte werden an den vom Nutzer konfigurierten lokalen LLM-Server gesendet
- **Cache-Server**: SHA-256-Hashes und Base64-kodierte Texte werden auf dem vom Nutzer konfigurierten Server gespeichert/abgerufen

Alle Server-URLs werden vom Nutzer selbst konfiguriert. Es werden KEINE Daten an Drittanbieter oder externe Dienste gesendet.

### Tracking und Analytics
- Kein Tracking
- Keine Analytics
- Keine Werbung
- Keine Telemetrie

### Datenexport und -löschung
- Cache kann über das Side Panel (Cache-Tab) verwaltet und gelöscht werden
- Einstellungen können über die Optionsseite zurückgesetzt werden
- Bei Deinstallation werden alle lokalen Daten automatisch entfernt

---

## English

### What data is stored?
- **Settings** (API URLs, languages, UI preferences) -- locally in browser via `chrome.storage.sync`
- **Translation history** (last 100 entries) -- locally via `chrome.storage.local`
- **Token statistics** (request count, token usage) -- locally via `chrome.storage.local`
- **Translation cache** -- depending on mode:
  - Browser cache only: browser only (LocalStorage)
  - Server only: self-hosted cache server only
  - Browser cache + Server: both storage backends

### What external requests are made?
- **LibreTranslate server**: Texts are sent for translation to the user-configured server
- **LM Studio**: Texts are sent to the user-configured local LLM server
- **Cache server**: SHA-256 hashes and Base64-encoded texts are stored/retrieved from the user-configured server

All server URLs are configured by the user. NO data is sent to third parties or external services.

### Tracking and Analytics
- No tracking
- No analytics
- No advertising
- No telemetry

### Data export and deletion
- Cache can be managed and deleted via the Side Panel (Cache tab)
- Settings can be reset via the options page
- All local data is automatically removed on uninstall
