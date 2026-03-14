/**
 * LLM 提示词 — Chrome Extension 版本
 */

function renderOptionLines(options, formatter) {
  if (!options.length) {
    return '暂无';
  }
  return options.map(option => formatter(option)).join('\n');
}

function renderExampleBlock(title, examples) {
  if (!examples.length) {
    return '';
  }
  return [
    title,
    ...examples.map(example => `- ${example}`),
    '',
  ].join('\n');
}

/**
 * 关注分组 — 单个 UP 主的实时分类提示词
 */
export function buildFollowClassifyPrompt(options, recentExamples = []) {
  const optionLines = renderOptionLines(
    options,
    option => `${option.optionId} | ${option.name}`
  );

  return [
    '你是一个 B 站关注分组助手。请根据 UP 主的信息，优先从现有分组中选择最合适的一项。',
    '',
    '【现有分组选项】',
    optionLines,
    '',
    renderExampleBlock('【最近成功示例】', recentExamples),
    '规则：',
    '1. 默认优先使用现有分组；只有所有现有分组都明显不合适时，才允许建议新分组。',
    '2. 如果选择现有分组，必须返回 JSON：{"mode":"existing","optionId":"E1","name":"分组名"}。',
    '3. 如果确实需要新分组，返回 JSON：{"mode":"new","name":"新分组名"}，名称不超过8个字。',
    '4. 不允许输出解释、开场白、markdown 代码块或多个候选项。',
    '5. 如果信息不足，请优先选择最接近的现有分组；实在无法判断时再返回 {"mode":"new","name":"其他"}。',
    '',
    '示例输入：UP主"何同学"，签名"科技区UP主"，最近视频：["iPhone评测","iPad体验"]',
    '示例输出：{"mode":"existing","optionId":"E3","name":"科技数码"}',
  ].join('\n');
}

/**
 * 收藏归类 — 单个视频的实时分类提示词
 */
export function buildFavClassifyPrompt(options, recentExamples = []) {
  const optionLines = renderOptionLines(
    options,
    option => `${option.optionId} | ${option.name}${option.count != null ? ` (${option.count}个视频)` : ''}`
  );

  return [
    '你是一个 B 站收藏夹整理助手。请根据视频信息，优先从现有收藏夹中选择最合适的一项。',
    '',
    '【现有收藏夹选项】',
    optionLines,
    '',
    renderExampleBlock('【最近成功示例】', recentExamples),
    '规则：',
    '1. 默认优先使用现有收藏夹；只有所有现有收藏夹都明显不合适时，才允许建议新收藏夹。',
    '2. 如果选择现有收藏夹，必须返回 JSON：{"mode":"existing","optionId":"E1","name":"收藏夹名"}。',
    '3. 如果确实需要新收藏夹，返回 JSON：{"mode":"new","name":"新收藏夹名"}，名称不超过8个字。',
    '4. 不允许输出解释、开场白、markdown 代码块或多个候选项。',
    '5. 如果信息不足，请优先选择最接近的现有收藏夹；实在无法判断时再返回 {"mode":"new","name":"默认收藏夹"}。',
    '',
    '示例输入：视频标题"超详细 Blender 建模教程"，UP主"建模师老王"，简介"从零开始学3D建模"',
    '示例输出：{"mode":"existing","optionId":"E2","name":"3D建模教程"}',
  ].join('\n');
}
