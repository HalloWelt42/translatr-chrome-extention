// Shared Toast - Smart Web Translator v3.7.0
// Einheitliche Toast-Benachrichtigungen für alle Komponenten
// Benötigt: components.css mit .toast Klassen

window.SMT = window.SMT || {};

window.SMT.Toast = {
  /**
   * Zeigt eine Toast-Benachrichtigung
   * @param {string} message - Nachricht
   * @param {string} type - 'success' | 'error' | 'info'
   * @param {number} duration - Anzeigedauer in ms (Standard: 2500)
   */
  show(message, type = 'success', duration = 2500) {
    // Existierende Toasts entfernen
    document.querySelectorAll('.toast').forEach(t => t.remove());

    const toast = document.createElement('div');
    toast.className = 'toast';
    
    // Typ-Klasse hinzufügen
    if (type === 'error') {
      toast.classList.add('toast-error');
    } else if (type === 'info') {
      toast.classList.add('toast-info');
    }
    
    toast.textContent = message;
    document.body.appendChild(toast);
    
    // Nach duration ausblenden
    setTimeout(() => {
      toast.classList.add('toast-hide');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }
};
