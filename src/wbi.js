import crypto from 'crypto';
import path from 'path';

const MIXIN_KEY_ENC_TAB = [
  46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,
  27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,
  37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,
  22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52
];

function getMixinKey(raw) {
  return MIXIN_KEY_ENC_TAB.map(index => raw[index]).join('').slice(0, 32);
}

export function encWbi(params, imgUrl, subUrl) {
  const imgKey = path.basename(imgUrl).split('.')[0];
  const subKey = path.basename(subUrl).split('.')[0];
  const mixinKey = getMixinKey(imgKey + subKey);
  const chrFilter = /[!'()*]/g;
  const withWts = { ...params, wts: Math.floor(Date.now() / 1000) };
  const query = new URLSearchParams();

  for (const key of Object.keys(withWts).sort()) {
    query.append(key, String(withWts[key]).replace(chrFilter, ''));
  }

  const wRid = crypto
    .createHash('md5')
    .update(query.toString() + mixinKey)
    .digest('hex');

  query.append('w_rid', wRid);
  return query.toString();
}
