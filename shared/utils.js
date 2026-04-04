// Shared Utilities
// Gemeinsame Hilfsfunktionen für alle Komponenten

window.SWT = window.SWT || {};

window.SWT.Utils = {
  /**
   * Formatiert Bytes in lesbares Format (B, KB, MB)
   * @param {number} bytes - Anzahl Bytes
   * @returns {string} Formatierte Größe
   */
  formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  },

  /**
   * Formatiert Timestamp in relative Zeit (deutsch)
   * @param {number} timestamp - Unix Timestamp
   * @returns {string} Relative Zeit oder Datum
   */
  formatDate(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;

    if (diff < 60000) return 'Gerade eben';
    if (diff < 3600000) return `vor ${Math.floor(diff / 60000)} Min.`;
    if (diff < 86400000) return `vor ${Math.floor(diff / 3600000)} Std.`;
    return date.toLocaleDateString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' });
  },

  /**
   * Escaped HTML Zeichen für sichere Ausgabe
   * @param {string} text - Rohtext
   * @returns {string} Escaped HTML
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  /**
   * Escaped Attribut-Zeichen (Anführungszeichen)
   * @param {string} text - Rohtext
   * @returns {string} Escaped für Attribute
   */
  escapeAttr(text) {
    return text.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  },

  /**
   * Konvertiert Sprachkürzel in BCP 47 Language Tag für TTS
   * @param {string} lang - Sprachkürzel (de, en, fr, ...)
   * @returns {string} BCP 47 Tag (de-DE, en-US, ...)
   */
  /**
   * Sprachkürzel in lesbaren Namen
   */
  getLangName(code) {
    const names = {
      'auto': 'Auto', 'de': 'Deutsch', 'en': 'Englisch', 'fr': 'Französisch',
      'es': 'Spanisch', 'it': 'Italienisch', 'pt': 'Portugiesisch',
      'nl': 'Niederländisch', 'pl': 'Polnisch', 'ru': 'Russisch',
      'zh': 'Chinesisch', 'ja': 'Japanisch', 'ko': 'Koreanisch',
      'ar': 'Arabisch', 'tr': 'Türkisch', 'uk': 'Ukrainisch',
      'cs': 'Tschechisch', 'sv': 'Schwedisch', 'da': 'Dänisch',
      'fi': 'Finnisch', 'hi': 'Hindi'
    };
    return names[code] || code;
  },

  getLangCode(lang) {
    const codes = {
      'de': 'de-DE',
      'en': 'en-US',
      'fr': 'fr-FR',
      'es': 'es-ES',
      'it': 'it-IT',
      'pt': 'pt-PT',
      'ru': 'ru-RU',
      'zh': 'zh-CN',
      'ja': 'ja-JP',
      'ko': 'ko-KR',
      'nl': 'nl-NL',
      'pl': 'pl-PL',
      'tr': 'tr-TR',
      'ar': 'ar-SA'
    };
    return codes[lang] || 'en-US';
  }
};
