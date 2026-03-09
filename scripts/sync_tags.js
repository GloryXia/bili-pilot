import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { createBiliClient } from '../src/bili.js';
import { config } from '../src/config.js';
import { createLogger, sleep } from '../src/utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const log = createLogger(path.join(__dirname, '../logs/sync.log'));

const bili = createBiliClient(config, log);

async function sync() {
  log('开始同步本地 cache.json 分组至 B 站...');
  const cacheFile = path.join(__dirname, '../data/cache.json');
  if (!fs.existsSync(cacheFile)) {
    log('本地没有发现 cache.json');
    return;
  }
  const cache = await fs.readJson(cacheFile);

  // 1. Group by category
  const groups = {};
  for (const mid of Object.keys(cache)) {
    const category = cache[mid].category || '其他';
    if (!groups[category]) groups[category] = [];
    groups[category].push(mid);
  }

  // 2. Fetch true tags from Bilibili
  const currentTags = await bili.getTags();
  const tagMap = Object.fromEntries(currentTags.map(t => [t.name, t.tagid]));

  // 3. Sync
  for (const category of Object.keys(groups)) {
    // skip dry-run logic completely
    if (category.startsWith('dry-run')) continue;

    const mids = groups[category];
    log(`处理分组 [${category}], 包含 ${mids.length} 个UP主`);

    // Create Tag if missing
    if (!tagMap[category]) {
      log(`B站缺少标签 [${category}], 准备创建...`);
      await sleep(config.tagWriteDelayMs || 5000);
      try {
        const id = await bili.createTag(category);
        tagMap[category] = id;
        log(`创建成功, ID=${id}`);
      } catch (e) {
        log(`创建分类 [${category}] 失败跳过: ${e.message}`);
        continue;
      }
    }

    const tagId = tagMap[category];

    // Batch assign in chunks of 50 (B站API支持逗号分割)
    const chunkSize = 50;
    for (let i = 0; i < mids.length; i += chunkSize) {
      const chunk = mids.slice(i, i + chunkSize);
      const fids = chunk.join(',');
      log(`正在将 ${chunk.length} 名UP主移入 [${category}] (进度: ${i + chunk.length}/${mids.length})`);
      await sleep(config.tagWriteDelayMs || 5000);
      try {
        await bili.assignTag(fids, tagId);
        log('移动成功');
      } catch (e) {
        log(`移动失败: ${e.message}`);
      }
    }
  }

  log('批量同步完成！');
}

sync().catch(console.error);
