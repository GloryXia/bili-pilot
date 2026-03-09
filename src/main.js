import path from 'path';
import { fileURLToPath } from 'url';
import { config, CATEGORIES } from './config.js';
import { ensureDirs, createLogger, randomDelay, readJson, writeJson, sleep } from './utils.js';
import { createBiliClient } from './bili.js';
import { createGlmClassifier } from './glm.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
await ensureDirs(rootDir);

const cacheFile = path.join(rootDir, 'data', 'cache.json');
const tagsFile = path.join(rootDir, 'data', 'tags.json');
const logFile = path.join(rootDir, 'logs', 'run.log');
const log = createLogger(logFile);

const bili = createBiliClient(config, log);
const glm = createGlmClassifier(config, CATEGORIES);

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
  let page = 1;

  while (true) {
    await randomDelay(config.requestMinDelayMs, config.requestMaxDelayMs);
    const followings = await bili.getFollowings(page);
    if (!followings.length) break;

    log('扫描页', { page, count: followings.length });

    const batchPayloads = [];

    for (const up of followings) {
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
        const categoryMap = await glm.classifyBatch(classifyData);

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
    page += 1;
  }

  log('完成');
}

main().catch(error => {
  log('致命错误', { message: error?.message || String(error) });
  process.exitCode = 1;
});
