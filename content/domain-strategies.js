// Domain-Strategien für Smart Web Translator
// Modulares System für domainspezifische Anpassungen
// Kann unabhängig erweitert werden

console.log('[SWT DomainStrategies] Modul wird geladen...');

const DomainStrategies = {
  
  // Registry aller Strategien
  strategies: {},

  // Strategie registrieren
  register(name, strategy) {
    this.strategies[name] = strategy;
    console.log('[SWT DomainStrategies] Strategie registriert:', name);
  },

  // Passende Strategie für URL finden
  getStrategy(url) {
    try {
      const hostname = new URL(url).hostname;
      
      // SPEZIALFALL: Plain-Text prüfen (vor allen anderen)
      if (this.strategies.plaintext?.shouldActivate()) {
        console.log('[SWT Strategy] Plain-Text erkannt');
        return this.strategies.plaintext;
      }
      
      // Alle Strategien AUSSER default prüfen
      for (const [name, strategy] of Object.entries(this.strategies)) {
        if (name === 'default' || name === 'plaintext') continue; // Skip
        
        if (strategy.matches && strategy.matches(hostname)) {
          console.log('[SWT Strategy] Matched:', name, 'für', hostname);
          return strategy;
        }
      }
      
      // Fallback zu default
      console.log('[SWT Strategy] Fallback zu default für', hostname);
      return this.strategies.default;
    } catch (e) {
      console.warn('[SWT Strategy] Fehler:', e);
      return this.strategies.default;
    }
  },

  // Prüfen ob Domain spezielle Behandlung braucht
  needsSpecialHandling(url) {
    const strategy = this.getStrategy(url);
    return strategy && strategy !== this.strategies.default;
  }
};

console.log('[SWT DomainStrategies] DomainStrategies Objekt erstellt');

// === Standard-Strategie ===
DomainStrategies.register('default', {
  name: 'Standard',
  
  matches(hostname) {
    return true; // Fallback
  },

  // Selektoren für übersetzbaren Content
  getContentSelectors() {
    return ['body'];
  },

  // Selektoren die ausgeschlossen werden
  getExcludeSelectors() {
    return [
      'script', 'style', 'noscript', 'svg', 'code', 'pre', 'kbd',
      'nav', 'header', 'footer', '.nav', '.menu', '.sidebar',
      '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]'
    ];
  },

  // Text vor Übersetzung aufbereiten
  preprocessText(text) {
    return text;
  },

  // Übersetzung nachbearbeiten
  postprocessTranslation(translated, original) {
    return translated;
  },

  // Content-Container für PDF-Export
  getMainContentSelector() {
    return 'body';
  }
});

// === Wikipedia-Strategie ===
DomainStrategies.register('wikipedia', {
  name: 'Wikipedia',
  
  matches(hostname) {
    return hostname.includes('wikipedia.org') || 
           hostname.includes('wikimedia.org') ||
           hostname.includes('wiktionary.org');
  },

  getContentSelectors() {
    return [
      '#mw-content-text',
      '.mw-parser-output',
      '#bodyContent'
    ];
  },

  getExcludeSelectors() {
    return [
      // Standard
      'script', 'style', 'noscript', 'svg', 'code', 'pre', 'kbd',
      // Wikipedia-spezifisch
      '.navbox', '.infobox', '.sidebar', '.ambox', '.mbox',
      '.reference', '.reflist', '.references', '.citation',
      '.toc', '#toc', '.mw-editsection', '.mw-jump-link',
      '.noprint', '.metadata', '.catlinks', '#catlinks',
      '.sistersitebox', '.portalbox', '.vertical-navbox',
      '.mw-indicators', '.mw-revision', '#coordinates',
      'table.wikitable', // Optional: Tabellen
      '.hatnote', '.dablink', '.rellink',
      '#siteNotice', '#contentSub', '.mw-empty-elt'
    ];
  },

  preprocessText(text) {
    // Wikipedia-spezifische Bereinigung
    return text
      .replace(/\[\d+\]/g, '') // Referenznummern [1], [2] etc.
      .replace(/\[citation needed\]/gi, '')
      .replace(/\[edit\]/gi, '')
      .trim();
  },

  postprocessTranslation(translated, original) {
    return translated;
  },

  getMainContentSelector() {
    return '#mw-content-text .mw-parser-output';
  },

  // Spezielle Methode: Artikel-Struktur extrahieren für PDF
  extractArticleStructure(doc) {
    const content = doc.querySelector(this.getMainContentSelector());
    if (!content) return null;

    const structure = {
      title: doc.querySelector('#firstHeading')?.textContent || document.title,
      sections: []
    };

    let currentSection = { heading: null, content: [] };

    content.childNodes.forEach(node => {
      if (node.nodeType !== Node.ELEMENT_NODE) return;

      const tag = node.tagName.toLowerCase();

      // Ausgeschlossene Elemente überspringen
      if (this.getExcludeSelectors().some(sel => node.matches?.(sel))) {
        return;
      }

      if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)) {
        if (currentSection.content.length > 0) {
          structure.sections.push(currentSection);
        }
        currentSection = {
          heading: node.textContent.replace(/\[edit\]/gi, '').trim(),
          level: parseInt(tag[1]),
          content: []
        };
      } else if (tag === 'p') {
        const text = node.textContent.trim();
        if (text.length > 0) {
          currentSection.content.push({ type: 'paragraph', text });
        }
      } else if (tag === 'ul' || tag === 'ol') {
        const items = Array.from(node.querySelectorAll('li'))
          .map(li => li.textContent.trim())
          .filter(t => t.length > 0);
        if (items.length > 0) {
          currentSection.content.push({ type: 'list', ordered: tag === 'ol', items });
        }
      } else if (tag === 'blockquote') {
        currentSection.content.push({ type: 'quote', text: node.textContent.trim() });
      } else if (tag === 'figure' || node.querySelector('img')) {
        const img = node.querySelector('img');
        if (img) {
          currentSection.content.push({
            type: 'image',
            src: img.src,
            alt: img.alt || '',
            caption: node.querySelector('figcaption')?.textContent || ''
          });
        }
      }
    });

    if (currentSection.content.length > 0) {
      structure.sections.push(currentSection);
    }

    return structure;
  }
});

// === GitHub-Strategie ===
DomainStrategies.register('github', {
  name: 'GitHub',
  
  matches(hostname) {
    return hostname.includes('github.com') || hostname.includes('github.io');
  },

  getContentSelectors() {
    return [
      '.markdown-body',
      '.readme-content',
      '.Box-body',
      '.comment-body',
      '.issue-body'
    ];
  },

  getExcludeSelectors() {
    return [
      'script', 'style', 'noscript', 'svg',
      'code', 'pre', '.highlight', '.blob-code',
      '.file-header', '.file-actions',
      'nav', '.Header', '.footer', '.pagehead',
      '.repository-content .file', // Code-Dateien
      '.diff-table', '.blob-wrapper'
    ];
  },

  preprocessText(text) {
    return text;
  },

  postprocessTranslation(translated, original) {
    return translated;
  },

  getMainContentSelector() {
    return '.markdown-body';
  }
});

// === StackOverflow-Strategie ===
DomainStrategies.register('stackoverflow', {
  name: 'StackOverflow',
  
  matches(hostname) {
    return hostname.includes('stackoverflow.com') || 
           hostname.includes('stackexchange.com') ||
           hostname.includes('askubuntu.com') ||
           hostname.includes('superuser.com');
  },

  getContentSelectors() {
    return [
      '.s-prose',
      '.post-text',
      '.comment-text',
      '.question-hyperlink'
    ];
  },

  getExcludeSelectors() {
    return [
      'script', 'style', 'noscript', 'svg',
      'code', 'pre', '.highlight', '.prettyprint',
      '.post-menu', '.js-post-menu',
      '.user-info', '.user-details',
      '.comments-link', '.js-comments-container',
      'nav', 'header', 'footer', '.sidebar'
    ];
  },

  preprocessText(text) {
    return text;
  },

  postprocessTranslation(translated, original) {
    return translated;
  },

  getMainContentSelector() {
    return '#question, #answers';
  }
});

// === Medium-Strategie ===
DomainStrategies.register('medium', {
  name: 'Medium',
  
  matches(hostname) {
    return hostname.includes('medium.com') || 
           hostname.includes('towardsdatascience.com');
  },

  getContentSelectors() {
    return [
      'article',
      '.postArticle-content',
      '.section-content'
    ];
  },

  getExcludeSelectors() {
    return [
      'script', 'style', 'noscript', 'svg',
      'code', 'pre',
      'nav', 'header', 'footer',
      '.postActions', '.u-paddingTop10',
      '.js-postShareWidget'
    ];
  },

  preprocessText(text) {
    return text;
  },

  postprocessTranslation(translated, original) {
    return translated;
  },

  getMainContentSelector() {
    return 'article';
  }
});

// === News-Seiten Strategie ===
DomainStrategies.register('news', {
  name: 'News',
  
  matches(hostname) {
    const newsHosts = [
      'cnn.com', 'bbc.com', 'bbc.co.uk', 'nytimes.com', 
      'theguardian.com', 'reuters.com', 'washingtonpost.com',
      'spiegel.de', 'zeit.de', 'faz.net', 'sueddeutsche.de',
      'tagesschau.de', 'welt.de', 'focus.de'
    ];
    return newsHosts.some(h => hostname.includes(h));
  },

  getContentSelectors() {
    return [
      'article',
      '[itemprop="articleBody"]',
      '.article-body',
      '.story-body',
      '.post-content',
      '.entry-content'
    ];
  },

  getExcludeSelectors() {
    return [
      'script', 'style', 'noscript', 'svg',
      'nav', 'header', 'footer', 'aside',
      '.ad', '.advertisement', '.social-share',
      '.related-articles', '.recommended',
      '.author-bio', '.comments-section'
    ];
  },

  preprocessText(text) {
    return text;
  },

  postprocessTranslation(translated, original) {
    return translated;
  },

  getMainContentSelector() {
    return 'article, [itemprop="articleBody"]';
  }
});

// === E-Book Reader Strategie ===
// Für EPUB-Reader wie books.mac, calibre-web, etc.
DomainStrategies.register('ebook', {
  name: 'E-Book Reader',
  
  // Domains die als E-Book-Reader erkannt werden
  ebookDomains: ['books.mac', 'reader.local', 'calibre.local'],
  
  matches(hostname) {
    const matched = this.ebookDomains.some(d => hostname === d || hostname.endsWith('.' + d));
    console.log('[SWT E-Book] matches check:', hostname, 'gegen', this.ebookDomains, '→', matched);
    return matched;
  },

  // E-Book-Reader nutzen oft iframes für Content
  usesIframeContent: true,

  getContentSelectors() {
    return [
      // EPUB.js iframe content
      'iframe[id^="epubjs-view"]',
      '.epub-container',
      '.epub-view',
      // Calibre-Web
      '.book-content',
      '.reader-content',
      // Generisch
      'article',
      '.chapter',
      '[epub\\:type="bodymatter"]',
      '[epub\\:type="chapter"]'
    ];
  },

  getExcludeSelectors() {
    return [
      'script', 'style', 'noscript', 'svg',
      'nav', 'header', 'footer',
      '.toc', '.table-of-contents',
      '.footnote', '.endnote',
      '.page-number', '.running-header',
      '[epub\\:type="pagebreak"]'
    ];
  },

  preprocessText(text) {
    return text
      .replace(/\[\d+\]/g, '') // Fußnoten-Referenzen
      .replace(/\s+/g, ' ')
      .trim();
  },

  postprocessTranslation(translated, original) {
    return translated;
  },

  getMainContentSelector() {
    return 'body, .chapter, article';
  },

  /**
   * Generiert einen einzigartigen Cache-Key für E-Book-Seiten
   * Nutzt den Spine-Pfad (Teil vor !) für Kapitel-Identifikation
   * 
   * epubcfi-Struktur: epubcfi(/6/14!/4/2/2[chapter001]/32/3:274)
   *                          └────┘└─────────────────────────┘
   *                          Spine  Position (ignorieren)
   *                          =Kapitel
   */
  generateCacheKey(url) {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;
      const pathname = urlObj.pathname;
      const hash = urlObj.hash;
      
      // Für E-Books: Nur den Spine-Pfad (vor !) verwenden
      // Das ist die Kapitel-Identifikation!
      if (hash && hash.includes('epubcfi')) {
        // epubcfi(/6/14!/...) → /6/14
        const match = hash.match(/epubcfi\(([^!]+)!/);
        if (match) {
          const spinePath = match[1]; // z.B. "/6/14"
          console.log('[SWT E-Book] Cache-Key Spine-Pfad (Kapitel):', spinePath);
          return hostname + pathname + '_epubcfi(' + spinePath + ')';
        }
        
        // Fallback wenn kein ! gefunden (ungewöhnlich)
        console.log('[SWT E-Book] Kein ! in epubcfi gefunden, verwende komplett');
        return hostname + pathname + '_' + hash.replace('#', '');
      }
      
      // Fallback: Standard-Key
      return hostname + pathname + (hash || '');
    } catch (e) {
      return url;
    }
  },

  /**
   * Extrahiert Text aus E-Book iframes
   * WICHTIG: contentDocument (echtes DOM) wird bevorzugt, srcdoc nur als Fallback
   */
  extractIframeContent(doc = document) {
    console.log('[SWT E-Book] === extractIframeContent Start ===');
    
    // Alle iframes auf der Seite finden (Debug)
    const allIframes = doc.querySelectorAll('iframe');
    console.log('[SWT E-Book] Alle iframes auf der Seite:', allIframes.length);
    allIframes.forEach((f, i) => {
      console.log(`[SWT E-Book] iframe[${i}]:`, {
        id: f.id,
        hasSrcdoc: f.hasAttribute('srcdoc'),
        sandbox: f.getAttribute('sandbox'),
        src: f.src?.substring(0, 50)
      });
    });
    
    // Passende iframes mit srcdoc oder epubjs-view ID
    const iframes = doc.querySelectorAll('iframe[id^="epubjs-view"], iframe[srcdoc]');
    console.log('[SWT E-Book] Passende iframes (epubjs/srcdoc):', iframes.length);
    
    const contents = [];
    
    iframes.forEach((iframe, idx) => {
      console.log(`[SWT E-Book] === Prüfe iframe ${idx}: ${iframe.id || '(no id)'} ===`);
      
      // Prüfe contentDocument Zugriff
      try {
        console.log('[SWT E-Book] Versuche contentDocument Zugriff...');
        const contentDoc = iframe.contentDocument;
        
        if (contentDoc) {
          console.log('[SWT E-Book] contentDocument existiert');
          const body = contentDoc.body;
          
          if (body) {
            const pTags = body.querySelectorAll('p');
            const allText = body.textContent?.substring(0, 200);
            console.log('[SWT E-Book] ✓ contentDocument.body verfügbar');
            console.log('[SWT E-Book] p-Tags:', pTags.length);
            console.log('[SWT E-Book] Body-Text (Auszug):', allText);
            
            if (pTags.length > 0 || body.textContent?.trim().length > 10) {
              contents.push({
                type: 'contentDocument',
                iframe: iframe,
                document: contentDoc,
                body: body
              });
              console.log('[SWT E-Book] ✓ contentDocument hinzugefügt');
              return; // Erfolgreich - nicht auch srcdoc parsen
            } else {
              console.log('[SWT E-Book] contentDocument leer - versuche srcdoc');
            }
          } else {
            console.log('[SWT E-Book] contentDocument.body ist null');
          }
        } else {
          console.log('[SWT E-Book] contentDocument ist null');
        }
      } catch (e) {
        console.log('[SWT E-Book] contentDocument Fehler:', e.name, e.message);
      }
      
      // FALLBACK: srcdoc parsen
      const srcdoc = iframe.getAttribute('srcdoc');
      if (srcdoc) {
        console.log('[SWT E-Book] Fallback: Parse srcdoc, Länge:', srcdoc.length);
        try {
          const parser = new DOMParser();
          const iframeDoc = parser.parseFromString(srcdoc, 'text/html');
          
          const body = iframeDoc.body;
          if (body) {
            const pTags = body.querySelectorAll('p');
            console.log('[SWT E-Book] srcdoc geparst, p-Tags:', pTags.length);
            
            if (pTags.length > 0) {
              console.log('[SWT E-Book] Erster p-Tag:', pTags[0].textContent?.substring(0, 80));
            }
            
            contents.push({
              type: 'srcdoc-parsed',
              iframe: iframe,
              document: iframeDoc,
              body: body,
              warning: 'Änderungen an geparstem srcdoc sind NICHT sichtbar im iframe!'
            });
            console.log('[SWT E-Book] ⚠ srcdoc-parsed hinzugefügt (read-only!)');
          }
        } catch (e) {
          console.warn('[SWT E-Book] srcdoc Parse-Fehler:', e);
        }
      } else {
        console.log('[SWT E-Book] Kein srcdoc-Attribut');
      }
    });
    
    console.log('[SWT E-Book] === extractIframeContent Ende:', contents.length, 'Dokumente ===');
    return contents;
  },

  /**
   * Findet übersetzbare Texte in E-Book-Inhalten
   * Berücksichtigt iframe-basierte Reader
   */
  findTranslatableElements(doc = document) {
    const elements = [];
    
    // 1. Normale DOM-Elemente
    this.getContentSelectors().forEach(sel => {
      if (!sel.includes('iframe')) {
        doc.querySelectorAll(sel).forEach(el => {
          if (!this.getExcludeSelectors().some(exc => el.matches(exc))) {
            elements.push({ type: 'element', element: el, source: 'dom' });
          }
        });
      }
    });
    
    // 2. Iframe-Inhalte
    const iframeContents = this.extractIframeContent(doc);
    iframeContents.forEach(content => {
      const body = content.body;
      if (body) {
        // Alle Paragraph-Elemente im iframe
        body.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, td, th, figcaption, blockquote').forEach(el => {
          const text = el.textContent?.trim();
          if (text && text.length >= 3) {
            elements.push({
              type: 'iframe-element',
              element: el,
              source: content.type,
              iframeDocument: content.document
            });
          }
        });
      }
    });
    
    return elements;
  }
});

// === Generische Konfigurierbare Strategie für lokale Reader ===
// Erlaubt Benutzern eigene Domains hinzuzufügen
DomainStrategies.register('customReader', {
  name: 'Custom Reader',
  
  // Wird aus den Einstellungen geladen
  customDomains: [],
  
  matches(hostname) {
    // Prüft gegen benutzerdefinierte Domains
    return this.customDomains.some(d => hostname === d || hostname.endsWith('.' + d));
  },
  
  // Nutzt E-Book-Strategie als Basis
  getContentSelectors() {
    return DomainStrategies.strategies.ebook.getContentSelectors();
  },
  
  getExcludeSelectors() {
    return DomainStrategies.strategies.ebook.getExcludeSelectors();
  },
  
  // Kann Hash für Cache-Key nutzen
  useHashForCacheKey: true,
  
  generateCacheKey(url) {
    if (this.useHashForCacheKey) {
      return DomainStrategies.strategies.ebook.generateCacheKey(url);
    }
    return DomainStrategies.strategies.default.generateCacheKey?.(url) || url;
  }
});

// === Plain-Text Strategie ===
// Für .txt Dateien und reine Text-Anzeigen im Browser
DomainStrategies.register('plaintext', {
  name: 'Plain Text',
  
  // Wird nicht über hostname aktiviert, sondern über shouldActivate()
  matches(hostname) {
    return false;
  },
  
  /**
   * Prüft ob Plain-Text-Modus aktiviert werden soll
   * - URL endet mit .txt
   * - Body enthält nur ein <pre> Element
   */
  shouldActivate() {
    const url = window.location.href;
    
    // URL-basierte Erkennung
    if (url.match(/\.txt(\?|#|$)/i)) {
      console.log('[SWT PlainText] Erkannt via URL:', url);
      return true;
    }
    
    // DOM-basierte Erkennung: nur ein <pre> im Body
    const body = document.body;
    if (body && body.children.length === 1 && body.children[0].tagName === 'PRE') {
      console.log('[SWT PlainText] Erkannt via DOM: einzelnes <pre>');
      return true;
    }
    
    return false;
  },
  
  getContentSelectors() {
    return ['pre'];
  },
  
  getExcludeSelectors() {
    return ['script', 'style'];
  },
  
  /**
   * Plain-Text in logische Absätze aufteilen
   * Regel: Satzende (. ! ?) + Zeilenumbruch = Absatzgrenze
   * Oder: Doppelte Newlines (Leerzeile)
   */
  splitIntoChunks(text) {
    const chunks = [];
    
    // Absätze bei: Satzzeichen + Newline(s) ODER Doppelte Newlines
    const lines = text.split(/\n/);
    let currentChunk = '';
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();
      
      // Leerzeile = Absatzende
      if (trimmedLine === '') {
        if (currentChunk.trim()) {
          chunks.push(currentChunk.trim());
          currentChunk = '';
        }
        continue;
      }
      
      // Zeile hinzufügen
      if (currentChunk) {
        currentChunk += '\n';
      }
      currentChunk += line;
      
      // Satzende prüfen
      if (trimmedLine.match(/[.!?]$/)) {
        // Prüfe ob nächste Zeile leer oder neue Überschrift
        const nextLine = lines[i + 1];
        if (!nextLine || nextLine.trim() === '' || nextLine.trim().match(/^[A-ZÄÖÜ0-9]/)) {
          if (currentChunk.trim()) {
            chunks.push(currentChunk.trim());
            currentChunk = '';
          }
        }
      }
    }
    
    // Rest
    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }
    
    console.log('[SWT PlainText] Text aufgeteilt in', chunks.length, 'Chunks');
    return chunks;
  },
  
  /**
   * Findet übersetzbare Elemente in Plain-Text
   * Gibt Pseudo-Nodes zurück für die Chunks
   */
  findTranslatableElements() {
    const preElement = document.querySelector('pre');
    if (!preElement) return [];
    
    const text = preElement.textContent || '';
    const chunks = this.splitIntoChunks(text);
    
    // Pseudo-Nodes erstellen
    return chunks.map((chunk, index) => ({
      type: 'plaintext-chunk',
      text: chunk,
      index: index,
      preElement: preElement
    }));
  },
  
  preprocessText(text) {
    return text;
  },
  
  postprocessTranslation(translated, original) {
    return translated;
  }
});

// Export für Content Script
if (typeof window !== 'undefined') {
  window.DomainStrategies = DomainStrategies;
}

console.log('[SWT DomainStrategies] Modul komplett geladen. Registrierte Strategien:', Object.keys(DomainStrategies.strategies));
console.log('[SWT DomainStrategies] E-Book Domains:', DomainStrategies.strategies.ebook?.ebookDomains);
