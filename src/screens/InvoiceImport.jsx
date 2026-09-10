import { useState } from 'react';
import { useApp } from '../state.jsx';
import { inr } from '../fmt.js';

export function InvoiceImportScreen() {
  const { company, notify } = useApp();
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const doUpload = async (f, asPreview) => {
    if (!f) return;
    setErr(''); setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      fd.append('preview', asPreview ? '1' : '0');
      const r = await fetch('/api/import/invoice_excel', { method: 'POST', body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error((j && j.error) || 'Import failed.');
      if (asPreview) {
        setPreview(j);
        setResult(null);
      } else {
        setResult(j);
        if (j.vouchers) notify(`${j.count} sales invoices booked from Excel ✓`);
        else if (j.voucher) notify(`Sales ${j.voucher.number || '#' + j.voucher.voucher_no} booked ✓ — now you can print it.`);
      }
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const printVoucher = async (voucherId) => {
    try {
      const j = await fetch('/api/vouchers/' + voucherId).then(r => r.json());
      if (!j.ok) throw new Error(j.error || 'Voucher not found');
      const mod = await import('../invprint.js');
      const doc = mod.docFromVoucher(j.voucher, company);
      mod.openInvoicePrint(`${doc.number} · Proforma Invoice`, mod.invoiceHtml(doc));
    } catch (e) { notify(e.message); }
  };

  return (
    <div>
      <div className="pagetitle">
        <div><div className="crumb">Data · Sales Invoice Excel</div><h1>Invoice Excel → Books + Print</h1></div>
      </div>
      <p className="muted" style={{ marginTop: -6, fontSize: 13.5 }}>
        Keep your Excel exactly as you use it today. Upload your <b>PI-200 style</b> sheet — same format as <code>PI-200-REFTECH.pdf</code> — and the software will:
        <b> 1) create the party ledger if missing, 2) create stock items if missing, 3) post a Sales voucher with CGST/SGST or IGST auto, 4) let you print the exact PI-200 layout</b>.
        Your Excel file is never modified. Works with .xlsx, .xls and .csv. Both your formatted invoice sheet and a simple tabular sheet are supported.
      </p>

      <div className="card">
        <h3>📂 Upload your invoice Excel</h3>
        <p className="muted" style={{ fontSize: 13, margin: '0 0 12px' }}>
          The parser looks for labels like <b>Invoice No., Dated, Buyer Bill (Bill To), Description of Goods, Quantity, Rate, Amount, Taxable Value, Output SGST/CGST/IGST, Total</b>.
          If your sheet is tabular (columns: invoice_no, date, buyer_name, buyer_gstin, item_name, hsn, qty, rate, gst_rate) it will also work — one row per item, same invoice_no for multiple items.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <label className="btn" style={{ cursor: 'pointer' }}>
            {busy ? 'Working…' : '📂 Choose .xlsx file'}
            <input type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={(e) => {
              const f = e.target.files && e.target.files[0];
              if (f) { setFile(f); setResult(null); doUpload(f, true); }
              e.target.value = '';
            }} />
          </label>
          <a className="btn ghost" href="/api/export/invoice_excel_template">⬇ Sales Invoice Template (tabular)</a>
          <a className="btn ghost" href="/api/export/items?mode=template">⬇ Items Template</a>
          <a className="btn ghost" href="/api/export/ledgers?mode=template">⬇ Ledgers Template</a>
        </div>
        <p className="ledger-hint" style={{ marginTop: 10 }}>
          Tip: After import, go to Day Book → click the voucher → <b>Invoice print</b> for the exact PI-200 black & gold print. Company logo, bank details, jurisdiction text come from Company → Settings.
        </p>
      </div>

      {err && <div className="errbox">{err}</div>}

      {preview && preview.bulk && (
        <div className="card">
          <h3>Preview — {preview.count} invoices found in Excel (tabular bulk)</h3>
          <div style={{ maxHeight: 300, overflowY: 'auto' }}>
            <table className="grid" style={{ fontSize: 12 }}>
              <thead><tr><th>Invoice No</th><th>Date</th><th>Buyer</th><th>GSTIN</th><th>Items</th><th>Regime</th></tr></thead>
              <tbody>{preview.bulk.map((p, i) => (
                <tr key={i}><td>{p.invoice_no}</td><td>{p.date}</td><td>{p.buyer.name}</td><td>{p.buyer.gstin || '—'}</td><td>{p.items.length}</td><td>{p.regime}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <div style={{ marginTop: 12 }}>
            <button className="btn" disabled={busy || !file} onClick={() => doUpload(file, false)}>{busy ? 'Booking…' : `✔ Book all ${preview.count} invoices now`}</button>
          </div>
        </div>
      )}

      {preview && preview.parsed && (
        <div className="card">
          <h3>Preview — {preview.parsed._source === 'tabular' ? 'Tabular sheet detected' : 'Formatted PI-200 sheet detected'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 13 }}>
            <div>
              <div><b>Invoice No:</b> {preview.parsed.invoice_no} · <b>Date:</b> {preview.parsed.date} · <b>Ref:</b> {preview.parsed.ref || '—'}</div>
              <div style={{ marginTop: 8 }}><b>Buyer:</b> {preview.parsed.buyer.name}</div>
              <div className="muted" style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{preview.parsed.buyer.address}</div>
              <div><b>GSTIN:</b> {preview.parsed.buyer.gstin || '—'}</div>
              <div style={{ marginTop: 8 }}><b>Consignee:</b> {preview.parsed.consignee.name}</div>
              <div className="muted" style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{preview.parsed.consignee.address}</div>
              <div><b>Regime:</b> {preview.parsed.regime} {preview.parsed.regime === 'intra' ? '(SGST+CGST)' : '(IGST)'}</div>
            </div>
            <div>
              <div><b>Items:</b> {preview.parsed.items.length}</div>
              <table className="grid" style={{ fontSize: 12, marginTop: 6 }}>
                <thead><tr><th>Item</th><th>HSN</th><th className="tright">Qty</th><th className="tright">Rate</th><th className="tright">GST%</th></tr></thead>
                <tbody>
                  {preview.parsed.items.map((it, i) => (
                    <tr key={i}><td>{it.name}</td><td>{it.hsn}</td><td className="tright">{it.qty} {it.unit}</td><td className="tright">{it.rate}</td><td className="tright">{it.gst_rate}%</td></tr>
                  ))}
                </tbody>
              </table>
              {preview.parsed.taxable !== null && <div style={{ marginTop: 6 }}><b>Taxable:</b> {inr(Math.round(preview.parsed.taxable * 100))} · <b>Total:</b> {preview.parsed.total ? inr(Math.round(preview.parsed.total * 100)) : 'auto'}</div>}
            </div>
          </div>
          <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn" disabled={busy || !file} onClick={() => doUpload(file, false)}>
              {busy ? 'Booking…' : '✔ Book this invoice now (create party/items if missing)'}
            </button>
            <span className="faint" style={{ fontSize: 12 }}>This will create ledger + items if they don't exist, then post a Sales voucher. You can still edit/delete it in Day Book.</span>
          </div>
        </div>
      )}

      {result && result.voucher && (
        <div className="card" style={{ borderColor: 'var(--gold)' }}>
          <h3>✅ Invoice booked</h3>
          <div style={{ fontSize: 13 }}>
            <div><b>{result.voucher.class.toUpperCase()}</b> No. {result.voucher.number || ('#' + result.voucher.voucher_no)} · Date {result.voucher.date} · {result.parsed.buyer.name}</div>
            <div className="muted" style={{ marginTop: 4 }}>Voucher ID {result.voucher.id} · {result.voucher.items.length} item(s) · Taxable {inr(result.voucher.items.reduce((s, it) => s + it.amount, 0))}</div>
          </div>
          <div style={{ marginTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn" onClick={() => printVoucher(result.voucher.id)}>🖨 Invoice print (PI-200 exact)</button>
            <a className="btn ghost" href="#" onClick={(e) => { e.preventDefault(); window.location.hash = ''; }}>Open Day Book</a>
          </div>
        </div>
      )}

      {result && result.vouchers && (
        <div className="card" style={{ borderColor: 'var(--gold)' }}>
          <h3>✅ {result.count} invoices booked from Excel</h3>
          <div style={{ maxHeight: 260, overflowY: 'auto' }}>
            <table className="grid" style={{ fontSize: 12 }}>
              <thead><tr><th>Invoice No</th><th>Date</th><th>Voucher ID</th><th></th></tr></thead>
              <tbody>{result.vouchers.map((v, i) => (
                <tr key={i}><td>{v.number || '#' + v.voucher_no}</td><td>{v.date}</td><td>{v.id}</td><td><button className="btn ghost sm" onClick={() => printVoucher(v.id)}>🖨 Print</button></td></tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
