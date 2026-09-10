// Chart-of-accounts classification template (Ind AS / Schedule III flavoured),
// used for company seeds, the ledger creation picker and financial statements.

// `groups` = leaf groups a ledger can directly belong to.
// code, name, type (report type), kind (ledger kind hint), bs (balance sheet bucket) or pl (P&L bucket)
export const GROUPS = [
  // ---------- BALANCE SHEET — EQUITY & LIABILITIES ----------
  { code: 'share_capital',     name: 'Share Capital',                   type: 'Liability', kind: 'Capital',     bs: 'shareholders_funds' },
  { code: 'reserves_surplus',  name: 'Reserves & Surplus',              type: 'Liability', kind: 'Capital',     bs: 'shareholders_funds' },
  { code: 'share_warrants',    name: 'Money against Share Warrants',    type: 'Liability', kind: 'Capital',     bs: 'shareholders_funds' },
  { code: 'long_borrow',       name: 'Long-Term Borrowings',            type: 'Liability', kind: 'Loans',       bs: 'noncurrent_liab' },
  { code: 'deferred_tax_liab', name: 'Deferred Tax Liabilities (Net)',  type: 'Liability', kind: 'CurrentLiab', bs: 'noncurrent_liab' },
  { code: 'other_ncl',         name: 'Other Non-Current Liabilities',   type: 'Liability', kind: 'Loans',       bs: 'noncurrent_liab' },
  { code: 'long_provisions',   name: 'Long-Term Provisions',            type: 'Liability', kind: 'CurrentLiab', bs: 'noncurrent_liab' },
  { code: 'short_borrow',      name: 'Short-Term Borrowings',           type: 'Liability', kind: 'Loans',       bs: 'current_liab' },
  { code: 'sundry_creditors',  name: 'Sundry Creditors (Trade Payables)', type: 'Liability', kind: 'SundryCreditor', bs: 'current_liab' },
  { code: 'acceptances',       name: 'Acceptances',                     type: 'Liability', kind: 'SundryCreditor', bs: 'current_liab' },
  { code: 'statutory_dues',    name: 'Statutory Dues (GST / TDS Payable)', type: 'Liability', kind: 'CurrentLiab', bs: 'current_liab' },
  { code: 'other_current_liab',name: 'Other Current Liabilities',       type: 'Liability', kind: 'CurrentLiab', bs: 'current_liab' },
  { code: 'short_provisions',  name: 'Short-Term Provisions',           type: 'Liability', kind: 'CurrentLiab', bs: 'current_liab' },
  // ---------- BALANCE SHEET — ASSETS ----------
  { code: 'fixed_tangible',    name: 'Fixed Assets — Tangible',         type: 'Asset', kind: 'FixedAsset',  bs: 'noncurrent_assets' },
  { code: 'fixed_intangible',  name: 'Fixed Assets — Intangible',       type: 'Asset', kind: 'FixedAsset',  bs: 'noncurrent_assets' },
  { code: 'fixed_cwip',        name: 'Capital Work-in-Progress',        type: 'Asset', kind: 'FixedAsset',  bs: 'noncurrent_assets' },
  { code: 'intangibles_dev',   name: 'Intangible Assets under Development', type: 'Asset', kind: 'FixedAsset', bs: 'noncurrent_assets' },
  { code: 'noncurrent_inv',    name: 'Non-Current Investments',         type: 'Asset', kind: 'Investments', bs: 'noncurrent_assets' },
  { code: 'deferred_tax_asset',name: 'Deferred Tax Assets (Net)',       type: 'Asset', kind: 'Investments', bs: 'noncurrent_assets' },
  { code: 'long_loans_adv',    name: 'Long-Term Loans & Advances',      type: 'Asset', kind: 'Advances',    bs: 'noncurrent_assets' },
  { code: 'other_nca',         name: 'Other Non-Current Assets',        type: 'Asset', kind: 'Advances',    bs: 'noncurrent_assets' },
  { code: 'current_inv',       name: 'Current Investments',             type: 'Asset', kind: 'Investments', bs: 'current_assets' },
  { code: 'inventories',       name: 'Inventories (Stock-in-Trade)',    type: 'Asset', kind: 'Inventory',   bs: 'current_assets' },
  { code: 'sundry_debtors',    name: 'Sundry Debtors (Trade Receivables)', type: 'Asset', kind: 'SundryDebtor', bs: 'current_assets' },
  { code: 'cash_in_hand',      name: 'Cash in Hand',                    type: 'Asset', kind: 'Cash',        bs: 'current_assets' },
  { code: 'bank_accounts',     name: 'Bank Accounts',                   type: 'Asset', kind: 'Bank',        bs: 'current_assets' },
  { code: 'short_loans_adv',   name: 'Short-Term Loans & Advances',     type: 'Asset', kind: 'Advances',    bs: 'current_assets' },
  { code: 'input_tax_credit',  name: 'Input Tax Credit (GST)',          type: 'Asset', kind: 'CurrentLiab', bs: 'current_assets' },
  { code: 'other_current_asset', name: 'Other Current Assets',          type: 'Asset', kind: 'Advances',    bs: 'current_assets' },
  // ---------- PROFIT & LOSS ----------
  { code: 'sales',             name: 'Sales Accounts (Direct Income)',       type: 'Income',  kind: 'Income', pl: 'direct_income' },
  { code: 'income_direct',     name: 'Other Direct Income',                  type: 'Income',  kind: 'Income', pl: 'direct_income' },
  { code: 'income_indirect',   name: 'Indirect Income',                      type: 'Income',  kind: 'Income', pl: 'indirect_income' },
  { code: 'purchases',         name: 'Purchases (Direct Expenses)',          type: 'Expense', kind: 'Expense', pl: 'direct_expense' },
  { code: 'expense_direct',    name: 'Other Direct Expenses',                type: 'Expense', kind: 'Expense', pl: 'direct_expense' },
  { code: 'expense_indirect',  name: 'Indirect Expenses',                    type: 'Expense', kind: 'Expense', pl: 'indirect_expense' },
  { code: 'tax_expense',       name: 'Tax Expenses (Income Tax / Deferred)', type: 'Expense', kind: 'Expense', pl: 'tax_expense' },
];

// Balance Sheet structural template (sub-totals shown on the report).
export const BS_TEMPLATE = {
  liabilities: [
    { key: 'shareholders_funds', label: "A. Shareholders' Funds", children: ['share_capital', 'reserves_surplus', 'share_warrants'] },
    { key: 'noncurrent_liab', label: 'B. Non-Current Liabilities', children: ['long_borrow', 'deferred_tax_liab', 'other_ncl', 'long_provisions'] },
    { key: 'current_liab', label: 'C. Current Liabilities', children: ['short_borrow', 'sundry_creditors', 'acceptances', 'statutory_dues', 'other_current_liab', 'short_provisions'] },
  ],
  assets: [
    { key: 'noncurrent_assets', label: 'A. Non-Current Assets', children: ['fixed_tangible', 'fixed_intangible', 'fixed_cwip', 'intangibles_dev', 'noncurrent_inv', 'deferred_tax_asset', 'long_loans_adv', 'other_nca'] },
    { key: 'current_assets', label: 'B. Current Assets', children: ['current_inv', 'inventories', 'sundry_debtors', 'cash_in_hand', 'bank_accounts', 'short_loans_adv', 'input_tax_credit', 'other_current_asset'] },
  ],
};

export const PL_SECTIONS = [
  { key: 'direct_income', label: 'Direct Income' },
  { key: 'indirect_income', label: 'Indirect Income' },
  { key: 'direct_expense', label: 'Direct Expenses' },
  { key: 'indirect_expense', label: 'Indirect Expenses' },
  { key: 'tax_expense', label: 'Tax Expenses' },
];

const groupBy = {};
for (const g of GROUPS) groupBy[g.code] = g;
export function groupMeta(code) { return groupBy[code] || null; }
