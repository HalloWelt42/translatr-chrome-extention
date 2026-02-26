// Content DOM Module - Smart Web Translator v3.7.0
// DOM-Manipulation und Text-Node-Verwaltung

(function() {
  'use strict';

  // Guard gegen doppeltes Laden
  if (window.__swtDOMLoaded) return;
  window.__swtDOMLoaded = true;

  if (typeof SmartTranslator === 'undefined') {
    console.warn('SmartTranslator nicht gefunden - content-dom.js muss nach content.js geladen werden');
    return;
  }

  /**
   * Text-Node mit Hover-Original-Funktionalität wrappen
   * Preserviert führende, trailing und interne Whitespaces
   */
  SmartTranslator.prototype.wrapWithHoverOriginal = function(node, original, translated) {
    const parent = node.parentElement;
    if (!parent) return;

    // Vollständigen Text inkl. Whitespace extrahieren
    const fullText = node.textContent;
    
    // Führendes Whitespace (Spaces, Tabs, aber KEINE Newlines am Anfang)
    const leadingMatch = fullText.match(/^([ \t]*)/);
    const leadingSpaces = leadingMatch ? leadingMatch[1] : '';
    
    // Trailing Whitespace (inkl. Newlines am Ende)
    const trailingMatch = fullText.match(/([ \t\n\r]*)$/);
    const trailingSpaces = trailingMatch ? trailingMatch[1] : '';
    
    // Übersetzung mit Whitespace zusammensetzen
    // WICHTIG: translated.trim() falls API extra Whitespace hinzufügt
    const finalTranslation = leadingSpaces + translated.trim() + trailingSpaces;

    const wrapper = document.createElement('span');
    wrapper.className = 'swt-translated-text';
    wrapper.textContent = finalTranslation;
    wrapper.dataset.original = original;
    wrapper.dataset.translated = translated;

    // Markierung nur wenn in Settings aktiviert
    if (this.settings.highlightTranslated === false) {
      wrapper.style.background = 'none';
    }

    node.parentNode.replaceChild(wrapper, node);
  };

  /**
   * Original-Tooltip anzeigen
   */
  SmartTranslator.prototype.showOriginalTooltip = function(element, original) {
    this.hideOriginalTooltip();

    const tooltip = document.createElement('div');
    tooltip.className = 'swt-ui swt-original-tooltip';
    tooltip.textContent = original;

    const rect = element.getBoundingClientRect();
    tooltip.style.cssText = `
      position: fixed;
      left: ${rect.left}px;
      top: ${rect.top - 8}px;
      transform: translateY(-100%);
    `;

    document.body.appendChild(tooltip);
    this._originalTooltip = tooltip;
    requestAnimationFrame(() => tooltip.classList.add('swt-visible'));
  };

  /**
   * Original-Tooltip verstecken
   */
  SmartTranslator.prototype.hideOriginalTooltip = function() {
    if (this._originalTooltip) {
      this._originalTooltip.remove();
      this._originalTooltip = null;
    }
  };

  /**
   * Zwischen Original und Übersetzung umschalten
   */
  SmartTranslator.prototype.toggleTranslation = function() {
    if (!this.isTranslated) return;

    document.querySelectorAll('.swt-translated-text').forEach(el => {
      const current = el.textContent;
      const original = el.dataset.original;
      const translated = el.dataset.translated;

      if (current === translated) {
        el.textContent = original;
        el.classList.add('swt-showing-original');
      } else {
        el.textContent = translated;
        el.classList.remove('swt-showing-original');
      }
    });

    this.showNotification('Ansicht gewechselt', 'info');
  };

  /**
   * Seite auf Original zurücksetzen
   */
  SmartTranslator.prototype.restorePage = function() {
    document.querySelectorAll('.swt-translated-text').forEach(el => {
      const textNode = document.createTextNode(el.dataset.original);
      el.parentNode.replaceChild(textNode, el);
    });

    this.originalTexts.clear();
    this.translatedTexts.clear();
    this.isTranslated = false;
    this.translationMode = null;
    this.notifyStatusChange();
    this.showNotification('Originaltexte wiederhergestellt', 'info');
  };

  /**
   * DIAGNOSE: Warum wird ein bestimmter Text nicht gefunden?
   * Aufruf in Console: window.swtDiagnose("Previously, each member")
   */
  window.swtDiagnose = function(searchText) {
    console.log('=== SWT Diagnose für:', searchText.substring(0, 50), '===');
    
    // Alle Text-Nodes durchsuchen
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      null
    );
    
    let found = false;
    let node;
    while (node = walker.nextNode()) {
      if (node.textContent.includes(searchText.substring(0, 30))) {
        found = true;
        const parent = node.parentElement;
        console.log('--- Gefunden! ---');
        console.log('Text:', node.textContent.substring(0, 100));
        console.log('Parent-Tag:', parent?.tagName);
        console.log('Parent-Classes:', parent?.className);
        console.log('Parent-ID:', parent?.id);
        
        // Prüfe alle Ausschluss-Gründe
        const reasons = [];
        
        if (!parent) {
          reasons.push('Kein Parent-Element');
        } else {
          const tag = parent.tagName.toLowerCase();
          
          // Immer ausgeschlossen
          if (['script', 'style', 'noscript', 'textarea', 'input', 'svg'].includes(tag)) {
            reasons.push(`Tag "${tag}" ist immer ausgeschlossen`);
          }
          
          // Code-Tags
          if (['code', 'pre', 'kbd', 'samp', 'var'].includes(tag)) {
            reasons.push(`Tag "${tag}" ist Code-Element`);
          }
          
          // Code-Container
          const codeContainer = parent.closest('code, pre, kbd, samp');
          if (codeContainer) {
            reasons.push(`In Code-Container: ${codeContainer.tagName}`);
          }
          
          // Code-Klassen
          const codeClasses = [
            'highlight', 'hljs', 'prism', 'codehilite', 'syntaxhighlighter',
            'code-block', 'codeblock', 'sourceCode', 'source-code',
            'language-', 'lang-', 'brush:', 'prettyprint',
            'monaco-editor', 'ace_editor', 'CodeMirror'
          ];
          
          for (const cls of codeClasses) {
            if (parent.className?.includes?.(cls)) {
              reasons.push(`Parent hat Code-Klasse: "${cls}" in "${parent.className}"`);
            }
            const ancestor = parent.closest(`[class*="${cls}"]`);
            if (ancestor) {
              reasons.push(`Vorfahre hat Code-Klasse: "${cls}" in "${ancestor.className}"`);
            }
          }
          
          // Data-Attribute
          const dataLang = parent.closest('[data-language], [data-lang], [data-code]');
          if (dataLang) {
            reasons.push(`Vorfahre hat data-lang Attribut: ${dataLang.tagName} - data-language="${dataLang.dataset.language}" data-lang="${dataLang.dataset.lang}" data-code="${dataLang.dataset.code}"`);
          }
          
          // Blockquote
          if (tag === 'blockquote' || parent.closest('blockquote')) {
            reasons.push('In blockquote (wird übersprungen wenn skipQuotes aktiv)');
          }
          
          // UI-Elemente
          if (parent.closest('.swt-ui')) {
            reasons.push('In .swt-ui Container');
          }
          if (parent.closest('.swt-translated-text')) {
            reasons.push('Bereits als übersetzt markiert (.swt-translated-text)');
          }
          
          // Text-Filter
          const text = node.textContent.trim();
          if (text.length < 3) {
            reasons.push(`Text zu kurz: ${text.length} Zeichen`);
          }
          if (/^[\s\d\W]*$/.test(text)) {
            reasons.push('Text enthält nur Whitespace/Zahlen/Sonderzeichen');
          }
        }
        
        if (reasons.length > 0) {
          console.log('[X] AUSSCHLUSS-GRÜNDE:');
          reasons.forEach(r => console.log('  -', r));
        } else {
          console.log('[OK] Sollte gefunden werden! (kein Ausschlussgrund)');
        }
        
        // Zeige DOM-Pfad
        let path = [];
        let el = parent;
        while (el && el !== document.body) {
          let selector = el.tagName.toLowerCase();
          if (el.id) selector += '#' + el.id;
          if (el.className) selector += '.' + el.className.split(' ').join('.');
          path.unshift(selector);
          el = el.parentElement;
        }
        console.log('DOM-Pfad:', path.join(' > '));
        console.log('---');
      }
    }
    
    if (!found) {
      console.log('[!] Text nicht im DOM gefunden!');
      console.log('Mögliche Gründe:');
      console.log('  - Text ist in einem iframe');
      console.log('  - Text wurde dynamisch geladen (nach dem Scan)');
      console.log('  - Unsichtbare Zeichen im Suchtext');
    }
  };
  
  console.log('[SWT] Diagnose verfügbar: window.swtDiagnose("Text...")');

  /**
   * Übersetzbare Text-Nodes finden
   */
  SmartTranslator.prototype.findTranslatableTextNodes = function() {
    const skipCode = this.settings.skipCodeBlocks !== false;
    const skipQuotes = this.settings.skipBlockquotes !== false;
    
    const documents = [document];
    
    console.log('[SWT] Durchsuche', documents.length, 'Dokumente');
    
    const nodes = [];
    
    documents.forEach(doc => {
      const root = doc === document ? document.body : doc.body;
      if (!root) return;
      
      // WICHTIG: TreeWalker muss auf dem richtigen Document erstellt werden!
      const walker = doc.createTreeWalker(
        root,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: (node) => {
            const parent = node.parentElement;
            if (!parent) return NodeFilter.FILTER_REJECT;

            const tag = parent.tagName.toLowerCase();
            
            // Immer ausschließen
            const alwaysExcluded = ['script', 'style', 'noscript', 'textarea', 'input', 'svg'];
            if (alwaysExcluded.includes(tag)) return NodeFilter.FILTER_REJECT;

            // Code-Elemente (konfigurierbar)
            if (skipCode) {
              const codeTags = ['code', 'pre', 'kbd', 'samp', 'var'];
              if (codeTags.includes(tag)) return NodeFilter.FILTER_REJECT;
              
              if (parent.closest('code, pre, kbd, samp')) return NodeFilter.FILTER_REJECT;
              
              const codeClasses = [
                'highlight', 'hljs', 'prism', 'codehilite', 'syntaxhighlighter',
                'code-block', 'codeblock', 'sourceCode', 'source-code',
                'language-', 'lang-', 'brush:', 'prettyprint',
                'monaco-editor', 'ace_editor', 'CodeMirror'
              ];
              
              const hasCodeClass = codeClasses.some(cls => 
                parent.className?.includes?.(cls) || 
                parent.closest(`[class*="${cls}"]`)
              );
              if (hasCodeClass) return NodeFilter.FILTER_REJECT;

              if (parent.closest('[data-language], [data-lang], [data-code]')) {
                return NodeFilter.FILTER_REJECT;
              }
            }

            // Zitate (konfigurierbar)
            if (skipQuotes) {
              if (tag === 'blockquote') return NodeFilter.FILTER_REJECT;
              if (parent.closest('blockquote')) return NodeFilter.FILTER_REJECT;
            }

            // Eigene UI-Elemente
            if (parent.closest('.swt-ui')) return NodeFilter.FILTER_REJECT;
            if (parent.closest('.swt-translated-text')) return NodeFilter.FILTER_REJECT;

            const text = node.textContent.trim();
            if (text.length < 3 || /^[\s\d\W]*$/.test(text)) return NodeFilter.FILTER_REJECT;

            return NodeFilter.FILTER_ACCEPT;
          }
        }
      );

      let node;
      let docNodes = 0;
      while (node = walker.nextNode()) {
        // Markiere Nodes aus iframes
        if (doc !== document) {
          node._sourceDocument = doc;
          node._isIframeContent = true;
        }
        nodes.push(node);
        docNodes++;
      }
      console.log('[SWT] Gefundene Nodes in Dokument:', docNodes, doc === document ? '(main)' : '(iframe)');
    });
    
    console.log('[SWT] Gesamt gefundene Text-Nodes:', nodes.length);
    return nodes;
  };
  
  /**
   * Erzeugt einen CSS-Selektor-Pfad für ein Element
   */
  SmartTranslator.prototype._getElementPath = function(el) {
    const path = [];
    while (el && el.nodeType === Node.ELEMENT_NODE) {
      let selector = el.tagName.toLowerCase();
      if (el.id) {
        selector += '#' + el.id;
        path.unshift(selector);
        break;
      } else {
        let sibling = el;
        let nth = 1;
        while (sibling = sibling.previousElementSibling) {
          if (sibling.tagName === el.tagName) nth++;
        }
        if (nth > 1) selector += ':nth-of-type(' + nth + ')';
      }
      path.unshift(selector);
      el = el.parentElement;
    }
    return path.join(' > ');
  };

  /**
   * Leerzeichen bei Inline-Tag-Wechseln normalisieren
   * Muss VOR findTranslatableTextNodes aufgerufen werden
   */
  SmartTranslator.prototype.normalizeInlineSpacing = function() {
    const inlineTags = ['strong', 'b', 'em', 'i', 'a', 'span', 'mark', 'u', 's', 'sub', 'sup', 'small', 'code', 'abbr', 'cite', 'q'];
    
    inlineTags.forEach(tag => {
      document.querySelectorAll(tag).forEach(el => {
        if (el.closest('.swt-ui')) return;
        
        const prev = el.previousSibling;
        if (prev && prev.nodeType === Node.TEXT_NODE) {
          const text = prev.textContent;
          if (text.length > 0 && /[^\s]$/.test(text)) {
            prev.textContent = text + ' ';
          }
        }
        
        const next = el.nextSibling;
        if (next && next.nodeType === Node.TEXT_NODE) {
          const text = next.textContent;
          if (text.length > 0 && /^[^\s.,;:!?)\]}"']/.test(text)) {
            next.textContent = ' ' + text;
          }
        }
      });
    });
  };

  /**
   * Leerzeichen-Fix für Inline-Tags in extrahiertem Text
   */
  SmartTranslator.prototype.fixInlineTagSpacing = function(element) {
    if (!element) return '';
    
    const clone = element.cloneNode(true);
    const inlineTags = ['strong', 'b', 'em', 'i', 'a', 'span', 'mark', 'u', 's', 'sub', 'sup', 'small'];
    
    inlineTags.forEach(tag => {
      clone.querySelectorAll(tag).forEach(el => {
        const prev = el.previousSibling;
        if (prev && prev.nodeType === Node.TEXT_NODE) {
          const text = prev.textContent;
          if (text.length > 0 && !/\s$/.test(text)) {
            prev.textContent = text + ' ';
          }
        }
        
        const next = el.nextSibling;
        if (next && next.nodeType === Node.TEXT_NODE) {
          const text = next.textContent;
          if (text.length > 0 && !/^\s/.test(text)) {
            next.textContent = ' ' + text;
          }
        }
      });
    });
    
    return clone.textContent.replace(/\s+/g, ' ').trim();
  };

  // === Event-Delegation für Hover-Original ===
  // Greift sofort für alle .swt-translated-text Elemente,
  // reagiert live auf Einstellungsänderungen
  document.addEventListener('mouseover', function(e) {
    var el = e.target.closest('.swt-translated-text');
    if (!el || !window.swtInstance?.settings?.showOriginalInTooltip) return;
    var original = el.dataset.original;
    if (original) {
      window.swtInstance.showOriginalTooltip(el, original);
    }
  });

  document.addEventListener('mouseout', function(e) {
    var el = e.target.closest('.swt-translated-text');
    if (!el || !window.swtInstance) return;
    window.swtInstance.hideOriginalTooltip();
  });

})();
