import { useEffect, useState } from 'react';
import { api, useApp } from '../state.jsx';
import { inr, ddMMyyyy, qty } from '../fmt.js';

function fmtRate(paise) {
  if (paise == null) return '—';
  return inr(paise);
}

export function StockDetailModal({ itemId, itemName, onClose, onVoucher }) {
  const { notify } = useApp();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('all'); // all | buy | sell

  useEffect(() => {
    let alive = true;
    setLoading(true); setErr('');
    api(`/items/${itemId}/history`).then(j => {
      if (!alive) return;
      setData(j);
      setLoading(false);
    }).catch(e => {
      if (!alive) return;
      setErr(e.message);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [itemId]);

  if (loading) {
    return (
      <div className="portal" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="box" style={{ maxWidth: 1100, width: '100%', borderColor: 'var(--gold)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <h3>📦 {itemName || 'Stock history'} — loading…</h3>
            <button className="btn ghost sm" onClick={onClose}>✕ Close</button>
          </div>
          <div className="empty">Fetching stock history…</div>
        </div>
      </div>
    );
  }
  if (err) {
    return (
      <div className="portal" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="box" style={{ maxWidth: 700, borderColor: 'var(--gold)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <h3>Stock history error</h3>
            <button className="btn ghost sm" onClick={onClose}>✕ Close</button>
          </div>
          <div className="errbox">{err}</div>
        </div>
      </div>
    );
  }

  const item = data.item;
  const sum = data.summary || {};
  const moves = tab === 'buy' ? data.movements.filter(m => m.direction === 'in') : tab === 'sell' ? data.movements.filter(m => m.direction === 'out') : data.movements;

  return (
    <div className="portal" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} style={{ zIndex: 9999 }}>
      <div className="box" style={{ maxWidth: 1120, width: '100%', borderColor: 'var(--gold)', maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <h3 style={{ margin: 0 }}>📦 {item.name} <span className="faint" style={{ fontSize: 12, letterSpacing: 0, textTransform: 'none' }}>· {item.unit} · HSN {item.hsn || '—'} · GST {item.gst_rate ?? 0}%</span></h3>
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
              Stock in hand dynamically matched · Click any voucher to view · Hover shows party
            </div>
          </div>
          <button className="btn ghost sm" onClick={onClose}>✕ Close</button>
        </div>

        {/* Summary cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginTop: 12 }}>
          <div className="card" style={{ margin: 0, padding: '10px 12px', background: 'var(--gold-soft)', borderColor: 'var(--gold-line-soft)' }}>
            <div style={{ fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase', color: 'var(--ink-faint)' }}>In hand now</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--gold-hi)' }}>{qty(sum.inHandQty)} {item.unit}</div>
            <div className="muted" style={{ fontSize: 12 }}>{inr(sum.inHandValue)} · avg {inr(sum.inHandRate)}</div>
            {sum.daysInStock != null && <div className="faint" style={{ fontSize: 11 }}>Oldest: {ddMMyyyy(sum.oldestDate)} · {sum.daysInStock}d in stock</div>}
          </div>
          <div className="card" style={{ margin: 0, padding: '10px 12px' }}>
            <div style={{ fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase', color: 'var(--ink-faint)' }}>Total bought</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{qty(sum.totalBoughtQty)} {item.unit}</div>
            <div className="muted" style={{ fontSize: 12 }}>{inr(sum.totalBoughtValue)}</div>
            {sum.lastBuy && <div className="faint" style={{ fontSize: 11, marginTop: 4 }}>Last buy: {ddMMyyyy(sum.lastBuy.date)} · {qty(sum.lastBuy.qty)} @ {fmtRate(sum.lastBuy.ratePaise)}<br/>against {sum.lastBuy.party_name || '—'}</div>}
          </div>
          <div className="card" style={{ margin: 0, padding: '10px 12px' }}>
            <div style={{ fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase', color: 'var(--ink-faint)' }}>Total sold</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{qty(sum.totalSoldQty)} {item.unit}</div>
            <div className="muted" style={{ fontSize: 12 }}>{inr(sum.totalSoldValue)}</div>
            {sum.lastSell && <div className="faint" style={{ fontSize: 11, marginTop: 4 }}>Last sell: {ddMMyyyy(sum.lastSell.date)} · {qty(sum.lastSell.qty)} @ {fmtRate(sum.lastSell.ratePaise)}<br/>to {sum.lastSell.party_name || '—'}</div>}
          </div>
          <div className="card" style={{ margin: 0, padding: '10px 12px' }}>
            <div style={{ fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase', color: 'var(--ink-faint)' }}>Opening</div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{qty(data.opening?.qty)} {item.unit}</div>
            <div className="muted" style={{ fontSize: 12 }}>{inr(data.opening?.value)}</div>
            <div className="faint" style={{ fontSize: 11, marginTop: 4 }}>Closing: {qty(data.closing?.qty)} · {inr(data.closing?.value)}</div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
          <button className={`btn sm ${tab === 'all' ? '' : 'ghost'}`} onClick={() => setTab('all')}>All ({data.movements.length})</button>
          <button className={`btn sm ${tab === 'buy' ? '' : 'ghost'}`} onClick={() => setTab('buy')}>Bought ({data.movements.filter(m=>m.direction==='in').length})</button>
          <button className={`btn sm ${tab === 'sell' ? '' : 'ghost'}`} onClick={() => setTab('sell')}>Sold ({data.movements.filter(m=>m.direction==='out').length})</button>
          <span className="faint" style={{ fontSize: 11, alignSelf: 'center', marginLeft: 6 }}>Tip: Hover party to see GSTIN · Click voucher no. to view voucher</span>
        </div>

        {/* Movements table */}
        <div style={{ overflowX: 'auto', marginTop: 10 }}>
          <table className="grid" style={{ fontSize: 12.5 }}>
            <thead>
              <tr>
                <th>Date (DD/MM/YYYY)</th>
                <th>Type</th>
                <th>Voucher No</th>
                <th>Party (against what)</th>
                <th className="tright">In</th>
                <th className="tright">Out</th>
                <th className="tright">Rate</th>
                <th className="tright">Amount</th>
                <th className="tright">Balance Qty</th>
                <th className="tright">Balance Value</th>
                <th>Narration</th>
              </tr>
            </thead>
            <tbody>
              {moves.length === 0 && <tr><td colSpan={11} className="empty">No movements in this filter.</td></tr>}
              {moves.map((m, i) => (
                <tr key={i} style={{ background: m.direction === 'in' ? 'rgba(142,192,124,0.06)' : 'rgba(224,160,107,0.06)' }}>
                  <td className="num" title={m.date}>{ddMMyyyy(m.date)}</td>
                  <td><span className="badge" style={{ background: m.direction === 'in' ? '#8ec07c' : '#e0a06b', color: '#000' }}>{m.class}</span> <span style={{ fontSize: 10 }}>{m.direction === 'in' ? 'IN' : 'OUT'}</span></td>
                  <td>
                    <button className="btn ghost sm" style={{ fontSize: 11, padding: '2px 6px' }} onClick={() => onVoucher && onVoucher(m.voucher_id)} title="Click to view voucher">
                      {m.number || ('#' + m.voucher_no)}
                    </button>
                  </td>
                  <td title={m.party_gstin ? `GSTIN: ${m.party_gstin}` : ''} style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <b>{m.party_name || '—'}</b>
                    {m.party_gstin && <div className="faint" style={{ fontSize: 10 }}>{m.party_gstin}</div>}
                  </td>
                  <td className="tright num">{m.inQty ? qty(m.inQty) : ''}</td>
                  <td className="tright num">{m.outQty ? qty(m.outQty) : ''}</td>
                  <td className="tright num">{fmtRate(m.ratePaise)}</td>
                  <td className="tright num">{inr(m.amountPaise)}</td>
                  <td className="tright num" style={{ fontWeight: 600 }}>{qty(m.balQty)}</td>
                  <td className="tright num">{inr(m.balValue)}</td>
                  <td className="muted" style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.narration}>{m.narration || m.ref || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, flexWrap: 'wrap', gap: 8 }}>
          <div className="faint" style={{ fontSize: 11 }}>
            Dynamically matched to stock in hand · Weighted average cost · {data.movements.length} total movements from {ddMMyyyy(data.from)} to {ddMMyyyy(data.to)}
          </div>
          <button className="btn ghost sm" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// Quick hover tooltip component for SalesExcelPanel and other places
export function StockQuickTip({ item, onOpenDetail }) {
  if (!item) return null;
  return (
    <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 50, minWidth: 280, background: '#000000', color: 'var(--ink)', border: '1px solid var(--gold)', borderRadius: 8, padding: '10px 12px', fontSize: 12, boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
      <div style={{ fontWeight: 800, color: 'var(--gold-hi)', marginBottom: 4 }}>📦 {item.name}</div>
      <div>Stock in hand: <b>{qty(item.stock_qty)} {item.unit}</b> · {inr(item.stock_value)}</div>
      <div className="faint" style={{ color: '#aaa', marginTop: 4 }}>HSN {item.hsn || '—'} · GST {item.gst_rate ?? 0}% · {item.unit}</div>
      <div style={{ marginTop: 8 }}>
        <button className="btn sm" style={{ fontSize: 11, padding: '4px 8px' }} onClick={(e) => { e.stopPropagation(); onOpenDetail && onOpenDetail(item); }}>📜 Full buy/sell history</button>
      </div>
      <div className="faint" style={{ fontSize: 10, marginTop: 6, color: '#888' }}>Click item to view when bought/sold & against which party</div>
    </div>
  );
}
