/**
 * Leitstelle-Anbieter gegen eine nachgestellte Fassade:
 * Erfolg, 429 mit Warten, 503 Rechner schläft, falscher Schlüssel, fehlende Kette, Abbruch
 */

const { createChromeMock } = require('./chrome-mock');
const { loadBackground, i18nMock } = require('./load-background');

const KEY = 'test-schluessel';

function jsonResponse(status, body, headers = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => lower[name.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

function completion(content) {
  return jsonResponse(200, {
    choices: [{ message: { content: JSON.stringify(content) } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
  });
}

function leitstelleError(status, code, message, extra = {}, headers = {}) {
  return jsonResponse(status, { error: { message, type: 'leitstelle', code, ...extra } }, headers);
}

describe('Leitstelle-Anbieter', () => {
  let chrome, fetchMock, run, transport, provider, waits, sleeps;
  const settings = {
    apiType: 'leitstelle',
    leitstelleUrl: 'http://leitstelle.test:8530/v1/chat/completions',
    leitstelleModel: ''
  };

  beforeEach(async () => {
    chrome = createChromeMock();
    chrome.i18n = i18nMock();
    await chrome.storage.local.set({ leitstelleKey: KEY });
    fetchMock = jest.fn();
    run = loadBackground({ chrome, fetch: fetchMock });
    transport = run('LeitstelleTransport');
    provider = run('LeitstelleProvider');
    waits = [];
    sleeps = [];
    transport.onWait = (state) => waits.push(state);
    transport.sleep = (ms, signal) => {
      sleeps.push(ms);
      if (signal.aborted) return Promise.reject(new Error('abgebrochen'));
      return Promise.resolve();
    };
  });

  test('Erfolg: Bearer-Schlüssel, Adresse normalisiert, ohne Modell (Kette der Leitstelle)', async () => {
    fetchMock.mockResolvedValueOnce(completion({ translation: 'Hallo Welt' }));

    const result = await provider.translate('Hello world', 'en', 'de', settings);

    expect(result).toMatchObject({ success: true, translatedText: 'Hallo Welt', apiType: 'leitstelle', tokens: 15 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://leitstelle.test:8530/v1/chat/completions');
    expect(init.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(init.headers['X-Leitstelle-Titel']).toBe('%C3%9Cbersetzung%20im%20Browser');
    const body = JSON.parse(init.body);
    expect(body.model).toBeUndefined();
    expect(body.messages[1].content).toBe('Hello world');
    expect(waits).toEqual([]);
  });

  test('Gewähltes Modell wird mitgeschickt', async () => {
    fetchMock.mockResolvedValueOnce(completion({ translation: 'Hallo' }));
    await provider.translate('Hello', 'en', 'de', { ...settings, leitstelleModel: 'qwen/qwen3-next-80b' });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe('qwen/qwen3-next-80b');
  });

  test('429: wartet nach Retry-After, meldet den Wartestand und versucht erneut', async () => {
    fetchMock
      .mockResolvedValueOnce(leitstelleError(429, 'gesperrt', 'Anwendung gesperrt', {}, { 'Retry-After': '7' }))
      .mockResolvedValueOnce(completion({ translation: 'Hallo' }));

    const result = await provider.translate('Hello', 'en', 'de', settings);

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([7000]);
    expect(waits[0].text).toBe('waitLeitstelleBusy|7');
    expect(waits[waits.length - 1]).toBeNull();
  });

  test('503 rechner_schlaeft: wartet in Schritten, nennt den Rechner, bis er wach ist', async () => {
    const asleep = () => leitstelleError(503, 'rechner_schlaeft', 'Rechner schläft',
      { 'x-leitstelle': { rechner: ['Mac Studio'] } }, { 'Retry-After': '45' });
    fetchMock
      .mockResolvedValueOnce(asleep())
      .mockResolvedValueOnce(asleep())
      .mockResolvedValueOnce(completion({ translation: 'Guten Morgen' }));

    const result = await provider.translate('Good morning', 'en', 'de', settings);

    expect(result).toMatchObject({ success: true, translatedText: 'Guten Morgen' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([20000, 20000, 5000, 20000, 20000, 5000]);
    expect(waits[0]).toMatchObject({ code: 'rechner_schlaeft', text: 'waitLeitstelleSleeping|Mac Studio|45' });
    expect(waits[1].text).toBe('waitLeitstelleSleeping|Mac Studio|25');
    expect(waits[waits.length - 1]).toBeNull();
  });

  test('503 ohne Retry-After: Vorgabe 60 s bei schlafendem Rechner', async () => {
    fetchMock
      .mockResolvedValueOnce(leitstelleError(503, 'rechner_schlaeft', 'Rechner schläft'))
      .mockResolvedValueOnce(completion({ translation: 'Ja' }));
    await provider.translate('Yes', 'en', 'de', settings);
    expect(sleeps.reduce((a, b) => a + b, 0)).toBe(60000);
    expect(waits[0].text).toBe('waitLeitstelleSleeping|waitLeitstelleMachine|60');
  });

  test('401 falscher Schlüssel: klare Meldung, kein Wiederholen', async () => {
    fetchMock.mockResolvedValue(leitstelleError(401, 'unbekannter_schluessel', 'Schlüssel fehlt oder ist unbekannt.'));

    const result = await provider.translate('Hello', 'en', 'de', settings);

    expect(result).toMatchObject({ success: false, fatal: true, error: 'errLeitstelleKey' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(waits).toEqual([]);
    expect(result.error).not.toContain(KEY);
  });

  test('404 kein_modell: Hinweis auf fehlende Kette', async () => {
    fetchMock.mockResolvedValue(leitstelleError(404, 'kein_modell', 'keine Kette'));
    const result = await provider.translate('Hello', 'en', 'de', settings);
    expect(result).toMatchObject({ success: false, fatal: true, error: 'errLeitstelleNoChain' });
  });

  test('Ohne Schlüssel: keine Anfrage, klare Meldung', async () => {
    await chrome.storage.local.remove('leitstelleKey');
    const result = await provider.translate('Hello', 'en', 'de', settings);
    expect(result).toMatchObject({ success: false, fatal: true, error: 'errLeitstelleNoKey' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('Abbrechen beendet das Warten', async () => {
    fetchMock.mockResolvedValue(leitstelleError(503, 'halt', 'Halt', {}, { 'Retry-After': '30' }));
    transport.sleep = (ms, signal) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('abgebrochen')), { once: true });
    });

    const pending = provider.translate('Hello', 'en', 'de', settings);
    await new Promise(r => setTimeout(r, 0));
    expect(waits[0].text).toBe('waitLeitstelleHalt|30');
    transport.cancel();

    const result = await pending;
    expect(result).toMatchObject({ success: false, fatal: true, error: 'errLeitstelleCancelled' });
    expect(waits[waits.length - 1]).toBeNull();
  });

  test('Verbindung prüfen: GET /v1/models mit Schlüssel', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: [{ id: 'qwen/qwen3-next-80b' }, { id: 'glm-4.7-flash-mlx' }] }));

    const result = await transport.testConnection({ leitstelleUrl: 'http://leitstelle.test:8530/' });

    expect(result).toEqual({ success: true, models: ['qwen/qwen3-next-80b', 'glm-4.7-flash-mlx'] });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://leitstelle.test:8530/v1/models');
    expect(init.method).toBeUndefined();
    expect(init.headers.Authorization).toBe(`Bearer ${KEY}`);
  });

  test('Verbindung prüfen mit falschem Schlüssel', async () => {
    fetchMock.mockResolvedValueOnce(leitstelleError(401, 'unbekannter_schluessel', 'unbekannt'));
    const result = await transport.testConnection({ leitstelleUrl: 'http://leitstelle.test:8530' });
    expect(result).toEqual({ success: false, error: 'errLeitstelleKey' });
  });

  test('Leitstelle nicht erreichbar: harter Fehler mit Adresse', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const result = await provider.translate('Hello', 'en', 'de', settings);
    expect(result).toMatchObject({ success: false, fatal: true, error: 'errLeitstelleUnreachable|http://leitstelle.test:8530' });
  });
});

describe('Übersetzungswege', () => {
  test('Leitstelle ist Vorgabe, Leitstelle und LM Studio laufen über ein Sprachmodell', () => {
    const run = loadBackground({ chrome: { ...createChromeMock(), i18n: i18nMock() }, fetch: jest.fn() });
    expect(run('SWT.Providers.current(undefined)')).toBe('leitstelle');
    expect(run('SWT.Providers.isLlm("leitstelle")')).toBe(true);
    expect(run('SWT.Providers.isLlm("lmstudio")')).toBe(true);
    expect(run('SWT.Providers.isLlm("libretranslate")')).toBe(false);
    expect(run('SWT.Providers.translatorId({ apiType: "leitstelle" })')).toBe('leitstelle:kette');
  });

  test('LM Studio direkt: ohne Modell kein Aufruf', async () => {
    const fetchMock = jest.fn();
    const run = loadBackground({ chrome: { ...createChromeMock(), i18n: i18nMock() }, fetch: fetchMock });
    const result = await run('LMStudioProvider').translate('Hello', 'en', 'de', { lmStudioUrl: 'http://lm.test:1234', lmStudioModel: '' });
    expect(result).toMatchObject({ success: false, error: 'errNoModel' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
