/* Nexus 2.0 — core: store, auth, RBAC, FMS glue, router, helpers. */
'use strict';
const NEXUS_BUILD = '2026-09-24-A';
console.log('Nexus build', NEXUS_BUILD);

/* ================= helpers ================= */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
const clone = o => JSON.parse(JSON.stringify(o));
const norm = s => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
const nowIso = () => new Date().toISOString();
const todayYmd = () => ymdOf(new Date());
function ymdOf(d) { d = new Date(d); const p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtD(v) { if (!v) return ''; const d = new Date(v); if (isNaN(d)) return ''; return d.getDate() + ' ' + MON[d.getMonth()] + (d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : ''); }
function fmtDT(v) { if (!v) return ''; const d = new Date(v); if (isNaN(d)) return ''; const p = n => String(n).padStart(2, '0'); return fmtD(d) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); }
function fmtDelay(min) {
  if (!min) return '';
  const day = calendar().dayMinutes || 480;
  const d = Math.floor(min / day), h = Math.floor((min % day) / 60), m = min % 60;
  return (d ? d + 'd ' : '') + (h ? h + 'h ' : '') + (!d && m ? m + 'm' : '').trim() || '0m';
}
const money = v => num(v).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const qtyFmt = v => num(v).toLocaleString('en-IN', { maximumFractionDigits: 3 });
function stCls(s) { return String(s || '').replace(/[^A-Za-z]/g, ''); }
function stHtml(s) { return '<span class="st ' + stCls(s) + '">' + esc(s) + '</span>'; }
function seg(name, options, value, attrs) {
  return '<span class="seg" data-seg="' + esc(name) + '" ' + (attrs || '') + '>' + options.map(o => {
    const v = typeof o === 'object' ? o.v : o, l = typeof o === 'object' ? o.l : (o === '' ? 'None' : o);
    return '<button type="button" data-v="' + esc(v) + '" class="' + (String(v) === String(value == null ? '' : value) ? 'on' : '') + '">' + esc(l) + '</button>';
  }).join('') + '</span>';
}
function segVal(el) { const b = el && el.querySelector('button.on'); return b ? b.dataset.v : ''; }
async function hashPin(email, pin) {
  const s = norm(email) + '|' + pin;
  try { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join(''); }
  catch (e) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return 'f' + (h >>> 0).toString(16); }
}
let flashTimer;
function flash(msg, type) {
  const f = $('#flash'); f.innerHTML = msg; f.className = type === 'err' ? 'err' : '';
  clearTimeout(flashTimer); flashTimer = setTimeout(() => f.classList.add('hidden'), type === 'err' ? 7000 : 4000);
}

/* ================= store ================= */
const DB_KEY = 'nexus2_db';
const COLS = ['users', 'roles', 'customers', 'items', 'processes', 'orders', 'dispatches', 'audit'];
let DB = null;
const CFG = window.NEXUS_CONFIG || {};
const CLOUD = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && window.supabase);
let SB = null;

const Store = {
  all(col) { return DB[col] || []; },
  get(col, id) { return (DB[col] || []).find(d => d.id === id) || null; },
  put(col, doc) {
    if (!doc.id) doc.id = uid();
    doc.updated_at = nowIso();
    const list = DB[col] || (DB[col] = []);
    const i = list.findIndex(d => d.id === doc.id);
    if (i >= 0) list[i] = doc; else list.push(doc);
    this.persist(col, doc); RES_CACHE.clear();
    return doc;
  },
  del(col, id) {
    DB[col] = (DB[col] || []).filter(d => d.id !== id);
    this.persist(col, { id }, true); RES_CACHE.clear();
  },
  setSettings(s) { DB.settings = s; s.id = 'main'; s.updated_at = nowIso(); this.persist('settings', s); RES_CACHE.clear(); },
  persist(col, doc, isDelete) {
    try { localStorage.setItem(DB_KEY, JSON.stringify(DB)); } catch (e) { flash('Browser storage full — export a backup from Settings.', 'err'); }
    if (CLOUD && SB) cloudWrite(col, doc, isDelete);
  },
  loadLocal() {
    try { DB = JSON.parse(localStorage.getItem(DB_KEY) || 'null'); } catch (e) { DB = null; }
    if (!DB || !DB.settings) { DB = seedData(); localStorage.setItem(DB_KEY, JSON.stringify(DB)); }
    COLS.forEach(c => { if (!DB[c]) DB[c] = []; });
  }
};

/* ---- cloud (Supabase): one generic table nx_docs(collection, id, data) ---- */
let pendingWrites = 0;
function syncBadge() { const s = $('#syncState'); if (s) s.textContent = CLOUD ? (pendingWrites ? 'Saving…' : 'Synced') : 'Local mode'; }
async function cloudWrite(col, doc, isDelete) {
  pendingWrites++; syncBadge();
  try {
    const q = isDelete ? SB.from('nx_docs').delete().eq('collection', col).eq('id', doc.id)
      : SB.from('nx_docs').upsert({ collection: col, id: doc.id, data: doc, updated_at: nowIso() });
    const { error } = await q; if (error) throw error;
  } catch (e) { flash('Cloud save failed: ' + esc(e.message || e) + ' — change kept in this browser only.', 'err'); }
  pendingWrites--; syncBadge();
}
async function cloudLoad() {
  const out = { settings: null }; COLS.forEach(c => out[c] = []);
  let from = 0; const page = 1000;
  for (;;) {
    const { data, error } = await SB.from('nx_docs').select('collection,id,data').range(from, from + page - 1);
    if (error) throw error;
    data.forEach(r => { if (r.collection === 'settings') out.settings = r.data; else if (out[r.collection]) out[r.collection].push(r.data); });
    if (data.length < page) break; from += page;
  }
  if (!out.settings) {                      // empty project → seed masters (no demo orders) and push
    const seed = seedData(true);
    DB = seed; localStorage.setItem(DB_KEY, JSON.stringify(DB));
    await SB.from('nx_docs').upsert([{ collection: 'settings', id: 'main', data: seed.settings }]
      .concat(COLS.flatMap(c => seed[c].map(d => ({ collection: c, id: d.id, data: d })))));
  } else { DB = out; localStorage.setItem(DB_KEY, JSON.stringify(DB)); }
  SB.channel('nx_docs').on('postgres_changes', { event: '*', schema: 'public', table: 'nx_docs' }, p => {
    const r = p.new && p.new.collection ? p.new : p.old; if (!r || !r.collection) return;
    if (r.collection === 'settings') DB.settings = p.new.data;
    else if (DB[r.collection]) {
      const list = DB[r.collection]; const i = list.findIndex(d => d.id === r.id);
      if (p.eventType === 'DELETE') { if (i >= 0) list.splice(i, 1); }
      else if (i >= 0) list[i] = p.new.data; else list.push(p.new.data);
    }
    RES_CACHE.clear();
    const a = document.activeElement;
    if (!a || !/INPUT|TEXTAREA|SELECT/.test(a.tagName)) { renderNav(); route(); }
  }).subscribe();
}

/* ---- numbering ---- */
function nextNo(col, prefix) {
  const yr = new Date().getFullYear(); const head = prefix + '-' + yr + '-';
  const max = Store.all(col).reduce((m, d) => d.no && d.no.startsWith(head) ? Math.max(m, parseInt(d.no.slice(head.length), 10) || 0) : m, 0);
  return head + String(max + 1).padStart(4, '0');
}
function audit(action, ref, detail) {
  Store.put('audit', { id: uid(), at: nowIso(), user: ME ? ME.name : 'system', action, ref: ref || '', detail: detail || '' });
}

/* ================= RBAC ================= */
const MODULES = [
  { key: 'dashboard', label: 'Home' },
  { key: 'tasks', label: 'My Tasks', note: 'Edit = mark own steps done' },
  { key: 'orders', label: 'Orders', note: 'Edit = punch, edit, priority' },
  { key: 'dispatch', label: 'Dispatch' },
  { key: 'tracker', label: 'FMS Tracker', note: 'Edit = mark anyone\'s step, undo' },
  { key: 'builder', label: 'FMS Builder', note: 'Edit = change & activate flows' },
  { key: 'masters', label: 'Customers & Items' },
  { key: 'users', label: 'Users' },
  { key: 'roles', label: 'Roles & Access' },
  { key: 'settings', label: 'Settings' },
  { key: 'audit', label: 'Audit Log' }
];
let ME = null;
function myRole() { return ME ? Store.get('roles', ME.role_id) : null; }
function can(mod, level) {             // level: 'view' | 'edit'
  const r = myRole(); if (!r) return false;
  if (r.system) return true;
  const p = (r.perms || {})[mod] || 'none';
  return level === 'edit' ? p === 'edit' : (p === 'view' || p === 'edit');
}
function requirePerm(mod, level) { if (can(mod, level)) return true; flash('You do not have ' + level + ' access to ' + mod + '.', 'err'); return false; }
function isMyDoer(doer) { return !!(ME && doer && norm(doer) === norm(ME.doer)); }

/* ================= FMS glue ================= */
const RES_CACHE = new Map();
function settings() { return DB.settings; }
function calendar() {
  const c = settings().calendar || {};
  return Object.assign({}, c, { holidays: (settings().holidays || []).map(h => h.date) });
}
function calInfo() { return FMSEngine.makeCalendar(calendar()); }
function activeProcess(code) { return Store.all('processes').find(p => p.code === (code || 'o2d') && p.active) || null; }
function specOf(proc) { return proc ? Object.assign({}, proc.spec, { calendar: calendar() }) : null; }
function orderTotals(o) {
  const qty = (o.lines || []).reduce((s, l) => s + num(l.qty), 0);
  const value = (o.lines || []).reduce((s, l) => s + num(l.qty) * num(l.rate), 0);
  return { qty, value };
}
function dispatchedQty(o) {
  const per = (o.lines || []).map(() => 0);
  Store.all('dispatches').filter(d => d.order_id === o.id && !d.cancelled).forEach(d => (d.lines || []).forEach(l => { if (per[l.idx] != null) per[l.idx] += num(l.qty); }));
  const total = per.reduce((a, b) => a + b, 0);
  return { per, total, pending: Math.max(0, orderTotals(o).qty - total) };
}
function orderFields(o) {
  const t = orderTotals(o);
  return Object.assign({}, o.extra || {}, {
    created_at: o.created_at, order_no: o.no, customer: o.customer_name, category: o.category,
    payment_terms: o.payment_terms, priority: o.priority || '', delivery_date: o.delivery_date,
    qty: t.qty, value: t.value
  });
}
function resolveOrder(o) {
  const key = o.id + '|' + o.updated_at;
  if (RES_CACHE.has(key)) return RES_CACHE.get(key);
  const proc = Store.get('processes', o.process_id); const spec = specOf(proc);
  let res = null;
  if (spec) {
    try { res = FMSEngine.resolveInstance(spec, { fields: orderFields(o), actuals: o.actuals || {} }, new Date()); res.spec = spec; }
    catch (e) { console.error(e); }
  }
  RES_CACHE.set(key, res); return res;
}
// Order-level state for lists.
function orderState(o) {
  const r = resolveOrder(o);
  const dq = dispatchedQty(o);
  if (o.priority === 'Cancelled') return { label: 'Cancelled', cls: 'Cancelled', open: false };
  if (dq.pending <= 0 && dq.total > 0) return { label: 'Dispatched', cls: 'Done', open: false };
  if (o.priority === 'On Hold') return { label: 'On Hold', cls: 'OnHold', open: true };
  if (!r) return { label: 'No flow', cls: 'NA', open: true };
  const open = r.order.map(id => r.steps[id]).filter(s => s.status === 'Pending' || s.status === 'Late')
    .sort((a, b) => a.planned - b.planned);
  const late = open.filter(s => s.status === 'Late');
  const cur = late[0] || open[0];
  return {
    label: cur ? cur.name : (dq.total ? 'Part dispatched' : 'Waiting'), cls: late.length ? 'Late' : (cur ? 'Pending' : 'Waiting'),
    open: true, late: late.length, cur, partial: dq.total > 0
  };
}
// All actionable steps across open orders.
function allOpenSteps() {
  const out = [];
  Store.all('orders').forEach(o => {
    if (o.priority === 'Cancelled') return;
    const r = resolveOrder(o); if (!r) return;
    r.order.forEach(id => { const s = r.steps[id]; if (s.status === 'Pending' || s.status === 'Late') out.push({ order: o, step: s, def: r.spec.steps.find(x => x.id === id), spec: r.spec }); });
  });
  return out.sort((a, b) => a.step.planned - b.step.planned);
}
function isDispatchStep(def, spec) { return def && spec && spec.process && def.id === spec.process.endStep; }
function canMarkStep(def, s, spec) {
  if (isDispatchStep(def, spec)) return false;                 // closed by the dispatch module
  if (can('tracker', 'edit')) return true;
  return can('tasks', 'edit') && isMyDoer(s.doer);
}
function markStepDone(orderId, stepId, note) {
  const o = Store.get('orders', orderId); if (!o) return;
  const r = resolveOrder(o); const s = r && r.steps[stepId]; const def = r && r.spec.steps.find(x => x.id === stepId);
  if (!s || !(s.status === 'Pending' || s.status === 'Late')) { flash('This step is not open.', 'err'); return; }
  if (!canMarkStep(def, s, r.spec)) { flash('Only ' + esc(s.doer) + ' (or a tracker editor) can close this step.', 'err'); return; }
  o.actuals = o.actuals || {}; o.actuals[stepId] = nowIso();
  if (note) { o.notes = o.notes || {}; o.notes[stepId] = note; }
  o.done_by = o.done_by || {}; o.done_by[stepId] = ME.name;
  Store.put('orders', o);
  audit('step.done', o.no, s.name + (s.delayMinutes ? ' (late ' + fmtDelay(s.delayMinutes) + ')' : '') + (note ? ' — ' + note : ''));
  flash(esc(s.name) + ' marked done for ' + esc(o.no) + '. <a data-act="undo-step" data-o="' + esc(o.id) + '" data-s="' + esc(stepId) + '">Undo</a>');
}
function undoStep(orderId, stepId) {
  const o = Store.get('orders', orderId); if (!o || !o.actuals || !o.actuals[stepId]) return;
  const r = resolveOrder(o);
  const justMine = o.done_by && o.done_by[stepId] === ME.name && (Date.now() - new Date(o.actuals[stepId])) < 5 * 60000;
  if (!justMine && !can('tracker', 'edit')) { flash('Undo needs tracker edit access.', 'err'); return; }
  const dependents = r.spec.steps.filter(d => (Array.isArray(d.trigger) ? d.trigger : [d.trigger]).some(t => t && t.type === 'afterStep' && t.step === stepId) && o.actuals[d.id]);
  if (dependents.length) { flash('Cannot undo — next step already done: ' + esc(dependents.map(d => d.name).join(', ')), 'err'); return; }
  delete o.actuals[stepId];
  Store.put('orders', o); audit('step.undo', o.no, r.steps[stepId].name); flash('Undone.'); route();
}

/* ================= validation of a process spec (browser port of validate_spec.js) ================= */
function validateSpec(spec) {
  const errors = [], warns = [];
  const ids = new Set(); const fieldKeys = new Set((spec.fields || []).map(f => f.key)); fieldKeys.add('created_at');
  const tables = spec.doerTables || {};
  if (!spec.process || !spec.process.id) errors.push('process.id missing');
  if (!Array.isArray(spec.steps) || !spec.steps.length) errors.push('No steps');
  (spec.steps || []).forEach((s, i) => {
    const at = (s.name || s.id || 'step ' + (i + 1));
    if (!s.id) errors.push(at + ': id missing'); else if (ids.has(s.id)) errors.push(at + ': duplicate id "' + s.id + '"'); ids.add(s.id);
    if (!s.name) errors.push(at + ': name missing');
    if (!s.doer) warns.push(at + ': no doer — nobody will see this task');
    if (s.doer && s.doer.type === 'lookup') {
      if (!tables[s.doer.table]) errors.push(at + ': doer table "' + s.doer.table + '" not found');
      if (!fieldKeys.has(s.doer.by)) errors.push(at + ': doer lookup field "' + s.doer.by + '" is not a field');
    }
    const trig = Array.isArray(s.trigger) ? s.trigger : [s.trigger];
    if (!trig[0]) errors.push(at + ': trigger missing');
    trig.forEach((t, j) => {
      if (!t) return; const tat = t.tat || s.tat;
      if (t.type === 'afterStep' && !(spec.steps || []).some(x => x.id === t.step)) errors.push(at + ': trigger ' + (j + 1) + ' refers to unknown step "' + t.step + '"');
      if (t.type === 'afterStep' && t.step === s.id) errors.push(at + ': step cannot trigger itself');
      if (['beforeDate', 'afterDate', 'external'].includes(t.type) && !fieldKeys.has(t.field)) errors.push(at + ': trigger ' + (j + 1) + ' field "' + t.field + '" is not a field');
      if (['afterStep', 'instanceStart', 'beforeDate', 'afterDate'].includes(t.type) && !tat) errors.push(at + ': no TAT');
      if (j < trig.length - 1 && !t.when && !t.orNext) warns.push(at + ': trigger ' + (j + 1) + ' has no condition / fallback, so later triggers are never used');
    });
  });
  if (!errors.length) { try { FMSEngine.topoOrder(spec); } catch (e) { errors.push('Loop in the flow: ' + e.message); } }
  const walk = (c, at) => { if (!c) return; if (Array.isArray(c)) return c.forEach(x => walk(x, at)); if (c.all) return c.all.forEach(x => walk(x, at)); if (c.any) return c.any.forEach(x => walk(x, at)); if (c.not) return walk(c.not, at); if (c.field && !fieldKeys.has(c.field)) errors.push(at + ': condition uses unknown field "' + c.field + '"'); if ((c.in && !c.in.length) || (c.notIn && !c.notIn.length)) warns.push(at + ': condition on "' + c.field + '" has no values'); };
  (spec.steps || []).forEach(s => { walk(s.applies, s.name + ' (applies)'); (Array.isArray(s.trigger) ? s.trigger : [s.trigger]).forEach(t => t && walk(t.when, s.name + ' (trigger)')); if (s.doer && s.doer.rules) s.doer.rules.forEach(r => walk(r.when, s.name + ' (doer rule)')); });
  if (spec.process && spec.process.endStep && !ids.has(spec.process.endStep)) errors.push('End step "' + spec.process.endStep + '" is not a step');
  const doers = new Set(Store.all('users').map(u => norm(u.doer)));
  (spec.steps || []).forEach(s => { if (s.doer && (typeof s.doer === 'string' || s.doer.type === 'fixed')) { const n = typeof s.doer === 'string' ? s.doer : s.doer.name; if (n && !doers.has(norm(n))) warns.push(s.name + ': doer "' + n + '" is not linked to any user'); } });
  return { errors, warns };
}

/* ================= router & nav ================= */
const VIEWS = {};      // name -> { mod, render(param) }
const ACTIONS = {};    // data-act handlers
const NAV = [
  { grp: 'Work' }, { v: 'home', l: 'Home', mod: 'dashboard' }, { v: 'tasks', l: 'My Tasks', mod: 'tasks', cnt: 'tasks' },
  { v: 'punch', l: 'Punch Order', mod: 'orders', edit: true }, { v: 'orders', l: 'Orders', mod: 'orders' },
  { v: 'dispatch', l: 'Dispatch', mod: 'dispatch', cnt: 'dispatch' },
  { grp: 'FMS' }, { v: 'tracker', l: 'Tracker', mod: 'tracker' }, { v: 'builder', l: 'FMS Builder', mod: 'builder' },
  { grp: 'Masters' }, { v: 'customers', l: 'Customers', mod: 'masters' }, { v: 'items', l: 'Items', mod: 'masters' },
  { grp: 'Admin' }, { v: 'users', l: 'Users', mod: 'users' }, { v: 'roles', l: 'Roles & Access', mod: 'roles' },
  { v: 'settings', l: 'Settings', mod: 'settings' }, { v: 'audit', l: 'Audit Log', mod: 'audit' }
];
function curView() { const h = location.hash.replace(/^#\/?/, ''); const [v, ...rest] = h.split('/'); return { v: v || 'home', param: decodeURIComponent(rest.join('/')) }; }
function go(v, param) { location.hash = '#/' + v + (param ? '/' + encodeURIComponent(param) : ''); }
function navCounts() {
  const open = allOpenSteps();
  const mine = open.filter(x => isMyDoer(x.step.doer));
  return {
    tasks: { n: mine.length, late: mine.some(x => x.step.status === 'Late') },
    dispatch: { n: readyForDispatch().length, late: false }
  };
}
function renderNav() {
  const cur = curView().v; const c = navCounts();
  let html = '<div class="brand">Nexus <b>2.0</b></div>'; let pendingGrp = null;
  NAV.forEach(n => {
    if (n.grp) { pendingGrp = n.grp; return; }
    if (!can(n.mod, n.edit ? 'edit' : 'view')) return;
    if (pendingGrp) { html += '<div class="grp">' + pendingGrp + '</div>'; pendingGrp = null; }
    const k = n.cnt && c[n.cnt];
    html += '<a href="#/' + n.v + '" class="' + (cur === n.v ? 'on' : '') + '">' + n.l + (k && k.n ? '<span class="cnt' + (k.late ? ' late' : '') + '">' + k.n + '</span>' : '') + '</a>';
  });
  $('#nav').innerHTML = html;
}
function route() {
  if (!ME) return;
  const { v, param } = curView(); const view = VIEWS[v];
  $('#nav').classList.remove('open');
  if (!view) { go('home'); return; }
  if (!can(view.mod, view.edit ? 'edit' : 'view')) { setMain('<div class="panel empty">You do not have access to this screen. Ask an admin to update your role.</div>'); renderNav(); return; }
  renderNav();
  try { view.render(param); } catch (e) { console.error(e); setMain('<div class="panel">Error: ' + esc(e.message) + '</div>'); }
}

/* ================= events ================= */
document.addEventListener('click', ev => {
  const segBtn = ev.target.closest('.seg button');
  if (segBtn && !segBtn.disabled) {
    const s = segBtn.parentElement; if (s.hasAttribute('data-locked')) return;
    $$('button', s).forEach(b => b.classList.toggle('on', b === segBtn));
    s.dispatchEvent(new CustomEvent('segchange', { bubbles: true, detail: segBtn.dataset.v }));
  }
  const el = ev.target.closest('[data-act]'); if (!el || el.disabled) return;
  if (el.dataset.confirm && !el.classList.contains('confirm')) {          // inline two-click confirm, no popup
    ev.preventDefault(); const old = el.textContent; el.classList.add('confirm'); el.textContent = el.dataset.confirm;
    setTimeout(() => { if (el.isConnected) { el.classList.remove('confirm'); el.textContent = old; } }, 3000); return;
  }
  const fn = ACTIONS[el.dataset.act]; if (fn) { ev.preventDefault(); fn(el, ev); }
});
ACTIONS['toggle-nav'] = () => $('#nav').classList.toggle('open');
ACTIONS['go'] = el => go(el.dataset.v, el.dataset.p);
ACTIONS['undo-step'] = el => undoStep(el.dataset.o, el.dataset.s);
ACTIONS['logout'] = async () => { localStorage.removeItem('nexus2_me'); if (SB) await SB.auth.signOut(); location.reload(); };
document.addEventListener('keydown', ev => {
  const typing = /INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '');
  if (ev.key === '/' && !typing) { ev.preventDefault(); $('#gsearch').focus(); }
  if (ev.altKey && (ev.key === 'n' || ev.key === 'N') && can('orders', 'edit')) { ev.preventDefault(); go('punch'); }
  if ((ev.ctrlKey || ev.metaKey) && (ev.key === 's' || ev.key === 'S')) { const b = $('[data-save]'); if (b) { ev.preventDefault(); b.click(); } }
});
window.addEventListener('hashchange', route);

/* ================= login ================= */
async function doLogin(email, pin) {
  email = norm(email);
  if (CLOUD) {
    const { error } = await SB.auth.signInWithPassword({ email, password: pin });
    if (error) throw new Error(error.message);
    await cloudLoad();
  }
  let u = Store.all('users').find(x => norm(x.email) === email);
  if (CLOUD && !u && Store.all('users').every(x => x.seed)) {           // first cloud login becomes the admin
    u = Store.all('users').find(x => x.seed && x.role_id === 'r_admin');
    u.email = email; u.seed = false; Store.put('users', u);
  }
  if (!u) throw new Error('This email is not registered in Nexus. Ask an admin.');
  if (u.active === false) throw new Error('This user is deactivated.');
  if (!CLOUD) {
    if (u.pin_hash) { if (u.pin_hash !== await hashPin(email, pin)) throw new Error('Wrong PIN.'); }
    else if (u.pin_seed && u.pin_seed === pin) { u.pin_hash = await hashPin(email, pin); delete u.pin_seed; Store.put('users', u); }
    else throw new Error('Wrong PIN.');
  }
  return u;
}
function startApp(u) {
  ME = u; localStorage.setItem('nexus2_me', u.id);
  $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
  const r = myRole();
  $('#who').innerHTML = esc(u.name) + ' <span class="muted">· ' + esc(r ? r.name : '') + (u.doer ? ' · ' + esc(u.doer) : '') + '</span>';
  syncBadge(); if (!location.hash) go(can('tasks', 'view') && !can('dashboard', 'view') ? 'tasks' : 'home'); route();
  setInterval(() => { RES_CACHE.clear(); const a = document.activeElement; if (!a || !/INPUT|TEXTAREA|SELECT/.test(a.tagName)) { renderNav(); if (['home', 'tasks', 'tracker'].includes(curView().v)) route(); } }, 60000);
}
async function boot() {
  Store.loadLocal();
  if (CLOUD) { SB = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY); $('#pinLabel').textContent = 'Password'; }
  $('#loginMsg').innerHTML = CLOUD ? 'Cloud mode — sign in with your Supabase account.' : 'Local mode — demo login: <b>admin@nexus.local</b> / PIN <b>1234</b>';
  const saved = localStorage.getItem('nexus2_me');
  if (saved) {
    if (CLOUD) { const { data } = await SB.auth.getSession(); if (data && data.session) { try { await cloudLoad(); } catch (e) { flash('Cloud load failed: ' + esc(e.message), 'err'); } } else localStorage.removeItem('nexus2_me'); }
    const u = Store.get('users', localStorage.getItem('nexus2_me'));
    if (u && u.active !== false) return startApp(u);
  }
  $('#login').classList.remove('hidden');
  $('#loginForm').addEventListener('submit', async ev => {
    ev.preventDefault(); const f = ev.target; $('#loginMsg').textContent = 'Signing in…';
    try { startApp(await doLogin(f.email.value, f.pin.value)); } catch (e) { $('#loginMsg').innerHTML = '<span class="late-txt">' + esc(e.message) + '</span>'; }
  });
}

/* fresh #main per render, so listeners never pile up across screens */
let SEG_HANDLER = null;
function setMain(html) {
  const old = $('#main'); const m = old.cloneNode(false); m.innerHTML = html; old.replaceWith(m);
  SEG_HANDLER = null; return m;
}
function onSeg(fn) { SEG_HANDLER = fn; }
document.addEventListener('segchange', e => { if (SEG_HANDLER && e.target.closest('#main') && !e.target.hasAttribute('data-own')) SEG_HANDLER(e); });
