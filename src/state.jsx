// tiny client API helper + shared state
import { createContext, useCallback, useContext, useEffect, useState, useRef } from 'react';

export async function api(path, { body, method } = {}) {
  const res = await fetch('/api' + path, {
    method: method || (body ? 'POST' : 'GET'),
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null;
  try { j = await res.json(); } catch { /* not json */ }
  if (!res.ok || !j || !j.ok) throw new Error((j && j.error) || `Server error (${res.status})`);
  return j;
}

const Ctx = createContext(null);
export function useApp() { return useContext(Ctx); }

export function AppProvider({ children }) {
  const [boot, setBoot] = useState(null);     // {companies, active_company_id}
  const [company, setCompany] = useState(null); // company + extras + chart
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [view, setViewRaw] = useState({ name: 'gateway' });
  const historyRef = useRef([]);

  const notify = useCallback((msg) => {
    setToast(msg);
    window.clearTimeout(notify._t);
    notify._t = window.setTimeout(() => setToast(null), 2600);
  }, []);

  const refreshBoot = useCallback(async () => {
    const b = await api('/bootstrap');
    setBoot(b);
    return b;
  }, []);

  const refreshCompany = useCallback(async () => {
    const j = await api('/company');
    setCompany({ ...j.company, extras: j.extras, fy_end: j.fy_end, chart: j.chart });
    return j;
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const b = await refreshBoot();
        if (b.active_company_id) {
          try { await refreshCompany(); } catch { setCompany(null); }
        }
      } catch (e) { notify(e.message); }
    })();
  }, [refreshBoot, refreshCompany, notify]);

  // v1.11.44: ESC goes back — history stack + goBack
  const setView = useCallback((next) => {
    const n = typeof next === 'string' ? { name: next } : next;
    const cur = view;
    // Don't push duplicate or gateway->gateway
    if (JSON.stringify(cur) !== JSON.stringify(n)) {
      // Keep max 20 history
      historyRef.current = [...historyRef.current.slice(-19), cur];
    }
    setViewRaw(n);
    window.scrollTo(0, 0);
  }, [view]);

  const goBack = useCallback(() => {
    // If modal open (portal), let modal ESC handle first — check if any .portal exists
    const portals = document.querySelectorAll('.portal');
    if (portals.length > 0) {
      // Let modal's own ESC handler close it — dispatch ESC to close buttons? We close via clicking close if needed
      // Find close buttons inside portal and click first? Better to dispatch custom event that modals listen to
      // For now, if portal exists, don't navigate — modals will handle ESC themselves
      // But as fallback, close by removing portal? We rely on modals' own ESC listeners
      return false; // indicates modal might be open, don't navigate yet
    }
    const hist = historyRef.current;
    if (hist.length > 0) {
      const prev = hist[hist.length - 1];
      historyRef.current = hist.slice(0, -1);
      setViewRaw(prev);
      window.scrollTo(0, 0);
      return true;
    }
    // No history, go to gateway
    if (view.name !== 'gateway') {
      setViewRaw({ name: 'gateway' });
      window.scrollTo(0, 0);
      return true;
    }
    return false;
  }, [view]);

  const value = { boot, setBoot, company, setCompany, busy, setBusy, toast, notify, view, setView, goBack, refreshBoot, refreshCompany };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
