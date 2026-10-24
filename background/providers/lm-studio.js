/**
 * Smart Translator - LM Studio direkt (Alternative ohne eigene Leitstelle)
 * Spricht einen Modell-Läufer mit OpenAI-kompatibler Schnittstelle direkt an.
 */

const LMStudioTransport = {
  apiType: 'lmstudio',

  configError(settings) {
    if (!settings.lmStudioUrl) return chrome.i18n.getMessage('errLmNotConfigured');
    if (!settings.lmStudioModel) return chrome.i18n.getMessage('errNoModel');
    return null;
  },

  async complete(body, settings) {
    const error = this.configError(settings);
    if (error) throw new Error(error);

    const response = await fetch(`${settings.lmStudioUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: settings.lmStudioModel, ...body })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }
    return response.json();
  }
};

const LMStudioProvider = createChatProvider(LMStudioTransport);
