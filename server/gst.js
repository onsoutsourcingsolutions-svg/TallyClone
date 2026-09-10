// server/gst.js — GSTIN verification & auto-pull
// Validates GSTIN locally and attempts to fetch taxpayer details from public GST APIs
// No paid key required — tries multiple free endpoints with graceful fallback

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
  if (code >= 48 && code <= 57) return code - 48; // 0-9
  if (code >= 65 && code <= 90) return code - 55; // A=10
  if (code >= 97 && code <= 122) return code - 87; // a=10
  return 0;
}
function valueToChar(v) {
  if (v < 10) return String(v);
  return String.fromCharCode(v + 55); // 10->A
}

// GSTIN checksum — mod 36 algorithm
function isValidChecksum(gstin) {
  if (!gstin || gstin.length !== 15) return false;
  const g = gstin.toUpperCase();
  let sum = 0;
  let factor = 1;
  for (let i = 0; i < 14; i++) {
    const code = charToValue(g[i]);
    if (code < 0 || code >= 36) return false;
    let product = code * factor;
    // add quotient + remainder
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

// simple in-memory cache
const _cache = new Map(); // gstin -> { at, data }
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24h

async function fetchWithTimeout(url, opts = {}, ms = 8000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    const r = await fetch(url, { ...opts, signal: controller.signal });
    return r;
  } finally {
    clearTimeout(t);
  }
}

// Try multiple public endpoints — best effort, no API key
async function fetchGSTDetails(gstin) {
  // 1) Try GST portal API (undocumented but often works)
  const attempts = [
    // GST portal taxpayer search (new)
    async () => {
      const r = await fetchWithTimeout('https://services.gst.gov.in/services/api/search/tp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ gstin })
      }, 7000);
      if (!r.ok) throw new Error('gst portal http ' + r.status);
      const j = await r.json();
      // Expected: { gstin, tradeNam, lgnm, pradr: { addr... }, sts, rgdt, ... }
      if (j && (j.tradeNam || j.lgnm || j.gstin)) {
        const addr = j.pradr ? [
          j.pradr.addr1, j.pradr.addr2, j.pradr.addrBnm, j.pradr.addrSt, j.pradr.addrLoc,
          j.pradr.dst, j.pradr.stcd, j.pradr.pncd
        ].filter(Boolean).join(', ') : '';
        return {
          legal_name: j.lgnm || '',
          trade_name: j.tradeNam || j.lgnm || '',
          address: addr,
          state_code: j.pradr?.stcd || '',
          pincode: j.pradr?.pncd || '',
          status: j.sts || '',
          registration_date: j.rgdt || '',
          taxpayer_type: j.dty || '',
          raw: j
        };
      }
      throw new Error('no data in gst portal response');
    },
    // 2) Try apyhub free (may need key but try)
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
          address: d.address || (d.pradr ? `${d.pradr.addr1 || ''} ${d.pradr.addr2 || ''}` : ''),
          status: d.status || d.sts || '',
          registration_date: d.registration_date || d.rgdt || '',
          raw: j
        };
      }
      throw new Error('no data');
    },
    // 3) Try eayou / gstincheck style (public)
    async () => {
      const r = await fetchWithTimeout(`https://api.eayou.in/api/gstin/${gstin}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      }, 6000);
      if (!r.ok) throw new Error('eayou http ' + r.status);
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
    }
  ];

  for (const fn of attempts) {
    try {
      const data = await fn();
      if (data && (data.legal_name || data.trade_name)) return data;
    } catch (_) {
      // try next
    }
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

  try {
    const details = await fetchGSTDetails(v.gstin);
    if (details) {
      _cache.set(v.gstin, { at: Date.now(), data: details });
      return { ...v, verified: true, details, cached: false };
    }
  } catch (_) {
    // ignore
  }
  // No external data, but GSTIN itself is valid — return local parsed info
  return {
    ...v,
    verified: false,
    details: null,
    message: 'GSTIN format is valid, but live details could not be fetched (internet or GST portal unavailable). You can still use it — address will be filled from state + PAN.'
  };
}

export { STATE_CODES };
