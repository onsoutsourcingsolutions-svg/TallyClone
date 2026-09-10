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
        extras: { auto_tax: f.auto_tax, tax_regime_default: f.regime },
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
    </div>
  );
}
