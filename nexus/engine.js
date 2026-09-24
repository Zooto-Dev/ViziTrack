/*
 * engine.js — reference implementation of an FMS (Flow Management System) engine.
 * Database-agnostic. Pure functions. Works in Node and the browser (no deps).
 *
 * Exposes:
 *   evalCondition(cond, fields)                 -> boolean
 *   resolveDoer(step, fields, spec)              -> string|null
 *   makeCalendar(spec.calendar)                  -> calendar helpers
 *   computePlanned(step, ctx, spec)              -> Date|null   (one step)
 *   resolveInstance(spec, instance, now)         -> { steps:{[id]:{doer,planned,actual,status,delayMinutes,applies,trigger}}, order:[ids] }
 *   layout(spec)                                 -> { nodes:[{id,rank,lane,x,y}], edges:[{from,to,kind}] }
 *
 * See references/process-spec.md for the spec shape and references/engine.md for the rules.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FMSEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- small date helpers (all local time) ----------
  const MIN = 60 * 1000;
  function hm(str) { const [h, m] = String(str).split(':').map(Number); return h * 60 + (m || 0); }
  function minutesOfDay(d) { return d.getHours() * 60 + d.getMinutes(); }
  function atMinutes(d, mins) { const x = new Date(d); x.setHours(Math.floor(mins / 60), mins % 60, 0, 0); return x; }
  function ymd(d) { const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function toDate(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date) return isNaN(v) ? null : new Date(v);
    const d = new Date(v); return isNaN(d) ? null : d;
  }

  // ---------- calendar ----------
  function makeCalendar(c) {
    c = c || {};
    const open = hm(c.open || '09:00'), close = hm(c.close || '17:30');
    const ls = hm(c.lunchStart || '13:00'), le = hm(c.lunchEnd || '14:00');
    const weeklyOff = new Set(c.weeklyOff || [0]);          // 0 = Sunday
    const holidays = new Set((c.holidays || []).map(String));
    const halfDays = c.halfDays || 'truncate';              // 'truncate' (sheet-compatible) | 'exact'
    const dayMinutes = (close - open) - Math.max(0, le - ls);

    const isWorkingDay = d => !weeklyOff.has(d.getDay()) && !holidays.has(ymd(d));
    function nextWorkingDay(d, dir = 1) { let x = addDays(d, dir); while (!isWorkingDay(x)) x = addDays(x, dir); return x; }

    // Sheet rule: keep time-of-day, then push into office hours.
    function normalize(d) {
      let t = minutesOfDay(d);
      if (t >= ls && t < le) t = le;
      if (t < open) return atMinutes(d, open);
      if (t > close) return atMinutes(nextWorkingDay(d, 1), open);
      if (!isWorkingDay(d)) return atMinutes(nextWorkingDay(d, 1), open);
      return atMinutes(d, t);
    }

    // WORKDAY.INTL semantics: integer days, weekends/holidays skipped, time-of-day kept.
    function addWorkDaysTrunc(start, n) {
      let d = new Date(start); let k = Math.trunc(n); const dir = k >= 0 ? 1 : -1;
      while (k !== 0) { d = nextWorkingDay(d, dir); k -= dir; }
      return normalize(d);
    }

    // Exact working-time arithmetic: n days = n * dayMinutes of office time.
    function addWorkMinutes(start, mins) {
      let d = normalize(start);
      if (mins <= 0) return d;
      let left = mins;
      while (left > 0) {
        let t = minutesOfDay(d);
        if (t < ls) {                       // morning block
          const room = ls - t;
          if (left <= room) return atMinutes(d, t + left);
          left -= room; d = atMinutes(d, le); continue;
        }
        const room = close - t;             // afternoon block
        if (left <= room) return atMinutes(d, t + left);
        left -= room; d = atMinutes(nextWorkingDay(d, 1), open);
      }
      return d;
    }
    function addWorkDaysExact(start, n) { return addWorkMinutes(start, Math.round(n * dayMinutes)); }

    function addTat(start, tat) {          // tat: {value, unit:'days'|'hours'}
      const unit = tat.unit || 'days';
      if (unit === 'hours') {
        if (halfDays === 'exact') return addWorkMinutes(start, Math.round(tat.value * 60));
        return normalize(new Date(start.getTime() + tat.value * 60 * MIN));   // sheet: clock hours, then normalize
      }
      return halfDays === 'exact' ? addWorkDaysExact(start, tat.value) : addWorkDaysTrunc(start, tat.value);
    }
    function subtractWorkDays(dateOnly, n) {   // backward from a date field; time-of-day of the field is kept
      return addWorkDaysTrunc(dateOnly, -Math.abs(n));
    }
    // Working minutes between two instants (for delay reporting).
    function workMinutesBetween(a, b) {
      if (b <= a) return 0;
      let total = 0; let d = normalize(a);
      while (d < b) {
        const t = minutesOfDay(d);
        const blockEnd = t < ls ? ls : close;
        const end = atMinutes(d, blockEnd);
        const stop = end < b ? end : b;
        total += Math.max(0, (stop - d) / MIN);
        d = end < b ? normalize(t < ls ? atMinutes(d, le) : atMinutes(nextWorkingDay(d, 1), open)) : b;
      }
      return Math.round(total);
    }
    return { open, close, ls, le, dayMinutes, halfDays, isWorkingDay, nextWorkingDay, normalize, addTat, subtractWorkDays, workMinutesBetween };
  }

  // ---------- conditions ----------
  function evalCondition(cond, fields) {
    if (!cond) return true;
    if (Array.isArray(cond)) return cond.every(c => evalCondition(c, fields));
    if (cond.all) return cond.all.every(c => evalCondition(c, fields));
    if (cond.any) return cond.any.some(c => evalCondition(c, fields));
    if (cond.not) return !evalCondition(cond.not, fields);
    const v = fields ? fields[cond.field] : undefined;
    const norm = x => (x == null ? '' : String(x).trim().toLowerCase());
    if ('in' in cond) return cond.in.map(norm).includes(norm(v));
    if ('notIn' in cond) return !cond.notIn.map(norm).includes(norm(v));
    if ('eq' in cond) return norm(v) === norm(cond.eq);
    if ('ne' in cond) return norm(v) !== norm(cond.ne);
    if ('empty' in cond) return (norm(v) === '') === !!cond.empty;
    return true;
  }

  // ---------- doer ----------
  function resolveDoer(step, fields, spec) {
    const rule = step.doer;
    if (!rule) return null;
    if (typeof rule === 'string') return rule;
    if (rule.type === 'fixed') return rule.name;
    if (rule.type === 'lookup') {
      const table = (spec.doerTables || {})[rule.table] || {};
      const key = String(fields[rule.by] == null ? '' : fields[rule.by]).trim().toLowerCase();
      const hit = Object.keys(table).find(k => k.trim().toLowerCase() === key);
      return hit ? table[hit] : (rule.default || null);
    }
    if (rule.type === 'byCondition') {
      const r = (rule.rules || []).find(r => evalCondition(r.when, fields));
      return r ? r.name : (rule.default || null);
    }
    return null;
  }

  // ---------- priority ----------
  function priorityState(spec, fields) {
    const p = spec.priority || {};
    const v = p.field ? String(fields[p.field] == null ? '' : fields[p.field]).trim() : '';
    const has = list => (list || []).map(s => s.toLowerCase()).includes(v.toLowerCase());
    return { frozen: has(p.hold) || has(p.cancel), cancelled: has(p.cancel), held: has(p.hold), urgent: has(p.urgent) };
  }

  // ---------- planned for one step ----------
  // ctx = { fields, actuals:{stepId:Date|null}, cal, pri }
  function pickTrigger(step, ctx) {
    const list = Array.isArray(step.trigger) ? step.trigger : [step.trigger];
    for (const t of list) {
      if (!t) continue;
      if (t.when && !evalCondition(t.when, ctx.fields)) continue;
      const src = triggerSource(t, ctx);
      if (src === undefined) continue;               // trigger type not applicable
      if (src === null && t.orNext) continue;        // source not yet available → try next candidate
      return { trigger: t, source: src };
    }
    return null;
  }
  function triggerSource(t, ctx) {
    switch (t.type) {
      case 'instanceStart': return toDate(ctx.fields[t.field || 'created_at']);
      case 'afterStep': return ctx.actuals[t.step] || null;
      case 'afterDate': case 'beforeDate': return toDate(ctx.fields[t.field]);
      case 'external': return toDate(ctx.fields[t.field]) || null;   // e.g. due date pulled from another system
      default: return undefined;
    }
  }
  function computePlanned(step, ctx, spec) {
    if (ctx.pri.frozen) return { planned: null, trigger: null, reason: ctx.pri.cancelled ? 'cancelled' : 'on-hold' };
    const pick = pickTrigger(step, ctx);
    if (!pick) return { planned: null, trigger: null, reason: 'no-trigger' };
    const { trigger: t, source } = pick;
    if (!source) return { planned: null, trigger: t, reason: 'waiting' };
    const tat = t.tat || step.tat || { value: 0, unit: 'days' };
    const value = ctx.pri.urgent && tat.urgent != null ? tat.urgent : tat.value;
    let planned;
    if (t.type === 'beforeDate') planned = ctx.cal.subtractWorkDays(source, value);
    else if (t.type === 'external' && !t.tat && !step.tat) planned = ctx.cal.normalize(source);
    else planned = ctx.cal.addTat(source, { value, unit: tat.unit || 'days' });
    return { planned, trigger: t, reason: 'ok' };
  }

  // ---------- whole instance ----------
  function topoOrder(spec) {
    const ids = spec.steps.map(s => s.id); const idx = new Map(ids.map((id, i) => [id, i]));
    const deps = id => { const s = spec.steps[idx.get(id)]; const list = Array.isArray(s.trigger) ? s.trigger : [s.trigger]; return list.filter(t => t && t.type === 'afterStep').map(t => t.step); };
    const seen = new Set(), out = [], stack = new Set();
    function visit(id) { if (seen.has(id)) return; if (stack.has(id)) throw new Error('cycle at ' + id); stack.add(id); deps(id).forEach(d => { if (idx.has(d)) visit(d); }); stack.delete(id); seen.add(id); out.push(id); }
    ids.forEach(visit); return out;
  }
  function resolveInstance(spec, instance, now) {
    now = now ? toDate(now) : new Date();
    const cal = makeCalendar(spec.calendar);
    const fields = Object.assign({}, instance.fields || {});
    if (!fields.created_at && instance.created_at) fields.created_at = instance.created_at;
    const pri = priorityState(spec, fields);
    const actuals = {}; Object.entries(instance.actuals || {}).forEach(([k, v]) => { actuals[k] = toDate(v); });
    const order = topoOrder(spec); const byId = Object.fromEntries(spec.steps.map(s => [s.id, s]));
    const out = {};
    for (const id of order) {
      const step = byId[id];
      const applies = evalCondition(step.applies, fields);
      const doer = resolveDoer(step, fields, spec);
      const actual = actuals[id] || null;
      let planned = null, trigger = null, reason = 'n/a';
      if (applies) ({ planned, trigger, reason } = computePlanned(step, { fields, actuals, cal, pri }, spec));
      let status;
      if (!applies) status = 'N/A';
      else if (pri.cancelled) status = 'Cancelled';
      else if (pri.held) status = 'On Hold';
      else if (actual) status = 'Done';
      else if (!planned) status = 'Waiting';
      else status = now > planned ? 'Late' : 'Pending';
      let delayMinutes = 0;
      if (applies && planned) {
        const end = actual || now;
        delayMinutes = end > planned ? cal.workMinutesBetween(planned, end) : 0;
      }
      out[id] = { id, name: step.name, doer, applies, planned, actual, status, delayMinutes, trigger, reason };
    }
    return { steps: out, order, priority: pri };
  }

  // ---------- layout for the flow chart ----------
  // rank = longest path from a root; lane groups date-driven / external steps away from the main chain.
  function layout(spec) {
    const ids = spec.steps.map(s => s.id); const byId = Object.fromEntries(spec.steps.map(s => [s.id, s]));
    const edges = [];
    spec.steps.forEach(s => { const list = Array.isArray(s.trigger) ? s.trigger : [s.trigger]; list.forEach((t, i) => { if (t && t.type === 'afterStep' && byId[t.step]) edges.push({ from: t.step, to: s.id, kind: i === 0 ? 'primary' : 'fallback' }); }); });
    const preds = id => edges.filter(e => e.to === id && e.kind === 'primary').map(e => e.from);
    const rank = {}; const order = topoOrder(spec);
    order.forEach(id => { const p = preds(id); rank[id] = p.length ? Math.max(...p.map(x => rank[x])) + 1 : 0; });
    const laneOf = id => { const s = byId[id]; const t = Array.isArray(s.trigger) ? s.trigger[0] : s.trigger; if (!t) return 'main'; if (t.type === 'beforeDate' || t.type === 'afterDate') return 'date'; if (t.type === 'external') return 'external'; const p = preds(id); return p.length ? laneOf(p[0]) : 'main'; };
    const lanes = { main: 0, external: 1, date: 2 };
    const perCol = {};
    const nodes = order.map(id => { const lane = laneOf(id); const col = rank[id]; const key = lane + ':' + col; perCol[key] = (perCol[key] || 0) + 1; return { id, name: byId[id].name, rank: col, lane, row: perCol[key] - 1 }; });
    const laneHeight = {}; nodes.forEach(n => { laneHeight[n.lane] = Math.max(laneHeight[n.lane] || 0, n.row + 1); });
    const yOffset = {}; let acc = 0; ['main', 'external', 'date'].forEach(l => { yOffset[l] = acc; acc += (laneHeight[l] || 0); });
    nodes.forEach(n => { n.x = n.rank; n.y = yOffset[n.lane] + n.row; });
    return { nodes, edges, lanes };
  }

  return { evalCondition, resolveDoer, makeCalendar, computePlanned, resolveInstance, layout, priorityState, topoOrder, _util: { toDate, ymd } };
});
