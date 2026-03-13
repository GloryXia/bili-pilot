/**
 * BiliPilot Content Script — MAIN World Interceptor
 *
 * 注入到 B 站页面的主世界（MAIN world），负责：
 * 1. 劫持关键 fetch/XHR 请求，捕获关注/收藏动作
 * 2. 处理页面上下文 API 请求（看板、登录态、B站接口）
 * 3. 接管视频详情页的收藏弹窗，前置完成收藏夹推荐与自动提交
 *
 * 通信方式：
 * - 页面事件：window.postMessage → bridge.js → service-worker.js
 * - 页面请求后台：window.postMessage → bridge.js → service-worker.js → bridge.js → 页面
 */

(function () {
  'use strict';

  if (window.__BILIBOARD_INTERCEPTOR_LOADED__) {
    return;
  }
  window.__BILIBOARD_INTERCEPTOR_LOADED__ = true;

  const BILIBOARD_MSG_TYPE = '__BILIBOARD_INTERCEPT__';
  const BILIBOARD_PAGE_REQ = '__BILIBOARD_PAGE_REQ__';
  const BILIBOARD_PAGE_RES = '__BILIBOARD_PAGE_RES__';
  const BILIBOARD_SW_REQ = '__BILIBOARD_SW_REQ__';
  const BILIBOARD_SW_RES = '__BILIBOARD_SW_RES__';
  const BILIBOARD_TOAST_REQ = '__BILIBOARD_TOAST_REQ__';
  const API_BASE = 'https://api.bilibili.com';
  const FAVORITE_DIALOG_SELECTOR = '.collection-m-exp';
  const FAVORITE_GROUP_LABEL_SELECTOR = '.group-list li label';
  const FAVORITE_TITLE_SELECTOR = '.fav-title';
  const FAVORITE_CLOSE_SELECTOR = '.title .close';
  const FAVORITE_SUBMIT_SELECTOR = '.bottom .submit-move';
  const FAVORITE_TRIGGER_WINDOW = 5000;
  const FAVORITE_REOPEN_TIMEOUT = 5000;
  const FAVORITE_PLAN_TIMEOUT = 45000;
  const SUPPRESSED_REQUEST_TTL = 15000;
  const MIXIN_KEY_ENC_TAB = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
    27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
    37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
    22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
  ];
  const CHR_FILTER = /[!'()*]/g;

  const favoriteDialogState = {
    lastTrigger: null,
    activeSession: null,
    suppressedRequests: new Map(),
    syntheticClickUntil: 0,
  };

  // ========================
  //  需要拦截的 API
  // ========================
  const INTERCEPT_RULES = [
    {
      pattern: /\/x\/relation\/modify/,
      name: 'follow',
      parseBody: (body) => {
        const params = new URLSearchParams(body);
        return {
          fid: params.get('fid'),
          act: params.get('act'),
          reSrc: params.get('re_src'),
        };
      },
      shouldIntercept: (parsed) => parsed.act === '1' || parsed.act === '3',
    },
    {
      pattern: /\/x\/v3\/fav\/resource\/deal/,
      name: 'favorite',
      parseBody: (body) => {
        const params = new URLSearchParams(body);
        return {
          rid: params.get('rid'),
          type: params.get('type'),
          addMediaIds: params.get('add_media_ids'),
          delMediaIds: params.get('del_media_ids'),
        };
      },
      shouldIntercept: (parsed) => parsed.addMediaIds && parsed.addMediaIds.length > 0,
    },
  ];

  function emitEvent(eventName, data) {
    window.postMessage({
      type: BILIBOARD_MSG_TYPE,
      event: eventName,
      data,
      timestamp: Date.now(),
    }, '*');
  }

  function emitToast(title, message, tone = 'success') {
    window.postMessage({
      type: BILIBOARD_TOAST_REQ,
      payload: { title, message, tone },
    }, '*');
  }

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function getMixinKey(raw) {
    return MIXIN_KEY_ENC_TAB.map(index => raw[index]).join('').slice(0, 32);
  }

  function toHex(num) {
    return (num >>> 0).toString(16).padStart(8, '0');
  }

  function add32(a, b) {
    return (a + b) >>> 0;
  }

  function leftRotate(value, amount) {
    return ((value << amount) | (value >>> (32 - amount))) >>> 0;
  }

  function md5(input) {
    const message = new TextEncoder().encode(input);
    const bitLength = message.length * 8;
    const paddedLength = (((message.length + 8) >> 6) + 1) * 64;
    const buffer = new Uint8Array(paddedLength);
    buffer.set(message);
    buffer[message.length] = 0x80;

    const view = new DataView(buffer.buffer);
    view.setUint32(paddedLength - 8, bitLength >>> 0, true);
    view.setUint32(paddedLength - 4, Math.floor(bitLength / 0x100000000), true);

    let a0 = 0x67452301;
    let b0 = 0xefcdab89;
    let c0 = 0x98badcfe;
    let d0 = 0x10325476;

    const shifts = [
      7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
      5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
      4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
      6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
    ];

    const constants = Array.from({ length: 64 }, (_, index) =>
      Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000) >>> 0
    );

    for (let offset = 0; offset < paddedLength; offset += 64) {
      const chunk = new Uint32Array(16);
      for (let i = 0; i < 16; i += 1) {
        chunk[i] = view.getUint32(offset + i * 4, true);
      }

      let a = a0;
      let b = b0;
      let c = c0;
      let d = d0;

      for (let i = 0; i < 64; i += 1) {
        let f;
        let g;

        if (i < 16) {
          f = (b & c) | (~b & d);
          g = i;
        } else if (i < 32) {
          f = (d & b) | (~d & c);
          g = (5 * i + 1) % 16;
        } else if (i < 48) {
          f = b ^ c ^ d;
          g = (3 * i + 5) % 16;
        } else {
          f = c ^ (b | ~d);
          g = (7 * i) % 16;
        }

        const temp = d;
        d = c;
        c = b;
        b = add32(b, leftRotate(add32(add32(a, f), add32(constants[i], chunk[g])), shifts[i]));
        a = temp;
      }

      a0 = add32(a0, a);
      b0 = add32(b0, b);
      c0 = add32(c0, c);
      d0 = add32(d0, d);
    }

    return [a0, b0, c0, d0].map(word => {
      const hex = toHex(word);
      return hex.slice(6, 8) + hex.slice(4, 6) + hex.slice(2, 4) + hex.slice(0, 2);
    }).join('');
  }

  function encWbi(params, imgUrl, subUrl) {
    const imgKey = imgUrl.split('/').pop().split('.')[0];
    const subKey = subUrl.split('/').pop().split('.')[0];
    const mixinKey = getMixinKey(imgKey + subKey);
    const withWts = { ...params, wts: Math.floor(Date.now() / 1000) };
    const query = new URLSearchParams();

    for (const key of Object.keys(withWts).sort()) {
      query.append(key, String(withWts[key]).replace(CHR_FILTER, ''));
    }

    const wRid = md5(query.toString() + mixinKey);
    query.append('w_rid', wRid);
    return query.toString();
  }

  async function pageApiGet(path, params = {}) {
    const qs = new URLSearchParams(params).toString();
    const url = qs ? `${API_BASE}${path}?${qs}` : `${API_BASE}${path}`;
    const response = await originalFetch.call(window, url, { credentials: 'include' });
    const json = await response.json();
    if (json?.code !== 0) {
      throw new Error(`B站 API 错误 [${path}]: ${json?.message || json?.code}`);
    }
    return json.data;
  }

  async function pageApiGetWithWbi(path, params = {}) {
    const nav = await pageApiGet('/x/web-interface/nav');
    const qs = encWbi(params, nav.wbi_img.img_url, nav.wbi_img.sub_url);
    const response = await originalFetch.call(window, `${API_BASE}${path}?${qs}`, {
      credentials: 'include',
    });
    const json = await response.json();
    if (json?.code !== 0) {
      throw new Error(`B站 API 错误 [${path}]: ${json?.message || json?.code}`);
    }
    return json.data;
  }

  function getCsrfFromCookie() {
    const match = document.cookie.match(/(?:^|;\s*)bili_jct=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  }

  async function pageApiPost(path, formData = {}) {
    const csrf = getCsrfFromCookie();
    const body = new URLSearchParams({
      ...formData,
      ...(csrf ? { csrf, csrf_token: csrf } : {}),
    });

    const response = await originalFetch.call(window, `${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      credentials: 'include',
    });
    const json = await response.json();
    if (json?.code !== 0) {
      throw new Error(`B站 API 错误 [${path}]: ${json?.message || json?.code}`);
    }
    return json.data;
  }

  async function fetchDashboardData(module) {
    const login = await fetchLoginStatus();
    if (!login.loggedIn) {
      throw new Error(login.message || '未登录 B 站');
    }

    const uid = login.uid;
    const result = {};

    if (!module || module === 'follow') {
      try {
        const tags = await pageApiGet('/x/relation/tags');
        result.follow = {
          tags: (tags || []).map(t => ({ name: t.name, count: t.count || 0, tagid: t.tagid })),
          totalTags: (tags || []).length,
          totalFollows: (tags || []).reduce((sum, item) => sum + (item.count || 0), 0),
        };
      } catch (error) {
        result.follow = { error: error.message };
      }
    }

    if (!module || module === 'favorites') {
      try {
        const data = await pageApiGet('/x/v3/fav/folder/created/list-all', { up_mid: uid });
        const folders = data?.list || [];
        result.favorites = {
          folders: folders.map(f => ({ title: f.title, count: f.media_count || 0, id: f.id })),
          totalFolders: folders.length,
          totalItems: folders.reduce((sum, item) => sum + (item.media_count || 0), 0),
        };
      } catch (error) {
        result.favorites = { error: error.message };
      }
    }

    if (!module || module === 'watchlater') {
      try {
        const data = await pageApiGet('/x/v2/history/toview');
        const list = data?.list || [];
        const watched = list.filter(v => v.progress === -1).length;
        const invalid = list.filter(v => !v.videos || v.videos === 0).length;
        result.watchlater = {
          total: list.length,
          unwatched: list.length - watched - invalid,
          watched,
          invalid,
          items: list.slice(0, 10).map(v => ({
            title: v.title,
            owner: v.owner?.name || '',
            progress: v.progress,
            duration: v.duration,
            aid: v.aid,
          })),
        };
      } catch (error) {
        result.watchlater = { error: error.message };
      }
    }

    if (!module || module === 'history') {
      try {
        const data = await pageApiGet('/x/web-interface/history/cursor', { ps: 30 });
        const list = data?.list || [];
        result.history = {
          recentCount: list.length,
          items: list.slice(0, 10).map(v => ({
            title: v.title,
            author: v.author_name || '',
            viewAt: v.view_at,
            business: v.history?.business || '',
            tag: v.tag_name || '',
          })),
        };
      } catch (error) {
        result.history = { error: error.message };
      }
    }

    return result;
  }

  async function fetchLoginStatus() {
    const nav = await pageApiGet('/x/web-interface/nav');
    return parseNavLoginStatus(nav);
  }

  function parseNavLoginStatus(nav) {
    const uid = nav?.mid ? String(nav.mid) : '';
    const loggedIn = nav?.isLogin === true || Boolean(uid);

    return {
      loggedIn,
      uid,
      uname: nav?.uname || '',
      reason: loggedIn ? 'nav_ok' : 'not_logged_in',
      message: loggedIn ? '已登录' : '未登录 B 站',
    };
  }

  function isVideoDetailPage() {
    return /^\/video\//.test(location.pathname);
  }

  function getCurrentVideoRid() {
    const initialState = window.__INITIAL_STATE__ || {};
    const candidates = [
      initialState.aid,
      initialState.videoData?.aid,
      initialState.videoInfo?.aid,
      initialState?.epInfo?.aid,
    ];

    for (const candidate of candidates) {
      if (candidate) {
        return String(candidate);
      }
    }

    const urlAid = new URL(location.href).searchParams.get('aid');
    return urlAid ? String(urlAid) : '';
  }

  function cleanupSuppressedFavoriteRequests() {
    const now = Date.now();
    for (const [key, entry] of favoriteDialogState.suppressedRequests.entries()) {
      if (!entry || entry.expiresAt <= now) {
        favoriteDialogState.suppressedRequests.delete(key);
      }
    }
  }

  function markSuppressedFavoriteRequest(rid, targetFolderId, meta = {}) {
    if (!rid || !targetFolderId) return;
    cleanupSuppressedFavoriteRequests();
    favoriteDialogState.suppressedRequests.set(
      `${String(rid)}:${String(targetFolderId)}`,
      {
        expiresAt: Date.now() + SUPPRESSED_REQUEST_TTL,
        title: meta.title || '',
        targetFolderName: meta.targetFolderName || '',
      }
    );
  }

  function takeSuppressedFavoriteRequest(parsed) {
    cleanupSuppressedFavoriteRequests();
    const addMediaIds = String(parsed?.addMediaIds || '')
      .split(',')
      .map(id => id.trim())
      .filter(Boolean);

    for (const mediaId of addMediaIds) {
      const key = `${String(parsed.rid)}:${mediaId}`;
      if (favoriteDialogState.suppressedRequests.has(key)) {
        const entry = favoriteDialogState.suppressedRequests.get(key);
        favoriteDialogState.suppressedRequests.delete(key);
        return {
          key,
          title: entry?.title || '',
          targetFolderName: entry?.targetFolderName || '',
        };
      }
    }

    return null;
  }

  function isSyntheticClick() {
    return Date.now() < favoriteDialogState.syntheticClickUntil;
  }

  function setSyntheticClickWindow(duration = 1200) {
    favoriteDialogState.syntheticClickUntil = Date.now() + duration;
  }

  function findFavoriteTrigger(target) {
    if (!(target instanceof Element)) {
      return null;
    }

    let current = target;
    while (current && current !== document.body) {
      if (isFavoriteTriggerCandidate(current)) {
        return current;
      }
      current = current.parentElement;
    }

    return null;
  }

  function isFavoriteTriggerCandidate(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    if (element.closest(FAVORITE_DIALOG_SELECTOR)) {
      return false;
    }

    const attrText = normalizeText(
      element.getAttribute('title') || element.getAttribute('aria-label') || ''
    );
    if (attrText.startsWith('收藏')) {
      return true;
    }

    const text = normalizeText(element.textContent || '');
    if (!text.startsWith('收藏')) {
      return false;
    }

    if (text.length <= 20) {
      return true;
    }

    const className = typeof element.className === 'string' ? element.className : '';
    return /collect|favorite|fav/i.test(className);
  }

  function findFavoriteTriggerInDocument() {
    const direct = document.querySelector('[title^="收藏"], [aria-label^="收藏"]');
    if (direct instanceof HTMLElement && isFavoriteTriggerCandidate(direct)) {
      return direct;
    }

    const candidates = document.querySelectorAll('button, [role="button"], div, span');
    for (const candidate of candidates) {
      if (candidate instanceof HTMLElement && isFavoriteTriggerCandidate(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  function getFavoriteDialogFromNode(node) {
    if (!(node instanceof Element)) {
      return null;
    }

    if (node.matches(FAVORITE_DIALOG_SELECTOR)) {
      return node;
    }

    return node.querySelector(FAVORITE_DIALOG_SELECTOR);
  }

  function isSessionActive(session) {
    return favoriteDialogState.activeSession === session && !session.cancelled;
  }

  function clearLastFavoriteTrigger() {
    favoriteDialogState.lastTrigger = null;
  }

  function cancelFavoriteSession(reason) {
    const session = favoriteDialogState.activeSession;
    if (!session) {
      clearLastFavoriteTrigger();
      return;
    }

    session.cancelled = true;
    if (session.reopenTimerId) {
      clearTimeout(session.reopenTimerId);
    }
    favoriteDialogState.activeSession = null;
    clearLastFavoriteTrigger();

    if (reason && reason !== 'submitted') {
      console.log('[BiliPilot] 结束收藏弹窗会话:', reason);
    }
  }

  function handleDocumentClick(event) {
    cleanupSuppressedFavoriteRequests();

    if (!(event.target instanceof Element)) {
      return;
    }

    if (isSyntheticClick()) {
      return;
    }

    if (favoriteDialogState.activeSession && event.target.closest(FAVORITE_DIALOG_SELECTOR)) {
      cancelFavoriteSession('user_interaction');
      return;
    }

    if (!isVideoDetailPage()) {
      return;
    }

    const trigger = findFavoriteTrigger(event.target);
    if (!trigger) {
      return;
    }

    const rid = getCurrentVideoRid();
    if (!rid) {
      return;
    }

    favoriteDialogState.lastTrigger = {
      element: trigger,
      rid,
      ts: Date.now(),
    };
  }

  function maybeStartFavoriteDialogSession(dialog) {
    if (!(dialog instanceof HTMLElement) || !isVideoDetailPage()) {
      return;
    }

    const activeSession = favoriteDialogState.activeSession;
    if (activeSession?.state === 'reopen' && activeSession.plan) {
      if (activeSession.reopenTimerId) {
        clearTimeout(activeSession.reopenTimerId);
        activeSession.reopenTimerId = 0;
      }
      activeSession.dialogEl = dialog;
      void processFavoriteDialog(activeSession, dialog, true);
      return;
    }

    if (activeSession) {
      return;
    }

    const trigger = favoriteDialogState.lastTrigger;
    if (!trigger || Date.now() - trigger.ts > FAVORITE_TRIGGER_WINDOW) {
      return;
    }

    const rid = getCurrentVideoRid();
    if (!rid || rid !== trigger.rid) {
      return;
    }

    const session = {
      id: `fav-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      rid,
      triggerEl: trigger.element,
      dialogEl: dialog,
      plan: null,
      state: 'planning',
      cancelled: false,
      reopenTimerId: 0,
    };

    favoriteDialogState.activeSession = session;
    void processFavoriteDialog(session, dialog, false);
  }

  async function processFavoriteDialog(session, dialog, reusePlan = false) {
    try {
      if (!isSessionActive(session)) {
        return;
      }

      session.dialogEl = dialog;

      if (!reusePlan) {
        const plan = await requestFavoritePlan(session.rid);
        if (!isSessionActive(session) || !document.contains(dialog)) {
          return;
        }

        if (!plan || plan.error || plan.skipped) {
          cancelFavoriteSession(plan?.message || plan?.reason || 'fallback_manual');
          return;
        }

        if (!(await ensureFavoriteAutomationEnabled(session, 'favorite_disabled_before_takeover'))) {
          return;
        }

        session.plan = plan;

        if (plan.created) {
          if (!(await ensureFavoriteAutomationEnabled(session, 'favorite_disabled_before_reopen'))) {
            return;
          }
          await reopenFavoriteDialog(session);
          return;
        }
      }

      if (!session.plan) {
        cancelFavoriteSession('missing_plan');
        return;
      }

      if (!(await ensureFavoriteAutomationEnabled(session, 'favorite_disabled_before_apply'))) {
        return;
      }

      session.state = 'applying';
      await applyFavoritePlanToDialog(session, dialog, session.plan);
    } catch (error) {
      console.warn('[BiliPilot] 收藏弹窗自动归类失败:', error);
      cancelFavoriteSession('apply_error');
    }
  }

  function requestFavoritePlan(rid) {
    return requestServiceWorker({
      type: 'BILIBOARD_FAVORITE_PLAN',
      rid,
    }, FAVORITE_PLAN_TIMEOUT);
  }

  function requestRuntimeFlags() {
    return requestServiceWorker({
      type: 'BILIBOARD_RUNTIME_FLAGS',
    }, 5000);
  }

  async function ensureFavoriteAutomationEnabled(session, reason) {
    if (!isSessionActive(session)) {
      return false;
    }

    try {
      const flags = await requestRuntimeFlags();
      if (!isSessionActive(session)) {
        return false;
      }
      if (!flags?.enabled || !flags?.autoFavOrganize) {
        cancelFavoriteSession(reason);
        return false;
      }
      return true;
    } catch (error) {
      console.warn('[BiliPilot] 获取收藏自动归类状态失败:', error);
      cancelFavoriteSession(reason || 'favorite_status_error');
      return false;
    }
  }

  function requestServiceWorker(message, timeout = FAVORITE_PLAN_TIMEOUT) {
    return new Promise((resolve, reject) => {
      const requestId = `sw-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      const cleanup = () => {
        window.removeEventListener('message', handleResponse);
        clearTimeout(timeoutId);
      };

      const handleResponse = (event) => {
        if (event.source !== window) return;
        if (!event.data || event.data.type !== BILIBOARD_SW_RES) return;
        if (event.data.requestId !== requestId) return;

        cleanup();

        if (event.data.payload?.error) {
          reject(new Error(event.data.payload.message || '后台请求失败'));
          return;
        }

        resolve(event.data.payload?.data);
      };

      const timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error('后台请求超时'));
      }, timeout);

      window.addEventListener('message', handleResponse);
      window.postMessage({
        type: BILIBOARD_SW_REQ,
        requestId,
        message,
      }, '*');
    });
  }

  async function reopenFavoriteDialog(session) {
    if (!isSessionActive(session) || !session.dialogEl) {
      return;
    }

    const dialog = session.dialogEl;
    const closeButton = dialog.querySelector(FAVORITE_CLOSE_SELECTOR);

    session.state = 'reopen';

    if (closeButton instanceof HTMLElement) {
      await clickElement(closeButton);
    } else {
      const trigger = resolveFavoriteTrigger(session);
      if (!trigger) {
        throw new Error('未找到收藏按钮');
      }
      await clickElement(trigger);
    }

    await waitForDialogClosed(dialog, 2000);

    if (!isSessionActive(session)) {
      return;
    }

    const trigger = resolveFavoriteTrigger(session);
    if (!trigger) {
      throw new Error('收藏按钮不可用');
    }
    session.triggerEl = trigger;
    session.dialogEl = null;

    session.reopenTimerId = setTimeout(() => {
      if (isSessionActive(session) && session.state === 'reopen') {
        cancelFavoriteSession('reopen_timeout');
      }
    }, FAVORITE_REOPEN_TIMEOUT);

    await wait(120);
    await clickElement(trigger);
  }

  function resolveFavoriteTrigger(session) {
    if (session.triggerEl instanceof HTMLElement && document.contains(session.triggerEl)) {
      return session.triggerEl;
    }

    const fallback = findFavoriteTriggerInDocument();
    return fallback instanceof HTMLElement ? fallback : null;
  }

  async function applyFavoritePlanToDialog(session, dialog, plan) {
    const targetLabel = await waitForFavoriteLabel(dialog, plan.targetFolderName, 2500);
    if (!targetLabel) {
      throw new Error(`未找到推荐收藏夹: ${plan.targetFolderName}`);
    }

    await syncFavoriteSelection(dialog, targetLabel);

    if (!isSessionActive(session)) {
      return;
    }

    const submitButton = await waitForSubmitEnabled(dialog, 2500);
    if (!submitButton) {
      const targetInput = targetLabel.querySelector('input[type="checkbox"]');
      const checkedCount = Array.from(dialog.querySelectorAll(`${FAVORITE_GROUP_LABEL_SELECTOR} input[type="checkbox"]`))
        .filter(input => input.checked).length;

      if (targetInput?.checked && checkedCount === 1) {
        cancelFavoriteSession('selection_already_correct');
        return;
      }

      throw new Error('收藏确认按钮未启用');
    }

    if (!(await ensureFavoriteAutomationEnabled(session, 'favorite_disabled_before_submit'))) {
      return;
    }

    markSuppressedFavoriteRequest(session.rid, plan.targetFolderId, {
      title: plan.title,
      targetFolderName: plan.targetFolderName,
    });
    await clickElement(submitButton);
    await wait(200);
    cancelFavoriteSession('submitted');
  }

  async function waitForFavoriteLabel(dialog, targetFolderName, timeout = 2500) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeout) {
      const label = findFavoriteLabel(dialog, targetFolderName);
      if (label) {
        return label;
      }
      await wait(120);
    }
    return null;
  }

  function findFavoriteLabel(dialog, targetFolderName) {
    const expectedName = normalizeText(targetFolderName);
    const labels = dialog.querySelectorAll(FAVORITE_GROUP_LABEL_SELECTOR);

    for (const label of labels) {
      const titleNode = label.querySelector(FAVORITE_TITLE_SELECTOR);
      const title = normalizeText(titleNode?.textContent || '');
      if (title === expectedName) {
        return label;
      }
    }

    return null;
  }

  async function syncFavoriteSelection(dialog, targetLabel) {
    const labels = Array.from(dialog.querySelectorAll(FAVORITE_GROUP_LABEL_SELECTOR));

    for (const label of labels) {
      const input = label.querySelector('input[type="checkbox"]');
      if (!(input instanceof HTMLInputElement)) {
        continue;
      }

      const shouldBeChecked = label === targetLabel;
      if (Boolean(input.checked) !== shouldBeChecked) {
        await toggleFavoriteLabel(label, shouldBeChecked);
      }
    }

    const targetInput = targetLabel.querySelector('input[type="checkbox"]');
    if (!(targetInput instanceof HTMLInputElement) || !targetInput.checked) {
      throw new Error('未能选中推荐收藏夹');
    }
  }

  async function toggleFavoriteLabel(label, shouldBeChecked) {
    const input = label.querySelector('input[type="checkbox"]');
    if (!(input instanceof HTMLInputElement)) {
      throw new Error('收藏夹选项缺少复选框');
    }

    if (Boolean(input.checked) === shouldBeChecked) {
      return;
    }

    await clickElement(label);

    if (Boolean(input.checked) !== shouldBeChecked) {
      await wait(120);
      if (Boolean(input.checked) !== shouldBeChecked) {
        throw new Error('收藏夹勾选状态同步失败');
      }
    }
  }

  async function waitForSubmitEnabled(dialog, timeout = 2500) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeout) {
      const button = dialog.querySelector(FAVORITE_SUBMIT_SELECTOR);
      if (button instanceof HTMLButtonElement && !button.disabled && !button.classList.contains('disable')) {
        return button;
      }
      await wait(120);
    }
    return null;
  }

  async function waitForDialogClosed(dialog, timeout = 2000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeout) {
      if (!document.contains(dialog)) {
        return;
      }
      await wait(120);
    }
    throw new Error('收藏弹窗关闭超时');
  }

  async function clickElement(element) {
    if (!(element instanceof HTMLElement) || typeof element.click !== 'function') {
      throw new Error('目标元素不可点击');
    }

    setSyntheticClickWindow();
    element.click();
    await wait(120);
  }

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function initFavoriteDialogAutomation() {
    document.addEventListener('click', handleDocumentClick, true);

    const observer = new MutationObserver((mutations) => {
      const activeSession = favoriteDialogState.activeSession;
      if (activeSession?.dialogEl && !document.contains(activeSession.dialogEl) && activeSession.state !== 'reopen') {
        cancelFavoriteSession('dialog_closed');
      }

      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          const dialog = getFavoriteDialogFromNode(node);
          if (dialog) {
            maybeStartFavoriteDialogSession(dialog);
          }
        }
      }
    });

    if (document.documentElement) {
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  // ========================
  //  劫持 fetch
  // ========================
  const originalFetch = window.fetch;

  window.fetch = async function (...args) {
    const [input, init] = args;
    const url = typeof input === 'string' ? input : input?.url || '';
    const method = (init?.method || 'GET').toUpperCase();

    if (method !== 'POST') {
      return originalFetch.apply(this, args);
    }

    for (const rule of INTERCEPT_RULES) {
      if (rule.pattern.test(url)) {
        try {
          let bodyStr = '';
          if (init?.body) {
            if (typeof init.body === 'string') {
              bodyStr = init.body;
            } else if (init.body instanceof URLSearchParams) {
              bodyStr = init.body.toString();
            } else if (init.body instanceof FormData) {
              bodyStr = new URLSearchParams(init.body).toString();
            }
          }

          const parsed = rule.parseBody(bodyStr);
          if (!rule.shouldIntercept(parsed)) {
            break;
          }

          const response = await originalFetch.apply(this, args);
          const cloned = response.clone();

          cloned.json().then((json) => {
            if (json?.code !== 0) {
              return;
            }

            const suppressedFavorite = rule.name === 'favorite'
              ? takeSuppressedFavoriteRequest(parsed)
              : null;

            if (suppressedFavorite) {
              console.log('[BiliPilot] 跳过已接管的 favorite 事件', parsed);
              emitToast(
                '收藏归类成功',
                `「${suppressedFavorite.title || `AV${parsed.rid}`}」已自动归类到「${suppressedFavorite.targetFolderName || '目标收藏夹'}」`
              );
              return;
            }

            emitEvent(rule.name, {
              ...parsed,
              url,
              response: json,
            });
            console.log(`[BiliPilot] 捕获到 ${rule.name} 操作`, parsed);
          }).catch(() => {
            // ignore
          });

          return response;
        } catch (err) {
          console.warn(`[BiliPilot] 拦截 ${rule.name} 出错:`, err);
          return originalFetch.apply(this, args);
        }
      }
    }

    return originalFetch.apply(this, args);
  };

  // ========================
  //  劫持 XMLHttpRequest
  // ========================
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__bilipilot_method = method;
    this.__bilipilot_url = url;
    return originalXHROpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (body) {
    const method = (this.__bilipilot_method || '').toUpperCase();
    const url = this.__bilipilot_url || '';

    if (method === 'POST') {
      for (const rule of INTERCEPT_RULES) {
        if (rule.pattern.test(url)) {
          try {
            const bodyStr = typeof body === 'string' ? body : (body?.toString() || '');
            const parsed = rule.parseBody(bodyStr);

            if (!rule.shouldIntercept(parsed)) {
              break;
            }

            this.addEventListener('load', function () {
              try {
                const json = JSON.parse(this.responseText);
                if (json?.code !== 0) {
                  return;
                }

                const suppressedFavorite = rule.name === 'favorite'
                  ? takeSuppressedFavoriteRequest(parsed)
                  : null;

                if (suppressedFavorite) {
                  console.log('[BiliPilot] 跳过已接管的 favorite XHR 事件', parsed);
                  emitToast(
                    '收藏归类成功',
                    `「${suppressedFavorite.title || `AV${parsed.rid}`}」已自动归类到「${suppressedFavorite.targetFolderName || '目标收藏夹'}」`
                  );
                  return;
                }

                emitEvent(rule.name, {
                  ...parsed,
                  url,
                  response: json,
                });
                console.log(`[BiliPilot] XHR 捕获到 ${rule.name} 操作`, parsed);
              } catch {
                // ignore
              }
            });
          } catch (err) {
            console.warn('[BiliPilot] XHR 拦截出错:', err);
          }
          break;
        }
      }
    }

    return originalXHRSend.call(this, body);
  };

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (!event.data || event.data.type !== BILIBOARD_PAGE_REQ) return;

    const actionMap = {
      dashboard: () => fetchDashboardData(event.data.module),
      loginStatus: () => fetchLoginStatus(),
      apiRequest: () => {
        if (event.data.method === 'POST') {
          return pageApiPost(event.data.path, event.data.formData || {});
        }
        if (event.data.useWbi) {
          return pageApiGetWithWbi(event.data.path, event.data.params || {});
        }
        return pageApiGet(event.data.path, event.data.params || {});
      },
    };

    const handler = actionMap[event.data.action];
    if (!handler) {
      return;
    }

    handler().then((data) => {
      window.postMessage({
        type: BILIBOARD_PAGE_RES,
        requestId: event.data.requestId,
        payload: { error: false, data },
      }, '*');
    }).catch((error) => {
      window.postMessage({
        type: BILIBOARD_PAGE_RES,
        requestId: event.data.requestId,
        payload: { error: true, message: error.message },
      }, '*');
    });
  });

  initFavoriteDialogAutomation();
  console.log('[BiliPilot] 拦截器已注入 ✅');
})();
