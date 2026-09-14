// server/gst.js — GSTIN verification & auto-pull — v1.11.19 fixed
// Validates GSTIN locally and fetches taxpayer details via GSP API (Tally-like, no captcha) + official portal captcha fallback

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

// cache
const _cache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000;
const _captchaStore = new Map();
const CAPTCHA_TTL = 5 * 60 * 1000;

function genId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
function cleanupCaptcha() {
  const now = Date.now();
  for (const [k, v] of _captchaStore.entries()) {
    if (now - v.at > CAPTCHA_TTL) _captchaStore.delete(k);
  }
}

async function fetchWithTimeout(url, opts = {}, ms = 12000) {
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
  try {
    const r = await fetchWithTimeout(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'image/*,*/*',
        'Referer': 'https://services.gst.gov.in/services/searchtp',
        'Origin': 'https://services.gst.gov.in'
      }
    }, 15000);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 100) throw new Error('Captcha too small');
    let cookie = '';
    try {
      const scs = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
      for (const sc of scs) {
        const m = /CaptchaCookie=([^;]+)/i.exec(sc);
        if (m) { cookie = m[1]; break; }
      }
      if (!cookie) {
        const raw = r.headers.get('set-cookie') || '';
        const m = /CaptchaCookie=([^;]+)/i.exec(raw);
        if (m) cookie = m[1];
      }
    } catch (_) {}
    const b64 = buf.toString('base64');
    const mime = r.headers.get('content-type') || 'image/png';
    const id = genId();
    _captchaStore.set(id, { cookie, at: Date.now() });
    return {
      captcha_id: id,
      captcha_cookie: cookie,
      image_base64: b64,
      mime,
      data_uri: `data:${mime};base64,${b64}`,
      expires_in: CAPTCHA_TTL
    };
  } catch (e) {
    throw new Error(`Could not reach GST portal: ${e.message}. Offline validation still works. Check https://services.gst.gov.in/services/searchtp`);
  }
}

function parseGSTResponse(j) {
  if (!j) return null;
  const pradr = j.pradr || {};
  const addrParts = [
    pradr.addr1, pradr.addr2, pradr.addrBnm, pradr.addrSt, pradr.addrLoc,
    pradr.dst, pradr.stcd ? STATE_CODES[pradr.stcd] || pradr.stcd : '',
    pradr.pncd
  ].filter(Boolean);
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
    if (!rec) throw new Error('Captcha expired — Refresh and try again.');
    cookie = rec.cookie;
  }
  if (!cookie) throw new Error('Captcha session missing — get new captcha first.');
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
        'User-Agent': 'Mozilla/5.0',
        'Origin': 'https://services.gst.gov.in',
        'Referer': 'https://services.gst.gov.in/services/searchtp',
        'Cookie': `CaptchaCookie=${cookie}`
      },
      body: JSON.stringify({ gstin: v.gstin, captcha: String(captcha).trim() })
    }, 15000);
  } catch (e) {
    throw new Error('GST portal unreachable: ' + e.message);
  }
  const text = await r.text();
  let j;
  try { j = JSON.parse(text); } catch (_) { j = null; }
  if (!r.ok) {
    if (j && j.errorCode) {
      if (j.errorCode === INVALID_CAPTCHA_CODE) throw new Error('Invalid captcha — re-enter 6 chars.');
      if (j.errorCode === INVALID_GST_CODE) throw new Error('GSTIN not found on portal.');
      throw new Error(j.message || `GST error ${j.errorCode}`);
    }
    throw new Error(`HTTP ${r.status}: ${text.slice(0, 200)}`);
  }
  if (!j) throw new Error('Unreadable response');
  if (j.errorCode) {
    if (j.errorCode === INVALID_CAPTCHA_CODE) throw new Error('Invalid captcha — refresh and try again.');
    if (j.errorCode === INVALID_GST_CODE) throw new Error(`GSTIN ${v.gstin} not found.`);
    throw new Error(j.message || `GST error ${j.errorCode}`);
  }
  const details = parseGSTResponse(j);
  if (!details || (!details.legal_name && !details.trade_name)) {
    if (j.data) {
      const d2 = parseGSTResponse(j.data);
      if (d2 && (d2.legal_name || d2.trade_name)) {
        _cache.set(v.gstin, { at: Date.now(), data: d2 });
        if (opts.captcha_id) _captchaStore.delete(opts.captcha_id);
        return { ...v, verified: true, details: d2, cached: false };
      }
    }
    throw new Error('No taxpayer data returned — try again.');
  }
  _cache.set(v.gstin, { at: Date.now(), data: details });
  if (opts.captcha_id) _captchaStore.delete(opts.captcha_id);
  return { ...v, verified: true, details, cached: false };
}

// ---------- NEW: Robust GSP API fetcher (Tally-like, no captcha) ----------
async function tryGSTINAPI(gstin, apiKey) {
  if (!apiKey) return null;
  const key = String(apiKey).trim();
  if (key.length < 10) throw new Error('API key too short — copy full gak_... from gstinapi.in dashboard');

  // Endpoints to try — gstinapi.in and gstinapi.com are different services
  const endpoints = [
    { url: `https://www.gstinapi.in/v1/gstin/${gstin}`, host: 'www.gstinapi.in' },
    { url: `https://gstinapi.in/v1/gstin/${gstin}`, host: 'gstinapi.in' },
    { url: `https://www.gstinapi.com/api/get-taxpayer-info/${gstin}`, host: 'gstinapi.com' },
    { url: `https://gstinapi.com/api/get-taxpayer-info/${gstin}`, host: 'gstinapi.com' },
  ];

  let lastErr = null;
  for (const ep of endpoints) {
    try {
      console.log(`[GST] Trying ${ep.host} for ${gstin}`);
      const r = await fetchWithTimeout(ep.url, {
        method: 'GET',
        headers: {
          'x-api-key': key,
          'Accept': 'application/json',
          'User-Agent': 'ONS-Books/1.0'
        }
      }, 10000);

      const text = await r.text();
      let j;
      try { j = JSON.parse(text); } catch (_) { j = null; }

      if (r.status === 401) {
        throw new Error(`Invalid API key for ${ep.host} — check Settings → GST API key. Make sure you copied gak_... correctly from ${ep.host}. (HTTP 401)`);
      }
      if (r.status === 402) {
        throw new Error(`API credits exhausted for ${ep.host} — free 100/month used. Recharge or wait next month. (HTTP 402)`);
      }
      if (r.status === 404) {
        // GSTIN not found is valid response, not key error
        if (j && j.message && /not found/i.test(j.message)) {
          throw new Error(`GSTIN ${gstin} not found on GST database (checked via ${ep.host}).`);
        }
        lastErr = new Error(`GSTIN not found on ${ep.host}`);
        continue; // try next endpoint
      }
      if (r.status === 429) {
        throw new Error(`Rate limit hit for ${ep.host} — wait 1 min and try again (HTTP 429)`);
      }
      if (!r.ok) {
        lastErr = new Error(`${ep.host} HTTP ${r.status}: ${text.slice(0, 200)}`);
        continue;
      }

      // Parse successful response — handle both gstinapi.in and gstinapi.com schemas
      if (!j) {
        lastErr = new Error(`${ep.host} returned non-JSON`);
        continue;
      }

      // gstinapi.in schema: { gstin, legal_name, trade_name, status, taxpayer_type, state_code, address, pincode, ... }
      // gstinapi.com schema: { taxpayerInfo: { ... } } or { data: { ... } } or direct
      const d = j.data || j.taxpayerInfo || j.result || j;

      const legal = d.legal_name || d.lgnm || d.legalName || j.legal_name || j.lgnm || '';
      const trade = d.trade_name || d.tradeNam || d.tradeName || j.trade_name || j.tradeNam || legal || '';
      const addr = d.address || d.addr || d.pradr?.adr || j.address || '';
      const status = d.status || d.sts || j.status || '';
      const pincode = d.pincode || d.pradr?.pncd || j.pincode || '';
      const stateCode = d.state_code || d.stcd || j.state_code || '';
      const regDate = d.registration_date || d.rgdt || j.registration_date || '';
      const taxType = d.taxpayer_type || d.dty || j.taxpayer_type || '';

      if (legal || trade) {
        return {
          legal_name: legal,
          trade_name: trade,
          address: addr,
          status: status,
          pincode: pincode,
          state_code: stateCode,
          registration_date: regDate,
          taxpayer_type: taxType,
          source: ep.host,
          raw: j
        };
      }

      lastErr = new Error(`${ep.host} returned no name: ${text.slice(0, 300)}`);
    } catch (e) {
      // If it's a key error, throw immediately — don't try other hosts with same bad key
      if (/Invalid API key|credits exhausted|Rate limit/i.test(e.message)) {
        throw e;
      }
      lastErr = e;
      console.warn(`[GST] ${ep.host} failed:`, e.message);
    }
  }

  if (lastErr) throw lastErr;
  return null;
}

async function tryFreePublicAPIs(gstin) {
  // Try free public APIs without key — best effort, many are blocked but worth trying
  const tries = [
    async () => {
      const r = await fetchWithTimeout(`https://api.gstzen.in/api/gstin/${gstin}`, { headers: { 'Accept': 'application/json' } }, 6000);
      if (!r.ok) throw new Error('gstzen ' + r.status);
      const j = await r.json();
      const d = j.data || j.result || j;
      if (d && (d.legal_name || d.lgnm)) {
        return {
          legal_name: d.legal_name || d.lgnm || '',
          trade_name: d.trade_name || d.tradeNam || d.legal_name || '',
          address: d.address || d.addr || '',
          status: d.status || d.sts || '',
          pincode: d.pincode || '',
          source: 'gstzen',
          raw: j
        };
      }
      throw new Error('no data');
    },
    async () => {
      const r = await fetchWithTimeout(`https://commonapi.mastersindia.co/api/v1/saas/gstin/${gstin}`, { headers: { 'Accept': 'application/json' } }, 6000);
      if (!r.ok) throw new Error('masters ' + r.status);
      const j = await r.json();
      if (j && j.data) {
        const d = j.data;
        return {
          legal_name: d.lgnm || '',
          trade_name: d.tradeNam || d.lgnm || '',
          address: d.pradr?.adr || '',
          status: d.sts || '',
          source: 'mastersindia',
          raw: j
        };
      }
      throw new Error('no data');
    }
  ];

  for (const fn of tries) {
    try {
      const data = await fn();
      if (data) return data;
    } catch (e) {
      console.warn('[GST] free API failed:', e.message);
    }
  }
  return null;
}

async function fetchGSTDetailsFallback(gstin, opts = {}) {
  const apiKey = (opts.apiKey || '').trim();
  const provider = (opts.provider || 'auto').toLowerCase();

  // 1. If API key provided, try GSP APIs first (Tally-like, no captcha)
  if (apiKey) {
    try {
      // If provider is specific, we still try gstinapi first as it is most reliable
      const data = await tryGSTINAPI(gstin, apiKey);
      if (data) return data;
    } catch (e) {
      // Key errors should be surfaced to user, not silently ignored
      if (/Invalid API key|credits exhausted|Rate limit|not found/i.test(e.message)) {
        throw e; // let verifyGSTIN show this error
      }
      console.warn('[GST] GSP API failed, trying free:', e.message);
    }

    // Try AppyFlow if provider is appyflow
    if (provider === 'appyflow' || provider === 'auto') {
      try {
        const r = await fetchWithTimeout(`https://appyflow.in/api/verifyGST?gstNo=${gstin}&key_secret=${apiKey}`, { headers: { 'Accept': 'application/json' } }, 8000);
        if (r.ok) {
          const j = await r.json();
          const info = j.taxpayerInfo || j.data || j;
          if (info && (info.lgnm || info.tradeNam)) {
            const pradr = info.pradr || {};
            const addr = pradr.addr ? `${pradr.addr.bno||''} ${pradr.addr.st||''} ${pradr.addr.loc||''} ${pradr.addr.dst||''}`.trim() : (info.address || '');
            return {
              legal_name: info.lgnm || '',
              trade_name: info.tradeNam || info.lgnm || '',
              address: addr,
              status: info.sts || '',
              registration_date: info.rgdt || '',
              source: 'appyflow',
              raw: j
            };
          }
        }
      } catch (e) {
        console.warn('[GST] appyflow failed:', e.message);
      }
    }

    // Try gstincheck if provider is gstincheck
    if (provider === 'gstincheck') {
      try {
        const r = await fetchWithTimeout(`https://sheet.gstincheck.co.in/check/${apiKey}/${gstin}`, { headers: { 'Accept': 'application/json' } }, 8000);
        if (r.ok) {
          const j = await r.json();
          const d = j.data || j;
          if (d && (d.legal_name || d.lgnm)) {
            return {
              legal_name: d.legal_name || d.lgnm || '',
              trade_name: d.trade_name || d.tradeNam || d.legal_name || '',
              address: d.address || d.pradr?.adr || '',
              status: d.status || d.sts || '',
              source: 'gstincheck',
              raw: j
            };
          }
        }
      } catch (e) {
        console.warn('[GST] gstincheck failed:', e.message);
      }
    }
  }

  // 2. Try free public APIs without key
  try {
    const freeData = await tryFreePublicAPIs(gstin);
    if (freeData) return freeData;
  } catch (_) {}

  return null;
}

export async function verifyGSTIN(gstin, opts = {}) {
  const v = validateGSTIN(gstin);
  if (!v.valid) return { ...v, verified: false, details: null };

  const cached = _cache.get(v.gstin);
  if (cached && Date.now() - cached.at < CACHE_TTL) {
    return { ...v, verified: !!cached.data, details: cached.data, cached: true };
  }

  // Try GSP / free APIs (Tally-like, no captcha)
  try {
    const details = await fetchGSTDetailsFallback(v.gstin, opts);
    if (details && (details.legal_name || details.trade_name)) {
      _cache.set(v.gstin, { at: Date.now(), data: details });
      return {
        ...v,
        verified: true,
        details,
        cached: false,
        message: `✓ Verified LIVE via ${details.source} — ${details.trade_name || details.legal_name} — auto-filled (Tally-like, no captcha)`
      };
    }
  } catch (e) {
    // If API key error, return it as error so UI shows why auto-fill failed
    const msg = e.message || String(e);
    if (/Invalid API key|credits exhausted|Rate limit/i.test(msg)) {
      return {
        ...v,
        verified: false,
        details: null,
        api_error: true,
        error: msg,
        offline_valid: true,
        needs_captcha: false,
        message: `GSTIN ✓ Format valid (${v.state_name}, PAN ${v.pan}) but GSP API failed: ${msg}. Fix API key in Settings → GST auto-fill, or use captcha fallback.`
      };
    }
    if (/not found/i.test(msg)) {
      return {
        ...v,
        verified: false,
        details: null,
        error: msg,
        offline_valid: false,
        message: msg
      };
    }
    console.warn('[GST] fallback error:', msg);
  }

  // No live data, but GSTIN format valid — return offline info (PAN auto-fill still works)
  return {
    ...v,
    verified: false,
    details: null,
    needs_captcha: true,
    offline_valid: true,
    message: `GSTIN ✓ Valid — ${v.state_name} (${v.state_code}) · PAN ${v.pan} · Checksum OK. ${opts.apiKey ? 'API key present but live fetch failed — check key, credits, internet, or try captcha.' : 'For Tally-like auto-fill without captcha: add free API key in Settings → GST auto-fill (gstinapi.in gives 100 free/month, no card). Or click "Get Captcha & Fetch Live" for official portal.'} You can still save ledger — offline validation is sufficient.`
  };
}

export { STATE_CODES };
