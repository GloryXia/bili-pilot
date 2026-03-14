import path from 'path';
import { createBiliClient } from '../../core/bili-client.js';
import { createLogger } from '../../core/logger.js';
import { readJson, writeJson, ensureDirs } from '../../core/store.js';
import { config } from '../../config.js';
import { createGlmClassifier } from '../../llm/glm.js';
import { createKimiClassifier } from '../../llm/kimi.js';
import { createMinimaxClassifier } from '../../llm/minimax.js';
import { fetchFollowings } from './fetch.js';
import { classifyFollowings } from './classify.js';
import { syncFollowTags, ensureTag } from './sync.js';

/**
 * 关注列表自动分组 — 完整运行流程
 * 等价于原 main.js 的全部逻辑
 *
 * @param {object} opts - CLI 传入的选项
 */
export async function runFollow(opts = {}) {
  const rootDir = opts.rootDir || process.cwd();
  const dataDir = path.join(rootDir, 'data', 'follow');
  const logsDir = path.join(rootDir, 'logs');
  await ensureDirs(dataDir, logsDir);

  const cacheFile = path.join(dataDir, 'cache.json');
  const tagsFile = path.join(dataDir, 'tags.json');
  const followingsFile = path.join(dataDir, 'followings.json');
  const logFile = path.join(logsDir, 'follow.log');
  const log = createLogger(logFile);

  const bili = createBiliClient(config, log);

  // 选择 LLM
  let llmClassifier;
  if (config.llmProvider === 'kimi') {
    llmClassifier = createKimiClassifier(config, config.followCategories);
  } else if (config.llmProvider === 'minimax') {
    llmClassifier = createMinimaxClassifier(config, config.followCategories);
  } else {
    if (!config.zhipuApiKey && config.llmProvider === 'zhipu') {
      log('警告', { message: '缺少智谱 API Key，您可以切换 LLM_PROVIDER=kimi 或 minimax' });
    }
    llmClassifier = createGlmClassifier(config, config.followCategories);
  }

  log('启动', {
    uid: config.biliUid,
    dryRun: config.dryRun,
    moveMode: config.moveMode,
    llmProvider: config.llmProvider,
    pageSize: config.pageSize,
    followCategories: config.followCategories
  });

  // 1. 读取现有 tag 映射
  const existingTagMap = await readJson(tagsFile, {});
  const currentTags = await bili.getTags();

  // 清理 dry-run 假数据
  if (!config.dryRun) {
    for (const key of Object.keys(existingTagMap)) {
      if (typeof existingTagMap[key] === 'string' && existingTagMap[key].startsWith('dry-run-')) {
        delete existingTagMap[key];
      }
    }
  }

  const tagMap = {
    ...existingTagMap,
    ...Object.fromEntries(currentTags.map(tag => [tag.name, tag.tagid]))
  };
  await writeJson(tagsFile, tagMap);

  // 2. 拉取关注列表
  const allFollowings = await fetchFollowings(bili, config, log, followingsFile);

  // 3. LLM 分类
  const cache = await classifyFollowings({
    allFollowings, bili, config, llmClassifier, tagMap, log, cacheFile, tagsFile
  });

  // 4. 同步到 B 站
  await syncFollowTags({ bili, config, cache, tagMap, log, tagsFile });

  log('完成');
}
