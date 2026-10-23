/* 家计簿 — offline bookkeeping web app. Data lives only in this browser (localStorage). */
'use strict';
(() => {
  const APP_VERSION = '1.0.2';
  const STORE_KEY = 'kakeibo:data';
  const PREV_KEY = 'kakeibo:data:prev';
  const UI_KEY = 'kakeibo:ui';

  /* ================= helpers ================= */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const pad2 = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const todayStr = () => ymd(new Date());
  const curMonth = () => todayStr().slice(0, 7);
  const addMonths = (ym, n) => {
    let y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7)) + n;
    y += Math.floor((m - 1) / 12);
    m = (((m - 1) % 12) + 12) % 12 + 1;
    return `${y}-${pad2(m)}`;
  };
  const monthEnd = (ym) => `${ym}-${pad2(new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate())}`;
  const monthsBetween = (a, b) => { const out = []; let m = a, g = 0; while (m <= b && g++ < 600) { out.push(m); m = addMonths(m, 1); } return out; };
  const ymLabel = (ym) => `${ym.slice(0, 4)}年${Number(ym.slice(5, 7))}月`;
  const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const parseYMD = (s) => new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  const dayDiff = (s) => Math.round((parseYMD(s) - parseYMD(todayStr())) / 86400000);
  const dayLabel = (s) => {
    const d = parseYMD(s), dd = dayDiff(s);
    const base = `${d.getMonth() + 1}月${d.getDate()}日 ${WEEK[d.getDay()]}`;
    return dd === 0 ? `今天 · ${base}` : dd === -1 ? `昨天 · ${base}` : dd === 1 ? `明天 · ${base}` : base;
  };
  const shortDate = (s) => { const d = parseYMD(s), dd = dayDiff(s); const md = `${d.getMonth() + 1}/${d.getDate()} ${WEEK[d.getDay()]}`; return dd === 0 ? `今天 ${md}` : dd === -1 ? `昨天 ${md}` : md; };
  const fmt = (n) => Math.abs(Math.round(n)).toLocaleString('ja-JP');
  const yen = (n) => (n < 0 ? '−¥' : '¥') + fmt(n);
  const yenSigned = (n) => (n > 0 ? '+¥' : n < 0 ? '−¥' : '¥') + fmt(n);
  const pct = (v, t) => (t ? (v / t) * 100 : 0).toFixed(1) + '%';
  const trimNum = (x) => String(x >= 100 ? Math.round(x) : Math.round(x * 10) / 10);
  const compact = (n) => {
    const a = Math.abs(n), s = n < 0 ? '−' : '';
    if (a >= 1e8) return s + trimNum(a / 1e8) + '亿';
    if (a >= 1e4) return s + trimNum(a / 1e4) + '万';
    return s + Math.round(a).toLocaleString('ja-JP');
  };
  const niceMax = (v) => {
    if (!(v > 0)) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
    return 10 * p;
  };
  const sum = (arr) => arr.reduce((a, b) => a + b, 0);

  const mqDark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const isDark = () => !!(mqDark && mqDark.matches);
  /* categorical slots 1–5 of the validated palette (light / dark steps) */
  const SERIES_L = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'];
  const SERIES_D = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181'];
  const series = () => (isDark() ? SERIES_D : SERIES_L);
  const otherGray = () => (isDark() ? '#5f5e58' : '#b4b2a9');

  /* card colours: dark steps (white text >= 4.5:1); chart: the same hue family from the validated slots */
  const ACC_TYPES = {
    bank: { name: '银行', color: '#b45700', icon: '🏦', slot: 1 },
    cash: { name: '现金', color: '#8a6100', icon: '💴', slot: 3 },
    ewallet: { name: '电子钱包', color: '#0d7a6e', icon: '📱', slot: 2 },
    credit: { name: '信用卡', color: '#1c7a41', icon: '💳', slot: null },
    securities: { name: '证券', color: '#2a66bd', icon: '📈', slot: 0 },
    other: { name: '其他', color: '#a8336b', icon: '🗂️', slot: 4 },
  };
  /* stacked-bar order follows the palette's validated adjacency (slot 1→5) */
  const COMP_ORDER = ['securities', 'bank', 'ewallet', 'cash', 'other'];
  const ACC_ORDER = ['bank', 'cash', 'ewallet', 'credit', 'securities', 'other'];
  const KIND_NAME = { out: '支出', in: '收入', move: '转移' };
  const EMOJIS = ['🍚', '🍜', '🍱', '☕', '🍺', '🍰', '🛒', '🧻', '🧴', '🎮', '🎬', '🎵', '📚', '✏️', '🚃', '🚕', '⛽', '✈️', '🏠', '🏦', '💡', '💧', '🔥', '📱', '💻', '👕', '💄', '💇', '💊', '🏥', '🏋️', '🎁', '🐶', '👶', '🧾', '☂️', '📦', '💴', '💰', '🎉', '📈', '🪙'];

  const DEFAULT_CATS = [
    ['餐饮', 'out', '🍚'], ['日用品', 'out', '🧻'], ['兴趣娱乐', 'out', '🎮'], ['交际', 'out', '🍻'], ['交通', 'out', '🚃'],
    ['服装美容', 'out', '👕'], ['健康医疗', 'out', '💊'], ['学习教育', 'out', '📚'], ['水电燃气', 'out', '💡'], ['通信', 'out', '📱'],
    ['住房', 'out', '🏠'], ['税金社保', 'out', '🧾'], ['保险', 'out', '☂️'], ['特别支出', 'out', '🎁'], ['其他支出', 'out', '📦'],
    ['工资', 'in', '💴'], ['奖金', 'in', '🎉'], ['副业', 'in', '💻'], ['投资收益', 'in', '📈'], ['其他收入', 'in', '💰'],
  ];
  const DEFAULT_ACCS = [['现金', 'cash'], ['银行账户', 'bank'], ['信用卡', 'credit'], ['电子钱包', 'ewallet']];

  /* ================= data ================= */
  function defaultData() {
    return {
      app: 'kakeibo', version: 1,
      categories: DEFAULT_CATS.map(([name, kind, icon]) => ({ id: uid(), name, kind, icon, hidden: false })),
      accounts: DEFAULT_ACCS.map(([name, type]) => ({ id: uid(), name, type, initial: 0, hidden: false })),
      entries: [],
      meta: { createdAt: new Date().toISOString(), lastBackup: null },
    };
  }
  const validData = (d) => !!(d && typeof d === 'object' && Array.isArray(d.categories) && Array.isArray(d.accounts) && Array.isArray(d.entries));
  function normalize(d) {
    const out = { app: 'kakeibo', version: 1 };
    out.meta = Object.assign({ createdAt: new Date().toISOString(), lastBackup: null }, d.meta || {});
    out.categories = d.categories.filter((c) => c && c.name).map((c) => ({
      id: String(c.id || uid()), name: String(c.name).slice(0, 20), kind: c.kind === 'in' ? 'in' : 'out',
      icon: String(c.icon || (c.kind === 'in' ? '💰' : '📦')).slice(0, 8), hidden: !!c.hidden,
    }));
    out.accounts = d.accounts.filter((a) => a && a.name).map((a) => ({
      id: String(a.id || uid()), name: String(a.name).slice(0, 24), type: ACC_TYPES[a.type] ? a.type : 'other',
      initial: Math.round(Number(a.initial) || 0), hidden: !!a.hidden,
    }));
    out.entries = d.entries
      .filter((e) => e && /^\d{4}-\d{2}-\d{2}$/.test(e.date) && Number(e.amount) > 0 && ['out', 'in', 'move'].includes(e.kind))
      .map((e) => ({
        id: String(e.id || uid()), date: e.date, amount: Math.round(Number(e.amount)), kind: e.kind,
        cat: e.kind === 'move' ? null : (e.cat ? String(e.cat) : null), acc: e.acc ? String(e.acc) : null,
        to: e.kind === 'move' && e.to ? String(e.to) : null, memo: String(e.memo || '').slice(0, 60), ts: Number(e.ts) || 0,
      }));
    return out;
  }
  function loadData() {
    for (const key of [STORE_KEY, PREV_KEY]) {
      try {
        const raw = localStorage.getItem(key);
        if (raw) { const d = JSON.parse(raw); if (validData(d)) return normalize(d); }
      } catch (e) { /* try next */ }
    }
    return null;
  }
  let persistAsked = false;
  function requestPersist() {
    if (persistAsked) return;
    persistAsked = true;
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) { /* ignore */ }
  }
  function saveData() {
    try {
      const cur = localStorage.getItem(STORE_KEY);
      if (cur) localStorage.setItem(PREV_KEY, cur);
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
      requestPersist();
      return true;
    } catch (e) {
      toast('保存失败：存储空间可能不足');
      return false;
    }
  }

  let data = loadData();
  if (!data) { data = defaultData(); saveData(); }
  let catIdx = new Map(), accIdx = new Map();
  function reindex() {
    catIdx = new Map(data.categories.map((c) => [c.id, c]));
    accIdx = new Map(data.accounts.map((a) => [a.id, a]));
  }
  reindex();

  /* ================= ui state ================= */
  function loadUI() { try { return JSON.parse(localStorage.getItem(UI_KEY) || '{}') || {}; } catch (e) { return {}; } }
  const savedUI = loadUI();
  const ui = {
    tab: 'home',
    month: curMonth(),
    compKind: savedUI.compKind === 'in' ? 'in' : 'out',
    trendCat: savedUI.trendCat || null,
    trendTip: null,
    lastAcc: savedUI.lastAcc && typeof savedUI.lastAcc === 'object' ? savedUI.lastAcc : {},
    lastAccAny: savedUI.lastAccAny || null,
    autoAdd: savedUI.autoAdd !== false,
    filter: { kind: 'all', cat: null, acc: null },
    setKind: 'out',
  };
  function saveUI() {
    try {
      localStorage.setItem(UI_KEY, JSON.stringify({
        compKind: ui.compKind, trendCat: ui.trendCat, lastAcc: ui.lastAcc, lastAccAny: ui.lastAccAny, autoAdd: ui.autoAdd,
      }));
    } catch (e) { /* ignore */ }
  }

  /* ================= aggregates ================= */
  const inMonth = (ym) => data.entries.filter((e) => e.date.slice(0, 7) === ym);
  const sumKind = (list, kind) => list.reduce((s, e) => s + (e.kind === kind ? e.amount : 0), 0);
  function startMonth() {
    let m = null;
    for (const e of data.entries) if (!m || e.date < m) m = e.date;
    return m ? m.slice(0, 7) : curMonth();
  }
  function catTotals(list, kind) {
    const m = new Map();
    for (const e of list) if (e.kind === kind) { const k = e.cat && catIdx.has(e.cat) ? e.cat : '_none'; m.set(k, (m.get(k) || 0) + e.amount); }
    return m;
  }
  const catOrder = (id) => { const i = data.categories.findIndex((c) => c.id === id); return i < 0 ? 999 : i; };
  /* colour follows the category: the 5 largest categories over all time own slots 1–5, the rest are "其他" */
  function colorSlots(kind) {
    const ranked = [...catTotals(data.entries, kind).entries()]
      .filter(([id]) => id !== '_none')
      .sort((a, b) => b[1] - a[1] || catOrder(a[0]) - catOrder(b[0]))
      .map(([id]) => id);
    const map = new Map();
    ranked.slice(0, 5).forEach((id, i) => map.set(id, i));
    return map;
  }
  function balances(through) {
    const b = new Map(data.accounts.map((a) => [a.id, a.initial]));
    for (const e of data.entries) {
      if (e.date > through) continue;
      if (e.kind === 'out') { if (b.has(e.acc)) b.set(e.acc, b.get(e.acc) - e.amount); }
      else if (e.kind === 'in') { if (b.has(e.acc)) b.set(e.acc, b.get(e.acc) + e.amount); }
      else {
        if (b.has(e.acc)) b.set(e.acc, b.get(e.acc) - e.amount);
        if (b.has(e.to)) b.set(e.to, b.get(e.to) + e.amount);
      }
    }
    return b;
  }
  const netOf = (b) => sum([...b.values()]);
  const cardUsage = (accId, ym) => data.entries.reduce((s, e) => s + (e.kind === 'out' && e.acc === accId && e.date.slice(0, 7) === ym ? e.amount : 0), 0);
  const cmpDesc = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.ts || 0) - (a.ts || 0));
  const usedAcc = (id) => data.entries.filter((e) => e.acc === id || e.to === id).length;
  const usedCat = (id) => data.entries.filter((e) => e.cat === id).length;
  const activeAccs = (keep) => data.accounts.filter((a) => !a.hidden || a.id === keep);
  const firstAcc = () => { const a = data.accounts.find((x) => !x.hidden); return a ? a.id : null; };

  /* ================= small components ================= */
  const header = (title, right = '') => `<header class="top"><h1>${title}</h1>${right}</header>`;
  const monthSwitcher = () => `<div class="month-sw"><button data-act="month" data-v="-1" aria-label="上个月">‹</button><button class="ms-label" data-act="month" data-v="0">${ymLabel(ui.month)}</button><button data-act="month" data-v="1" aria-label="下个月">›</button></div>`;
  const segmented = (name, opts, val) => `<div class="seg" role="tablist">${opts.map(([v, l]) => `<button class="${v === val ? 'on' : ''}" data-act="seg" data-seg="${name}" data-v="${v}" role="tab" aria-selected="${v === val}">${l}</button>`).join('')}</div>`;
  const chartW = () => Math.max(260, Math.min(528, $('#view').clientWidth || 360) - 64);

  function entryRow(e) {
    const c = e.cat ? catIdx.get(e.cat) : null;
    const a = accIdx.get(e.acc), t = accIdx.get(e.to);
    const future = e.date > todayStr();
    const fb = future ? '<span class="badge-future">预定</span>' : '';
    if (e.kind === 'move') {
      return `<button class="row ${future ? 'future' : ''}" data-act="edit" data-id="${e.id}"><span class="ic mv">⇄</span><span class="mid"><span class="title">${esc(e.memo || '转移')}${fb}</span><span class="rsub">${esc(a ? a.name : '（已删除）')} → ${esc(t ? t.name : '（已删除）')}</span></span><span class="amt mv">${yen(e.amount)}</span></button>`;
    }
    const title = e.memo || (c ? c.name : '未分类');
    const subParts = [];
    if (e.memo) subParts.push(c ? c.name : '未分类');
    subParts.push(a ? a.name : '（已删除账户）');
    return `<button class="row ${future ? 'future' : ''}" data-act="edit" data-id="${e.id}"><span class="ic">${esc(c ? c.icon : '❔')}</span><span class="mid"><span class="title">${esc(title)}${fb}</span><span class="rsub">${esc(subParts.join(' · '))}</span></span><span class="amt ${e.kind === 'in' ? 'in' : ''}">${e.kind === 'in' ? '+' : '−'}${yen(e.amount)}</span></button>`;
  }

  /* ================= charts (plain SVG) ================= */
  function arcPath(cx, cy, R, r, a0, a1) {
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (rad, a) => `${(cx + rad * Math.cos(a)).toFixed(2)} ${(cy + rad * Math.sin(a)).toFixed(2)}`;
    return `M ${p(R, a0)} A ${R} ${R} 0 ${large} 1 ${p(R, a1)} L ${p(r, a1)} A ${r} ${r} 0 ${large} 0 ${p(r, a0)} Z`;
  }
  function donutSVG(segs, total, kind) {
    const S = 188, R = 86, r = 58, cx = S / 2, cy = S / 2;
    let parts = '';
    if (segs.length === 1) {
      parts = `<circle cx="${cx}" cy="${cy}" r="${(R + r) / 2}" fill="none" stroke="${segs[0].color}" stroke-width="${R - r}"/>`;
    } else {
      let a0 = -Math.PI / 2;
      for (const s of segs) {
        const a1 = a0 + (s.v / total) * Math.PI * 2;
        parts += `<path class="seg-arc" d="${arcPath(cx, cy, R, r, a0, a1)}" fill="${s.color}"><title>${esc(s.name)} ${yen(s.v)}</title></path>`;
        a0 = a1;
      }
    }
    return `<svg class="donut" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}" role="img" aria-label="${KIND_NAME[kind]}构成">${parts}<text x="${cx}" y="${cy - 6}" class="d-cap" text-anchor="middle">${KIND_NAME[kind]}合计</text><text x="${cx}" y="${cy + 19}" class="d-val" text-anchor="middle">${yen(total)}</text></svg>`;
  }
  function roundTopBar(x, y, w, h) {
    if (h <= 0) return '';
    const rr = Math.min(4, w / 2, h);
    const b = y + h;
    return `M${x.toFixed(1)},${b.toFixed(1)}V${(y + rr).toFixed(1)}Q${x.toFixed(1)},${y.toFixed(1)} ${(x + rr).toFixed(1)},${y.toFixed(1)}H${(x + w - rr).toFixed(1)}Q${(x + w).toFixed(1)},${y.toFixed(1)} ${(x + w).toFixed(1)},${(y + rr).toFixed(1)}V${b.toFixed(1)}Z`;
  }
  function barsSVG(months, vals, avg, tipMonth) {
    const W = chartW(), H = 176, padL = 34, padR = 6, padT = 22, padB = 24;
    const n = months.length, slots = Math.max(n, 6);
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const band = plotW / slots, bw = Math.min(22, band * 0.62);
    const maxV = niceMax(Math.max(...vals, avg, 1));
    const y = (v) => padT + plotH - (v / maxV) * plotH;
    let g = '';
    for (const t of [0, maxV / 2, maxV]) {
      g += `<line class="${t === 0 ? 'base' : 'grid'}" x1="${padL}" x2="${W - padR}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/>`;
      g += `<text class="axis-t" x="${padL - 6}" y="${(y(t) + 3.5).toFixed(1)}" text-anchor="end">${t === 0 ? '0' : compact(t)}</text>`;
    }
    const tip = tipMonth && months.includes(tipMonth) ? tipMonth : months[n - 1];
    months.forEach((m, i) => {
      const slot = slots - n + i;
      const cx = padL + band * slot + band / 2;
      const x = cx - bw / 2;
      const v = vals[i];
      const isCur = i === n - 1;
      g += `<g data-act="bar" data-v="${m}"><rect class="hit" x="${(padL + band * slot).toFixed(1)}" y="0" width="${band.toFixed(1)}" height="${H}"/>`;
      if (v > 0) g += `<path class="${isCur ? 'bar-cur' : 'bar-past'}" d="${roundTopBar(x, y(v), bw, y(0) - y(v))}"/>`;
      g += `<text class="axis-m ${isCur ? 'cur' : ''}" x="${cx.toFixed(1)}" y="${H - 7}" text-anchor="middle">${Number(m.slice(5, 7))}月</text></g>`;
      if (m === tip) g += `<text class="val-t" x="${cx.toFixed(1)}" y="${(y(v) - 6).toFixed(1)}" text-anchor="middle">${compact(v)}</text>`;
    });
    if (avg > 0) {
      g += `<line class="avg" x1="${padL}" x2="${W - padR}" y1="${y(avg).toFixed(1)}" y2="${y(avg).toFixed(1)}"/>`;
    }
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="月度推移">${g}</svg>`;
  }
  function lineSVG(months, vals) {
    const W = chartW(), H = 160, padL = 40, padR = 14, padT = 22, padB = 24;
    const n = months.length;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const minV = Math.min(0, ...vals), maxV = niceMax(Math.max(...vals, 1));
    const lo = minV < 0 ? -niceMax(-minV) : 0;
    const y = (v) => padT + plotH - ((v - lo) / (maxV - lo)) * plotH;
    const x = (i) => padL + (n === 1 ? plotW / 2 : (plotW * i) / (n - 1));
    let g = '';
    const ticks = lo < 0 ? [lo, 0, maxV] : [0, maxV / 2, maxV];
    for (const t of ticks) {
      g += `<line class="${t === 0 ? 'base' : 'grid'}" x1="${padL}" x2="${W - padR}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/>`;
      g += `<text class="axis-t" x="${padL - 6}" y="${(y(t) + 3.5).toFixed(1)}" text-anchor="end">${t === 0 ? '0' : compact(t)}</text>`;
    }
    const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    g += `<path class="area" d="M${x(0).toFixed(1)},${y(Math.max(lo, 0)).toFixed(1)}L${pts.join('L')}L${x(n - 1).toFixed(1)},${y(Math.max(lo, 0)).toFixed(1)}Z"/>`;
    g += `<path class="line" d="M${pts.join('L')}"/>`;
    const step = n > 6 ? Math.ceil(n / 6) : 1;
    months.forEach((m, i) => {
      if (i % step === 0 || i === n - 1) g += `<text class="axis-m ${i === n - 1 ? 'cur' : ''}" x="${x(i).toFixed(1)}" y="${H - 7}" text-anchor="middle">${Number(m.slice(5, 7))}月</text>`;
    });
    const last = vals[n - 1];
    g += `<circle class="pt" cx="${x(n - 1).toFixed(1)}" cy="${y(last).toFixed(1)}" r="4.5"/>`;
    g += `<text class="val-t" x="${Math.min(x(n - 1), W - padR - 18).toFixed(1)}" y="${(y(last) - 10).toFixed(1)}" text-anchor="middle">${compact(last)}</text>`;
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="净资产推移">${g}</svg>`;
  }

  /* ================= views ================= */
  const view = $('#view');
  function render() {
    $$('.tabbar [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === ui.tab));
    const html = ui.tab === 'home' ? renderHome() : ui.tab === 'list' ? renderList() : ui.tab === 'assets' ? renderAssets() : renderSettings();
    view.innerHTML = html;
    if (ui.tab === 'settings') updatePersistState();
  }

  function backupDays() {
    const lb = data.meta.lastBackup;
    if (!lb) return null;
    return Math.max(0, Math.floor((Date.now() - new Date(lb).getTime()) / 86400000));
  }
  function topNotices() {
    if (!data.entries.length) {
      return `<section class="card welcome"><h2>👋 欢迎使用家计簿</h2><p>数据只保存在这台手机上，没网也能用。先在「设置」里把账户改成你自己的，填好现在的余额；有备份的话也可以直接导入。</p><div class="btn-pair"><button class="btn ghost" data-act="go-settings">设置账户</button><button class="btn primary" data-act="paste-import">导入备份</button></div></section>`;
    }
    const days = backupDays();
    if (data.entries.length >= 10 && (days === null || days >= 30)) {
      return `<section class="card nudge"><span class="nt">💾 ${days === null ? '还没有备份过' : `已经 ${days} 天没有备份了`}</span><button class="btn primary sm" data-act="export">备份</button></section>`;
    }
    return '';
  }

  function renderHome() {
    const ym = ui.month, prev = addMonths(ym, -1);
    const list = inMonth(ym), plist = inMonth(prev);
    const out = sumKind(list, 'out'), inc = sumKind(list, 'in');
    const pout = sumKind(plist, 'out'), pin = sumKind(plist, 'in');
    const net = inc - out, pnet = pin - pout;
    const label = ym === curMonth() ? '本月' : ymLabel(ym);
    return `${header('家计', monthSwitcher())}
      ${topNotices()}
      <section class="card">
        <div class="sum-label">${label}支出</div>
        <div class="hero">${yen(out)}</div>
        <div class="sub">上月 ${yen(pout)}</div>
        <div class="tiles">
          <div class="tile"><div class="t-label">收入</div><div class="t-val">${yen(inc)}</div><div class="t-sub">上月 ${yen(pin)}</div></div>
          <div class="tile"><div class="t-label">收支</div><div class="t-val ${net > 0 ? 'pos' : net < 0 ? 'neg' : ''}">${yenSigned(net)}</div><div class="t-sub">上月 ${yenSigned(pnet)}</div></div>
        </div>
      </section>
      ${compositionCard(list)}
      ${trendCard()}
      ${recentCard(list)}
      <div class="spacer"></div>`;
  }

  function compositionCard(list) {
    const kind = ui.compKind;
    const tot = catTotals(list, kind);
    const total = sum([...tot.values()]);
    const slots = colorSlots(kind);
    const pal = series();
    const rows = [...tot.entries()].sort((a, b) => b[1] - a[1]);
    const segs = [];
    let other = 0;
    for (const [id, v] of rows) {
      if (slots.has(id)) { const c = catIdx.get(id); segs.push({ id, v, name: c ? c.name : '未分类', color: pal[slots.get(id)] }); }
      else other += v;
    }
    if (other > 0) segs.push({ id: '_other', v: other, name: '其他', color: otherGray() });
    const rowHtml = rows.map(([id, v]) => {
      const c = catIdx.get(id);
      const color = slots.has(id) ? pal[slots.get(id)] : otherGray();
      const act = id === '_none' ? '' : `data-act="filter-cat" data-id="${id}"`;
      return `<button class="rank-row" ${act}><span class="dot" style="background:${color}"></span><span class="r-icon">${esc(c ? c.icon : '❔')}</span><span class="r-name">${esc(c ? c.name : '未分类')}</span><span class="r-pct">${pct(v, total)}</span><span class="r-amt">${yen(v)}</span><span class="chev">›</span></button>`;
    }).join('');
    return `<section class="card">
      <div class="card-head"><h2>${KIND_NAME[kind]}构成</h2>${segmented('comp', [['out', '支出'], ['in', '收入']], kind)}</div>
      ${total > 0 ? `<div class="donut-wrap">${donutSVG(segs, total, kind)}</div><div class="rank">${rowHtml}</div>` : `<div class="empty">这个月还没有${KIND_NAME[kind]}记录</div>`}
    </section>`;
  }

  function trendCard() {
    const kind = ui.compKind;
    const end = ui.month;
    let start = addMonths(end, -11);
    const sm = startMonth();
    if (sm > start) start = sm;
    if (start > end) start = end;
    const months = monthsBetween(start, end);
    const winTot = new Map();
    for (const e of data.entries) {
      const m = e.date.slice(0, 7);
      if (e.kind === kind && m >= start && m <= end && e.cat && catIdx.has(e.cat)) winTot.set(e.cat, (winTot.get(e.cat) || 0) + e.amount);
    }
    const opts = [...winTot.entries()].sort((a, b) => b[1] - a[1] || catOrder(a[0]) - catOrder(b[0])).map(([id]) => id);
    if (!opts.length) return '';
    const sel = ui.trendCat && opts.includes(ui.trendCat) ? ui.trendCat : opts[0];
    const c = catIdx.get(sel);
    const vals = months.map((m) => data.entries.reduce((s, e) => s + (e.kind === kind && e.cat === sel && e.date.slice(0, 7) === m ? e.amount : 0), 0));
    const recorded = months.filter((m) => data.entries.some((e) => e.date.slice(0, 7) === m));
    const recVals = months.map((m, i) => (recorded.includes(m) ? vals[i] : null)).filter((v) => v !== null);
    const avg = recVals.length ? sum(recVals) / recVals.length : 0;
    const tip = ui.trendTip && months.includes(ui.trendTip) ? ui.trendTip : end;
    const tipVal = vals[months.indexOf(tip)];
    const chips = opts.map((id) => { const x = catIdx.get(id); return `<button class="chip ${id === sel ? 'on' : ''}" data-act="trend-cat" data-id="${id}">${esc(x.icon)} ${esc(x.name)}</button>`; }).join('');
    const multi = months.length >= 2;
    return `<section class="card">
      <div class="card-head"><h2>${KIND_NAME[kind]}推移</h2>${multi ? '<span class="muted" style="font-size:12.5px">点柱子看金额</span>' : ''}</div>
      <div class="chips">${chips}</div>
      <div class="trend-top">
        <div><div class="t-label">${ymLabel(tip)} · ${esc(c.name)}</div><div class="t-big">${yen(tipVal)}</div></div>
        ${multi ? `<div class="avg-box"><div class="t-label">月平均（虚线）</div><div class="t-mid">${yen(avg)}</div></div>` : ''}
      </div>
      ${multi ? barsSVG(months, vals, avg, tip) : '<p class="hint">记满两个月后，这里会显示每个月的柱状图和月平均。</p>'}
    </section>`;
  }

  function recentCard(list) {
    const items = [...list].sort(cmpDesc).slice(0, 6);
    return `<section class="card">
      <div class="card-head"><h2>最近明细</h2><span class="muted" style="font-size:12.5px">${list.length} 笔</span></div>
      ${items.length ? `<div class="rows">${items.map(entryRow).join('')}</div>${list.length > items.length ? '<button class="more-link" data-act="go-list">查看全部明细 ›</button>' : ''}` : '<div class="empty">点下面的 ＋ 记第一笔</div>'}
    </section>`;
  }

  function renderList() {
    const ym = ui.month, f = ui.filter;
    let list = inMonth(ym);
    if (f.kind !== 'all') list = list.filter((e) => e.kind === f.kind);
    if (f.cat) list = list.filter((e) => e.cat === f.cat);
    if (f.acc) list = list.filter((e) => e.acc === f.acc || e.to === f.acc);
    list.sort(cmpDesc);
    const tags = [];
    if (f.cat) { const c = catIdx.get(f.cat); tags.push(`<button class="ftag" data-act="clear-filter">${esc(c ? c.icon + ' ' + c.name : '分类')} <b>✕</b></button>`); }
    if (f.acc) { const a = accIdx.get(f.acc); tags.push(`<button class="ftag" data-act="clear-filter">${esc(a ? a.name : '账户')} <b>✕</b></button>`); }
    const out = sumKind(list, 'out'), inc = sumKind(list, 'in');
    const groups = new Map();
    for (const e of list) { if (!groups.has(e.date)) groups.set(e.date, []); groups.get(e.date).push(e); }
    const days = [...groups.entries()].map(([d, arr]) => {
      const dOut = sumKind(arr, 'out'), dIn = sumKind(arr, 'in');
      const s = [dOut ? `支出 ${yen(dOut)}` : '', dIn ? `收入 ${yen(dIn)}` : ''].filter(Boolean).join(' · ');
      return `<div class="day"><div class="day-head"><span class="${dayDiff(d) === 0 ? 'today' : ''}">${dayLabel(d)}</span><span class="day-sum">${s}</span></div><div class="card"><div class="rows">${arr.map(entryRow).join('')}</div></div></div>`;
    }).join('');
    return `${header('明细', monthSwitcher())}
      <div class="filters">${segmented('listKind', [['all', '全部'], ['out', '支出'], ['in', '收入'], ['move', '转移']], f.kind)}${tags.join('')}</div>
      <div class="list-sum"><span>支出 <b>${yen(out)}</b></span><span>收入 <b>${yen(inc)}</b></span><span>${list.length} 笔</span></div>
      ${days || `<section class="card"><div class="empty">${ymLabel(ym)}没有符合条件的记录</div></section>`}`;
  }

  function accCard(a, v, cm) {
    const T = ACC_TYPES[a.type];
    if (a.type === 'credit') {
      const owe = -v;
      return `<button class="acc-card" style="--c:${T.color}" data-act="filter-acc" data-id="${a.id}"><div class="ac-top"><span class="ac-name">${esc(a.name)}</span><span class="ac-type">${T.name}</span></div><div class="ac-bal"><span class="ac-label">${owe >= 0 ? '待还' : '余额'}</span>${yen(Math.abs(owe))}</div><div class="ac-foot">本月刷卡 ${yen(cardUsage(a.id, cm))} · 上月 ${yen(cardUsage(a.id, addMonths(cm, -1)))}</div></button>`;
    }
    return `<button class="acc-card" style="--c:${T.color}" data-act="filter-acc" data-id="${a.id}"><div class="ac-top"><span class="ac-name">${esc(a.name)}</span><span class="ac-type">${T.name}</span></div><div class="ac-bal">${yen(v)}</div></button>`;
  }

  function renderAssets() {
    const t = todayStr(), cm = curMonth();
    const bal = balances(t);
    let assetSum = 0, debt = 0;
    for (const a of data.accounts) { const v = bal.get(a.id) || 0; if (a.type === 'credit') debt -= v; else assetSum += v; }
    const net = assetSum - debt;
    const sm = startMonth();
    const hasPrev = sm < cm;
    const pnet = hasPrev ? netOf(balances(monthEnd(addMonths(cm, -1)))) : null;
    const delta = hasPrev ? net - pnet : null;
    const future = data.entries.filter((e) => e.date > t).length;
    const shown = data.accounts.filter((a) => !a.hidden || (bal.get(a.id) || 0) !== 0);
    const groups = ACC_ORDER.map((type) => ({ type, list: shown.filter((a) => a.type === type) })).filter((g) => g.list.length);
    const cards = groups.map((g) => `<div class="acc-group"><div class="ag-title">${ACC_TYPES[g.type].name}</div>${g.list.map((a) => accCard(a, bal.get(a.id) || 0, cm)).join('')}</div>`).join('');

    const months = monthsBetween(sm > cm ? cm : sm, cm).slice(-12);
    const vals = months.map((m) => netOf(balances(m === cm ? t : monthEnd(m))));
    const trend = months.length >= 2
      ? lineSVG(months, vals)
      : `<div class="empty">从下个月开始，这里会显示每个月月底的净资产。</div>`;

    const byType = new Map();
    for (const a of data.accounts) {
      if (a.type === 'credit') continue;
      const v = bal.get(a.id) || 0;
      if (v > 0) byType.set(a.type, (byType.get(a.type) || 0) + v);
    }
    const compTotal = sum([...byType.values()]);
    const compTypes = COMP_ORDER.filter((tp) => byType.has(tp));
    const pal = series();
    const comp = compTotal > 0
      ? `<div class="stack" role="img" aria-label="资产构成">${compTypes.map((tp) => `<span style="flex:${byType.get(tp)};background:${pal[ACC_TYPES[tp].slot]}" title="${ACC_TYPES[tp].name}"></span>`).join('')}</div>
         ${compTypes.map((tp) => `<div class="legend-row"><span class="sw" style="background:${pal[ACC_TYPES[tp].slot]}"></span><span class="ln">${ACC_TYPES[tp].name}</span><span class="lp">${pct(byType.get(tp), compTotal)}</span><span class="lv">${yen(byType.get(tp))}</span></div>`).join('')}`
      : '<div class="empty">还没有正余额的账户</div>';

    return `${header('资产', `<span class="muted" style="font-size:13px">截至 ${shortDate(t)}</span>`)}
      <section class="card">
        <div class="sum-label">净资产（已扣信用卡待还）</div>
        <div class="hero-row"><div class="hero">${yen(net)}</div>${delta !== null ? `<span class="delta ${delta > 0 ? 'pos' : delta < 0 ? 'neg' : ''}">较上月底 ${yenSigned(delta)}</span>` : ''}</div>
        <div class="tiles">
          <div class="tile"><div class="t-label">资产</div><div class="t-val">${yen(assetSum)}</div></div>
          <div class="tile"><div class="t-label">负债（信用卡待还）</div><div class="t-val">${yen(debt)}</div></div>
        </div>
        ${future ? `<p class="hint">另有 ${future} 笔未来日期的记录，到那天才会计入余额。</p>` : ''}
      </section>
      ${cards || '<section class="card"><div class="empty">还没有账户，去「设置」添加</div></section>'}
      <section class="card"><div class="card-head"><h2>净资产推移</h2><span class="muted" style="font-size:12.5px">每月月底</span></div>${trend}</section>
      <section class="card"><div class="card-head"><h2>资产构成</h2></div>${comp}</section>
      <div class="spacer"></div>`;
  }

  function renderSettings() {
    const bal = balances(todayStr());
    const accRows = data.accounts.map((a) => {
      const T = ACC_TYPES[a.type];
      const cur = bal.get(a.id) ?? a.initial;
      const now = a.type === 'credit' && cur <= 0 ? `待还 ${yen(-cur)}` : `余额 ${yen(cur)}`;
      return `<button class="list-row" data-act="acc-edit" data-id="${a.id}"><i class="badge" style="background:${T.color}">${T.icon}</i><span class="lr-main"><span class="lr-title">${esc(a.name)}${a.hidden ? '<em class="tag">已停用</em>' : ''}</span><span class="lr-sub">${T.name} · ${now}</span></span><span class="chev">›</span></button>`;
    }).join('');
    const cats = data.categories.filter((c) => c.kind === ui.setKind);
    const catRows = cats.map((c) => `<button class="list-row" data-act="cat-edit" data-id="${c.id}"><i class="emoji">${esc(c.icon)}</i><span class="lr-main"><span class="lr-title">${esc(c.name)}${c.hidden ? '<em class="tag">已停用</em>' : ''}</span></span><span class="chev">›</span></button>`).join('');
    const days = backupDays();
    const bstate = days === null ? '还没有备份过' : `上次备份：<b>${days === 0 ? '今天' : days + ' 天前'}</b>`;
    return `${header('设置')}
      <section class="card"><div class="card-head"><h2>账户</h2><button class="text-btn strong" data-act="acc-edit">＋ 添加</button></div>
        <div class="list">${accRows || '<div class="empty">还没有账户</div>'}</div>
        <p class="hint">信用卡的余额是负数，表示还没还的钱。还卡时记一笔「转移」：转出选银行，转入选信用卡。</p>
      </section>
      <section class="card"><div class="card-head"><h2>分类</h2>${segmented('setKind', [['out', '支出'], ['in', '收入']], ui.setKind)}</div>
        <div class="list">${catRows || '<div class="empty">还没有分类</div>'}</div>
        <button class="btn ghost full" data-act="cat-edit">＋ 添加${KIND_NAME[ui.setKind]}分类</button>
      </section>
      <section class="card"><div class="card-head"><h2>使用习惯</h2></div>
        <label class="switch-row"><span>打开 App 时直接进入「记一笔」</span><input type="checkbox" data-input="autoadd" ${ui.autoAdd ? 'checked' : ''}></label>
      </section>
      <section class="card"><div class="card-head"><h2>备份</h2></div>
        <p class="backup-state">${bstate}</p>
        <div class="btn-col">
          <button class="btn primary full" data-act="export">导出备份文件</button>
          <button class="btn ghost full" data-act="copy-backup">复制备份文本</button>
          <label class="btn ghost full" for="file-in">从文件导入（备份 / CSV）</label>
          <button class="btn ghost full" data-act="paste-import">粘贴文本导入</button>
          <button class="btn ghost full" data-act="export-csv">导出明细 CSV</button>
        </div>
        <input type="file" id="file-in" accept=".json,.csv,.txt,application/json,text/csv,text/plain" hidden>
        <p class="hint">数据只保存在这台手机上。删掉主屏幕上的图标会连数据一起删掉，建议每个月导出一次备份，存到「ファイル」或网盘里。</p>
      </section>
      <section class="card about"><div>家计簿 · 版本 ${APP_VERSION}</div><div class="muted" id="persist-state"></div></section>`;
  }
  function updatePersistState() {
    const el = $('#persist-state');
    if (!el) return;
    try {
      if (navigator.storage && navigator.storage.persisted) {
        navigator.storage.persisted().then((p) => { if ($('#persist-state')) $('#persist-state').textContent = p ? '本机存储：已设为持久保存' : '本机存储：普通'; }).catch(() => {});
      }
    } catch (e) { /* ignore */ }
  }

  /* ================= sheets & dialogs ================= */
  const sheetRoot = $('#sheet-root');
  let sheetEl = null, sheetType = null, pendingReload = false;
  function openSheet(type, html, full) {
    sheetRoot.innerHTML = `<div class="sheet-backdrop" data-act="backdrop"></div><div class="sheet ${full ? 'full' : ''}" role="dialog" aria-modal="true">${html}</div>`;
    sheetRoot.classList.add('open');
    sheetEl = $('.sheet', sheetRoot);
    sheetType = type;
    void sheetRoot.offsetWidth;
    sheetRoot.classList.add('show');
  }
  function closeSheet() {
    if (!sheetRoot.classList.contains('open')) return;
    sheetRoot.classList.remove('show');
    sheetType = null;
    const el = sheetEl;
    setTimeout(() => {
      if (sheetEl !== el) return;
      sheetRoot.classList.remove('open');
      sheetRoot.innerHTML = '';
      sheetEl = null;
      if (pendingReload) location.reload();
    }, 220);
  }
  const modalRoot = $('#modal-root');
  function askConfirm(msg, okText = '确定', danger = false) {
    return new Promise((resolve) => {
      modalRoot.innerHTML = `<div class="modal-backdrop" data-m="0"></div><div class="modal" role="alertdialog" aria-modal="true"><div class="m-msg">${esc(msg)}</div><div class="m-btns"><button class="m-btn" data-m="0">取消</button><button class="m-btn ${danger ? 'danger' : 'strong'}" data-m="1">${esc(okText)}</button></div></div>`;
      modalRoot.classList.add('open');
      const onClick = (ev) => {
        const b = ev.target.closest('[data-m]');
        if (!b) return;
        ev.stopPropagation();
        modalRoot.removeEventListener('click', onClick);
        modalRoot.classList.remove('open');
        modalRoot.innerHTML = '';
        resolve(b.dataset.m === '1');
      };
      modalRoot.addEventListener('click', onClick);
    });
  }
  let toastTimer = null, toastFn = null;
  function toast(msg, action) {
    const el = $('#toast');
    el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button data-act="toast-action">${esc(action.label)}</button>` : ''}`;
    el.classList.add('show');
    toastFn = action ? action.fn : null;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.classList.remove('show'); toastFn = null; }, action ? 5000 : 2200);
  }
  function shake(el) { if (!el) return; el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }

  /* ================= entry sheet ================= */
  let draft = null;
  function openEntry(entry) {
    if (entry) {
      draft = { id: entry.id, kind: entry.kind, amt: String(entry.amount), cat: entry.cat, acc: entry.acc, to: entry.to, date: entry.date, memo: entry.memo || '' };
    } else {
      const acc = ui.lastAccAny && accIdx.has(ui.lastAccAny) && !accIdx.get(ui.lastAccAny).hidden ? ui.lastAccAny : firstAcc();
      draft = { id: null, kind: 'out', amt: '', cat: null, acc, to: null, date: todayStr(), memo: '' };
    }
    openSheet('entry', entryHTML(), true);
  }
  function renderEntry() { if (sheetEl && sheetType === 'entry') sheetEl.innerHTML = entryHTML(); }
  function accChips(field, selected, exclude) {
    const list = activeAccs(selected).filter((a) => a.id !== exclude || a.id === selected);
    if (!list.length) return '<div class="hint" style="margin:4px 4px 0">先在「设置」里添加账户</div>';
    return list.map((a) => { const T = ACC_TYPES[a.type]; return `<button class="acc-chip ${a.id === selected ? 'on' : ''}" data-act="pick-acc" data-field="${field}" data-id="${a.id}"><i style="background:${T.color}">${T.icon}</i>${esc(a.name)}</button>`; }).join('');
  }
  function entryHTML() {
    const d = draft;
    const kinds = [['out', '支出'], ['in', '收入'], ['move', '转移']].map(([v, l]) => `<button class="k-${v} ${d.kind === v ? 'on' : ''}" data-act="kind" data-v="${v}">${l}</button>`).join('');
    let body;
    if (d.kind === 'move') {
      body = `<div class="move-box"><div class="e-label">转出（钱从哪里出）</div><div class="acc-row" data-row="acc">${accChips('acc', d.acc, null)}</div><div class="move-arrow">↓</div><div class="e-label">转入（钱到哪里去）</div><div class="acc-row" data-row="to">${accChips('to', d.to, null)}</div></div>`;
    } else {
      const cats = data.categories.filter((c) => c.kind === d.kind && (!c.hidden || c.id === d.cat));
      body = cats.length
        ? `<div class="cat-grid">${cats.map((c) => `<button class="cat-cell ${c.id === d.cat ? 'on' : ''}" data-act="pick-cat" data-id="${c.id}"><span class="ce">${esc(c.icon)}</span><span class="cn">${esc(c.name)}</span></button>`).join('')}</div>`
        : '<div class="empty">先在「设置」里添加分类</div>';
    }
    const accRow = d.kind === 'move' ? '' : `<div class="e-label">${d.kind === 'in' ? '入账账户' : '支付方式'}</div><div class="acc-row" data-row="acc">${accChips('acc', d.acc, null)}</div>`;
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', 'del'].map((k) => `<button data-act="key" data-v="${k}" ${k === 'del' ? 'class="k-del" aria-label="删除"' : ''}>${k === 'del' ? '⌫' : k}</button>`).join('');
    return `<div class="entry">
      <div class="e-top"><button class="icon-btn" data-act="close-sheet" aria-label="关闭">✕</button><div class="e-title">${d.id ? '编辑' : '记一笔'}</div>${d.id ? '<button class="text-btn danger" data-act="del-entry">删除</button>' : '<span class="e-sp"></span>'}</div>
      <div class="kinds">${kinds}</div>
      <div class="amount k-${d.kind} ${d.amt ? '' : 'ph'}"><span class="cur">¥</span><span class="num">${d.amt ? Number(d.amt).toLocaleString('ja-JP') : '0'}</span></div>
      <div class="e-body">${body}</div>
      ${accRow}
      <div class="e-meta"><label class="date-chip">📅 <span class="date-text">${shortDate(d.date)}</span><input type="date" value="${d.date}" data-input="date" aria-label="日期"></label><input class="memo" type="text" placeholder="备注（可选）" value="${esc(d.memo)}" data-input="memo" maxlength="40" enterkeyhint="done"></div>
      <div class="keypad">${keys}</div>
      <div class="e-actions"><button class="btn ghost" data-act="save" data-v="cont">${d.id ? '取消' : '保存并继续'}</button><button class="btn primary" data-act="save">保存</button></div>
    </div>`;
  }
  function updateAmount() {
    const el = sheetEl && $('.amount', sheetEl);
    if (!el) return;
    $('.num', el).textContent = draft.amt ? Number(draft.amt).toLocaleString('ja-JP') : '0';
    el.classList.toggle('ph', !draft.amt);
  }
  function pressKey(k) {
    let s = draft.amt;
    if (k === 'del') s = s.slice(0, -1);
    else { s = (s + k).replace(/^0+/, ''); if (s.length > 10) return shake($('.amount', sheetEl)); }
    draft.amt = s;
    updateAmount();
  }
  function setChipOn(rowSel, attr, id) {
    $$(rowSel, sheetEl).forEach((b) => b.classList.toggle('on', b.dataset[attr] === id));
  }
  function saveDraft(cont) {
    const d = draft;
    const amount = parseInt(d.amt || '0', 10);
    if (!amount) { shake($('.amount', sheetEl)); return toast('请输入金额'); }
    if (d.kind !== 'move' && (!d.cat || !catIdx.has(d.cat))) { shake($('.e-body', sheetEl)); return toast('请选择分类'); }
    if (!d.acc || !accIdx.has(d.acc)) return toast(d.kind === 'move' ? '请选择转出账户' : '请选择账户');
    if (d.kind === 'move') {
      if (!d.to || !accIdx.has(d.to)) return toast('请选择转入账户');
      if (d.to === d.acc) return toast('转出和转入不能是同一个账户');
    }
    const existing = d.id ? data.entries.find((e) => e.id === d.id) : null;
    const rec = {
      id: d.id || uid(), date: d.date || todayStr(), amount, kind: d.kind,
      cat: d.kind === 'move' ? null : d.cat, acc: d.acc, to: d.kind === 'move' ? d.to : null,
      memo: (d.memo || '').trim(), ts: existing ? existing.ts : Date.now(),
    };
    if (existing) Object.assign(existing, rec); else data.entries.push(rec);
    ui.lastAccAny = d.kind === 'move' ? ui.lastAccAny : d.acc;
    if (d.kind !== 'move') ui.lastAcc[d.cat] = d.acc;
    saveUI();
    saveData();
    const c = catIdx.get(rec.cat);
    const what = rec.kind === 'move' ? `转移 ${yen(amount)}` : `${rec.kind === 'in' ? '+' : '−'}${yen(amount)} ${c ? c.name : ''}`;
    if (rec.date.slice(0, 7) !== ui.month) ui.month = rec.date.slice(0, 7);
    if (cont && !existing) {
      draft = { id: null, kind: d.kind, amt: '', cat: null, acc: d.acc, to: d.to, date: d.date, memo: '' };
      renderEntry();
      toast(`已记下 ${what}，继续记下一笔`);
    } else {
      closeSheet();
      toast(existing ? '已保存修改' : `已记下 ${what}`);
    }
    render();
  }
  async function deleteDraft() {
    const d = draft;
    if (!d || !d.id) return;
    const ok = await askConfirm('删除这条记录？', '删除', true);
    if (!ok) return;
    const i = data.entries.findIndex((e) => e.id === d.id);
    if (i < 0) return;
    const [removed] = data.entries.splice(i, 1);
    saveData();
    closeSheet();
    render();
    toast('已删除', { label: '撤销', fn: () => { data.entries.splice(i, 0, removed); saveData(); render(); toast('已恢复'); } });
  }

  /* ================= settings forms ================= */
  /* The account form asks for today's balance (what the bank / card app shows);
     the stored starting balance is solved from it so recorded entries stay as they are. */
  const balLabel = (credit) => (credit ? '现在的待还金额' : '现在的余额');
  const balHint = (credit) => (credit
    ? '打开信用卡 App，看现在还没还的金额，填正数。之后刷卡会自动累加，还卡时记一笔「转移」。'
    : '今天这个账户里实际有多少钱（看银行或钱包 App）。已经记过的收支会自动算进去。');
  function accFormHTML(a) {
    const isNew = !a;
    const x = a || { id: '', name: '', type: 'bank', initial: 0, hidden: false };
    const credit = x.type === 'credit';
    const cur = isNew ? 0 : (balances(todayStr()).get(x.id) ?? x.initial);
    const shown = credit ? -cur : cur;
    const initVal = shown ? (shown < 0 ? '-' : '') + fmt(shown) : '';
    return `<div class="form" data-type="${x.type}">
      <div class="f-top"><button class="icon-btn" data-act="close-sheet" aria-label="关闭">✕</button><div class="e-title">${isNew ? '添加账户' : '编辑账户'}</div><button class="text-btn strong" data-act="acc-save" data-id="${x.id}">保存</button></div>
      <div class="f-body">
        <label class="field"><span>名称</span><input type="text" id="f-name" value="${esc(x.name)}" maxlength="24" placeholder="例如：三菱UFJ銀行"></label>
        <div class="field"><span>类型</span><div class="type-grid">${ACC_ORDER.map((t) => `<button class="type-opt ${t === x.type ? 'on' : ''}" data-act="pick-type" data-v="${t}"><i style="background:${ACC_TYPES[t].color}">${ACC_TYPES[t].icon}</i>${ACC_TYPES[t].name}</button>`).join('')}</div></div>
        <label class="field"><span id="f-init-label">${balLabel(credit)}</span><input type="text" id="f-init" inputmode="numeric" value="${initVal}" placeholder="0"></label>
        <p class="hint" id="f-init-hint">${balHint(credit)}</p>
        ${isNew ? '' : `<label class="switch-row"><span>停用（不在选择列表里出现）</span><input type="checkbox" id="f-hidden" ${x.hidden ? 'checked' : ''}></label>
        <div class="f-row"><button class="btn ghost sm" data-act="move-item" data-what="acc" data-id="${x.id}" data-v="-1">上移</button><button class="btn ghost sm" data-act="move-item" data-what="acc" data-id="${x.id}" data-v="1">下移</button><span class="grow"></span><button class="btn ghost sm danger" data-act="acc-del" data-id="${x.id}">删除</button></div>`}
      </div>
    </div>`;
  }
  function catFormHTML(c) {
    const isNew = !c;
    const x = c || { id: '', name: '', kind: ui.setKind, icon: ui.setKind === 'in' ? '💰' : '📦', hidden: false };
    const kindLocked = !isNew && usedCat(x.id) > 0;
    return `<div class="form" data-kind="${x.kind}">
      <div class="f-top"><button class="icon-btn" data-act="close-sheet" aria-label="关闭">✕</button><div class="e-title">${isNew ? '添加分类' : '编辑分类'}</div><button class="text-btn strong" data-act="cat-save" data-id="${x.id}">保存</button></div>
      <div class="f-body">
        <div class="field"><span>收支</span>${kindLocked ? `<div class="muted">${KIND_NAME[x.kind]}（已有记录，不能更改）</div>` : `<div class="seg" id="f-kind">${[['out', '支出'], ['in', '收入']].map(([v, l]) => `<button class="${v === x.kind ? 'on' : ''}" data-act="pick-kind" data-v="${v}">${l}</button>`).join('')}</div>`}</div>
        <label class="field"><span>名称</span><input type="text" id="f-name" value="${esc(x.name)}" maxlength="20" placeholder="例如：咖啡"></label>
        <div class="field"><span>图标（点下面选，或输入任意表情）</span><div class="icon-input"><input type="text" id="f-icon" value="${esc(x.icon)}" maxlength="8"></div>
          <div class="emoji-grid">${EMOJIS.map((e) => `<button data-act="pick-emoji" data-v="${e}">${e}</button>`).join('')}</div></div>
        ${isNew ? '' : `<label class="switch-row"><span>停用（不在选择列表里出现）</span><input type="checkbox" id="f-hidden" ${x.hidden ? 'checked' : ''}></label>
        <div class="f-row"><button class="btn ghost sm" data-act="move-item" data-what="cat" data-id="${x.id}" data-v="-1">上移</button><button class="btn ghost sm" data-act="move-item" data-what="cat" data-id="${x.id}" data-v="1">下移</button><span class="grow"></span><button class="btn ghost sm danger" data-act="cat-del" data-id="${x.id}">删除</button></div>`}
      </div>
    </div>`;
  }
  function commit() { reindex(); saveData(); render(); }
  function saveAccForm(id) {
    const form = $('.form', sheetEl);
    const name = $('#f-name', sheetEl).value.trim();
    if (!name) { shake($('#f-name', sheetEl)); return toast('请输入名称'); }
    if (data.accounts.some((a) => a.name === name && a.id !== id)) return toast('已经有同名账户');
    const type = form.dataset.type;
    const str = ($('#f-init', sheetEl).value || '').trim();
    const n = (parseInt(str.replace(/[^\d]/g, ''), 10) || 0) * (/^[-−－]/.test(str) ? -1 : 1);
    const now = type === 'credit' ? -n : n;
    const moved = id ? (balances(todayStr()).get(id) ?? 0) - accIdx.get(id).initial : 0;
    const initial = now - moved;
    if (id) {
      const a = accIdx.get(id);
      Object.assign(a, { name, type, initial, hidden: $('#f-hidden', sheetEl) ? $('#f-hidden', sheetEl).checked : a.hidden });
    } else {
      data.accounts.push({ id: uid(), name, type, initial, hidden: false });
    }
    commit();
    closeSheet();
    toast('已保存');
  }
  function saveCatForm(id) {
    const form = $('.form', sheetEl);
    const name = $('#f-name', sheetEl).value.trim();
    const icon = $('#f-icon', sheetEl).value.trim() || '📦';
    const kind = form.dataset.kind === 'in' ? 'in' : 'out';
    if (!name) { shake($('#f-name', sheetEl)); return toast('请输入名称'); }
    if (data.categories.some((c) => c.name === name && c.kind === kind && c.id !== id)) return toast('已经有同名分类');
    if (id) {
      const c = catIdx.get(id);
      Object.assign(c, { name, icon, kind: usedCat(id) ? c.kind : kind, hidden: $('#f-hidden', sheetEl) ? $('#f-hidden', sheetEl).checked : c.hidden });
    } else {
      data.categories.push({ id: uid(), name, kind, icon, hidden: false });
    }
    ui.setKind = kind;
    commit();
    closeSheet();
    toast('已保存');
  }
  function moveItem(what, id, dir) {
    if (what === 'acc') {
      const arr = data.accounts, i = arr.findIndex((a) => a.id === id), j = i + dir;
      if (i < 0 || j < 0 || j >= arr.length) return;
      [arr[i], arr[j]] = [arr[j], arr[i]];
    } else {
      const arr = data.categories, i = arr.findIndex((c) => c.id === id);
      if (i < 0) return;
      const kind = arr[i].kind;
      let j = i + dir;
      while (j >= 0 && j < arr.length && arr[j].kind !== kind) j += dir;
      if (j < 0 || j >= arr.length) return;
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    commit();
    toast(dir < 0 ? '已上移' : '已下移');
  }
  async function deleteAcc(id) {
    const n = usedAcc(id);
    if (n) return toast(`有 ${n} 笔记录用到这个账户，不能删除，可以改成「停用」`);
    if (!(await askConfirm('删除这个账户？', '删除', true))) return;
    data.accounts = data.accounts.filter((a) => a.id !== id);
    commit();
    closeSheet();
  }
  async function deleteCat(id) {
    const n = usedCat(id);
    if (n) return toast(`有 ${n} 笔记录用到这个分类，不能删除，可以改成「停用」`);
    if (!(await askConfirm('删除这个分类？', '删除', true))) return;
    data.categories = data.categories.filter((c) => c.id !== id);
    commit();
    closeSheet();
  }

  /* ================= backup / import / export ================= */
  function backupJSON() {
    return JSON.stringify({ app: 'kakeibo', version: 1, exportedAt: new Date().toISOString(), categories: data.categories, accounts: data.accounts, entries: data.entries, meta: { createdAt: data.meta.createdAt } });
  }
  function markBackup() { data.meta.lastBackup = new Date().toISOString(); saveData(); render(); }
  function downloadBlob(text, name, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  async function shareFile(text, name, type) {
    try {
      const file = new File([text], name, { type });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: name });
        return true;
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return false;
    }
    downloadBlob(text, name, type);
    return true;
  }
  async function exportBackup() {
    const ok = await shareFile(backupJSON(), `kakeibo-backup-${todayStr()}.json`, 'application/json');
    if (ok) { markBackup(); toast('备份已导出'); }
  }
  async function copyBackup() {
    try {
      await navigator.clipboard.writeText(backupJSON());
      markBackup();
      toast('备份文本已复制，可以粘贴到备忘录或聊天里保存');
    } catch (e) {
      openPaste(backupJSON(), true);
    }
  }
  const csvCell = (v) => { const s = String(v == null ? '' : v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  async function exportCSV() {
    const rows = [['日期', '内容', '金额', '收支', '分类', '支付方式', '备注']];
    for (const e of [...data.entries].sort((a, b) => -cmpDesc(a, b))) {
      const a = accIdx.get(e.acc), t = accIdx.get(e.to), c = catIdx.get(e.cat);
      rows.push([e.date.replace(/-/g, '/'), e.memo, e.amount, KIND_NAME[e.kind], e.kind === 'move' ? (t ? t.name : '') : (c ? c.name : ''), a ? a.name : '', '']);
    }
    const csv = '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
    const ok = await shareFile(csv, `kakeibo-${todayStr()}.csv`, 'text/csv');
    if (ok) toast('CSV 已导出');
  }
  function parseCSV(text) {
    const rows = [];
    let row = [], f = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',' || ch === '\t') { row.push(f); f = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
      else f += ch;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    return rows;
  }
  function guessAccType(name) {
    if (/卡|card|カード/i.test(name)) return 'credit';
    if (/银行|銀行|bank|信金|信用金庫/i.test(name)) return 'bank';
    if (/现金|現金|cash|财布|財布/i.test(name)) return 'cash';
    if (/pay|suica|pasmo|icoca|waon|nanaco|aeon|edy|钱包|楽天|d払い/i.test(name)) return 'ewallet';
    if (/证券|証券|nisa|ideco|股/i.test(name)) return 'securities';
    return 'other';
  }
  function parseCSVImport(text) {
    const rows = parseCSV(text).map((r) => r.map((x) => x.trim())).filter((r) => r.some((x) => x));
    const hi = rows.findIndex((r) => r.includes('日期') && r.includes('金额'));
    if (hi < 0) throw new Error('CSV 里找不到「日期」「金额」这两列');
    const H = rows[hi];
    const col = (n) => H.indexOf(n);
    const iDate = col('日期'), iMemo = col('内容'), iAmt = col('金额'), iKind = col('收支'), iCat = col('分类'), iAcc = col('支付方式'), iNote = col('备注');
    const cats = data.categories.map((c) => ({ ...c })), accs = data.accounts.map((a) => ({ ...a }));
    const newCats = [], newAccs = [], entries = [];
    let skipped = 0;
    const findAcc = (name) => {
      if (!name) return null;
      let a = accs.find((x) => x.name === name);
      if (!a) { a = { id: uid(), name, type: guessAccType(name), initial: 0, hidden: false }; accs.push(a); newAccs.push(a); }
      return a.id;
    };
    const findCat = (name, kind) => {
      if (!name) return null;
      let c = cats.find((x) => x.name === name && x.kind === kind);
      if (!c) { c = { id: uid(), name, kind, icon: kind === 'in' ? '💰' : '📦', hidden: false }; cats.push(c); newCats.push(c); }
      return c.id;
    };
    for (const r of rows.slice(hi + 1)) {
      const m = /^(\d{4})\D(\d{1,2})\D(\d{1,2})/.exec(r[iDate] || '');
      const amt = Number(String(r[iAmt] || '').replace(/[^\d.\-]/g, ''));
      if (!m || !(amt > 0)) { skipped++; continue; }
      const date = `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
      const kt = iKind >= 0 ? r[iKind] : '';
      const catName = iCat >= 0 ? r[iCat] : '';
      let kind = kt === '收入' ? 'in' : kt === '转移' ? 'move' : kt === '支出' ? 'out' : null;
      if (!kind) kind = cats.some((c) => c.name === catName && c.kind === 'in') ? 'in' : 'out';
      const memo = [iMemo >= 0 ? r[iMemo] : '', iNote >= 0 ? r[iNote] : ''].filter(Boolean).join(' ');
      const accName = iAcc >= 0 ? r[iAcc] : '';
      if (kind === 'move') {
        if (!accName || !catName) { skipped++; continue; }
        entries.push({ id: uid(), date, amount: Math.round(amt), kind, cat: null, acc: findAcc(accName), to: findAcc(catName), memo, ts: 0 });
      } else {
        if (!accName) { skipped++; continue; }
        entries.push({ id: uid(), date, amount: Math.round(amt), kind, cat: findCat(catName || (kind === 'in' ? '其他收入' : '其他支出'), kind), acc: findAcc(accName), to: null, memo, ts: 0 });
      }
    }
    return { cats, accs, newCats, newAccs, entries, skipped };
  }
  async function importText(raw) {
    const text = String(raw || '').replace(/^﻿/, '').trim();
    if (!text) return toast('内容是空的');
    if (text[0] === '{') {
      let obj;
      try { obj = JSON.parse(text); } catch (e) { return toast('备份内容不完整，无法读取'); }
      if (!validData(obj)) return toast('这不是家计簿的备份');
      const nd = normalize(obj);
      const ok = await askConfirm(`用这个备份覆盖当前数据？\n备份里有 ${nd.entries.length} 笔记录、${nd.accounts.length} 个账户、${nd.categories.length} 个分类。`, '覆盖导入', true);
      if (!ok) return;
      nd.meta.lastBackup = new Date().toISOString();
      data = nd;
      reindex();
      saveData();
      closeSheet();
      ui.month = curMonth();
      ui.filter = { kind: 'all', cat: null, acc: null };
      ui.trendCat = null;
      ui.tab = 'home';
      render();
      toast(`已导入 ${nd.entries.length} 笔记录`);
      return;
    }
    let res;
    try { res = parseCSVImport(text); } catch (e) { return toast(e.message || 'CSV 格式不对'); }
    if (!res.entries.length) return toast('CSV 里没有可以导入的记录');
    const extra = res.newCats.length || res.newAccs.length ? `\n会新建 ${res.newCats.length} 个分类、${res.newAccs.length} 个账户。` : '';
    const ok = await askConfirm(`从 CSV 追加 ${res.entries.length} 笔记录？${extra}${res.skipped ? `\n有 ${res.skipped} 行看不懂，会跳过。` : ''}`, '追加导入');
    if (!ok) return;
    data.categories = res.cats;
    data.accounts = res.accs;
    data.entries.push(...res.entries);
    reindex();
    saveData();
    closeSheet();
    render();
    toast(`已追加 ${res.entries.length} 笔记录`);
  }
  function openPaste(prefill, isExport) {
    openSheet('paste', `<div class="form">
      <div class="f-top"><button class="icon-btn" data-act="close-sheet" aria-label="关闭">✕</button><div class="e-title">${isExport ? '备份文本' : '粘贴文本导入'}</div>${isExport ? '<span class="e-sp"></span>' : '<button class="text-btn strong" data-act="do-paste-import">导入</button>'}</div>
      <div class="f-body">
        <label class="field"><span>${isExport ? '长按全选后复制，保存到备忘录或聊天里' : '把备份文本或 CSV 粘贴到这里'}</span><textarea id="paste-box" ${isExport ? 'readonly' : ''} placeholder="{&quot;app&quot;:&quot;kakeibo&quot; …">${esc(prefill || '')}</textarea></label>
        ${isExport ? '' : '<p class="hint">备份文本（以 { 开头）会覆盖当前数据；CSV（日期,内容,金额,收支,分类,支付方式,备注）会追加到现有记录后面。</p>'}
      </div></div>`);
  }

  /* ================= events ================= */
  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act, id = el.dataset.id, v = el.dataset.v;
    switch (act) {
      case 'tab':
        ui.tab = el.dataset.tab;
        if (ui.tab !== 'list') ui.filter = { kind: 'all', cat: null, acc: null };
        render(); view.scrollTop = 0; break;
      case 'add': openEntry(); break;
      case 'month':
        ui.month = v === '0' ? curMonth() : addMonths(ui.month, Number(v));
        ui.trendTip = null; render(); break;
      case 'seg': {
        const s = el.dataset.seg;
        if (s === 'comp') { ui.compKind = v; ui.trendCat = null; ui.trendTip = null; saveUI(); }
        else if (s === 'listKind') ui.filter.kind = v;
        else if (s === 'setKind') ui.setKind = v;
        render(); break;
      }
      case 'filter-cat':
        ui.filter = { kind: 'all', cat: id, acc: null }; ui.tab = 'list'; render(); view.scrollTop = 0; break;
      case 'filter-acc':
        ui.filter = { kind: 'all', cat: null, acc: id }; ui.tab = 'list'; ui.month = curMonth(); render(); view.scrollTop = 0; break;
      case 'clear-filter': ui.filter = { kind: ui.filter.kind, cat: null, acc: null }; render(); break;
      case 'trend-cat': ui.trendCat = id; ui.trendTip = null; saveUI(); render(); break;
      case 'bar': ui.trendTip = v; render(); break;
      case 'edit': { const e = data.entries.find((x) => x.id === id); if (e) openEntry(e); break; }
      case 'go-settings': ui.tab = 'settings'; render(); view.scrollTop = 0; break;
      case 'go-list': ui.tab = 'list'; render(); view.scrollTop = 0; break;
      /* entry sheet */
      case 'kind':
        if (draft.kind === v) break;
        draft.kind = v;
        if (v === 'move') { draft.cat = null; if (!draft.to) { const other = activeAccs().find((a) => a.id !== draft.acc); draft.to = other ? other.id : null; } }
        else if (draft.cat && (!catIdx.has(draft.cat) || catIdx.get(draft.cat).kind !== v)) draft.cat = null;
        renderEntry(); break;
      case 'pick-cat': {
        draft.cat = id;
        setChipOn('.cat-cell', 'id', id);
        const la = ui.lastAcc[id];
        if (la && accIdx.has(la) && !accIdx.get(la).hidden) { draft.acc = la; setChipOn('[data-row="acc"] .acc-chip', 'id', la); }
        break;
      }
      case 'pick-acc': {
        const field = el.dataset.field;
        draft[field] = id;
        setChipOn(`[data-row="${field}"] .acc-chip`, 'id', id);
        break;
      }
      case 'key': pressKey(v); break;
      case 'save': if (v === 'cont' && draft.id) closeSheet(); else saveDraft(v === 'cont'); break;
      case 'del-entry': deleteDraft(); break;
      case 'close-sheet': case 'backdrop': closeSheet(); break;
      /* settings */
      case 'acc-edit': openSheet('acc', accFormHTML(id ? accIdx.get(id) : null)); break;
      case 'cat-edit': openSheet('cat', catFormHTML(id ? catIdx.get(id) : null)); break;
      case 'pick-type': {
        const form = $('.form', sheetEl);
        form.dataset.type = v;
        $$('.type-opt', sheetEl).forEach((b) => b.classList.toggle('on', b.dataset.v === v));
        const credit = v === 'credit';
        $('#f-init-label', sheetEl).textContent = balLabel(credit);
        $('#f-init-hint', sheetEl).textContent = balHint(credit);
        break;
      }
      case 'pick-kind': {
        const form = $('.form', sheetEl);
        form.dataset.kind = v;
        $$('#f-kind button', sheetEl).forEach((b) => b.classList.toggle('on', b.dataset.v === v));
        break;
      }
      case 'pick-emoji': $('#f-icon', sheetEl).value = v; break;
      case 'acc-save': saveAccForm(id); break;
      case 'cat-save': saveCatForm(id); break;
      case 'acc-del': deleteAcc(id); break;
      case 'cat-del': deleteCat(id); break;
      case 'move-item': moveItem(el.dataset.what, id, Number(v)); break;
      /* data */
      case 'export': exportBackup(); break;
      case 'copy-backup': copyBackup(); break;
      case 'export-csv': exportCSV(); break;
      case 'paste-import': openPaste(''); break;
      case 'do-paste-import': importText($('#paste-box', sheetEl).value); break;
      case 'toast-action': { const fn = toastFn; toastFn = null; $('#toast').classList.remove('show'); if (fn) fn(); break; }
      default: break;
    }
  });
  document.addEventListener('input', (ev) => {
    const el = ev.target;
    if (el.dataset.input === 'memo' && draft) draft.memo = el.value;
  });
  document.addEventListener('change', (ev) => {
    const el = ev.target;
    if (el.dataset.input === 'date' && draft) {
      draft.date = /^\d{4}-\d{2}-\d{2}$/.test(el.value) ? el.value : todayStr();
      const t = $('.date-text', sheetEl);
      if (t) t.textContent = shortDate(draft.date);
    } else if (el.dataset.input === 'autoadd') {
      ui.autoAdd = el.checked; saveUI(); toast(el.checked ? '下次打开会直接进入「记一笔」' : '已关闭');
    } else if (el.id === 'file-in' && el.files && el.files[0]) {
      const file = el.files[0];
      const reader = new FileReader();
      reader.onload = () => importText(reader.result);
      reader.onerror = () => toast('读取文件失败');
      reader.readAsText(file);
      el.value = '';
    }
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && ev.target.dataset && ev.target.dataset.input === 'memo') ev.target.blur();
  });

  let lastW = window.innerWidth;
  window.addEventListener('resize', () => { if (Math.abs(window.innerWidth - lastW) > 20) { lastW = window.innerWidth; render(); } });
  if (mqDark) {
    const onScheme = () => render();
    if (mqDark.addEventListener) mqDark.addEventListener('change', onScheme); else if (mqDark.addListener) mqDark.addListener(onScheme);
  }
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (ui.month !== curMonth() && hiddenAt && Date.now() - hiddenAt > 6 * 3600 * 1000) ui.month = curMonth();
    render();
    if (ui.autoAdd && hiddenAt && Date.now() - hiddenAt > 10 * 60 * 1000 && !sheetType && !modalRoot.classList.contains('open')) openEntry();
  });

  /* ================= service worker (offline) ================= */
  const secure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if ('serviceWorker' in navigator && secure) {
    const hadController = !!navigator.serviceWorker.controller;
    const swReg = navigator.serviceWorker.register('./sw.js');
    swReg.catch(() => {});
    /* iOS brings a home-screen app back to the front without reloading it, so check for a new
       version on every return as well (at most once a minute), not only on a cold start. */
    let lastCheck = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden || Date.now() - lastCheck < 60 * 1000) return;
      lastCheck = Date.now();
      swReg.then((r) => r.update()).catch(() => {});
    });
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloading) return;
      reloading = true;
      if (sheetType) { pendingReload = true; toast('新版本已下载，关闭当前页面后更新'); }
      else location.reload();
    });
  }

  /* ================= start ================= */
  render();
  const params = new URLSearchParams(location.search);
  if (params.has('add') || (ui.autoAdd && data.entries.length > 0)) openEntry();
  window.__kakeibo = { get data() { return data; }, ui, render, version: APP_VERSION };
})();
