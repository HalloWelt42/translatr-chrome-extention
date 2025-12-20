# Datenschutzerklärung / Privacy Policy

## Deutsch

### Welche Daten werden gespeichert?
- **Einstellungen** (API-URLs, Sprachen, UI-Präferenzen) -- lokal im Browser via chrome.storage.sync
- **Übersetzungsverlauf** (letzte 100 Einträge) -- lokal via chrome.storage.local
- **Token-Statistiken** (Anzahl Anfragen, Token-Verbrauch) -- lokal via chrome.storage.local
- **Übersetzungs-Cache** -- optional auf selbst-gehostetem Server ODER lokal im Browser

### Welche externen Requests werden gemacht?
- **LibreTranslate-Server**: Texte werden zur Übersetzung an den vom Nutzer konfigurierten Server gesendet
- **LM Studio**: Texte werden an den vom Nutzer konfigurierten lokalen LLM-Server gesendet
- **Cache-Server**: Übersetzungen werden optional auf dem vom Nutzer konfigurierten Server gespeichert/abgerufen

Alle Server-URLs werden vom Nutzer selbst konfiguriert. Es werden KEINE Daten an Drittanbieter oder externe Dienste gesendet.

### Tracking und Analytics
- Kein Tracking
- Keine Analytics
- Keine Werbung
- Keine Telemetrie

### Datenexport und -löschung
- Alle Daten können über die Einstellungen exportiert werden
- Alle Daten können über die Einstellungen gelöscht werden
- Bei Deinstallation werden alle lokalen Daten automatisch entfernt

---

## English

### What data is stored?
- **Settings** (API URLs, languages, UI preferences) -- locally in browser via chrome.storage.sync
- **Translation history** (last 100 entries) -- locally via chrome.storage.local
- **Token statistics** (request count, token usage) -- locally via chrome.storage.local
- **Translation cache** -- optionally on self-hosted server OR locally in browser

### What external requests are made?
- **LibreTranslate server**: Texts are sent for translation to the user-configured server
- **LM Studio**: Texts are sent to the user-configured local LLM server
- **Cache server**: Translations are optionally stored/retrieved from the user-configured server

All server URLs are configured by the user. NO data is sent to third parties or external services.

### Tracking and Analytics
- No tracking
- No analytics
- No advertising
- No telemetry

### Data export and deletion
- All data can be exported via settings
- All data can be deleted via settings
- All local data is automatically removed on uninstall
