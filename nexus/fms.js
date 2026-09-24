/* Nexus 2.0 — FMS Builder: steps editor, live flow chart, validation, simulate, versions. */
'use strict';
const B = { pid: null, draft: null, sel: null, tab: 'flow', dirty: false, pv: {}, sim: null };
const TRIG_TYPES = [{ v: 'instanceStart', l: 'Order punch' }, { v: 'afterStep', l: 'After step' }, { v: 'beforeDate', l: 'Before date' }, { v: 'afterDate', l: 'After date' }, { v: 'external', l: 'On date' }];
const slug = s => norm(s).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'step';

function bldLoad(pid) {
  const p = Store.get('processes', pid) || activeProcess() || Store.all('processes')[0];
  B.pid = p ? p.id : null; B.draft = p ? clone(p.spec) : null; B.dirty = false;
  B.sel = B.draft && B.draft.steps[0] ? B.draft.steps[0].id : null;
}
function bldFields(types) { return (B.draft.fields || []).filter(f => !types || types.includes(f.type)); }
function fieldOpts(key) { const f = (B.draft.fields || []).find(x => x.key === key); if (!f) return []; if (f.options) return f.options.filter(o => o !== ''); if (f.optionsFrom && f.optionsFrom.startsWith('doerTables.')) return Object.keys((B.draft.doerTables || {})[f.optionsFrom.split('.')[1]] || {}); return []; }
function doerNames() { return Array.from(new Set(Store.all('users').map(u => u.doer).filter(Boolean))).sort(); }
function tatStr(t) { return t ? t.value + (t.unit === 'hours' ? 'h' : 'd') + (t.urgent != null && t.urgent !== '' ? ' / urgent ' + t.urgent + (t.unit === 'hours' ? 'h' : 'd') : '') : ''; }
function fieldLabel(k) { const f = (B.draft.fields || []).find(x => x.key === k); return f ? f.label : k; }
function describeTrigger(t) {
  if (!t) return '';
  const w = t.when ? ' (if ' + condText(t.when) + ')' : '';
  const step = t.step && B.draft.steps.find(s => s.id === t.step);
  const base = t.type === 'instanceStart' ? 'order punch' : t.type === 'afterStep' ? 'after "' + (step ? step.name : t.step) + '"' : t.type === 'beforeDate' ? 'before ' + fieldLabel(t.field) : t.type === 'afterDate' ? 'after ' + fieldLabel(t.field) : 'on ' + fieldLabel(t.field);
  return base + w + (t.orNext ? ', else next' : '');
}
function condText(c) {
  if (!c) return 'always';
  if (c.all) return c.all.map(condText).join(' and '); if (c.any) return c.any.map(condText).join(' or '); if (c.not) return 'not (' + condText(c.not) + ')';
  const f = fieldLabel(c.field);
  if ('in' in c) return f + ' is ' + c.in.join('/'); if ('notIn' in c) return f + ' is not ' + c.notIn.join('/');
  if ('eq' in c) return f + ' = ' + c.eq; if ('ne' in c) return f + ' ≠ ' + c.ne; if ('empty' in c) return f + (c.empty ? ' is empty' : ' is filled');
  return JSON.stringify(c);
}

/* ---------- condition <-> rows ---------- */
function isLeaf(c) { return c && c.field && ['in', 'notIn', 'eq', 'ne', 'empty'].some(k => k in c); }
function condToRows(c) {
  if (!c) return { join: 'all', rows: [] };
  if (isLeaf(c)) return { join: 'all', rows: [leafRow(c)] };
  const k = c.all ? 'all' : c.any ? 'any' : null;
  if (k && c[k].every(isLeaf)) return { join: k, rows: c[k].map(leafRow) };
  return null;                                           // complex → JSON
}
function leafRow(c) {
  if ('in' in c) return { field: c.field, op: 'in', values: c.in }; if ('eq' in c) return { field: c.field, op: 'in', values: [c.eq] };
  if ('notIn' in c) return { field: c.field, op: 'notIn', values: c.notIn }; if ('ne' in c) return { field: c.field, op: 'notIn', values: [c.ne] };
  return { field: c.field, op: 'empty', values: [] };
}
function rowsToCond(join, rows) {
  const leaves = rows.filter(r => r.field).map(r => r.op === 'empty' ? { field: r.field, empty: true } : { field: r.field, [r.op]: r.values });
  if (!leaves.length) return undefined; if (leaves.length === 1) return leaves[0]; return { [join]: leaves };
}
function condEditor(key, cond) {
  const rs = condToRows(cond);
  if (!rs) return '<div class="condbox" data-cond="' + key + '" data-json="1"><textarea rows="3" class="mono" data-cjson>' + esc(JSON.stringify(cond)) + '</textarea><div class="muted small">Advanced condition (JSON)</div></div>';
  const flds = bldFields(['select', 'text', 'number']);
  return '<div class="condbox" data-cond="' + key + '">' + (rs.rows.length > 1 ? '<div style="margin-bottom:4px">' + seg('cjoin', [{ v: 'all', l: 'All match' }, { v: 'any', l: 'Any matches' }], rs.join) + '</div>' : '') +
    rs.rows.map(r => '<div class="row condrow" style="margin-bottom:4px;align-items:center"><select data-cf>' + flds.map(f => '<option value="' + esc(f.key) + '"' + (f.key === r.field ? ' selected' : '') + '>' + esc(f.label) + '</option>').join('') + '</select>' +
      seg('cop', [{ v: 'in', l: 'is' }, { v: 'notIn', l: 'is not' }, { v: 'empty', l: 'empty' }], r.op) +
      (r.op === 'empty' ? '' : '<input data-cv style="flex:1;min-width:100px" placeholder="value1, value2" value="' + esc(r.values.join(', ')) + '" list="dlo_' + esc(r.field) + '">') +
      '<button class="btn ghost sm" data-act="cond-del">×</button></div>').join('') +
    '<a class="small" data-act="cond-add" data-cond="' + key + '">+ condition</a>' +
    flds.map(f => '<datalist id="dlo_' + esc(f.key) + '">' + fieldOpts(f.key).map(o => '<option value="' + esc(o) + '">').join('') + '</datalist>').join('') + '</div>';
}
function readCond(box) {
  if (!box) return undefined;
  if (box.dataset.json) { try { const t = $('[data-cjson]', box).value.trim(); return t ? JSON.parse(t) : undefined; } catch (e) { return { __bad: true }; } }
  const join = segVal($('[data-seg="cjoin"]', box)) || 'all';
  return rowsToCond(join, $$('.condrow', box).map(r => ({ field: $('[data-cf]', r).value, op: segVal($('[data-seg="cop"]', r)) || 'in', values: ($('[data-cv]', r) ? $('[data-cv]', r).value : '').split(',').map(s => s.trim()).filter(Boolean) })));
}

/* ---------- view ---------- */
VIEWS.builder = {
  mod: 'builder', render() {
    if (!B.draft || !Store.get('processes', B.pid)) bldLoad();
    if (!B.draft) { setMain('<div class="panel">No process yet.</div>'); return; }
    const edit = can('builder', 'edit'); const proc = Store.get('processes', B.pid);
    const versions = Store.all('processes').filter(p => p.code === proc.code).sort((a, b) => a.version - b.version);
    const v = validateSpec(B.draft);
    let h = '<div class="toolbar"><h1 style="margin:0">FMS Builder</h1><span class="muted">' + esc(B.draft.process.name) + '</span><span class="grow"></span>' +
      '<span class="muted small">Version</span>' + seg('ver', versions.map(p => ({ v: p.id, l: 'v' + p.version + (p.active ? ' ✓' : '') })), B.pid) + '</div>';
    h += '<div class="toolbar"><span class="small">' + (proc.active ? '<b>v' + proc.version + ' is live</b> — new orders use it.' : 'v' + proc.version + ' is not live.') + ' ' + (B.dirty ? '<span class="late-txt">Unsaved changes.</span>' : '') + '</span><span class="grow"></span>' +
      (edit ? (B.dirty ? '<button class="btn" data-act="bld-discard" data-confirm="Discard?">Discard</button><button class="btn primary" data-save data-act="bld-save"' + (v.errors.length ? ' disabled title="Fix errors first"' : '') + '>Save as v' + (versions[versions.length - 1].version + 1) + '</button>' : '') +
        (!B.dirty && !proc.active ? '<button class="btn primary" data-act="bld-activate" data-confirm="Make live?"' + (v.errors.length ? ' disabled' : '') + '>Activate v' + proc.version + '</button>' : '') : '<span class="muted small">Read only</span>') + '</div>';
    h += '<div class="tabs">' + [['flow', 'Flow'], ['sim', 'Simulate'], ['fields', 'Fields & JSON']].map(([k, l]) => '<a data-act="bld-tab" data-t="' + k + '" class="' + (B.tab === k ? 'on' : '') + '">' + l + '</a>').join('') + '</div>';
    if (B.tab === 'flow') h += '<div class="bld"><div class="panel" style="padding:0"><div id="bSteps" class="steplist"></div>' + (edit ? '<div style="padding:8px"><button class="btn sm" data-act="bld-add">+ Add step</button></div>' : '') + '</div><div class="panel ed" id="bEd"></div><div><div id="bPv" class="toolbar"></div><div class="chart-wrap" id="bChart"></div><div id="bVal" class="panel small" style="margin-top:10px"></div></div></div>';
    else if (B.tab === 'sim') h += '<div id="bSim"></div>';
    else h += '<div id="bFields"></div>';
    setMain(h);
    onSeg(bldSeg);
    if (B.tab === 'flow') { bldSide(); bldEditor(); const m = $('#main'); m.addEventListener('input', bldInput); m.addEventListener('change', bldInput); }
    if (B.tab === 'sim') bldSim();
    if (B.tab === 'fields') bldFieldsTab();
  }
};
function bldMarkDirty() { if (!B.dirty) { B.dirty = true; VIEWS.builder.render(); return true; } return false; }
function bldSeg(e) {
  const k = e.target.dataset.seg;
  if (k === 'ver') { if (B.dirty) { flash('Save or discard your changes first.', 'err'); VIEWS.builder.render(); return; } bldLoad(e.detail); VIEWS.builder.render(); return; }
  if (k && k.startsWith('pv_')) { B.pv[k.slice(3)] = e.detail; bldSide(); return; }
  if (k && k.startsWith('sim_')) { B.sim.fields[k.slice(4)] = e.detail; bldSim(); return; }
  if (e.target.closest('#bEd')) { bldCollect(); if (!bldMarkDirty()) { bldEditor(); bldSide(); } }
}
function bldInput(e) {
  if (!e.target.closest('#bEd')) return;
  bldCollect(); if (!bldMarkDirty()) bldSide();
  if (e.type === 'change' && e.target.matches('select')) bldEditor();
}

/* ---------- side: steplist + chart + validation ---------- */
function bldSide() {
  const d = B.draft;
  const order = (() => { try { return FMSEngine.topoOrder(d); } catch (e) { return d.steps.map(s => s.id); } })();
  $('#bSteps').innerHTML = d.steps.map(s => '<a data-act="bld-sel" data-s="' + esc(s.id) + '" class="' + (s.id === B.sel ? 'on' : '') + '">' + esc(s.name || '(unnamed)') + '<div class="muted">' + esc(typeof s.doer === 'object' ? (s.doer.name || s.doer.table || 'rule') : s.doer || '') + ' · ' + esc(tatStr(s.tat)) + '</div></a>').join('');
  // preview instance controls
  const selFields = bldFields(['select']).filter(f => f.key !== 'priority' || true);
  $('#bPv').innerHTML = '<span class="muted small">Preview for:</span>' + selFields.map(f => { const o = fieldOpts(f.key); if (!o.length || o.length > 6) return ''; if (B.pv[f.key] == null) B.pv[f.key] = f.key === 'priority' ? '' : o[0]; return seg('pv_' + f.key, (f.key === 'priority' ? [{ v: '', l: 'Normal' }] : []).concat(o.map(x => ({ v: x, l: x }))), B.pv[f.key]); }).join('');
  // chart
  let svg = '';
  try { svg = bldChart(d, order); } catch (e) { svg = '<div class="empty">Chart unavailable: ' + esc(e.message) + '</div>'; }
  $('#bChart').innerHTML = svg;
  const v = validateSpec(d);
  $('#bVal').innerHTML = (v.errors.length || v.warns.length ? '<ul class="val" style="margin:0;padding-left:16px">' + v.errors.map(x => '<li class="e">' + esc(x) + '</li>').join('') + v.warns.map(x => '<li class="w">' + esc(x) + '</li>').join('') + '</ul>' : '<span class="st Done">Flow is valid</span>') +
    '<div class="muted" style="margin-top:6px">' + d.steps.length + ' steps · Only actuals move the chain · Delay counted in working time</div>';
  const saveBtn = $('[data-act="bld-save"]'); if (saveBtn) saveBtn.disabled = !!v.errors.length;
}
function bldChart(spec, order) {
  const L = FMSEngine.layout(spec);
  const fields = Object.assign({ created_at: new Date().toISOString(), delivery_date: ymdOf(new Date(Date.now() + 10 * 86400000)) }, B.pv);
  let res = null; try { res = FMSEngine.resolveInstance(Object.assign({}, spec, { calendar: calendar() }), { fields, actuals: {} }); } catch (e) { }
  const W = 176, H = 50, GX = 214, GY = 68, LANEGAP = 26;
  const laneNames = { main: 'Main chain', external: 'Other system dates', date: 'Counted back from a date' };
  const lanesUsed = ['main', 'external', 'date'].filter(l => L.nodes.some(n => n.lane === l));
  const laneTop = {}; let y = 10;
  lanesUsed.forEach(l => { laneTop[l] = y + 18; const rows = Math.max(...L.nodes.filter(n => n.lane === l).map(n => n.row)) + 1; y += 18 + rows * GY + LANEGAP; });
  const pos = {}; L.nodes.forEach(n => { pos[n.id] = { x: 12 + n.rank * GX, y: laneTop[n.lane] + n.row * GY }; });
  const width = Math.max(...L.nodes.map(n => pos[n.id].x)) + W + 20, height = y;
  let s = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '">';
  s += '<defs><marker id="ar" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#9aa3ad"/></marker></defs>';
  lanesUsed.forEach(l => { s += '<text x="12" y="' + (laneTop[l] - 6) + '" fill="#6b7482" font-weight="600">' + laneNames[l].toUpperCase() + '</text>'; if (l !== lanesUsed[0]) s += '<line x1="0" x2="' + width + '" y1="' + (laneTop[l] - 22) + '" y2="' + (laneTop[l] - 22) + '" stroke="#eef0f3"/>'; });
  L.edges.forEach(e => {
    const a = pos[e.from], b = pos[e.to]; if (!a || !b) return;
    const x1 = a.x + W, y1 = a.y + H / 2, x2 = b.x - 2, y2 = b.y + H / 2, mx = (x1 + x2) / 2;
    const dim = res && (!res.steps[e.from].applies || !res.steps[e.to].applies);
    s += '<path d="M' + x1 + ',' + y1 + ' C' + mx + ',' + y1 + ' ' + mx + ',' + y2 + ' ' + x2 + ',' + y2 + '" fill="none" stroke="#9aa3ad" stroke-width="1.3"' + (e.kind === 'fallback' ? ' stroke-dasharray="4 3"' : '') + (dim ? ' opacity=".3"' : '') + ' marker-end="url(#ar)"/>';
  });
  L.nodes.forEach(n => {
    const st = spec.steps.find(x => x.id === n.id); const p = pos[n.id]; const r = res && res.steps[n.id];
    const on = n.id === B.sel; const applies = !r || r.applies;
    const t0 = Array.isArray(st.trigger) ? st.trigger[0] : st.trigger;
    const sub = (r && r.doer ? r.doer : '—') + ' · ' + (t0 && t0.type === 'beforeDate' ? 'T−' + ((t0.tat || st.tat || {}).value || 0) + 'd' : tatStr(t0 && t0.tat || st.tat).replace(' / urgent ', '/'));
    s += '<g data-act="bld-sel" data-s="' + esc(n.id) + '" style="cursor:pointer" opacity="' + (applies ? 1 : .35) + '">' +
      '<rect x="' + p.x + '" y="' + p.y + '" width="' + W + '" height="' + H + '" rx="4" fill="' + (on ? '#eaf1fa' : '#fff') + '" stroke="' + (on ? '#1f5fae' : '#c9ced6') + '" stroke-width="' + (on ? 1.6 : 1) + '"/>' +
      '<text x="' + (p.x + 8) + '" y="' + (p.y + 19) + '" fill="#1c2430" font-weight="600">' + esc((st.name || '').length > 26 ? st.name.slice(0, 25) + '…' : st.name) + '</text>' +
      '<text x="' + (p.x + 8) + '" y="' + (p.y + 37) + '" fill="#6b7482">' + esc(sub.length > 30 ? sub.slice(0, 29) + '…' : sub) + '</text>' +
      (st.status && st.status.type === 'auto' ? '<text x="' + (p.x + W - 8) + '" y="' + (p.y + 37) + '" text-anchor="end" fill="#1f5fae">auto</text>' : '') +
      (st.applies ? '<text x="' + (p.x + W - 8) + '" y="' + (p.y + 19) + '" text-anchor="end" fill="#a86200">if</text>' : '') + '</g>';
  });
  return s + '</svg>';
}

/* ---------- editor ---------- */
function curStep() { return B.draft.steps.find(s => s.id === B.sel); }
function bldEditor() {
  const el = $('#bEd'); const s = curStep(); if (!el) return;
  if (!s) { el.innerHTML = '<div class="muted">Select a step.</div>'; return; }
  const edit = can('builder', 'edit'); const others = B.draft.steps.filter(x => x.id !== s.id);
  const dateFields = bldFields(['date', 'datetime']).filter(f => f.key !== 'created_at');
  const doer = typeof s.doer === 'string' ? { type: 'fixed', name: s.doer } : (s.doer || { type: 'fixed', name: '' });
  const trig = (Array.isArray(s.trigger) ? s.trigger : [s.trigger]).filter(Boolean);
  const tat = s.tat || { value: 1, unit: 'days' };
  let h = '<datalist id="dlDoers">' + doerNames().map(n => '<option value="' + esc(n) + '">').join('') + '</datalist>';
  h += '<label>Step name<input data-k="name" value="' + esc(s.name) + '"></label><div class="muted small" style="margin:-4px 0 8px">id: <span class="mono">' + esc(s.id) + '</span></div>';
  h += '<label>What to do (shown to doer)<textarea data-k="what" rows="2">' + esc(s.what || '') + '</textarea></label>';
  h += '<div class="sub"><b>Doer</b> ' + seg('doerType', [{ v: 'fixed', l: 'Person / team' }, { v: 'lookup', l: 'From table' }, { v: 'byCondition', l: 'By rule' }], doer.type) + '<div style="margin-top:6px">';
  if (doer.type === 'fixed') h += '<input data-k="doerName" list="dlDoers" value="' + esc(doer.name || '') + '" placeholder="Doer name (linked to users)" style="width:100%">';
  else if (doer.type === 'lookup') h += '<div class="row"><label>Table<input data-k="doerTable" list="dlTables" value="' + esc(doer.table || '') + '"></label><label>By field<select data-k="doerBy">' + bldFields().map(f => '<option value="' + esc(f.key) + '"' + (f.key === doer.by ? ' selected' : '') + '>' + esc(f.label) + '</option>').join('') + '</select></label><label>Default<input data-k="doerDefault" list="dlDoers" value="' + esc(doer.default || '') + '"></label></div><datalist id="dlTables">' + Object.keys(B.draft.doerTables || {}).map(t => '<option value="' + esc(t) + '">').join('') + '</datalist><div class="muted small">Edit doer tables in Fields &amp; JSON.</div>';
  else h += '<textarea data-k="doerRules" rows="3" class="mono">' + esc(JSON.stringify(doer.rules || [], null, 0)) + '</textarea><label>Default<input data-k="doerDefault" list="dlDoers" value="' + esc(doer.default || '') + '"></label><div class="muted small">Rules: [{"when":{"field":"category","in":["X"]},"name":"DOER"}]</div>';
  h += '</div></div>';
  h += '<div class="sub"><b>Applies to</b> ' + seg('appliesMode', [{ v: 'always', l: 'Every order' }, { v: 'when', l: 'Only when…' }], s.applies ? 'when' : 'always') + (s.applies ? '<div style="margin-top:6px">' + condEditor('applies', s.applies) + '</div>' : '') + '</div>';
  h += '<div class="sub"><b>Starts</b> <span class="muted small">first matching line wins</span>';
  trig.forEach((t, j) => {
    h += '<div class="cand" data-j="' + j + '">' + seg('trigType', TRIG_TYPES, t.type) + (trig.length > 1 ? ' <button class="btn ghost sm" data-act="cand-del" data-j="' + j + '">×</button>' : '') + '<div class="row" style="margin-top:6px">';
    if (t.type === 'afterStep') h += '<label>Step<select data-t="step"><option value="">—</option>' + others.map(o => '<option value="' + esc(o.id) + '"' + (o.id === t.step ? ' selected' : '') + '>' + esc(o.name) + '</option>').join('') + '</select></label>';
    if (['beforeDate', 'afterDate', 'external'].includes(t.type)) h += '<label>Date field<select data-t="field"><option value="">—</option>' + dateFields.map(f => '<option value="' + esc(f.key) + '"' + (f.key === t.field ? ' selected' : '') + '>' + esc(f.label) + '</option>').join('') + '</select></label>';
    h += '<label>TAT here (optional)<input data-t="tatv" type="number" step="any" min="0" value="' + esc(t.tat ? t.tat.value : '') + '" placeholder="step TAT"></label></div>';
    h += '<div style="margin-top:4px"><label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" data-t="useWhen"' + (t.when ? ' checked' : '') + '> Only if…</label>' + (t.when ? condEditor('cand-' + j, t.when) : '') + '</div>';
    if (j < trig.length - 1) h += '<label style="flex-direction:row;align-items:center;gap:6px;margin-top:4px"><input type="checkbox" data-t="orNext"' + (t.orNext ? ' checked' : '') + '> If that step is not done yet, use the next line</label>';
    h += '</div>';
  });
  h += '<a class="small" data-act="cand-add">+ another start rule</a></div>';
  h += '<div class="sub"><b>TAT</b><div class="row" style="margin-top:6px"><label>Normal<input data-k="tatv" type="number" step="any" min="0" value="' + esc(tat.value) + '" style="width:80px"></label><label>Urgent<input data-k="tatu" type="number" step="any" min="0" value="' + esc(tat.urgent == null ? '' : tat.urgent) + '" style="width:80px" placeholder="same"></label><label>Unit' + seg('tatUnit', [{ v: 'days', l: 'Working days' }, { v: 'hours', l: 'Hours' }], tat.unit || 'days') + '</label></div></div>';
  const stt = s.status || { type: 'manual' };
  h += '<div class="sub"><b>Closed by</b> ' + seg('statusType', [{ v: 'manual', l: 'Doer clicks Done' }, { v: 'auto', l: 'Another system' }], stt.type) +
    (stt.type === 'auto' ? '<div class="row" style="margin-top:6px"><label>Source<input data-k="stSource" value="' + esc(stt.source || '') + '"></label><label style="flex:1">Rule<input data-k="stRule" value="' + esc(stt.rule || '') + '"></label></div>' : '') + '</div>';
  if (edit) h += '<div class="sub toolbar"><button class="btn sm" data-act="bld-move" data-d="-1">↑ Up</button><button class="btn sm" data-act="bld-move" data-d="1">↓ Down</button><span class="grow"></span><button class="btn sm danger" data-act="bld-del" data-confirm="Confirm delete">Delete step</button></div>';
  el.innerHTML = h;
  if (!edit) $$('input,select,textarea,.seg', el).forEach(x => { if (x.classList.contains('seg')) x.setAttribute('data-locked', ''); else x.disabled = true; });
}
function bldCollect() {
  const s = curStep(); const el = $('#bEd'); if (!s || !el) return;
  const val = k => { const i = $('[data-k="' + k + '"]', el); return i ? i.value : undefined; };
  s.name = val('name').trim(); const w = val('what').trim(); if (w) s.what = w; else delete s.what;
  const dt = segVal($('[data-seg="doerType"]', el));
  if (dt === 'fixed') s.doer = { type: 'fixed', name: (val('doerName') || '').trim().toUpperCase() };
  else if (dt === 'lookup') s.doer = { type: 'lookup', table: (val('doerTable') || '').trim(), by: val('doerBy') || (bldFields()[0] || {}).key, default: (val('doerDefault') || '').trim() || undefined };
  else { let rules = []; try { rules = JSON.parse(val('doerRules') || '[]'); } catch (e) { rules = (s.doer && s.doer.rules) || []; } s.doer = { type: 'byCondition', rules, default: (val('doerDefault') || '').trim() || undefined }; }
  if (segVal($('[data-seg="appliesMode"]', el)) === 'when') { const c = readCond($('[data-cond="applies"]', el)); s.applies = c && !c.__bad ? c : (c && c.__bad ? s.applies : { field: (bldFields(['select'])[0] || {}).key, in: [] }); }
  else delete s.applies;
  const cands = $$('.cand', el).map((c, j) => {
    const t = { type: segVal($('[data-seg="trigType"]', c)) };
    const st = $('[data-t="step"]', c), fd = $('[data-t="field"]', c);
    if (t.type === 'afterStep') t.step = st ? st.value : ''; if (['beforeDate', 'afterDate', 'external'].includes(t.type)) t.field = fd ? fd.value : '';
    const tv = $('[data-t="tatv"]', c).value; if (tv !== '') t.tat = { value: num(tv), unit: (s.tat || {}).unit || 'days' };
    if ($('[data-t="useWhen"]', c).checked) { const cw = readCond($('[data-cond="cand-' + j + '"]', c)); t.when = cw && !cw.__bad ? cw : { field: (bldFields(['select'])[0] || {}).key, in: [] }; }
    const on = $('[data-t="orNext"]', c); if (on && on.checked) t.orNext = true;
    return t;
  });
  s.trigger = cands.length === 1 ? cands[0] : cands;
  const tu = val('tatu'); s.tat = { value: num(val('tatv')), unit: segVal($('[data-seg="tatUnit"]', el)) || 'days' }; if (tu !== '' && tu != null) s.tat.urgent = num(tu);
  if (segVal($('[data-seg="statusType"]', el)) === 'auto') s.status = { type: 'auto', source: val('stSource') != null ? val('stSource').trim() : (s.status && s.status.source) || '', rule: val('stRule') != null ? val('stRule').trim() : (s.status && s.status.rule) || '' };
  else delete s.status;
}
function bldEditAllowed() { return requirePerm('builder', 'edit'); }
ACTIONS['bld-tab'] = el => { B.tab = el.dataset.t; VIEWS.builder.render(); };
ACTIONS['bld-sel'] = el => { if ($('#bEd')) bldCollect(); B.sel = el.dataset.s; bldEditor(); bldSide(); };
ACTIONS['bld-add'] = () => {
  if (!bldEditAllowed()) return; bldCollect();
  const last = B.draft.steps[B.draft.steps.length - 1]; let id = 'step_' + (B.draft.steps.length + 1); while (B.draft.steps.some(s => s.id === id)) id += 'x';
  B.draft.steps.push({ id, name: 'New step', doer: { type: 'fixed', name: '' }, trigger: last ? { type: 'afterStep', step: last.id } : { type: 'instanceStart' }, tat: { value: 1, unit: 'days' } });
  B.sel = id; B.dirty = true; VIEWS.builder.render(); const n = $('[data-k="name"]'); if (n) { n.focus(); n.select(); }
};
ACTIONS['bld-move'] = el => { bldCollect(); const i = B.draft.steps.findIndex(s => s.id === B.sel); const j = i + num(el.dataset.d); if (j < 0 || j >= B.draft.steps.length) return; const a = B.draft.steps; [a[i], a[j]] = [a[j], a[i]]; B.dirty = true; VIEWS.builder.render(); };
ACTIONS['bld-del'] = () => {
  const i = B.draft.steps.findIndex(s => s.id === B.sel); if (i < 0) return;
  B.draft.steps.splice(i, 1); B.sel = (B.draft.steps[Math.max(0, i - 1)] || {}).id; B.dirty = true; VIEWS.builder.render();
};
ACTIONS['cand-add'] = () => { bldCollect(); const s = curStep(); const t = (Array.isArray(s.trigger) ? s.trigger : [s.trigger]).filter(Boolean); t.push({ type: 'afterStep', step: '' }); s.trigger = t; if (!bldMarkDirty()) { bldEditor(); bldSide(); } };
ACTIONS['cand-del'] = el => { bldCollect(); const s = curStep(); const t = (Array.isArray(s.trigger) ? s.trigger : [s.trigger]); t.splice(+el.dataset.j, 1); s.trigger = t.length === 1 ? t[0] : t; if (!bldMarkDirty()) { bldEditor(); bldSide(); } };
ACTIONS['cond-add'] = el => {
  bldCollect(); const s = curStep(); const key = el.dataset.cond; const f = (bldFields(['select'])[0] || {}).key; const leaf = { field: f, in: [] };
  const add = c => { const rs = condToRows(c) || { join: 'all', rows: [] }; rs.rows.push(leafRow(leaf)); return rowsToCond(rs.join, rs.rows); };
  if (key === 'applies') s.applies = add(s.applies);
  else { const j = +key.split('-')[1]; const t = Array.isArray(s.trigger) ? s.trigger[j] : s.trigger; t.when = add(t.when); }
  if (!bldMarkDirty()) { bldEditor(); bldSide(); }
};
ACTIONS['cond-del'] = el => { el.closest('.condrow').remove(); bldCollect(); if (!bldMarkDirty()) { bldEditor(); bldSide(); } };
ACTIONS['bld-discard'] = () => { bldLoad(B.pid); VIEWS.builder.render(); };
ACTIONS['bld-save'] = () => {
  if (!bldEditAllowed()) return; if ($('#bEd')) bldCollect();
  const v = validateSpec(B.draft); if (v.errors.length) { flash('Fix ' + v.errors.length + ' error(s) first.', 'err'); return; }
  const proc = Store.get('processes', B.pid); const max = Math.max(...Store.all('processes').filter(p => p.code === proc.code).map(p => p.version));
  const np = Store.put('processes', { id: uid(), code: proc.code, version: max + 1, name: B.draft.process.name, spec: clone(B.draft), active: false, created_at: nowIso(), created_by: ME.name });
  audit('fms.version', proc.code + ' v' + np.version, 'Saved from v' + proc.version);
  B.pid = np.id; B.dirty = false; flash('Saved as v' + np.version + '. It is not live yet — click Activate when ready.'); VIEWS.builder.render();
};
ACTIONS['bld-activate'] = () => {
  if (!bldEditAllowed()) return;
  const p = Store.get('processes', B.pid);
  Store.all('processes').filter(x => x.code === p.code && x.active && x.id !== p.id).forEach(x => { x.active = false; Store.put('processes', x); });
  p.active = true; Store.put('processes', p); audit('fms.activate', p.code + ' v' + p.version, '');
  flash('v' + p.version + ' is live. New orders use it; existing orders stay on the version they started with.'); VIEWS.builder.render();
};

/* ---------- simulate ---------- */
function bldSim() {
  const d = B.draft;
  if (!B.sim) { const n = new Date(); n.setSeconds(0, 0); B.sim = { start: ymdOf(n) + 'T' + String(n.getHours()).padStart(2, '0') + ':' + String(n.getMinutes()).padStart(2, '0'), fields: { delivery_date: ymdOf(new Date(Date.now() + 10 * 86400000)) } }; }
  const S = B.sim; const spec = Object.assign({}, d, { calendar: calendar() });
  const fields = Object.assign({ created_at: new Date(S.start).toISOString() }, S.fields);
  const actuals = {}; let res;
  try {
    for (let pass = 0; pass < d.steps.length + 2; pass++) {
      res = FMSEngine.resolveInstance(spec, { fields, actuals }, new Date(S.start)); let ch = false;
      res.order.forEach(id => { const s = res.steps[id]; if (s.applies && s.planned && !actuals[id]) { actuals[id] = s.planned; ch = true; } });
      if (!ch) break;
    }
    res = FMSEngine.resolveInstance(spec, { fields, actuals }, new Date(S.start));
  } catch (e) { $('#bSim').innerHTML = '<div class="panel">Cannot simulate: ' + esc(e.message) + '</div>'; return; }
  const c = calendar();
  let h = '<div class="panel" style="margin-bottom:10px"><div class="row"><label>Order punched at<input id="simStart" type="datetime-local" value="' + esc(S.start) + '"></label>' +
    bldFields(['select']).map(f => { const o = fieldOpts(f.key); if (!o.length || o.length > 6) return ''; if (S.fields[f.key] == null) S.fields[f.key] = f.key === 'priority' ? '' : o[0]; return '<label>' + esc(f.label) + seg('sim_' + f.key, (f.key === 'priority' ? [{ v: '', l: 'Normal' }] : []).concat(o.map(x => ({ v: x, l: x }))), S.fields[f.key]) + '</label>'; }).join('') +
    bldFields(['date']).map(f => '<label>' + esc(f.label) + '<input type="date" data-simf="' + esc(f.key) + '" value="' + esc(S.fields[f.key] || '') + '"></label>').join('') + '</div>' +
    '<div class="muted small" style="margin-top:8px">Office ' + esc(c.open) + '–' + esc(c.close) + ', lunch ' + esc(c.lunchStart) + '–' + esc(c.lunchEnd) + ', off: ' + (c.weeklyOff || []).map(i => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][i]).join(', ') + ', half days: ' + esc(c.halfDays) + '. Har step apne planned time par done maana gaya hai.</div></div>';
  h += '<div class="tbl-wrap"><table><tr><th>Step</th><th>Doer</th><th>Starts</th><th>TAT</th><th>Due</th></tr>' + res.order.map(id => {
    const s = res.steps[id]; const def = d.steps.find(x => x.id === id);
    if (!s.applies) return '<tr class="muted"><td>' + esc(s.name) + '</td><td colspan="4">Not applicable</td></tr>';
    const t = s.trigger; const tat = t && (t.tat || def.tat);
    return '<tr><td>' + esc(s.name) + '</td><td>' + esc(s.doer || '') + '</td><td class="small">' + esc(describeTrigger(t)) + '</td><td class="nowrap">' + esc(tat ? (fields.priority === 'Urgent' && tat.urgent != null ? tat.urgent : tat.value) + (tat.unit === 'hours' ? ' h' : ' d') : '') + '</td><td class="nowrap"><b>' + fmtDT(s.planned) + '</b></td></tr>';
  }).join('') + '</table></div>';
  $('#bSim').innerHTML = h;
  $('#simStart').addEventListener('change', e => { S.start = e.target.value; bldSim(); });
  $$('[data-simf]').forEach(i => i.addEventListener('change', e => { S.fields[e.target.dataset.simf] = e.target.value; bldSim(); }));
}

/* ---------- fields & JSON ---------- */
function bldFieldsTab() {
  const d = B.draft; const edit = can('builder', 'edit');
  let h = '<div class="grid2"><div><h2 style="margin-top:0">Order fields</h2><div class="muted small" style="margin-bottom:6px">Fields with source <b>form</b> appear on the Punch Order screen. System fields are filled automatically.</div><div class="tbl-wrap"><table><tr><th>Key</th><th>Label</th><th>Type</th><th>Options (comma)</th><th>Source</th><th></th></tr>' +
    d.fields.map((f, i) => { const sys = CORE_FIELDS.includes(f.key); return '<tr data-fi="' + i + '"><td class="mono">' + esc(f.key) + '</td><td><input data-ff="label" value="' + esc(f.label) + '"' + (edit ? '' : ' disabled') + '></td><td>' + (sys ? esc(f.type) : '<select data-ff="type"' + (edit ? '' : ' disabled') + '>' + ['text', 'number', 'date', 'select'].map(t => '<option' + (t === f.type ? ' selected' : '') + '>' + t + '</option>').join('') + '</select>') + '</td>' +
      '<td>' + (f.type === 'select' ? '<input data-ff="options" value="' + esc((f.options || []).filter(o => o !== '').join(', ')) + '"' + (edit && f.key !== 'priority' ? '' : ' disabled') + '>' : '') + '</td><td>' + esc(f.source || 'form') + '</td><td>' + (!sys && edit ? '<button class="btn ghost sm danger" data-act="fld-del" data-i="' + i + '" data-confirm="Delete?">×</button>' : '') + '</td></tr>'; }).join('') + '</table></div>' +
    (edit ? '<div class="row" style="margin-top:8px"><label>New field label<input id="nfLabel" placeholder="e.g. Brand"></label><button class="btn" data-act="fld-add">Add field</button></div>' : '') + '</div>';
  h += '<div><h2 style="margin-top:0">Full flow JSON</h2><div class="muted small" style="margin-bottom:6px">Doer tables, complex rules and everything else. Apply → then Save as new version.</div><textarea id="specJson" rows="26" class="mono"' + (edit ? '' : ' readonly') + '>' + esc(JSON.stringify(d, null, 2)) + '</textarea>' +
    (edit ? '<div class="toolbar" style="margin-top:6px"><button class="btn" data-act="json-apply">Apply JSON</button><button class="btn" data-act="json-dl">Download</button><span id="jsonMsg" class="small"></span></div>' : '') + '</div></div>';
  $('#bFields').innerHTML = h;
  $('#bFields').addEventListener('change', e => {
    const tr = e.target.closest('tr[data-fi]'); if (!tr || !e.target.dataset.ff) return;
    const f = d.fields[+tr.dataset.fi]; const k = e.target.dataset.ff;
    if (k === 'options') f.options = e.target.value.split(',').map(s => s.trim()).filter(Boolean); else f[k] = e.target.value;
    if (k === 'type' && f.type === 'select' && !f.options) f.options = [];
    if (k === 'type' && f.type !== 'select') delete f.options;
    B.dirty = true; VIEWS.builder.render();
  });
}
ACTIONS['fld-add'] = () => {
  const l = $('#nfLabel').value.trim(); if (!l) return; let key = slug(l); while (B.draft.fields.some(f => f.key === key)) key += '_2';
  B.draft.fields.push({ key, label: l, type: 'text', source: 'form' }); B.dirty = true; VIEWS.builder.render();
};
ACTIONS['fld-del'] = el => { B.draft.fields.splice(+el.dataset.i, 1); B.dirty = true; VIEWS.builder.render(); };
ACTIONS['json-apply'] = () => {
  let spec; try { spec = JSON.parse($('#specJson').value); } catch (e) { $('#jsonMsg').innerHTML = '<span class="late-txt">Invalid JSON: ' + esc(e.message) + '</span>'; return; }
  if (!spec.process || !Array.isArray(spec.steps) || !Array.isArray(spec.fields)) { $('#jsonMsg').innerHTML = '<span class="late-txt">Needs process, fields[] and steps[].</span>'; return; }
  B.draft = spec; B.dirty = true; if (!spec.steps.some(s => s.id === B.sel)) B.sel = (spec.steps[0] || {}).id;
  const v = validateSpec(spec); VIEWS.builder.render(); flash('JSON applied — ' + v.errors.length + ' error(s), ' + v.warns.length + ' warning(s). Save as new version to keep it.', v.errors.length ? 'err' : '');
};
ACTIONS['json-dl'] = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(B.draft, null, 2)], { type: 'application/json' })); a.download = B.draft.process.id + '-flow.json'; a.click(); };
