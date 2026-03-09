import path from 'path';
import { fileURLToPath } from 'url';
import { config, CATEGORIES } from './config.js';
import { ensureDirs, createLogger, randomDelay, readJson, writeJson, sleep } from './utils.js';
import { createBiliClient } from './bili.js';
import { createGlmClassifier } from './glm.js';
import { createKimiClassifier } from './kimi.js';
import { createMinimaxClassifier } from './minimax.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
await ensureDirs(rootDir);

const cacheFile = path.join(rootDir, 'data', 'cache.json');
const tagsFile = path.join(rootDir, 'data', 'tags.json');
const logFile = path.join(rootDir, 'logs', 'run.log');
const log = createLogger(logFile);

const bili = createBiliClient(config, log);

let llmClassifier;
if (config.llmProvider === 'kimi') {
  llmClassifier = createKimiClassifier(config, CATEGORIES);
} else if (config.llmProvider === 'minimax') {
  llmClassifier = createMinimaxClassifier(config, CATEGORIES);
} else {
  // 保持向后兼容或当作默认防退回方案
  if (!config.zhipuApiKey && config.llmProvider === 'zhipu') {
    log('警告', { message: '缺少智谱 API Key，您可以切换 LLM_PROVIDER=kimi 或 minimax' });
  }
  llmClassifier = createGlmClassifier(config, CATEGORIES);
}

function buildPayload(accInfo, videos) {
  const recentVideos = videos.slice(0, config.maxVideoSamples).map(video => ({
    title: video.title,
    tname: video.tname,
    desc: video.description || ''
  }));

  return {
    name: accInfo?.name || '',
    sign: accInfo?.sign || '',
    officialTitle: accInfo?.official?.title || '',
    officialDesc: accInfo?.official?.desc || '',
    topCategoriesFromVideos: [...new Set(recentVideos.map(video => video.tname).filter(Boolean))],
    recentVideos
  };
}

async function ensureTag(category, tagMap) {
  if (tagMap[category]) return tagMap[category];
  if (config.dryRun) {
    tagMap[category] = `dry-run-${category}`;
    return tagMap[category];
  }
  await sleep(config.tagWriteDelayMs);
  const tagId = await bili.createTag(category);
  tagMap[category] = tagId;
  await writeJson(tagsFile, tagMap);
  log('创建分组', { category, tagId });
  return tagId;
}

async function main() {
  log('启动', {
    uid: config.biliUid,
    dryRun: config.dryRun,
    moveMode: config.moveMode,
    model: config.zhipuModel,
    pageSize: config.pageSize
  });

  const cache = await readJson(cacheFile, {});
  const existingTagMap = await readJson(tagsFile, {});

  const nav = await bili.getNav();
  const currentTags = await bili.getTags();
  const tagMap = {
    ...Object.fromEntries(currentTags.map(tag => [tag.name, tag.tagid])),
    ...existingTagMap
  };
  await writeJson(tagsFile, tagMap);

  let processedSinceSave = 0;
  const followingsFile = path.join(rootDir, 'data', 'followings.json');
  let allFollowings = await readJson(followingsFile, null);

  if (!allFollowings || config.forceReclassify) {
    log('开始获取并缓存完整关注列表');
    allFollowings = [];
    let page = 1;
    while (true) {
      await randomDelay(config.requestMinDelayMs, config.requestMaxDelayMs);
      const followings = await bili.getFollowings(page);
      if (!followings || followings.length === 0) break;
      allFollowings.push(...followings);
      log('获取关注列表页', { page, count: followings.length, total: allFollowings.length });
      page += 1;
    }
    await writeJson(followingsFile, allFollowings);
    log('关注列表缓存完毕', { file: followingsFile, count: allFollowings.length });
  } else {
    log('读取到本地关注列表缓存', { count: allFollowings.length, file: followingsFile });
  }

  const pageSize = config.pageSize || 20;
  for (let i = 0; i < allFollowings.length; i += pageSize) {
    const chunk = allFollowings.slice(i, i + pageSize);
    const pageNum = Math.floor(i / pageSize) + 1;
    log('扫描批次', { page: pageNum, count: chunk.length });

    const batchPayloads = [];

    for (const up of chunk) {
      const mid = String(up.mid);
      if (!config.forceReclassify && cache[mid]?.category) {
        log('跳过缓存', { mid, uname: cache[mid].uname || up.uname, category: cache[mid].category });
        continue;
      }

      try {
        await randomDelay(config.requestMinDelayMs, config.requestMaxDelayMs);
        const accInfo = await bili.getAccInfo(mid, nav);

        await randomDelay(config.requestMinDelayMs, config.requestMaxDelayMs);
        const videos = await bili.getRecentVideos(mid, nav);

        const payload = buildPayload(accInfo, videos);
        batchPayloads.push({
          id: mid,
          uname: accInfo?.name || up.uname,
          payload
        });
      } catch (error) {
        log('获取信息失败', {
          mid,
          uname: up.uname,
          message: error?.response?.data?.message || error?.message || String(error)
        });
      }
    }

    if (batchPayloads.length > 0) {
      log('开始批量分类', { count: batchPayloads.length });
      try {
        const classifyData = batchPayloads.map(b => ({ id: b.id, ...b.payload }));
        const currentCategories = Object.keys(tagMap);
        const categoryMap = await llmClassifier.classifyBatch(classifyData, currentCategories);

        for (const item of batchPayloads) {
          const mid = item.id;
          // normalizeCategory is already applied inside `classifyBatch`, but doing it here again is harmless
          const category = categoryMap[mid] || '其他';
          const tagId = await ensureTag(category, tagMap);

          log('分类结果', {
            mid,
            uname: item.uname,
            category,
            dryRun: config.dryRun
          });

          if (!config.dryRun) {
            await sleep(config.tagWriteDelayMs);
            await bili.assignTag(mid, tagId);
          }

          cache[mid] = {
            uname: item.uname,
            category,
            updatedAt: new Date().toISOString(),
            source: item.payload
          };

          processedSinceSave += 1;
        }

        if (processedSinceSave >= config.saveEveryN) {
          await writeJson(cacheFile, cache);
          await writeJson(tagsFile, tagMap);
          processedSinceSave = 0;
        }
      } catch (error) {
        log('批量分类失败', { message: error?.message || String(error) });
      }
    }

    await writeJson(cacheFile, cache);
    await writeJson(tagsFile, tagMap);
  }

  log('完成');
}

main().catch(error => {
  log('致命错误', { message: error?.message || String(error) });
  process.exitCode = 1;
});
