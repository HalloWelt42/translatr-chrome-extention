# Smart Web Translator - Bekannte Probleme & Lösungen

## E-Book Cache Problem (v3.13.x) ✅ GELÖST

### Problem
E-Book Übersetzungen werden gespeichert aber beim Neuladen nicht gefunden (0% Cache-Hit).

### Ursache
**Hash-Inkonsistenz zwischen Content-Script und Background-Script:**

1. **Zwei separate `computeHash` Implementierungen:**
   - `shared/cache-server.js` (Content-Script)
   - `background.js` (eigene Kopie)

2. **E-Book URLs enthalten dynamische Positionsdaten:**
   ```
   epubcfi(/6/14!/4/2/2[chapter001]/32/3:274)
           └────┘ └─────────────────────────┘
           Kapitel  Position (ändert sich!)
   ```

3. **Der `includeHash` Parameter wurde nicht überall übergeben:**
   - Beim Laden (Content): `computeHash(url, text, lang, true)` ✓
   - Beim Speichern (Background): `computeHash(url, text, lang)` ✗ (fehlte!)

### Lösung (v3.13.15+)
Alle `computeHash` Aufrufe müssen den `isEbook` Parameter setzen:

```javascript
const isEbook = pageUrl?.includes('#epubcfi');
const hash = await CacheServer.computeHash(pageUrl, text, langPair, isEbook);
```

Betroffene Stellen in `background.js`:
- `store()` - Einzelspeicherung
- `bulkStore()` - Batch-Speicherung  
- `translateText()` - Einzelübersetzung Cache-Check
- `translateBatch()` - Batch Cache-Check und Speicherung

### epubcfi Normalisierung
```javascript
// epubcfi(/6/14!/4/2/2[chapter001]/32/3:274)
// → Nur den Teil VOR dem ! verwenden: /6/14

const match = url.hash.match(/epubcfi\(([^!]+)!/);
if (match) {
  const spinePath = match[1]; // "/6/14"
  normalizedUrl = url.origin + url.pathname + '#epubcfi(' + spinePath + ')';
}
```

### Debug-Schritte
1. Service Worker Console öffnen (`chrome://extensions` → Service Worker)
2. Beim Speichern prüfen: `[Background computeHash] → hash: XXX`
3. Beim Laden prüfen: `[Cache] Erster Check-Hash: YYY`
4. **Hashes müssen identisch sein!**

---

## Ausgelassene Textabschnitte bei LM Studio Batch (v3.13.x) ✅ GELÖST

### Problem
Manchmal fehlen mitten im übersetzten Text ganze Abschnitte bei LM Studio Batch-Übersetzung.

### Ursache
**Matching-Problem zwischen Original-Texten und LLM-Antworten:**

1. Content-Script sammelte 20 Nodes → Sendete als Batch
2. Background erhielt Antwort → Musste Items zurück zu Nodes MATCHEN
3. LLM modifizierte manchmal Original-Text in Antwort (Whitespace, etc.)
4. Matching schlug fehl → Text blieb unübersetzt

### Lösung (v3.13.35+): Queue-basiertes Batching

**VORHER (fehlerhaft):**
```
Content: Sammle 20 Nodes → Batch-Request → Erhalte Items → MATCHE zu Nodes ❌
         ↑ Matching fehlschlägt wenn LLM Original-Text modifiziert
```

**NACHHER (v3.13.35+):**
```
Content: Node für Node → translate(text) → Promise wartet
                              ↓
Background Queue:  Sammelt Texte → Batch an LLM → Resolved DIREKTE Promises ✅
                   ↑ Kein Matching nötig, jeder Text hat sein eigenes Promise
```

### Implementierung

**Background Script - Translation Queue:**
```javascript
this.translationQueue = {
  pending: new Map(),      // text → { resolve, reject, ... }
  buffer: new Map(),       // text → translation (Wiederholungs-Cache)
  batchTimeout: null,
  batchDelay: 50,          // ms warten vor Batch
  maxBatchSize: 20         // Max Texte pro Batch
};
```

**Content Script:**
```javascript
// Alle Übersetzungspfade nutzen jetzt Einzel-Requests:
const result = await chrome.runtime.sendMessage({
  action: 'translate',     // NICHT 'translateBatch'
  text: originalText,
  source: 'en',
  target: 'de',
  pageUrl: window.location.href
});
// Background batcht automatisch für LM Studio
```

### Vorteile
1. **Kein Matching-Problem** - Jeder Text hat direktes Promise
2. **Batch-Effizienz erhalten** - Background batcht automatisch (20 Texte)
3. **Einheitlicher Code** - Alle Pfade (Standard/E-Book/Plain-Text) identisch
4. **Cache-Integration** - Queue prüft/speichert im Cache-Server
5. **Fallback** - Einzelübersetzung wenn Batch-Item fehlt

### Entfernter Code (v3.13.38)
- 162 Zeilen toter `useTrueBatch` Code im Content-Script entfernt
- Alte Batch-Matching-Logik entfernt
- `batchSize`, `enableTrueBatch` Variablen entfernt

---

## Allgemeine Debug-Tipps

### Logs aktivieren
- **Content-Script Logs:** F12 → Console auf der Webseite
- **Background/Service Worker Logs:** `chrome://extensions` → Service Worker klicken
- **Netzwerk:** F12 → Network → Filter auf API-Calls

### Hash-Konsistenz prüfen
Beide Scripts müssen für denselben Input denselben Hash erzeugen:
```
Input: URL + Text + LangPair + (isEbook)
Output: SHA-256 Hash
```

### Häufige Fehlerquellen
1. **Whitespace-Unterschiede** - `trim()` nicht überall angewendet
2. **Encoding-Unterschiede** - UTF-8 vs andere
3. **URL-Normalisierung** - Mit/ohne trailing slash, Query-Params
4. **Sprach-Paar Format** - `en:de` vs `auto:de` vs `en-de`

---

## Strategie: Nachträgliche Übersetzung ausgelassener Texte

### Problem
Manchmal werden Textabschnitte bei der Batch-Übersetzung ausgelassen:
- Token-Limit-Probleme (bereits adressiert mit Validierung)
- DOM-Elemente die beim ersten Scan nicht erfasst wurden
- Dynamisch nachgeladene Inhalte
- Manuell markierte Texte für Nachübersetzung

### Theoretisches Konzept

#### 1. Exakter Selektor für Textstellen
Um eine Textstelle eindeutig zu identifizieren, brauchen wir einen **stabilen DOM-Selektor**:

```javascript
/**
 * Generiert einen eindeutigen CSS-Selektor für ein Element
 * @param {Element} element - Das Ziel-Element
 * @returns {string} - CSS-Selektor z.B. "div#main > p:nth-child(3) > span.text"
 */
function generateUniqueSelector(element) {
  const parts = [];
  let current = element;
  
  while (current && current !== document.body) {
    let selector = current.tagName.toLowerCase();
    
    // ID ist einzigartig
    if (current.id) {
      selector = `#${current.id}`;
      parts.unshift(selector);
      break; // ID ist eindeutig, fertig
    }
    
    // Klassen hinzufügen (nur stabile, keine dynamischen)
    const stableClasses = Array.from(current.classList)
      .filter(c => !c.match(/^(active|selected|hover|focus|js-|is-)/))
      .slice(0, 2);
    if (stableClasses.length) {
      selector += '.' + stableClasses.join('.');
    }
    
    // Position unter Geschwistern (nth-child)
    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        c => c.tagName === current.tagName
      );
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        selector += `:nth-of-type(${index})`;
      }
    }
    
    parts.unshift(selector);
    current = current.parentElement;
  }
  
  return parts.join(' > ');
}
```

#### 2. Text-Position innerhalb des Elements

Für Text-Nodes innerhalb eines Elements brauchen wir zusätzlich:

```javascript
/**
 * Lokalisiert einen Text-Node innerhalb eines Elements
 * @param {Element} element - Container-Element
 * @param {string} text - Der gesuchte Text
 * @returns {Object} - { nodeIndex, offset, length }
 */
function locateTextInElement(element, text) {
  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
    null,
    false
  );
  
  let nodeIndex = 0;
  let node;
  
  while (node = walker.nextNode()) {
    const content = node.textContent;
    const offset = content.indexOf(text);
    
    if (offset !== -1) {
      return {
        nodeIndex,
        offset,
        length: text.length,
        fullText: content.trim()
      };
    }
    nodeIndex++;
  }
  
  return null;
}
```

#### 3. Speicher-Struktur für ausgelassene Texte

```javascript
/**
 * Struktur für einen nachzuübersetzenden Text
 */
const pendingTranslation = {
  // Identifikation
  id: 'uuid-xxx',
  pageUrl: 'https://example.com/page',
  
  // DOM-Lokalisierung
  selector: 'div#content > p:nth-of-type(3)',
  textNodeIndex: 0,    // Welcher Text-Node im Element
  textOffset: 0,       // Position im Text-Node
  
  // Text-Daten
  originalText: 'The quick brown fox...',
  textHash: 'sha256-xxx', // Für Deduplizierung
  
  // Status
  status: 'pending',   // pending | translated | failed
  retryCount: 0,
  
  // Timing
  createdAt: Date.now(),
  lastAttempt: null
};
```

#### 4. Speicher-Strategie

**Option A: LocalStorage (begrenzt, ~5MB)**
```javascript
// Getrennte Listen pro Seite
localStorage.setItem('smt_pending_' + urlHash, JSON.stringify(pendingItems));
```

**Option B: IndexedDB (unbegrenzt, empfohlen)**
```javascript
// Schema
const schema = {
  store: 'pendingTranslations',
  keyPath: 'id',
  indexes: [
    { name: 'pageUrl', keyPath: 'pageUrl' },
    { name: 'status', keyPath: 'status' },
    { name: 'createdAt', keyPath: 'createdAt' }
  ]
};
```

**Option C: Server-Cache erweitern**
```
POST /cache/pending
{
  "url_hash": "xxx",
  "items": [...]
}

GET /cache/pending/{url_hash}
```

#### 5. Manuelle Markierung von Texten

Benutzer-Interface für das Markieren von ausgelassenen Texten:

```javascript
/**
 * Kontextmenü-Handler für Textauswahl
 */
function handleTextSelection() {
  const selection = window.getSelection();
  if (!selection.rangeCount) return;
  
  const range = selection.getRangeAt(0);
  const selectedText = selection.toString().trim();
  
  if (selectedText.length < 3) return;
  
  // Element finden
  const container = range.commonAncestorContainer;
  const element = container.nodeType === Node.TEXT_NODE 
    ? container.parentElement 
    : container;
  
  // Selektor generieren
  const selector = generateUniqueSelector(element);
  
  // Zur Pending-Liste hinzufügen
  addToPendingTranslations({
    selector,
    originalText: selectedText,
    // ...
  });
  
  // Visuelles Feedback
  highlightPendingText(element, selectedText);
}

// Kontextmenü registrieren
chrome.contextMenus.create({
  id: 'mark-for-translation',
  title: 'Zur Übersetzung markieren',
  contexts: ['selection']
});
```

#### 6. Batch-Nachübersetzung

```javascript
/**
 * Übersetzt alle ausstehenden Texte einer Seite
 */
async function translatePendingItems(pageUrl) {
  // Ausstehende Items laden
  const pending = await getPendingTranslations(pageUrl);
  
  if (pending.length === 0) return;
  
  console.log(`[SWT] ${pending.length} ausstehende Übersetzungen`);
  
  // Texte sammeln
  const texts = pending.map(p => p.originalText);
  
  // Batch-Übersetzung
  const result = await chrome.runtime.sendMessage({
    action: 'translateBatch',
    texts,
    pageUrl
  });
  
  if (!result.success) return;
  
  // Übersetzungen anwenden
  const translationMap = new Map(
    result.items.map(i => [i.original, i.translation])
  );
  
  for (const item of pending) {
    const translation = translationMap.get(item.originalText);
    
    if (translation) {
      // Element finden
      const element = document.querySelector(item.selector);
      if (!element) {
        console.warn('[SWT] Element nicht gefunden:', item.selector);
        continue;
      }
      
      // Übersetzung anwenden
      applyTranslationToElement(element, item, translation);
      
      // Status aktualisieren
      item.status = 'translated';
    } else {
      item.status = 'failed';
      item.retryCount++;
    }
  }
  
  // Status speichern
  await savePendingTranslations(pageUrl, pending.filter(p => p.status !== 'translated'));
}
```

### Implementierungs-Roadmap

1. **Phase 1: Grundstruktur**
   - [ ] `generateUniqueSelector()` implementieren
   - [ ] IndexedDB Store für pending items
   - [ ] API-Endpunkte im Background-Script

2. **Phase 2: Manuelle Markierung**
   - [ ] Kontextmenü "Zur Übersetzung markieren"
   - [ ] Visuelles Highlighting für markierte Texte
   - [ ] Panel-Ansicht für ausstehende Übersetzungen

3. **Phase 3: Automatische Erkennung**
   - [ ] MutationObserver für neue/geänderte Texte
   - [ ] Vergleich mit bereits übersetzten Texten
   - [ ] Automatisches Hinzufügen zur Pending-Liste

4. **Phase 4: Integration**
   - [ ] Cache-First prüft auch Pending-Items
   - [ ] Export/Import von Pending-Listen
   - [ ] Statistik: "X Texte noch ausstehend"

### Offene Fragen

1. **Selektor-Stabilität**: Wie gehen wir mit dynamischen Seiten um, deren DOM sich ändert?
   - Option: XPath statt CSS-Selektor
   - Option: Text-basierte Suche als Fallback

2. **Duplikate**: Was wenn derselbe Text mehrfach vorkommt?
   - Option: Alle Vorkommen übersetzen
   - Option: Nur erstes, Rest per CSS-Regel

3. **Performance**: Wie viele Pending-Items sind praktikabel?
   - Limit pro Seite (z.B. 1000)
   - Ältere Items automatisch löschen
