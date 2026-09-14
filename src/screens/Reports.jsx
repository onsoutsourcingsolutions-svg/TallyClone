import { useEffect, useState } from 'react';
import { api, useApp } from '../state.jsx';
import { dlong, dshort, inr, qty, todayISO } from '../fmt.js';

function useData(fn, deps) {
  const { notify } = useApp();
  const [data, setData] = useState(undefined);
  const [err, setErr] = useState('');
  useEffect(() => {
    let alive = true;
    setData(undefined); setErr('');
    fn().then((j) => alive && setData(j)).catch((e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, deps);
  return [data, err];
}

function PeriodRow({ from, to, setFrom, setTo }) {
  return (
    <div className="frow" style={{ marginBottom: 10 }}>
      <label className="f"><span>From</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
      <label className="f"><span>To</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
    </div>
  );
}

function ReportFrame({ title, sub, children, err }) {
  return (
    <div>
      <div className="pagetitle">
        <div><div className="crumb">Reports</div><h1>{title}</h1></div>
        <button className="btn ghost no-print" onClick={() => window.print()}>🖨 Print</button>
      </div>
      {err && <div className="errbox">{err}</div>}
      {children}
      {!err && <div style={{ textAlign: 'center', color: 'var(--ink-faint)', fontSize: 11, marginTop: 14 }}>◆ {sub} · generated {new Date().toLocaleString('en-IN')}</div>}
    </div>
  );
}
ReportFrame.displayName = 'ReportFrame';

function MoneyCell({ p, bold }) {
  if (p === 0) return <td className="tright num faint">—</td>;
  return <td className={`tright num ${bold ? 'tbold' : ''} ${p < 0 ? 'neg' : ''}`}>{inr(p)}</td>;
}

/* ================= Balance Sheet ================= */
function BalanceSheetView() {
  const { company } = useApp();
  const [asOn, setAsOn] = useState(todayISO());
  const [data, err] = useData(() => api('/reports/balance-sheet?as_on=' + asOn), [asOn]);
  if (!data) return <div className="card"><div className="empty">{err || 'Loading…'}</div></div>;
  return (
    <div>
      <div className="card">
        <div className="frow"><label className="f"><span>As on</span><input type="date" value={asOn} onChange={(e) => setAsOn(e.target.value)} /></label></div>
      </div>
      {err && <div className="errbox">{err}</div>}
      {!err && data && (
        <div className="card print-area2">
          <div className="report-head">
            <div className="h1">Balance Sheet</div>
            <div className="h2">{company.name} · as at {dlong(data.as_on)} · (₹)</div>
          </div>
          <table className="grid">
            <tbody>
              {data.liabilities.map((sec) => (
                <SecRows key={'l' + sec.key} sec={sec} side="Liabilities" />
              ))}
              <tr className="grand-total"><td>Total Liabilities & Equity</td><td className="tright num">{inr(data.totals.liabilities)}</td></tr>
              <tr><td colSpan={2} style={{ height: 8, border: 'none' }}></td></tr>
              {data.assets.map((sec) => (
                <SecRows key={'a' + sec.key} sec={sec} side="Assets" />
              ))}
              <tr className="grand-total"><td>Total Assets</td><td className="tright num">{inr(data.totals.assets)}</td></tr>
            </tbody>
          </table>
          <p className="ledger-hint" style={{ marginTop: 8 }}>
            {data.balanced ? '✓ The Balance Sheet tallies.' : 'Balance Sheet does not tally — check opening balances (Dr = Cr).'}
          </p>
        </div>
      )}
    </div>
  );
}

function SecRows({ sec }) {
  if (!sec.rows.length) return null;
  return (
    <>
      <tr className="sec-row"><td colSpan={2} className="sec-head" style={{ border: 'none', padding: '14px 8px 4px' }}>{sec.label}</td></tr>
      {sec.rows.map((g, i) => (
        <RowGroup key={i} g={g} />
      ))}
      <tr className="sub-total"><td style={{ paddingLeft: 22 }}>Total of {sec.label}</td><td className="tright num">{inr(sec.amount)}</td></tr>
    </>
  );
}
function RowGroup({ g }) {
  return (
    <>
      {g.children.map((l, i) => (
        <tr key={i}><td style={{ paddingLeft: g.kind === 'profit' ? 16 : 26 }}>{l.name}</td><MoneyCell p={l.amount} /></tr>
      ))}
      {g.children.length > 1 && g.kind === 'group' && <tr className="row-bold"><td style={{ paddingLeft: 16 }}>{g.label} total</td><td className="tright num">{inr(g.amount)}</td></tr>}
      {g.kind === 'profit' && <tr className="row-bold"><td style={{ paddingLeft: 16 }}>{g.label}</td><td className="tright num">{inr(g.amount)}</td></tr>}
      {g.kind === 'loss' && <tr className="row-bold"><td style={{ paddingLeft: 16 }}>{g.label}</td><td className="tright num neg">{inr(g.amount)}</td></tr>}
    </>
  );
}

/* ================= P&L ================= */
function ProfitLossView() {
  const { company } = useApp();
  const [from, setFrom] = useState(company.books_begin_from);
  const [to, setTo] = useState(todayISO());
  const [data, err] = useData(() => api('/reports/profit-loss?from=' + from + '&to=' + to), [from, to, company]);
  if (!data) return <div className="card"><div className="empty">{err || 'Loading…'}</div></div>;
  const loss = data.netProfit < 0;
  return (
    <div>
      <div className="card"><PeriodRow from={from} to={to} setFrom={setFrom} setTo={setTo} /></div>
      {err && <div className="errbox">{err}</div>}
      {!err && (
        <div className="card">
          <div className="report-head">
            <div className="h1">Profit & Loss Account</div>
            <div className="h2">{company.name} · {dshort(from)} to {dshort(to)} · (₹)</div>
          </div>
          <table className="grid">
            <tbody>
              {data.sections.filter((s) => s.rows.length || s.key === 'tax_expense').map((s) => (
                <SecRows2 key={s.key} s={s} />
              ))}
              <tr className="grand-total">
                <td>{loss ? 'Net Loss for the period' : 'Net Profit for the period'}</td>
                <td className={`tright num ${loss ? 'neg' : ''}`}>{inr(loss ? -data.netProfit : data.netProfit)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
function SecRows2({ s }) {
  if (!s.rows.length) return null;
  return (
    <>
      <tr><td colSpan={2} className="sec-head" style={{ border: 'none', padding: '12px 8px 4px' }}>{s.label}</td></tr>
      {s.rows.map((r, i) => (
        <tr key={i}><td style={{ paddingLeft: 24 }}>{r.name}</td><MoneyCell p={r.amount} /></tr>
      ))}
      <tr className="sub-total"><td style={{ paddingLeft: 14 }}>Total of {s.label}</td><td className="tright num">{inr(s.total)}</td></tr>
    </>
  );
}

/* ================= Trial Balance ================= */
function TrialBalanceView() {
  const { company } = useApp();
  const [asOn, setAsOn] = useState(todayISO());
  const [data, err] = useData(() => api('/reports/trial-balance?as_on=' + asOn), [asOn]);
  if (!data) return <div className="card"><div className="empty">{err || 'Loading…'}</div></div>;
  return (
    <div>
      <div className="card">
        <div className="frow"><label className="f"><span>As on</span><input type="date" value={asOn} onChange={(e) => setAsOn(e.target.value)} /></label></div>
      </div>
      {err && <div className="errbox">{err}</div>}
      {!err && (
        <div className="card">
          <div className="report-head">
            <div className="h1">Trial Balance</div>
            <div className="h2">{company.name} · as at {dlong(data.as_on)} · (₹)</div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="grid">
              <thead><tr><th>Particulars</th><th>Group</th><th className="tright">Debit</th><th className="tright">Credit</th></tr></thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.account_id}><td>{r.name}</td><td className="muted">{r.group_name}</td>
                    <td className="tright num">{r.debit ? inr(r.debit) : ''}</td>
                    <td className="tright num">{r.credit ? inr(r.credit) : ''}</td></tr>
                ))}
                <tr className="grand-total"><td colSpan={2}>Total</td>
                  <td className="tright num">{inr(data.totals.debit)}</td><td className="tright num">{inr(data.totals.credit)}</td></tr>
              </tbody>
            </table>
          </div>
          <p className="ledger-hint">{data.balanced ? '✓ Debit = Credit. Tallies.' : 'Debit ≠ Credit — investigate.'}</p>
        </div>
      )}
    </div>
  );
}

/* ================= Ledger ================= */
function LedgerView() {
  const { company, notify } = useApp();
  const [accts, setAccts] = useState([]);
  const [accId, setAccId] = useState('');
  const [from, setFrom] = useState(company.books_begin_from);
  const [to, setTo] = useState(todayISO());
  useEffect(() => { api('/accounts').then((j) => setAccts(j.rows)).catch((e) => notify(e.message)); }, []);
  const [data, err] = useData(
    () => accId ? api(`/reports/ledger?account_id=${accId}&from=${from}&to=${to}`) : Promise.resolve(null),
    [accId, from, to]);
  const isRev = data ? data.account.type === 'Liability' || data.account.type === 'Income' : false;
  return (
    <div>
      <div className="card">
        <div className="frow">
          <label className="f" style={{ minWidth: 240 }}><span>Ledger</span>
            <select value={accId} onChange={(e) => setAccId(e.target.value)}>
              <option value="">— choose ledger —</option>
              {accts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label className="f"><span>From</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="f"><span>To</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
      </div>
      {err && <div className="errbox">{err}</div>}
      {data && (
        <div className="card">
          <div className="report-head">
            <div className="h1">{data.account.name}</div>
            <div className="h2">Ledger · {dshort(data.from)} to {dshort(data.to)} · (₹)</div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="grid">
              <thead><tr><th>Date</th><th>Particulars</th><th>Voucher</th><th className="tright">Debit</th><th className="tright">Credit</th><th className="tright">Balance</th></tr></thead>
              <tbody>
                <tr className="row-bold"><td colSpan={3} style={{ color: 'var(--ink-dim)' }}>Opening balance</td><td colSpan={3} className="tright num">{inr(Math.abs(data.opening))} {data.opening ? (isRev ? (data.opening < 0 ? 'Cr' : 'Dr') : (data.opening >= 0 ? 'Dr' : 'Cr')) : ''}</td></tr>
                {data.rows.map((r, i) => {
                  const bal = r.balance;
                  return (
                    <tr key={i}>
                      <td className="num">{dshort(r.date)}</td>
                      <td className="muted">{r.particulars || '—'}</td>
                      <td className="num">{(r.number || ('#' + r.voucher_no))}</td>
                      <td className="tright num">{r.debit ? inr(r.debit) : ''}</td>
                      <td className="tright num">{r.credit ? inr(r.credit) : ''}</td>
                      <td className="tright num">{inr(Math.abs(bal))} {bal ? (isRev ? (bal < 0 ? 'Cr' : 'Dr') : (bal >= 0 ? 'Dr' : 'Cr')) : ''}</td>
                    </tr>
                  );
                })}
                <tr className="grand-total"><td colSpan={3}>Closing balance</td><td className="tright num">{inr(data.rows.reduce((s, r) => s + r.debit, 0))}</td><td className="tright num">{inr(data.rows.reduce((s, r) => s + r.credit, 0))}</td><td className="tright num">{inr(Math.abs(data.closing))} {data.closing ? (isRev ? (data.closing < 0 ? 'Cr' : 'Dr') : (data.closing >= 0 ? 'Dr' : 'Cr')) : ''}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ================= Stock — v1.11.24 with hover/click party detail + dynamic stock ================= */
function StockView() {
  const { company, notify } = useApp();
  const [items, setItems] = useState([]);
  const [itemId, setItemId] = useState('');
  const [from, setFrom] = useState(company.books_begin_from);
  const [to, setTo] = useState(todayISO());
  const [detailItem, setDetailItem] = useState(null);
  const [viewVoucherId, setViewVoucherId] = useState(null);
  const [showFull, setShowFull] = useState(false);
  const [fullData, setFullData] = useState(null);
  const [fullErr, setFullErr] = useState('');
  useEffect(() => { api('/items').then((j) => setItems(j.rows.filter((i) => !i.is_service))).catch((e) => notify(e.message)); }, []);
  const [data, err] = useData(
    () => itemId ? api(`/reports/stock?item_id=${itemId}&from=${from}&to=${to}`) : Promise.resolve(null),
    [itemId, from, to]);

  const openFullHistory = async (id) => {
    setFullErr(''); setFullData(null);
    try {
      const j = await api(`/items/${id}/history?from=${from}&to=${to}`);
      setFullData(j);
      setShowFull(true);
    } catch (e) { setFullErr(e.message); }
  };

  return (
    <div>
      <div className="card" style={{ borderLeft: '4px solid var(--gold)' }}>
        <div className="frow">
          <label className="f" style={{ minWidth: 240 }}><span>Item — click 📜 for buy/sell vs party</span>
            <select value={itemId} onChange={(e) => setItemId(e.target.value)}>
              <option value="">— choose item —</option>
              {items.map((it) => <option key={it.id} value={it.id}>{it.name} — {it.stock_qty ?? 0} {it.unit} in hand</option>)}
            </select>
          </label>
          <label className="f"><span>From (DD/MM/YYYY)</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="f"><span>To (DD/MM/YYYY)</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          {itemId && <button className="btn sm" style={{ alignSelf: 'flex-end' }} onClick={() => openFullHistory(itemId)}>📜 Full buy/sell history vs party</button>}
        </div>
        <div className="faint" style={{ fontSize: 11, marginTop: 6 }}>NEW v1.11.24: Hover any row to see party GSTIN · Click voucher no. to view voucher · Click 📜 for full history: when bought, when sold, against which party, rate, balance — dynamically matched to stock in hand</div>
      </div>
      {err && <div className="errbox">{err}</div>}
      {fullErr && <div className="errbox">{fullErr}</div>}
      {data && (
        <div className="card">
          <div className="report-head" style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <div>
              <div className="h1">{data.item.name} <span className="faint" style={{ fontFamily: 'sans-serif', fontSize: 12 }}>· {data.item.unit} · HSN {data.item.hsn || '—'} · GST {data.item.gst_rate ?? 0}%</span></div>
              <div className="h2">Stock statement · {dshort(data.from)} to {dshort(data.to)} · All dates DD/MM/YYYY · In hand {qty(data.closing.qty)} {data.item.unit}</div>
            </div>
            <button className="btn sm" onClick={() => setDetailItem({ id: data.item.id, name: data.item.name })}>📜 Open full history modal</button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="grid">
              <thead><tr><th>Date (DD/MM/YYYY)</th><th>Voucher</th><th>Party (against what)</th><th className="tright">In</th><th className="tright">Out</th><th className="tright">Rate</th><th className="tright">Amount</th><th className="tright">Balance qty (live)</th><th className="tright">Balance value</th><th>Narration</th></tr></thead>
              <tbody>
                <tr className="row-bold"><td colSpan={3} style={{ color: 'var(--ink-dim)' }}>Opening</td><td colSpan={4}></td><td className="tright num">{qty(data.opening.qty)}</td><td className="tright num">{inr(data.opening.value)}</td><td></td></tr>
                {data.rows.map((r, i) => (
                  <tr key={i} style={{ background: r.direction === 'in' ? 'rgba(142,192,124,0.05)' : 'rgba(224,160,107,0.05)' }}>
                    <td className="num">{dshort(r.date)}</td>
                    <td className="num">
                      <button className="btn ghost sm" style={{ fontSize: 11, padding: '2px 6px' }} onClick={() => setViewVoucherId(r.voucher_id)} title="View voucher">
                        {(r.number || ('#' + r.voucher_no))} <span className="badge" style={{ fontSize: 9 }}>{r.class}</span>
                      </button>
                    </td>
                    <td title={r.party_gstin ? `GSTIN: ${r.party_gstin}` : 'Party'} style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <b>{r.party_name || '—'}</b>{r.party_gstin && <div className="faint" style={{ fontSize: 10 }}>{r.party_gstin}</div>}
                    </td>
                    <td className="tright num">{r.inQty ? qty(r.inQty) : ''}</td>
                    <td className="tright num">{r.outQty ? qty(r.outQty) : ''}</td>
                    <td className="tright num">{inr(r.ratePaise)}</td>
                    <td className="tright num">{inr(r.amountPaise)}</td>
                    <td className="tright num" style={{ fontWeight: 600 }}>{qty(r.balQty)}</td>
                    <td className="tright num">{inr(r.balValue)}</td>
                    <td className="muted" style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.narration}>{r.narration || r.ref || '—'}</td>
                  </tr>
                ))}
                <tr className="grand-total"><td colSpan={3}>Closing stock (dynamically matched)</td><td colSpan={4}></td><td className="tright num">{qty(data.closing.qty)}</td><td className="tright num">{inr(data.closing.value)}</td><td></td></tr>
              </tbody>
            </table>
          </div>
          <div className="faint" style={{ fontSize: 11, marginTop: 8 }}>Stock in hand = opening + all IN - all OUT (weighted avg). Click any voucher to audit. Click 📜 for timeline: when bought, when sold, against which party.</div>
        </div>
      )}

      {showFull && fullData && (
        <div className="card" style={{ borderColor: 'var(--gold)', background: 'var(--gold-soft)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <h3>📜 Full history — {fullData.item.name} — when bought, when sold, against what</h3>
            <button className="btn ghost sm" onClick={() => setShowFull(false)}>✕ Close</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8, marginBottom: 10 }}>
            <div><span className="faint" style={{ fontSize: 10 }}>In hand now</span><div style={{ fontWeight: 800 }}>{qty(fullData.summary.inHandQty)} {fullData.item.unit} · {inr(fullData.summary.inHandValue)}</div></div>
            <div><span className="faint" style={{ fontSize: 10 }}>Total bought</span><div>{qty(fullData.summary.totalBoughtQty)} · {inr(fullData.summary.totalBoughtValue)}</div>{fullData.summary.lastBuy && <div className="faint" style={{ fontSize: 11 }}>Last: {dshort(fullData.summary.lastBuy.date)} vs {fullData.summary.lastBuy.party_name}</div>}</div>
            <div><span className="faint" style={{ fontSize: 10 }}>Total sold</span><div>{qty(fullData.summary.totalSoldQty)} · {inr(fullData.summary.totalSoldValue)}</div>{fullData.summary.lastSell && <div className="faint" style={{ fontSize: 11 }}>Last: {dshort(fullData.summary.lastSell.date)} to {fullData.summary.lastSell.party_name}</div>}</div>
            <div><span className="faint" style={{ fontSize: 10 }}>Aging</span><div>{fullData.summary.oldestDate ? `${dshort(fullData.summary.oldestDate)} · ${fullData.summary.daysInStock}d` : '—'}</div></div>
          </div>
          <div style={{ maxHeight: 380, overflowY: 'auto' }}>
            <table className="grid" style={{ fontSize: 11.5 }}>
              <thead><tr><th>Date DD/MM/YYYY</th><th>Type</th><th>Voucher</th><th>Party</th><th className="tright">In</th><th className="tright">Out</th><th className="tright">Rate</th><th className="tright">Bal Qty</th><th>Narration</th></tr></thead>
              <tbody>{fullData.movements.map((m,i)=>(
                <tr key={i}><td>{dshort(m.date)}</td><td><span className="badge">{m.class}</span> {m.direction}</td><td><button className="btn ghost sm" style={{ fontSize: 10 }} onClick={() => setViewVoucherId(m.voucher_id)}>{m.number || '#'+m.voucher_no}</button></td><td>{m.party_name}</td><td className="tright">{m.inQty ? qty(m.inQty) : ''}</td><td className="tright">{m.outQty ? qty(m.outQty) : ''}</td><td className="tright">{inr(m.ratePaise)}</td><td className="tright">{qty(m.balQty)}</td><td className="muted" style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.narration}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}

      {detailItem && <StockDetailLazy itemId={detailItem.id} itemName={detailItem.name} onClose={() => setDetailItem(null)} onVoucher={(vid) => { setDetailItem(null); setViewVoucherId(vid); }} />}
      {viewVoucherId && <VoucherModalLazy voucherId={viewVoucherId} onClose={() => setViewVoucherId(null)} />}
    </div>
  );
}

function StockDetailLazy(props) {
  const [Comp, setComp] = useState(null);
  useEffect(() => { import('./StockDetail.jsx').then(m => setComp(() => m.StockDetailModal)); }, []);
  if (!Comp) return <div className="portal"><div className="box">Loading history…</div></div>;
  return <Comp {...props} />;
}
function VoucherModalLazy({ voucherId, onClose }) {
  const [Comp, setComp] = useState(null);
  useEffect(() => { import('./Voucher.jsx').then(m => setComp(() => m.VoucherModal)); }, []);
  if (!Comp) return <div className="portal"><div className="box">Loading voucher…</div></div>;
  return <Comp voucherId={voucherId} onClose={onClose} />;
}


/* ================= GST ================= */
function GstView() {
  const { company } = useApp();
  const [from, setFrom] = useState(company.books_begin_from);
  const [to, setTo] = useState(todayISO());
  const [data, err] = useData(() => api('/reports/gst?from=' + from + '&to=' + to), [from, to]);
  if (!data) return <div className="card"><div className="empty">{err || 'Loading…'}</div></div>;
  const out = (data.rows || []).filter((r) => r.tax > 0);
  const inn = (data.rows || []).filter((r) => r.tax < 0);
  const sumTax = (a) => a.reduce((s, r) => s + r.tax, 0);
  const sumBase = (a) => a.reduce((s, r) => s + (r.taxable || 0), 0);
  const net = sumTax(out) + sumTax(inn);
  return (
    <div>
      <div className="card"><PeriodRow from={from} to={to} setFrom={setFrom} setTo={setTo} /></div>
      {err && <div className="errbox">{err}</div>}
      {!err && (
        <>
          <div className="card">
            <div className="report-head">
              <div className="h1">GST Summary — Output (collected)</div>
              <div className="h2">{company.name} · {dshort(from)} to {dshort(to)}</div>
            </div>
            <table className="grid">
              <thead><tr><th>Ledger</th><th className="tright">Taxable value</th><th className="tright">Tax</th></tr></thead>
              <tbody>
                {out.map((r) => <tr key={r.account_id}><td>{r.ledger}</td><td className="tright num">{inr(r.taxable)}</td><td className="tright num">{inr(r.tax)}</td></tr>)}
                {!out.length && <tr><td colSpan={3} className="empty">No output tax in period.</td></tr>}
                {out.length > 0 && <tr className="grand-total"><td>Total output</td><td className="tright num">{inr(sumBase(out))}</td><td className="tright num">{inr(sumTax(out))}</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="card">
            <h3>Input tax credit (ITC) — purchases</h3>
            <table className="grid">
              <thead><tr><th>Ledger</th><th className="tright">Taxable value</th><th className="tright">ITC</th></tr></thead>
              <tbody>
                {inn.map((r) => <tr key={r.account_id}><td>{r.ledger}</td><td className="tright num">{inr(r.taxable)}</td><td className="tright num">{inr(-r.tax)}</td></tr>)}
                {!inn.length && <tr><td colSpan={3} className="empty">No input credit in period.</td></tr>}
                {inn.length > 0 && <tr className="grand-total"><td>Total ITC</td><td className="tright num">{inr(sumBase(inn))}</td><td className="tright num">{inr(-sumTax(inn))}</td></tr>}
              </tbody>
            </table>
            <p className="ledger-hint">Net GST payable for the period: <b>{inr(Math.max(0, net))}</b> {net < 0 && <span className="faint">(excess credit — carries forward)</span>}</p>
          </div>
        </>
      )}
    </div>
  );
}

/* ================= router ================= */
const TITLES = { bs: 'Balance Sheet', pl: 'Profit & Loss Account', tb: 'Trial Balance', ledger: 'Ledger Report', stock: 'Stock Summary', gst: 'GST Summary' };
export function ReportsScreen({ which }) {
  let body = null;
  if (which === 'bs') body = <BalanceSheetView />;
  else if (which === 'pl') body = <ProfitLossView />;
  else if (which === 'tb') body = <TrialBalanceView />;
  else if (which === 'ledger') body = <LedgerView />;
  else if (which === 'stock') body = <StockView />;
  else if (which === 'gst') body = <GstView />;
  if (!body) return null;
  return (
    <div>
      <div className="pagetitle">
        <div><div className="crumb">Reports</div><h1>{TITLES[which]}</h1></div>
        <button className="btn ghost no-print" onClick={() => window.print()}>🖨 Print</button>
      </div>
      {body}
    </div>
  );
}
