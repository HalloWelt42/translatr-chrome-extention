// Internationalisierung: Ersetzt data-i18n Attribute mit chrome.i18n.getMessage()
document.addEventListener('DOMContentLoaded', () => {
  document.documentElement.lang = chrome.i18n.getUILanguage().split('-')[0];

  document.querySelectorAll('[data-i18n]').forEach(el => {
    const msg = chrome.i18n.getMessage(el.dataset.i18n);
    if (msg) el.textContent = msg;
  });

  // HTML-Inhalt (fuer Elemente mit Inline-Markup wie <code>)
  document.querySelectorAll('[data-i18n-html]').forEach(el => {
    const msg = chrome.i18n.getMessage(el.dataset.i18nHtml);
    if (msg) el.innerHTML = msg;
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const msg = chrome.i18n.getMessage(el.dataset.i18nPlaceholder);
    if (msg) el.placeholder = msg;
  });
});
