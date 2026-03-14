/**
 * 关注分组分类 —— LLM 提示词模板
 * (从原 src/prompts.js 迁移而来)
 */

export function buildSinglePrompt(dynamicCategories) {
  return [
    '你是 B 站 UP 主分类助手。',
    '请根据提供的信息给出唯一主分组。',
    `你只能从以下分类中选择一个：${dynamicCategories.join('、')}。`,
    '请直接返回分类名称，不要解释。',
    '信息不足时输出"其他"。',
  ].join('\n');
}

export function buildBatchPrompt(dynamicCategories) {
  return [
    '你是 B 站 UP 主分类专家，你需要对一批 UP 主进行严格的官方分组分类。',
    '请根据提供的 UP 主资料（签名、认证、近期投稿视频标题等），给出每个 UP 主的全局唯一主分组。',
    '',
    `【强制规定】：你只能从以下分类中选择最贴切的一个作为结果：${dynamicCategories.join('、')}。若不在此列表中，视为严重错误！`,
    '',
    '【输出规范】（必须遵守）：',
    '1. 你的返回结果必须是一个纯粹合法的 JSON 键值对对象 (Map)，绝不能包含开头或结尾的多余文字。',
    '2. 键(Key) 为传入的每一个 UP 主的 id（字符串）。',
    '3. 值(Value) 为你从列表中挑选出的分类名称（字符串）。',
    '4. 在信息极度匮乏且前置所有门类都不沾边时，统一输出"其他"以备兜底。',
    '5. 请直接输出 JSON 对象，不要带上 markdown 的 ```json 前后缀，更不要任何开场白或思考过程。',
    '',
    '期望响应示例：',
    '{"123": "科技数码", "456": "游戏"}'
  ].join('\n');
}

export function parseLLMResponse(rawResult) {
  let content = rawResult.trim();

  // 1. 去除 <think> 推理标签
  content = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // 2. 去除 markdown json 块标签
  if (content.startsWith('```json')) {
    content = content.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
  } else if (content.startsWith('```')) {
    content = content.replace(/^```\s*/, '').replace(/\s*```$/i, '').trim();
  }

  // 3. 提取 JSON Object
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    content = jsonMatch[0];
  }

  try {
    const parsed = JSON.parse(content);
    if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null) {
      throw new Error('解析成功但不是 JSON Object 字典');
    }
    return parsed;
  } catch (e) {
    throw new Error(`LLM JSON 解析失败: ${e.message}\n提取的文本片段: ${content.substring(0, 150)}...`);
  }
}
