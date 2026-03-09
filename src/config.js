import dotenv from 'dotenv';

dotenv.config();

function must(key) {
  const value = process.env[key];
  if (!value) throw new Error(`缺少环境变量 ${key}`);
  return value;
}

function get(key, fallback) {
  return process.env[key] ?? fallback;
}

function getNum(key, fallback) {
  const raw = process.env[key];
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${key} 不是有效数字`);
  return n;
}

function getBool(key, fallback) {
  const raw = process.env[key];
  if (raw == null || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).toLowerCase());
}

export const CATEGORIES = [
  '动画', '番剧', '游戏', '科技', '知识', '生活', '影视', '音乐',
  '鬼畜', '舞蹈', '时尚', '美食', '汽车', '运动', '动物', '娱乐',
  '军事', '旅行', '数码', '其他'
];

export const config = {
  biliCookie: must('BILI_COOKIE'),
  biliUid: must('BILI_UID'),
  llmProvider: get('LLM_PROVIDER', 'zhipu'), // 'zhipu' or 'kimi'
  zhipuApiKey: get('ZHIPU_API_KEY', ''),
  zhipuBaseUrl: get('ZHIPU_BASE_URL', 'https://open.bigmodel.cn/api/paas/v4/'),
  zhipuModel: get('ZHIPU_MODEL', 'glm-4.7'),
  kimiApiKey: get('KIMI_API_KEY', ''),
  kimiBaseUrl: get('KIMI_BASE_URL', 'https://api.moonshot.cn/v1/'),
  kimiModel: get('KIMI_MODEL', 'moonshot-v1-8k'),
  dryRun: getBool('DRY_RUN', true),
  moveMode: getBool('MOVE_MODE', false),
  forceReclassify: getBool('FORCE_RECLASSIFY', false),
  allowCustomCategories: getBool('ALLOW_CUSTOM_CATEGORIES', false),
  pageSize: getNum('PAGE_SIZE', 20),
  requestMinDelayMs: getNum('REQUEST_MIN_DELAY_MS', 2500),
  requestMaxDelayMs: getNum('REQUEST_MAX_DELAY_MS', 4500),
  tagWriteDelayMs: getNum('TAG_WRITE_DELAY_MS', 5000),
  maxVideoSamples: getNum('MAX_VIDEO_SAMPLES', 5),
  saveEveryN: getNum('SAVE_EVERY_N', 1),
  maxRetries: getNum('MAX_RETRIES', 2),
  retryBaseDelayMs: getNum('RETRY_BASE_DELAY_MS', 3000)
};
