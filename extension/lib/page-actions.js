export async function requestBiliPageAction(message, options = {}) {
  if (typeof options.preferredTabId === 'number') {
    try {
      return await requestPageActionFromTab(options.preferredTabId, message);
    } catch (error) {
      console.warn('[BiliPilot] 复用来源标签页失败，准备回退到其他 B站标签页:', error);
    }
  }

  const existingTab = await findBiliTab();
  if (existingTab) {
    try {
      return await requestPageActionFromTab(existingTab.id, message);
    } catch (error) {
      console.warn('[BiliPilot] 复用 B站标签页失败，准备创建临时标签页:', error);
    }
  }

  const tempTab = await chrome.tabs.create({
    url: 'https://www.bilibili.com/',
    active: false,
  });

  try {
    await waitForTabReady(tempTab.id);
    return await requestPageActionFromTab(tempTab.id, message);
  } finally {
    if (tempTab.id) {
      chrome.tabs.remove(tempTab.id).catch(() => {});
    }
  }
}

async function findBiliTab() {
  const tabs = await chrome.tabs.query({
    url: ['*://*.bilibili.com/*', '*://bilibili.com/*'],
  });
  return tabs.find(tab => typeof tab.id === 'number') || null;
}

async function requestPageActionFromTab(tabId, message, retry = 2) {
  try {
    await ensurePageBridge(tabId);

    const response = await chrome.tabs.sendMessage(tabId, message);

    if (!response) {
      throw new Error('未收到 B站页面响应');
    }
    if (response.error) {
      throw new Error(response.message || 'B站页面请求失败');
    }

    return response.data;
  } catch (error) {
    if (retry > 0) {
      await delay(500);
      return requestPageActionFromTab(tabId, message, retry - 1);
    }
    throw error;
  }
}

async function waitForTabReady(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (tab.status === 'complete') {
    await delay(800);
    return;
  }

  await new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(handleUpdated);
      reject(new Error('B站页面加载超时'));
    }, 15000);

    function handleUpdated(updatedTabId, info) {
      if (updatedTabId !== tabId || info.status !== 'complete') {
        return;
      }
      clearTimeout(timeoutId);
      chrome.tabs.onUpdated.removeListener(handleUpdated);
      resolve();
    }

    chrome.tabs.onUpdated.addListener(handleUpdated);
  });

  await delay(800);
}

async function ensurePageBridge(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content/bridge.js'],
  });

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content/interceptor.js'],
    world: 'MAIN',
  });

  await delay(150);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
