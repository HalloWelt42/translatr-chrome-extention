/**
 * Smart Translator - Leitstelle (Vorgabe)
 *
 * Die eigene Leitstelle vermittelt zu den Sprachmodellen über ihre Fassade im OpenAI-Format:
 * - Adresse: Basis der Leitstelle (mit oder ohne /v1), Kopf Authorization: Bearer <Schlüssel>
 * - Modell: leer, dann wählt die Leitstelle über die Kette der Anwendung; sonst ein erlaubtes Modell
 * - Der Schlüssel liegt nur in chrome.storage.local (nie in sync, nie in Meldungen)
 * - 429 und 503 (ausgelastet, Halt, Rechner schläft, Dienst weg) sind kein Fehler: geduldig nach
 *   Retry-After erneut versuchen und den Wartestand melden, bis die Leitstelle antwortet oder
 *   jemand abbricht. Eine Lese-Zeitgrenze gibt es bewusst nicht: wartende Aufträge hält die
 *   Leitstelle selbst offen.
 */

const LeitstelleTransport = {
  apiType: 'leitstelle',
  KEY_STORAGE: 'leitstelleKey',
  TITLE: 'Übersetzung im Browser',
  CONNECT_TIMEOUT_MS: 10000,
  RETRY_DEFAULT_S: 30,
  RETRY_SLEEPING_S: 60,
  // Höchstens so lange am Stück schlafen: jede Meldung hält den Service Worker wach
  TICK_S: 20,

  /** Wird vom Service Worker gesetzt: (wartestand | null) => void */
  onWait: () => {},

  _abort: new AbortController(),
  _waiting: 0,

  sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(new DOMException('abgebrochen', 'AbortError'));
      const timer = setTimeout(resolve, ms);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new DOMException('abgebrochen', 'AbortError'));
      }, { once: true });
    });
  },

  /** Basisadresse ohne /v1 und ohne Endpunkt, egal wie sie eingetragen wurde */
  baseUrl(url) {
    return (url || '').trim()
      .replace(/\/+$/, '')
      .replace(/\/v1(\/chat\/completions|\/models)?$/, '')
      .replace(/\/+$/, '');
  },

  async key() {
    const stored = await chrome.storage.local.get(this.KEY_STORAGE);
    return (stored[this.KEY_STORAGE] || '').trim();
  },

  headers(key) {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
      'X-Leitstelle-Titel': encodeURIComponent(this.TITLE)
    };
  },

  configError(settings) {
    return this.baseUrl(settings.leitstelleUrl) ? null : chrome.i18n.getMessage('errLeitstelleNoUrl');
  },

  /** Bricht alle laufenden und wartenden Anfragen ab (Stopp der Seitenübersetzung) */
  cancel() {
    this._abort.abort();
    this._abort = new AbortController();
  },

  async complete(body, settings) {
    const configError = this.configError(settings);
    if (configError) throw this.fatal(configError);
    const key = await this.key();
    if (!key) throw this.fatal(chrome.i18n.getMessage('errLeitstelleNoKey'));

    const base = this.baseUrl(settings.leitstelleUrl);
    const model = (settings.leitstelleModel || '').trim();
    const payload = JSON.stringify(model ? { model, ...body } : body);
    const signal = this._abort.signal;
    let waited = false;

    try {
      for (;;) {
        let response;
        try {
          response = await fetch(`${base}/v1/chat/completions`, {
            method: 'POST', headers: this.headers(key), body: payload, signal
          });
        } catch (e) {
          if (signal.aborted) throw this.fatal(chrome.i18n.getMessage('errLeitstelleCancelled'));
          throw this.fatal(chrome.i18n.getMessage('errLeitstelleUnreachable', [base]));
        }

        if (response.ok) return await response.json();

        const error = await this.readError(response);
        const wait = this.waitInfo(response, error);
        if (!wait) throw this.toError(response.status, error);

        waited = true;
        await this.waitAndReport(wait, signal);
      }
    } finally {
      if (waited) this.endWaiting();
    }
  },

  async readError(response) {
    try {
      const data = await response.json();
      return data.error || {};
    } catch (e) {
      return {};
    }
  },

  /** Wartegrund bei 429/503, sonst null */
  waitInfo(response, error) {
    if (response.status !== 429 && response.status !== 503) return null;
    const code = error.code || '';
    const fallback = code === 'rechner_schlaeft' ? this.RETRY_SLEEPING_S : this.RETRY_DEFAULT_S;
    const seconds = this.retryAfter(response.headers.get('Retry-After')) ?? fallback;
    const machines = (error['x-leitstelle']?.rechner || []).join(', ');
    return { code, seconds, machines, status: response.status };
  },

  /** Retry-After in Sekunden (Zahl oder HTTP-Datum), mindestens 1 */
  retryAfter(header) {
    if (!header) return null;
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.max(1, Math.ceil(seconds));
    const date = Date.parse(header);
    if (Number.isNaN(date)) return null;
    return Math.max(1, Math.ceil((date - Date.now()) / 1000));
  },

  waitText(wait, remaining) {
    const s = String(remaining);
    if (wait.code === 'rechner_schlaeft') {
      return chrome.i18n.getMessage('waitLeitstelleSleeping',
        [wait.machines || chrome.i18n.getMessage('waitLeitstelleMachine'), s]);
    }
    if (wait.code === 'halt') return chrome.i18n.getMessage('waitLeitstelleHalt', [s]);
    if (wait.status === 429) return chrome.i18n.getMessage('waitLeitstelleBusy', [s]);
    return chrome.i18n.getMessage('waitLeitstelleUnavailable', [s]);
  },

  async waitAndReport(wait, signal) {
    this._waiting++;
    try {
      let remaining = wait.seconds;
      while (remaining > 0) {
        this.onWait({ code: wait.code, text: this.waitText(wait, remaining), seconds: remaining });
        const step = Math.min(this.TICK_S, remaining);
        await this.sleep(step * 1000, signal);
        remaining -= step;
      }
    } catch (e) {
      throw this.fatal(chrome.i18n.getMessage('errLeitstelleCancelled'));
    } finally {
      this._waiting--;
    }
  },

  endWaiting() {
    if (this._waiting === 0) this.onWait(null);
  },

  toError(status, error) {
    if (status === 401) return this.fatal(chrome.i18n.getMessage('errLeitstelleKey'));
    if (status === 403) return this.fatal(chrome.i18n.getMessage('errLeitstelleForbidden', [error.message || '']));
    if (status === 404 && error.code === 'kein_modell') return this.fatal(chrome.i18n.getMessage('errLeitstelleNoChain'));
    return new Error(chrome.i18n.getMessage('errLeitstelleFailed', [String(status), error.message || '']));
  },

  /** Fehler, bei dem weitere Versuche mit anderen Texten nichts ändern (Schlüssel, Rechte, Abbruch) */
  fatal(message) {
    const error = new Error(message);
    error.fatal = true;
    return error;
  },

  /**
   * Verbindung prüfen: GET /v1/models mit Schlüssel, lädt kein Modell
   * @returns {{ success, models?, error? }}
   */
  async testConnection(settings) {
    const configError = this.configError(settings);
    if (configError) return { success: false, error: configError };
    const key = await this.key();
    if (!key) return { success: false, error: chrome.i18n.getMessage('errLeitstelleNoKey') };

    const base = this.baseUrl(settings.leitstelleUrl);
    try {
      const response = await fetch(`${base}/v1/models`, {
        headers: this.headers(key),
        signal: AbortSignal.timeout(this.CONNECT_TIMEOUT_MS)
      });
      if (!response.ok) {
        return { success: false, error: this.toError(response.status, await this.readError(response)).message };
      }
      const data = await response.json();
      return { success: true, models: (data.data || []).map(m => m.id) };
    } catch (e) {
      return { success: false, error: chrome.i18n.getMessage('errLeitstelleUnreachable', [base]) };
    }
  }
};

const LeitstelleProvider = createChatProvider(LeitstelleTransport);
