// Shared API Badge - Smart Web Translator v3.7.0
// Einheitliche API-Badge Aktualisierung für Popup und Sidepanel

window.SMT = window.SMT || {};

window.SMT.ApiBadge = {
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
      badge.title = 'LM Studio (Lokales LLM)';
    } else {
      badge.classList.remove('lmstudio');
      badgeText.textContent = 'Libre';
      badge.title = 'LibreTranslate';
    }
  }
};
