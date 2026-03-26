// API Badge
// Einheitliche API-Badge Aktualisierung für Popup und Sidepanel

window.SWT = window.SWT || {};

window.SWT.ApiBadge = {
  /**
   * Aktualisiert das API-Badge (LLM/Libre)
   * @param {string} apiType - 'lmstudio' oder 'libretranslate'
   */
  update(apiType) {
    const badge = document.getElementById('apiBadge');
    const badgeText = document.getElementById('apiBadgeText');
    
    if (!badge || !badgeText) return;
    
    if (apiType === 'lmstudio') {
      badge.classList.add('lmstudio');
      badgeText.textContent = 'LLM';
    } else {
      badge.classList.remove('lmstudio');
      badgeText.textContent = 'Libre';
    }
  }
};
