const MATCH_SIMILARITY_THRESHOLD = 0.72;
const MATCH_CONTAINS_THRESHOLD = 0.5;
const MATCH_CLEAN_RE = /[\s`"'~!@#$%^&*+=|\\/:;,.<>?，。；：！？、（）()【】《》「」『』“”‘’\-_—–]+/g;

export function normalizeChoiceName(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(MATCH_CLEAN_RE, '')
    .trim();
}

function stripReasoning(raw) {
  let content = String(raw || '').trim();
  content = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  if (content.startsWith('```json')) {
    content = content.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
  } else if (content.startsWith('```')) {
    content = content.replace(/^```\s*/, '').replace(/\s*```$/i, '').trim();
  }

  return content;
}

function extractJsonObject(raw) {
  const content = stripReasoning(raw);
  const match = content.match(/\{[\s\S]*\}/);
  return match ? match[0] : content;
}

function parseChoiceResponse(raw) {
  const content = extractJsonObject(raw);

  try {
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not object');
    }
    return {
      mode: parsed.mode === 'existing' || parsed.mode === 'new' ? parsed.mode : 'unknown',
      optionId: typeof parsed.optionId === 'string' ? parsed.optionId.trim() : '',
      name: typeof parsed.name === 'string' ? parsed.name.trim() : '',
    };
  } catch {
    return {
      mode: 'unknown',
      optionId: '',
      name: stripReasoning(raw).split('\n').find(Boolean)?.trim() || '',
    };
  }
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

export function createChoiceOptions(items, mapItem) {
  return items.map((item, index) => {
    const mapped = mapItem(item);
    return {
      ...mapped,
      item,
      optionId: `E${index + 1}`,
      normalizedName: normalizeChoiceName(mapped.name),
    };
  });
}

export function findBestExistingOption(name, options = []) {
  const inputKey = normalizeChoiceName(name);
  if (!inputKey) return null;

  let bestContains = null;
  let bestSimilarity = null;

  for (const option of options) {
    const optionKey = option.normalizedName || normalizeChoiceName(option.name);
    if (!optionKey) continue;

    if (optionKey === inputKey) {
      return { option, score: 1, method: 'exact' };
    }

    if (inputKey.length >= 2 && (optionKey.includes(inputKey) || inputKey.includes(optionKey))) {
      const score = Math.min(optionKey.length, inputKey.length) / Math.max(optionKey.length, inputKey.length);
      if (!bestContains || score > bestContains.score) {
        bestContains = { option, score, method: 'contains' };
      }
    }

    const distance = levenshteinDistance(inputKey, optionKey);
    const similarity = 1 - distance / Math.max(inputKey.length, optionKey.length);
    if (!bestSimilarity || similarity > bestSimilarity.score) {
      bestSimilarity = { option, score: similarity, method: 'similarity' };
    }
  }

  if (bestContains && bestContains.score >= MATCH_CONTAINS_THRESHOLD) {
    return bestContains;
  }

  if (bestSimilarity && bestSimilarity.score >= MATCH_SIMILARITY_THRESHOLD) {
    return bestSimilarity;
  }

  return null;
}

function sanitizeNewName(name, maxLength, fallbackName) {
  const stripped = stripReasoning(name)
    .replace(/^[\s"'`]+|[\s"'`]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!stripped) return fallbackName;
  return stripped.length > maxLength ? stripped.slice(0, maxLength) : stripped;
}

export function resolveChoiceFromLLM(raw, options = [], { maxNewName = 8, fallbackName = '其他' } = {}) {
  const parsed = parseChoiceResponse(raw);

  if (parsed.mode === 'existing' && parsed.optionId) {
    const byId = options.find(option => option.optionId === parsed.optionId);
    if (byId) {
      return { mode: 'existing', option: byId, source: 'optionId', parsed };
    }
  }

  const matchedByName = findBestExistingOption(parsed.name, options);
  if (matchedByName) {
    return { mode: 'existing', option: matchedByName.option, source: matchedByName.method, parsed };
  }

  const fallbackByRaw = findBestExistingOption(raw, options);
  if (fallbackByRaw) {
    return { mode: 'existing', option: fallbackByRaw.option, source: `raw-${fallbackByRaw.method}`, parsed };
  }

  return {
    mode: 'new',
    name: sanitizeNewName(parsed.name || raw, maxNewName, fallbackName),
    source: parsed.mode === 'new' ? 'new' : 'fallback-new',
    parsed,
  };
}
