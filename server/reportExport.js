// server/reportExport.js — v1.11.45: Download buttons for ALL tabs wherever applicable
// Exports sales, purchases, daybook, stock, ledger, GST, trial balance, balance sheet, P&L, dashboard as Excel
// Fixes sales total 927956 after GST mismatch by providing detailed breakdown download

let _xlsxPromise = null;
function xlsxLib() {
  if (!_xlsxPromise) {
    _xlsxPromise = (async () => {
      try {
        const m = await import('xlsx');
        return m && m.default && m.default.utils ? m.default : m;
      } catch (e) {
        _xlsxPromise = null;
        throw new Error('Excel package not installed — run npm install');
      }
    })();
  }
  return _xlsxPromise;
}

import { db } from './db.js';
import { inventoryState, dashboard, trialBalance, balanceSheet, profitLoss, dayBook, gstSummary, fmtP } from './engine.js';
import { todayISO } from './lib.js';

function sheetOut(X, sheets) {
  // sheets = [{name, rows, info}]
  const wb = X.utils.book_new();
  for (const sh of sheets) {
    const rows = sh.rows && sh.rows.length ? sh.rows : [{ '(empty)': '' }];
    const ws = X.utils.json_to_sheet(rows);
    // auto width
    const cols = Object.keys(rows[0] || {}).map(k => ({ wch: Math.min(30, Math.max(10, String(k).length + 8)) }));
    if (cols.length) ws['!cols'] = cols;
    X.utils.book_append_sheet(wb, ws, sh.name.slice(0, 31));
    if (sh.info && sh.info.length) {
      const is = X.utils.aoa_to_sheet(sh.info.map(t => [t]));
      is['!cols'] = [{ wch: 110 }];
      X.utils.book_append_sheet(wb, is, (sh.name + ' Info').slice(0, 31));
    }
  }
  return X.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function fmtPaise(p) { return (Number(p) / 100).toFixed(2); }
function ddMMyyyy(iso) {
  if (!iso) return '';
  const s = String(iso);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return s;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export async function exportSalesExcel(c, { from, to }) {
  const X = await xlsxLib();
  const f = from || c.books_begin_from;
  const t = to || todayISO();
  // Get all sales vouchers with party and invoice_type
  const vouchers = db.prepare(`
    SELECT v.id, v.class, v.voucher_no, v.date, v.number, v.narration, v.ref, v.invoice_type,
      (SELECT COALESCE(SUM(e.credit - e.debit),0) FROM entries e JOIN accounts a ON a.id=e.account_id WHERE e.voucher_id=v.id AND a.group_code IN ('sales','income_direct')) AS taxable,
      (SELECT COALESCE(SUM(e.debit - e.credit),0) FROM entries e JOIN accounts a ON a.id=e.account_id WHERE e.voucher_id=v.id AND a.group_code='sundry_debtors') AS invoice_total,
      (SELECT COALESCE(SUM(e.credit - e.debit),0) FROM entries e JOIN accounts a ON a.id=e.account_id WHERE e.voucher_id=v.id AND a.kind='Duty' AND a.group_code='statutory_dues') AS output_gst,
      (SELECT a.name FROM entries e JOIN accounts a ON a.id=e.account_id WHERE e.voucher_id=v.id AND a.group_code='sundry_debtors' ORDER BY e.line_no LIMIT 1) AS party_name,
      (SELECT a.gstin FROM entries e JOIN accounts a ON a.id=e.account_id WHERE e.voucher_id=v.id AND a.group_code='sundry_debtors' ORDER BY e.line_no LIMIT 1) AS party_gstin
    FROM vouchers v WHERE v.company_id=? AND v.active=1 AND v.class='sales' AND v.date BETWEEN ? AND ?
    ORDER BY v.date, v.id
  `).all(c.id, f, t);

  const rows = vouchers.map(v => ({
    Date_DDMMYYYY: ddMMyyyy(v.date),
    Date_ISO: v.date,
    Invoice_No: v.number || '#'+v.voucher_no,
    Voucher_No: v.voucher_no,
    Invoice_Type: v.invoice_type || 'tax_invoice',
    Affects_Stock: (v.invoice_type === 'tax_invoice' && !String(v.number||'').toUpperCase().startsWith('PI-')) ? 'YES' : 'NO (PI/Proforma)',
    Party_Name: v.party_name || '',
    Party_GSTIN: v.party_gstin || '',
    Taxable_Amount: fmtPaise(v.taxable),
    Output_GST: fmtPaise(v.output_gst),
    Invoice_Total_Incl_GST: fmtPaise(v.invoice_total),
    Taxable_Paise: Number(v.taxable),
    GST_Paise: Number(v.output_gst),
    Invoice_Paise: Number(v.invoice_total),
    Narration: v.narration || '',
    Ref: v.ref || '',
  }));

  const totalTaxable = vouchers.reduce((s, v) => s + Number(v.taxable), 0);
  const totalGST = vouchers.reduce((s, v) => s + Number(v.output_gst), 0);
  const totalInvoice = vouchers.reduce((s, v) => s + Number(v.invoice_total), 0);

  const summary = [
    { Metric: 'Period From (DD/MM/YYYY)', Value: ddMMyyyy(f), Paise: f },
    { Metric: 'Period To (DD/MM/YYYY)', Value: ddMMyyyy(t), Paise: t },
    { Metric: 'Total Sales Invoices', Value: vouchers.length, Paise: '' },
    { Metric: 'Taxable Sales (Sales ledger credit)', Value: fmtPaise(totalTaxable), Paise: totalTaxable },
    { Metric: 'Output GST (Statutory Dues credit)', Value: fmtPaise(totalGST), Paise: totalGST },
    { Metric: 'Invoice Value FY Incl GST (Party Dr) — This should match 927956 if that is your total', Value: fmtPaise(totalInvoice), Paise: totalInvoice },
    { Metric: 'Taxable + GST should = Invoice Total', Value: fmtPaise(totalTaxable+totalGST), Paise: totalTaxable+totalGST },
    { Metric: 'Difference (Invoice - (Taxable+GST)) should be 0', Value: fmtPaise(totalInvoice - (totalTaxable+totalGST)), Paise: totalInvoice - (totalTaxable+totalGST) },
    { Metric: 'Note: Only Tax Invoice affects stock, PI/Proforma does NOT', Value: '', Paise: '' },
    { Metric: 'Note: Stock import (stock_journal) does NOT appear here', Value: '', Paise: '' },
  ];

  // Also item-wise breakdown
  const itemRows = db.prepare(`
    SELECT v.date, v.number, v.invoice_type, i.name AS item_name, ie.qty, ie.rate, ie.amount, ie.direction,
      (SELECT a.name FROM entries e JOIN accounts a ON a.id=e.account_id WHERE e.voucher_id=v.id AND a.group_code='sundry_debtors' LIMIT 1) AS party
    FROM item_entries ie JOIN vouchers v ON v.id=ie.voucher_id JOIN items i ON i.id=ie.item_id
    WHERE v.company_id=? AND v.active=1 AND v.class='sales' AND v.date BETWEEN ? AND ?
    ORDER BY v.date, v.id, ie.line_no
  `).all(c.id, f, t).map(r => ({
    Date: ddMMyyyy(r.date),
    Invoice_No: r.number,
    Invoice_Type: r.invoice_type,
    Party: r.party,
    Item_Name: r.item_name,
    Qty: r.qty,
    Rate: fmtPaise(r.rate),
    Amount_Taxable: fmtPaise(r.amount),
    Direction: r.direction,
  }));

  const info = [
    'SALES EXPORT — Detailed breakdown to verify 927956 after GST',
    `Period: ${ddMMyyyy(f)} to ${ddMMyyyy(t)} (DD/MM/YYYY)`,
    `Company: ${c.name}`,
    '',
    'Columns:',
    'Taxable_Amount = Sales ledger credit (excl GST) — this is what P&L shows as Sales',
    'Output_GST = Statutory Dues credit (CGST+SGST+IGST)',
    'Invoice_Total_Incl_GST = Party Dr (Sundry Debtors) — this is invoice value incl GST excl stock valuation',
    'If you see 927956, check Invoice_Total_Incl_GST total — that should match 927956',
    'If Taxable + GST != Invoice Total, difference is rounding or other adjustments',
    '',
    'Only Tax Invoice affects stock — PI/Proforma marked NO does NOT affect stock',
    'Stock import (stock_journal) never appears in sales export',
    '',
    'All dates DD/MM/YYYY as requested',
  ];

  const buf = sheetOut(X, [
    { name: 'Sales Summary', rows: summary, info: [] },
    { name: 'Sales Invoices', rows, info },
    { name: 'Sales Items', rows: itemRows, info: ['Item-wise breakdown'] },
  ]);

  const companyName = c.name.replace(/[\\/:*?"<>|]+/g, '-').trim();
  return { buf, file: `${companyName}-sales-${f}-to-${t}.xlsx` };
}

export async function exportPurchasesExcel(c, { from, to }) {
  const X = await xlsxLib();
  const f = from || c.books_begin_from;
  const t = to || todayISO();
  const vouchers = db.prepare(`
    SELECT v.id, v.class, v.voucher_no, v.date, v.number, v.narration, v.ref, v.invoice_type,
      (SELECT COALESCE(SUM(e.debit - e.credit),0) FROM entries e JOIN accounts a ON a.id=e.account_id WHERE e.voucher_id=v.id AND a.group_code IN ('purchases','expense_direct')) AS taxable,
      (SELECT COALESCE(SUM(e.credit - e.debit),0) FROM entries e JOIN accounts a ON a.id=e.account_id WHERE e.voucher_id=v.id AND a.group_code='sundry_creditors') AS invoice_total,
      (SELECT a.name FROM entries e JOIN accounts a ON a.id=e.account_id WHERE e.voucher_id=v.id AND a.group_code='sundry_creditors' LIMIT 1) AS party_name
    FROM vouchers v WHERE v.company_id=? AND v.active=1 AND v.class='purchase' AND v.date BETWEEN ? AND ?
    ORDER BY v.date, v.id
  `).all(c.id, f, t);
  const rows = vouchers.map(v => ({
    Date: ddMMyyyy(v.date),
    Bill_No: v.number || '#'+v.voucher_no,
    Invoice_Type: v.invoice_type,
    Party: v.party_name,
    Taxable: fmtPaise(v.taxable),
    Invoice_Total: fmtPaise(v.invoice_total),
    Narration: v.narration,
  }));
  const buf = sheetOut(X, [{ name: 'Purchases', rows, info: [`Purchases ${ddMMyyyy(f)} to ${ddMMyyyy(t)}`] }]);
  return { buf, file: `${c.name.replace(/[^a-z0-9]/gi,'-')}-purchases-${f}-to-${t}.xlsx` };
}

export async function exportDayBookExcel(c, { from, to }) {
  const X = await xlsxLib();
  const d = dayBook(c, from || c.books_begin_from, to || todayISO());
  const rows = d.rows.map(r => ({
    Date: ddMMyyyy(r.date),
    Type: r.class,
    Voucher_No: r.voucher_no,
    Number: r.number,
    Narration: r.narration,
    Ref: r.ref,
    Debit: fmtPaise(r.debit),
    Credit: fmtPaise(r.credit),
    Lines: r.lines,
  }));
  const buf = sheetOut(X, [{ name: 'Day Book', rows, info: [`Day Book ${ddMMyyyy(d.from)} to ${ddMMyyyy(d.to)}`] }]);
  return { buf, file: `${c.name.replace(/[^a-z0-9]/gi,'-')}-daybook-${d.from}-to-${d.to}.xlsx` };
}

export async function exportStockExcel(c, { from, to }) {
  const X = await xlsxLib();
  const f = from || c.books_begin_from;
  const t = to || todayISO();
  const items = db.prepare('SELECT * FROM items WHERE company_id=? AND active=1 AND is_service=0 ORDER BY name').all(c.id);
  const rows = items.map(it => {
    const st = inventoryState(it.id);
    return {
      Item_Name: it.name,
      Unit: it.unit,
      HSN: it.hsn,
      GST_Rate: it.gst_rate,
      Stock_Qty: st.qty,
      Stock_Value: fmtPaise(st.value),
      Avg_Rate: fmtPaise(st.rate),
    };
  });
  const buf = sheetOut(X, [{ name: 'Stock Summary', rows, info: [`Stock as on ${ddMMyyyy(t)}`] }]);
  return { buf, file: `${c.name.replace(/[^a-z0-9]/gi,'-')}-stock-${t}.xlsx` };
}

export async function exportLedgerExcel(c, { accountId, from, to }) {
  const X = await xlsxLib();
  const { ledgerReport } = await import('./engine.js');
  const f = from || c.books_begin_from;
  const t = to || todayISO();
  const accId = Number(accountId);
  if (!accId) throw new Error('account_id required');
  const rep = ledgerReport(c, accId, f, t);
  const rows = rep.rows.map(r => ({
    Date: ddMMyyyy(r.date),
    Voucher_Type: r.class,
    Voucher_No: r.voucher_no,
    Number: r.number,
    Particulars: r.particulars,
    Debit: fmtPaise(r.debit),
    Credit: fmtPaise(r.credit),
    Balance: fmtPaise(r.balance),
  }));
  const buf = sheetOut(X, [
    { name: 'Ledger', rows, info: [`Ledger ${rep.account.name} ${ddMMyyyy(f)} to ${ddMMyyyy(t)} Opening ${fmtPaise(rep.opening)} Closing ${fmtPaise(rep.closing)}`] }
  ]);
  return { buf, file: `${c.name.replace(/[^a-z0-9]/gi,'-')}-ledger-${rep.account.name.replace(/[^a-z0-9]/gi,'-')}-${f}-to-${t}.xlsx` };
}

export async function exportTrialBalanceExcel(c, { asOn }) {
  const X = await xlsxLib();
  const rep = trialBalance(c, asOn || todayISO());
  const rows = rep.rows.map(r => ({
    Account: r.name,
    Group: r.group_name,
    Type: r.type,
    Debit: fmtPaise(r.debit),
    Credit: fmtPaise(r.credit),
  }));
  rows.push({ Account: 'TOTAL', Group: '', Type: '', Debit: fmtPaise(rep.totals.debit), Credit: fmtPaise(rep.totals.credit) });
  const buf = sheetOut(X, [{ name: 'Trial Balance', rows, info: [`Trial Balance as on ${ddMMyyyy(rep.as_on)} Balanced: ${rep.balanced}`] }]);
  return { buf, file: `${c.name.replace(/[^a-z0-9]/gi,'-')}-trial-balance-${rep.as_on}.xlsx` };
}

export async function exportBalanceSheetExcel(c, { asOn }) {
  const X = await xlsxLib();
  const rep = balanceSheet(c, asOn || todayISO());
  const rows = [];
  rows.push({ Section: 'LIABILITIES', Group: '', Ledger: '', Amount: '' });
  for (const sec of rep.liabilities) {
    rows.push({ Section: sec.label, Group: '', Ledger: '', Amount: fmtPaise(sec.amount) });
    for (const g of sec.rows) {
      rows.push({ Section: '', Group: g.label, Ledger: '', Amount: fmtPaise(g.amount) });
      for (const l of g.children) rows.push({ Section: '', Group: '', Ledger: l.name, Amount: fmtPaise(l.amount) });
    }
  }
  rows.push({ Section: 'ASSETS', Group: '', Ledger: '', Amount: '' });
  for (const sec of rep.assets) {
    rows.push({ Section: sec.label, Group: '', Ledger: '', Amount: fmtPaise(sec.amount) });
    for (const g of sec.rows) {
      rows.push({ Section: '', Group: g.label, Ledger: '', Amount: fmtPaise(g.amount) });
      for (const l of g.children) rows.push({ Section: '', Group: '', Ledger: l.name, Amount: fmtPaise(l.amount) });
    }
  }
  rows.push({ Section: 'TOTAL LIABILITIES', Group: '', Ledger: '', Amount: fmtPaise(rep.totals.liabilities) });
  rows.push({ Section: 'TOTAL ASSETS', Group: '', Ledger: '', Amount: fmtPaise(rep.totals.assets) });
  const buf = sheetOut(X, [{ name: 'Balance Sheet', rows, info: [`Balance Sheet as on ${ddMMyyyy(rep.as_on)} Balanced: ${rep.balanced}`] }]);
  return { buf, file: `${c.name.replace(/[^a-z0-9]/gi,'-')}-balance-sheet-${rep.as_on}.xlsx` };
}

export async function exportProfitLossExcel(c, { from, to }) {
  const X = await xlsxLib();
  const rep = profitLoss(c, from || c.books_begin_from, to || todayISO());
  const rows = [];
  for (const sec of rep.sections) {
    rows.push({ Section: sec.label, Account: '', Amount: fmtPaise(sec.total) });
    for (const r of sec.rows) rows.push({ Section: '', Account: r.name, Amount: fmtPaise(r.amount) });
  }
  rows.push({ Section: 'Income Total', Account: '', Amount: fmtPaise(rep.incomeTotal) });
  rows.push({ Section: 'Expense Total', Account: '', Amount: fmtPaise(rep.expenseTotal) });
  rows.push({ Section: 'Net Profit', Account: '', Amount: fmtPaise(rep.netProfit) });
  const buf = sheetOut(X, [{ name: 'P&L', rows, info: [`P&L ${ddMMyyyy(rep.from)} to ${ddMMyyyy(rep.to)}`] }]);
  return { buf, file: `${c.name.replace(/[^a-z0-9]/gi,'-')}-profit-loss-${rep.from}-to-${rep.to}.xlsx` };
}

export async function exportGstExcel(c, { from, to }) {
  const X = await xlsxLib();
  const rep = gstSummary(c, from || c.books_begin_from, to || todayISO());
  const rows = rep.rows.map(r => ({
    Ledger: r.ledger,
    Group: r.group_code,
    Tax_Paise: r.tax,
    Tax: fmtPaise(r.tax),
    Taxable_Paise: r.taxable,
    Taxable: fmtPaise(r.taxable),
  }));
  const buf = sheetOut(X, [{ name: 'GST Summary', rows, info: [`GST ${ddMMyyyy(rep.from)} to ${ddMMyyyy(rep.to)}`] }]);
  return { buf, file: `${c.name.replace(/[^a-z0-9]/gi,'-')}-gst-${rep.from}-to-${rep.to}.xlsx` };
}

export async function exportDashboardExcel(c) {
  const X = await xlsxLib();
  const d = dashboard(c);
  const summary = [
    { Metric: 'As On', Value: ddMMyyyy(d.asOn) },
    { Metric: 'FY From', Value: ddMMyyyy(d.fyFrom) },
    { Metric: 'Bank Total', Value: fmtPaise(d.bank.total) },
    { Metric: 'Cash Total', Value: fmtPaise(d.cash.total) },
    { Metric: 'Receivables Total', Value: fmtPaise(d.receivables.total) },
    { Metric: 'Payables Total', Value: fmtPaise(d.payables.total) },
    { Metric: 'Stock Total Value', Value: fmtPaise(d.stock.totalValue) },
    { Metric: 'Stock Total Qty', Value: d.stock.totalQty },
    { Metric: 'Sales FY Taxable', Value: fmtPaise(d.sales.fy) },
    { Metric: 'Sales FY Invoice Incl GST (should match 927956 if that is total)', Value: fmtPaise(d.sales.invoiceFY) },
    { Metric: 'Sales Month Taxable', Value: fmtPaise(d.sales.month) },
    { Metric: 'Sales Month Invoice', Value: fmtPaise(d.sales.invoiceMonth) },
    { Metric: 'Sales Count FY', Value: d.sales.countFY },
    { Metric: 'Purchases FY', Value: fmtPaise(d.purchases.fy) },
    { Metric: 'Purchases Month', Value: fmtPaise(d.purchases.month) },
    { Metric: 'Profit FY', Value: fmtPaise(d.profit.fy) },
    { Metric: 'GST Output FY', Value: fmtPaise(d.gst.outputFY) },
    { Metric: 'GST Input FY', Value: fmtPaise(d.gst.inputFY) },
    { Metric: 'GST Net FY', Value: fmtPaise(d.gst.netFY) },
  ];
  const salesRows = db.prepare(`
    SELECT v.date, v.number, v.invoice_type, a.name AS party,
      (SELECT SUM(e.credit - e.debit) FROM entries e JOIN accounts ac ON ac.id=e.account_id WHERE e.voucher_id=v.id AND ac.group_code IN ('sales','income_direct')) AS taxable,
      (SELECT SUM(e.debit - e.credit) FROM entries e JOIN accounts ac ON ac.id=e.account_id WHERE e.voucher_id=v.id AND ac.group_code='sundry_debtors') AS invoice
    FROM vouchers v LEFT JOIN entries e ON e.voucher_id=v.id LEFT JOIN accounts a ON a.id=e.account_id AND a.group_code='sundry_debtors'
    WHERE v.company_id=? AND v.active=1 AND v.class='sales' GROUP BY v.id ORDER BY v.date DESC LIMIT 100
  `).all(c.id).map(r => ({
    Date: ddMMyyyy(r.date),
    Invoice_No: r.number,
    Invoice_Type: r.invoice_type,
    Party: r.party,
    Taxable: fmtPaise(r.taxable),
    Invoice_Incl_GST: fmtPaise(r.invoice),
  }));
  const buf = sheetOut(X, [
    { name: 'Dashboard Summary', rows: summary, info: ['Dashboard export — all KPIs with invoice vs taxable breakdown'] },
    { name: 'Recent Sales 100', rows: salesRows, info: [] },
  ]);
  return { buf, file: `${c.name.replace(/[^a-z0-9]/gi,'-')}-dashboard-${d.asOn}.xlsx` };
}
