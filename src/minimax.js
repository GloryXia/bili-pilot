import axios from 'axios';
import { sleep } from './utils.js';
import { buildBatchPrompt, parseLLMResponse } from './prompts.js';

export function createMinimaxClassifier(config, defaultCategories) {
  const log = (msg, ctx) => console.log(`[MiniMax] ${msg}`, ctx);

  async function requestWithRetry(taskName, fn) {
    let lastError;
    // 使用 config 中的重试次数配置
    for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        const status = error?.response?.status;
        const code = error?.response?.data?.base_resp?.status_code || error?.response?.data?.code;
        const msg = error?.response?.data?.base_resp?.status_msg || error?.response?.data?.message || error?.message || String(error);

        log('请求失败', { taskName, attempt, status, code, msg });

        if (attempt < config.maxRetries) {
          const delay = config.retryBaseDelayMs * (attempt + 1);
          await sleep(delay);
        }
      }
    }
    throw lastError;
  }

  async function classifyBatch(upList, dynamicCategories) {
    const categories = dynamicCategories && dynamicCategories.length > 0 ? dynamicCategories : defaultCategories;

    const instructions = buildBatchPrompt(config, categories);

    const userInfo = upList.map(up => {
      let info = `UID: ${up.id}\n名称: ${up.uname}\n签名: ${up.sign || '无'}`;
      if (up.officialTitle || up.officialDesc) {
        info += `\n官方认证: ${up.officialTitle} ${up.officialDesc}`.trimEnd();
      }
      if (up.topCategoriesFromVideos && up.topCategoriesFromVideos.length > 0) {
        info += `\n近期视频分类: ${up.topCategoriesFromVideos.join('、')}`;
      }
      if (up.recentVideos && up.recentVideos.length > 0) {
        info += `\n近期视频:\n  ${up.recentVideos.map(v => `- ${v.title}`).join('\n  ')}`;
      }
      return info;
    }).join('\n\n---\n\n');

    return requestWithRetry('classifyBatch', async () => {
      // 兼容两种 MiniMax Base URL 形式 
      // 旧版: /v1/text/chatcompletion_pro
      // 新版 OpenAI 兼容: /v1/chat/completions (我们这里假设用户配置的 base_url 会带上这个后缀或者我们在请求里补全)
      // 为保持和 GLM/Kimi 统一的 OpenAI 兼容体验，这里访问 /chat/completions

      const baseURL = config.minimaxBaseUrl.replace(/\/$/, '');
      const endpoint = baseURL.endsWith('/chat/completions') ? baseURL : `${baseURL}/chat/completions`;

      const response = await axios.post(
        endpoint,
        {
          model: config.minimaxModel,
          messages: [
            { role: 'system', content: instructions },
            { role: 'user', content: userInfo }
          ],
          temperature: 0.1 // 较低的temperature使其结果更为确定
        },
        {
          headers: {
            'Authorization': `Bearer ${config.minimaxApiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 120000
        }
      );

      const content = response.data?.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('模型返回结果为空:\n' + JSON.stringify(response.data));
      }

      try {
        return parseLLMResponse(content);
      } catch (parseError) {
        log('解析JSON失败', { message: parseError.message });
        throw parseError;
      }
    });
  }

  return {
    classifyBatch
  };
}
