# Smart Web Translator -- Architektur

## Übersicht

```
Content Script                    Service Worker                   Cache Server
(translator.js)                   (service-worker.js)              (FastAPI)

translatePage()                   translateText()
  findTranslatableTextNodes()       apiType?
  Batch-Loop (pageBatchSize)          libretranslate --> direkt
    Promise.all(batch)                lmstudio --> Queue
      TRANSLATE message   ------->     Buffer/Cache check
                                       Queue sammeln (50ms/20 Texte)
                                       batchTranslateWithLMStudio()
                          <-------   Result + source + tokens
    wrapWithHoverOriginal()
                                   CacheServer.bulkStore()  ------->  POST /cache/bulk
```

## Komponenten

### Content Script (`content/`)

| Datei | Verantwortung |
|-------|---------------|
| `translator.js` | SmartTranslator Klasse, translatePage(), Message-Handler |
| `translator-dom.js` | DOM-Manipulation, findTranslatableTextNodes(), wrapWithHoverOriginal() |
| `translator-cache.js` | Cache-Check beim Seitenaufruf, Cache-Laden |
| `translator-ui.js` | UI-Elemente (Selection-Icon, Progress-Overlay, Notifications) |
| `translator-export.js` | PDF/HTML Export |
| `domain-strategies.js` | Domain-spezifische Filter (Wikipedia, GitHub, StackOverflow) |

### Service Worker (`service-worker.js`)

| Bereich | Verantwortung |
|---------|---------------|
| Message Handler | `TRANSLATE`, `TRANSLATE_BATCH`, `TRANSLATE_PAGE`, `RETRANSLATE_PAGE`, `RESTORE_PAGE` |
| `translateText()` | Routing: Cache-Check, Provider-Auswahl, Ergebnis mit source-Feld |
| `translationQueue` | Queue-basiertes Batching für LM Studio (Buffer, Pending, Batch-Verarbeitung) |
| `CLEAR_TRANSLATION_BUFFER` | Buffer leeren bei Provider-Wechsel |
| CacheServer (Background) | Direkte HTTP-Kommunikation mit Cache-Server (vermeidet Mixed Content) |

### Shared (`shared/`)

| Datei | Verantwortung |
|-------|---------------|
| `storage.js` | Storage-Abstraktion, Default-Werte |
| `cache-server.js` | CacheServer API Client (Content Script Seite) |
| `cache-local.js` | LocalStorage Cache-Backend (SWT.CacheLocal) |
| `cache-manager.js` | Cache-Orchestrierung nach Modus (local-first, server-first, etc.) |
| `icons.js` | SVG Icon-Bibliothek (SWT.Icons), FontAwesome Subset |
| `toast.js` | Toast-Notifications (SWT.Toast) |
| `utils.js` | Hilfsfunktionen (SWT.Utils) |
| `api-badge.js` | API-Badge Komponente (SWT.ApiBadge) |

### UI-Seiten (`pages/`, `popup/`)

| Datei | Verantwortung |
|-------|---------------|
| `popup/popup.js` | Quick-Translate, Seitenaktionen, Provider-Status |
| `pages/sidepanel.js` | PageState (Zustandsableitung), ActionRenderer, Pipeline-Ansicht, Cache-Tabs |
| `pages/options.js` | Provider-Accordion, Auto-Save, Verbindungstest, CONTEXT_PROMPTS |

## Datenfluss: Seitenübersetzung

1. User klickt "Seite übersetzen"
2. Content: `findTranslatableTextNodes()` findet N Text-Nodes (respektiert skipCodeBlocks, skipBlockquotes)
3. Content: Batch-Loop mit `pageBatchSize` (Default 20)
4. Pro Batch: `Promise.all()` feuert TRANSLATE-Messages parallel ab
5. Service Worker: `translateText()` pro Text
   - Cache-Check (Server/Lokal je nach Modus)
   - Provider-Routing (LibreTranslate direkt, LM Studio via Queue)
   - Ergebnis mit `source` (api/cache/buffer) und `tokens`
6. Content: Ergebnisse in Reihenfolge anwenden via `wrapWithHoverOriginal()`
7. Alle verarbeiteten Nodes werden in `.swt-translated-text` gewrappt (auch bei identischer Übersetzung)
8. Service Worker: `CacheServer.bulkStore()` speichert neue Übersetzungen async

## LM Studio Queue

```
translateWithLMStudioQueue(text)
  1. Buffer-Check (RAM-Cache, Map<bufferKey, translation>)
  2. Cache-Server-Check (wenn aktiviert und !bypassCache)
  3. Zur Queue hinzufügen mit Promise

scheduleQueueProcessing()
  Nach 50ms ODER wenn maxBatchSize erreicht: processTranslationQueue()

processTranslationQueue()
  1. Snapshot: max 20 Texte aus Queue
  2. batchTranslateWithLMStudio(texts[])  -- ein LLM-Call
  3. Promises resolven
  4. Buffer aktualisieren
  5. CacheServer.bulkStore() (async)
  6. Falls noch Items: erneut schedulen
```

Buffer wird bei Provider-Wechsel geleert (`CLEAR_TRANSLATION_BUFFER`).

## PageState (Side Panel)

Zustandsableitung aus `GET_PAGE_INFO` Response:

| Bedingung | Zustand | Continue-Button |
|-----------|---------|-----------------|
| `isTranslating` | translating | deaktiviert |
| `isTranslated` | translated | aktiviert |
| `translatedCount > 0` oder `remaining > 0` | partial | aktiviert |
| sonst | idle | deaktiviert |

## Hash-Berechnung

**url_hash** (12 Zeichen, Ordnername auf Server):
```
SHA256(hostname ohne www, lowercase)[:12]
Nicht-Standard-Ports bleiben: "localhost:3000"
```

**trans_hash** (64 Zeichen, Dateiname auf Server):
```
SHA256(origin + pathname + text + ":" + langPair)
Fallback bei HTTP: djb2-Hash (kein crypto.subtle)
```

## Settings (chrome.storage.sync)

| Key | Default | Beschreibung |
|-----|---------|--------------|
| `apiType` | `libretranslate` | Aktives Backend |
| `serviceUrl` | `https://translate.max` | LibreTranslate URL |
| `lmStudioUrl` | `` | LM Studio URL |
| `cacheServerEnabled` | `true` | Cache aktiv |
| `cacheServerMode` | `server-only` | Cache-Modus |
| `pageBatchSize` | `20` | Texte pro Batch |
| `useCacheFirst` | `true` | Cache vor API prüfen |
| `skipCodeBlocks` | `true` | Code-Elemente ausschließen |
| `skipBlockquotes` | `true` | Zitate ausschließen |
