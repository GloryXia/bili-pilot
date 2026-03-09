import axios from 'axios';
import { encWbi } from './wbi.js';
import { parseCsrf, sleep } from './utils.js';

export function createBiliClient(config, log) {
  const csrf = parseCsrf(config.biliCookie);

  const baseHeaders = {
    cookie: config.biliCookie,
    'user-agent': 'Mozilla/5.0',
    referer: 'https://space.bilibili.com/'
  };

  async function requestWithRetry(taskName, fn) {
    let lastError;
    for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        const status = error?.response?.status;
        const code = error?.response?.data?.code;
        const msg = error?.response?.data?.message || error?.message || String(error);
        log('请求失败', { taskName, attempt, status, code, msg });
        if (attempt < config.maxRetries) {
          await sleep(config.retryBaseDelayMs * (attempt + 1));
        }
      }
    }
    throw lastError;
  }

  function ensureOk(data, label) {
    if (data?.code !== 0) {
      throw new Error(`${label} 失败: ${data?.message || data?.code}`);
    }
    return data.data;
  }

  return {
    async getNav() {
      return requestWithRetry('getNav', async () => {
        const { data } = await axios.get('https://api.bilibili.com/x/web-interface/nav', { headers: baseHeaders });
        return ensureOk(data, 'getNav');
      });
    },

    async getFollowings(page) {
      return requestWithRetry('getFollowings', async () => {
        const { data } = await axios.get('https://api.bilibili.com/x/relation/followings', {
          headers: baseHeaders,
          params: {
            vmid: config.biliUid,
            pn: page,
            ps: config.pageSize,
            order: 'desc'
          }
        });
        return ensureOk(data, 'getFollowings')?.list || [];
      });
    },

    async getAccInfo(mid, nav) {
      return requestWithRetry('getAccInfo', async () => {
        const qs = encWbi({ mid }, nav.wbi_img.img_url, nav.wbi_img.sub_url);
        const { data } = await axios.get(`https://api.bilibili.com/x/space/wbi/acc/info?${qs}`, { headers: baseHeaders });
        return ensureOk(data, 'getAccInfo');
      });
    },

    async getRecentVideos(mid, nav) {
      return requestWithRetry('getRecentVideos', async () => {
        const qs = encWbi({ mid, pn: 1, ps: config.maxVideoSamples }, nav.wbi_img.img_url, nav.wbi_img.sub_url);
        const { data } = await axios.get(`https://api.bilibili.com/x/space/wbi/arc/search?${qs}`, { headers: baseHeaders });
        const body = ensureOk(data, 'getRecentVideos');
        return body?.list?.vlist || [];
      });
    },

    async getTags() {
      return requestWithRetry('getTags', async () => {
        const { data } = await axios.get('https://api.bilibili.com/x/relation/tags', { headers: baseHeaders });
        return ensureOk(data, 'getTags') || [];
      });
    },

    async createTag(name) {
      return requestWithRetry('createTag', async () => {
        const form = new URLSearchParams({ tag: name, csrf });
        const { data } = await axios.post('https://api.bilibili.com/x/relation/tag/create', form, {
          headers: { ...baseHeaders, 'content-type': 'application/x-www-form-urlencoded' }
        });
        const body = ensureOk(data, 'createTag');
        return body?.tagid;
      });
    },

    async assignTag(mid, tagId) {
      return requestWithRetry('assignTag', async () => {
        const endpoint = config.moveMode ? 'moveUsers' : 'addUsers';
        const form = new URLSearchParams({
          fids: String(mid),
          tagids: String(tagId),
          csrf
        });
        const { data } = await axios.post(`https://api.bilibili.com/x/relation/tags/${endpoint}`, form, {
          headers: { ...baseHeaders, 'content-type': 'application/x-www-form-urlencoded' }
        });
        ensureOk(data, endpoint);
        return true;
      });
    }
  };
}
