/**
 * Smart Translator - Gemeinsamer Kern der Chat-Anbieter (OpenAI-Format)
 *
 * Ein Anbieter bringt nur seinen Transport mit:
 *   apiType               Kennung des Wegs
 *   configError(settings) Meldung, wenn der Weg nicht eingerichtet ist, sonst null
 *   complete(body, settings) schickt eine Vervollständigung und liefert die Antwort als Objekt
 *                         (Modell, Adresse, Köpfe und Warten sind Sache des Transports)
 * Prompts, Antwortschema und Auswertung der Antwort stehen nur hier.
 */

const TRANSLATION_RESPONSE_FORMAT = {
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
};

const BATCH_RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'translations',
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
};

const LANGUAGE_NAMES = {
  'de': 'Deutsch', 'en': 'Englisch', 'fr': 'Französisch',
  'es': 'Spanisch', 'it': 'Italienisch', 'pt': 'Portugiesisch',
  'nl': 'Niederländisch', 'pl': 'Polnisch', 'ru': 'Russisch',
  'zh': 'Chinesisch', 'ja': 'Japanisch', 'ko': 'Koreanisch',
  'ar': 'Arabisch', 'tr': 'Türkisch', 'uk': 'Ukrainisch',
  'cs': 'Tschechisch', 'sv': 'Schwedisch', 'da': 'Dänisch',
  'fi': 'Finnisch', 'hi': 'Hindi'
};

function createChatProvider(transport) {
  const tag = `[${transport.apiType}]`;

  return {
    apiType: transport.apiType,
    transport,

    configError(settings) {
      return transport.configError(settings);
    },

    complete(body, settings) {
      return transport.complete(body, settings);
    },

    /**
     * Übersetzt einen einzelnen Text
     * @returns {{ success, translatedText, alternatives, contextNotes, apiType, tokens, usage }}
     *          oder {{ success: false, error, fatal }}
     */
    async translate(text, source, target, settings, updateTokenStats) {
      try {
        const result = await transport.complete({
          messages: [
            { role: 'system', content: this.buildSystemPrompt(settings, source, target) },
            { role: 'user', content: text }
          ],
          temperature: settings.lmStudioTemperature || 0.1,
          max_tokens: settings.lmStudioMaxTokens || 16000,
          response_format: TRANSLATION_RESPONSE_FORMAT
        }, settings);

        if (!result.choices || !result.choices[0]) {
          throw new Error('Ungültige Antwort vom Server');
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
          return {
            success: true,
            translatedText: parsed.translation,
            alternatives: parsed.alternatives || [],
            contextNotes: parsed.context_notes,
            apiType: transport.apiType,
            tokens,
            usage
          };
        } catch (parseError) {
          return {
            success: true,
            translatedText: content.trim(),
            alternatives: [],
            apiType: transport.apiType,
            tokens,
            usage
          };
        }
      } catch (e) {
        console.warn(tag, e.message);
        return { success: false, error: e.message, fatal: !!e.fatal, apiType: transport.apiType };
      }
    },

    /** Körper einer Batch-Vervollständigung (Texte als JSON-Liste) */
    batchBody(systemPrompt, texts, maxTokens, settings) {
      return {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: JSON.stringify(texts) }
        ],
        temperature: settings.lmStudioTemperature || 0.1,
        max_tokens: maxTokens,
        response_format: BATCH_RESPONSE_FORMAT
      };
    },

    /**
     * Baut System-Prompt aus Kontext und Sprachen
     */
    buildSystemPrompt(settings, source, target) {
      const context = settings.lmStudioContext || 'general';
      const customPrompt = settings.lmStudioCustomPrompt;

      const prompt = context === 'custom' && customPrompt
        ? customPrompt
        : CONTEXT_PROMPTS[context] || CONTEXT_PROMPTS.general;

      return prompt
        .replace(/{source}/g, this.sourceLabel(source))
        .replace(/{target}/g, this.languageName(target));
    },

    sourceLabel(source) {
      return source === 'auto' ? 'der Quellsprache' : this.languageName(source);
    },

    languageName(code) {
      return LANGUAGE_NAMES[code] || code;
    }
  };
}
