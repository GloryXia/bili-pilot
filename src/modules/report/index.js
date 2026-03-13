import path from 'path';
import fs from 'fs-extra';
import { createBiliClient } from '../../core/bili-client.js';
import { createLogger } from '../../core/logger.js';
import { ensureDirs, readJson, writeJson } from '../../core/store.js';
import { config } from '../../config.js';

/**
 * 综合报告生成器
 *
 * 汇总各模块的分析数据，生成一份 Markdown 格式的个人 B 站数据报告
 *
 * @param {object} opts - CLI 选项
 */
export async function runReport(opts = {}) {
  const rootDir = opts.rootDir || process.cwd();
  const dataDir = path.join(rootDir, 'data');
  const logsDir = path.join(rootDir, 'logs');
  const reportDir = path.join(rootDir, 'reports');
  await ensureDirs(reportDir, logsDir);

  const logFile = path.join(logsDir, 'report.log');
  const log = createLogger(logFile);

  log('开始生成综合报告...');

  const sections = [];
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];

  sections.push(`# 📊 BiliPilot 个人数据报告`);
  sections.push(`> 生成时间: ${now.toLocaleString('zh-CN')}\n`);

  // ========================
  //  关注列表
  // ========================
  const followCache = await readJson(path.join(dataDir, 'follow', 'cache.json'), null);
  if (followCache) {
    const total = Object.keys(followCache).length;
    const categoryCount = {};
    for (const v of Object.values(followCache)) {
      const cat = v.category || '未分类';
      categoryCount[cat] = (categoryCount[cat] || 0) + 1;
    }
    const sorted = Object.entries(categoryCount).sort((a, b) => b[1] - a[1]);

    sections.push(`## 👥 关注列表\n`);
    sections.push(`- 总关注数: **${total}**`);
    sections.push(`- 分组数: **${sorted.length}**\n`);
    sections.push(`| 分组 | UP主数 | 占比 |`);
    sections.push(`|------|--------|------|`);
    for (const [cat, count] of sorted.slice(0, 15)) {
      sections.push(`| ${cat} | ${count} | ${(count / total * 100).toFixed(1)}% |`);
    }
    if (sorted.length > 15) {
      sections.push(`| ... | ${sorted.length - 15} 个更多分组 | |`);
    }
    sections.push('');
  }

  // ========================
  //  收藏夹
  // ========================
  const favFolders = await readJson(path.join(dataDir, 'favorites', 'folders.json'), null);
  const favSuggestions = await readJson(path.join(dataDir, 'favorites', 'suggestions.json'), null);
  if (favFolders) {
    const totalFolders = favFolders.length;
    const totalItems = favFolders.reduce((sum, f) => sum + (f.media_count || 0), 0);

    sections.push(`## ⭐ 收藏夹\n`);
    sections.push(`- 收藏夹数: **${totalFolders}**`);
    sections.push(`- 总收藏数: **${totalItems}**\n`);
    sections.push(`| 收藏夹 | 视频数 |`);
    sections.push(`|--------|--------|`);
    for (const f of favFolders.slice(0, 10)) {
      sections.push(`| ${f.title} | ${f.media_count || 0} |`);
    }
    sections.push('');

    if (favSuggestions) {
      const needsMove = Object.values(favSuggestions).filter(s => s.needsMove).length;
      if (needsMove > 0) {
        sections.push(`> 💡 LLM 建议移动 **${needsMove}** 个视频到更合适的收藏夹\n`);
      }
    }
  }

  // ========================
  //  稍后再看
  // ========================
  const watchlaterData = await readJson(path.join(dataDir, 'watchlater', 'watchlater.json'), null);
  const watchlaterSummaries = await readJson(path.join(dataDir, 'watchlater', 'summaries.json'), null);
  if (watchlaterData) {
    const total = watchlaterData.length;
    const watched = watchlaterData.filter(i => i.progress === -1).length;
    const invalid = watchlaterData.filter(i => !i.isValid).length;

    sections.push(`## ⏰ 稍后再看\n`);
    sections.push(`- 总数: **${total}**`);
    sections.push(`- 未看: **${total - watched - invalid}** | 已看: **${watched}** | 已失效: **${invalid}**\n`);

    if (watchlaterSummaries && Object.keys(watchlaterSummaries).length > 0) {
      const high = Object.values(watchlaterSummaries).filter(s => s.priority === '高').length;
      const mid = Object.values(watchlaterSummaries).filter(s => s.priority === '中').length;
      sections.push(`> 🎯 LLM 推荐: **${high}** 个高优先级, **${mid}** 个中优先级\n`);
    }
  }

  // ========================
  //  历史记录
  // ========================
  const historyReport = await readJson(path.join(dataDir, 'history', 'report.json'), null);
  if (historyReport) {
    sections.push(`## 📺 观看历史\n`);
    sections.push(`- 总记录数: **${historyReport.totalRecords}**`);
    sections.push(`- 累计观看: **${Math.round(historyReport.totalWatchMinutes / 60)}** 小时`);
    sections.push(`- 高峰时段: **${historyReport.peakHour}:00**\n`);

    if (historyReport.topCategories?.length > 0) {
      sections.push(`**最爱分区 TOP 5:**\n`);
      sections.push(`| 分区 | 观看次数 |`);
      sections.push(`|------|----------|`);
      for (const c of historyReport.topCategories.slice(0, 5)) {
        sections.push(`| ${c.name} | ${c.count} |`);
      }
      sections.push('');
    }

    if (historyReport.topAuthors?.length > 0) {
      sections.push(`**最爱 UP 主 TOP 5:**\n`);
      sections.push(`| UP 主 | 观看次数 |`);
      sections.push(`|-------|----------|`);
      for (const a of historyReport.topAuthors.slice(0, 5)) {
        sections.push(`| ${a.name} | ${a.count} |`);
      }
      sections.push('');
    }

    if (historyReport.profileSummary) {
      sections.push(`> 🤖 **AI 画像**: ${historyReport.profileSummary}\n`);
    }
  }

  // ========================
  //  互动统计
  // ========================
  const interactionsReport = await readJson(path.join(dataDir, 'interactions', 'report.json'), null);
  if (interactionsReport) {
    sections.push(`## 🪙 投币统计\n`);
    sections.push(`- 投币视频数: **${interactionsReport.totalVideos}**`);
    sections.push(`- 总投币数: **${interactionsReport.totalCoins}**\n`);

    if (interactionsReport.topCategories?.length > 0) {
      sections.push(`| 分区 | 投币数 |`);
      sections.push(`|------|--------|`);
      for (const c of interactionsReport.topCategories.slice(0, 5)) {
        sections.push(`| ${c.name} | ${c.coins} |`);
      }
      sections.push('');
    }
  }

  // ========================
  //  写入报告
  // ========================
  sections.push('---');
  sections.push(`*由 BiliPilot 自动生成*`);

  const markdown = sections.join('\n');
  const reportPath = path.join(reportDir, `report-${dateStr}.md`);
  await fs.writeFile(reportPath, markdown, 'utf-8');

  // 也保存一份 latest
  const latestPath = path.join(reportDir, 'latest.md');
  await fs.writeFile(latestPath, markdown, 'utf-8');

  log('报告生成完毕', { path: reportPath });
  console.log(`\n📊 报告已保存至: ${reportPath}`);
  console.log(`📊 最新报告链接: ${latestPath}\n`);
}
