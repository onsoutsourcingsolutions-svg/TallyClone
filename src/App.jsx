import { Component, useEffect, useState } from 'react';
import { AppProvider, useApp, api } from './state.jsx';
import { checkUpdate, applyUpdate } from './upd.js';
import { CompanyBrand } from './brand.jsx';
import { CompanyScreen } from './screens/Company.jsx';
import { Gateway } from './screens/Gateway.jsx';
import { Masters } from './screens/Masters.jsx';
import { VoucherScreen } from './screens/Voucher.jsx';
import { DayBookScreen, EditLogScreen } from './screens/DayBook.jsx';
import { ReportsScreen } from './screens/Reports.jsx';
import { SettingsScreen } from './screens/Settings.jsx';
import { BUILD_TAG } from '../version.js';
import { HelpScreen } from './screens/Help.jsx';
import { DataScreen } from './screens/Data.jsx';
import { InvoiceImportScreen } from './screens/InvoiceImport.jsx';


function I({ c }) { return <span className="ic">{c}</span>; }

const NAV = [
  { sec: 'Home', items: [{ v: { name: 'gateway' }, label: 'Home', ic: '⌂' }] },
  {
    sec: 'Masters',
    items: [
      { v: { name: 'masters', tab: 'ledgers' }, label: 'Ledgers', ic: '☰' },
      { v: { name: 'masters', tab: 'items' }, label: 'Stock Items', ic: '▤' },
    ],
  },
  {
    sec: 'Transactions',
    items: [
      { v: { name: 'voucher', cls: 'receipt' }, label: 'Receipt', ic: '⇩' },
      { v: { name: 'voucher', cls: 'payment' }, label: 'Payment', ic: '⇧' },
      { v: { name: 'voucher', cls: 'contra' }, label: 'Contra', ic: '⇄' },
      { v: { name: 'voucher', cls: 'sales' }, label: 'Sales', ic: '➤' },
      { v: { name: 'voucher', cls: 'purchase' }, label: 'Purchase', ic: '⬅' },
      { v: { name: 'voucher', cls: 'journal' }, label: 'Journal', ic: '✎' },
      { v: { name: 'voucher', cls: 'credit_note' }, label: 'Credit Note', ic: '⇍' },
      { v: { name: 'voucher', cls: 'debit_note' }, label: 'Debit Note', ic: '⇏' },
      { v: { name: 'voucher', cls: 'stock_journal' }, label: 'Stock Journal', ic: '⇅' },
      { v: { name: 'daybook' }, label: 'Day Book', ic: '▤' },
    ],
  },
  {
    sec: 'Reports',
    items: [
      { v: { name: 'reports', which: 'bs' }, label: 'Balance Sheet', ic: '≡' },
      { v: { name: 'reports', which: 'pl' }, label: 'Profit & Loss', ic: '∑' },
      { v: { name: 'reports', which: 'tb' }, label: 'Trial Balance', ic: '⚖' },
      { v: { name: 'reports', which: 'ledger' }, label: 'Ledger', ic: '📖' },
      { v: { name: 'reports', which: 'stock' }, label: 'Stock Summary', ic: '📦' },
      { v: { name: 'reports', which: 'gst' }, label: 'GST Summary', ic: '✉' },
    ],
  },
  {
    sec: 'Audit',
    items: [
      { v: { name: 'editlog' }, label: 'Edit Log', ic: '☷' },
    ],
  },
  {
    sec: 'Company',
    items: [
      { v: { name: 'settings' }, label: 'Settings', ic: '⚙' },
      { v: { name: 'help' }, label: 'Help', ic: '?' },
    ],
  },
  {
    sec: 'Data',
    items: [
      { v: { name: 'data' }, label: 'Import / Export', ic: '⇅' },
      { v: { name: 'invoice_import' }, label: 'Invoice Excel → Print', ic: '🖨' },
    ],
  },
];

function Sidebar({ view, setView, onNav, company, open, onLogo }) {
  return (
    <aside className={`sidebar${open ? ' open' : ''}`} style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="brand">
        <CompanyBrand company={company} onClick={onLogo} title="Click to update to the newest build" />
      </div>
      {NAV.map((g, i) => (
        <div key={i}>
          <div className="navsec">{g.sec}</div>
          {g.items.map((it, j) => {
            const target = it.v;
            const on = JSON.stringify(view) === JSON.stringify(target) ||
              (typeof target === 'object' && target.name === view.name && (target.tab === view.tab || target.cls === view.cls || target.which === view.which));
            return (
              <button key={j} className={`navitem${on ? ' on' : ''}`} onClick={() => onNav(target)}>
                <I c={it.ic} /> {it.label}
              </button>
            );
          })}
        </div>
      ))}
      <div className="faint" style={{ fontSize: 10, letterSpacing: 1, padding: '10px 12px 8px', borderTop: '1px solid var(--gold-line-soft)', marginTop: 'auto' }}>
        build {BUILD_TAG}
      </div>
    </aside>
  );
}

function Shell() {
  const { boot, company, view, setView, setCompany, notify } = useApp();
  const [menuOpen, setMenuOpen] = useState(false);
  // A view may arrive as an object {name} or as a bare name string — normalize
  // so the screen switch below can never miss a screen (blank content bug).
  const vv = (typeof view === 'string' ? { name: view } : view) || { name: 'gateway' };
  const nav = (v) => { setView(v); setMenuOpen(false); window.scrollTo(0, 0); };

  // Clicking the logo always lands you on the newest build:
  // new version exists -> install it (app restarts itself); otherwise -> reload.
  const logoClick = async () => {
    setMenuOpen(false);
    notify('Checking for a newer build…');
    let j = null;
    try { j = await checkUpdate(); } catch (_) { j = null; }
    if (!j) { notify('No internet — could not check. Reloading the page…'); window.location.reload(); return; }
    if (j.update && j.latest) {
      notify('New build ' + String(j.latest).replace(/ ·.*/, '') + ' found — installing now…');
      try { await applyUpdate(); } catch (e) { notify(e.message); }
    } else {
      notify('You are on the newest build — reloading…');
      window.location.reload();
    }
  };

  useEffect(() => {
    document.title = company ? company.name : 'O.N.S. OUTSOURCING SOLUTIONS — Accounting';
  }, [company && company.name]);

  if (!boot) return <div className="content" style={{ color: 'var(--ink-dim)' }}>Loading…</div>;

  if (!company) {
    return (
      <div>
        {vv.name !== 'newcompany' &&
          <div style={{ maxWidth: 700, margin: '0 auto', padding: '30px 14px' }}>
            <h1 style={{ textAlign: 'center', marginBottom: 4 }}>◆ O.N.S. OUTSOURCING SOLUTIONS</h1>
            <p style={{ textAlign: 'center', color: 'var(--ink-dim)' }}>Tally-style double-entry accounting — GST & inventory ready</p>
            <div className="card" style={{ marginTop: 18 }}>
              <h3>Select company</h3>
              {!boot.companies.length && <p className="muted">No companies yet — create your first company.</p>}
              {boot.companies.map((c) => (
                <button key={c.id} className="btn ghost block" style={{ marginBottom: 8, textAlign: 'left' }}
                  onClick={async () => {
                    try {
                      await api('/companies/' + c.id + '/activate', { method: 'POST' });
                      await refreshCompanySafe();
                    } catch (e) { notify(e.message); }
                  }}>
                  <span style={{ fontWeight: 700, color: 'var(--gold-hi)' }}>{c.name}</span>
                  {c.financial_year_from && <span className="muted"> · FY {c.financial_year_from.slice(0, 4)}-{Number(c.financial_year_from.slice(0, 4)) + 1}</span>}{c.city ? ' · ' + c.city : ''}
                </button>
              ))}
              <button className="btn block" onClick={() => nav({ name: 'newcompany' })}>+ Create new company</button>
            </div>
          </div>
        }
        {vv.name === 'newcompany' && <CompanyScreen onDone={async () => { await refreshCompanySafe(); nav({ name: 'gateway' }); }} onCancel={() => nav({ name: 'gateway' })} />}
      </div>
    );
  }

  function refreshCompanySafe() {
    return api('/company').then((j) => {
      setCompany({ ...j.company, extras: j.extras, fy_end: j.fy_end, chart: j.chart });
    });
  }

  return (
    <div className="shell">
      <Sidebar view={vv} onNav={nav} company={company} open={menuOpen} onLogo={logoClick} />
      {menuOpen && <div className="scrim" onClick={() => setMenuOpen(false)} />}
      <div className="mtopbar no-print">
        <button className="hamb" onClick={() => setMenuOpen(!menuOpen)} title="Open / close menu">☰</button>
        <CompanyBrand company={company} compact onClick={logoClick} title="Click to update to the newest build" />
      </div>
      <div className="content">
        <Boundary key={JSON.stringify(vv)}>
        {vv.name === 'gateway' && <Gateway />}
        {vv.name === 'masters' && <Masters tab={vv.tab} />}
        {vv.name === 'voucher' && <VoucherScreen cls={vv.cls} />}
        {vv.name === 'daybook' && <DayBookScreen focusId={vv.id} />}
        {vv.name === 'reports' && <ReportsScreen which={vv.which} />}
        {vv.name === 'settings' && <SettingsScreen />}
        {vv.name === 'help' && <HelpScreen />}
        {vv.name === 'editlog' && <EditLogScreen />}
        {vv.name === 'data' && <DataScreen />}
        {vv.name === 'invoice_import' && <InvoiceImportScreen />}
        {vv.name === 'newcompany' && <CompanyScreen onDone={async () => { await refreshCompanySafe(); nav({ name: 'gateway' }); }} onCancel={() => nav({ name: 'gateway' })} />}
        </Boundary>
      </div>
    </div>
  );
}

export function App() {
  return (
    <AppProvider>
      <Boundary>
        <ToastHost />
        <Shell />
      </Boundary>
    </AppProvider>
  );
}

// If any screen ever crashes, show a gold error card instead of a black void.
class Boundary extends Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(e) { return { err: e }; }
  componentDidCatch(e) { try { console.error('Screen error:', e); } catch (_) { /* ignore */ } }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div className="content" style={{ maxWidth: 640, margin: '0 auto', padding: 26 }}>
        <div className="card">
          <h3>⚠ Something went wrong on this screen</h3>
          <p className="muted" style={{ fontSize: 13.5, wordBreak: 'break-word' }}>
            {String((this.state.err && this.state.err.message) || this.state.err)}
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            <button className="btn" onClick={() => this.setState({ err: null })}>Try again</button>
            <button className="btn ghost" onClick={() => window.location.reload()}>Reload page</button>
          </div>
          <p className="faint" style={{ fontSize: 12, marginTop: 12 }}>
            Your data is safe — nothing was changed. If this keeps happening, press Ctrl+F5 once.
          </p>
        </div>
      </div>
    );
  }
}

function ToastHost() {
  const { toast } = useApp();
  if (!toast) return null;
  return <div className="toast">{toast}</div>;
}
