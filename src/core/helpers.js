/**
 * 通用工具函数（非日志、非存储）
 */

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function randomDelay(min, max) {
  const ms = Math.floor(min + Math.random() * Math.max(0, max - min));
  await sleep(ms);
}

export function parseCsrf(cookie) {
  const match = cookie.match(/(?:^|;\s*)bili_jct=([^;]+)/);
  return match?.[1] || '';
}

const MATCH_SIMILARITY_THRESHOLD = 0.72;
const MATCH_CONTAINS_THRESHOLD = 0.5;
const MATCH_CLEAN_RE = /[\s`"'~!@#$%^&*+=|\\/:;,.<>?，。；：！？、（）()【】《》「」『』“”‘’\-_—–]+/g;

export function normalizeMatchKey(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(MATCH_CLEAN_RE, '')
    .trim();
}

function levenshteinDistance(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const prev = Array.from({ length: b.length + 1 }, (_, index) => index);
  const next = new Array(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    next[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      next[j] = Math.min(
        prev[j] + 1,
        next[j - 1] + 1,
        prev[j - 1] + cost
      );
    }
    for (let j = 0; j <= b.length; j += 1) {
      prev[j] = next[j];
    }
  }

  return prev[b.length];
}

export function findBestCategoryMatch(value, categories = []) {
  const inputKey = normalizeMatchKey(value);
  if (!inputKey) return '';

  let bestContains = { category: '', score: 0 };
  let bestSimilarity = { category: '', score: 0 };

  for (const category of categories) {
    const categoryKey = normalizeMatchKey(category);
    if (!categoryKey) continue;

    if (categoryKey === inputKey) {
      return category;
    }

    if (inputKey.length >= 2 && (categoryKey.includes(inputKey) || inputKey.includes(categoryKey))) {
      const score = Math.min(categoryKey.length, inputKey.length) / Math.max(categoryKey.length, inputKey.length);
      if (score > bestContains.score) {
        bestContains = { category, score };
      }
    }

    const distance = levenshteinDistance(inputKey, categoryKey);
    const similarity = 1 - distance / Math.max(inputKey.length, categoryKey.length);
    if (similarity > bestSimilarity.score) {
      bestSimilarity = { category, score: similarity };
    }
  }

  if (bestContains.score >= MATCH_CONTAINS_THRESHOLD) {
    return bestContains.category;
  }

  if (bestSimilarity.score >= MATCH_SIMILARITY_THRESHOLD) {
    return bestSimilarity.category;
  }

  return '';
}

export function normalizeCategory(value, categories = []) {
  return findBestCategoryMatch(value, categories) || '其他';
}
