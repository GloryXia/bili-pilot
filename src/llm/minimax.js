import { createLLMBase } from './base.js';
import { normalizeCategory } from '../core/helpers.js';
import { buildBatchPrompt, parseLLMResponse } from './prompts/follow-classify.js';

export function createMinimaxClassifier(config, defaultCategories) {
  const baseURL = config.minimaxBaseUrl.replace(/\/$/, '');
  // 兼容两种 MiniMax Base URL 形式
  const effectiveBaseUrl = baseURL.endsWith('/chat/completions')
    ? baseURL.replace(/\/chat\/completions$/, '/')
    : config.minimaxBaseUrl;

  const llm = createLLMBase({
    baseUrl: effectiveBaseUrl,
    apiKey: config.minimaxApiKey,
    label: 'MiniMax',
    maxRetries: config.maxRetries,
    retryBaseDelayMs: config.retryBaseDelayMs
  });

  const log = (msg, ctx) => console.log(`[MiniMax] ${msg}`, ctx);

  async function classifyBatch(upList, dynamicCategories) {
    const categories = dynamicCategories && dynamicCategories.length > 0 ? dynamicCategories : defaultCategories;
    const instructions = buildBatchPrompt(categories);

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

    const body = {
      model: config.minimaxModel,
      messages: [
        { role: 'system', content: instructions },
        { role: 'user', content: userInfo }
      ],
      temperature: 0.1
    };

    const content = await llm.chat(body, 120000);
    if (!content) {
      throw new Error('模型返回结果为空');
    }

    try {
      const parsed = parseLLMResponse(content);
      const result = {};
      for (const [id, value] of Object.entries(parsed)) {
        result[id] = normalizeCategory(value, categories);
      }
      return result;
    } catch (parseError) {
      log('解析JSON失败', { message: parseError.message });
      throw parseError;
    }
  }

  return { classifyBatch };
}
