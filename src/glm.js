import axios from 'axios';
import { normalizeCategory, sleep } from './utils.js';
import { buildBatchPrompt, buildSinglePrompt, parseLLMResponse } from './prompts.js';

export function createGlmClassifier(config, defaultCategories) {
  async function doRequest(body, timeoutMs = 120000) {
    let attempt = 0;
    const maxRetries = config.maxRetries || 3;
    const baseDelay = config.retryBaseDelayMs || 3000;

    while (true) {
      attempt++;
      try {
        const { data } = await axios.post(
          new URL('chat/completions', config.zhipuBaseUrl).toString(),
          body,
          {
            headers: {
              Authorization: `Bearer ${config.zhipuApiKey}`,
              'Content-Type': 'application/json'
            },
            timeout: timeoutMs
          }
        );
        return data?.choices?.[0]?.message?.content || '';
      } catch (error) {
        const isRateLimit = error.response?.status === 429;
        const isServerError = error.response?.status >= 500;
        const isTimeout = error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT';

        if (attempt > maxRetries || !(isRateLimit || isServerError || isTimeout)) {
          throw error;
        }

        const delayMs = baseDelay * Math.pow(2, attempt - 1) + Math.random() * 1000;
        console.warn(`[GLM] Request failed, retrying in ${Math.round(delayMs)}ms... (Attempt ${attempt}/${maxRetries})`);
        await sleep(delayMs);
      }
    }
  }

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

      const raw = await doRequest(body, 120000);
      return normalizeCategory(raw || '其他', dynamicCategories);
    },

    async classifyBatch(payloads, dynamicCategories = defaultCategories) {
      if (!payloads || payloads.length === 0) return {};

      const system = buildBatchPrompt(dynamicCategories);

      const body = {
        model: config.zhipuModel,
        temperature: 0.1,
        // response_format: { type: "json_object" }, // Depending on model compatibility, prompt instruction is usually enough for GLM
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: JSON.stringify(payloads, null, 2) }
        ]
      };

      let raw = await doRequest(body, 120000) || '{}';

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
