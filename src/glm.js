import axios from 'axios';
import { normalizeCategory, sleep } from './utils.js';

export function createGlmClassifier(config, defaultCategories) {
  async function doRequest(body, timeoutMs = 60000) {
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
      let system;
      if (config.allowCustomCategories) {
        system = [
          '你是 B 站 UP 主分类助手。',
          '请根据提供的信息给出唯一主分组。',
          `这有一些已存在的参考分类：${dynamicCategories.join('、')}。如果UP主主要内容在此范围内，请直接使用该分类。`,
          '如果参考分类都不合适，且该UP主的内容属于某个垂直细分领域，你可以自己简短概括一个更细粒度的新分类名称（不超过6个字）。',
          '只输出分类名称，不要解释。信息完全不足时请输出“其他”。'
        ].join('\n');
      } else {
        system = [
          '你是 B 站 UP 主分类助手。',
          '请根据提供的信息给出唯一主分组。',
          `你只能从以下分类中选择一个：${dynamicCategories.join('、')}。`,
          '只输出分类名称，不要解释。',
          '信息不足时输出“其他”。'
        ].join('\n');
      }

      const body = {
        model: config.zhipuModel,
        temperature: 0.1,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: JSON.stringify(payload, null, 2) }
        ]
      };

      const raw = await doRequest(body, 60000);
      return normalizeCategory(raw || '其他', dynamicCategories, config.allowCustomCategories);
    },

    async classifyBatch(payloads, dynamicCategories = defaultCategories) {
      if (!payloads || payloads.length === 0) return {};

      let system;
      if (config.allowCustomCategories) {
        system = [
          '你是 B 站 UP 主分类助手。',
          '请根据提供的一组UP主信息，给出每个UP主的唯一主分组。',
          `已存在的参考分类：${dynamicCategories.join('、')}。如果UP主主要内容符合，请直接使用该分类。`,
          '如果参考分类都不合适，且该UP主的内容属于某个垂直细分领域或是共性话题（比如“客制化”、“虚拟主播”、“键盘”），你可以自己简短概括一个新的细粒度分类名称（不超过6个字）。',
          '信息不足时统一输出“其他”作为其分类。',
          '注意：请严格输出一个合法的 JSON 对象，键为传入的 id，值为对应的分类名称。不要输出任何其他内容（不要有 markdown 回车或其他字符）。',
          '示例输出格式：',
          '{"123": "科技", "456": "客制化"}'
        ].join('\n');
      } else {
        system = [
          '你是 B 站 UP 主分类助手。',
          '请根据提供的一组UP主信息，给出每个UP主的唯一主分组。',
          `你只能从以下分类中选择一个：${dynamicCategories.join('、')}。`,
          '信息不足时统一输出“其他”作为其分类。',
          '注意：请严格输出一个合法的 JSON 对象，键为传入的 id，值为对应的分类名称。不要输出任何其他内容（不要有 markdown 回车或其他字符）。',
          '示例输出格式：',
          '{"123": "科技", "456": "游戏"}'
        ].join('\n');
      }

      const body = {
        model: config.zhipuModel,
        temperature: 0.1,
        // response_format: { type: "json_object" }, // Depending on model compatibility, prompt instruction is usually enough for GLM
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: JSON.stringify(payloads, null, 2) }
        ]
      };

      let raw = await doRequest(body, 90000) || '{}';

      // Attempt to clean JSON from markdown code blocks
      if (raw.startsWith('```json')) {
        raw = raw.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (raw.startsWith('```')) {
        raw = raw.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }

      let parsed = {};
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        console.warn('[GLM] Batch JSON parse failed, raw output:', raw);
        return {};
      }

      const result = {};
      for (const [id, value] of Object.entries(parsed)) {
        result[id] = normalizeCategory(value, dynamicCategories, config.allowCustomCategories);
      }
      return result;
    }
  };
}
