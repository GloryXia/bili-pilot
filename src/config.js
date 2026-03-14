import fs from 'fs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

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

function normalizeCategoryList(values, fallback = []) {
  const result = [];
  const seen = new Set();
  for (const value of values || []) {
    const trimmed = String(value || '').trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      result.push(trimmed);
    }
  }

  const resolved = result.length > 0 ? result : [...fallback];
  if (!resolved.includes('其他')) {
    resolved.push('其他');
  }
  return resolved;
}

export const DEFAULT_FOLLOW_CATEGORIES = [
  '番剧', '国创', '纪录片', '电影', '电视剧', '综艺', '影视', '娱乐',
  '音乐', '舞蹈', '动画', '绘画', '鬼畜', '游戏', '资讯', '知识',
  '人工智能', '科技数码', '汽车', '时尚美妆', '家装房产', '户外潮流',
  '健身', '体育运动', '手工', '美食', '小剧场', '旅游出行', '三农',
  '动物', '亲子', '健康', '情感', 'vlog', '生活兴趣', '生活经验', '其他'
];

export const FOLLOW_CATEGORIES_FILE = fileURLToPath(
  new URL('../config/follow-categories.json', import.meta.url)
);

function loadFollowCategories() {
  try {
    const raw = fs.readFileSync(FOLLOW_CATEGORIES_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error('JSON 顶层必须是数组');
    }
    return normalizeCategoryList(parsed, DEFAULT_FOLLOW_CATEGORIES);
  } catch (error) {
    console.warn(`[BiliPilot CLI] 读取关注分类配置失败，回退默认分类: ${error.message}`);
    return [...DEFAULT_FOLLOW_CATEGORIES];
  }
}

export const config = {
  biliCookie: must('BILI_COOKIE'),
  biliUid: must('BILI_UID'),
  llmProvider: get('LLM_PROVIDER', 'zhipu'), // 'zhipu', 'kimi', or 'minimax'
  zhipuApiKey: get('ZHIPU_API_KEY', ''),
  zhipuBaseUrl: get('ZHIPU_BASE_URL', 'https://open.bigmodel.cn/api/paas/v4/'),
  zhipuModel: get('ZHIPU_MODEL', 'glm-4.7'),
  kimiApiKey: get('KIMI_API_KEY', ''),
  kimiBaseUrl: get('KIMI_BASE_URL', 'https://api.moonshot.cn/v1/'),
  kimiModel: get('KIMI_MODEL', 'moonshot-v1-8k'),
  minimaxApiKey: get('MINIMAX_API_KEY', ''),
  minimaxBaseUrl: get('MINIMAX_BASE_URL', 'https://api.minimax.chat/v1/'),
  minimaxModel: get('MINIMAX_MODEL', 'abab6.5s-chat'),
  dryRun: getBool('DRY_RUN', true),
  moveMode: getBool('MOVE_MODE', false),
  forceReclassify: getBool('FORCE_RECLASSIFY', false),
  followCategories: loadFollowCategories(),
  pageSize: getNum('PAGE_SIZE', 20),
  requestMinDelayMs: getNum('REQUEST_MIN_DELAY_MS', 2500),
  requestMaxDelayMs: getNum('REQUEST_MAX_DELAY_MS', 4500),
  tagWriteDelayMs: getNum('TAG_WRITE_DELAY_MS', 5000),
  maxVideoSamples: getNum('MAX_VIDEO_SAMPLES', 5),
  saveEveryN: getNum('SAVE_EVERY_N', 1),
  maxRetries: getNum('MAX_RETRIES', 2),
  retryBaseDelayMs: getNum('RETRY_BASE_DELAY_MS', 3000)
};
