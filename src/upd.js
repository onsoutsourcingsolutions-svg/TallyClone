// src/upd.js — tiny helpers for the one-click in-app updater.
// v1.11.31: force=1 bypasses 5 sec cache, uses jsDelivr CDN + raw fallback for STILL NOT UPDATE case

export async function checkUpdate(force = false) {
  try {
    // v1.11.36: Always clear previous cache automatically when logo clicked — user request
    if (force) {
      try {
        if ('caches' in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map(k => caches.delete(k)));
        }
      } catch (_) {}
    }
    const url = force ? '/api/update/check?force=1&t=' + Date.now() + '_' + Math.random().toString(36).slice(2) : '/api/update/check?t=' + Date.now() + '_' + Math.random().toString(36).slice(2);
    const r = await fetch(url, { cache: 'no-store', headers: { 'cache-control': 'no-cache, no-store', 'pragma': 'no-cache' } });
    const j = await r.json();
    if (r.ok && j.ok) return j; // { current, latest, update, offline }
    return null;
  } catch (_) { return null; }
}

export async function forceUpdate() {
  let r;
  try {
    try { if ('caches' in window) { const keys = await caches.keys(); await Promise.all(keys.map(k => caches.delete(k))); } } catch (_) {}
    r = await fetch('/api/update/force', { method: 'POST', cache: 'no-store', headers: { 'cache-control': 'no-cache' } });
  } catch (_) {
    r = { ok: true, json: async () => ({ ok: true }) };
  }
  if (r && !r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error((j && j.error) || 'Force update could not start.');
  }
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) {
    await new Promise((res) => setTimeout(res, 1000));
    try {
      const p = await fetch('/api/ping?t=' + Date.now() + '_' + Math.random().toString(36).slice(2), { cache: 'no-store', headers: { 'cache-control': 'no-cache' } });
      if (p.ok) { 
        const url = new URL(window.location.href);
        url.searchParams.set('t', Date.now().toString());
        window.location.href = url.toString();
        return; 
      }
    } catch (_) {}
  }
  throw new Error('The app restarted — if this page did not reload by itself, press Ctrl+F5.');
}

// Ask the server to download + install the newest package. The server
// replies first, then restarts itself; we poll /api/ping until it is
// back, then hard-reload the page so the new build shows.
export async function applyUpdate() {
  let r;
  try {
    // v1.11.36: Clear cache before apply
    try { if ('caches' in window) { const keys = await caches.keys(); await Promise.all(keys.map(k => caches.delete(k))); } } catch (_) {}
    r = await fetch('/api/update/apply', { method: 'POST', cache: 'no-store', headers: { 'cache-control': 'no-cache' } });
  } catch (_) {
    r = { ok: true, json: async () => ({ ok: true }) };
  }
  if (r && !r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error((j && j.error) || 'Update could not start.');
  }
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) {
    await new Promise((res) => setTimeout(res, 1000));
    try {
      const p = await fetch('/api/ping?t=' + Date.now() + '_' + Math.random().toString(36).slice(2), { cache: 'no-store', headers: { 'cache-control': 'no-cache' } });
      if (p.ok) { 
        // Hard reload with timestamp to bust cache
        const url = new URL(window.location.href);
        url.searchParams.set('t', Date.now().toString());
        window.location.href = url.toString();
        return; 
      }
    } catch (_) {}
  }
  throw new Error('The app restarted — if this page did not reload by itself, press Ctrl+F5.');
}
