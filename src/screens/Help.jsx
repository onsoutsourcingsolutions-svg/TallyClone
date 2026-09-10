import { BUILD_TAG } from '../../version.js';
export function HelpScreen() {
  const s = (t) => <span style={{ fontFamily: 'monospace', color: 'var(--gold-hi)', background: 'rgba(212,175,55,.08)', padding: '1px 6px', borderRadius: 4 }}>{t}</span>;
  return (
    <div style={{ maxWidth: 820 }}>
      <div className="pagetitle"><div><div className="crumb">Company</div><h1>Help — how this system works</h1></div></div>
      <div className="card">
        <h3>It is a double-entry accounting system (Schedule III / Indian GAAP style classification)</h3>
        <ul style={{ lineHeight: 1.8, color: 'var(--ink-dim)', paddingLeft: 20 }}>
          <li>Create your <b>company</b> (FY, GSTIN, state) → system auto-creates the standard ledgers (Cash, Sales, Purchases, Stock, COGS).</li>
          <li>Add <b>ledgers</b> under a group — e.g. parties under <i>Sundry Debtors</i> / <i>Sundry Creditors</i>, banks under <i>Bank Accounts</i>. Set opening balances (Dr/Cr) before any voucher.</li>
          <li>Add <b>stock items</b> with unit, HSN and GST rate for inventory invoices.</li>
        </ul>
      </div>
      <div className="card">
        <h3>Vouchers</h3>
        <ul style={{ lineHeight: 1.8, color: 'var(--ink-dim)', paddingLeft: 20 }}>
          <li><b>Sales / Purchase with “Stock items”</b>: pick items+qty+rate → system auto-computes GST (CGST+SGST for intra-state, IGST for inter-state), debits/credits the party, and maintains inventory at <b>weighted-average cost</b>. Sales auto-book Cost of Goods Sold vs Stock.</li>
          <li><b>Credit Note / Debit Note</b> (sales/purchase returns): reverse the party, the output GST / ITC and the stock — goods return at average cost; you cannot return more than you hold.</li>
          <li><b>Stock Journal</b>: bring in opening stock (Dr Stock, Cr Reserves & Surplus etc.) or write off / adjust stock out at average cost — the cleanest way to open your books with inventory.</li>
          <li><b>Simple mode</b> (or Receipt/Payment/Contra/Journal): type ledger names and Dr/Cr amounts — it must balance; the footer shows the difference live.</li>
          <li>Every voucher gets a running number per type; you may also type your own invoice no. (e.g. INV-24-001).</li>
          <li>Vouchers can be <b>viewed, printed, edited or deleted</b>. Every create/edit/delete is written to the <b>Edit Log</b> (Audit → Edit Log) with the old version archived — like TallyPrime's Edit Log.</li>
        </ul>
      </div>
      <div className="card">
        <h3>GST handling</h3>
        <ul style={{ lineHeight: 1.8, color: 'var(--ink-dim)', paddingLeft: 20 }}>
          <li>On sales: output GST ledgers (e.g. {s('Output CGST 9%')}) are auto-created per rate and credited; they sit under <i>Statutory Dues</i> (liability).</li>
          <li>On purchases: input ledgers ({s('Input CGST 9%')}) hold ITC under <i>Input Tax Credit</i> (asset).</li>
          <li>When you pay GST: go to <b>Payment</b> — Cr bank, Dr the output ledger net of ITC (do a <b>Journal</b> first to set off ITC: Dr Output CGST, Cr Input CGST — then pay the balance). GST Summary report shows totals per rate.</li>
        </ul>
      </div>
      <div className="card">
        <h3>Bulk Excel import / export (masters & transactions)</h3>
        <ul style={{ lineHeight: 1.8, color: 'var(--ink-dim)', paddingLeft: 20 }}>
          <li>Open <b>Company → Import / Export</b>. Four templates — <b>Ledgers, Stock Items, Opening Stock, Vouchers</b> — and each one also has <b>“My current data”</b> export for backup or edit-and-reimport.</li>
          <li>The <b>Stock Items</b> page has its own Excel panel: download a <b>sample file with example rows</b> (it also contains the full column-mapping guide), an empty template, or your current items — then upload with <b>Add only</b> or <b>Update &amp; add</b> and see a preview before importing.</li>
          <li>The template files <b>always keep the same columns</b>, so you can fill your master list once in Excel and reuse the same file for every new company or every future addition.</li>
          <li>Order to onboard in bulk: <b>1) Ledgers</b> (parties/banks/expense heads + opening balances), <b>2) Stock Items</b> (name, unit, HSN, GST rate), <b>3) Opening Stock</b> (item name, qty, rate + date + balancing account, usually Capital), then <b>4) Vouchers</b> (Receipt/Payment/Contra/Journal, one Dr+Cr row each).</li>
          <li>Upload a file → you see a <b>preview of the rows</b> → click <b>Import</b>. Valid rows are added; problem rows are listed one by one so you can fix and re-upload just those.</li>
          <li>Duplicate names are skipped (or updated if you switch the option to <b>Update</b>). .xlsx, .xls and .csv all work.</li>
        </ul>
      </div>
      <div className="card">
        <h3>Reports</h3>
        <ul style={{ lineHeight: 1.8, color: 'var(--ink-dim)', paddingLeft: 20 }}>
          <li><b>Balance Sheet</b> — Schedule III style with sections; current-period profit is absorbed into Shareholders’ Funds automatically.</li>
          <li><b>P&L</b> — Direct/Indirect income & expenses for any period.</li>
          <li><b>Trial Balance, Day Book, Ledger, Stock, GST</b> — all with date ranges. Every report can be printed (black & gold print styling).</li>
        </ul>
      </div>
      <div className="card">
        <h3>Good habits</h3>
        <ul style={{ lineHeight: 1.8, color: 'var(--ink-dim)', paddingLeft: 20 }}>
          <li>Opening balances Dr must equal Cr, else Balance Sheet won’t tally.</li>
          <li>Enter vouchers within the FY; dates before “books begin” or after FY end are rejected.</li>
          <li>Don’t sell more stock than you hold — COGS is capped at available stock value.</li>
          <li>Back up the {s('data/')} folder regularly (all data is in {s('data/tally.db')}).</li>
        </ul>
        <div className="card" style={{ margin: '14px 0 0' }}>
          <h3>Install on your phone (use it like an app)</h3>
          <ul style={{ lineHeight: 1.8, color: 'var(--ink-dim)', paddingLeft: 20 }}>
            <li><b>Android/Chrome:</b> open this site → menu ⋮ → “Add to Home screen” / “Install app”.</li>
            <li><b>iPhone/Safari:</b> Share → “Add to Home Screen”.</li>
            <li>It opens full-screen standalone with the gold diamond icon; the app shell works offline (your data needs connection).</li>
          </ul>
        </div>
        <p className="faint" style={{ fontSize: 12 }}>Coming later: TDS/TCS, payroll, e-invoice JSON &amp; QR, bank reconciliation, GST return aids (GSTR-1 / GSTR-3B buckets), multi-user login &amp; roles.</p>
      </div>
      <div className="card">
        <h3>Why do I still see the old version?</h3>
        <ul style={{ lineHeight: 1.8, color: 'var(--ink-dim)', paddingLeft: 20 }}>
          <li>The number at the bottom of the sidebar (and in Settings → “About this copy”) tells you which build is running — after this update it should read <b>build {BUILD_TAG}</b>.</li>
          <li>On a PC copy updates are one click: open <b>Settings → “Update this copy” → Update now</b> (needs internet for a few seconds; your data is never touched). The app downloads the newest build, installs it and restarts itself — then press <b>Ctrl+F5</b>. (To install the very first copy you still download the package once and run START_ME.bat — that is the only copy-paste you will ever need.)</li>
          <li>Still old? Press <b>Ctrl+F5</b> (hard refresh) once, or close the browser tab and reopen http://localhost:8080.</li>
        </ul>
      </div>
    </div>
  );
}
