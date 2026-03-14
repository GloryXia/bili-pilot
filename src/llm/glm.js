import { createLLMBase } from './base.js';
import { normalizeCategory } from '../core/helpers.js';
import { buildBatchPrompt, buildSinglePrompt, parseLLMResponse } from './prompts/follow-classify.js';

export function createGlmClassifier(config, defaultCategories) {
  const llm = createLLMBase({
    baseUrl: config.zhipuBaseUrl,
    apiKey: config.zhipuApiKey,
    label: 'GLM',
    maxRetries: config.maxRetries,
    retryBaseDelayMs: config.retryBaseDelayMs
  });

  return {
    async classify(payload, dynamicCategories = defaultCategories) {
      const system = buildSinglePrompt(dynamicCategories);

      const body = {
        model: config.zhipuModel,
        temperature: 0.1,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: JSON.stringify(payload, null, 2) }
        ]
      };

      const raw = await llm.chat(body, 120000);
      return normalizeCategory(raw || '其他', dynamicCategories);
    },

    async classifyBatch(payloads, dynamicCategories = defaultCategories) {
      if (!payloads || payloads.length === 0) return {};

      const system = buildBatchPrompt(dynamicCategories);

      const body = {
        model: config.zhipuModel,
        temperature: 0.1,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: JSON.stringify(payloads, null, 2) }
        ]
      };

      let raw = await llm.chat(body, 120000) || '{}';

      let parsed = {};
      try {
        parsed = parseLLMResponse(raw);
      } catch (e) {
        console.warn('[GLM]', e.message);
        return {};
      }

      const result = {};
      for (const [id, value] of Object.entries(parsed)) {
        result[id] = normalizeCategory(value, dynamicCategories);
      }
      return result;
    }
  };
}
