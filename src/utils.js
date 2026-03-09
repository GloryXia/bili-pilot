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
  } catch {}
  return fallback;
}

export async function writeJson(file, value) {
  await fs.writeJson(file, value, { spaces: 2 });
}

export function normalizeCategory(value, categories) {
  const clean = String(value || '').trim().replace(/[，。；;：:\s]/g, '');
  return categories.includes(clean) ? clean : '其他';
}

export function createLogger(logFile) {
  return (...items) => {
    const line = `[${new Date().toISOString()}] ${items.map(item => typeof item === 'string' ? item : JSON.stringify(item)).join(' ')}`;
    console.log(line);
    fs.appendFileSync(logFile, line + '\n');
  };
}
