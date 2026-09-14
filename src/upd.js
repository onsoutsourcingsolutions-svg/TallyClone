// src/upd.js — tiny helpers for the one-click in-app updater.
// v1.11.31: force=1 bypasses 5 sec cache, uses jsDelivr CDN + raw fallback for STILL NOT UPDATE case

export async function checkUpdate(force = false) {
  try {
    const url = force ? '/api/update/check?force=1&t=' + Date.now() : '/api/update/check?t=' + Date.now();
    const r = await fetch(url, { cache: 'no-store' });
    const j = await r.json();
    if (r.ok && j.ok) return j; // { current, latest, update, offline }
    return null;
  } catch (_) { return null; }
}

export async function forceUpdate() {
  let r;
  try {
    r = await fetch('/api/update/force', { method: 'POST', cache: 'no-store' });
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
      const p = await fetch('/api/ping?t=' + Date.now(), { cache: 'no-store' });
      if (p.ok) { window.location.reload(); return; }
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
    r = await fetch('/api/update/apply', { method: 'POST' });
  } catch (_) {
    // server may have restarted before answering — carry on polling
    r = { ok: true, json: async () => ({ ok: true }) };
  }
  if (r && !r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error((j && j.error) || 'Update could not start.');
  }
  const t0 = Date.now();
  while (Date.now() - t0 < 45000) {
    await new Promise((res) => setTimeout(res, 1000));
    try {
      const p = await fetch('/api/ping', { cache: 'no-store' });
      if (p.ok) { window.location.reload(); return; }
    } catch (_) { /* server is restarting — keep waiting */ }
  }
  throw new Error('The app restarted — if this page did not reload by itself, press Ctrl+F5.');
}
