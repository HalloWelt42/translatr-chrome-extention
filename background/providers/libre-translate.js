/**
 * Smart Translator - LibreTranslate Provider
 * Kapselt die Kommunikation mit LibreTranslate API.
 */

const LibreTranslateProvider = {
  /**
   * Uebersetzt einen Text via LibreTranslate
   * @returns {{ success, translatedText, alternatives, detectedLanguage, apiType, tokens }}
   */
  async translate(text, source, target, settings) {
    try {
      const serviceUrl = settings.serviceUrl || 'http://localhost:5000/translate';

      const response = await fetch(serviceUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          q: text,
          source: source,
          target: target,
          format: 'text',
          alternatives: 3,
          api_key: settings.apiKey || ''
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      return {
        success: true,
        translatedText: result.translatedText || text,
        alternatives: result.alternatives || [],
        detectedLanguage: result.detectedLanguage,
        apiType: 'libretranslate',
        tokens: 0
      };
    } catch (e) {
      console.warn('[LibreTranslate]', e.message);
      return { success: false, error: e.message };
    }
  },

  /**
   * Testet die Verbindung zum LibreTranslate-Server
   * @returns {{ success, languages?, error? }}
   */
  async testConnection(url) {
    try {
      const response = await fetch(`${url.replace(/\/translate$/, '')}/languages`, {
        signal: AbortSignal.timeout(5000)
      });
      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}` };
      }
      const languages = await response.json();
      return { success: true, languages };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
};
