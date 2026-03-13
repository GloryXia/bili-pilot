import { randomDelay } from '../../core/helpers.js';
import { readJson, writeJson } from '../../core/store.js';

/**
 * 对关注的 UP 主进行 LLM 批量分类
 *
 * @param {object} options
 * @param {Array} options.allFollowings - 全量关注列表
 * @param {object} options.bili - B 站 API 客户端
 * @param {object} options.config - 全局配置
 * @param {object} options.llmClassifier - LLM 分类器实例
 * @param {object} options.tagMap - 分组名→ID 映射
 * @param {Function} options.log - 日志函数
 * @param {string} options.cacheFile - 缓存文件路径
 * @param {string} options.tagsFile - 标签文件路径
 * @returns {Promise<object>} 更新后的 cache
 */
export async function classifyFollowings({
  allFollowings, bili, config, llmClassifier, tagMap, log, cacheFile, tagsFile
}) {
  const cache = await readJson(cacheFile, {});
  let processedSinceSave = 0;
  const nav = await bili.getNav();

  const pageSize = config.pageSize || 20;
  for (let i = 0; i < allFollowings.length; i += pageSize) {
    const chunk = allFollowings.slice(i, i + pageSize);
    const pageNum = Math.floor(i / pageSize) + 1;
    log('扫描批次', { page: pageNum, count: chunk.length });

    const batchPayloads = [];

    for (const up of chunk) {
      const mid = String(up.mid);
      if (!config.forceReclassify && cache[mid]?.category) {
        log('跳过分类（已存在）', { mid, uname: cache[mid].uname || up.uname, category: cache[mid].category });
        continue;
      }

      let payload;
      let accName;

      if (cache[mid]?.source) {
        payload = cache[mid].source;
        accName = payload.name || cache[mid].uname || up.uname;
        log('读取本地资料缓存', { mid, uname: accName });
      } else {
        try {
          await randomDelay(config.requestMinDelayMs, config.requestMaxDelayMs);
          const accInfo = await bili.getAccInfo(mid, nav);

          await randomDelay(config.requestMinDelayMs, config.requestMaxDelayMs);
          const videos = await bili.getRecentVideos(mid, nav);

          payload = buildPayload(accInfo, videos, config);
          accName = accInfo?.name || up.uname;

          if (!cache[mid]) cache[mid] = {};
          cache[mid].uname = accName;
          cache[mid].source = payload;
        } catch (error) {
          log('获取信息失败', {
            mid,
            uname: up.uname,
            message: error?.response?.data?.message || error?.message || String(error)
          });
          continue;
        }
      }

      batchPayloads.push({ id: mid, uname: accName, payload });
    }

    if (batchPayloads.length > 0) {
      log('保存最新抓取的 UP 主资料到缓存...', { file: cacheFile });
      await writeJson(cacheFile, cache);

      log('开始批量分类', { count: batchPayloads.length });
      try {
        const classifyData = batchPayloads.map(b => ({ id: b.id, ...b.payload }));
        const currentCategories = Object.keys(tagMap);
        const categoryMap = await llmClassifier.classifyBatch(classifyData, currentCategories);

        for (const item of batchPayloads) {
          const mid = item.id;
          const category = categoryMap[mid] || '其他';

          log('分类结果', {
            mid, uname: item.uname, category, dryRun: config.dryRun
          });

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

  return cache;
}

/**
 * 从 UP 主资料和视频列表构建分类 payload
 */
function buildPayload(accInfo, videos, config) {
  const recentVideos = videos.slice(0, config.maxVideoSamples).map(video => {
    const pubdate = video.created ? new Date(video.created * 1000).toISOString().split('T')[0] : '';
    return {
      title: video.title,
      pubdate,
      tname: video.tname,
      desc: video.description || ''
    };
  });

  return {
    name: accInfo?.name || '',
    sign: accInfo?.sign || '',
    officialTitle: accInfo?.official?.title || '',
    officialDesc: accInfo?.official?.desc || '',
    topCategoriesFromVideos: [...new Set(recentVideos.map(video => video.tname).filter(Boolean))],
    recentVideos
  };
}
