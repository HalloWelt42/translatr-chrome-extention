/**
 * Rauchtest gegen die echte Leitstelle: ein Satz Englisch nach Deutsch über den echten Anbieter-Code.
 *
 *   node tests/smoke/leitstelle-rauchtest.js [adresse] [modell]
 *
 * Schlüssel aus ~/.config/uebersetzer/leitstelle-schluessel (oder LEITSTELLE_SCHLUESSEL_DATEI).
 * Der Schlüssel wird nie ausgegeben. Ohne Modell wählt die Leitstelle über die Kette der Anwendung;
 * ist keine Kette eingerichtet, versucht der Test es zusätzlich mit dem angegebenen Modell.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadBackground, i18nMock } = require('../load-background');

const KEY_FILE = process.env.LEITSTELLE_SCHLUESSEL_DATEI
  || path.join(os.homedir(), '.config', 'uebersetzer', 'leitstelle-schluessel');
const ADDRESS = process.argv[2] || 'http://192.168.178.49:8530';
const FALLBACK_MODEL = process.argv[3] || 'qwen/qwen3-next-80b';
const SENTENCE = 'The weather is lovely today, so we are going for a walk in the park.';

function chromeWithKey(key) {
  const local = { leitstelleKey: key };
  return {
    i18n: i18nMock(),
    storage: { local: { get: async (name) => ({ [name]: local[name] }) } }
  };
}

async function main() {
  const key = fs.readFileSync(KEY_FILE, 'utf-8').trim();
  const run = loadBackground({ chrome: chromeWithKey(key), fetch });
  const transport = run('LeitstelleTransport');
  const provider = run('LeitstelleProvider');
  transport.onWait = (state) => state && console.log('Wartet:', state.text);

  const check = await transport.testConnection({ leitstelleUrl: ADDRESS });
  console.log('Verbindung prüfen:', check.success ? `ok, ${check.models.length} Modelle erlaubt` : check.error);
  if (!check.success) process.exit(1);

  const settings = { apiType: 'leitstelle', leitstelleUrl: ADDRESS, leitstelleModel: '' };
  const started = Date.now();
  let result = await provider.translate(SENTENCE, 'en', 'de', settings);
  if (!result.success && result.error === 'errLeitstelleNoChain') {
    console.log('Keine Kette für Text eingerichtet; zweiter Versuch mit Modell', FALLBACK_MODEL);
    result = await provider.translate(SENTENCE, 'en', 'de', { ...settings, leitstelleModel: FALLBACK_MODEL });
  }

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (!result.success) {
    console.log(`Fehler nach ${seconds} s:`, result.error);
    process.exit(1);
  }
  console.log('Englisch:', SENTENCE);
  console.log('Deutsch: ', result.translatedText);
  console.log(`Dauer ${seconds} s, ${result.tokens} Token`);
}

main().catch((e) => {
  console.error('Rauchtest abgebrochen:', e.message);
  process.exit(1);
});
