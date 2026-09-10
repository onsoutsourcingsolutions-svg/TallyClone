# ◆ O.N.S. OUTSOURCING SOLUTIONS — TallyPrime-style accounting suite for Indian business

Web app (phone + desktop) with a strict **black & gold** UI. Double-entry accounting
built around Indian needs: Ind AS / Schedule-III style balance sheet, GST-enabled
invoices, weighted-average inventory, and Tally-like voucher workflows.

## Run it on YOUR computer (no account, no internet needed)
Works on **Windows 10/11, macOS and Linux**. You only need to install **Node.js
(v22 LTS or newer)** once from https://nodejs.org — everything else is one click.

1. Put this folder on your PC (e.g. in `Documents\ONS-Books`).
2. **Windows:** double-click **`start-windows.bat`**.
   **Mac:** right-click `start-mac-linux.sh` → Open, or run `bash start-mac-linux.sh`.
   (First run installs packages and builds — about 1 minute; later runs are instant.)
3. Your browser opens **http://localhost:8080** → create your company → start booking.
4. Close the black console window to stop the app. Your data is saved in `data/tally.db`
   (copy that one file to back up / move to another PC).

## Use it on your PHONE too (same Wi-Fi as your PC)
1. Start the app on your PC as above. The window prints:
   - `On this computer: http://localhost:8080`
   - `On your PHONE (same Wi-Fi): http://192.168.x.x:8080` — plus a **QR code**.
2. On your phone, scan the QR (or type the phone address) → the app opens.
3. Add it to your home screen: **Android** Chrome → menu ⋮ → *Add to Home screen*;
   **iPhone** Safari → Share → *Add to Home Screen*. Opens like an app afterwards.

**Phone can't connect?** When Windows asks about Node.js / firewall the first time,
choose **Allow on Private networks**. If it still fails, your router may have
"AP isolation / client isolation" on — turn it off, or connect the phone to the
same band (2.4 GHz) as the PC. (Work phones often block local-network browsing —
use a personal phone.)

### "localhost refused to connect" — fixes in order
1. **The black window must stay open** while you use the app. Close it = app off.
   See the banner inside it: `✔ Server is RUNNING now. http://localhost:8080`.
2. **Did you EXTRACT the zip?** Right-click the .zip → *Extract All…* → run the
   .bat from the extracted folder. Running from inside the zip fails.
3. **Browser opens before the app?** Now impossible: the new launcher waits until
   the server answers, then opens the page. Re-download the latest package.
4. **Node.js "not found"/"too old"?** The window says exactly which. Install
   **v22 LTS** from nodejs.org, and if you installed it moments earlier, restart
   the PC / open a fresh window before retrying.
5. **Anything else:** double-click **`diagnose.bat`** — it writes **`diag.txt`**
   (node version, folder state, port test) — send that file for instant help.

> This "PC + phone on Wi-Fi" mode is the recommended way to run for real. The
> optional demo link in Arena (`...e2b.app`) is a sandbox preview and is NOT
> meant for daily phone use.

## Quick start (first 20 minutes)
- **Settings** → set your FY (e.g. `2025-04-01`) & books-begin date *before* vouchers; upload your logo.
- **Ledgers**: add your bank, parties, capital, opening balances (Dr = Cr).
- **Items**: add stock with HSN + GST rate.
- **Stock Journal**: enter opening stock (Dr Stock ⇄ Cr Reserves & Surplus).
- Enter **Purchase** (stock items), **Sales**, then open **Balance Sheet** — it must tally.

## Stack
- **Server:** Node.js (>= 22.5), Express, built-in `node:sqlite`. Data lives in
  `data/tally.db` (auto-created, git-ignored). `server/run.js` handles the
  `--experimental-sqlite` flag automatically across Node versions.
- **Web:** React 18 + Vite (no CSS framework — hand-rolled theme).
- Amounts are stored as **integer paise**; the API speaks JSON paise.

## Dev mode (this sandbox / contributing)
```bash
npm install
npm run dev          # API on :8080 + Vite UI on :5173 (proxy /api → :8080)
```

## What it does today
- Multi-company books with financial year + books-begin date, GSTIN/state, ledger seeds.
- Ledgers classified into Ind AS / Schedule III groups (Shareholders' Funds,
  Non-current/Current liabilities & assets, Direct/Indirect income & expenses, tax).
- Vouchers: **Receipt, Payment, Contra, Journal, Sales, Purchase, Credit Note,
  Debit Note, Stock Journal** — running numbers, narration, references.
- **Edit & audit**: every voucher can be edited (old version archived) or deleted;
  Audit → **Edit Log** shows the full create/edit/delete trail per voucher
  (TallyPrime-style audit log).
- Stock items (unit/HSN/GST), automatic weighted-average stock valuation,
  insufficient-stock guard on sales/returns.
- Stock-invoice auto-posting:
  - GST split CGST+SGST (intra) or IGST (inter), per item rate;
  - output GST ledgers (Statutory Dues) and ITC ledgers (Input Tax Credit)
    auto-created per rate when first used;
  - sales auto-book **COGS vs Stock**; purchases capitalise into Stock-in-Hand;
  - **Credit Notes** reverse sales + output GST and bring stock back at average cost;
    **Debit Notes** debit the supplier, remove stock at bill value and reverse ITC;
  - **Stock Journal** posts opening stock / adjustments against any balancing
    account (e.g. Reserves & Surplus), in or out (out can use average-cost auto rate).
- Reports: Balance Sheet (tallies, current-period profit absorbed), Profit & Loss,
  Trial Balance, Day Book, Ledger (Dr/Cr/balance), Stock statement, GST summary —
  date ranges, print (black & gold print styling).
- **PWA**: installable on phones (manifest + icons + offline app-shell service worker).
- Works on mobile: hamburger navigation, responsive grids/tables.

## Rules enforced
- Every voucher must balance (debit = credit).
- Dates must fall inside the books period; opening Dr must equal opening Cr for a
  clean balance sheet.
- A ledger that already has postings can't change its group or opening balance;
  used ledgers/items can't be deleted.

## Layout
```
server/           Express + sqlite
  index.js        app bootstrap & static serving (dist/)
  api.js          REST routes under /api
  db.js           schema, connection, tx/settings helpers
  engine.js       posting, GST, inventory (weighted average), reports
  chart.js        Ind AS / Schedule III classification template
  lib.js          paise money + date + voucher-class helpers
scripts/smoke.js  engine self-test (node --experimental-sqlite scripts/smoke.js)
src/              React UI (black/gold, responsive)
  screens/        Company, Gateway, Masters, Voucher, DayBook, Reports, Settings, Help
```

## Roadmap (next)
Bank reconciliation · GST return aids (GSTR-1 buckets, HSN summary) · TDS/TCS · payroll ·
e-invoice JSON & QR · import/export (Excel/JSON) · multi-user & roles · print invoice formats.

## API surface (vouchers)
```
POST /api/vouchers                    create  {class, date, number, narration, ref, party_id,
PATCH /api/vouchers/:id                      regime, auto_tax, entries:[{account_id,debit,credit,particulars}]
DELETE /api/vouchers/:id                     or items:[{item_id,qty,rate,direction}], counterpart_id}
GET  /api/vouchers/:id                detail incl. entries/items + edit-log
GET  /api/edit-log                    audit trail
```
All amounts are integer paise. Classes: receipt, payment, contra, journal, sales,
purchase, credit_note, debit_note, stock_journal.
