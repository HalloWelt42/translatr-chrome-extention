/**
 * Smart Translator - LM Studio Provider
 * Kapselt die Kommunikation mit LM Studio (OpenAI-kompatible API).
 */


const LMStudioProvider = {
  /**
   * Übersetzt einen einzelnen Text
   * @returns {{ success, translatedText, alternatives, contextNotes, apiType, tokens, usage }}
   */
  async translate(text, source, target, settings, updateTokenStats) {
    try {
      const url = settings.lmStudioUrl;
      const model = settings.lmStudioModel;

      if (!model) {
        return { success: false, error: 'Kein LM Studio Modell ausgewaehlt' };
      }

      const systemPrompt = this.buildSystemPrompt(settings, source, target);

      const response = await fetch(`${url}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: text }
          ],
          temperature: settings.lmStudioTemperature || 0.1,
          max_tokens: settings.lmStudioMaxTokens || 16000,
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'translation',
              strict: true,
              schema: {
                type: 'object',
                properties: {
                  translation: { type: 'string' },
                  alternatives: {
                    type: 'array',
                    items: { type: 'string' }
                  },
                  context_notes: { type: 'string' }
                },
                required: ['translation'],
                additionalProperties: false
              }
            }
          }
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const result = await response.json();

      if (!result.choices || !result.choices[0]) {
        throw new Error('Ungueltige Antwort vom LM Studio Server');
      }

      const content = result.choices[0].message.content;
      const usage = result.usage || {};
      const tokens = usage.total_tokens ||
                    (usage.prompt_tokens || 0) + (usage.completion_tokens || 0);

      if (usage.total_tokens && updateTokenStats) {
        await updateTokenStats(usage);
      }

      try {
        const parsed = JSON.parse(content);
        let translation = parsed.translation.replace(/\\n/g, '\n');

        return {
          success: true,
          translatedText: translation,
          alternatives: parsed.alternatives || [],
          contextNotes: parsed.context_notes,
          apiType: 'lmstudio',
          tokens: tokens,
          usage: usage
        };
      } catch (parseError) {
        let translation = content.trim().replace(/\\n/g, '\n');
        return {
          success: true,
          translatedText: translation,
          alternatives: [],
          apiType: 'lmstudio',
          tokens: tokens,
          usage: usage
        };
      }
    } catch (e) {
      console.warn('[LMStudio]', e.message);
      return { success: false, error: e.message };
    }
  },

  /**
   * Batch-Übersetzung für Seitenübersetzung
   * @returns {{ success, items[], tokens }}
   */
  async batchTranslate(texts, source, target, settings) {
    try {
      const url = settings.lmStudioUrl;
      const model = settings.lmStudioModel;

      if (!model) {
        return { success: false, error: 'Kein LM Studio Modell ausgewaehlt' };
      }

      const sourceLabel = source === 'auto' ? 'der Quellsprache' : this._getLanguageName(source);
      const targetLabel = this._getLanguageName(target);

      const systemPrompt = BATCH_PROMPT
        .replace(/{source}/g, sourceLabel)
        .replace(/{target}/g, targetLabel);

      const inputJson = JSON.stringify(texts);

      const response = await fetch(`${url}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: inputJson }
          ],
          temperature: settings.lmStudioTemperature || 0.1,
          max_tokens: settings.lmStudioMaxTokens || 16000,
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'batch_translation',
              strict: true,
              schema: {
                type: 'object',
                properties: {
                  items: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        original: { type: 'string' },
                        translation: { type: 'string' }
                      },
                      required: ['original', 'translation'],
                      additionalProperties: false
                    }
                  }
                },
                required: ['items'],
                additionalProperties: false
              }
            }
          }
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json();
      const content = result.choices?.[0]?.message?.content;
      const usage = result.usage || {};
      const tokens = usage.total_tokens ||
                    (usage.prompt_tokens || 0) + (usage.completion_tokens || 0);

      const parsed = JSON.parse(content);

      return {
        success: true,
        items: parsed.items || [],
        tokens: tokens,
        usage: usage
      };
    } catch (e) {
      console.warn('[LMStudio Batch]', e.message);
      return { success: false, error: e.message, items: [] };
    }
  },

  /**
   * Testet die Verbindung und laedt Modell-Liste
   * @returns {{ success, models[], error? }}
   */
  async testConnection(url) {
    try {
      const response = await fetch(`${url}/v1/models`, {
        signal: AbortSignal.timeout(5000)
      });
      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}` };
      }
      const data = await response.json();
      const models = (data.data || []).map(m => m.id);
      return { success: true, models };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  /**
   * Baut System-Prompt aus Kontext und Sprachen
   */
  buildSystemPrompt(settings, source, target) {
    const context = settings.lmStudioContext || 'general';
    const customPrompt = settings.lmStudioCustomPrompt;

    let prompt = context === 'custom' && customPrompt
      ? customPrompt
      : CONTEXT_PROMPTS[context] || CONTEXT_PROMPTS.general;

    const sourceLabel = source === 'auto' ? 'der Quellsprache' : this._getLanguageName(source);
    const targetLabel = this._getLanguageName(target);

    return prompt
      .replace(/{source}/g, sourceLabel)
      .replace(/{target}/g, targetLabel);
  },

  _getLanguageName(code) {
    const names = {
      'de': 'Deutsch', 'en': 'Englisch', 'fr': 'Französisch',
      'es': 'Spanisch', 'it': 'Italienisch', 'pt': 'Portugiesisch',
      'nl': 'Niederländisch', 'pl': 'Polnisch', 'ru': 'Russisch',
      'zh': 'Chinesisch', 'ja': 'Japanisch', 'ko': 'Koreanisch',
      'ar': 'Arabisch', 'tr': 'Türkisch', 'uk': 'Ukrainisch',
      'cs': 'Tschechisch', 'sv': 'Schwedisch', 'da': 'Dänisch',
      'fi': 'Finnisch', 'hi': 'Hindi'
    };
    return names[code] || code;
  }
};
