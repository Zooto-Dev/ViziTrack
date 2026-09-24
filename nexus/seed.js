/* Nexus 2.0 — first-run data: default O2D flow, roles, users, masters, demo orders. */
'use strict';
const DEFAULT_O2D_SPEC = {
  process: { id: 'o2d', name: 'Order to Dispatch', instanceLabel: 'Order', keyField: 'order_no', startEvent: 'Order punched', endStep: 'dispatch' },
  fields: [
    { key: 'created_at', label: 'Order punch time', type: 'datetime', source: 'system' },
    { key: 'order_no', label: 'Order No', type: 'text', source: 'system' },
    { key: 'customer', label: 'Customer', type: 'text', source: 'form' },
    { key: 'category', label: 'Order Type', type: 'select', options: ['Ready Stock', 'Make to Order'], source: 'form' },
    { key: 'payment_terms', label: 'Payment Terms', type: 'select', options: ['Advance', 'Credit'], source: 'form' },
    { key: 'priority', label: 'Priority', type: 'select', options: ['', 'Urgent', 'On Hold', 'Cancelled'], source: 'form' },
    { key: 'delivery_date', label: 'Delivery Date', type: 'date', source: 'form' },
    { key: 'qty', label: 'Total Qty', type: 'number', source: 'system' },
    { key: 'value', label: 'Order Value', type: 'number', source: 'system' }
  ],
  priority: { field: 'priority', urgent: ['Urgent'], hold: ['On Hold'], cancel: ['Cancelled'] },
  doerTables: {},
  steps: [
    { id: 'order_verify', name: 'Order Verification', what: 'Rate, qty, delivery date aur customer details check karo', doer: { type: 'fixed', name: 'SALES' }, trigger: { type: 'instanceStart' }, tat: { value: 2, unit: 'hours' } },
    { id: 'credit_check', name: 'Credit / Payment Approval', what: 'Credit limit aur outstanding check karke approve karo', applies: { field: 'payment_terms', in: ['Credit'] }, doer: { type: 'fixed', name: 'ACCOUNTS' }, trigger: { type: 'afterStep', step: 'order_verify' }, tat: { value: 4, urgent: 2, unit: 'hours' } },
    { id: 'planning', name: 'Production Planning', applies: { field: 'category', in: ['Make to Order'] }, doer: { type: 'fixed', name: 'PPC' },
      trigger: [{ type: 'afterStep', step: 'credit_check', when: { field: 'payment_terms', in: ['Credit'] } }, { type: 'afterStep', step: 'order_verify' }], tat: { value: 1, urgent: 0.5, unit: 'days' } },
    { id: 'material', name: 'Material Arrangement', what: 'BOM ke hisaab se material issue / purchase', applies: { field: 'category', in: ['Make to Order'] }, doer: { type: 'fixed', name: 'STORE' }, trigger: { type: 'afterStep', step: 'planning' }, tat: { value: 2, urgent: 1, unit: 'days' } },
    { id: 'production', name: 'Production', applies: { field: 'category', in: ['Make to Order'] }, doer: { type: 'fixed', name: 'PRODUCTION' }, trigger: { type: 'afterStep', step: 'material' }, tat: { value: 3, urgent: 2, unit: 'days' } },
    { id: 'qc', name: 'Quality Check', doer: { type: 'fixed', name: 'QC' },
      trigger: [{ type: 'afterStep', step: 'production', when: { field: 'category', in: ['Make to Order'] } }, { type: 'afterStep', step: 'credit_check', when: { field: 'payment_terms', in: ['Credit'] } }, { type: 'afterStep', step: 'order_verify' }], tat: { value: 4, unit: 'hours' } },
    { id: 'packing', name: 'Packing', doer: { type: 'fixed', name: 'DISPATCH' }, trigger: { type: 'afterStep', step: 'qc' }, tat: { value: 4, unit: 'hours' } },
    { id: 'labels', name: 'Labels & Packing List Ready', what: 'Delivery date se 2 din pehle ready', doer: { type: 'fixed', name: 'SALES' }, trigger: { type: 'beforeDate', field: 'delivery_date' }, tat: { value: 2, unit: 'days' } },
    { id: 'invoice', name: 'Invoice', doer: { type: 'fixed', name: 'ACCOUNTS' }, trigger: { type: 'afterStep', step: 'packing' }, tat: { value: 2, unit: 'hours' } },
    { id: 'dispatch', name: 'Dispatch', what: 'Dispatch screen se entry karo — poori qty jaane par step apne aap Done', doer: { type: 'fixed', name: 'DISPATCH' }, trigger: { type: 'afterStep', step: 'invoice' }, tat: { value: 4, unit: 'hours' }, status: { type: 'auto', source: 'Dispatch module', rule: 'Done when full order qty is dispatched' } }
  ]
};

const ALL_EDIT = () => Object.fromEntries(MODULES.map(m => [m.key, 'edit']));
function rolePerms(edit, view) { const p = {}; MODULES.forEach(m => p[m.key] = 'none'); view.forEach(k => p[k] = 'view'); edit.forEach(k => p[k] = 'edit'); return p; }
const WORK_VIEW = ['dashboard', 'orders', 'tracker', 'dispatch'];

function seedData(cloud) {
  const now = new Date();
  const base = {
    settings: {
      id: 'main', company: 'My Company', gstin: '', address: '',
      calendar: { open: '09:30', close: '18:30', lunchStart: '13:30', lunchEnd: '14:00', weeklyOff: [0], halfDays: 'exact' },
      holidays: [{ date: now.getFullYear() + '-10-02', name: 'Gandhi Jayanti' }]
    },
    roles: [
      { id: 'r_admin', name: 'Admin', system: true, perms: ALL_EDIT() },
      { id: 'r_manager', name: 'Manager', perms: rolePerms(['tasks', 'orders', 'dispatch', 'tracker', 'masters'], ['dashboard', 'builder', 'users', 'audit']) },
      { id: 'r_sales', name: 'Sales', perms: rolePerms(['tasks', 'orders', 'masters'], WORK_VIEW) },
      { id: 'r_accounts', name: 'Accounts', perms: rolePerms(['tasks'], WORK_VIEW.concat(['masters'])) },
      { id: 'r_ppc', name: 'PPC', perms: rolePerms(['tasks'], WORK_VIEW) },
      { id: 'r_store', name: 'Store', perms: rolePerms(['tasks'], WORK_VIEW) },
      { id: 'r_production', name: 'Production', perms: rolePerms(['tasks'], WORK_VIEW) },
      { id: 'r_qc', name: 'QC', perms: rolePerms(['tasks'], WORK_VIEW) },
      { id: 'r_dispatch', name: 'Dispatch', perms: rolePerms(['tasks', 'dispatch'], ['dashboard', 'orders', 'tracker']) },
      { id: 'r_viewer', name: 'Viewer', perms: rolePerms([], WORK_VIEW) }
    ],
    users: [], customers: [], items: [], processes: [], orders: [], dispatches: [], audit: []
  };
  const U = (name, email, role_id, doer) => ({ id: 'u_' + doer.toLowerCase(), name, email, role_id, doer, active: true, pin_seed: '1234', seed: !!cloud });
  base.users = cloud ? [U('Admin', 'admin@nexus.local', 'r_admin', 'ADMIN')] : [
    U('Admin', 'admin@nexus.local', 'r_admin', 'ADMIN'),
    U('Rahul (Sales)', 'sales@nexus.local', 'r_sales', 'SALES'),
    U('Neha (Accounts)', 'accounts@nexus.local', 'r_accounts', 'ACCOUNTS'),
    U('Amit (PPC)', 'ppc@nexus.local', 'r_ppc', 'PPC'),
    U('Suresh (Store)', 'store@nexus.local', 'r_store', 'STORE'),
    U('Vikas (Production)', 'production@nexus.local', 'r_production', 'PRODUCTION'),
    U('Kavita (QC)', 'qc@nexus.local', 'r_qc', 'QC'),
    U('Pintu (Dispatch)', 'dispatch@nexus.local', 'r_dispatch', 'DISPATCH')
  ];
  base.processes = [{ id: 'p_o2d_1', code: 'o2d', version: 1, name: DEFAULT_O2D_SPEC.process.name, spec: clone(DEFAULT_O2D_SPEC), active: true, created_at: now.toISOString(), created_by: 'system', note: 'Default flow' }];
  if (cloud) return base;

  base.customers = [
    { id: 'c1', code: 'C001', name: 'Metro Retail Pvt Ltd', city: 'Mumbai', gstin: '27AABCM1234F1Z5', phone: '9820000001', payment_terms: 'Credit' },
    { id: 'c2', code: 'C002', name: 'Sharma Footwear', city: 'Delhi', gstin: '07AAFPS5678K1Z2', phone: '9810000002', payment_terms: 'Advance' },
    { id: 'c3', code: 'C003', name: 'Style Hub', city: 'Jaipur', gstin: '08AAGCS9012L1Z8', phone: '9829000003', payment_terms: 'Credit' },
    { id: 'c4', code: 'C004', name: 'Walkwell Distributors', city: 'Lucknow', gstin: '09AABFW3456M1Z1', phone: '9839000004', payment_terms: 'Advance' },
    { id: 'c5', code: 'C005', name: 'Urban Steps', city: 'Pune', gstin: '27AACCU7890N1Z4', phone: '9890000005', payment_terms: 'Credit' }
  ];
  base.items = [
    ['FG-101', 'Men Casual Sneaker Black', 'PAIR', 'Shoes', 899], ['FG-102', 'Men Casual Sneaker White', 'PAIR', 'Shoes', 899],
    ['FG-201', 'Women Slider Pink', 'PAIR', 'Slider', 349], ['FG-202', 'Women Slider Black', 'PAIR', 'Slider', 349],
    ['FG-301', 'Kids Clog Blue', 'PAIR', 'Clogs', 299], ['FG-302', 'Kids Clog Yellow', 'PAIR', 'Clogs', 299],
    ['FG-401', 'Men Sports Shoe Grey', 'PAIR', 'Shoes', 1199], ['FG-501', 'EVA Flip Flop Navy', 'PAIR', 'Slider', 199]
  ].map((r, i) => ({ id: 'i' + (i + 1), code: r[0], name: r[1], uom: r[2], group: r[3], rate: r[4] }));

  // Demo orders at different stages, built with the real engine so planned/actual are consistent.
  DB = base;
  const hoursAgo = h => new Date(now.getTime() - h * 3600000);
  const plan = [
    { c: 'c1', cat: 'Make to Order', ago: 190, done: 5, lines: [['FG-101', 600], ['FG-102', 400]], dd: 6 },
    { c: 'c2', cat: 'Ready Stock', ago: 30, done: 4, lines: [['FG-201', 300]], dd: 2, dispatched: true },
    { c: 'c3', cat: 'Make to Order', ago: 96, done: 2, lines: [['FG-401', 250], ['FG-501', 500]], dd: 9, late: 1 },
    { c: 'c4', cat: 'Ready Stock', ago: 20, done: 1, lines: [['FG-301', 200], ['FG-302', 200]], dd: 3 },
    { c: 'c5', cat: 'Make to Order', ago: 50, done: 1, lines: [['FG-202', 800]], dd: 12, pri: 'Urgent' },
    { c: 'c1', cat: 'Ready Stock', ago: 3, done: 0, lines: [['FG-102', 120]], dd: 4 },
    { c: 'c3', cat: 'Ready Stock', ago: 40, done: 4, lines: [['FG-501', 1000]], dd: 1 }
  ];
  plan.forEach((p, n) => {
    const cu = base.customers.find(c => c.id === p.c);
    const created = hoursAgo(p.ago);
    const o = {
      id: 'o' + (n + 1), no: 'ORD-' + now.getFullYear() + '-' + String(n + 1).padStart(4, '0'), order_date: ymdOf(created),
      customer_id: cu.id, customer_name: cu.name, po_ref: 'PO/' + (4400 + n), category: p.cat, payment_terms: cu.payment_terms,
      priority: p.pri || '', delivery_date: ymdOf(new Date(now.getTime() + p.dd * 86400000)), remarks: '',
      lines: p.lines.map(([code, qty]) => { const it = base.items.find(i => i.code === code); return { item_code: code, item_name: it.name, uom: it.uom, qty, rate: it.rate }; }),
      process_id: 'p_o2d_1', actuals: {}, done_by: {}, created_at: created.toISOString(), created_by: 'Rahul (Sales)', updated_at: created.toISOString()
    };
    DB.orders.push(o);
    for (let k = 0; k < p.done; k++) {
      o.updated_at = uid(); RES_CACHE.clear();
      const r = resolveOrder(o);
      const next = r.order.map(id => r.steps[id]).filter(s => (s.status === 'Pending' || s.status === 'Late') && s.id !== 'dispatch' && s.id !== 'labels').sort((a, b) => a.planned - b.planned)[0];
      if (!next) break;
      let at = new Date(next.planned.getTime() + (p.late && k === p.done - 1 ? 26 : ((n + k) % 3)) * 3600000 * 0.4);
      at = calInfo().normalize(at);
      if (at > now) at = new Date(now.getTime() - 20 * 60000);
      o.actuals[next.id] = at.toISOString(); o.done_by[next.id] = 'seed';
    }
    if (p.dispatched) {
      ['packing', 'invoice'].forEach((id, j) => { if (!o.actuals[id]) o.actuals[id] = hoursAgo(4 - j).toISOString(); });
      o.actuals.dispatch = hoursAgo(1).toISOString();
      DB.dispatches.push({ id: 'd1', no: 'DSP-' + now.getFullYear() + '-0001', order_id: o.id, date: todayYmd(), lines: o.lines.map((l, idx) => ({ idx, qty: l.qty })), invoice_no: 'INV/1021', vehicle: 'DL01AB1234', transporter: 'VRL Logistics', lr_no: 'LR5521', by: 'Pintu (Dispatch)', at: hoursAgo(1).toISOString() });
    }
    o.updated_at = created.toISOString();
  });
  RES_CACHE.clear();
  base.audit.push({ id: uid(), at: now.toISOString(), user: 'system', action: 'seed', ref: '', detail: 'Demo data loaded' });
  return base;
}
