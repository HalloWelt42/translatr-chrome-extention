// Guide Page - Smart Web Translator

// Version anzeigen
const v = document.getElementById('appVersion');
if (v) v.textContent = chrome.runtime.getManifest().version;

// Einstellungen-Links
document.querySelectorAll('.open-options').forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
});
