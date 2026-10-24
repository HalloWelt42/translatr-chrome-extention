/**
 * Smart Translator - LibreTranslate Provider
 * Kapselt die Kommunikation mit LibreTranslate API.
 */

const LibreTranslateProvider = {
  /**
   * Übersetzt einen Text via LibreTranslate
   * @returns {{ success, translatedText, alternatives, detectedLanguage, apiType, tokens }}
   */
  async translate(text, source, target, settings) {
    try {
      const serviceUrl = settings.serviceUrl.replace(/\/translate\/?$/, '') + '/translate';

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
  }
};
