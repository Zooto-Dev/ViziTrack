/* Nexus 2.0 — daily work screens: Home, My Tasks, Punch, Orders, Order, Dispatch, Tracker. */
'use strict';

function stepDoneBtn(o, s, def, spec) {
  if (isDispatchStep(def, spec)) return can('dispatch', 'edit') ? '<a href="#/dispatch">Dispatch →</a>' : '<span class="muted small">via Dispatch</span>';
  if (!canMarkStep(def, s, spec)) return '';
  return '<button class="btn sm primary" data-act="step-done" data-o="' + esc(o.id) + '" data-s="' + esc(s.id) + '">Done</button>';
}
ACTIONS['step-done'] = el => {
  const tr = el.closest('tr'); const note = tr && tr.querySelector('input[data-note]');
  markStepDone(el.dataset.o, el.dataset.s, note ? note.value.trim() : '');
  route();
};
function dueToday(s) { const d = s.planned; return d && ymdOf(d) === todayYmd(); }

/* ---------------- Home ---------------- */
VIEWS.home = {
  mod: 'dashboard', render() {
    const orders = Store.all('orders'); const states = orders.map(o => ({ o, st: orderState(o) }));
    const open = allOpenSteps(); const late = open.filter(x => x.step.status === 'Late');
    const mine = open.filter(x => isMyDoer(x.step.doer));
    const month = todayYmd().slice(0, 7);
    const dspQty = Store.all('dispatches').filter(d => !d.cancelled && (d.date || '').startsWith(month)).reduce((s, d) => s + d.lines.reduce((a, l) => a + num(l.qty), 0), 0);
    const openOrders = states.filter(x => x.st.open);
    const openVal = openOrders.reduce((s, x) => s + orderTotals(x.o).value, 0);
    let h = '<h1>Good ' + (new Date().getHours() < 12 ? 'morning' : 'day') + ', ' + esc(ME.name.split(' ')[0]) + '</h1>';
    h += '<div class="kpis">' +
      '<a href="#/orders"><b>' + openOrders.length + '</b><span>Open orders</span></a>' +
      '<a href="#/tasks"><b>' + mine.length + '</b><span>My open tasks</span></a>' +
      '<a href="#/orders/late"><b class="' + (late.length ? 'late-txt' : '') + '">' + late.length + '</b><span>Late steps</span></a>' +
      '<div><b>' + open.filter(x => dueToday(x.step)).length + '</b><span>Due today</span></div>' +
      '<a href="#/dispatch"><b>' + readyForDispatch().length + '</b><span>Ready to dispatch</span></a>' +
      '<div><b>' + qtyFmt(dspQty) + '</b><span>Qty dispatched this month</span></div>' +
      '<div><b>₹' + money(openVal) + '</b><span>Open order value</span></div></div>';

    h += '<div class="grid2"><div><h2>My tasks</h2>' + taskTable(mine.slice(0, 8), true) +
      (mine.length > 8 ? '<div class="small" style="margin-top:6px"><a href="#/tasks">All ' + mine.length + ' tasks →</a></div>' : '') + '</div>';
    const byDoer = {};
    late.forEach(x => { const k = x.step.doer || '—'; const b = byDoer[k] || (byDoer[k] = { n: 0, d: 0, max: 0 }); b.n++; b.d += x.step.delayMinutes; b.max = Math.max(b.max, x.step.delayMinutes); });
    const rows = Object.entries(byDoer).sort((a, b) => b[1].n - a[1].n);
    h += '<div><h2>Late by doer</h2><div class="tbl-wrap"><table><tr><th>Doer</th><th class="num">Late</th><th class="num">Avg delay</th><th class="num">Worst</th></tr>' +
      (rows.length ? rows.map(([k, b]) => '<tr><td>' + esc(k) + '</td><td class="num late-txt">' + b.n + '</td><td class="num">' + fmtDelay(Math.round(b.d / b.n)) + '</td><td class="num">' + fmtDelay(b.max) + '</td></tr>').join('') : '<tr><td colspan="4" class="empty">Nothing late</td></tr>') + '</table></div>';
    const stage = {}; openOrders.forEach(x => { stage[x.st.label] = (stage[x.st.label] || 0) + 1; });
    h += '<h2>Open orders by stage</h2><div class="tbl-wrap"><table><tr><th>Stage</th><th class="num">Orders</th></tr>' +
      Object.entries(stage).sort((a, b) => b[1] - a[1]).map(([k, n]) => '<tr><td>' + esc(k) + '</td><td class="num">' + n + '</td></tr>').join('') + '</table></div></div></div>';
    setMain(h);
  }
};

/* ---------------- My Tasks ---------------- */
const TASK_UI = { who: 'mine', when: 'open', q: '' };
function taskTable(list, compact) {
  if (!list.length) return '<div class="tbl-wrap"><div class="empty">No open tasks 🎉</div></div>';
  return '<div class="tbl-wrap"><table><tr><th>Order</th><th>Customer</th><th>Step</th>' + (compact ? '' : '<th>Doer</th>') + '<th>Planned</th><th>Status</th><th class="num">Delay</th>' + (compact ? '' : '<th>Note</th>') + '<th></th></tr>' +
    list.map(x => '<tr><td class="nowrap"><a href="#/order/' + esc(x.order.id) + '">' + esc(x.order.no) + '</a>' + (x.order.priority === 'Urgent' ? ' <span class="late-txt small">URGENT</span>' : '') + '</td><td>' + esc(x.order.customer_name) + '</td>' +
      '<td>' + esc(x.step.name) + (x.def && x.def.what && !compact ? '<div class="muted small">' + esc(x.def.what) + '</div>' : '') + '</td>' + (compact ? '' : '<td>' + esc(x.step.doer || '') + '</td>') +
      '<td class="nowrap">' + fmtDT(x.step.planned) + '</td><td>' + stHtml(x.step.status) + '</td><td class="num late-txt">' + fmtDelay(x.step.delayMinutes) + '</td>' +
      (compact ? '' : '<td><input data-note placeholder="optional" style="min-width:120px"></td>') + '<td class="right">' + stepDoneBtn(x.order, x.step, x.def, x.spec) + '</td></tr>').join('') + '</table></div>';
}
VIEWS.tasks = {
  mod: 'tasks', render() {
    const all = can('tracker', 'view');
    if (!all) TASK_UI.who = 'mine';
    let list = allOpenSteps();
    if (TASK_UI.who === 'mine') list = list.filter(x => isMyDoer(x.step.doer));
    if (TASK_UI.when === 'late') list = list.filter(x => x.step.status === 'Late');
    if (TASK_UI.when === 'today') list = list.filter(x => dueToday(x.step) || x.step.status === 'Late');
    const q = norm(TASK_UI.q); if (q) list = list.filter(x => norm(x.order.no + ' ' + x.order.customer_name + ' ' + x.step.name + ' ' + x.step.doer).includes(q));
    setMain('<h1>My Tasks</h1><div class="toolbar">' + (all ? seg('who', [{ v: 'mine', l: 'Mine (' + esc(ME.doer || '-') + ')' }, { v: 'all', l: 'Everyone' }], TASK_UI.who) : '') +
      seg('when', [{ v: 'open', l: 'All open' }, { v: 'today', l: 'Today + late' }, { v: 'late', l: 'Late' }], TASK_UI.when) +
      '<input id="taskQ" placeholder="Filter…" value="' + esc(TASK_UI.q) + '"><span class="muted small">' + list.length + ' task(s)</span></div>' + taskTable(list, false));
    onSeg(e => { TASK_UI[e.target.dataset.seg] = e.detail; VIEWS.tasks.render(); });
    $('#taskQ').addEventListener('input', e => { TASK_UI.q = e.target.value; clearTimeout(TASK_UI.t); TASK_UI.t = setTimeout(() => { VIEWS.tasks.render(); const i = $('#taskQ'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); });
  }
};

/* ---------------- Punch order ---------------- */
const CORE_FIELDS = ['created_at', 'order_no', 'customer', 'category', 'payment_terms', 'priority', 'delivery_date', 'qty', 'value'];
let PUNCH = null;
function blankLine() { return { item_code: '', item_name: '', uom: '', qty: '', rate: '' }; }
function newPunch(order) {
  PUNCH = order ? clone(order) : { id: null, order_date: todayYmd(), customer_name: '', customer_id: '', po_ref: '', category: '', payment_terms: '', priority: '', delivery_date: '', remarks: '', extra: {}, lines: [] };
  if (!PUNCH.lines.length || PUNCH.lines[PUNCH.lines.length - 1].item_code) PUNCH.lines.push(blankLine());
}
function fieldOptions(key) { const p = activeProcess(); const f = p && p.spec.fields.find(x => x.key === key); return f && f.options ? f.options : []; }
VIEWS.punch = {
  mod: 'orders', edit: true, render(param) {
    if (param) { const o = Store.get('orders', param); if (!o) return go('orders'); if (dispatchedQty(o).total > 0) { flash('Dispatched orders cannot be edited.', 'err'); return go('order', o.id); } if (!PUNCH || PUNCH.id !== o.id) newPunch(o); }
    else if (!PUNCH || PUNCH.id) newPunch();
    const proc = activeProcess();
    if (!proc) { setMain('<div class="panel">No active FMS flow. Activate one in FMS Builder first.</div>'); return; }
    const extra = proc.spec.fields.filter(f => f.source === 'form' && !CORE_FIELDS.includes(f.key));
    const P = PUNCH;
    let h = '<h1>' + (P.id ? 'Edit ' + esc(P.no) : 'Punch Order') + ' <span class="muted small">Enter = next row · <span class="kbd">Ctrl</span>+<span class="kbd">S</span> save</span></h1><div class="panel punch">';
    h += '<datalist id="dlCust">' + Store.all('customers').map(c => '<option value="' + esc(c.name) + '">' + esc(c.code + ' · ' + (c.city || '')) + '</option>').join('') + '</datalist>';
    h += '<datalist id="dlItem">' + Store.all('items').map(i => '<option value="' + esc(i.code + ' — ' + i.name) + '"></option>').join('') + '</datalist>';
    h += '<div class="hdr">' +
      '<label>Customer *<input id="pCust" list="dlCust" value="' + esc(P.customer_name) + '" autocomplete="off"></label>' +
      '<label>Customer PO / Ref<input id="pRef" value="' + esc(P.po_ref) + '"></label>' +
      '<label>Order date<input id="pDate" type="date" value="' + esc(P.order_date) + '"></label>' +
      '<label>Delivery date *<input id="pDel" type="date" value="' + esc(P.delivery_date) + '"></label>' +
      '<label>Order type *' + seg('category', fieldOptions('category'), P.category) + '</label>' +
      '<label>Payment terms *' + seg('payment_terms', fieldOptions('payment_terms'), P.payment_terms) + '</label>' +
      '<label>Priority' + seg('priority', [{ v: '', l: 'Normal' }, { v: 'Urgent', l: 'Urgent' }], P.priority === 'Urgent' ? 'Urgent' : '') + '</label>' +
      '<label>Remarks<input id="pRem" value="' + esc(P.remarks) + '"></label>' +
      extra.map(f => '<label>' + esc(f.label) + (f.options && f.options.length <= 4 ? seg('x_' + f.key, f.options, (P.extra || {})[f.key]) :
        '<input data-extra="' + esc(f.key) + '" type="' + (f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text') + '" value="' + esc((P.extra || {})[f.key]) + '"' + (f.options ? ' list="dl_' + esc(f.key) + '"' : '') + '>' + (f.options ? '<datalist id="dl_' + esc(f.key) + '">' + f.options.map(o => '<option value="' + esc(o) + '">').join('') + '</datalist>' : '')) + '</label>').join('') +
      '</div>';
    h += '<table class="lines"><tr><th style="width:28px">#</th><th>Item</th><th style="width:70px">UOM</th><th class="num" style="width:110px">Qty</th><th class="num" style="width:110px">Rate</th><th class="num" style="width:120px">Amount</th><th style="width:30px"></th></tr>' +
      P.lines.map((l, i) => '<tr data-i="' + i + '"><td class="muted">' + (i + 1) + '</td><td><input data-f="item" list="dlItem" value="' + esc(l.item_code ? l.item_code + ' — ' + l.item_name : '') + '" autocomplete="off"></td>' +
        '<td class="muted" data-uom>' + esc(l.uom) + '</td><td><input data-f="qty" type="number" min="0" step="any" class="right" value="' + esc(l.qty) + '"></td><td><input data-f="rate" type="number" min="0" step="any" class="right" value="' + esc(l.rate) + '"></td>' +
        '<td class="num" data-amt>' + (l.qty && l.rate ? money(num(l.qty) * num(l.rate)) : '') + '</td><td><button class="btn ghost sm" data-act="punch-del" data-i="' + i + '" title="Remove">×</button></td></tr>').join('') +
      '<tr><td></td><td colspan="2"><a data-act="punch-add">+ Add row</a></td><td class="num"><b id="pTq"></b></td><td></td><td class="num"><b id="pTv"></b></td><td></td></tr></table>';
    h += '<div class="toolbar" style="margin:12px 0 0"><button class="btn primary" data-save data-act="punch-save">' + (P.id ? 'Save changes' : 'Save order') + '</button>' +
      (P.id ? '<a href="#/order/' + esc(P.id) + '" data-act="punch-cancel">Cancel</a>' : '<a data-act="punch-clear">Clear</a>') + '<span id="pMsg" class="small"></span></div></div>';
    setMain(h);
    punchTotals();
    const m = $('#main');
    $('#pCust').addEventListener('change', e => {
      const c = Store.all('customers').find(x => norm(x.name) === norm(e.target.value));
      if (c && c.payment_terms) { const s = $('[data-seg="payment_terms"]'); $$('button', s).forEach(b => b.classList.toggle('on', b.dataset.v === c.payment_terms)); }
    });
    m.addEventListener('input', punchLineInput);
    m.addEventListener('change', punchLineChange);
    m.addEventListener('keydown', e => {
      if (e.key !== 'Enter' || !e.target.dataset.f) return;
      e.preventDefault(); punchCollect();
      const tr = e.target.closest('tr'); const i = +tr.dataset.i; const f = e.target.dataset.f;
      if (f === 'item') return $('input[data-f="qty"]', tr).focus();
      if (f === 'qty') return $('input[data-f="rate"]', tr).focus();
      if (i === PUNCH.lines.length - 1) { PUNCH.lines.push(blankLine()); VIEWS.punch.render(PUNCH.id); }
      const next = $('tr[data-i="' + (i + 1) + '"] input[data-f="item"]'); if (next) next.focus();
    });
    if (!P.customer_name) $('#pCust').focus();
  }
};
function punchLineInput(e) {
  const tr = e.target.closest('tr[data-i]'); if (!tr || !e.target.dataset.f) return;
  const q = num($('input[data-f="qty"]', tr).value), r = num($('input[data-f="rate"]', tr).value);
  $('[data-amt]', tr).textContent = q && r ? money(q * r) : ''; punchTotals();
}
function punchLineChange(e) {
  if (e.target.dataset.f !== 'item') return;
  const tr = e.target.closest('tr[data-i]'); const code = e.target.value.split(' — ')[0].trim();
  const it = Store.all('items').find(x => norm(x.code) === norm(code) || norm(x.name) === norm(e.target.value));
  if (it) { e.target.value = it.code + ' — ' + it.name; $('[data-uom]', tr).textContent = it.uom; const r = $('input[data-f="rate"]', tr); if (!r.value) r.value = it.rate || ''; punchLineInput({ target: r }); }
}
function punchTotals() {
  let q = 0, v = 0; $$('tr[data-i]').forEach(tr => { const a = num($('input[data-f="qty"]', tr).value), b = num($('input[data-f="rate"]', tr).value); q += a; v += a * b; });
  if ($('#pTq')) { $('#pTq').textContent = qtyFmt(q); $('#pTv').textContent = '₹' + money(v); }
}
function punchCollect() {
  const P = PUNCH;
  P.customer_name = $('#pCust').value.trim(); P.po_ref = $('#pRef').value.trim(); P.order_date = $('#pDate').value;
  P.delivery_date = $('#pDel').value; P.remarks = $('#pRem').value.trim();
  P.category = segVal($('[data-seg="category"]')); P.payment_terms = segVal($('[data-seg="payment_terms"]'));
  const pr = segVal($('[data-seg="priority"]')); if (!P.id || P.priority === '' || P.priority === 'Urgent') P.priority = pr;
  P.extra = P.extra || {};
  $$('[data-extra]').forEach(i => P.extra[i.dataset.extra] = i.value.trim());
  $$('[data-seg^="x_"]').forEach(s => P.extra[s.dataset.seg.slice(2)] = segVal(s));
  P.lines = $$('tr[data-i]').map(tr => {
    const raw = $('input[data-f="item"]', tr).value.trim(); const code = raw.split(' — ')[0].trim();
    const it = Store.all('items').find(x => norm(x.code) === norm(code) || norm(x.name) === norm(raw));
    return { item_code: it ? it.code : code, item_name: it ? it.name : raw, uom: it ? it.uom : '', qty: $('input[data-f="qty"]', tr).value, rate: $('input[data-f="rate"]', tr).value };
  });
}
ACTIONS['punch-add'] = () => { punchCollect(); PUNCH.lines.push(blankLine()); VIEWS.punch.render(PUNCH.id); $('tr[data-i="' + (PUNCH.lines.length - 1) + '"] input').focus(); };
ACTIONS['punch-del'] = el => { punchCollect(); PUNCH.lines.splice(+el.dataset.i, 1); if (!PUNCH.lines.length) PUNCH.lines.push(blankLine()); VIEWS.punch.render(PUNCH.id); };
ACTIONS['punch-clear'] = () => { newPunch(); VIEWS.punch.render(); };
ACTIONS['punch-cancel'] = el => { PUNCH = null; go('order', el.getAttribute('href').split('/').pop()); };
ACTIONS['punch-save'] = () => {
  if (!requirePerm('orders', 'edit')) return;
  punchCollect(); const P = PUNCH; const errs = [];
  const lines = P.lines.filter(l => l.item_code || num(l.qty));
  if (!P.customer_name) errs.push('customer');
  if (!P.delivery_date) errs.push('delivery date');
  if (!P.category) errs.push('order type');
  if (!P.payment_terms) errs.push('payment terms');
  if (!lines.length) errs.push('at least one item');
  lines.forEach((l, i) => { if (!Store.all('items').some(x => x.code === l.item_code)) errs.push('row ' + (i + 1) + ': unknown item'); if (num(l.qty) <= 0) errs.push('row ' + (i + 1) + ': qty'); });
  const dup = lines.map(l => l.item_code).filter((c, i, a) => c && a.indexOf(c) !== i); if (dup.length) errs.push('duplicate item ' + dup[0]);
  if (errs.length) { $('#pMsg').innerHTML = '<span class="late-txt">Missing / wrong: ' + esc(errs.join(', ')) + '</span>'; return; }
  let cu = Store.all('customers').find(c => norm(c.name) === norm(P.customer_name));
  if (!cu) {
    const code = 'C' + String(Store.all('customers').length + 1).padStart(3, '0');
    cu = Store.put('customers', { id: uid(), code, name: P.customer_name, city: '', gstin: '', phone: '', payment_terms: P.payment_terms });
    audit('customer.create', code, cu.name + ' (from order punch)');
  }
  const o = P.id ? Store.get('orders', P.id) : { id: uid(), no: nextNo('orders', 'ORD'), process_id: activeProcess().id, actuals: {}, done_by: {}, created_at: nowIso(), created_by: ME.name };
  Object.assign(o, { order_date: P.order_date, customer_id: cu.id, customer_name: cu.name, po_ref: P.po_ref, category: P.category, payment_terms: P.payment_terms, priority: P.priority, delivery_date: P.delivery_date, remarks: P.remarks, extra: P.extra, lines: lines.map(l => ({ item_code: l.item_code, item_name: l.item_name, uom: l.uom, qty: num(l.qty), rate: num(l.rate) })) });
  Store.put('orders', o);
  audit(P.id ? 'order.edit' : 'order.create', o.no, cu.name + ' · ' + qtyFmt(orderTotals(o).qty) + ' qty · ₹' + money(orderTotals(o).value));
  if (P.id) { PUNCH = null; flash('Saved ' + esc(o.no) + '.'); go('order', o.id); return; }
  newPunch(); VIEWS.punch.render();
  flash('Saved <b>' + esc(o.no) + '</b> — FMS started. <a href="#/order/' + esc(o.id) + '">Open</a> · punch the next order below.');
};

/* ---------------- Orders list ---------------- */
const ORD_UI = { f: 'open', q: '' };
VIEWS.orders = {
  mod: 'orders', render(param) {
    if (param === 'late') ORD_UI.f = 'late'; else if (param) { ORD_UI.q = param; ORD_UI.f = 'all'; }
    const q = norm(ORD_UI.q);
    const rows = Store.all('orders').slice().sort((a, b) => b.created_at < a.created_at ? -1 : 1).map(o => ({ o, st: orderState(o), t: orderTotals(o), d: dispatchedQty(o) })).filter(x => {
      if (q && !norm(x.o.no + ' ' + x.o.customer_name + ' ' + x.o.po_ref + ' ' + x.o.lines.map(l => l.item_code + ' ' + l.item_name).join(' ')).includes(q)) return false;
      switch (ORD_UI.f) {
        case 'open': return x.st.open; case 'late': return x.st.open && x.st.late > 0; case 'hold': return x.o.priority === 'On Hold';
        case 'done': return x.st.label === 'Dispatched'; case 'cancel': return x.o.priority === 'Cancelled'; default: return true;
      }
    });
    let h = '<h1>Orders</h1><div class="toolbar">' + seg('f', [{ v: 'open', l: 'Open' }, { v: 'late', l: 'Late' }, { v: 'hold', l: 'On hold' }, { v: 'done', l: 'Dispatched' }, { v: 'cancel', l: 'Cancelled' }, { v: 'all', l: 'All' }], ORD_UI.f) +
      '<input id="ordQ" placeholder="Order no / customer / item…" value="' + esc(ORD_UI.q) + '"><span class="muted small">' + rows.length + ' order(s)</span><span class="grow"></span>' +
      '<button class="btn" data-act="orders-csv">Export CSV</button>' + (can('orders', 'edit') ? '<a class="btn primary" href="#/punch">+ Punch order</a>' : '') + '</div>';
    h += '<div class="tbl-wrap"><table><tr><th>Order</th><th>Date</th><th>Customer</th><th>Type</th><th class="num">Qty</th><th class="num">Dispatched</th><th class="num">Value ₹</th><th>Delivery</th><th>Current step</th></tr>' +
      (rows.length ? rows.map(x => '<tr class="click" data-act="go" data-v="order" data-p="' + esc(x.o.id) + '"><td class="nowrap"><b>' + esc(x.o.no) + '</b>' + (x.o.priority === 'Urgent' ? ' <span class="late-txt small">URGENT</span>' : '') + '</td><td class="nowrap">' + fmtD(x.o.order_date) + '</td><td>' + esc(x.o.customer_name) + '</td><td>' + esc(x.o.category) + '</td>' +
        '<td class="num">' + qtyFmt(x.t.qty) + '</td><td class="num">' + (x.d.total ? qtyFmt(x.d.total) : '') + '</td><td class="num">' + money(x.t.value) + '</td><td class="nowrap">' + fmtD(x.o.delivery_date) + '</td><td>' + stHtml(x.st.label).replace('class="st ' + stCls(x.st.label), 'class="st ' + x.st.cls) + (x.st.late > 1 ? ' <span class="muted small">+' + (x.st.late - 1) + ' more late</span>' : '') + '</td></tr>').join('') : '<tr><td colspan="9" class="empty">No orders</td></tr>') + '</table></div>';
    setMain(h); VIEWS.orders.rows = rows;
    onSeg(e => { ORD_UI.f = e.detail; VIEWS.orders.render(); });
    $('#ordQ').addEventListener('input', e => { ORD_UI.q = e.target.value; clearTimeout(ORD_UI.t); ORD_UI.t = setTimeout(() => { VIEWS.orders.render(); const i = $('#ordQ'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); });
  }
};
function downloadCsv(name, rows) {
  const csv = rows.map(r => r.map(v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',')).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })); a.download = name; a.click();
}
ACTIONS['orders-csv'] = () => downloadCsv('orders-' + todayYmd() + '.csv', [['Order No', 'Date', 'Customer', 'PO Ref', 'Type', 'Terms', 'Priority', 'Qty', 'Dispatched', 'Value', 'Delivery', 'Current step']]
  .concat((VIEWS.orders.rows || []).map(x => [x.o.no, x.o.order_date, x.o.customer_name, x.o.po_ref, x.o.category, x.o.payment_terms, x.o.priority, x.t.qty, x.d.total, x.t.value, x.o.delivery_date, x.st.label])));

/* ---------------- Order page ---------------- */
VIEWS.order = {
  mod: 'orders', render(id) {
    const o = Store.get('orders', id); if (!o) { setMain('<div class="panel empty">Order not found.</div>'); return; }
    const r = resolveOrder(o); const t = orderTotals(o); const d = dispatchedQty(o); const st = orderState(o);
    const proc = Store.get('processes', o.process_id);
    let h = '<div class="toolbar"><h1 style="margin:0">' + esc(o.no) + ' · ' + esc(o.customer_name) + '</h1>' + stHtml(st.label).replace('st ' + stCls(st.label), 'st ' + st.cls) + '<span class="grow"></span>' +
      (can('orders', 'edit') && !d.total ? '<a class="btn" href="#/punch/' + esc(o.id) + '">Edit</a>' : '') + '<button class="btn" data-act="print">Print</button></div>';
    if (can('orders', 'edit') && st.label !== 'Dispatched') h += '<div class="toolbar noprint"><span class="muted small">Priority</span>' + seg('opri', [{ v: '', l: 'Normal' }, { v: 'Urgent', l: 'Urgent' }, { v: 'On Hold', l: 'On Hold' }, { v: 'Cancelled', l: 'Cancel order' }], o.priority || '') + '</div>';
    h += '<div class="grid2"><div>';
    h += '<div class="panel"><table class="kv">' + [['Order date', fmtD(o.order_date)], ['Customer PO', o.po_ref], ['Order type', o.category], ['Payment terms', o.payment_terms], ['Delivery date', fmtD(o.delivery_date)], ['Priority', o.priority || 'Normal'], ['Remarks', o.remarks], ['Punched by', o.created_by + ' · ' + fmtDT(o.created_at)], ['FMS flow', proc ? proc.name + ' v' + proc.version : '—']]
      .concat(Object.entries(o.extra || {}).filter(e => e[1]).map(([k, v]) => { const f = proc && proc.spec.fields.find(x => x.key === k); return [f ? f.label : k, v]; }))
      .map(([k, v]) => '<tr><td class="muted" style="width:130px">' + esc(k) + '</td><td>' + esc(v) + '</td></tr>').join('') + '</table></div>';
    h += '<h2>Items</h2><div class="tbl-wrap"><table><tr><th>Item</th><th class="num">Ordered</th><th class="num">Dispatched</th><th class="num">Pending</th><th class="num">Rate</th><th class="num">Amount</th></tr>' +
      o.lines.map((l, i) => '<tr><td>' + esc(l.item_code) + ' <span class="muted">' + esc(l.item_name) + '</span></td><td class="num">' + qtyFmt(l.qty) + ' ' + esc(l.uom) + '</td><td class="num">' + qtyFmt(d.per[i]) + '</td><td class="num">' + qtyFmt(Math.max(0, l.qty - d.per[i])) + '</td><td class="num">' + money(l.rate) + '</td><td class="num">' + money(l.qty * l.rate) + '</td></tr>').join('') +
      '<tr><td><b>Total</b></td><td class="num"><b>' + qtyFmt(t.qty) + '</b></td><td class="num">' + qtyFmt(d.total) + '</td><td class="num">' + qtyFmt(d.pending) + '</td><td></td><td class="num"><b>' + money(t.value) + '</b></td></tr></table></div>';
    const dsp = Store.all('dispatches').filter(x => x.order_id === o.id);
    if (dsp.length) h += '<h2>Dispatches</h2><div class="tbl-wrap"><table><tr><th>No</th><th>Date</th><th class="num">Qty</th><th>Invoice</th><th>Vehicle</th><th>Transporter / LR</th></tr>' +
      dsp.map(x => '<tr' + (x.cancelled ? ' class="muted" style="text-decoration:line-through"' : '') + '><td>' + esc(x.no) + '</td><td>' + fmtD(x.date) + '</td><td class="num">' + qtyFmt(x.lines.reduce((s, l) => s + num(l.qty), 0)) + '</td><td>' + esc(x.invoice_no) + '</td><td>' + esc(x.vehicle) + '</td><td>' + esc(x.transporter) + ' ' + esc(x.lr_no) + '</td></tr>').join('') + '</table></div>';
    h += '</div><div><h2 style="margin-top:0">FMS timeline</h2>';
    if (!r) h += '<div class="panel">Flow not found for this order.</div>';
    else {
      h += '<div class="tbl-wrap"><table class="tl"><tr><th>Step</th><th>Doer</th><th>Planned</th><th>Actual</th><th>Status</th><th class="num">Delay</th><th></th></tr>' +
        r.order.map(sid => {
          const s = r.steps[sid]; const def = r.spec.steps.find(x => x.id === sid);
          if (s.status === 'N/A') return '<tr class="muted"><td>' + esc(s.name) + '</td><td colspan="6" class="small">Not applicable for this order</td></tr>';
          const act = s.status === 'Pending' || s.status === 'Late' ? stepDoneBtn(o, s, def, r.spec) :
            (s.status === 'Done' && !isDispatchStep(def, r.spec) && (can('tracker', 'edit')) ? '<button class="btn sm ghost" data-act="undo-step" data-o="' + esc(o.id) + '" data-s="' + esc(sid) + '" data-confirm="Undo?">Undo</button>' : '');
          const note = (o.notes || {})[sid]; const by = (o.done_by || {})[sid];
          return '<tr class="' + (st.cur && st.cur.id === sid ? 'cur' : '') + '"><td>' + esc(s.name) + (note ? '<div class="muted small">“' + esc(note) + '”</div>' : '') + '</td><td>' + esc(s.doer || '') + (by && by !== 'seed' ? '<div class="muted small">' + esc(by) + '</div>' : '') + '</td><td class="nowrap">' + fmtDT(s.planned) + '</td><td class="nowrap">' + fmtDT(s.actual) + '</td><td>' + stHtml(s.status) + '</td><td class="num late-txt">' + fmtDelay(s.delayMinutes) + '</td><td class="right">' + act + '</td></tr>';
        }).join('') + '</table></div>';
    }
    h += '</div></div>';
    setMain(h);
    const sp = $('[data-seg="opri"]');
    if (sp) sp.addEventListener('segchange', e => {
      const old = o.priority || ''; o.priority = e.detail; Store.put('orders', o);
      audit('order.priority', o.no, (old || 'Normal') + ' → ' + (e.detail || 'Normal')); flash(esc(o.no) + ' priority: ' + esc(e.detail || 'Normal')); route();
    });
  }
};
ACTIONS['print'] = () => window.print();

/* ---------------- Dispatch ---------------- */
function readyForDispatch() {
  return Store.all('orders').filter(o => {
    if (o.priority === 'Cancelled' || o.priority === 'On Hold') return false;
    const r = resolveOrder(o); if (!r) return false; const end = r.spec.process.endStep; const s = r.steps[end];
    return s && (s.status === 'Pending' || s.status === 'Late') && dispatchedQty(o).pending > 0;
  });
}
const DSP_UI = { tab: 'ready', open: null };
VIEWS.dispatch = {
  mod: 'dispatch', render() {
    const edit = can('dispatch', 'edit');
    let h = '<h1>Dispatch</h1><div class="tabs">' + [['ready', 'Ready (' + readyForDispatch().length + ')'], ['upcoming', 'Upcoming'], ['history', 'History']].map(([k, l]) => '<a data-act="dsp-tab" data-t="' + k + '" class="' + (DSP_UI.tab === k ? 'on' : '') + '">' + l + '</a>').join('') + '</div>';
    if (DSP_UI.tab === 'ready') {
      const list = readyForDispatch().sort((a, b) => resolveOrder(a).steps[resolveOrder(a).spec.process.endStep].planned - resolveOrder(b).steps[resolveOrder(b).spec.process.endStep].planned);
      h += '<div class="tbl-wrap"><table><tr><th>Order</th><th>Customer</th><th>Delivery</th><th class="num">Pending qty</th><th>Dispatch due</th><th>Status</th><th></th></tr>' +
        (list.length ? list.map(o => {
          const r = resolveOrder(o); const s = r.steps[r.spec.process.endStep]; const d = dispatchedQty(o);
          let row = '<tr><td><a href="#/order/' + esc(o.id) + '">' + esc(o.no) + '</a></td><td>' + esc(o.customer_name) + '</td><td>' + fmtD(o.delivery_date) + '</td><td class="num">' + qtyFmt(d.pending) + (d.total ? ' <span class="muted small">(part sent)</span>' : '') + '</td><td>' + fmtDT(s.planned) + '</td><td>' + stHtml(s.status) + ' <span class="late-txt small">' + fmtDelay(s.delayMinutes) + '</span></td><td class="right">' + (edit ? '<button class="btn sm ' + (DSP_UI.open === o.id ? '' : 'primary') + '" data-act="dsp-open" data-o="' + esc(o.id) + '">' + (DSP_UI.open === o.id ? 'Close' : 'Dispatch') + '</button>' : '') + '</td></tr>';
          if (DSP_UI.open === o.id) row += '<tr class="inline-form"><td colspan="7">' + dispatchForm(o, d) + '</td></tr>';
          return row;
        }).join('') : '<tr><td colspan="7" class="empty">Nothing ready. Orders appear here once Invoice is done.</td></tr>') + '</table></div>';
    } else if (DSP_UI.tab === 'upcoming') {
      const list = Store.all('orders').map(o => ({ o, st: orderState(o) })).filter(x => x.st.open && !readyForDispatch().includes(x.o) && x.o.priority !== 'Cancelled');
      h += '<div class="tbl-wrap"><table><tr><th>Order</th><th>Customer</th><th>Delivery</th><th class="num">Qty</th><th>Now at</th></tr>' +
        (list.length ? list.map(x => '<tr class="click" data-act="go" data-v="order" data-p="' + esc(x.o.id) + '"><td>' + esc(x.o.no) + '</td><td>' + esc(x.o.customer_name) + '</td><td>' + fmtD(x.o.delivery_date) + '</td><td class="num">' + qtyFmt(orderTotals(x.o).qty) + '</td><td><span class="st ' + x.st.cls + '">' + esc(x.st.label) + '</span></td></tr>').join('') : '<tr><td colspan="5" class="empty">No upcoming orders</td></tr>') + '</table></div>';
    } else {
      const list = Store.all('dispatches').slice().sort((a, b) => (b.at || '') < (a.at || '') ? -1 : 1);
      h += '<div class="toolbar"><button class="btn" data-act="dsp-csv">Export CSV</button></div><div class="tbl-wrap"><table><tr><th>No</th><th>Date</th><th>Order</th><th>Customer</th><th class="num">Qty</th><th>Invoice</th><th>Vehicle</th><th>Transporter</th><th>LR</th><th>By</th><th></th></tr>' +
        (list.length ? list.map(x => { const o = Store.get('orders', x.order_id) || {}; return '<tr' + (x.cancelled ? ' class="muted"' : '') + '><td>' + esc(x.no) + (x.cancelled ? ' <span class="late-txt small">CANCELLED</span>' : '') + '</td><td>' + fmtD(x.date) + '</td><td><a href="#/order/' + esc(x.order_id) + '">' + esc(o.no) + '</a></td><td>' + esc(o.customer_name) + '</td><td class="num">' + qtyFmt(x.lines.reduce((s, l) => s + num(l.qty), 0)) + '</td><td>' + esc(x.invoice_no) + '</td><td>' + esc(x.vehicle) + '</td><td>' + esc(x.transporter) + '</td><td>' + esc(x.lr_no) + '</td><td>' + esc(x.by) + '</td><td>' + (edit && !x.cancelled ? '<button class="btn sm ghost danger" data-act="dsp-cancel" data-d="' + esc(x.id) + '" data-confirm="Confirm cancel">Cancel</button>' : '') + '</td></tr>'; }).join('') : '<tr><td colspan="11" class="empty">No dispatches yet</td></tr>') + '</table></div>';
      VIEWS.dispatch.hist = list;
    }
    setMain(h);
  }
};
function dispatchForm(o, d) {
  return '<div style="padding:6px 4px"><table style="max-width:640px;margin-bottom:8px"><tr><th>Item</th><th class="num">Pending</th><th class="num">Dispatch now</th></tr>' +
    o.lines.map((l, i) => { const p = Math.max(0, l.qty - d.per[i]); return '<tr><td>' + esc(l.item_code) + ' <span class="muted">' + esc(l.item_name) + '</span></td><td class="num">' + qtyFmt(p) + '</td><td class="num"><input class="qty" type="number" min="0" max="' + p + '" step="any" data-dq="' + i + '" value="' + p + '"' + (p ? '' : ' disabled') + '></td></tr>'; }).join('') + '</table>' +
    '<div class="row"><label>Invoice no *<input id="dInv"></label><label>Vehicle no<input id="dVeh"></label><label>Transporter<input id="dTr" list="dlTr"></label><label>LR / Docket no<input id="dLr"></label><label>Date<input id="dDate" type="date" value="' + todayYmd() + '"></label>' +
    '<datalist id="dlTr">' + Array.from(new Set(Store.all('dispatches').map(x => x.transporter).filter(Boolean))).map(t => '<option value="' + esc(t) + '">').join('') + '</datalist>' +
    '<button class="btn primary" data-save data-act="dsp-save" data-o="' + esc(o.id) + '">Save dispatch</button><span id="dMsg" class="small"></span></div></div>';
}
ACTIONS['dsp-tab'] = el => { DSP_UI.tab = el.dataset.t; DSP_UI.open = null; VIEWS.dispatch.render(); };
ACTIONS['dsp-open'] = el => { DSP_UI.open = DSP_UI.open === el.dataset.o ? null : el.dataset.o; VIEWS.dispatch.render(); const i = $('#dInv'); if (i) i.focus(); };
ACTIONS['dsp-save'] = el => {
  if (!requirePerm('dispatch', 'edit')) return;
  const o = Store.get('orders', el.dataset.o); const d = dispatchedQty(o);
  const lines = $$('[data-dq]').map(i => ({ idx: +i.dataset.dq, qty: num(i.value) })).filter(l => l.qty > 0);
  const inv = $('#dInv').value.trim();
  const over = lines.find(l => l.qty > o.lines[l.idx].qty - d.per[l.idx] + 1e-9);
  const err = !inv ? 'Invoice no is required.' : !lines.length ? 'Enter qty to dispatch.' : over ? 'Qty more than pending for ' + o.lines[over.idx].item_code + '.' : '';
  if (err) { $('#dMsg').innerHTML = '<span class="late-txt">' + esc(err) + '</span>'; return; }
  const rec = Store.put('dispatches', { id: uid(), no: nextNo('dispatches', 'DSP'), order_id: o.id, date: $('#dDate').value || todayYmd(), lines, invoice_no: inv, vehicle: $('#dVeh').value.trim(), transporter: $('#dTr').value.trim(), lr_no: $('#dLr').value.trim(), by: ME.name, at: nowIso() });
  const after = dispatchedQty(o); const r = resolveOrder(o); const end = r.spec.process.endStep;
  if (after.pending <= 0) { o.actuals = o.actuals || {}; o.actuals[end] = nowIso(); o.done_by = o.done_by || {}; o.done_by[end] = ME.name; Store.put('orders', o); }
  audit('dispatch.create', o.no, rec.no + ' · ' + qtyFmt(lines.reduce((s, l) => s + l.qty, 0)) + ' qty · inv ' + inv);
  DSP_UI.open = null; flash(esc(rec.no) + ' saved for ' + esc(o.no) + (after.pending > 0 ? ' — ' + qtyFmt(after.pending) + ' still pending (part dispatch).' : ' — order fully dispatched, FMS closed.'));
  VIEWS.dispatch.render();
};
ACTIONS['dsp-cancel'] = el => {
  const x = Store.get('dispatches', el.dataset.d); const o = Store.get('orders', x.order_id);
  x.cancelled = true; x.cancelled_by = ME.name; Store.put('dispatches', x);
  const r = resolveOrder(o); const end = r.spec.process.endStep;
  if (o.actuals && o.actuals[end] && dispatchedQty(o).pending > 0) { delete o.actuals[end]; Store.put('orders', o); }
  audit('dispatch.cancel', o.no, x.no); flash(esc(x.no) + ' cancelled.'); VIEWS.dispatch.render();
};
ACTIONS['dsp-csv'] = () => downloadCsv('dispatches-' + todayYmd() + '.csv', [['No', 'Date', 'Order', 'Customer', 'Qty', 'Invoice', 'Vehicle', 'Transporter', 'LR', 'By', 'Cancelled']]
  .concat((VIEWS.dispatch.hist || []).map(x => { const o = Store.get('orders', x.order_id) || {}; return [x.no, x.date, o.no, o.customer_name, x.lines.reduce((s, l) => s + num(l.qty), 0), x.invoice_no, x.vehicle, x.transporter, x.lr_no, x.by, x.cancelled ? 'Yes' : '']; })));

/* ---------------- Tracker (FMS grid) ---------------- */
const TRK_UI = { f: 'open', q: '', pid: null };
VIEWS.tracker = {
  mod: 'tracker', render() {
    const procs = Store.all('processes').filter(p => Store.all('orders').some(o => o.process_id === p.id) || p.active).sort((a, b) => b.version - a.version);
    if (!TRK_UI.pid || !procs.some(p => p.id === TRK_UI.pid)) TRK_UI.pid = (activeProcess() || procs[0] || {}).id;
    const proc = Store.get('processes', TRK_UI.pid); if (!proc) { setMain('<div class="panel empty">No flow yet.</div>'); return; }
    const q = norm(TRK_UI.q);
    const orders = Store.all('orders').filter(o => o.process_id === proc.id).sort((a, b) => b.created_at < a.created_at ? -1 : 1)
      .filter(o => (TRK_UI.f === 'all' || orderState(o).open) && (!q || norm(o.no + ' ' + o.customer_name).includes(q)));
    let h = '<h1>FMS Tracker</h1><div class="toolbar">' + (procs.length > 1 ? seg('pid', procs.map(p => ({ v: p.id, l: 'v' + p.version + (p.active ? ' (active)' : '') })), TRK_UI.pid) : '<span class="muted small">' + esc(proc.name) + ' v' + proc.version + '</span>') +
      seg('f', [{ v: 'open', l: 'Open orders' }, { v: 'all', l: 'All' }], TRK_UI.f) + '<input id="trkQ" placeholder="Filter…" value="' + esc(TRK_UI.q) + '"><span class="muted small">' + orders.length + ' order(s) · ✓ = done · red = late</span></div>';
    const steps = FMSEngine.topoOrder(proc.spec).map(id => proc.spec.steps.find(s => s.id === id));
    h += '<div class="tbl-wrap" style="max-height:75vh"><table class="trk"><tr><th>Order</th>' + steps.map(s => '<th title="' + esc(typeof s.doer === 'object' ? s.doer.name || '' : s.doer) + '">' + esc(s.name) + '</th>').join('') + '</tr>' +
      (orders.length ? orders.map(o => {
        const r = resolveOrder(o);
        return '<tr class="click" data-act="go" data-v="order" data-p="' + esc(o.id) + '"><td class="nowrap"><b>' + esc(o.no) + '</b><div class="muted">' + esc(o.customer_name) + '</div></td>' + steps.map(sd => {
          const s = r.steps[sd.id]; const c = 'c-' + stCls(s.status);
          let txt = s.status === 'Done' ? '✓ ' + fmtDT(s.actual) + (s.delayMinutes ? '<br><span class="late-txt">+' + fmtDelay(s.delayMinutes) + '</span>' : '')
            : s.status === 'N/A' ? '—' : s.status === 'Waiting' ? '…' : (s.status === 'Pending' || s.status === 'Late') ? fmtDT(s.planned) + (s.delayMinutes ? '<br>+' + fmtDelay(s.delayMinutes) : '') : esc(s.status);
          return '<td class="cell ' + c + '" title="' + esc(s.doer || '') + ' · ' + esc(s.status) + '">' + txt + '</td>';
        }).join('') + '</tr>';
      }).join('') : '<tr><td colspan="' + (steps.length + 1) + '" class="empty">No orders</td></tr>') + '</table></div>';
    setMain(h);
    onSeg(e => { TRK_UI[e.target.dataset.seg] = e.detail; VIEWS.tracker.render(); });
    $('#trkQ').addEventListener('input', e => { TRK_UI.q = e.target.value; clearTimeout(TRK_UI.t); TRK_UI.t = setTimeout(() => { VIEWS.tracker.render(); const i = $('#trkQ'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); });
  }
};

/* ---------------- global search ---------------- */
document.addEventListener('keydown', e => {
  if (e.target.id !== 'gsearch' || e.key !== 'Enter') return;
  const q = e.target.value.trim(); if (!q) return;
  const hit = Store.all('orders').find(o => norm(o.no) === norm(q) || norm(o.no).endsWith('-' + norm(q).padStart(4, '0')));
  e.target.value = ''; e.target.blur();
  if (hit) go('order', hit.id); else { ORD_UI.q = q; ORD_UI.f = 'all'; go('orders', q); }
});
