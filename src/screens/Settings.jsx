import { useEffect, useState } from 'react';
import { api, useApp } from '../state.jsx';
import { BUILD_TAG } from '../../version.js';
import { checkUpdate, applyUpdate } from '../upd.js';
import { STATE_CODES } from '../fmt.js';
import { initialsOf } from '../brand.jsx';

export function SettingsScreen() {
  const { company, boot, setCompany, notify, setView, refreshBoot, setBoot } = useApp();
  const [err, setErr] = useState('');
  const [f, setF] = useState(null);
  const [saved, setSaved] = useState(false);
  const [phoneUrls, setPhoneUrls] = useState([]);
  const [upd, setUpd] = useState(null); // update check result (null = checking)
  const [updBusy, setUpdBusy] = useState(false);
  const [updMsg, setUpdMsg] = useState('');
  useEffect(() => {
    fetch('/api/phone-info').then((r) => r.json()).then((j) => {
      if (j && j.ok) setPhoneUrls((j.urls || []).filter((u) => !/localhost|127\./.test(u)));
    }).catch(() => {});
  }, []);
  useEffect(() => { checkUpdate().then((j) => setUpd(j)); }, []);
  const thisUrl = typeof location !== 'undefined' ? location.origin : '';
  useEffect(() => {
    if (company) setF({
      name: company.name, address: company.address, city: company.city,
      state: company.state || 'Maharashtra', pincode: company.pincode,
      gstin: company.gstin, pan: company.pan,
      gst_enabled: !!company.gst_enabled, inventory_enabled: !!company.inventory_enabled,
      auto_tax: !!(company.extras && company.extras.auto_tax !== false),
      regime: (company.extras && company.extras.tax_regime_default) || 'intra',
      financial_year_from: company.financial_year_from,
      books_begin_from: company.books_begin_from,
      gst_api_key: (company.extras && company.extras.gst_api_key) || '',
      gst_api_provider: (company.extras && company.extras.gst_api_provider) || 'auto',
    });
  }, [company]);
  if (!company) return null;
  if (!f) return <div className="empty">Loading…</div>;
  const set = (k) => (e) => {
    setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
    setSaved(false);
  };
  const reloadCompany = async () => {
    const j = await api('/company');
    setCompany({ ...j.company, extras: j.extras, fy_end: j.fy_end, chart: j.chart });
  };
  const uploadLogo = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setErr('');
    try {
      const fd = new FormData();
      fd.append('logo', file);
      const r = await fetch('/api/company/logo', { method: 'POST', body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error((j && j.error) || 'Upload failed.');
      await reloadCompany();
      notify('Logo updated ✓');
    } catch (ex) { setErr(ex.message); }
  };
  const removeLogo = async () => {
    try {
      const r = await fetch('/api/company/logo', { method: 'DELETE' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error((j && j.error) || 'Remove failed.');
      await reloadCompany();
      notify('Logo removed');
    } catch (ex) { setErr(ex.message); }
  };
  const save = async () => {
    setErr('');
    try {
      await api('/company', { method: 'PATCH', body: {
        ...f, state_code: STATE_CODES[f.state] || company.state_code,
        extras: { auto_tax: f.auto_tax, tax_regime_default: f.regime, gst_api_key: f.gst_api_key, gst_api_provider: f.gst_api_provider },
      } });
      const j = await api('/company');
      setCompany({ ...j.company, extras: j.extras, fy_end: j.fy_end, chart: j.chart });
      setSaved(true);
      notify('Settings saved ✓');
    } catch (e) { setErr(e.message); }
  };
  const switchCompany = async (id, name) => {
    if (!window.confirm(`Switch to company "${name}"?`)) return;
    try {
      await api('/companies/' + id + '/activate', { method: 'POST' });
      const b = await refreshBoot();
      setBoot(b);
      const j = await api('/company');
      setCompany({ ...j.company, extras: j.extras, fy_end: j.fy_end, chart: j.chart });
      setView({ name: 'gateway' });
      notify('Switched to ' + name);
    } catch (e) { notify(e.message); }
  };
  return (
    <div style={{ maxWidth: 760 }}>
      <div className="pagetitle">
        <div><div className="crumb">Company</div><h1>Settings</h1></div>
      </div>
      {err && <div className="errbox">{err}</div>}
      <div className="card">
        <h3>Company profile</h3>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
          {company.logo
            ? <img className="logo-prev" src={`/api/company/logo?v=${encodeURIComponent(company.logo)}`} alt="logo" />
            : <div className="logo-mono-prev"><span>{initialsOf(company.name)}</span></div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label className="btn ghost sm" style={{ display: 'inline-block', textAlign: 'center', cursor: 'pointer' }}>
              {company.logo ? 'Change logo…' : 'Upload logo…'}
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" style={{ display: 'none' }} onChange={uploadLogo} />
            </label>
            {company.logo && <button className="btn danger sm" onClick={removeLogo}>Remove logo</button>}
            <span className="faint" style={{ fontSize: 11 }}>Shown at the top (sidebar & phone bar) — PNG/JPG/WebP, up to 3&nbsp;MB. Square works best.</span>
          </div>
        </div>
        <label className="f"><span>Name</span><input value={f.name} onChange={set('name')} /></label>
        <label className="f"><span>Address</span><textarea rows={2} value={f.address} onChange={set('address')} /></label>
        <div className="frow">
          <label className="f"><span>City</span><input value={f.city} onChange={set('city')} /></label>
          <label className="f"><span>State</span>
            <select value={f.state} onChange={set('state')}>{Object.keys(STATE_CODES).map((s) => <option key={s}>{s}</option>)}</select>
          </label>
          <label className="f"><span>PIN</span><input value={f.pincode} onChange={set('pincode')} /></label>
        </div>
        <div className="frow">
          <label className="f"><span>GSTIN</span><input value={f.gstin} onChange={set('gstin')} /></label>
          <label className="f"><span>PAN</span><input value={f.pan} onChange={set('pan')} /></label>
        </div>
      </div>
      <div className="card">
        <h3>Preferences</h3>
        <label className="chk"><input type="checkbox" checked={f.auto_tax} onChange={set('auto_tax')} /> Auto-calculate GST on stock-item invoices</label>
        <label className="f"><span>Default GST regime for invoices</span>
          <select value={f.regime} onChange={set('regime')}>
            <option value="intra">Intra-state — CGST + SGST</option>
            <option value="inter">Inter-state — IGST</option>
          </select>
        </label>
        <label className="chk"><input type="checkbox" checked={f.gst_enabled} onChange={set('gst_enabled')} /> GST enabled for this company</label>
        <label className="chk"><input type="checkbox" checked={f.inventory_enabled} onChange={set('inventory_enabled')} /> Inventory enabled (stock items on invoices)</label>
        <div style={{ marginTop: 10 }}>
          <button className="btn" onClick={save}>Save settings</button>
          {saved && <span className="badge gold" style={{ marginLeft: 10 }}>saved</span>}
        </div>
      </div>
      <div className="card" style={{ borderLeft: '4px solid var(--gold)' }}>
        <h3>🔑 GST auto-fill — like Tally (no captcha) — v1.11.19 FIXED</h3>
        <p className="muted" style={{ margin: '0 0 10px', fontSize: 13 }}>
          Tally is a registered GSP (you saw the list: Tally, Zoho, Masters India, ClearTax) so it fetches GSTIN without captcha via official GSTN API.
          You can get same automatic fill here by adding a free GSP API key — 100% automatic, no captcha. <b>v1.11.19 now tries gstinapi.in + gstinapi.com + free APIs, shows exact error if key invalid/credits exhausted.</b>
        </p>
        <div className="frow">
          <label className="f"><span>Provider (for Tally-like auto-fill)</span>
            <select value={f.gst_api_provider} onChange={set('gst_api_provider')}>
              <option value="auto">Auto — tries gstinapi.in, gstinapi.com, free APIs</option>
              <option value="gstinapi">gstinapi.in — 100 free/month, no card (recommended)</option>
              <option value="appyflow">appyflow.in — 50 free</option>
              <option value="gstincheck">gstincheck.co.in — 20 free</option>
            </select>
          </label>
          <label className="f"><span>API Key (for auto-fill without captcha)</span>
            <input value={f.gst_api_key} onChange={set('gst_api_key')} placeholder="gak_... (from gstinapi.in) or key_secret" style={{ fontFamily: 'var(--mono)', fontSize: 12 }} />
          </label>
        </div>
        <div className="faint" style={{ fontSize: 11.5, marginTop: 6, lineHeight: 1.6 }}>
          <b>How to get free key (Tally-like, 2 min):</b><br/>
          1. Go <b>https://www.gstinapi.in/register</b> → Sign up (email, no card) → Dashboard → <b>API Keys</b> → Copy key starting <code>gak_</code> → paste above → Save<br/>
          2. Alternative: <b>https://www.gstinapi.com</b> → Register → API Key → paste<br/>
          3. Click <b>Save GST API settings</b> → then go to <b>Masters → Ledgers → New ledger</b> → type GSTIN → <b>Verify & Auto-fill</b> → name/address/PAN auto-fills instantly (no captcha).<br/>
          <b>If it still says "Valid offline":</b> Check key is full (starts gak_), not expired, credits left (100/month free). Click Test below.<br/>
          Without key: app tries free public APIs + GST portal captcha. Offline (state+PAN) always works.
        </div>
        <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn" onClick={save}>Save GST API settings</button>
          <button className="btn ghost" onClick={async () => {
            const testGstin = prompt('Enter a GSTIN to test your API key (e.g. 27AAAPL1234C1ZP or any real GSTIN):', '27AAAPL1234C1ZP');
            if (!testGstin) return;
            setErr('');
            try {
              notify('Testing API key...');
              const j = await api('/gst/verify?gstin=' + encodeURIComponent(testGstin.trim()));
              if (j.api_error || j.error) {
                setErr(j.error || j.message);
                notify(j.error || 'API key test failed');
              } else if (j.verified && j.details) {
                notify(`✓ API key works! Fetched via ${j.details.source}: ${j.details.trade_name || j.details.legal_name}`);
              } else {
                setErr(j.message || 'No live data — check key, credits, internet');
                notify('Test returned offline only');
              }
            } catch (e) { setErr(e.message); }
          }}>🧪 Test API key with GSTIN</button>
          {saved && <span className="badge gold" style={{ marginLeft: 10 }}>saved</span>}
        </div>
      </div>
      <div className="card">
        <h3>Books period & companies</h3>
        <p className="muted" style={{ margin: '0 0 10px', fontSize: 13 }}>
          Books period: <b>{company.books_begin_from}</b> to <b>{company.fy_end}</b> ·
          FY {company.financial_year_from.slice(0, 4)}–{Number(company.financial_year_from.slice(0, 4)) + 1}
        </p>
        <div className="frow" style={{ marginBottom: 10 }}>
          <label className="f"><span>Financial year begins</span>
            <input type="date" value={f.financial_year_from} onChange={set('financial_year_from')} /></label>
          <label className="f"><span>Books begin from</span>
            <input type="date" value={f.books_begin_from} onChange={set('books_begin_from')} /></label>
        </div>
        <p className="faint" style={{ fontSize: 12, marginTop: -4 }}>
          Tip: Indian financial years begin 1 April. Vouchers can only be dated inside this period (e.g. set FY 2025-04-01 → books till 2026-03-31). Changeable while no vouchers exist.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn ghost" onClick={() => setView({ name: 'newcompany' })}>+ Create another company</button>
          <select style={{ maxWidth: 300 }} defaultValue="" onChange={(e) => e.target.value && switchCompany(Number(e.target.value.split('|')[0]), e.target.value.split('|')[1])}>
            <option value="" disabled>Switch company…</option>
            {(boot && boot.companies || []).map((c) => (
              <option key={c.id} value={c.id + '|' + c.name}>{c.name}{c.id === company.id ? ' (current)' : ''}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="card">
        <h3>Open this app on your phone / install it</h3>
        <p className="muted" style={{ margin: '0 0 10px', fontSize: 13 }}>
          The app is a website that can be installed like an app — no Play Store needed.
        </p>
        <p style={{ margin: '0 0 10px' }}>
          <span className="faint" style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase' }}>This device is using</span><br />
          <b style={{ fontFamily: 'var(--mono)', color: 'var(--gold-hi)', wordBreak: 'break-all' }}>{thisUrl}</b>
        </p>
        {phoneUrls.length > 0 && (
          <p style={{ margin: '0 0 10px' }}>
            <span className="faint" style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase' }}>On your phone (same Wi-Fi as this PC) open</span><br />
            {phoneUrls.map((u) => (
              <span key={u} style={{ display: 'inline-block', margin: '4px 8px 0 0' }}>
                <a className="btn ghost" style={{ fontFamily: 'var(--mono)', fontSize: 13, padding: '6px 12px', textDecoration: 'none' }} href={u} target="_blank" rel="noreferrer">{u.replace('http://', '')}</a>
              </span>
            ))}
          </p>
        )}
        <ul style={{ margin: '8px 0 0', paddingLeft: 20, lineHeight: 1.8, color: 'var(--ink-dim)', fontSize: 13.5 }}>
          <li><b>Android (Chrome):</b> open the link on the phone → menu ⋮ → <b>“Add to Home screen”</b> (or “Install app”) → Add. The gold-diamond app icon appears on your home screen.</li>
          <li><b>iPhone (Safari):</b> open the link on the phone → Share (⎋) → <b>“Add to Home Screen”</b> → Add.</li>
          <li>The installed icon opens the books full-screen. The PC server must be running and the phone must be on the same Wi-Fi.</li>
        </ul>
      </div>
      <div className="card">
        <h3>Update this copy — no download, no copy-paste</h3>
        <p className="muted" style={{ margin: '0 0 12px', fontSize: 13 }}>
          When a newer build is published, press <b>Update now</b>. This app downloads the new build,
          installs it over its own program files (<b>your data folder is never touched</b>) and restarts
          itself — then just press Ctrl+F5. Needs internet for a few seconds only.
        </p>
        {upd === null && !updMsg && <p className="faint" style={{ margin: 0 }}>Checking for a newer build…</p>}
        {upd && upd.update && upd.latest && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '4px 0 6px' }}>
            <span style={{ fontSize: 14 }}>
              <b style={{ color: 'var(--gold-hi)' }}>Build {upd.latest.replace(/ ·.*/, '')} is available</b>
              <span className="muted"> (you are on {upd.current.replace(/ ·.*/, '')})</span>
            </span>
            <button className="btn" style={{ padding: '7px 16px' }} disabled={updBusy} onClick={async () => {
              setUpdBusy(true); setUpdMsg('Downloading and installing — the app restarts itself in a few seconds…');
              try { await applyUpdate(); } catch (e) { setUpdMsg(e.message); setUpdBusy(false); }
            }}>
              {updBusy ? 'Installing…' : 'Update now'}
            </button>
          </div>
        )}
        {upd && !upd.update && !upd.offline && (
          <p style={{ margin: '4px 0 6px', fontSize: 14 }}>
            ✓ You are on the newest build — <b>{upd.current}</b>
          </p>
        )}
        {upd && upd.offline && (
          <p className="muted" style={{ margin: '4px 0 6px', fontSize: 13 }}>
            Could not reach the update server — this PC needs internet for a few seconds to check and install updates.
          </p>
        )}
        {updMsg && <p className="faint" style={{ margin: '4px 0 6px', fontSize: 12.5 }}>{updMsg}</p>}
        <p style={{ margin: '2px 0 0' }}>
          <button className="btn ghost" style={{ padding: '5px 12px', fontSize: 12.5 }} disabled={updBusy} onClick={async () => {
            setUpdMsg(''); setUpd(null);
            const j = await checkUpdate();
            setUpd(j);
            if (!j) setUpdMsg('Could not check for updates right now. Is this PC online?');
          }}>↻ Check again</button>
        </p>
      </div>
      <div className="card">
        <h3>About this copy</h3>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          <b>build {BUILD_TAG}</b> — this line is the proof that an update landed. If it still shows an old
          build after updating, press <b>Ctrl+F5</b> once (Help → “Still seeing the old version?”).
        </p>
      </div>
      <div className="card" style={{ borderLeft: '4px solid #2ecc71' }}>
        <h3>💾 Auto-backup — your data is safe</h3>
        <BackupPanel />
      </div>
      <div className="card" style={{ borderLeft: '4px solid #3498db' }}>
        <h3>🕒 System Date & Time Check — DD/MM/YYYY</h3>
        <SystemTimePanel />
      </div>
      <div className="card" style={{ borderLeft: '4px solid #9b59b6' }}>
        <h3>🔄 Auto-update — No need to close server manually</h3>
        <p className="muted" style={{ margin: '0 0 10px', fontSize: 13 }}>
          <b>v1.11.21 FIXED:</b> When you click <b>Update now</b>, server auto-restarts itself in 4 seconds — <b>you DON'T need to close CMD or press Ctrl+C</b>. It kills old port 8080, starts new server, deletes temp files. Just wait 10 sec and press <b>Ctrl+F5</b>. Fixed yellow error for space path like ADITYA MISHRA.
        </p>
        <ul style={{ margin: '0 0 0 18px', fontSize: 12.5, lineHeight: 1.7 }} className="muted">
          <li>Click <b>Update now</b> → browser shows "Downloading..." → server logs "Restarting after update..."</li>
          <li>Old server exits automatically → new bat waits 4 sec → starts node server/run.js</li>
          <li>Just keep browser open, wait for banner v1.11.21 in CMD, then Ctrl+F5</li>
          <li>If yellow popup still appears (old v1.11.6), run KILL_YELLOW_ERROR.bat once</li>
        </ul>
      </div>
    </div>
  );
}

function SystemTimePanel() {
  const { notify } = useApp();
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const load = async () => {
    setLoading(true);
    try {
      const j = await fetch('/api/system-time').then(r=>r.json());
      setInfo(j);
    } catch (e) {
      setInfo({ error: e.message });
    }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);
  if (loading) return <div className="empty">Checking system time...</div>;
  if (!info || info.error || !info.ok) return <div className="errbox">{info?.error || info?.message || 'Could not check time'}</div>;
  const st = info.serverTime;
  const it = info.internetTime;
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 13 }}>
        <div>
          <div className="faint" style={{ fontSize: 11, textTransform: 'uppercase' }}>This PC Server Time (DD/MM/YYYY)</div>
          <div style={{ fontSize: 16, fontWeight: 'bold', fontFamily: 'var(--mono)', marginTop: 4 }}>{st?.dd_mm_yyyy_hh_mm_ss}</div>
          <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>ISO: {st?.iso} · TZ: {st?.timezone} · Uptime: {Math.floor((st?.uptime_seconds||0)/60)} min</div>
        </div>
        <div>
          <div className="faint" style={{ fontSize: 11, textTransform: 'uppercase' }}>Internet Time (for verification)</div>
          {it ? (
            <>
              <div style={{ fontSize: 16, fontWeight: 'bold', fontFamily: 'var(--mono)', marginTop: 4 }}>{it.dd_mm_yyyy_hh_mm_ss}</div>
              <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>Source: {it.source} · Diff: {info.timeDiffMinutes} min</div>
            </>
          ) : (
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Internet time unavailable (offline) — {info.timeError || 'no internet'}</div>
          )}
        </div>
      </div>
      <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 6, background: info.timeOk ? '#eafaf1' : '#fdedec', border: `1px solid ${info.timeOk ? '#2ecc71' : '#e74c3c'}` }}>
        <div style={{ fontSize: 13, color: info.timeOk ? '#1e8449' : '#c0392b' }}>{info.message}</div>
        {!info.timeOk && (
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            <b>How to fix Windows time:</b> Settings → Time & Language → Date & Time → Turn ON "Set time automatically" and "Set time zone automatically" → Sync now.
          </div>
        )}
      </div>
      <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
        <button className="btn ghost sm" onClick={load}>↻ Re-check time now</button>
        <span className="faint" style={{ fontSize: 11 }}>All dates use DD/MM/YYYY (e.g. 15/09/2026) — system time must be correct for accurate books.</span>
      </div>
    </div>
  );
}

function BackupPanel() {
  const { notify } = useApp();
  const [backs, setBacks] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    try {
      const j = await api('/backups');
      setBacks(j.backups || []);
    } catch (e) { setBacks([]); }
  };
  useEffect(() => { load(); }, []);
  const create = async () => {
    setBusy(true);
    try {
      const j = await api('/backups/create', { method: 'POST', body: { reason: 'manual' } });
      notify('Backup created: ' + j.backup.name);
      load();
    } catch (e) { notify(e.message); }
    setBusy(false);
  };
  const download = (name) => {
    window.open('/api/backups/download/' + encodeURIComponent(name), '_blank');
  };
  const restore = async (name) => {
    if (!window.confirm(`Restore backup "${name}"? Current data will be backed up as pre-restore first.`)) return;
    setBusy(true);
    try {
      const j = await api('/backups/restore/' + encodeURIComponent(name), { method: 'POST' });
      notify('Restored ' + name + ' — refresh page');
      setTimeout(() => window.location.reload(), 1200);
    } catch (e) { notify(e.message); }
    setBusy(false);
  };
  return (
    <div>
      <p className="muted" style={{ margin: '0 0 10px', fontSize: 13 }}>
        Every time you start the app or click <b>Update now</b>, your <code>data/tally.db</code> is auto-backed up to <code>data/backups/</code>.
        Keeps last 20 backups. If you ever lose data (like extracting zip over folder), restore from here. You can also ask me to give you a backup — I can guide to download from this list.
      </p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <button className="btn sm" onClick={create} disabled={busy}>{busy ? '...' : '+ Create backup now'}</button>
        <button className="btn ghost sm" onClick={load} disabled={busy}>↻ Refresh list</button>
        <span className="faint" style={{ fontSize: 11 }}>Location on your PC: <code>C:\Users\ADITYA MISHRA\Desktop\TallyClone\data\backups\</code> (or your current path)</span>
      </div>
      {backs === null && <div className="empty">Loading backups…</div>}
      {backs && backs.length === 0 && <div className="empty">No backups yet — one will be created on next start / update. Create one manually above.</div>}
      {backs && backs.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table className="grid">
            <thead><tr><th>Backup file</th><th>Created</th><th className="tright">Size</th><th></th></tr></thead>
            <tbody>
              {backs.map(b => (
                <tr key={b.name}>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{b.name}</td>
                  <td className="muted" style={{ fontSize: 12 }}>{new Date(b.created).toLocaleString()}</td>
                  <td className="tright num">{b.size_kb} KB</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn ghost sm" onClick={() => download(b.name)}>Download</button>{' '}
                    <button className="btn danger sm" onClick={() => restore(b.name)}>Restore</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
