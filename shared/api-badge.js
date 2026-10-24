// API Badge
// Einheitliche API-Badge Aktualisierung für Popup und Sidepanel

window.SWT = window.SWT || {};

window.SWT.ApiBadge = {
  /**
   * Aktualisiert das API-Badge (LLM/Libre)
   * @param {string} apiType - 'leitstelle', 'lmstudio' oder 'libretranslate'
   */
  update(apiType) {
    apiType = SWT.Providers.current(apiType);
    const badge = document.getElementById('apiBadge');
    const badgeText = document.getElementById('apiBadgeText');

    if (!badge || !badgeText) return;

    if (SWT.Providers.isLlm(apiType)) {
      badge.classList.add('lmstudio');
      badgeText.textContent = apiType === 'leitstelle' ? SWT.Providers.label(apiType) : 'LLM';
    } else {
      badge.classList.remove('lmstudio');
      badgeText.textContent = 'Libre';
    }

    // Source zuruecksetzen bei Backend-Wechsel
    this.showSource(null);
  },

  showSource(source) {
    const el = document.getElementById('apiBadgeSource');
    if (!el) return;
    const labels = { cache: 'Cache', buffer: 'Buffer' };
    el.textContent = labels[source] || '';
    el.classList.toggle('hidden', !labels[source]);
  }
};
