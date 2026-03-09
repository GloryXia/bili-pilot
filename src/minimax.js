import axios from 'axios';
import { sleep } from './utils.js';

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

    const systemPrompt = config.allowCustomCategories
      ? `请根据提供的一组UP主信息，给出每个UP主的唯一主分组。已存在的参考分类：${categories.join('、')}。\n如果你觉得已存在的分类都不够贴切，或者出现多个类似内容的UP主，你可以自己简短概括一个更细粒度的新分类名称（不超过6个字）。`
      : `请根据提供的一组UP主信息，给出每个UP主的唯一主分组。你只能从以下分类中选择一个：${categories.join('、')}。`;

    const instructions = [
      systemPrompt,
      '返回格式必须严格为JSON对象：',
      '{',
      '  "UP主UID": "分类名称"',
      '}',
      '不要包含任何说明文字，也不要包裹在 \`\`\`json 中。'
    ].join('\n');

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
          timeout: 60000
        }
      );

      const content = response.data?.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('模型返回结果为空:\n' + JSON.stringify(response.data));
      }

      const rawContent = content.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();

      try {
        const result = JSON.parse(rawContent);
        // validate JSON object structure
        if (typeof result !== 'object' || Array.isArray(result)) {
          throw new Error('Not a valid JSON object map');
        }
        return result;
      } catch (parseError) {
        log('解析JSON失败，原始内容：', { rawContent });
        throw parseError;
      }
    });
  }

  return {
    classifyBatch
  };
}
