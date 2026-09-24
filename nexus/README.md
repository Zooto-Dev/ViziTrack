# Nexus 2.0 — Order to Dispatch ERP with an FMS Builder

The whole order journey runs in one place: order punch, verification, credit, planning, material, production, QC, packing, invoice and dispatch. Every step is tracked by the FMS engine: each step has a doer, a planned time, an actual time, a status and a delay counted in working hours.

Open `nexus/index.html`. It works straight away in **Local mode**, where data is saved in your browser.
Demo login: `admin@nexus.local` / PIN `1234`. Other demo users: `sales@`, `accounts@`, `ppc@`, `store@`, `production@`, `qc@` and `dispatch@nexus.local`, all with PIN `1234`.

## Screens
| Screen | What it does |
|---|---|
| Home | One row of counts (open orders, late steps, due today, ready to dispatch), my tasks, late steps by doer, open orders by stage |
| My Tasks | The steps you need to do. **Done** is a single click, with an optional note. Shows planned time and running delay |
| Punch Order | One screen with no popups: pick the customer (payment terms fill in automatically), type items, Enter moves to the next row, Ctrl+S saves. The FMS starts on save |
| Orders / Order | Filters, search and CSV export. The order page shows items (ordered, dispatched, pending), the FMS timeline, priority (Urgent / On Hold / Cancel) and print |
| Dispatch | Ready (invoice done) → the dispatch form opens inside the row → part or full dispatch. On full dispatch the FMS step closes itself |
| Tracker | The FMS grid, one row per order and one column per step, the same layout as the sheet |
| FMS Builder | Steps, doer, conditions ("only when…"), start rules (after a step, before a date, a fallback), TAT (normal and urgent), live flow chart, validation, Simulate, versions (save as v2, then activate) |
| Customers / Items | Edit directly in the table, paste from Excel, CSV export |
| Users | Email, role, **doer name** (links the user to FMS steps), active flag, PIN |
| Roles & Access | Module × role matrix. Click a cell to cycle — / View / Edit |
| Settings | Office timings, lunch, weekly off, holidays, half-day rule, backup and restore |
| Audit Log | Who did what and when |

## UI rules followed
- One accent colour; colour is used only for status (red = late, amber = pending, green = done)
- No animations or transitions
- Compact tables instead of big cards
- No popups: forms open inline, confirms are two clicks on the same button, messages show in a strip at the top
- Small choices are buttons (segmented), not dropdowns. Long lists (customers, items) use type-to-search
- Keyboard: `/` search, `Alt+N` new order, `Ctrl+S` save, Enter moves to the next row

## FMS rules
- Only an **actual** (a step marked done) moves the chain. A step's planned time never triggers the next step.
- Actual = the time Done was clicked. Undo is allowed only for tracker editors (or yourself within 5 minutes), never after a later step is done, and it is written to the audit log.
- Every flow is **versioned**: an order stays on the version it started with, and new orders use the live version.
- Delay counts working time only (office hours, lunch, weekly offs, holidays).

## Going multi-user (Supabase)
1. In a Supabase project, run `supabase-schema.sql` in the SQL Editor.
2. Fill `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `config.js`.
3. Under Authentication → Users, create the login for each email. The first person to log in becomes Admin; add everyone else under Users.
4. Data syncs live to every open screen.

## Files
`index.html` (shell) · `styles.css` · `engine.js` (FMS engine: planned, status, delay) · `core.js` (store, login, RBAC, router) · `seed.js` (default flow and demo data) · `ops.js` (daily work screens) · `fms.js` (builder) · `admin.js` (masters and admin)

## Known limits (next steps)
- In cloud mode, RBAC and number generation run in the browser. Database RLS only checks that the user is signed in. For strict server-side checks, the next step is RPC or Edge Functions.
- No stock or inventory yet: dispatch checks order qty, not finished-goods stock.
- WhatsApp or email alerts are not connected yet.
