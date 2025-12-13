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
