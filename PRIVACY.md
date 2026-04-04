# Datenschutz

Version 1.0 -- Stand April 2026

## 1. Grundsatz

Smart Translator speichert alle Daten ausschließlich lokal auf dem Gerät des Nutzers. Es werden keine personenbezogenen Daten an externe Server übermittelt -- es sei denn, der Nutzer konfiguriert aktiv einen eigenen Cache-Server.

## 2. Gespeicherte Daten

**Browser-Speicher (chrome.storage)**
- Einstellungen (Backend-Typ, Server-URLs, Sprache, Cache-Modus)
- Übersetzungsverlauf (letzte Übersetzungen im Popup)
- Token-Statistiken (Anzahl verbrauchter LLM-Tokens)

**Browsercache (LocalStorage)**
- Zwischengespeicherte Übersetzungen (Original + Übersetzung, gehashte Zuordnung)
- Daten bleiben lokal im Browser und werden nicht übertragen

## 3. Externe Verbindungen

Die Software verbindet sich nur mit Diensten, die der Nutzer selbst konfiguriert:

| Dienst | Zweck | Gesendete Daten |
|--------|-------|-----------------|
| LibreTranslate | Übersetzung | Zu übersetzender Text, Sprachpaar |
| LM Studio | LLM-Übersetzung | Zu übersetzender Text, System-Prompt, Sprachpaar |
| SWT Cache Server | Übersetzungs-Cache | Gehashte URL, Original + Übersetzung |

Alle diese Dienste werden vom Nutzer selbst betrieben. Es gibt keine Verbindung zu öffentlichen Cloud-Diensten oder Tracking-Netzwerken.

## 4. Tracking und Analyse

Smart Translator verwendet:

- Keine Cookies
- Kein Tracking
- Keine Telemetrie
- Keine Werbung
- Keine Analytics

## 5. Berechtigungen

Die Extension benötigt folgende Chrome-Berechtigungen:

| Berechtigung | Zweck |
|--------------|-------|
| activeTab | Zugriff auf die aktive Seite zum Übersetzen |
| storage | Speichern von Einstellungen und Verlauf |
| scripting | Einfügen des Übersetzungs-Scripts in Webseiten |
| contextMenus | Rechtsklick-Menü für Auswahl-Übersetzung |
| sidePanel | Erweiterte Funktionen im Seitenpanel |

## 6. Datenlöschung

Alle lokal gespeicherten Daten können jederzeit gelöscht werden:

- Browsercache: Über die Einstellungen der Extension ("Cache leeren")
- Alle Daten: Durch Deinstallation der Extension
- Cache-Server: Über die Cache-Verwaltung im Side Panel

---

(c) 2025-2026 HalloWelt42
