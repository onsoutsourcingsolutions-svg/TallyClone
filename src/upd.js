// src/upd.js — tiny helpers for the one-click in-app updater.

export async function checkUpdate() {
  try {
    const r = await fetch('/api/update/check', { cache: 'no-store' });
    const j = await r.json();
    if (r.ok && j.ok) return j; // { current, latest, update, offline }
    return null;
  } catch (_) { return null; }
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
