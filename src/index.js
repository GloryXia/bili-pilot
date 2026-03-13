#!/usr/bin/env node

/**
 * BiliPilot (哔哩智能管家) — CLI 入口
 *
 * 用法：
 *   bilipilot              默认执行全部模块
 *   bilipilot all           全部模块顺序执行
 *   bilipilot follow        关注列表 LLM 自动分组
 *   bilipilot favorites     收藏夹分析与整理
 *   bilipilot watchlater    稍后再看管理
 *   bilipilot history       观看历史分析
 *   bilipilot interactions  投币/点赞统计
 *   bilipilot report        生成个人数据报告
 */

import { Command } from 'commander';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const program = new Command();

program
  .name('bilipilot')
  .description('BiliPilot (哔哩智能管家) — B 站个人数据综合管理工具')
  .version('2.0.0');

// ========================
//  follow 命令（已有功能）
// ========================
program
  .command('follow')
  .description('关注列表 LLM 自动分组（拉取 → 分类 → 同步）')
  .option('--dry-run', '只分类不写入 B 站（覆盖 .env 中的 DRY_RUN）')
  .action(async (opts) => {
    const { runFollow } = await import('./modules/follow/index.js');
    await runFollow({ rootDir, ...opts });
  });

// ========================
//  favorites 命令
// ========================
program
  .command('favorites')
  .description('收藏夹 LLM 分析与整理（拉取 → 分析 → 整理）')
  .option('--dry-run', '只分析不执行移动（覆盖 .env 中的 DRY_RUN）')
  .option('--fetch-only', '仅拉取收藏夹数据，不调用 LLM')
  .option('--analyze-only', '拉取并分析，但不执行整理')
  .action(async (opts) => {
    const { runFavorites } = await import('./modules/favorites/index.js');
    await runFavorites({ rootDir, ...opts });
  });


// ========================
//  watchlater 命令
// ========================
program
  .command('watchlater')
  .description('稍后再看管理（拉取 → 摘要 → 优先级推荐）')
  .option('--dry-run', '只拉取不操作')
  .option('--fetch-only', '仅拉取列表，不调用 LLM')
  .action(async (opts) => {
    const { runWatchLater } = await import('./modules/watchlater/index.js');
    await runWatchLater({ rootDir, ...opts });
  });

// ========================
//  history 命令
// ========================
program
  .command('history')
  .description('观看历史分析（拉取 → 统计 → 画像生成）')
  .option('--fetch-only', '仅拉取历史，不分析')
  .option('--skip-llm', '跳过 LLM 画像生成，只做统计')
  .option('--max-pages <n>', '最多拉取页数（默认 50）', parseInt)
  .action(async (opts) => {
    const { runHistory } = await import('./modules/history/index.js');
    await runHistory({ rootDir, ...opts });
  });

// ========================
//  interactions 命令
// ========================
program
  .command('interactions')
  .description('投币/点赞统计（拉取 → 偏好分析）')
  .action(async (opts) => {
    const { runInteractions } = await import('./modules/interactions/index.js');
    await runInteractions({ rootDir, ...opts });
  });

// ========================
//  report 命令
// ========================
program
  .command('report')
  .description('生成 B 站个人数据综合报告（Markdown）')
  .action(async (opts) => {
    const { runReport } = await import('./modules/report/index.js');
    await runReport({ rootDir, ...opts });
  });

// ========================
//  all 命令 — 顺序执行全部模块
// ========================
program
  .command('all')
  .description('顺序执行全部模块（关注 → 收藏夹 → 稍后再看 → 历史 → 互动 → 报告）')
  .action(async () => {
    console.log('\n🚀 BiliPilot 全量执行开始...\n');

    console.log('━━━ [1/6] 关注列表分组 ━━━');
    const { runFollow } = await import('./modules/follow/index.js');
    await runFollow({ rootDir });

    console.log('\n━━━ [2/6] 收藏夹分析 ━━━');
    const { runFavorites } = await import('./modules/favorites/index.js');
    await runFavorites({ rootDir });

    console.log('\n━━━ [3/6] 稍后再看 ━━━');
    const { runWatchLater } = await import('./modules/watchlater/index.js');
    await runWatchLater({ rootDir });

    console.log('\n━━━ [4/6] 历史记录 ━━━');
    const { runHistory } = await import('./modules/history/index.js');
    await runHistory({ rootDir });

    console.log('\n━━━ [5/6] 互动统计 ━━━');
    const { runInteractions } = await import('./modules/interactions/index.js');
    await runInteractions({ rootDir });

    console.log('\n━━━ [6/6] 生成报告 ━━━');
    const { runReport } = await import('./modules/report/index.js');
    await runReport({ rootDir });

    console.log('\n✅ BiliPilot 全量执行完成！\n');
  });

// 默认行为：没有子命令时执行 all
program.action(async () => {
  await program.parseAsync(['node', 'bilipilot', 'all']);
});

program.parseAsync(process.argv).catch((err) => {
  console.error('致命错误:', err.message || err);
  process.exitCode = 1;
});
