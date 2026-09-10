// tiny client API helper + shared state
import { createContext, useCallback, useContext, useEffect, useState } from 'react';

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
  const [view, setView] = useState({ name: 'gateway' });

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

  const value = { boot, setBoot, company, setCompany, busy, setBusy, toast, notify, view, setView, refreshBoot, refreshCompany };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
