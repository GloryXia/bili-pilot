#!/usr/bin/env node

/**
 * BiliPilot 一键导出脚本
 *
 * 将所有本地数据打包到一个 JSON 文件中，便于备份或迁移
 *
 * 用法: node scripts/export.js [--output path]
 */

import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const dataDir = path.join(rootDir, 'data');

const outputArg = process.argv.find((a, i) => process.argv[i - 1] === '--output');
const now = new Date();
const dateStr = now.toISOString().split('T')[0];
const outputPath = outputArg || path.join(rootDir, `bilipilot-export-${dateStr}.json`);

async function readIfExists(file) {
  try {
    if (await fs.pathExists(file)) return await fs.readJson(file);
  } catch { }
  return null;
}

async function exportAll() {
  console.log('📦 BiliPilot 数据导出...\n');

  const exportData = {
    exportedAt: now.toISOString(),
    version: '2.0.0',
    modules: {}
  };

  // Follow
  const followData = {
    followings: await readIfExists(path.join(dataDir, 'follow', 'followings.json')),
    cache: await readIfExists(path.join(dataDir, 'follow', 'cache.json')),
    tags: await readIfExists(path.join(dataDir, 'follow', 'tags.json')),
  };
  if (Object.values(followData).some(v => v !== null)) {
    exportData.modules.follow = followData;
    console.log(`  ✅ 关注列表: ${followData.followings?.length || 0} 条`);
  }

  // Favorites
  const favData = {
    folders: await readIfExists(path.join(dataDir, 'favorites', 'folders.json')),
    contents: await readIfExists(path.join(dataDir, 'favorites', 'contents.json')),
    suggestions: await readIfExists(path.join(dataDir, 'favorites', 'suggestions.json')),
  };
  if (Object.values(favData).some(v => v !== null)) {
    exportData.modules.favorites = favData;
    console.log(`  ✅ 收藏夹: ${favData.folders?.length || 0} 个`);
  }

  // Watch Later
  const wlData = {
    list: await readIfExists(path.join(dataDir, 'watchlater', 'watchlater.json')),
    summaries: await readIfExists(path.join(dataDir, 'watchlater', 'summaries.json')),
  };
  if (Object.values(wlData).some(v => v !== null)) {
    exportData.modules.watchlater = wlData;
    console.log(`  ✅ 稍后再看: ${wlData.list?.length || 0} 条`);
  }

  // History
  const histData = {
    history: await readIfExists(path.join(dataDir, 'history', 'history.json')),
    report: await readIfExists(path.join(dataDir, 'history', 'report.json')),
  };
  if (Object.values(histData).some(v => v !== null)) {
    exportData.modules.history = histData;
    console.log(`  ✅ 历史记录: ${histData.history?.length || 0} 条`);
  }

  // Interactions
  const intData = {
    coins: await readIfExists(path.join(dataDir, 'interactions', 'coins.json')),
    report: await readIfExists(path.join(dataDir, 'interactions', 'report.json')),
  };
  if (Object.values(intData).some(v => v !== null)) {
    exportData.modules.interactions = intData;
    console.log(`  ✅ 互动记录: ${intData.coins?.length || 0} 条`);
  }

  // Legacy data (if exists)
  const legacyFollow = await readIfExists(path.join(dataDir, 'followings.json'));
  const legacyCache = await readIfExists(path.join(dataDir, 'cache.json'));
  if (legacyFollow || legacyCache) {
    exportData.modules.legacy = { followings: legacyFollow, cache: legacyCache };
    console.log(`  ✅ 旧版数据: 已包含`);
  }

  const moduleCount = Object.keys(exportData.modules).length;
  if (moduleCount === 0) {
    console.log('\n⚠️  未发现任何数据文件，请先运行各模块拉取数据。');
    return;
  }

  await fs.writeJson(outputPath, exportData, { spaces: 2 });
  const size = (await fs.stat(outputPath)).size;
  const sizeMB = (size / 1024 / 1024).toFixed(2);

  console.log(`\n📦 导出完成!`);
  console.log(`   文件: ${outputPath}`);
  console.log(`   大小: ${sizeMB} MB`);
  console.log(`   模块: ${moduleCount} 个`);
}

exportAll().catch(err => {
  console.error('导出失败:', err.message || err);
  process.exitCode = 1;
});
