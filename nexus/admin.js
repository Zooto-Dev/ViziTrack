/* Nexus 2.0 — masters & admin: Customers, Items, Users, Roles, Settings, Audit. */
'use strict';

/* ---------- generic inline-edit master table ---------- */
const MT_UI = {};
function masterView(cfg) {
  const ui = MT_UI[cfg.col] || (MT_UI[cfg.col] = { q: '', paste: false });
  const edit = can(cfg.mod, 'edit'); const q = norm(ui.q);
  const rows = Store.all(cfg.col).filter(d => !q || norm(cfg.cols.map(c => d[c.k]).join(' ')).includes(q)).sort((a, b) => String(a[cfg.sort] || '').localeCompare(String(b[cfg.sort] || '')));
  const cell = (c, d) => {
    const v = d ? d[c.k] : (cfg.defaults || {})[c.k];
    if (!edit || (d && c.lock)) return '<td>' + esc(c.fmt ? c.fmt(v) : v) + '</td>';
    if (c.opts) return '<td><select data-c="' + c.k + '">' + c.opts().map(o => '<option value="' + esc(o.v) + '"' + (String(o.v) === String(v == null ? '' : v) ? ' selected' : '') + '>' + esc(o.l) + '</option>').join('') + '</select></td>';
    if (c.type === 'check') return '<td><input type="checkbox" data-c="' + c.k + '"' + (v !== false ? ' checked' : '') + '></td>';
    return '<td><input data-c="' + c.k + '" value="' + esc(v) + '"' + (c.type === 'number' ? ' type="number" step="any" class="right"' : '') + (c.w ? ' style="width:' + c.w + 'px"' : '') + (!d && c.ph ? ' placeholder="' + esc(c.ph) + '"' : '') + '></td>';
  };
  let h = '<h1>' + esc(cfg.title) + '</h1><div class="toolbar"><input id="mtQ" placeholder="Search…" value="' + esc(ui.q) + '"><span class="muted small">' + rows.length + ' record(s)' + (edit ? ' · edits save automatically' : '') + '</span><span class="grow"></span>' +
    (edit && cfg.paste ? '<button class="btn" data-act="mt-paste-toggle" data-col="' + cfg.col + '">Paste from Excel</button>' : '') + '<button class="btn" data-act="mt-csv" data-col="' + cfg.col + '">Export CSV</button></div>';
  if (edit && cfg.paste && ui.paste) h += '<div class="panel" style="margin-bottom:10px"><div class="small muted">Copy rows from Excel with columns: <b>' + cfg.cols.filter(c => !c.noPaste).map(c => c.l).join(' · ') + '</b>. Existing ' + esc(cfg.cols[0].l) + ' = update, new = add.</div><textarea id="mtPaste" rows="6" class="mono"></textarea><div class="toolbar" style="margin-top:6px"><button class="btn primary" data-act="mt-paste" data-col="' + cfg.col + '">Import</button></div></div>';
  h += '<div class="tbl-wrap"><table><tr>' + cfg.cols.map(c => '<th' + (c.type === 'number' ? ' class="num"' : '') + '>' + esc(c.l) + '</th>').join('') + '<th></th></tr>';
  if (edit) h += '<tr data-new="1" style="background:#fafbfc">' + cfg.cols.map(c => cell(c, null)).join('') + '<td><button class="btn sm primary" data-act="mt-add" data-col="' + cfg.col + '">Add</button></td></tr>';
  h += rows.map(d => '<tr data-id="' + esc(d.id) + '">' + cfg.cols.map(c => cell(c, d)).join('') + '<td class="right nowrap">' + (cfg.extra ? cfg.extra(d) : '') + (edit && (!cfg.canDelete || cfg.canDelete(d) === true) ? '<button class="btn ghost sm danger" data-act="mt-del" data-col="' + cfg.col + '" data-id="' + esc(d.id) + '" data-confirm="Delete?">×</button>' : '') + '</td></tr>').join('');
  h += (rows.length ? '' : '<tr><td colspan="' + (cfg.cols.length + 1) + '" class="empty">No records</td></tr>') + '</table></div>';
  const m = setMain(h); MT_CFG[cfg.col] = cfg;
  $('#mtQ').addEventListener('input', e => { ui.q = e.target.value; clearTimeout(ui.t); ui.t = setTimeout(() => { cfg.view.render(); const i = $('#mtQ'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); });
  m.addEventListener('change', e => {
    const tr = e.target.closest('tr[data-id]'); if (!tr || !e.target.dataset.c) return;
    const d = Store.get(cfg.col, tr.dataset.id); const k = e.target.dataset.c; const c = cfg.cols.find(x => x.k === k);
    let v = c.type === 'check' ? e.target.checked : c.type === 'number' ? num(e.target.value) : e.target.value.trim();
    if (c.upper) v = String(v).toUpperCase();
    const err = cfg.validate && cfg.validate(Object.assign({}, d, { [k]: v }), d);
    if (err) { flash(esc(err), 'err'); e.target.value = d[k] == null ? '' : d[k]; return; }
    const old = d[k]; d[k] = v; Store.put(cfg.col, d); if (cfg.after) cfg.after(d, k, old);
    audit(cfg.col + '.edit', d[cfg.cols[0].k], c.l + ': ' + (c.secret ? '•••' : (old == null ? '' : old) + ' → ' + v));
    flash('Saved.');
  });
}
const MT_CFG = {};
ACTIONS['mt-add'] = el => {
  const cfg = MT_CFG[el.dataset.col]; if (!requirePerm(cfg.mod, 'edit')) return; const tr = el.closest('tr');
  const d = Object.assign({ id: uid() }, cfg.defaults || {});
  cfg.cols.forEach(c => { const i = $('[data-c="' + c.k + '"]', tr); if (!i) return; let v = c.type === 'check' ? i.checked : c.type === 'number' ? num(i.value) : i.value.trim(); if (c.upper) v = String(v).toUpperCase(); d[c.k] = v; });
  const err = cfg.validate && cfg.validate(d, null); if (err) { flash(esc(err), 'err'); return; }
  if (cfg.beforeAdd) cfg.beforeAdd(d);
  Store.put(cfg.col, d); audit(cfg.col + '.create', d[cfg.cols[0].k], d[cfg.cols[1].k] || ''); flash('Added.'); cfg.view.render();
  const f = $('tr[data-new] input'); if (f) f.focus();
};
ACTIONS['mt-del'] = el => {
  const cfg = MT_CFG[el.dataset.col]; const d = Store.get(cfg.col, el.dataset.id);
  const why = cfg.inUse && cfg.inUse(d); if (why) { flash(esc(why), 'err'); return; }
  Store.del(cfg.col, d.id); audit(cfg.col + '.delete', d[cfg.cols[0].k], d[cfg.cols[1].k] || ''); cfg.view.render();
};
ACTIONS['mt-paste-toggle'] = el => { const ui = MT_UI[el.dataset.col]; ui.paste = !ui.paste; MT_CFG[el.dataset.col].view.render(); };
ACTIONS['mt-paste'] = el => {
  const cfg = MT_CFG[el.dataset.col]; const cols = cfg.cols.filter(c => !c.noPaste); let add = 0, upd = 0, bad = 0;
  $('#mtPaste').value.split(/\r?\n/).map(l => l.split('\t')).filter(r => r.join('').trim()).forEach(r => {
    const d0 = {}; cols.forEach((c, i) => { let v = (r[i] || '').replace(/\u00a0/g, ' ').trim(); if (c.type === 'number') v = num(v.replace(/,/g, '')); if (c.upper) v = String(v).toUpperCase(); d0[c.k] = v; });
    const key = cols[0].k; const ex = Store.all(cfg.col).find(x => norm(x[key]) === norm(d0[key]));
    const d = Object.assign(ex ? ex : Object.assign({ id: uid() }, cfg.defaults || {}), d0);
    if (!d[key] || (cfg.validate && cfg.validate(d, ex))) { bad++; return; }
    Store.put(cfg.col, d); ex ? upd++ : add++;
  });
  audit(cfg.col + '.import', '', add + ' added, ' + upd + ' updated'); MT_UI[cfg.col].paste = false;
  flash(add + ' added, ' + upd + ' updated' + (bad ? ', ' + bad + ' skipped (missing / invalid)' : '') + '.', bad ? 'err' : ''); cfg.view.render();
};
ACTIONS['mt-csv'] = el => { const cfg = MT_CFG[el.dataset.col]; downloadCsv(cfg.col + '-' + todayYmd() + '.csv', [cfg.cols.filter(c => !c.secret).map(c => c.l)].concat(Store.all(cfg.col).map(d => cfg.cols.filter(c => !c.secret).map(c => c.fmt ? c.fmt(d[c.k]) : d[c.k])))); };
function uniq(col, key, label) { return (d, old) => { if (!String(d[key] || '').trim()) return label + ' is required.'; if (Store.all(col).some(x => x.id !== d.id && norm(x[key]) === norm(d[key]))) return label + ' "' + d[key] + '" already exists.'; return ''; }; }

VIEWS.customers = {
  mod: 'masters', render() {
    masterView({
      col: 'customers', mod: 'masters', title: 'Customers', view: VIEWS.customers, sort: 'code', paste: true,
      cols: [{ k: 'code', l: 'Code', w: 80, upper: true, ph: 'C006' }, { k: 'name', l: 'Name', ph: 'Customer name' }, { k: 'city', l: 'City', w: 120 }, { k: 'gstin', l: 'GSTIN', w: 160, upper: true }, { k: 'phone', l: 'Phone', w: 120 },
        { k: 'payment_terms', l: 'Terms', opts: () => ['Advance', 'Credit'].map(v => ({ v, l: v })) }],
      defaults: { payment_terms: 'Advance' },
      validate: (d, old) => uniq('customers', 'code', 'Code')(d) || uniq('customers', 'name', 'Name')(d),
      inUse: d => Store.all('orders').some(o => o.customer_id === d.id) ? 'Customer has orders — cannot delete.' : ''
    });
  }
};
VIEWS.items = {
  mod: 'masters', render() {
    masterView({
      col: 'items', mod: 'masters', title: 'Items', view: VIEWS.items, sort: 'code', paste: true,
      cols: [{ k: 'code', l: 'Item code', w: 110, upper: true, ph: 'FG-601' }, { k: 'name', l: 'Item name', ph: 'Item name' }, { k: 'group', l: 'Group', w: 120 }, { k: 'uom', l: 'UOM', w: 70, upper: true }, { k: 'rate', l: 'Rate ₹', type: 'number', w: 100 }],
      defaults: { uom: 'PCS' },
      validate: (d, old) => uniq('items', 'code', 'Item code')(d) || uniq('items', 'name', 'Item name')(d),
      inUse: d => Store.all('orders').some(o => o.lines.some(l => l.item_code === d.code)) ? 'Item is used in orders — cannot delete.' : ''
    });
  }
};

/* ---------- users ---------- */
VIEWS.users = {
  mod: 'users', render() {
    masterView({
      col: 'users', mod: 'users', title: 'Users', view: VIEWS.users, sort: 'name',
      cols: [{ k: 'name', l: 'Name', ph: 'Full name' }, { k: 'email', l: 'Email (login)', ph: 'name@company.com' }, { k: 'role_id', l: 'Role', opts: () => Store.all('roles').map(r => ({ v: r.id, l: r.name })) },
        { k: 'doer', l: 'Doer name (FMS)', w: 130, upper: true, ph: 'e.g. SALES' }, { k: 'mobile', l: 'Mobile', w: 120 }, { k: 'active', l: 'Active', type: 'check' }].concat(CLOUD ? [] : [{ k: 'new_pin', l: 'Set PIN', w: 80, ph: '4+ digits', secret: true, noPaste: true }]),
      defaults: { role_id: 'r_viewer', active: true },
      validate: (d, old) => {
        const e = uniq('users', 'email', 'Email')(d); if (e) return e;
        if (!/^[^@\s]+@[^@\s]+$/.test(d.email)) return 'Enter a valid email.';
        if (old && old.id === ME.id && (d.active === false || d.role_id !== old.role_id)) return 'You cannot deactivate or change the role of your own account.';
        if (!old && !CLOUD && !(d.new_pin && d.new_pin.length >= 4)) return 'Set a PIN (4+ digits) for the new user.';
        if (d.new_pin && d.new_pin.length < 4) return 'PIN must be at least 4 characters.';
        return '';
      },
      beforeAdd: d => { d.email = norm(d.email); if (d.new_pin) { const p = d.new_pin; d.new_pin = ''; hashPin(d.email, p).then(hsh => { d.pin_hash = hsh; Store.put('users', d); }); } },
      after: (d, k) => { if (k === 'email') { d.email = norm(d.email); Store.put('users', d); } if (k === 'new_pin' && d.new_pin) { const p = d.new_pin; d.new_pin = ''; delete d.pin_seed; hashPin(d.email, p).then(hsh => { d.pin_hash = hsh; Store.put('users', d); VIEWS.users.render(); }); } },
      canDelete: d => d.id !== ME.id,
      inUse: d => d.id === ME.id ? 'You cannot delete yourself.' : ''
    });
    $('#main').insertAdjacentHTML('beforeend', '<div class="muted small" style="margin-top:8px">Doer name links a user to FMS steps — every step whose doer is e.g. <b>SALES</b> shows in My Tasks for all users with doer SALES. ' +
      (CLOUD ? 'Cloud mode: also create the login for this email in Supabase → Authentication → Users (Invite user).' : 'Local mode: users sign in with email + PIN.') + '</div>');
  }
};

/* ---------- roles & access matrix ---------- */
VIEWS.roles = {
  mod: 'roles', render() {
    const edit = can('roles', 'edit'); const roles = Store.all('roles');
    let h = '<h1>Roles &amp; Access</h1><div class="muted small" style="margin-bottom:8px">Click a cell to cycle <b>—</b> → <b>View</b> → <b>Edit</b>. Changes save immediately.</div>';
    h += '<div class="tbl-wrap"><table><tr><th>Module</th>' + roles.map(r => '<th class="nowrap">' + esc(r.name) + '<div class="muted small" style="font-weight:400">' + Store.all('users').filter(u => u.role_id === r.id).length + ' user(s)' + (edit && !r.system && !Store.all('users').some(u => u.role_id === r.id) ? ' · <a data-act="role-del" data-r="' + esc(r.id) + '" data-confirm="Delete?">delete</a>' : '') + '</div></th>').join('') + '</tr>' +
      MODULES.map(m => '<tr><td>' + esc(m.label) + (m.note ? '<div class="muted small">' + esc(m.note) + '</div>' : '') + '</td>' + roles.map(r => {
        const p = r.system ? 'edit' : ((r.perms || {})[m.key] || 'none');
        const txt = p === 'edit' ? '<b style="color:var(--accent)">Edit</b>' : p === 'view' ? 'View' : '<span class="muted">—</span>';
        return '<td' + (edit && !r.system ? ' class="click" data-act="perm" data-r="' + esc(r.id) + '" data-m="' + m.key + '" style="cursor:pointer"' : '') + '>' + txt + '</td>';
      }).join('') + '</tr>').join('') + '</table></div>';
    if (edit) h += '<div class="row" style="margin-top:10px"><label>New role<input id="newRole" placeholder="e.g. Merchandiser"></label><label>Copy access from<select id="copyRole"><option value="">— none —</option>' + roles.map(r => '<option value="' + esc(r.id) + '">' + esc(r.name) + '</option>').join('') + '</select></label><button class="btn" data-act="role-add">Add role</button></div>';
    h += '<div class="muted small" style="margin-top:8px">Admin always has full access. Access is checked on every screen and every action.</div>';
    setMain(h);
  }
};
ACTIONS['perm'] = el => {
  if (!requirePerm('roles', 'edit')) return; const r = Store.get('roles', el.dataset.r); r.perms = r.perms || {};
  const cur = r.perms[el.dataset.m] || 'none'; const nx = { none: 'view', view: 'edit', edit: 'none' }[cur];
  r.perms[el.dataset.m] = nx; Store.put('roles', r); audit('role.perm', r.name, el.dataset.m + ': ' + cur + ' → ' + nx); VIEWS.roles.render(); renderNav();
};
ACTIONS['role-add'] = () => {
  const n = $('#newRole').value.trim(); if (!n) return;
  if (Store.all('roles').some(r => norm(r.name) === norm(n))) { flash('Role exists.', 'err'); return; }
  const src = Store.get('roles', $('#copyRole').value);
  Store.put('roles', { id: 'r_' + uid(), name: n, perms: src ? clone(src.system ? ALL_EDIT() : src.perms) : rolePerms([], ['dashboard']) }); audit('role.create', n, src ? 'copied from ' + src.name : ''); VIEWS.roles.render();
};
ACTIONS['role-del'] = el => { const r = Store.get('roles', el.dataset.r); Store.del('roles', r.id); audit('role.delete', r.name, ''); VIEWS.roles.render(); };

/* ---------- settings ---------- */
VIEWS.settings = {
  mod: 'settings', render() {
    const s = settings(); const c = s.calendar; const edit = can('settings', 'edit'); const dis = edit ? '' : ' disabled';
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    let h = '<h1>Settings</h1><div class="grid2"><div>';
    h += '<div class="panel"><h2 style="margin-top:0">Company</h2><div class="row"><label style="flex:1">Company name<input data-s="company" value="' + esc(s.company) + '"' + dis + '></label><label>GSTIN<input data-s="gstin" value="' + esc(s.gstin) + '"' + dis + '></label></div><label style="margin-top:8px">Address<input data-s="address" value="' + esc(s.address) + '"' + dis + '></label></div>';
    h += '<div class="panel" style="margin-top:12px"><h2 style="margin-top:0">Working calendar (used for every TAT &amp; delay)</h2><div class="row">' +
      [['open', 'Office opens'], ['close', 'Office closes'], ['lunchStart', 'Lunch from'], ['lunchEnd', 'Lunch to']].map(([k, l]) => '<label>' + l + '<input type="time" data-cal="' + k + '" value="' + esc(c[k]) + '"' + dis + '></label>').join('') + '</div>' +
      '<div style="margin-top:10px"><span class="muted small">Weekly off</span><div class="row" style="margin-top:4px">' + days.map((d, i) => '<label style="flex-direction:row;align-items:center;gap:4px;min-width:0"><input type="checkbox" data-off="' + i + '"' + ((c.weeklyOff || []).includes(i) ? ' checked' : '') + dis + '>' + d + '</label>').join('') + '</div></div>' +
      '<div style="margin-top:10px"><span class="muted small">Half-day TAT (1.5 days)</span><div style="margin-top:4px">' + seg('halfDays', [{ v: 'exact', l: 'Exact — 1.5 days = 1.5 × office hours' }, { v: 'truncate', l: 'Sheet style — 1.5 → 1 day' }], c.halfDays, edit ? '' : 'data-locked') + '</div></div></div>';
    h += '<div class="panel" style="margin-top:12px"><h2 style="margin-top:0">Data</h2><div class="toolbar"><button class="btn" data-act="backup">Download full backup (JSON)</button>' +
      (edit ? '<label class="btn" style="flex-direction:row;color:var(--text)">Restore backup<input type="file" id="restoreFile" accept=".json,application/json" class="hidden"></label>' : '') +
      (edit && !CLOUD ? '<button class="btn danger" data-act="reset-demo" data-confirm="Erase all & reload demo?">Reset to demo data</button>' : '') + '</div>' +
      '<div class="muted small">Mode: <b>' + (CLOUD ? 'Cloud (Supabase) — data shared by all users' : 'Local — data is saved in this browser only. Fill config.js to go multi-user.') + '</b> · Build ' + NEXUS_BUILD + '</div></div>';
    h += '</div><div><div class="panel"><h2 style="margin-top:0">Holidays</h2><div class="tbl-wrap"><table><tr><th>Date</th><th>Name</th><th></th></tr>' +
      (s.holidays || []).slice().sort((a, b) => a.date < b.date ? -1 : 1).map(x => '<tr><td>' + esc(fmtD(x.date)) + ' <span class="muted small">' + esc(days[new Date(x.date + 'T00:00').getDay()]) + '</span></td><td>' + esc(x.name) + '</td><td class="right">' + (edit ? '<button class="btn ghost sm danger" data-act="hol-del" data-d="' + esc(x.date) + '">×</button>' : '') + '</td></tr>').join('') + '</table></div>' +
      (edit ? '<div class="row" style="margin-top:8px"><label>Date<input id="holD" type="date"></label><label style="flex:1">Name<input id="holN" placeholder="Diwali"></label><button class="btn" data-act="hol-add">Add</button></div>' : '') + '</div></div></div>';
    const m = setMain(h);
    if (!edit) return;
    m.addEventListener('change', e => {
      const t = e.target; const st = settings();
      if (t.dataset.s) { st[t.dataset.s] = t.value.trim(); }
      else if (t.dataset.cal) { if (!/^\d\d:\d\d$/.test(t.value)) return; st.calendar[t.dataset.cal] = t.value; }
      else if (t.dataset.off != null) { st.calendar.weeklyOff = $$('[data-off]').filter(x => x.checked).map(x => +x.dataset.off); if (st.calendar.weeklyOff.length > 5) { flash('At least 2 working days needed.', 'err'); return VIEWS.settings.render(); } }
      else if (t.id === 'restoreFile') return restoreBackup(t.files[0]);
      else return;
      const cc = st.calendar; if (!(cc.open < cc.lunchStart && cc.lunchStart <= cc.lunchEnd && cc.lunchEnd < cc.close)) { flash('Timings must be: open < lunch from ≤ lunch to < close.', 'err'); return; }
      Store.setSettings(st); audit('settings.edit', '', t.dataset.s || t.dataset.cal || 'weekly off'); flash('Saved. Planned times recalculated.');
    });
    onSeg(e => { if (e.target.dataset.seg === 'halfDays') { const st = settings(); st.calendar.halfDays = e.detail; Store.setSettings(st); audit('settings.edit', '', 'halfDays → ' + e.detail); flash('Saved.'); } });
  }
};
ACTIONS['hol-add'] = () => {
  const d = $('#holD').value, n = $('#holN').value.trim(); if (!d) return flash('Pick a date.', 'err');
  const st = settings(); st.holidays = (st.holidays || []).filter(x => x.date !== d).concat([{ date: d, name: n || 'Holiday' }]);
  Store.setSettings(st); audit('holiday.add', d, n); VIEWS.settings.render();
};
ACTIONS['hol-del'] = el => { const st = settings(); st.holidays = st.holidays.filter(x => x.date !== el.dataset.d); Store.setSettings(st); audit('holiday.delete', el.dataset.d, ''); VIEWS.settings.render(); };
ACTIONS['backup'] = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(DB, null, 1)], { type: 'application/json' })); a.download = 'nexus-backup-' + todayYmd() + '.json'; a.click(); audit('backup', '', 'downloaded'); };
ACTIONS['reset-demo'] = () => { localStorage.removeItem(DB_KEY); localStorage.removeItem('nexus2_me'); location.reload(); };
function restoreBackup(file) {
  if (!file) return; const rd = new FileReader();
  rd.onload = () => {
    let data; try { data = JSON.parse(rd.result); } catch (e) { return flash('Not a valid backup file.', 'err'); }
    if (!data.settings || !Array.isArray(data.users) || !Array.isArray(data.orders)) return flash('Not a Nexus backup.', 'err');
    if (!data.users.some(u => norm(u.email) === norm(ME.email))) return flash('Your email is not in this backup — restore refused so you do not lock yourself out.', 'err');
    COLS.forEach(c => { (data[c] || []).forEach(d => Store.put(c, d)); (DB[c] || []).filter(d => !(data[c] || []).some(x => x.id === d.id)).forEach(d => Store.del(c, d.id)); });
    Store.setSettings(data.settings); audit('restore', '', file.name); flash('Backup restored.'); route();
  };
  rd.readAsText(file);
}

/* ---------- audit ---------- */
const AUD_UI = { q: '' };
VIEWS.audit = {
  mod: 'audit', render() {
    const q = norm(AUD_UI.q);
    const list = Store.all('audit').filter(a => !q || norm(a.user + ' ' + a.action + ' ' + a.ref + ' ' + a.detail).includes(q)).sort((a, b) => a.at < b.at ? 1 : -1);
    setMain('<h1>Audit Log</h1><div class="toolbar"><input id="audQ" placeholder="Search user / action / order…" value="' + esc(AUD_UI.q) + '"><span class="muted small">' + list.length + ' event(s)' + (list.length > 500 ? ', showing latest 500' : '') + '</span></div>' +
      '<div class="tbl-wrap"><table><tr><th>When</th><th>User</th><th>Action</th><th>Ref</th><th>Detail</th></tr>' + list.slice(0, 500).map(a => '<tr><td class="nowrap">' + fmtDT(a.at) + '</td><td>' + esc(a.user) + '</td><td class="mono">' + esc(a.action) + '</td><td>' + esc(a.ref) + '</td><td>' + esc(a.detail) + '</td></tr>').join('') + '</table></div>');
    $('#audQ').addEventListener('input', e => { AUD_UI.q = e.target.value; clearTimeout(AUD_UI.t); AUD_UI.t = setTimeout(() => { VIEWS.audit.render(); const i = $('#audQ'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); });
  }
};

boot();
