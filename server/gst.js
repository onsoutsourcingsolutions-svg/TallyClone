// server/gst.js — GSTIN verification & auto-pull with live captcha flow
// Validates GSTIN locally and fetches taxpayer details from official GST portal via captcha
// No paid key required — uses https://services.gst.gov.in/services/captcha + taxpayerDetails

const STATE_CODES = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh',
  '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan',
  '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh',
  '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura',
  '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand',
  '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
  '25': 'Daman and Diu', '26': 'Dadra and Nagar Haveli', '27': 'Maharashtra',
  '28': 'Andhra Pradesh', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep',
  '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana', '37': 'Andhra Pradesh (New)', '38': 'Ladakh', '97': 'Other Territory',
  '99': 'Centre Jurisdiction'
};

function charToValue(ch) {
  const code = ch.charCodeAt(0);
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 65 && code <= 90) return code - 55;
  if (code >= 97 && code <= 122) return code - 87;
  return 0;
}
function valueToChar(v) {
  if (v < 10) return String(v);
  return String.fromCharCode(v + 55);
}

function isValidChecksum(gstin) {
  if (!gstin || gstin.length !== 15) return false;
  const g = gstin.toUpperCase();
  let sum = 0;
  let factor = 1;
  for (let i = 0; i < 14; i++) {
    const code = charToValue(g[i]);
    if (code < 0 || code >= 36) return false;
    let product = code * factor;
    sum += Math.floor(product / 36) + (product % 36);
    factor = factor === 1 ? 2 : 1;
  }
  const checkCode = (36 - (sum % 36)) % 36;
  return valueToChar(checkCode) === g[14];
}

export function validateGSTIN(gstin) {
  if (!gstin) return { valid: false, error: 'GSTIN is empty' };
  const g = String(gstin).trim().toUpperCase().replace(/\s+/g, '');
  if (g.length !== 15) return { valid: false, error: 'GSTIN must be 15 characters' };
  const re = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
  if (!re.test(g)) return { valid: false, error: 'GSTIN format is invalid (should be 22ABCDE1234F1Z5)' };
  const stateCode = g.slice(0, 2);
  if (!STATE_CODES[stateCode]) return { valid: false, error: `Invalid state code ${stateCode}` };
  const pan = g.slice(2, 12);
  const panRe = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
  if (!panRe.test(pan)) return { valid: false, error: 'PAN part of GSTIN is invalid' };
  if (g[13] !== 'Z') return { valid: false, error: '13th character should be Z' };
  const checksumOk = isValidChecksum(g);
  if (!checksumOk) return { valid: false, error: 'GSTIN checksum failed — check last character' };
  return {
    valid: true,
    gstin: g,
    state_code: stateCode,
    state_name: STATE_CODES[stateCode],
    pan: pan,
    entity: g[12],
    checksum_valid: true
  };
}

// cache for verified GSTINs
const _cache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000;

// captcha session store: captcha_id -> { cookie, at }
const _captchaStore = new Map();
const CAPTCHA_TTL = 5 * 60 * 1000; // 5 min

function genId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function cleanupCaptcha() {
  const now = Date.now();
  for (const [k, v] of _captchaStore.entries()) {
    if (now - v.at > CAPTCHA_TTL) _captchaStore.delete(k);
  }
}

async function fetchWithTimeout(url, opts = {}, ms = 10000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    const r = await fetch(url, { ...opts, signal: controller.signal });
    return r;
  } finally {
    clearTimeout(t);
  }
}

const GST_CAPTCHA_URL = 'https://services.gst.gov.in/services/captcha?rnd=';
const GST_DETAILS_URL = 'https://services.gst.gov.in/services/api/search/taxpayerDetails';
const INVALID_GST_CODE = 'SWEB_9035';
const INVALID_CAPTCHA_CODE = 'SWEB_9000';

export async function getGSTCaptcha() {
  cleanupCaptcha();
  const url = GST_CAPTCHA_URL + Math.random();
  let r;
  try {
    r = await fetchWithTimeout(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://services.gst.gov.in/services/searchtp',
        'Origin': 'https://services.gst.gov.in'
      }
    }, 12000);
  } catch (e) {
    throw new Error('Could not reach GST portal for captcha — check internet. ' + e.message);
  }
  if (!r.ok) throw new Error('GST captcha service returned HTTP ' + r.status);

  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 100) throw new Error('GST captcha image too small — portal may be blocking.');

  // parse CaptchaCookie
  let cookie = '';
  try {
    const setCookies = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie') || ''];
    for (const sc of setCookies) {
      if (!sc) continue;
      const parts = sc.split(';');
      for (const p of parts) {
        const kv = p.trim().split('=');
        if (kv[0] === 'CaptchaCookie' && kv[1]) {
          cookie = kv[1];
          break;
        }
      }
      if (cookie) break;
    }
    // fallback: try to extract from raw header
    if (!cookie) {
      const raw = r.headers.get('set-cookie') || '';
      const m = /CaptchaCookie=([^;]+)/i.exec(raw);
      if (m) cookie = m[1];
    }
  } catch (_) {}

  if (!cookie) {
    // Some deployments return cookie via header x-captcha? try to still proceed but warn
    // We'll still store empty and let verification fail with clear message
    console.warn('GST captcha: no CaptchaCookie found in response');
  }

  const b64 = buf.toString('base64');
  const mime = r.headers.get('content-type') || 'image/png';
  const id = genId();
  _captchaStore.set(id, { cookie, at: Date.now() });

  return {
    captcha_id: id,
    captcha_cookie: cookie, // also return for debugging, but frontend should use id
    image_base64: b64,
    mime,
    data_uri: `data:${mime};base64,${b64}`,
    expires_in: CAPTCHA_TTL
  };
}

function parseGSTResponse(j) {
  if (!j) return null;
  // j may be the taxpayer object directly
  const pradr = j.pradr || {};
  const addrParts = [
    pradr.addr1, pradr.addr2, pradr.addrBnm, pradr.addrSt, pradr.addrLoc,
    pradr.dst, pradr.stcd ? STATE_CODES[pradr.stcd] || pradr.stcd : '',
    pradr.pncd
  ].filter(Boolean);
  // Build address string
  const address = pradr.adr || addrParts.join(', ') || [j.pradr?.adr, j.adadr?.[0]?.adr].filter(Boolean).join(' | ');

  return {
    legal_name: j.lgnm || '',
    trade_name: j.tradeNam || j.tradeName || j.lgnm || '',
    address: address || '',
    state_code: pradr.stcd || j.stcd || '',
    pincode: pradr.pncd || '',
    status: j.sts || '',
    registration_date: j.rgdt || j.registrationDate || '',
    taxpayer_type: j.dty || j.ctb || j.txpType || '',
    business_nature: j.nba ? (Array.isArray(j.nba) ? j.nba.join(', ') : j.nba) : '',
    center_jurisdiction: j.ctj || '',
    state_jurisdiction: j.stj || '',
    raw: j
  };
}

export async function verifyGSTINWithCaptcha(gstin, captcha, opts = {}) {
  const v = validateGSTIN(gstin);
  if (!v.valid) return { ...v, verified: false, details: null };

  let cookie = opts.captcha_cookie || '';
  if (!cookie && opts.captcha_id) {
    const rec = _captchaStore.get(opts.captcha_id);
    if (!rec) throw new Error('Captcha expired or invalid — please click Refresh Captcha and try again.');
    cookie = rec.cookie;
  }
  if (!cookie) throw new Error('Captcha session missing — get a new captcha first.');

  // Check cache first
  const cached = _cache.get(v.gstin);
  if (cached && Date.now() - cached.at < CACHE_TTL) {
    return { ...v, verified: !!cached.data, details: cached.data, cached: true };
  }

  let r;
  try {
    r = await fetchWithTimeout(GST_DETAILS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Origin': 'https://services.gst.gov.in',
        'Referer': 'https://services.gst.gov.in/services/searchtp',
        'Cookie': `CaptchaCookie=${cookie}`
      },
      body: JSON.stringify({ gstin: v.gstin, captcha: String(captcha).trim() })
    }, 15000);
  } catch (e) {
    throw new Error('Could not reach GST portal — check internet. ' + e.message);
  }

  const text = await r.text();
  let j;
  try { j = JSON.parse(text); } catch (_) { j = null; }

  if (!r.ok) {
    // GST portal returns 200 even for errors, but sometimes 400
    if (j && j.errorCode) {
      if (j.errorCode === INVALID_CAPTCHA_CODE) throw new Error('Invalid captcha — please re-enter the 6 characters shown in image and try again.');
      if (j.errorCode === INVALID_GST_CODE) throw new Error('GSTIN not found on GST portal — check number.');
      throw new Error(j.message || `GST portal error ${j.errorCode}`);
    }
    throw new Error(`GST portal returned HTTP ${r.status}: ${text.slice(0, 300)}`);
  }

  if (!j) throw new Error('GST portal returned unreadable response');

  if (j.errorCode) {
    if (j.errorCode === INVALID_CAPTCHA_CODE) throw new Error('Invalid captcha — the image text did not match. Click Refresh Captcha and try again.');
    if (j.errorCode === INVALID_GST_CODE) throw new Error(`GSTIN ${v.gstin} not found on GST portal.`);
    throw new Error(j.message || `GST error ${j.errorCode}`);
  }

  // j may have message null and data inside, or directly taxpayer object
  // According to earlier code, successful response has lgnm etc.
  const details = parseGSTResponse(j);
  if (!details || (!details.legal_name && !details.trade_name)) {
    // Try alternative field nesting
    if (j.data) {
      const d2 = parseGSTResponse(j.data);
      if (d2 && (d2.legal_name || d2.trade_name)) {
        _cache.set(v.gstin, { at: Date.now(), data: d2 });
        if (opts.captcha_id) _captchaStore.delete(opts.captcha_id);
        return { ...v, verified: true, details: d2, cached: false };
      }
    }
    throw new Error('GST portal returned no taxpayer data — try again or check GSTIN.');
  }

  _cache.set(v.gstin, { at: Date.now(), data: details });
  if (opts.captcha_id) _captchaStore.delete(opts.captcha_id);

  return { ...v, verified: true, details, cached: false };
}

// Fallback attempt using free public APIs (no captcha) — best effort
async function fetchGSTDetailsFallback(gstin) {
  const attempts = [
    async () => {
      const r = await fetchWithTimeout(`https://api.ezygst.in/api/gstin/${gstin}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      }, 6000);
      if (!r.ok) throw new Error('ezygst http ' + r.status);
      const j = await r.json();
      if (j && (j.legal_name || j.trade_name || j.data)) {
        const d = j.data || j;
        return {
          legal_name: d.legal_name || d.lgnm || '',
          trade_name: d.trade_name || d.tradeNam || d.legal_name || '',
          address: d.address || d.addr || '',
          status: d.status || '',
          registration_date: d.registration_date || '',
          raw: j
        };
      }
      throw new Error('no data');
    },
    async () => {
      const r = await fetchWithTimeout(`https://api.apyhub.com/validate/gst?gstin=${gstin}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      }, 6000);
      if (!r.ok) throw new Error('apyhub http ' + r.status);
      const j = await r.json();
      if (j && j.data) {
        const d = j.data;
        return {
          legal_name: d.legal_name || d.lgnm || '',
          trade_name: d.trade_name || d.tradeNam || d.legal_name || '',
          address: d.address || '',
          status: d.status || d.sts || '',
          registration_date: d.registration_date || d.rgdt || '',
          raw: j
        };
      }
      throw new Error('no data');
    }
  ];
  for (const fn of attempts) {
    try {
      const data = await fn();
      if (data && (data.legal_name || data.trade_name)) return data;
    } catch (_) {}
  }
  return null;
}

export async function verifyGSTIN(gstin) {
  const v = validateGSTIN(gstin);
  if (!v.valid) return { ...v, verified: false, details: null };

  const cached = _cache.get(v.gstin);
  if (cached && Date.now() - cached.at < CACHE_TTL) {
    return { ...v, verified: !!cached.data, details: cached.data, cached: true };
  }

  // Try fallback free APIs first (no captcha needed) — if they work, return live data
  try {
    const details = await fetchGSTDetailsFallback(v.gstin);
    if (details) {
      _cache.set(v.gstin, { at: Date.now(), data: details });
      return { ...v, verified: true, details, cached: false };
    }
  } catch (_) {}

  // No live data, but GSTIN itself is valid — return offline parsed info with message to use captcha flow
  return {
    ...v,
    verified: false,
    details: null,
    needs_captcha: true,
    message: 'GSTIN format is valid, but live details need captcha. Click "Get Captcha & Fetch Live" to pull name, address, status from GST portal.'
  };
}

export { STATE_CODES };
