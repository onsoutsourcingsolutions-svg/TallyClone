import { useEffect, useState } from 'react';
import { useApp } from '../state.jsx';
import { inr, dshort } from '../fmt.js';
import { checkUpdate, applyUpdate } from '../upd.js';

function fmt(p) {
  if (p === null || p === undefined) return '—';
  const n = Number(p);
  if (!Number.isFinite(n)) return '—';
  return inr(Math.round(n));
}
function fmtQty(q) {
  const n = Number(q);
  if (!Number.isFinite(n) || Math.abs(n) < 1e-9) return '—';
  return String(Math.round(n * 100) / 100);
}

export function Gateway() {
  const { company, notify, setView } = useApp();
  const [dash, setDash] = useState(null);
  const [fx, setFx] = useState(null);
  const [fxState, setFxState] = useState('load');
  const [usdIn, setUsdIn] = useState('');
  const [upd, setUpd] = useState(null);
  const [updBusy, setUpdBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadDash = async () => {
    try {
      setLoading(true);
      const j = await fetch('/api/dashboard').then(r => r.json());
      if (!j.ok) throw new Error(j.error || 'Dashboard failed');
      setDash(j);
    } catch (e) { notify(e.message); }
    finally { setLoading(false); }
  };
  const loadFx = async (silent = false) => {
    if (!silent) setFxState('busy');
    try {
      const j = await fetch('/api/rates').then(r => r.json());
      if (j && j.ok && j.usd) { setFx(j.usd); setFxState('ok'); }
      else { setFx(null); setFxState('off'); }
    } catch { setFx(null); setFxState('off'); }
  };

  useEffect(() => { loadDash(); loadFx(true); checkUpdate().then(j => setUpd(j)); }, []);

  const doUpdate = async () => {
    setUpdBusy(true);
    try { await applyUpdate(); }
    catch (e) { notify(e.message); setUpdBusy(false); }
  };

  const rate = fx ? fx.rate : 0;
  const converted = rate > 0 && usdIn !== '' && Number(usdIn) > 0 ? Math.round(Number(usdIn) * rate * 100) : 0;
  const timeHM = (iso) => { try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };

  if (loading && !dash) return <div className="content" style={{ color: 'var(--ink-dim)' }}>Loading dashboard…</div>;

  const d = dash;
  const bankTotal = d?.bank?.total || 0;
  const cashTotal = d?.cash?.total || 0;
  const recvTotal = d?.receivables?.total || 0;
  const payTotal = d?.payables?.total || 0;
  const stockVal = d?.stock?.totalValue || 0;
  const salesM = d?.sales?.month || 0;
  const purchM = d?.purchases?.month || 0;
  const profitM = d?.profit?.month || 0;
  const gstNetM = d?.gst?.netMonth || 0;

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto' }}>
      {upd && upd.update && upd.latest && (
        <div style={{
          display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap',
          border: '1px solid var(--gold-line)', borderRadius: 8, background: 'linear-gradient(180deg, rgba(212,175,55,0.10), rgba(212,175,55,0.02))',
          padding: '9px 12px', marginBottom: 14,
        }}>
          <span style={{ fontSize: 13.5 }}>
            <b style={{ color: 'var(--gold-hi)' }}>New build {upd.latest.replace(/ ·.*/, '')} is ready</b>
            <span className="muted"> — install it here in one click; your books are never touched.</span>
          </span>
          <button className="btn" style={{ padding: '6px 14px' }} disabled={updBusy} onClick={doUpdate}>
            {updBusy ? 'Installing… app restarts' : 'Update now'}
          </button>
        </div>
      )}

      {company && (
        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
          <div className="crumb">Dashboard · {company.name} · FY {company.financial_year_from.slice(0, 4)}–{Number(company.financial_year_from.slice(0, 4)) + 1}</div>
          <button className="btn ghost sm" onClick={() => { loadDash(); loadFx(); }}>⟳ Refresh</button>
        </div>
      )}

      {/* ---------- TOP KPI ROW ---------- */}
      <div className="kpis" style={{ marginBottom: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        <div className="kpi" style={{ borderColor: 'var(--gold-line)' }}><div className="k">Bank balance</div><div className="v" style={{ color: 'var(--gold-hi)' }}>{fmt(bankTotal)}</div><div className="s">{d?.bank?.accounts?.length || 0} accounts</div></div>
        <div className="kpi"><div className="k">Cash in hand</div><div className="v">{fmt(cashTotal)}</div><div className="s">{d?.cash?.accounts?.map(a => a.name).join(', ') || '—'}</div></div>
        <div className="kpi"><div className="k">Receivables (Debtors)</div><div className="v" style={{ color: '#8ec07c' }}>{fmt(recvTotal)}</div><div className="s">{d?.receivables?.top?.length || 0} parties</div></div>
        <div className="kpi"><div className="k">Payables (Creditors)</div><div className="v" style={{ color: '#e0a06b' }}>{fmt(payTotal < 0 ? -payTotal : payTotal)} {payTotal < 0 ? 'Cr' : ''}</div><div className="s">{d?.payables?.top?.length || 0} parties</div></div>
        <div className="kpi"><div className="k">Stock value</div><div className="v">{fmt(stockVal)}</div><div className="s">{d?.stock?.count || 0} items · {fmtQty(d?.stock?.totalQty)} qty</div></div>
        <div className="kpi"><div className="k">Sales (this month)</div><div className="v" style={{ color: 'var(--gold-hi)' }}>{fmt(salesM)}</div><div className="s">FY {fmt(d?.sales?.fy)}</div></div>
        <div className="kpi"><div className="k">Purchases (month)</div><div className="v">{fmt(purchM)}</div><div className="s">FY {fmt(d?.purchases?.fy)}</div></div>
        <div className="kpi"><div className="k">Profit (month)</div><div className="v" style={{ color: profitM >= 0 ? '#8ec07c' : '#e06b6b' }}>{fmt(profitM)}</div><div className="s">FY {fmt(d?.profit?.fy)}</div></div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>

        {/* ---------- CASH FLOW ---------- */}
        <div className="card" style={{ flex: '1 1 320px', minWidth: 320 }}>
          <h3>💰 Cash flow · this month</h3>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '8px 0' }}>
            <div><span className="muted" style={{ fontSize: 11 }}>Receipts</span><div className="num" style={{ color: '#8ec07c', fontSize: 18 }}>{fmt(d?.cashflow?.receiptsMonth)}</div></div>
            <div><span className="muted" style={{ fontSize: 11 }}>Payments</span><div className="num" style={{ color: '#e06b6b', fontSize: 18 }}>{fmt(d?.cashflow?.paymentsMonth)}</div></div>
            <div><span className="muted" style={{ fontSize: 11 }}>Net</span><div className="num" style={{ color: 'var(--gold-hi)', fontSize: 18 }}>{fmt(d?.cashflow?.netMonth)}</div></div>
          </div>
          <div className="faint" style={{ fontSize: 11.5 }}>FY: Receipts {fmt(d?.cashflow?.receiptsFY)} · Payments {fmt(d?.cashflow?.paymentsFY)} · Net {fmt(d?.cashflow?.netFY)}</div>
          <div style={{ marginTop: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}><span>Bank</span><b>{fmt(bankTotal)}</b></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}><span>Cash</span><b>{fmt(cashTotal)}</b></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, borderTop: '1px solid var(--gold-line-soft)', marginTop: 4, paddingTop: 4 }}><span>Total liquid</span><b style={{ color: 'var(--gold-hi)' }}>{fmt(bankTotal + cashTotal)}</b></div>
          </div>
          <div style={{ marginTop: 12, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button className="btn ghost sm" onClick={() => setView({ name: 'voucher', cls: 'receipt' })}>+ Receipt</button>
            <button className="btn ghost sm" onClick={() => setView({ name: 'voucher', cls: 'payment' })}>+ Payment</button>
            <button className="btn ghost sm" onClick={() => setView({ name: 'reports', which: 'ledger' })}>Ledger</button>
          </div>
        </div>

        {/* ---------- INVENTORY MANAGEMENT ---------- */}
        <div className="card" style={{ flex: '1 1 420px', minWidth: 340 }}>
          <h3>📦 Inventory · buy / sell tracking</h3>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', margin: '8px 0' }}>
            <div><span className="muted" style={{ fontSize: 11 }}>Total value</span><div className="num" style={{ fontSize: 18, color: 'var(--gold-hi)' }}>{fmt(stockVal)}</div></div>
            <div><span className="muted" style={{ fontSize: 11 }}>Total qty</span><div className="num" style={{ fontSize: 18 }}>{fmtQty(d?.stock?.totalQty)}</div></div>
            <div><span className="muted" style={{ fontSize: 11 }}>Items</span><div className="num" style={{ fontSize: 18 }}>{d?.stock?.count || 0}</div></div>
          </div>

          {d?.stock?.lowStock?.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#e0a06b' }}>Low stock (&lt;10)</div>
              <table className="grid" style={{ fontSize: 12, marginTop: 4 }}>
                <thead><tr><th>Item</th><th className="tright">Qty</th><th className="tright">Value</th></tr></thead>
                <tbody>{d.stock.lowStock.map(it => <tr key={it.id}><td>{it.name}</td><td className="tright">{fmtQty(it.qty)} {it.unit}</td><td className="tright">{fmt(it.value)}</td></tr>)}</tbody>
              </table>
            </div>
          )}
          {d?.stock?.outOfStock?.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: '#e06b6b' }}>Out of stock</div>
              <div className="muted" style={{ fontSize: 12 }}>{d.stock.outOfStock.map(it => it.name).join(', ')}</div>
            </div>
          )}

          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ink-faint)' }}>Buy vs Sell — last movement per item (with date)</div>
            <div style={{ maxHeight: 180, overflowY: 'auto', marginTop: 4 }}>
              <table className="grid" style={{ fontSize: 11.5 }}>
                <thead><tr><th>Item</th><th>Last Buy</th><th>Last Sell</th><th>Age</th></tr></thead>
                <tbody>
                  {(d?.buySell || []).slice(0, 8).map(r => (
                    <tr key={r.id}>
                      <td>{r.name}</td>
                      <td>{r.lastBuyDate ? <>{dshort(r.lastBuyDate)} · {fmtQty(r.lastBuyQty)}</> : '—'}</td>
                      <td>{r.lastSellDate ? <>{dshort(r.lastSellDate)} · {fmtQty(r.lastSellQty)}</> : '—'}</td>
                      <td>{r.lastBuyDate && r.lastSellDate ? Math.floor((new Date(r.lastSellDate) - new Date(r.lastBuyDate)) / 86400000) + 'd' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {d?.stock?.aging?.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ink-faint)' }}>Oldest stock still in hand (aging)</div>
              <table className="grid" style={{ fontSize: 11.5, marginTop: 4 }}>
                <thead><tr><th>Item</th><th>Oldest buy</th><th>Days</th><th className="tright">Qty</th></tr></thead>
                <tbody>{d.stock.aging.map(a => <tr key={a.id}><td>{a.name}</td><td>{dshort(a.oldestDate)}</td><td>{a.daysInStock}d</td><td className="tright">{fmtQty(a.qty)}</td></tr>)}</tbody>
              </table>
            </div>
          )}

          <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button className="btn ghost sm" onClick={() => setView({ name: 'reports', which: 'stock' })}>Stock Report</button>
            <button className="btn ghost sm" onClick={() => setView({ name: 'data' })}>Import Stock (with date)</button>
            <button className="btn ghost sm" onClick={() => setView({ name: 'invoice_import' })}>Invoice Excel → Print</button>
          </div>
        </div>

        {/* ---------- GST + FX ---------- */}
        <div style={{ flex: '1 1 300px', minWidth: 300, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card" style={{ marginBottom: 0 }}>
            <h3>🧾 GST · payable</h3>
            <div style={{ display: 'flex', gap: 12, margin: '8px 0' }}>
              <div><span className="muted" style={{ fontSize: 11 }}>Output (month)</span><div className="num" style={{ fontSize: 16 }}>{fmt(d?.gst?.outputMonth)}</div></div>
              <div><span className="muted" style={{ fontSize: 11 }}>Input (month)</span><div className="num" style={{ fontSize: 16 }}>{fmt(d?.gst?.inputMonth)}</div></div>
              <div><span className="muted" style={{ fontSize: 11 }}>Net payable</span><div className="num" style={{ fontSize: 16, color: 'var(--gold-hi)' }}>{fmt(gstNetM)}</div></div>
            </div>
            <div className="faint" style={{ fontSize: 11.5 }}>FY Output {fmt(d?.gst?.outputFY)} · Input {fmt(d?.gst?.inputFY)} · Net {fmt(d?.gst?.netFY)}</div>
            <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={() => setView({ name: 'reports', which: 'gst' })}>GST Summary</button>
          </div>

          <div className="card" style={{ marginBottom: 0 }}>
            <h3>💵 USD → INR</h3>
            {fxState === 'load' || fxState === 'busy' ? (
              <div className="faint">Fetching…</div>
            ) : fxState === 'ok' && fx ? (
              <>
                <div style={{ fontFamily: 'var(--serif)', fontSize: 28, color: 'var(--gold-hi)' }}>₹ {rate.toFixed(2)} <span style={{ fontSize: 12, fontFamily: 'var(--sans)', color: 'var(--ink-dim)' }}>/ USD</span></div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <input style={{ maxWidth: 110 }} placeholder="USD" value={usdIn} onChange={e => setUsdIn(e.target.value.replace(/[^0-9.]/g, ''))} />
                  <b className="num" style={{ color: 'var(--gold-hi)' }}>{converted ? fmt(converted) : ''}</b>
                </div>
                <div className="faint" style={{ fontSize: 11, marginTop: 6 }}>Updated {timeHM(fx.updatedAt)} · {fx.source}</div>
              </>
            ) : <div className="faint">Rate unavailable — need internet</div>}
            <button className="btn ghost sm" style={{ marginTop: 8 }} disabled={fxState === 'busy'} onClick={() => loadFx()}>⟳ Refresh rate</button>
          </div>
        </div>
      </div>

      {/* ---------- SECOND ROW: Receivables / Payables / Recent ---------- */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 16, alignItems: 'flex-start' }}>

        <div className="card" style={{ flex: '1 1 300px' }}>
          <h3>📥 Top Receivables</h3>
          {(d?.receivables?.top?.length || 0) === 0 ? <div className="empty">No debtors with balance</div> :
            <table className="grid" style={{ fontSize: 12 }}>
              <thead><tr><th>Party</th><th className="tright">Due</th></tr></thead>
              <tbody>{d.receivables.top.map(p => <tr key={p.id}><td>{p.name}</td><td className="tright num">{fmt(p.balance)}</td></tr>)}</tbody>
            </table>
          }
          <div style={{ marginTop: 6, display: 'flex', justifyContent: 'space-between', fontSize: 12 }}><span>Total</span><b>{fmt(recvTotal)}</b></div>
        </div>

        <div className="card" style={{ flex: '1 1 300px' }}>
          <h3>📤 Top Payables</h3>
          {(d?.payables?.top?.length || 0) === 0 ? <div className="empty">No creditors with balance</div> :
            <table className="grid" style={{ fontSize: 12 }}>
              <thead><tr><th>Party</th><th className="tright">Due</th></tr></thead>
              <tbody>{d.payables.top.map(p => <tr key={p.id}><td>{p.name}</td><td className="tright num">{fmt(p.balance < 0 ? -p.balance : p.balance)}</td></tr>)}</tbody>
            </table>
          }
          <div style={{ marginTop: 6, display: 'flex', justifyContent: 'space-between', fontSize: 12 }}><span>Total Cr</span><b>{fmt(payTotal < 0 ? -payTotal : payTotal)}</b></div>
        </div>

        <div className="card" style={{ flex: '1 1 400px' }}>
          <h3>🧾 Recent vouchers · buy/sell tracking</h3>
          <table className="grid" style={{ fontSize: 11.5 }}>
            <thead><tr><th>Date</th><th>Type</th><th>No.</th><th>Narration</th><th className="tright">Amount</th></tr></thead>
            <tbody>
              {(d?.recent || []).map(v => (
                <tr key={v.id} style={{ cursor: 'pointer' }} onClick={() => setView({ name: 'daybook', id: v.id })}>
                  <td>{dshort(v.date)}</td>
                  <td><span className="badge">{v.class}</span></td>
                  <td>{v.number || '#' + v.voucher_no}</td>
                  <td className="muted" style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.narration}</td>
                  <td className="tright num">{fmt(Math.max(v.debit, v.credit))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
            <button className="btn ghost sm" onClick={() => setView({ name: 'daybook' })}>Day Book</button>
            <button className="btn ghost sm" onClick={() => setView({ name: 'reports', which: 'pl' })}>P&L</button>
            <button className="btn ghost sm" onClick={() => setView({ name: 'reports', which: 'bs' })}>Balance Sheet</button>
          </div>
        </div>
      </div>

      <p className="faint" style={{ fontSize: 12, textAlign: 'center', marginTop: 18 }}>
        Dashboard auto-refreshes on load. Stock dates come from your Opening Stock Excel (date column). Invoice Excel import keeps your format and books + prints PI-200.
      </p>
    </div>
  );
}
