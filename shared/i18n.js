// Internationalisierung: Ersetzt data-i18n Attribute mit chrome.i18n.getMessage()
document.addEventListener('DOMContentLoaded', () => {
  document.documentElement.lang = chrome.i18n.getUILanguage().split('-')[0];

  document.querySelectorAll('[data-i18n]').forEach(el => {
    const msg = chrome.i18n.getMessage(el.dataset.i18n);
    if (msg) el.textContent = msg;
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const msg = chrome.i18n.getMessage(el.dataset.i18nPlaceholder);
    if (msg) el.placeholder = msg;
  });
});
