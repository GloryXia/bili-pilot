import { getConfig, setConfig, getAllConfig } from '../lib/storage.js';
import { createDashboardController } from '../lib/dashboard-view.js';

let dashboardController = null;
let dashboardLoaded = false;
const pendingSwitches = new Set();
const providerNames = { zhipu: '智谱 GLM', kimi: 'Kimi', minimax: 'MiniMax' };
const providerKeyMap = {
  zhipu: 'zhipuApiKey',
  kimi: 'kimiApiKey',
  minimax: 'minimaxApiKey',
};

// ========================
//  Tab 切换
// ========================
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');

    if (tab.dataset.tab === 'log') loadLog();
    if (tab.dataset.tab === 'dashboard') loadDashboard();
  });
});

// ========================
//  初始化加载
// ========================
async function init() {
  const config = await getAllConfig();

  // 开关
  document.getElementById('masterSwitch').checked = config.enabled;
  document.getElementById('autoFollowSwitch').checked = config.autoFollowGroup;
  document.getElementById('autoFavSwitch').checked = config.autoFavOrganize;

  // 设置表单
  document.getElementById('llmProvider').value = config.llmProvider;
  document.getElementById('zhipuApiKey').value = config.zhipuApiKey || '';
  document.getElementById('kimiApiKey').value = config.kimiApiKey || '';
  document.getElementById('minimaxApiKey').value = config.minimaxApiKey || '';
  updateKeyVisibility(config.llmProvider);

  // 状态信息
  updateStatusInfo(config);

  // 检测登录状态
  checkLoginStatus();
}

function updateStatusInfo(config) {
  document.getElementById('llmInfo').textContent = providerNames[config.llmProvider] || '--';

  const configEl = document.getElementById('llmConfigStatus');
  const keyField = providerKeyMap[config.llmProvider];
  const hasApiKey = Boolean(config[keyField]?.trim());
  configEl.textContent = hasApiKey ? '✅ API Key 已配置' : '❌ 缺少 API Key';
  configEl.style.color = hasApiKey ? '#22c55e' : '#ef4444';

  const cacheCount = Object.keys(config.classifyCache || {}).length;
  document.getElementById('followStatus').textContent =
    config.autoFollowGroup ? `已启用 · ${cacheCount} 条缓存` : '已关闭';
  document.getElementById('favStatus').textContent =
    config.autoFavOrganize ? '已启用' : '已关闭';
}

async function checkLoginStatus() {
  try {
    const status = await chrome.runtime.sendMessage({ type: 'BILIBOARD_LOGIN_STATUS' });
    if (status?.error) {
      throw new Error(status.message || 'B站登录态检测失败');
    }
    updateLoginStatusView(status);
  } catch (error) {
    console.warn('checkLoginStatus err:', error);
    updateLoginStatusView({
      loggedIn: false,
      reason: 'api_error',
      message: error.message || 'B站登录态检测失败',
      cause: error.message,
    });
  }
}

function updateLoginStatusView(status) {
  const el = document.getElementById('loginStatus');

  if (status?.loggedIn) {
    el.textContent = status.uname ? `✅ 已登录 (${status.uname})` : '✅ 已登录';
    el.style.color = '#22c55e';
    return;
  }

  if (status?.reason === 'api_error') {
    el.textContent = '⚠️ 登录态检测失败';
    el.style.color = '#f59e0b';
    return;
  }

  el.textContent = '❌ 未登录';
  el.style.color = '#ef4444';
}

function ensureDashboardController() {
  if (dashboardController) return dashboardController;

  dashboardController = createDashboardController({
    root: document.getElementById('tab-dashboard'),
    requestData: async () => {
      const response = await chrome.runtime.sendMessage({ type: 'BILIBOARD_DASHBOARD' });
      if (response?.error) {
        throw new Error(response.message || '加载失败');
      }
      return response;
    },
  });

  document.getElementById('dashboardRefreshBtn').addEventListener('click', () => {
    loadDashboard(true);
  });
  document.getElementById('dashboardRetryBtn').addEventListener('click', () => {
    loadDashboard(true);
  });

  return dashboardController;
}

async function loadDashboard(force = false) {
  const controller = ensureDashboardController();
  if (dashboardLoaded && !force) return;
  dashboardLoaded = true;
  await controller.loadData();
}

// ========================
//  LLM Provider 切换
// ========================
function updateKeyVisibility(provider) {
  document.getElementById('zhipuKeyGroup').classList.toggle('hidden', provider !== 'zhipu');
  document.getElementById('kimiKeyGroup').classList.toggle('hidden', provider !== 'kimi');
  document.getElementById('minimaxKeyGroup').classList.toggle('hidden', provider !== 'minimax');
}

document.getElementById('llmProvider').addEventListener('change', (e) => {
  updateKeyVisibility(e.target.value);
});

async function persistSwitch(element, key, nextValue, onSaved) {
  if (pendingSwitches.has(key)) {
    return;
  }

  pendingSwitches.add(key);
  element.disabled = true;

  try {
    await setConfig({ [key]: nextValue });
    if (typeof onSaved === 'function') {
      await onSaved();
    }
  } catch (error) {
    console.warn(`set ${key} err:`, error);
    element.checked = !nextValue;
  } finally {
    element.disabled = false;
    pendingSwitches.delete(key);
  }
}

// ========================
//  开关事件
// ========================
document.getElementById('masterSwitch').addEventListener('change', async (e) => {
  await persistSwitch(e.target, 'enabled', e.target.checked);
});

document.getElementById('autoFollowSwitch').addEventListener('change', async (e) => {
  await persistSwitch(e.target, 'autoFollowGroup', e.target.checked, async () => {
    const config = await getAllConfig();
    updateStatusInfo(config);
  });
});

document.getElementById('autoFavSwitch').addEventListener('change', async (e) => {
  await persistSwitch(e.target, 'autoFavOrganize', e.target.checked, async () => {
    const config = await getAllConfig();
    updateStatusInfo(config);
  });
});

// ========================
//  保存设置
// ========================
document.getElementById('saveBtn').addEventListener('click', async () => {
  const provider = document.getElementById('llmProvider').value;
  const data = {
    llmProvider: provider,
    zhipuApiKey: document.getElementById('zhipuApiKey').value.trim(),
    kimiApiKey: document.getElementById('kimiApiKey').value.trim(),
    minimaxApiKey: document.getElementById('minimaxApiKey').value.trim(),
  };

  // 验证当前 provider 是否有 key
  if (!data[providerKeyMap[provider]]) {
    showHint('⚠️ 请填写当前服务商的 API Key', true);
    return;
  }

  await setConfig(data);
  showHint('✅ 设置已保存');

  const config = await getAllConfig();
  updateStatusInfo(config);
});

function showHint(msg, isError = false) {
  const el = document.getElementById('saveHint');
  el.textContent = msg;
  el.style.color = isError ? '#ef4444' : '#22c55e';
  setTimeout(() => { el.textContent = ''; }, 3000);
}

// ========================
//  操作日志
// ========================
async function loadLog() {
  const log = await getConfig('operationLog');
  const list = document.getElementById('logList');
  const arr = Array.isArray(log) ? log : [];

  if (arr.length === 0) {
    list.innerHTML = '<div class="log-empty">暂无操作记录</div>';
    return;
  }

  list.innerHTML = arr.map(entry => {
    const time = new Date(entry.timestamp).toLocaleString('zh-CN', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    });

    let cls = 'info';
    if (entry.action === 'error') cls = 'error';
    else if (entry.action === 'grouped' || entry.action === 'moved' || entry.action === 'matched') cls = 'success';

    let desc = '';
    if (entry.type === 'follow') {
      desc = entry.action === 'error'
        ? `关注分组失败: ${entry.message}`
        : `${entry.upName || entry.fid} → 「${entry.category}」`;
    } else if (entry.type === 'favorite') {
      desc = entry.action === 'error'
        ? `收藏归类失败: ${entry.message}`
        : entry.action === 'matched'
          ? `「${entry.title}」已在正确位置`
          : `「${entry.title}」→ 「${entry.suggestedFolder || entry.to}」`;
    } else {
      desc = JSON.stringify(entry);
    }

    return `<div class="log-item ${cls}">
      <div class="log-action">${desc}</div>
      <div class="log-time">${time}</div>
    </div>`;
  }).join('');
}

document.getElementById('clearLogBtn').addEventListener('click', async () => {
  await setConfig({ operationLog: [] });
  loadLog();
});

// ========================
//  启动
// ========================
init();
