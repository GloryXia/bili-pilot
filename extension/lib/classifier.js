/**
 * 分类核心逻辑 — 自动分组 + 自动归类
 */

import { createLLMChat } from './llm-client.js';
import * as bili from './bili-api.js';
import { buildFollowClassifyPrompt, buildFavClassifyPrompt } from './prompts.js';
import {
  getConfig, appendLog, updateTagCache,
  updateFavCache, updateClassifyCache
} from './storage.js';

function createFeatureDisabledError(message) {
  const error = new Error(message);
  error.code = 'FEATURE_DISABLED';
  return error;
}

function isFeatureDisabledError(error) {
  return error?.code === 'FEATURE_DISABLED';
}

async function assertFeatureEnabled(featureKey, message) {
  const flags = await getConfig(['enabled', featureKey]);
  if (!flags.enabled || !flags[featureKey]) {
    throw createFeatureDisabledError(message);
  }
}

/**
 * 处理关注事件 — UP 主自动分组
 *
 * @param {string} fid - UP 主 MID
 * @param {object} requestContext - 页面请求上下文
 * @returns {Promise<object>} 操作结果
 */
export async function handleFollow(fid, requestContext = {}) {
  const config = await getConfig();

  if (!config.enabled || !config.autoFollowGroup) {
    return { skipped: true, reason: '自动分组已关闭' };
  }

  // 1. 检查缓存，避免重复分类
  const cached = config.classifyCache?.[fid];
  if (cached && Date.now() - cached.ts < 7 * 24 * 3600 * 1000) {
    try {
      await assignToTag(
        fid,
        cached.category,
        config,
        null,
        requestContext,
        () => assertFeatureEnabled('autoFollowGroup', '自动分组已关闭')
      );
      return { success: true, category: cached.category, fromCache: true };
    } catch (err) {
      if (isFeatureDisabledError(err)) {
        return { skipped: true, reason: err.message };
      }
      return { error: true, message: `分组写入失败: ${err.message}`, category: cached.category };
    }
  }

  // 2. 获取 UP 主信息
  let upInfo;
  try {
    upInfo = await bili.getAccInfo(fid, requestContext);
  } catch (err) {
    return { error: true, message: `获取UP主信息失败: ${err.message}` };
  }

  const upName = upInfo?.name || `UID:${fid}`;
  const sign = upInfo?.sign || '';

  // 3. 获取最近视频标题
  let videoTitles = [];
  try {
    const videos = await bili.getRecentVideos(fid, 5, requestContext);
    videoTitles = videos.map(v => {
      const date = v.created ? new Date(v.created * 1000).toISOString().split('T')[0] : '';
      return date ? `[${date}] ${v.title}` : v.title;
    });
  } catch {
    // 视频获取失败不影响分类
  }

  // 4. 获取当前标签列表
  let tags;
  try {
    tags = await bili.getTags(requestContext);
  } catch (err) {
    return { error: true, message: `获取分组列表失败: ${err.message}` };
  }

  // 5. LLM 分类
  let category;
  try {
    const chat = createLLMChat(config);
    const system = buildFollowClassifyPrompt(tags);
    const userContent = [
      `UP主：${upName}`,
      sign ? `签名：${sign}` : '',
      videoTitles.length > 0 ? `最近视频：${JSON.stringify(videoTitles)}` : '',
    ].filter(Boolean).join('\n');

    category = await chat(system, userContent);
    category = category.replace(/["""]/g, '').trim();

    if (!category || category.length > 20) {
      category = '其他';
    }
  } catch (err) {
    return { error: true, message: `LLM 分类失败: ${err.message}`, upName };
  }

  // 6. 分配分组
  try {
    await assignToTag(
      fid,
      category,
      config,
      tags,
      requestContext,
      () => assertFeatureEnabled('autoFollowGroup', '自动分组已关闭')
    );
    await updateClassifyCache(fid, category);
    await appendLog({
      type: 'follow',
      action: 'grouped',
      upName,
      fid,
      category,
    });
    return { success: true, category, upName };
  } catch (err) {
    if (isFeatureDisabledError(err)) {
      return { skipped: true, reason: err.message };
    }
    await appendLog({
      type: 'follow',
      action: 'error',
      upName,
      fid,
      category,
      message: err.message,
    });
    return { error: true, message: `分组写入失败: ${err.message}`, upName, category };
  }
}

/**
 * 分配 UP 主到指定分组（查找或创建）
 */
async function assignToTag(fid, category, config, tags, requestContext = {}, assertEnabled = null) {
  if (assertEnabled) await assertEnabled();
  if (!tags) tags = await bili.getTags(requestContext);

  const tagMap = Object.fromEntries(tags.map(t => [t.name, t.tagid]));
  let tagId = tagMap[category] || config.followTags?.[category];

  if (!tagId) {
    if (assertEnabled) await assertEnabled();
    // 创建新分组
    tagId = await bili.createTag(category, requestContext);
    await updateTagCache(category, tagId);
  }

  if (assertEnabled) await assertEnabled();
  await bili.assignTag(fid, tagId, requestContext);
}

/**
 * 预处理收藏夹方案，用于弹窗前置自动选择。
 *
 * @param {string} rid - 视频 avid
 * @param {object} requestContext - 页面请求上下文
 * @returns {Promise<object>} 方案结果
 */
export async function planFavoriteFolder(rid, requestContext = {}) {
  const prepared = await prepareFavoriteSuggestion(rid, requestContext);

  if (prepared.skipped) {
    return prepared;
  }

  if (prepared.error) {
    await appendLog({
      type: 'favorite',
      action: 'error',
      title: prepared.title || `AV${rid}`,
      message: prepared.message,
    });
    return prepared;
  }

  const { title, suggestedFolder, folders } = prepared;
  const targetFolder = folders.find(folder => folder.title === suggestedFolder);
  const targetFolderId = targetFolder?.id ? String(targetFolder.id) : '';

  try {
    await assertFeatureEnabled('autoFavOrganize', '自动归类已关闭');
  } catch (err) {
    if (isFeatureDisabledError(err)) {
      return { skipped: true, reason: err.message };
    }
    throw err;
  }

  if (targetFolderId) {
    return {
      success: true,
      rid,
      title,
      targetFolderName: suggestedFolder,
      targetFolderId,
      created: false,
    };
  }

  try {
    await assertFeatureEnabled('autoFavOrganize', '自动归类已关闭');
    const createdFolder = await bili.createFavFolder(suggestedFolder, requestContext);
    await updateFavCache(suggestedFolder, createdFolder.id);

    return {
      success: true,
      rid,
      title,
      targetFolderName: suggestedFolder,
      targetFolderId: String(createdFolder.id),
      created: true,
    };
  } catch (err) {
    if (isFeatureDisabledError(err)) {
      return { skipped: true, reason: err.message };
    }
    await appendLog({
      type: 'favorite',
      action: 'error',
      title,
      message: err.message,
    });
    return { error: true, message: `创建收藏夹失败: ${err.message}`, title, targetFolderName: suggestedFolder };
  }
}

/**
 * 处理收藏事件 — 视频自动归类
 *
 * @param {string} rid - 视频 avid
 * @param {string} addMediaIds - 用户选择的收藏夹 IDs (逗号分隔)
 * @param {object} requestContext - 页面请求上下文
 * @returns {Promise<object>} 操作结果
 */
export async function handleFavorite(rid, addMediaIds, requestContext = {}) {
  const prepared = await prepareFavoriteSuggestion(rid, requestContext);

  if (prepared.skipped || prepared.error) {
    return prepared;
  }

  const { config, title, uid, folders, suggestedFolder } = prepared;

  // 4. 查找已选择的收藏夹名称
  const chosenFolderIds = addMediaIds.split(',').map(s => s.trim());
  const chosenFolder = folders.find(f => chosenFolderIds.includes(String(f.id)));
  const chosenFolderName = chosenFolder?.title || '默认收藏夹';

  // 5. 如果用户已经选对了，不需要移动
  if (suggestedFolder === chosenFolderName) {
    await appendLog({
      type: 'favorite',
      action: 'matched',
      title,
      suggestedFolder,
      message: '已在最佳收藏夹中',
    });
    return { success: true, suggestedFolder, title, alreadyCorrect: true };
  }

  // 6. 查找或创建目标收藏夹
  let targetFolder = folders.find(f => f.title === suggestedFolder);
  let targetMediaId = targetFolder?.id || config.favFolders?.[suggestedFolder];

  if (!targetMediaId) {
    try {
      await assertFeatureEnabled('autoFavOrganize', '自动归类已关闭');
      const created = await bili.createFavFolder(suggestedFolder, requestContext);
      targetMediaId = created.id;
      await updateFavCache(suggestedFolder, targetMediaId);
    } catch (err) {
      if (isFeatureDisabledError(err)) {
        return { skipped: true, reason: err.message };
      }
      return { error: true, message: `创建收藏夹失败: ${err.message}`, title, suggestedFolder };
    }
  }

  // 7. 移动视频
  try {
    await assertFeatureEnabled('autoFavOrganize', '自动归类已关闭');
    const srcMediaId = chosenFolder?.id || chosenFolderIds[0];
    const resources = `${rid}:2`; // 2 = 视频类型
    await bili.moveFavResource(srcMediaId, targetMediaId, resources, uid, requestContext);

    await appendLog({
      type: 'favorite',
      action: 'moved',
      title,
      from: chosenFolderName,
      to: suggestedFolder,
    });

    return { success: true, suggestedFolder, title, moved: true };
  } catch (err) {
    if (isFeatureDisabledError(err)) {
      return { skipped: true, reason: err.message };
    }
    await appendLog({
      type: 'favorite',
      action: 'error',
      title,
      message: err.message,
    });
    return { error: true, message: `移动收藏失败: ${err.message}`, title };
  }
}

async function prepareFavoriteSuggestion(rid, requestContext = {}) {
  const config = await getConfig();

  if (!config.enabled || !config.autoFavOrganize) {
    return { skipped: true, reason: '自动归类已关闭' };
  }

  let videoInfo;
  try {
    videoInfo = await bili.getVideoInfo(rid, requestContext);
  } catch (err) {
    return { error: true, message: `获取视频信息失败: ${err.message}` };
  }

  const title = videoInfo?.title || `AV${rid}`;
  const ownerName = videoInfo?.owner?.name || '未知UP主';
  const desc = videoInfo?.desc || '';
  const tname = videoInfo?.tname || '';

  let uid;
  let folders;
  try {
    uid = await bili.getUid(requestContext);
    const data = await bili.getFavFolders(uid, requestContext);
    folders = data?.list || [];
  } catch (err) {
    return { error: true, message: `获取收藏夹列表失败: ${err.message}`, title };
  }

  try {
    const chat = createLLMChat(config);
    const system = buildFavClassifyPrompt(folders);
    const userContent = [
      `视频标题：${title}`,
      `UP主：${ownerName}`,
      tname ? `分区：${tname}` : '',
      desc ? `简介：${desc.slice(0, 100)}` : '',
    ].filter(Boolean).join('\n');

    let suggestedFolder = await chat(system, userContent);
    suggestedFolder = suggestedFolder.replace(/["""]/g, '').trim();

    if (!suggestedFolder || suggestedFolder.length > 20) {
      suggestedFolder = '默认收藏夹';
    }

    return {
      config,
      rid,
      uid,
      title,
      folders,
      suggestedFolder,
    };
  } catch (err) {
    return { error: true, message: `LLM 归类失败: ${err.message}`, title };
  }
}
