/**
 * BiliPilot Content Script — ISOLATED World Bridge
 *
 * 在隔离世界中运行，负责：
 * 1. 接收 MAIN world interceptor.js 通过 window.postMessage 发来的拦截事件
 * 2. 转发给 Service Worker 通过 chrome.runtime.sendMessage
 * 3. 将 Service Worker 的响应转发回页面（如需要）
 */

(function () {
  'use strict';

  if (window.__BILIBOARD_BRIDGE_LOADED__) {
    return;
  }
  window.__BILIBOARD_BRIDGE_LOADED__ = true;

  const BILIBOARD_MSG_TYPE = '__BILIBOARD_INTERCEPT__';
  const BILIBOARD_PAGE_REQ = '__BILIBOARD_PAGE_REQ__';
  const BILIBOARD_PAGE_RES = '__BILIBOARD_PAGE_RES__';
  const BILIBOARD_SW_REQ = '__BILIBOARD_SW_REQ__';
  const BILIBOARD_SW_RES = '__BILIBOARD_SW_RES__';
  const BILIBOARD_TOAST_REQ = '__BILIBOARD_TOAST_REQ__';
  const TOAST_HOST_ID = '__bilipilot_toast_host__';

  function ensureToastHost() {
    let host = document.getElementById(TOAST_HOST_ID);
    if (host) {
      return host;
    }

    host = document.createElement('div');
    host.id = TOAST_HOST_ID;
    host.style.position = 'fixed';
    host.style.top = '24px';
    host.style.right = '24px';
    host.style.zIndex = '2147483647';
    host.style.display = 'flex';
    host.style.flexDirection = 'column';
    host.style.gap = '12px';
    host.style.pointerEvents = 'none';
    document.documentElement.appendChild(host);
    return host;
  }

  function showToast({ title = '', message = '', tone = 'success' } = {}) {
    const host = ensureToastHost();
    const toast = document.createElement('div');
    toast.style.minWidth = '280px';
    toast.style.maxWidth = '360px';
    toast.style.padding = '14px 16px';
    toast.style.borderRadius = '16px';
    toast.style.border = tone === 'error'
      ? '1px solid rgba(248, 113, 113, 0.45)'
      : '1px solid rgba(34, 197, 94, 0.35)';
    toast.style.background = tone === 'error'
      ? 'linear-gradient(135deg, rgba(127, 29, 29, 0.96), rgba(69, 10, 10, 0.96))'
      : 'linear-gradient(135deg, rgba(22, 101, 52, 0.96), rgba(6, 78, 59, 0.96))';
    toast.style.boxShadow = '0 18px 42px rgba(15, 23, 42, 0.32)';
    toast.style.color = '#f8fafc';
    toast.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    toast.style.transform = 'translateY(-8px)';
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 180ms ease, transform 180ms ease';

    const titleEl = document.createElement('div');
    titleEl.textContent = title;
    titleEl.style.fontSize = '15px';
    titleEl.style.fontWeight = '700';
    titleEl.style.lineHeight = '1.4';

    const messageEl = document.createElement('div');
    messageEl.textContent = message;
    messageEl.style.marginTop = '6px';
    messageEl.style.fontSize = '13px';
    messageEl.style.lineHeight = '1.5';
    messageEl.style.opacity = '0.92';

    toast.appendChild(titleEl);
    toast.appendChild(messageEl);
    host.appendChild(toast);

    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-8px)';
      setTimeout(() => toast.remove(), 220);
    }, 4200);
  }

  function postSwResponse(requestId, payload) {
    window.postMessage({
      type: BILIBOARD_SW_RES,
      requestId,
      payload,
    }, '*');
  }

  window.addEventListener('message', (event) => {
    // 只接受来自当前页面的消息
    if (event.source !== window) return;
    if (!event.data) return;

    if (event.data.type === BILIBOARD_TOAST_REQ) {
      showToast(event.data.payload || {});
      return;
    }

    if (event.data.type === BILIBOARD_SW_REQ) {
      const { requestId, message } = event.data;
      if (!requestId || !message) return;

      chrome.runtime.sendMessage({
        ...message,
        pageUrl: location.href,
      }).then((response) => {
        postSwResponse(requestId, { error: false, data: response });
      }).catch((err) => {
        postSwResponse(requestId, {
          error: true,
          message: err.message || '发送后台请求失败',
        });
      });
      return;
    }

    if (event.data.type !== BILIBOARD_MSG_TYPE) return;

    const { event: eventName, data, timestamp } = event.data;
    console.log('[BiliPilot Bridge] 收到页面事件:', eventName, data);

    // 转发到 Service Worker
    chrome.runtime.sendMessage({
      type: 'BILIBOARD_EVENT',
      event: eventName,
      data,
      timestamp,
      pageUrl: location.href,
    }).then((response) => {
      console.log('[BiliPilot Bridge] 已转发到 SW:', response);
      if (response?.notification) {
        // Service Worker 返回的通知信息，可选择注入到页面
        console.log('[BiliPilot Bridge] SW 响应:', response);
      }
    }).catch((err) => {
      // Service Worker 可能未准备好
      console.warn('[BiliPilot Bridge] 发送消息失败:', err.message);
    });
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'BILIBOARD_PAGE_TOAST') {
      showToast(msg);
      sendResponse({ ok: true });
      return false;
    }

    const actionMap = {
      BILIBOARD_PAGE_DASHBOARD: 'dashboard',
      BILIBOARD_PAGE_LOGIN_STATUS: 'loginStatus',
    };
    const action = msg.type === 'BILIBOARD_PAGE_ACTION'
      ? msg.action
      : actionMap[msg.type];

    if (!action) {
      return false;
    }

    const requestId = `dashboard-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const cleanup = () => {
      window.removeEventListener('message', handleResponse);
      clearTimeout(timeoutId);
    };

    const handleResponse = (event) => {
      if (event.source !== window) return;
      if (!event.data || event.data.type !== BILIBOARD_PAGE_RES) return;
      if (event.data.requestId !== requestId) return;

      cleanup();
      sendResponse(event.data.payload);
    };

    const timeoutId = setTimeout(() => {
      cleanup();
      sendResponse({ error: true, message: 'B站页面响应超时' });
    }, 15000);

    window.addEventListener('message', handleResponse);
    window.postMessage({
      type: BILIBOARD_PAGE_REQ,
      requestId,
      action,
      ...(msg.payload || {}),
      module: msg.module || '',
    }, '*');

    return true;
  });

  console.log('[BiliPilot] 桥接脚本已加载 ✅');
})();
