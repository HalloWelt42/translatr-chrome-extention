/**
 * Lädt Skripte des Service Workers wie importScripts in einen gemeinsamen Kontext,
 * damit Tests den echten Anbieter-Code prüfen statt einer Kopie.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

const PROVIDER_SCRIPTS = [
  'shared/providers.js',
  'background/prompts.js',
  'background/providers/chat-provider.js',
  'background/providers/lm-studio.js',
  'background/providers/leitstelle.js'
];

/**
 * @param {object} globals chrome, fetch und was der Code sonst aus der Umgebung braucht
 * @returns {(expression: string) => any} wertet einen Ausdruck im Kontext aus
 */
function loadBackground(globals, scripts = PROVIDER_SCRIPTS) {
  const context = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    AbortController,
    AbortSignal,
    DOMException,
    URL,
    ...globals
  });
  for (const file of scripts) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf-8'), context, { filename: file });
  }
  return (expression) => vm.runInContext(expression, context);
}

/** i18n-Ersatz: Schlüssel und Einsetzungen, damit Tests die Meldung erkennen */
function i18nMock() {
  return {
    getMessage: (key, subs) => (subs === undefined ? key : [key, ...[].concat(subs)].join('|'))
  };
}

module.exports = { loadBackground, i18nMock, PROVIDER_SCRIPTS };
