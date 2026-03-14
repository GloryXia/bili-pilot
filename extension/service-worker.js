/**
 * BiliPilot Service Worker (MV3 后台脚本)
 *
 * 职责：
 * 1. 接收 Content Script 的拦截事件
 * 2. 调用 classifier 进行自动分组/归类
 * 3. 通过 chrome.notifications 通知用户
 * 4. 防抖/队列处理连续快速操作
 */

import {
  handleFollow,
  handleFavorite,
  planFavoriteFolder,
} from './lib/classifier.js';
import { requestBiliPageAction } from './lib/page-actions.js';
import { getConfig } from './lib/storage.js';

// ========================
//  防抖队列
// ========================
const taskQueue = [];
let isProcessing = false;

async function enqueue(task) {
  return new Promise((resolve, reject) => {
    taskQueue.push(async () => {
      try {
        const result = await task();
        resolve(result);
        return result;
      } catch (error) {
        reject(error);
        throw error;
      }
    });

    if (!isProcessing) {
      processQueue();
    }
  });
}

async function processQueue() {
  isProcessing = true;
  while (taskQueue.length > 0) {
    const task = taskQueue.shift();
    try {
      await task();
    } catch (err) {
      console.error('[BiliPilot SW] 任务执行失败:', err);
    }
    if (taskQueue.length > 0) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  isProcessing = false;
}

// ========================
//  通知工具
// ========================

function notify(title, message, options = {}) {
  const { isError = false, attention = false } = options;
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: `BiliPilot ${isError ? '⚠️' : '✅'} ${title}`,
    message,
    priority: (isError || attention) ? 2 : 0,
  });
}

function showPageToast(tabId, title, message, tone = 'success') {
  if (typeof tabId !== 'number') {
    return;
  }

  chrome.tabs.sendMessage(tabId, {
    type: 'BILIBOARD_PAGE_TOAST',
    title,
    message,
    tone,
  }).catch(() => {
    // 页面可能已经刷新，忽略 toast 发送失败
  });
}

function flashActionBadge(tabId, text, color = '#16a34a') {
  if (typeof tabId !== 'number') {
    return;
  }

  chrome.action.setBadgeBackgroundColor({ tabId, color });
  chrome.action.setBadgeText({ tabId, text });

  setTimeout(() => {
    try {
      chrome.action.setBadgeText({ tabId, text: '' });
    } catch {
      // 标签页关闭时忽略
    }
  }, 6000);
}

function announceSuccess(tabId, title, message, badgeText) {
  notify(title, message, { attention: true });
  showPageToast(tabId, title, message, 'success');
  flashActionBadge(tabId, badgeText);
}

// ========================
//  消息监听
// ========================

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // ---- 看板数据请求 ----
  if (msg.type === 'BILIBOARD_DASHBOARD') {
    fetchDashboardData(msg.module).then(sendResponse).catch(err => {
      sendResponse({ error: true, message: err.message });
    });
    return true; // 异步响应
  }

  if (msg.type === 'BILIBOARD_LOGIN_STATUS') {
    fetchLoginStatus().then(sendResponse).catch(err => {
      sendResponse({ error: true, message: err.message });
    });
    return true;
  }

  if (msg.type === 'BILIBOARD_RUNTIME_FLAGS') {
    getConfig(['enabled', 'autoFollowGroup', 'autoFavOrganize']).then(sendResponse).catch(err => {
      sendResponse({ error: true, message: err.message });
    });
    return true;
  }

  if (msg.type === 'BILIBOARD_FAVORITE_PLAN') {
    enqueue(async () => {
      const rid = msg.rid;
      if (!rid) {
        return { error: true, message: '缺少视频 ID' };
      }

      const requestContext = { preferredTabId: sender.tab?.id };
      const result = await planFavoriteFolder(rid, requestContext);
      console.log('[BiliPilot SW] favorite plan result:', result);

      if (result?.error) {
        notify('收藏归类失败', result.message, { isError: true });
        showPageToast(sender.tab?.id, '收藏归类失败', result.message, 'error');
      }

      return result;
    }).then(sendResponse).catch((error) => {
      sendResponse({ error: true, message: error.message });
    });
    return true;
  }

  if (msg.type !== 'BILIBOARD_EVENT') {
    return false;
  }

  const { event, data } = msg;
  console.log(`[BiliPilot SW] 收到事件: ${event}`, data);

  if (event === 'follow') {
    enqueue(async () => {
      const fid = data.fid;
      if (!fid) return;
      const requestContext = { preferredTabId: sender.tab?.id };

      notify('关注分组', `正在分析 UID:${fid}...`);

      const result = await handleFollow(fid, requestContext);
      console.log('[BiliPilot SW] follow result:', result);

      if (result.skipped) {
        // 静默跳过
      } else if (result.error) {
        notify('关注分组失败', result.message, { isError: true });
      } else if (result.fromCache) {
        announceSuccess(
          sender.tab?.id,
          '关注分组成功',
          `${result.upName || `UID:${fid}`} 已自动加入「${result.category}」 (缓存)`,
          '分组'
        );
      } else {
        announceSuccess(
          sender.tab?.id,
          '关注分组成功',
          `${result.upName} 已自动加入「${result.category}」`,
          '分组'
        );
      }
      return result;
    }).then((result) => {
      sendResponse({ received: true, result });
    }).catch((error) => {
      sendResponse({ received: false, message: error.message });
    });
  }

  else if (event === 'favorite') {
    enqueue(async () => {
      const rid = data.rid;
      const addMediaIds = data.addMediaIds;
      if (!rid || !addMediaIds) return;
      const requestContext = { preferredTabId: sender.tab?.id };

      notify('收藏归类', `正在分析视频 AV${rid}...`);

      const result = await handleFavorite(rid, addMediaIds, requestContext);
      console.log('[BiliPilot SW] favorite result:', result);

      if (result.skipped) {
        // 静默跳过
      } else if (result.error) {
        notify('收藏归类失败', result.message, { isError: true });
        showPageToast(sender.tab?.id, '收藏归类失败', result.message, 'error');
      } else if (result.alreadyCorrect) {
        notify('收藏归类',
          `「${result.title}」已在最佳收藏夹中 ✓`);
      } else if (result.moved) {
        announceSuccess(
          sender.tab?.id,
          '收藏归类成功',
          `「${result.title}」已自动归类到「${result.suggestedFolder}」`,
          '收藏'
        );
      }
      return result;
    }).then((result) => {
      sendResponse({ received: true, result });
    }).catch((error) => {
      sendResponse({ received: false, message: error.message });
    });
  }

  // 返回 true 表示我们会异步响应
  return true;
});

// ========================
//  看板数据拉取
// ========================

async function fetchDashboardData(module) {
  const result = await requestBiliPageAction({
    type: 'BILIBOARD_PAGE_DASHBOARD',
    module,
  });

  // 操作日志
  const config = await getConfig(['operationLog', 'classifyCache']);
  result.stats = {
    classifiedCount: Object.keys(config.classifyCache || {}).length,
    logCount: (config.operationLog || []).length,
  };

  return result;
}

async function fetchLoginStatus() {
  return requestBiliPageAction({ type: 'BILIBOARD_PAGE_LOGIN_STATUS' });
}

// ========================
//  安装 / 更新事件
// ========================

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[BiliPilot] 插件已安装');
    notify('欢迎使用 BiliPilot',
      '请点击工具栏图标设置 LLM API Key，然后就可以自动分组了！');
  } else if (details.reason === 'update') {
    console.log('[BiliPilot] 插件已更新到', chrome.runtime.getManifest().version);
  }
});

console.log('[BiliPilot] Service Worker 已启动 ✅');
