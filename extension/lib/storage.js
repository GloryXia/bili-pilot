/**
 * chrome.storage 的轻量封装
 *
 * 替代 Node.js 的 fs-extra JSON 存储，提供统一的 get/set/getAll 接口
 */

const DEFAULTS = {
  // LLM 配置
  llmProvider: 'zhipu',
  zhipuApiKey: '',
  zhipuModel: 'glm-4-flash',
  zhipuBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
  kimiApiKey: '',
  kimiModel: 'moonshot-v1-auto',
  kimiBaseUrl: 'https://api.moonshot.cn/v1',
  minimaxApiKey: '',
  minimaxModel: 'MiniMax-Text-01',
  minimaxBaseUrl: 'https://api.minimax.chat/v1',

  // 功能开关
  enabled: true,
  autoFollowGroup: true,
  autoFavOrganize: true,

  // 缓存
  followTags: {},         // { tagName: tagId }
  favFolders: {},         // { folderName: mediaId }
  classifyCache: {},      // { upMid: { category, ts } }

  // 最近操作日志（最多保留 50 条）
  operationLog: [],
};

export async function getConfig(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys || Object.keys(DEFAULTS), (result) => {
      const merged = {};
      const keyList = keys ? (Array.isArray(keys) ? keys : [keys]) : Object.keys(DEFAULTS);
      for (const k of keyList) {
        merged[k] = result[k] !== undefined ? result[k] : DEFAULTS[k];
      }
      resolve(typeof keys === 'string' ? merged[keys] : merged);
    });
  });
}

export async function setConfig(obj) {
  return new Promise((resolve) => {
    chrome.storage.local.set(obj, resolve);
  });
}

export async function getAllConfig() {
  return getConfig(Object.keys(DEFAULTS));
}

/**
 * 追加操作日志，保留最近 50 条
 */
export async function appendLog(entry) {
  const log = await getConfig('operationLog');
  const arr = Array.isArray(log) ? log : [];
  arr.unshift({
    ...entry,
    timestamp: Date.now(),
  });
  // 只保留最近 50 条
  if (arr.length > 50) arr.length = 50;
  await setConfig({ operationLog: arr });
  return arr;
}

/**
 * 更新缓存中的标签映射
 */
export async function updateTagCache(tagName, tagId) {
  const tags = await getConfig('followTags');
  const updated = { ...tags, [tagName]: tagId };
  await setConfig({ followTags: updated });
  return updated;
}

/**
 * 更新缓存中的收藏夹映射
 */
export async function updateFavCache(folderName, mediaId) {
  const folders = await getConfig('favFolders');
  const updated = { ...folders, [folderName]: mediaId };
  await setConfig({ favFolders: updated });
  return updated;
}

/**
 * 更新分类缓存
 */
export async function updateClassifyCache(mid, category) {
  const cache = await getConfig('classifyCache');
  const updated = { ...cache, [mid]: { category, ts: Date.now() } };
  await setConfig({ classifyCache: updated });
  return updated;
}
