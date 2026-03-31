// Content Export Module - Smart Web Translator v3.7.0
// Export-Funktionen als Prototype-Erweiterung

(function() {
  'use strict';

  // Guard gegen doppeltes Laden
  if (window.__swtExportLoaded) return;
  window.__swtExportLoaded = true;

  // Warten bis SmartTranslator definiert ist
  if (typeof SmartTranslator === 'undefined') {
    console.warn('SmartTranslator nicht gefunden - content-export.js muss nach content.js geladen werden');
    return;
  }

  /**
   * Extrahiert vereinfachten Seiteninhalt für Export
   */
  SmartTranslator.prototype.extractSimplifiedContent = function(rootElement) {
    const result = {
      title: document.title,
      content: []
    };

    // Domain-Strategie verwenden falls verfügbar
    let mainSelector = 'body';
    if (window.DomainStrategies) {
      const strategy = window.DomainStrategies.getStrategy(window.location.href);
      mainSelector = strategy.getMainContentSelector();
    }

    const mainContent = document.querySelector(mainSelector) || rootElement;
    const self = this;
    
    const processNode = (node) => {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const tag = node.tagName.toLowerCase();
        
        // Überspringen
        if (['script', 'style', 'noscript', 'nav', 'header', 'footer', 'aside', 'svg'].includes(tag)) {
          return;
        }
        if (node.closest('.swt-ui')) return;
        
        // Überschriften
        if (/^h[1-6]$/.test(tag)) {
          const level = parseInt(tag[1]);
          const text = self.fixInlineTagSpacing(node);
          if (text) {
            result.content.push({ type: 'heading', level, text });
          }
          return;
        }
        
        // Absätze
        if (tag === 'p') {
          const text = self.fixInlineTagSpacing(node);
          if (text && text.length > 10) {
            result.content.push({ type: 'paragraph', text });
          }
          return;
        }
        
        // Listen
        if (tag === 'ul' || tag === 'ol') {
          const items = Array.from(node.querySelectorAll(':scope > li'))
            .map(li => self.fixInlineTagSpacing(li))
            .filter(t => t.length > 0);
          if (items.length > 0) {
            result.content.push({ type: 'list', ordered: tag === 'ol', items });
          }
          return;
        }
        
        // Code-Blöcke
        if (tag === 'pre' || (tag === 'code' && node.parentElement?.tagName !== 'PRE')) {
          result.content.push({ type: 'code', text: node.textContent });
          return;
        }
        
        // Zitate
        if (tag === 'blockquote') {
          result.content.push({ type: 'quote', text: self.fixInlineTagSpacing(node) });
          return;
        }
        
        // Bilder
        if (tag === 'img') {
          result.content.push({ 
            type: 'image', 
            src: node.src, 
            alt: node.alt || '' 
          });
          return;
        }
        
        // Rekursiv für Container
        if (['div', 'section', 'article', 'main'].includes(tag)) {
          node.childNodes.forEach(child => processNode(child));
        }
      }
    };

    mainContent.childNodes.forEach(child => processNode(child));
    return result;
  };

  /**
   * Export als Markdown
   */
  SmartTranslator.prototype.exportAsMarkdown = function() {
    const data = this.extractSimplifiedContent(document.body);
    let md = `# ${data.title}\n\n`;
    
    data.content.forEach(item => {
      switch (item.type) {
        case 'heading':
          md += `${'#'.repeat(item.level)} ${item.text}\n\n`;
          break;
        case 'paragraph':
          md += `${item.text}\n\n`;
          break;
        case 'list':
          item.items.forEach((li, i) => {
            md += item.ordered ? `${i + 1}. ${li}\n` : `- ${li}\n`;
          });
          md += '\n';
          break;
        case 'code':
          md += `\`\`\`\n${item.text}\n\`\`\`\n\n`;
          break;
        case 'quote':
          md += `> ${item.text}\n\n`;
          break;
        case 'image':
          md += `![${item.alt}](${item.src})\n\n`;
          break;
      }
    });

    this.downloadFile(md, 'translation.md', 'text/markdown');
    this.showNotification('Markdown exportiert', 'success');
  };

  /**
   * Export als Text
   */
  SmartTranslator.prototype.exportAsText = function() {
    const data = this.extractSimplifiedContent(document.body);
    let txt = `${data.title}\n${'='.repeat(data.title.length)}\n\n`;
    
    data.content.forEach(item => {
      switch (item.type) {
        case 'heading':
          txt += `\n${item.text}\n${'-'.repeat(item.text.length)}\n\n`;
          break;
        case 'paragraph':
          txt += `${item.text}\n\n`;
          break;
        case 'list':
          item.items.forEach((li, i) => {
            txt += `  ${item.ordered ? `${i + 1}.` : '•'} ${li}\n`;
          });
          txt += '\n';
          break;
        case 'code':
          txt += `---CODE---\n${item.text}\n---/CODE---\n\n`;
          break;
        case 'quote':
          txt += `"${item.text}"\n\n`;
          break;
      }
    });

    this.downloadFile(txt, 'translation.txt', 'text/plain');
    this.showNotification('Text exportiert', 'success');
  };

  /**
   * Datei herunterladen
   */
  SmartTranslator.prototype.downloadFile = function(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

})();
