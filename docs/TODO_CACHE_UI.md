# Cache UI Verbesserungen

## Paginierung
- Sidepanel Cache-Liste: Max 20 Einträge initial, Infinite Scroll
- Server-API: /cache/url/{url_hash}/all mit ?limit=20&offset=0
- Suchfilter nach Domain

## Zaehler
- Anzahl Cache-Einträge für aktuelle Domain anzeigen
- Anzahl Cache-Einträge für aktuelle Seite anzeigen
- Beides im Sidepanel Cache-Tab sichtbar

## Wichtig
- Cache-Inhalt muss vollständig bleiben (nur Anzeige paginieren)
- Löschen einzelner Einträge weiterhin moeglich
- Domain-weites Löschen weiterhin moeglich
