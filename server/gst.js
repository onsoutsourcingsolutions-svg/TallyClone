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

// Fallback using Node https for environments where fetch fails (e.g., GST portal blocking)
async function fetchWithHttps(url) {
  const https = await import('node:https');
  const http = await import('node:http');
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'image/*,*/*',
        'Referer': 'https://services.gst.gov.in/services/searchtp'
      },
      timeout: 15000
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        // Mock fetch-like response
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          headers: {
            get: (name) => {
              const n = name.toLowerCase();
              if (n === 'content-type') return res.headers['content-type'] || '';
              if (n === 'set-cookie') return res.headers['set-cookie']?.join('; ') || '';
              return res.headers[n] || null;
            },
            getSetCookie: () => res.headers['set-cookie'] || []
          },
          arrayBuffer: async () => buf
        });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('HTTPS timeout'));
    });
  });
}

const GST_CAPTCHA_URL = 'https://services.gst.gov.in/services/captcha?rnd=';
const GST_DETAILS_URL = 'https://services.gst.gov.in/services/api/search/taxpayerDetails';
const INVALID_GST_CODE = 'SWEB_9035';
const INVALID_CAPTCHA_CODE = 'SWEB_9000';

export async function getGSTCaptcha() {
  cleanupCaptcha();
  
  // Try multiple methods to get captcha
  const methods = [
    // Method 1: Direct fetch with standard headers
    async () => {
      const url = GST_CAPTCHA_URL + Math.random();
      const r = await fetchWithTimeout(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://services.gst.gov.in/services/searchtp',
          'Origin': 'https://services.gst.gov.in'
        }
      }, 15000);
      return r;
    },
    // Method 2: Fetch search page first to get session, then captcha
    async () => {
      await fetchWithTimeout('https://services.gst.gov.in/services/searchtp', {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      }, 8000).catch(() => {});
      const url = GST_CAPTCHA_URL + Math.random();
      const r = await fetchWithTimeout(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'image/*',
          'Referer': 'https://services.gst.gov.in/services/searchtp'
        }
      }, 15000);
      return r;
    },
    // Method 3: Try with minimal headers
    async () => {
      const url = GST_CAPTCHA_URL + Math.random();
      const r = await fetchWithTimeout(url, { method: 'GET' }, 15000);
      return r;
    },
    // Method 4: Try with Node https directly (bypasses fetch issues)
    async () => {
      const url = GST_CAPTCHA_URL + Math.random();
      const r = await fetchWithHttps(url);
      return r;
    }
  ];

  let lastError = null;
  for (let i = 0; i < methods.length; i++) {
    try {
      const r = await methods[i]();
      if (!r.ok) {
        lastError = new Error(`GST portal HTTP ${r.status} (method ${i+1})`);
        continue;
      }
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 100) {
        lastError = new Error(`GST captcha too small (${buf.length} bytes) - portal blocking (method ${i+1})`);
        continue;
      }

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
        expires_in: CAPTCHA_TTL,
        method: i+1
      };
    } catch (e) {
      lastError = e;
      console.warn(`GST captcha method ${i+1} failed:`, e.message);
      continue;
    }
  }

  // All methods failed - provide helpful error
  throw new Error(
    `Could not reach GST portal for captcha after ${methods.length} attempts. ` +
    `Last error: ${lastError?.message || 'unknown'}. ` +
    `This can happen if: (1) Internet is down, (2) GST portal is blocking, ` +
    `(3) Firewall/antivirus blocking. Try: check internet, disable VPN, ` +
    `or use offline GSTIN validation (still works for saving ledgers). ` +
    `You can also manually check at https://services.gst.gov.in/services/searchtp`
  );
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
// These are tried before captcha flow, and also when captcha fails
// These give automatic fill like Tally (Tally is a GSP with official API access)
async function fetchGSTDetailsFallback(gstin, opts = {}) {
  // Get custom API keys from env or from Settings (for Tally-like auto-fill without captcha)
  const customKeys = {
    gstinapi: opts.apiKey || process.env.GSTINAPI_KEY || process.env.GST_API_KEY || '',
    appyflow: opts.provider === 'appyflow' ? opts.apiKey : (process.env.APPYFLOW_KEY || ''),
    gstincheck: opts.provider === 'gstincheck' ? opts.apiKey : '',
    provider: opts.provider || 'auto'
  };
  // If provider is specific, only use that key
  if (customKeys.provider !== 'auto' && opts.apiKey) {
    if (customKeys.provider === 'gstinapi') customKeys.gstinapi = opts.apiKey;
    if (customKeys.provider === 'appyflow') customKeys.appyflow = opts.apiKey;
    if (customKeys.provider === 'gstincheck') customKeys.gstincheck = opts.apiKey;
  }

  const attempts = [
    // Method 1: Try with custom gstinapi.in key if provided (100 free lookups, no captcha like Tally)
    async () => {
      if (!customKeys.gstinapi) throw new Error('no gstinapi key');
      const r = await fetchWithTimeout(`https://www.gstinapi.in/v1/gstin/${gstin}`, {
        headers: { 'x-api-key': customKeys.gstinapi, 'Accept': 'application/json' }
      }, 8000);
      if (!r.ok) throw new Error('gstinapi http ' + r.status);
      const j = await r.json();
      if (j && (j.legal_name || j.trade_name || j.gstin)) {
        return {
          legal_name: j.legal_name || j.lgnm || '',
          trade_name: j.trade_name || j.tradeNam || j.legal_name || '',
          address: j.address || j.addr || '',
          status: j.status || j.sts || '',
          registration_date: j.registration_date || j.rgdt || '',
          pincode: j.pincode || '',
          taxpayer_type: j.taxpayer_type || j.dty || '',
          source: 'gstinapi',
          raw: j
        };
      }
      throw new Error('no data');
    },
    // Method 2: Try AppyFlow with key if provided (50 free, no captcha)
    async () => {
      if (!customKeys.appyflow) throw new Error('no appyflow key');
      const r = await fetchWithTimeout(`https://appyflow.in/api/verifyGST?gstNo=${gstin}&key_secret=${customKeys.appyflow}`, {
        headers: { 'Accept': 'application/json' }
      }, 8000);
      if (!r.ok) throw new Error('appyflow http ' + r.status);
      const j = await r.json();
      const info = j.taxpayerInfo || j.data || j;
      if (info && (info.lgnm || info.tradeNam || info.legal_name)) {
        const pradr = info.pradr || {};
        const addr = pradr.addr ? `${pradr.addr.bno||''} ${pradr.addr.st||''} ${pradr.addr.loc||''} ${pradr.addr.dst||''} ${pradr.addr.stcd||''} ${pradr.addr.pncd||''}` : (info.address || '');
        return {
          legal_name: info.lgnm || info.legal_name || '',
          trade_name: info.tradeNam || info.trade_name || info.lgnm || '',
          address: addr || '',
          status: info.sts || info.status || '',
          registration_date: info.rgdt || '',
          source: 'appyflow',
          raw: j
        };
      }
      throw new Error('no data');
    },
    // Method 2b: Try gstincheck.co.in with key (20 free, no captcha like Tally)
    async () => {
      if (!customKeys.gstincheck) throw new Error('no gstincheck key');
      const r = await fetchWithTimeout(`https://sheet.gstincheck.co.in/check/${customKeys.gstincheck}/${gstin}`, {
        headers: { 'Accept': 'application/json' }
      }, 8000);
      if (!r.ok) throw new Error('gstincheck http ' + r.status);
      const j = await r.json();
      const d = j.data || j;
      if (d && (d.legal_name || d.trade_name || d.lgnm || d.tradeNam)) {
        return {
          legal_name: d.legal_name || d.lgnm || '',
          trade_name: d.trade_name || d.tradeNam || d.legal_name || '',
          address: d.address || d.addr || d.pradr?.adr || '',
          status: d.status || d.sts || '',
          registration_date: d.registration_date || d.rgdt || '',
          source: 'gstincheck',
          raw: j
        };
      }
      throw new Error('no data');
    },
    // Method 3: Try GSTZen public (sometimes works without key)
    async () => {
      const r = await fetchWithTimeout(`https://api.gstzen.in/api/gstin/${gstin}`, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
      }, 8000);
      if (!r.ok) throw new Error('gstzen http ' + r.status);
      const j = await r.json();
      const d = j.data || j.result || j;
      if (d && (d.legal_name || d.lgnm || d.trade_name || d.tradeNam)) {
        return {
          legal_name: d.legal_name || d.lgnm || '',
          trade_name: d.trade_name || d.tradeNam || d.legal_name || '',
          address: d.address || d.addr || (d.pradr ? `${d.pradr.addr1||''} ${d.pradr.addr2||''}` : ''),
          status: d.status || d.sts || '',
          registration_date: d.registration_date || d.rgdt || '',
          pincode: d.pincode || d.pradr?.pncd || '',
          source: 'gstzen',
          raw: j
        };
      }
      throw new Error('no data');
    },
    // Method 4: Try Masters India public endpoint
    async () => {
      const r = await fetchWithTimeout(`https://commonapi.mastersindia.co/api/v1/saas/gstin/${gstin}`, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
      }, 8000);
      if (!r.ok) throw new Error('mastersindia http ' + r.status);
      const j = await r.json();
      if (j && j.data) {
        const d = j.data;
        return {
          legal_name: d.lgnm || d.legal_name || '',
          trade_name: d.tradeNam || d.trade_name || d.lgnm || '',
          address: d.pradr?.adr || d.address || '',
          status: d.sts || d.status || '',
          registration_date: d.rgdt || '',
          source: 'mastersindia',
          raw: j
        };
      }
      throw new Error('no data');
    },
    // Method 5: Try ezyGST
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
    // Method 6: Try GST Search public site scrape (no captcha)
    async () => {
      const r = await fetchWithTimeout(`https://www.gstsearch.in/api/gstin/${gstin}`, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
      }, 6000);
      if (!r.ok) throw new Error('gstsearch http ' + r.status);
      const j = await r.json();
      if (j && (j.legalName || j.tradeName || j.data)) {
        const d = j.data || j;
        return {
          legal_name: d.legalName || d.lgnm || '',
          trade_name: d.tradeName || d.tradeNam || d.legalName || '',
          address: d.address || '',
          status: d.status || '',
          raw: j
        };
      }
      throw new Error('no data');
    }
  ];
  
  // Try all methods in parallel for speed, return first success
  const results = await Promise.allSettled(attempts.map(fn => fn()));
  for (const res of results) {
    if (res.status === 'fulfilled' && res.value && (res.value.legal_name || res.value.trade_name)) {
      return res.value;
    }
  }
  
  // If parallel failed, try sequential with more logging
  for (const fn of attempts) {
    try {
      const data = await fn();
      if (data && (data.legal_name || data.trade_name)) return data;
    } catch (e) {
      console.warn('GST fallback failed:', e.message);
    }
  }
  return null;
}

export async function verifyGSTIN(gstin, opts = {}) {
  const v = validateGSTIN(gstin);
  if (!v.valid) return { ...v, verified: false, details: null };

  const cached = _cache.get(v.gstin);
  if (cached && Date.now() - cached.at < CACHE_TTL) {
    return { ...v, verified: !!cached.data, details: cached.data, cached: true };
  }

  // Try fallback free APIs first (no captcha needed) — if they work, return live data
  try {
    const details = await fetchGSTDetailsFallback(v.gstin, opts);
    if (details) {
      _cache.set(v.gstin, { at: Date.now(), data: details });
      return { ...v, verified: true, details, cached: false };
    }
  } catch (e) { console.warn("GST fallback error:", e.message); }

  // No live data, but GSTIN itself is valid — return offline parsed info
  // This is still usable - user can save ledger, live fetch is optional enhancement
  return {
    ...v,
    verified: false,
    details: null,
    needs_captcha: true,
    offline_valid: true,
    message: `GSTIN ✓ Valid — ${v.state_name} (${v.state_code}) · PAN ${v.pan} · Format and checksum verified. ${opts.apiKey ? "API key provided but live fetch failed — check key or try captcha." : "For Tally-like auto-fill without captcha, add free API key in Settings → GST auto-fill (gstinapi.in 100 free). Or click \"Get Captcha & Fetch Live\" if portal reachable."} You can still save ledger — offline validation is sufficient.`
  };
}

export { STATE_CODES };
