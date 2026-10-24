/**
 * Smart Translator - Übersetzungswege
 *
 * Eine Wahrheit für alle Teile der Erweiterung (Service Worker, Content-Skripte, Seiten):
 * - leitstelle: Vorgabe, die eigene Leitstelle vermittelt zu den Sprachmodellen
 * - lmstudio, libretranslate: Alternativen ohne eigene Leitstelle
 *
 * Wartet die Leitstelle (ausgelastet, Rechner schläft), legt der Service Worker den
 * Wartestand unter WAIT_KEY in chrome.storage.local ab; jede Oberfläche hört mit onWait zu.
 */

(function (root) {
  const SWT = root.SWT = root.SWT || {};

  SWT.Providers = {
    DEFAULT: 'leitstelle',
    LLM_TYPES: ['leitstelle', 'lmstudio'],
    WAIT_KEY: 'providerWait',
    // Änderbare Vorgabe; die Leitstelle nimmt die Basis mit oder ohne /v1
    LEITSTELLE_DEFAULT_URL: 'http://192.168.178.49:8530',

    LABEL_KEYS: {
      leitstelle: 'providerLeitstelle',
      lmstudio: 'providerLMStudio',
      libretranslate: 'providerLibre'
    },

    /** Gewählter Weg oder die Vorgabe, wenn noch keiner gespeichert ist */
    current(apiType) {
      return apiType || this.DEFAULT;
    },

    /** Läuft der Weg über ein Sprachmodell (Prompts, Fachkontexte, Sprachliste LM)? */
    isLlm(apiType) {
      return this.LLM_TYPES.includes(this.current(apiType));
    },

    label(apiType) {
      const key = this.LABEL_KEYS[this.current(apiType)];
      return (key && chrome.i18n.getMessage(key)) || this.current(apiType);
    },

    /** Kennung des Übersetzers für den Zwischenspeicher (Weg und Modell) */
    translatorId(settings) {
      const apiType = this.current(settings.apiType);
      if (apiType === 'leitstelle') return `leitstelle:${settings.leitstelleModel || 'kette'}`;
      if (apiType === 'lmstudio' && settings.lmStudioModel) return `lmstudio:${settings.lmStudioModel}`;
      return apiType;
    },

    /** Ruft callback(wartestand | null) auf, sobald der Service Worker den Wartestand ändert */
    onWait(callback) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes[this.WAIT_KEY]) {
          callback(changes[this.WAIT_KEY].newValue || null);
        }
      });
    }
  };
})(globalThis);
