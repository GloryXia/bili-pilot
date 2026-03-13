/**
 * LLM 客户端 — 浏览器 fetch 版本
 *
 * 支持 GLM、Kimi、MiniMax 三个 provider，统一 OpenAI 兼容接口
 */

/**
 * 向 LLM 发送请求
 *
 * @param {object} opts
 * @param {string} opts.baseUrl - API 基础地址
 * @param {string} opts.apiKey  - API Key
 * @param {string} opts.model   - 模型名称
 * @param {string} opts.system  - 系统 prompt
 * @param {string} opts.user    - 用户内容
 * @param {number} [opts.temperature=0.1]
 * @param {number} [opts.timeout=60000]
 * @param {number} [opts.maxRetries=2]
 * @returns {Promise<string>} 模型原始文本输出
 */
export async function chatLLM({
  baseUrl, apiKey, model, system, user, provider = 'unknown',
  temperature = 0.1,
  timeout = 60000,
  maxRetries = 2
}) {
  const url = `${baseUrl}/chat/completions`;
  const body = {
    model,
    temperature,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  };

  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      console.log('[BiliPilot LLM] 请求开始', {
        provider,
        model,
        baseUrl,
        attempt: attempt + 1,
      });

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        throw new Error(`LLM ${response.status}: ${errBody.slice(0, 200)}`);
      }

      const json = await response.json();
      const content = json?.choices?.[0]?.message?.content;

      if (!content) {
        throw new Error('LLM 返回空内容');
      }

      console.log('[BiliPilot LLM] 请求成功', { provider, model });
      return content.trim();
    } catch (err) {
      lastError = err;
      console.warn('[BiliPilot LLM] 请求失败', {
        provider,
        model,
        attempt: attempt + 1,
        message: err.message,
      });
      if (attempt < maxRetries) {
        // 指数退避
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }

  throw lastError;
}

/**
 * 根据配置创建 chatLLM 的便捷调用器
 */
export function createLLMChat(config) {
  let baseUrl, apiKey, model;

  if (config.llmProvider === 'kimi') {
    baseUrl = config.kimiBaseUrl;
    apiKey = config.kimiApiKey;
    model = config.kimiModel;
  } else if (config.llmProvider === 'minimax') {
    baseUrl = config.minimaxBaseUrl;
    apiKey = config.minimaxApiKey;
    model = config.minimaxModel;
  } else {
    baseUrl = config.zhipuBaseUrl;
    apiKey = config.zhipuApiKey;
    model = config.zhipuModel;
  }

  if (!apiKey) {
    throw new Error(`LLM API Key 未设置 (provider: ${config.llmProvider})`);
  }

  return (system, user) => chatLLM({
    baseUrl,
    apiKey,
    model,
    provider: config.llmProvider,
    system,
    user,
  });
}
