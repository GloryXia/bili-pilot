import fs from 'fs-extra';
import path from 'path';

export async function ensureDirs(rootDir) {
  await fs.ensureDir(path.join(rootDir, 'data'));
  await fs.ensureDir(path.join(rootDir, 'logs'));
}

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

export async function readJson(file, fallback) {
  try {
    if (await fs.pathExists(file)) return await fs.readJson(file);
  } catch { }
  return fallback;
}

export async function writeJson(file, value) {
  await fs.writeJson(file, value, { spaces: 2 });
}

export function normalizeCategory(value, categories = CATEGORIES, allowCustom = false) {
  const clean = String(value || '').trim().replace(/[，。；;：:\s/\\\[\]（）()]/g, '');
  if (categories.includes(clean)) return clean;
  // 如果开启了自定义分组，且新名称不长（比如 <=8 个字符）且不是空字符串
  if (allowCustom && clean.length > 0 && clean.length <= 8) {
    return clean;
  }
  return '其他';
}

export function createLogger(logFile) {
  return (...items) => {
    const line = `[${new Date().toISOString()}] ${items.map(item => typeof item === 'string' ? item : JSON.stringify(item)).join(' ')}`;
    console.log(line);
    fs.appendFileSync(logFile, line + '\n');
  };
}
