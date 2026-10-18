'use strict';

/* =========================================================
   Mi Dinero — administración por bolsillos
   Todo se guarda en el celular (localStorage), en centavos de MXN.
   ========================================================= */

const APP_VERSION = '1.0.0';
const STORAGE_KEY = 'mi-dinero-v1';

// Datos visuales de cada bolsillo (el nombre y el % los define cada persona).
const BUCKETS = {
  gastos:      { color: 'var(--c-gastos)', icon: '💳' },
  inversion:   { color: 'var(--c-inv)',    icon: '📈' },
  estabilidad: { color: 'var(--c-est)',    icon: '🛟' },
  ocio:        { color: 'var(--c-ocio)',   icon: '🫙' },
};

// Valores sugeridos: cada persona puede cambiarlos en la bienvenida o en Ajustes.
const DEFAULT_BUCKETS = [
  { id: 'gastos',      name: 'Gastos Personales / Tarjetas', pct: 40, note: 'Tu límite tope: pago de tarjetas y comidas de la semana.' },
  { id: 'inversion',   name: 'Crecimiento e Inversión',      pct: 30, note: 'Tu patrimonio. Aquí entran los rendimientos; no se toca.' },
  { id: 'estabilidad', name: 'Fondo de Estabilidad',         pct: 10, note: 'Colchón para emergencias e imprevistos.' },
  { id: 'ocio',        name: 'Recompensas / Ocio',           pct: 20, note: 'Tu Frasco de la Alegría: salidas, gustos y pasatiempos sin culpa.' },
];

const TYPES = {
  inicial:   { icon: '🏁', label: 'Saldo inicial' },
  ingreso:   { icon: '💰', label: 'Ingreso repartido' },
  directo:   { icon: '🍽️', label: 'Ingreso directo' },
  gasto:     { icon: '🧾', label: 'Gasto' },
  transfer:  { icon: '🔁', label: 'Transferencia' },
  interes:   { icon: '📈', label: 'Rendimiento' },
  ajuste:    { icon: '⚖️', label: 'Ajuste' },
  redistrib: { icon: '🧮', label: 'Redistribución' },
  saldos:    { icon: '✏️', label: 'Saldos ajustados' },
  inv:       { icon: '🏦', label: 'Inversión' },
  invint:    { icon: '📈', label: 'Rendimiento de inversión' },
};

/* ---------------- Estado ---------------- */

function defaultState() {
  return {
    app: 'mi-dinero',
    v: 1,
    setup: false,
    buckets: DEFAULT_BUCKETS.map((b) => ({ ...b, balance: 0 })),
    rate: 15,
    autoInterest: true,
    interestCarry: 0,
    lastInterest: null,
    currency: 'MXN',
    fx: { rate: null, updated: null, manual: null },
    investments: [],
    history: [],
    installHintDismissed: false,
  };
}

function normalize(s) {
  const d = defaultState();
  const out = { ...d, ...s };
  out.fx = { ...d.fx, ...(s.fx || {}) };
  out.buckets = DEFAULT_BUCKETS.map((def) => {
    const found = (s.buckets || []).find((b) => b.id === def.id);
    return found ? { ...def, ...found } : { ...def, balance: 0 };
  });
  out.investments = Array.isArray(s.investments) ? s.investments : [];
  out.history = Array.isArray(s.history) ? s.history : [];
  return out;
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch (e) { /* datos dañados o almacenamiento bloqueado */ }
  return defaultState();
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    toast('No se pudo guardar. Revisa el espacio del celular.');
  }
}

let state = load();
let tab = 'home';

/* ---------------- Utilidades ---------------- */

const $ = (sel, root = document) => root.querySelector(sel);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const bucket = (id) => state.buckets.find((b) => b.id === id);
const bucketName = (id) => (bucket(id) || {}).name || id;
const totalRevolut = () => state.buckets.reduce((a, b) => a + b.balance, 0);
const totalInvest = () => state.investments.reduce((a, i) => a + i.amount, 0);
const fmtPct = (p) => `${+Number(p).toFixed(2)}%`;

function dayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function daysBetween(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1)) / 86400000);
}

/* ---------------- Dinero y moneda ---------------- */

const nf = new Intl.NumberFormat('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fxRate = () => state.fx.manual || state.fx.rate;
const cur = () => (state.currency === 'USD' && fxRate() ? 'USD' : 'MXN');

// Recibe centavos de MXN y los muestra en la moneda elegida.
function money(cents, opts = {}) {
  let v = cents / 100;
  if (cur() === 'USD') v = v / fxRate();
  const rounded = Math.round(v * 100) / 100;
  const sign = rounded < 0 ? '-' : (opts.plus && rounded > 0 ? '+' : '');
  return `${sign}$${nf.format(Math.abs(rounded))}`;
}

// Convierte lo que escribe la persona (en la moneda visible) a centavos de MXN.
function parseAmount(str, allowZero = false) {
  const n = Number(String(str ?? '').replace(/[$,\s]/g, ''));
  if (!Number.isFinite(n) || n < 0 || (!allowZero && n === 0) || String(str).trim() === '') return null;
  const mxn = cur() === 'USD' ? n * fxRate() : n;
  return Math.round(mxn * 100);
}

// Reparte un monto con los porcentajes, sin perder ni un centavo (método del mayor residuo).
function splitByPct(total) {
  const raw = state.buckets.map((b) => (total * b.pct) / 100);
  const parts = raw.map(Math.floor);
  let rest = total - parts.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f);
  for (let k = 0; rest > 0; k++, rest--) parts[order[k % order.length].i]++;
  return parts;
}

/* ---------------- Movimientos ---------------- */

// deltas: { 'b:gastos': centavos, 'i:<idInversion>': centavos }
function applyDeltas(deltas, sign = 1) {
  for (const [key, v] of Object.entries(deltas)) {
    const [kind, id] = key.split(':');
    if (kind === 'b') {
      const b = bucket(id);
      if (b) b.balance += sign * v;
    } else {
      const inv = state.investments.find((i) => i.id === id);
      if (inv) inv.amount += sign * v;
    }
  }
}

function record(type, desc, deltas, amount, extra = {}) {
  const entry = { id: uid(), ts: new Date().toISOString(), type, desc, deltas, amount, ...extra };
  applyDeltas(deltas);
  state.history.unshift(entry);
  return entry;
}

function undoEntry(id) {
  const idx = state.history.findIndex((e) => e.id === id);
  if (idx < 0) return;
  const e = state.history[idx];
  applyDeltas(e.deltas, -1);
  if (e.created && e.invId) state.investments = state.investments.filter((i) => i.id !== e.invId);
  state.history.splice(idx, 1);
}

/* ---------------- Rendimientos automáticos ---------------- */

// Interés diario (tasa anual / 365) que se capitaliza cada día. "carry" guarda fracciones de centavo.
function accrue(principal, ratePct, days, carry) {
  const daily = ratePct / 100 / 365;
  let gained = 0;
  for (let i = 0; i < days; i++) {
    const base = principal + gained;
    if (base <= 0) break;
    const x = base * daily + carry;
    const whole = Math.floor(x);
    carry = x - whole;
    gained += whole;
  }
  return { gained, carry };
}

function runAccruals() {
  if (!state.setup) return false;
  const today = dayKey();
  let changed = false;

  // Revolut: se calcula sobre el TOTAL de los bolsillos y entra 100% a Inversión.
  if (!state.lastInterest) {
    state.lastInterest = today;
    changed = true;
  }
  const days = daysBetween(state.lastInterest, today);
  if (days > 0 && state.autoInterest && state.rate > 0) {
    const r = accrue(totalRevolut(), state.rate, days, state.interestCarry || 0);
    state.interestCarry = r.carry;
    if (r.gained > 0) {
      record('interes', `Rendimiento automático · ${days} ${days === 1 ? 'día' : 'días'} al ${fmtPct(state.rate)}`,
        { 'b:inversion': r.gained }, r.gained, { bucket: 'inversion' });
    }
  }
  if (days !== 0) {
    state.lastInterest = today;
    changed = true;
  }

  // Otras inversiones con tasa fija.
  for (const inv of state.investments) {
    if (inv.type !== 'fija') continue;
    if (!inv.lastDate) { inv.lastDate = today; changed = true; continue; }
    const d = daysBetween(inv.lastDate, today);
    if (d > 0 && inv.rate > 0) {
      const r = accrue(inv.amount, inv.rate, d, inv.carry || 0);
      inv.carry = r.carry;
      if (r.gained > 0) {
        record('invint', `Rendimiento · ${inv.name}`, { [`i:${inv.id}`]: r.gained }, r.gained, { invId: inv.id, invName: inv.name });
      }
    }
    if (d !== 0) { inv.lastDate = today; changed = true; }
  }

  if (changed) save();
  return changed;
}

/* ---------------- Tipo de cambio ---------------- */

async function refreshFx(force = false) {
  const fresh = state.fx.updated && Date.now() - state.fx.updated < 6 * 3600e3;
  if (fresh && !force) return true;
  const sources = [
    ['https://open.er-api.com/v6/latest/USD', (j) => j && j.rates && j.rates.MXN],
    ['https://api.frankfurter.app/latest?from=USD&to=MXN', (j) => j && j.rates && j.rates.MXN],
  ];
  for (const [url, pick] of sources) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) continue;
      const rate = Number(pick(await res.json()));
      if (rate > 0) {
        state.fx.rate = rate;
        state.fx.updated = Date.now();
        save();
        updateFxTexts();
        return true;
      }
    } catch (e) { /* sin internet: probamos la siguiente fuente */ }
  }
  return false;
}

function fxDescription() {
  if (state.fx.manual) return `1 USD = $${nf.format(state.fx.manual)} MXN (manual)`;
  if (!state.fx.rate) return 'Sin tipo de cambio todavía';
  const when = new Date(state.fx.updated).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return `1 USD = $${nf.format(state.fx.rate)} MXN · ${when}`;
}

function updateFxTexts() {
  const mini = $('#fxMini');
  if (mini) mini.textContent = cur() === 'USD' ? `1 USD = $${nf.format(fxRate())}` : '';
  const info = $('#fxInfo');
  if (info) info.textContent = fxDescription();
}

/* ---------------- Instalación en iPhone ---------------- */

const isStandalone = () => window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;

function installBanner(force = false) {
  if (isStandalone() || (!force && state.installHintDismissed)) return '';
  return `
    <div class="banner">
      <strong>📲 Instálala en tu iPhone</strong>
      <p>En <b>Safari</b> toca <b>Compartir</b> (el cuadrito con la flecha ⬆︎) → <b>Agregar a inicio</b>.</p>
      <p class="warn">Importante: hazlo <b>antes</b> de capturar tus datos. Lo que guardes aquí en Safari no pasa a la app del inicio.</p>
      ${force ? '' : '<button class="link" data-action="dismissInstall">Entendido</button>'}
    </div>`;
}

/* ---------------- Componentes ---------------- */

function amountField(name, label, value = '', opts = {}) {
  return `
    <label class="field">
      <span>${label}</span>
      <div class="money-input">
        <span>$</span>
        <input name="${name}" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${esc(value)}" ${opts.autofocus ? 'autofocus' : ''}>
        ${opts.allBtn ? '<button type="button" class="link" data-fill-all>Todo</button>' : ''}
        <em>${opts.forceMXN ? 'MXN' : cur()}</em>
      </div>
      ${opts.hintId || opts.hint ? `<small class="hint" ${opts.hintId ? `id="${opts.hintId}"` : ''}>${opts.hint}</small>` : ''}
    </label>`;
}

function textField(name, label, placeholder = '', value = '') {
  return `
    <label class="field">
      <span>${label}</span>
      <input name="${name}" placeholder="${esc(placeholder)}" value="${esc(value)}" autocomplete="off" maxlength="60">
    </label>`;
}

function bucketSelect(name, label, selected) {
  return `
    <label class="field">
      <span>${label}</span>
      <select name="${name}">
        ${state.buckets.map((b) => `<option value="${b.id}" ${b.id === selected ? 'selected' : ''}>${BUCKETS[b.id].icon} ${esc(b.name)}</option>`).join('')}
      </select>
    </label>`;
}

function bucketEditor() {
  return `
    ${state.buckets.map((b) => `
      <div class="bedit">
        <span class="dot" style="background:${BUCKETS[b.id].color}"></span>
        <input name="n_${b.id}" value="${esc(b.name)}" maxlength="40" aria-label="Nombre del bolsillo">
        <div class="pct"><input name="p_${b.id}" value="${+b.pct}" inputmode="decimal" aria-label="Porcentaje"><span>%</span></div>
        <textarea class="note" name="d_${b.id}" rows="2" maxlength="90" placeholder="Recordatorio: ¿para qué es este bolsillo?" aria-label="Recordatorio del bolsillo">${esc(b.note)}</textarea>
      </div>`).join('')}
    <div class="pct-total" id="pctTotal"></div>
    <button type="button" class="link" data-action="fillDefaults">↺ Usar valores sugeridos (40/30/10/20)</button>`;
}

// Rellena el formulario con los nombres, % y recordatorios sugeridos (no guarda hasta que la persona confirme).
function fillDefaults(form) {
  for (const d of DEFAULT_BUCKETS) {
    form[`n_${d.id}`].value = d.name;
    form[`p_${d.id}`].value = d.pct;
    form[`d_${d.id}`].value = d.note;
  }
  form.dispatchEvent(new Event('input'));
}

function bindBucketEditor(form) {
  const upd = () => {
    const r = readBucketEditor(form);
    const el = $('#pctTotal', form);
    el.className = 'pct-total ' + (r.sumOk ? 'ok' : 'bad');
    el.innerHTML = `<span>Total</span><span>${fmtPct(r.sum)} ${r.sumOk ? '✓' : '(debe ser 100%)'}</span>`;
  };
  form.addEventListener('input', upd);
  upd();
}

function readBucketEditor(form) {
  let sum = 0;
  let error = null;
  const vals = state.buckets.map((b) => {
    const name = form[`n_${b.id}`].value.trim();
    const pct = Number(form[`p_${b.id}`].value.replace(',', '.'));
    if (!name) error = 'Ponle nombre a todos los bolsillos';
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) error = 'Los porcentajes deben estar entre 0 y 100';
    sum += Number.isFinite(pct) ? pct : 0;
    return { id: b.id, name, pct: Math.round(pct * 100) / 100, note: form[`d_${b.id}`].value.trim() };
  });
  const sumOk = Math.abs(sum - 100) < 0.001;
  if (!error && !sumOk) error = `Los porcentajes suman ${fmtPct(sum)}; deben sumar 100%`;
  return { vals, sum: Math.round(sum * 100) / 100, sumOk, error };
}

function applyBucketEditor(vals) {
  for (const v of vals) {
    const b = bucket(v.id);
    b.name = v.name;
    b.pct = v.pct;
    b.note = v.note;
  }
}

function subFor(e) {
  switch (e.type) {
    case 'ingreso': return 'Repartido en tus bolsillos';
    case 'inicial': return e.manual ? 'Cada bolsillo con su saldo' : 'Repartido en tus bolsillos';
    case 'saldos': return 'Saldos corregidos a mano';
    case 'redistrib': return 'Saldo reacomodado con tus %';
    case 'transfer': return `${bucketName(e.from)} → ${bucketName(e.to)}`;
    case 'inv':
    case 'invint': return e.invName || 'Inversión';
    default: return e.bucket ? bucketName(e.bucket) : '';
  }
}

function itemHTML(e, showDate = false) {
  const t = TYPES[e.type] || TYPES.ajuste;
  const neutral = e.type === 'transfer' || e.type === 'redistrib' || e.type === 'saldos';
  const cls = neutral ? 'neutral' : e.amount < 0 ? 'neg' : 'pos';
  const d = new Date(e.ts);
  const time = d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  const date = showDate ? d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }) + ' · ' : '';
  return `
    <button class="item" data-action="entry" data-id="${e.id}">
      <span class="ico">${t.icon}</span>
      <span class="txt"><strong>${esc(e.desc || t.label)}</strong><span>${date}${time} · ${esc(subFor(e))}</span></span>
      <span class="amt ${cls}">${money(e.amount, { plus: !neutral })}</span>
    </button>`;
}

function dayLabel(key) {
  const today = dayKey();
  const diff = daysBetween(key, today);
  if (diff === 0) return 'Hoy';
  if (diff === 1) return 'Ayer';
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
}

/* ---------------- Vistas ---------------- */

function viewSetup() {
  return `
    <div class="welcome">
      <div class="emoji">💸</div>
      <h2>Bienvenido a Mi Dinero</h2>
      <p class="muted">Separa tu dinero en bolsillos para saber cuánto puedes gastar de verdad sin tocar tu inversión.</p>
    </div>
    ${installBanner(true)}
    <form id="fSetup" class="card">
      <div>
        <h2 style="font-size:18px">1. Tus bolsillos</h2>
        <p class="muted">Ya vienen con nombres, porcentajes y recordatorios sugeridos. Puedes dejarlos así o cambiarlos como quieras (los % deben sumar 100%).</p>
      </div>
      ${bucketEditor()}
      <div>
        <h2 style="font-size:18px">2. ¿Con cuánto empiezas?</h2>
        <p class="muted">Tu saldo actual (por ejemplo, lo que tienes en Revolut). Puedes repartirlo con tus porcentajes o, si ya lo tienes separado, poner cuánto hay en cada bolsillo. Puedes dejarlo en 0.</p>
      </div>
      <div class="seg-radio">
        <label><input type="radio" name="mode" value="split" checked><span>Repartir con mis %</span></label>
        <label><input type="radio" name="mode" value="manual"><span>Yo pongo cada saldo</span></label>
      </div>
      <div class="stack" id="modeSplit">
        ${amountField('amount', 'Saldo inicial total', '', { forceMXN: true })}
      </div>
      <div class="stack hidden" id="modeManual">
        ${state.buckets.map((b) => amountField(`s_${b.id}`, `${BUCKETS[b.id].icon} <span data-name-for="${b.id}">${esc(b.name)}</span>`, '', { forceMXN: true })).join('')}
        <p class="pct-total" id="manualTotal"></p>
      </div>
      <div>
        <h2 style="font-size:18px">3. Rendimiento anual</h2>
        <p class="muted">Lo que te paga tu cuenta al año. Se calcula solo, cada día, sobre todo tu saldo, y se suma a Inversión.</p>
      </div>
      <label class="field"><span>Tasa anual (%)</span><input name="rate" inputmode="decimal" value="15"></label>
      <button class="btn primary" type="submit">Comenzar</button>
    </form>`;
}

function spendCard(b) {
  return `
    <div class="spend-card" style="--accent:${BUCKETS[b.id].color}">
      <span class="name">${BUCKETS[b.id].icon} ${esc(b.name)}</span>
      <span class="amt ${b.balance < 0 ? 'neg' : ''}">${money(b.balance)}</span>
      ${b.note ? `<span class="note">${esc(b.note)}</span>` : ''}
      <span class="meta">${fmtPct(b.pct)} de cada ingreso</span>
    </div>`;
}

function bucketRow(b, extra = '') {
  return `
    <div class="brow" style="--accent:${BUCKETS[b.id].color}">
      <span class="ico">${BUCKETS[b.id].icon}</span>
      <span class="txt"><strong>${esc(b.name)}</strong><span>${fmtPct(b.pct)}${b.note ? ` · ${esc(b.note)}` : ''}</span></span>
      <span class="amt ${b.balance < 0 ? 'neg' : ''}">${money(b.balance)}${extra ? `<small>${extra}</small>` : ''}</span>
    </div>`;
}

function viewHome() {
  const daily = Math.max(0, totalRevolut()) * state.rate / 100 / 365;
  const showDaily = state.autoInterest && state.rate > 0 && daily >= 1;
  const pcts = state.buckets.map((b) => +b.pct).join('/');
  const recent = state.history.slice(0, 5);
  return `
    ${installBanner()}
    <section class="spend">
      <p class="eyebrow">Disponible para gastar</p>
      <div class="spend-grid">
        ${spendCard(bucket('gastos'))}
        ${spendCard(bucket('ocio'))}
      </div>
    </section>

    <section class="card">
      <p class="eyebrow">Protegido · no tocar</p>
      ${bucketRow(bucket('inversion'), showDaily ? `≈ ${money(Math.round(daily), { plus: true })} al día` : '')}
      ${bucketRow(bucket('estabilidad'))}
    </section>

    <section class="card total">
      <div class="row"><span>Total en tus bolsillos</span><strong class="num ${totalRevolut() < 0 ? 'neg' : ''}">${money(totalRevolut())}</strong></div>
      ${state.investments.length ? `
        <div class="row sub"><span>Otras inversiones</span><span class="num">${money(totalInvest())}</span></div>
        <div class="row"><span>Patrimonio total</span><strong class="num">${money(totalRevolut() + totalInvest())}</strong></div>` : ''}
      <button class="btn small" data-action="reconcile">⚖️ Cuadrar con mi saldo real</button>
    </section>

    <section class="actions">
      <button class="action" data-action="add"><span class="ai">💰</span><strong>Agregar dinero</strong><span>Se reparte ${pcts} o a un bolsillo</span></button>
      <button class="action" data-action="editBalances"><span class="ai">✏️</span><strong>Ajustar saldos</strong><span>Corregir un bolsillo</span></button>
      <button class="action" data-action="expense"><span class="ai">🧾</span><strong>Gasto / Pago</strong><span>Resta de un bolsillo</span></button>
      <button class="action" data-action="transfer"><span class="ai">🔁</span><strong>Transferir</strong><span>Entre bolsillos</span></button>
    </section>

    <section style="display:flex;flex-direction:column;gap:10px">
      <div class="section-head"><h2>Recientes</h2>${state.history.length > 5 ? '<button class="link" data-action="tab" data-tab="history">Ver todo</button>' : ''}</div>
      ${recent.length ? `<div class="list">${recent.map((e) => itemHTML(e, true)).join('')}</div>` : '<div class="list"><p class="empty">Aún no hay movimientos.<br>Empieza con "Agregar dinero".</p></div>'}
    </section>`;
}

function viewHistory() {
  if (!state.history.length) return '<div class="list"><p class="empty">Aún no hay movimientos.</p></div>';
  const groups = [];
  for (const e of state.history) {
    const k = dayKey(new Date(e.ts));
    const last = groups[groups.length - 1];
    if (last && last.k === k) last.items.push(e);
    else groups.push({ k, items: [e] });
  }
  return `
    <p class="muted">Toca un movimiento para ver el detalle o deshacerlo.</p>
    ${groups.map((g) => `<p class="day-head">${dayLabel(g.k)}</p><div class="list">${g.items.map((e) => itemHTML(e)).join('')}</div>`).join('')}`;
}

function viewInvest() {
  return `
    <section class="card">
      <p class="eyebrow">Patrimonio total</p>
      <strong class="num" style="font-size:32px;font-weight:800;letter-spacing:-.02em">${money(totalRevolut() + totalInvest())}</strong>
      <div class="row sub"><span>Bolsillos (Revolut)</span><span class="num">${money(totalRevolut())}</span></div>
      <div class="row sub"><span>Otras inversiones</span><span class="num">${money(totalInvest())}</span></div>
    </section>
    <section style="display:flex;flex-direction:column;gap:10px">
      <div class="section-head"><h2>Otras inversiones</h2></div>
      <p class="muted">Dinero aparte de tus bolsillos: bolsa, CETES, otra cuenta… No se mezcla con lo que tienes para gastar.</p>
      ${state.investments.length ? `<div class="list">${state.investments.map((inv) => `
        <button class="item" data-action="invDetail" data-id="${inv.id}">
          <span class="ico">${inv.type === 'fija' ? '🏦' : '📊'}</span>
          <span class="txt"><strong>${esc(inv.name)}</strong><span>${inv.type === 'fija' ? `Tasa fija · ${fmtPct(inv.rate)} anual` : 'Valor variable'}</span></span>
          <span class="amt">${money(inv.amount)}</span>
        </button>`).join('')}</div>` : '<div class="list"><p class="empty">Todavía no agregas inversiones extra.</p></div>'}
      <button class="btn primary" data-action="addInv">＋ Agregar inversión</button>
    </section>`;
}

function viewSettings() {
  return `
    <form id="fBuckets" class="card">
      <div>
        <h2 style="font-size:18px">Bolsillos y porcentajes</h2>
        <p class="muted">Nombre, porcentaje y un recordatorio de para qué es cada uno. Los nuevos % solo se aplican a los siguientes ingresos; tus saldos actuales no cambian. Para corregir un saldo usa "Ajustar saldo de cada bolsillo".</p>
      </div>
      ${bucketEditor()}
      <button class="btn primary" type="submit">Guardar cambios</button>
      <button class="btn" type="button" data-action="editBalances">✏️ Ajustar saldo de cada bolsillo</button>
      <button class="btn" type="button" data-action="redistribute">🧮 Redistribuir todo con estos %</button>
    </form>

    <form id="fRate" class="card">
      <div>
        <h2 style="font-size:18px">Rendimiento automático</h2>
        <p class="muted">Cada día se calcula sobre el total de tus bolsillos y se suma 100% a "${esc(bucketName('inversion'))}". Si no abres la app, al abrirla se suman los días que pasaron.</p>
      </div>
      <div class="switch-row"><span>Calcular automáticamente</span><label class="switch"><input type="checkbox" name="auto" ${state.autoInterest ? 'checked' : ''}><span></span></label></div>
      <label class="field"><span>Tasa anual (%)</span><input name="rate" inputmode="decimal" value="${+state.rate}"></label>
      <button class="btn primary" type="submit">Guardar</button>
    </form>

    <form id="fFx" class="card">
      <div>
        <h2 style="font-size:18px">Tipo de cambio (USD)</h2>
        <p class="muted" id="fxInfo">${fxDescription()}</p>
      </div>
      <button class="btn" type="button" data-action="fxRefresh">🔄 Actualizar ahora</button>
      <label class="field"><span>Tipo de cambio manual (opcional)</span><input name="manual" inputmode="decimal" placeholder="Vacío = automático" value="${state.fx.manual || ''}"></label>
      <button class="btn primary" type="submit">Guardar</button>
    </form>

    <section class="card">
      <div>
        <h2 style="font-size:18px">Respaldo</h2>
        <p class="muted">Tus datos viven solo en este celular. Guarda un respaldo de vez en cuando (en Archivos o iCloud) para no perderlos si cambias de iPhone.</p>
      </div>
      <button class="btn primary" data-action="export">⬇️ Guardar respaldo</button>
      <button class="btn" data-action="import">⬆️ Restaurar desde respaldo</button>
    </section>

    ${isStandalone() ? '' : `<section>${installBanner(true)}</section>`}

    <section class="card">
      <h2 style="font-size:18px">Borrar todo</h2>
      <p class="muted">Elimina todos tus datos de este celular y empieza de cero.</p>
      <button class="btn danger" data-action="reset">Borrar todos mis datos</button>
    </section>
    <p class="footer-note">Mi Dinero v${APP_VERSION}</p>`;
}

/* ---------------- Render ---------------- */

const TITLES = { home: 'Mi Dinero', history: 'Movimientos', invest: 'Inversiones', settings: 'Ajustes' };

function render() {
  const view = $('#view');
  $('#tabbar').classList.toggle('hidden', !state.setup);
  $('#curSeg').parentElement.classList.toggle('hidden', !state.setup);
  document.querySelectorAll('#curSeg button').forEach((b) => b.classList.toggle('on', b.dataset.cur === cur()));
  document.querySelectorAll('#tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  updateFxTexts();

  if (!state.setup) {
    $('#title').textContent = 'Mi Dinero';
    view.innerHTML = viewSetup();
    const f = $('#fSetup');
    bindBucketEditor(f);
    const upd = () => {
      const manual = f.mode.value === 'manual';
      $('#modeSplit').classList.toggle('hidden', manual);
      $('#modeManual').classList.toggle('hidden', !manual);
      for (const b of state.buckets) {
        $(`[data-name-for="${b.id}"]`).textContent = f[`n_${b.id}`].value.trim() || b.name;
      }
      const sum = state.buckets.reduce((a, b) => a + (parseAmount(f[`s_${b.id}`].value, true) || 0), 0);
      $('#manualTotal').innerHTML = `<span>Total</span><span>${money(sum)}</span>`;
    };
    f.addEventListener('input', upd);
    f.addEventListener('change', upd);
    upd();
    f.addEventListener('submit', onSetup);
    return;
  }

  $('#title').textContent = TITLES[tab];
  view.innerHTML = { home: viewHome, history: viewHistory, invest: viewInvest, settings: viewSettings }[tab]();
  if (tab === 'settings') bindSettings();
}

function onSetup(e) {
  e.preventDefault();
  const f = e.target;
  const r = readBucketEditor(f);
  if (r.error) return toast(r.error);
  const rate = Number(f.rate.value.replace(',', '.'));
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) return toast('Escribe una tasa válida');
  // Saldo inicial: repartido con % o escrito bolsillo por bolsillo.
  const deltas = {};
  let start = 0;
  if (f.mode.value === 'manual') {
    for (const b of state.buckets) {
      const raw = f[`s_${b.id}`].value.trim();
      const c = raw === '' ? 0 : parseAmount(raw, true);
      if (c === null) return toast(`Revisa el saldo de "${f[`n_${b.id}`].value.trim() || b.name}"`);
      if (c) deltas[`b:${b.id}`] = c;
      start += c;
    }
  } else {
    const raw = f.amount.value.trim();
    start = raw === '' ? 0 : parseAmount(raw, true);
    if (start === null) return toast('Escribe un saldo válido');
  }

  applyBucketEditor(r.vals);
  state.rate = rate;
  state.setup = true;
  state.lastInterest = dayKey();
  if (start > 0) {
    if (f.mode.value !== 'manual') {
      const parts = splitByPct(start);
      state.buckets.forEach((b, i) => { if (parts[i]) deltas[`b:${b.id}`] = parts[i]; });
    }
    record('inicial', 'Saldo inicial', deltas, start, { manual: f.mode.value === 'manual' });
  }
  save();
  tab = 'home';
  render();
  toast('¡Listo! Tus bolsillos están creados');
}

function bindSettings() {
  const fb = $('#fBuckets');
  bindBucketEditor(fb);
  fb.addEventListener('submit', (e) => {
    e.preventDefault();
    const r = readBucketEditor(fb);
    if (r.error) return toast(r.error);
    applyBucketEditor(r.vals);
    save();
    render();
    toast('Bolsillos guardados');
  });

  const fr = $('#fRate');
  fr.addEventListener('submit', (e) => {
    e.preventDefault();
    const rate = Number(fr.rate.value.replace(',', '.'));
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) return toast('Escribe una tasa válida');
    runAccruals(); // lo pendiente se calcula con la tasa anterior
    state.rate = rate;
    state.autoInterest = fr.auto.checked;
    state.lastInterest = dayKey();
    save();
    render();
    toast('Rendimiento guardado');
  });

  const ff = $('#fFx');
  ff.addEventListener('submit', (e) => {
    e.preventDefault();
    const raw = ff.manual.value.trim();
    if (raw === '') {
      state.fx.manual = null;
    } else {
      const n = Number(raw.replace(',', '.'));
      if (!Number.isFinite(n) || n <= 0) return toast('Escribe un tipo de cambio válido');
      state.fx.manual = n;
    }
    save();
    render();
    toast('Tipo de cambio guardado');
  });
}

/* ---------------- Hojas (ventanas inferiores) ---------------- */

const sheetRoot = $('#sheet-root');

function openSheet(title, body, onMount) {
  sheetRoot.innerHTML = `
    <div class="sheet-backdrop" data-action="closeSheet"></div>
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="sheet-grab"></div>
      <div class="sheet-head"><h3>${esc(title)}</h3><button class="icon-btn" data-action="closeSheet" aria-label="Cerrar">✕</button></div>
      <div class="sheet-body">${body}</div>
    </div>`;
  requestAnimationFrame(() => requestAnimationFrame(() => sheetRoot.classList.add('open')));
  if (onMount) onMount($('.sheet', sheetRoot));
}

function closeSheet() {
  sheetRoot.classList.remove('open');
  setTimeout(() => { if (!sheetRoot.classList.contains('open')) sheetRoot.innerHTML = ''; }, 250);
}

function commit(msg) {
  save();
  closeSheet();
  render();
  if (msg) toast(msg);
}

// Agregar dinero: al total de la cartera (se reparte con los %) o directo a un bolsillo.
function sheetAdd() {
  openSheet('Agregar dinero', `
    <form id="f">
      ${amountField('amount', 'Monto')}
      <label class="field">
        <span>¿A dónde lo agregas?</span>
        <select name="dest">
          <option value="">💼 Total de la cartera · ${state.buckets.map((b) => +b.pct).join('/')}</option>
          ${state.buckets.map((b) => `<option value="${b.id}">${BUCKETS[b.id].icon} Solo a ${esc(b.name)}</option>`).join('')}
        </select>
      </label>
      ${textField('desc', 'Descripción (opcional)', 'Ej. Trabajo, regalo, comida semanal…')}
      <div class="preview" id="preview"></div>
      <button class="btn primary" type="submit">Agregar</button>
    </form>`, (sheet) => {
    const f = $('#f', sheet);
    const prev = $('#preview', sheet);
    const upd = () => {
      const c = parseAmount(f.amount.value) || 0;
      const dest = f.dest.value;
      const parts = dest ? state.buckets.map((b) => (b.id === dest ? c : 0)) : splitByPct(c);
      prev.innerHTML = state.buckets.map((b, i) => `
        <div class="prev-row" style="${dest && b.id !== dest ? 'opacity:.4' : ''}"><span class="dot" style="background:${BUCKETS[b.id].color}"></span>
        <span>${esc(b.name)} ${dest ? '' : `<em>${fmtPct(b.pct)}</em>`}</span><strong class="num">${parts[i] ? '+' : ''}${money(parts[i])}</strong></div>`).join('');
    };
    f.addEventListener('input', upd);
    f.addEventListener('change', upd);
    upd();
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const c = parseAmount(f.amount.value);
      if (!c) return toast('Escribe un monto válido');
      const dest = f.dest.value;
      const desc = f.desc.value.trim();
      if (dest) {
        record('directo', desc || 'Dinero agregado', { [`b:${dest}`]: c }, c, { bucket: dest });
        return commit(`Agregado a ${bucketName(dest)}`);
      }
      const parts = splitByPct(c);
      const deltas = {};
      state.buckets.forEach((b, i) => { if (parts[i]) deltas[`b:${b.id}`] = parts[i]; });
      record('ingreso', desc || 'Dinero agregado', deltas, c);
      commit('Agregado y repartido en tus bolsillos');
    });
  });
}

function sheetExpense() {
  openSheet('Gasto o pago', `
    <form id="f">
      ${amountField('amount', 'Monto', '', { hint: '', hintId: 'avail' })}
      ${bucketSelect('bucket', '¿De qué bolsillo sale?', 'gastos')}
      ${textField('desc', 'Descripción (opcional)', 'Ej. Pago tarjeta, comida, cine…')}
      <button class="btn primary" type="submit">Restar</button>
    </form>`, (sheet) => {
    const f = $('#f', sheet);
    const avail = $('#avail', sheet);
    const upd = () => {
      const b = bucket(f.bucket.value);
      const c = parseAmount(f.amount.value) || 0;
      avail.innerHTML = `Disponible: <b>${money(b.balance)}</b>${c ? ` · Te quedaría: <b class="${b.balance - c < 0 ? 'neg' : ''}">${money(b.balance - c)}</b>` : ''}`;
    };
    f.addEventListener('input', upd);
    f.addEventListener('change', upd);
    upd();
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const c = parseAmount(f.amount.value);
      if (!c) return toast('Escribe un monto válido');
      const b = bucket(f.bucket.value);
      if (c > b.balance && !confirm(`Esto deja "${b.name}" en negativo (${money(b.balance - c)}). Estarías usando dinero de otros bolsillos. ¿Continuar?`)) return;
      record('gasto', f.desc.value.trim() || 'Gasto', { [`b:${b.id}`]: -c }, -c, { bucket: b.id });
      commit('Gasto registrado');
    });
  });
}

function sheetTransfer() {
  openSheet('Transferir entre bolsillos', `
    <form id="f">
      <p class="muted">Por ejemplo, mandar lo que te sobró de la comida a Inversión.</p>
      ${bucketSelect('from', 'De', 'gastos')}
      ${bucketSelect('to', 'A', 'inversion')}
      ${amountField('amount', 'Monto', '', { allBtn: true, hint: '', hintId: 'avail' })}
      ${textField('desc', 'Descripción (opcional)', 'Ej. Sobrante de comida')}
      <button class="btn primary" type="submit">Transferir</button>
    </form>`, (sheet) => {
    const f = $('#f', sheet);
    const avail = $('#avail', sheet);
    const upd = () => { avail.innerHTML = `Disponible en origen: <b>${money(bucket(f.from.value).balance)}</b>`; };
    f.addEventListener('change', upd);
    upd();
    $('[data-fill-all]', sheet).addEventListener('click', () => {
      const bal = bucket(f.from.value).balance;
      let v = bal / 100;
      if (cur() === 'USD') v = v / fxRate();
      f.amount.value = bal > 0 ? (Math.floor(v * 100) / 100).toFixed(2) : '';
    });
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const from = f.from.value;
      const to = f.to.value;
      if (from === to) return toast('Elige bolsillos diferentes');
      let c = parseAmount(f.amount.value);
      if (!c) return toast('Escribe un monto válido');
      const b = bucket(from);
      // Si eligió "Todo", que no queden centavos sueltos por la conversión.
      if (Math.abs(c - b.balance) <= 1 && b.balance > 0) c = b.balance;
      if (c > b.balance && !confirm(`"${b.name}" quedaría en negativo (${money(b.balance - c)}). ¿Continuar?`)) return;
      record('transfer', f.desc.value.trim() || 'Transferencia', { [`b:${from}`]: -c, [`b:${to}`]: c }, c, { from, to });
      commit('Transferencia hecha');
    });
  });
}

// Corrige el saldo de cada bolsillo a mano, sin repartir con porcentajes.
function sheetEditBalances() {
  const toInput = (cents) => {
    let v = cents / 100;
    if (cur() === 'USD') v = v / fxRate();
    return (Math.round(v * 100) / 100).toFixed(2);
  };
  const original = Object.fromEntries(state.buckets.map((b) => [b.id, toInput(b.balance)]));
  openSheet('Ajustar saldos', `
    <form id="f">
      <p class="muted">Escribe cuánto tienes realmente en cada bolsillo. Solo cambia lo que modifiques; no se reparte con porcentajes.</p>
      ${state.buckets.map((b) => amountField(`s_${b.id}`, `${BUCKETS[b.id].icon} ${esc(b.name)}`, original[b.id])).join('')}
      <p class="pct-total" id="sum"></p>
      <button class="btn primary" type="submit">Guardar saldos</button>
    </form>`, (sheet) => {
    const f = $('#f', sheet);
    const read = () => {
      const deltas = {};
      let total = 0;
      for (const b of state.buckets) {
        const raw = f[`s_${b.id}`].value.trim();
        if (raw === original[b.id]) { total += b.balance; continue; }
        const c = raw === '' ? 0 : parseAmount(raw, true);
        if (c === null) return { error: `Revisa el saldo de "${b.name}"` };
        if (c !== b.balance) deltas[`b:${b.id}`] = c - b.balance;
        total += c;
      }
      return { deltas, total };
    };
    const upd = () => {
      const r = read();
      $('#sum', sheet).innerHTML = r.error ? '' : `<span>Total</span><span>${money(r.total)}</span>`;
    };
    f.addEventListener('input', upd);
    upd();
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const r = read();
      if (r.error) return toast(r.error);
      if (!Object.keys(r.deltas).length) { closeSheet(); return toast('No cambiaste ningún saldo'); }
      const amount = Object.values(r.deltas).reduce((a, v) => a + Math.abs(v), 0);
      record('saldos', 'Saldos ajustados a mano', r.deltas, amount);
      commit('Saldos guardados');
    });
  });
}

function sheetReconcile() {
  openSheet('Cuadrar con mi saldo real', `
    <form id="f">
      <p class="muted">Escribe el saldo que te marca Revolut. Solo la <b>diferencia</b> se suma o resta en el bolsillo que elijas; los demás no se tocan.</p>
      <p class="hint">Ej.: la app dice $5,882.17 y Revolut $5,890.00 → los $7.83 que faltan (normalmente rendimientos) se suman a Inversión.</p>
      <div class="row sub"><span>Total en tus bolsillos</span><strong class="num">${money(totalRevolut())}</strong></div>
      ${amountField('amount', 'Saldo real', '', { hint: '', hintId: 'diff' })}
      ${bucketSelect('bucket', 'Ajustar la diferencia en', 'inversion')}
      <button class="btn primary" type="submit">Ajustar</button>
    </form>`, (sheet) => {
    const f = $('#f', sheet);
    const diffEl = $('#diff', sheet);
    const upd = () => {
      const real = parseAmount(f.amount.value, true);
      if (real === null) { diffEl.textContent = ''; return; }
      const d = real - totalRevolut();
      diffEl.innerHTML = d === 0 ? '✓ Ya cuadra perfecto' : `Diferencia: <b class="${d < 0 ? 'neg' : 'pos'}">${money(d, { plus: true })}</b>`;
    };
    f.addEventListener('input', upd);
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const real = parseAmount(f.amount.value, true);
      if (real === null) return toast('Escribe un saldo válido');
      const d = real - totalRevolut();
      if (d === 0) { closeSheet(); return toast('Ya cuadra, no hay nada que ajustar'); }
      const id = f.bucket.value;
      record('ajuste', 'Cuadre con saldo real', { [`b:${id}`]: d }, d, { bucket: id });
      commit('Saldo ajustado');
    });
  });
}

function sheetEntry(id) {
  const e = state.history.find((x) => x.id === id);
  if (!e) return;
  const t = TYPES[e.type] || TYPES.ajuste;
  const rows = Object.entries(e.deltas).map(([k, v]) => {
    const [kind, ref] = k.split(':');
    const name = kind === 'b' ? bucketName(ref) : ((state.investments.find((i) => i.id === ref) || {}).name || e.invName || 'Inversión eliminada');
    const color = kind === 'b' ? BUCKETS[ref].color : 'var(--muted)';
    return `<div class="prev-row"><span class="dot" style="background:${color}"></span><span>${esc(name)}</span><strong class="num ${v < 0 ? 'neg' : 'pos'}">${money(v, { plus: true })}</strong></div>`;
  }).join('');
  const when = new Date(e.ts).toLocaleString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  openSheet(`${t.icon} ${t.label}`, `
    <div><strong style="font-size:17px">${esc(e.desc)}</strong><p class="muted">${when}</p></div>
    <div class="preview">${rows || '<p class="muted">Sin cambios de saldo</p>'}</div>
    <button class="btn danger" data-action="undo" data-id="${e.id}">↩️ Deshacer este movimiento</button>`);
}

/* ---------------- Inversiones extra ---------------- */

function externalOrBucketSelect(name, label) {
  return `
    <label class="field">
      <span>${label}</span>
      <select name="${name}">
        <option value="">Dinero de fuera (no de mis bolsillos)</option>
        ${state.buckets.map((b) => `<option value="${b.id}">${BUCKETS[b.id].icon} ${esc(b.name)}</option>`).join('')}
      </select>
    </label>`;
}

function sheetAddInvestment() {
  openSheet('Nueva inversión', `
    <form id="f">
      ${textField('iname', 'Nombre', 'Ej. Acciones GBM, CETES, Nu…')}
      <div class="seg-radio">
        <label><input type="radio" name="kind" value="variable" checked><span>📊 Valor variable</span></label>
        <label><input type="radio" name="kind" value="fija"><span>🏦 Tasa fija</span></label>
      </div>
      <p class="hint" id="kindHint"></p>
      <label class="field hidden" id="rateField"><span>Tasa anual (%)</span><input name="rate" inputmode="decimal" placeholder="Ej. 10.5"></label>
      ${amountField('amount', 'Monto invertido')}
      ${externalOrBucketSelect('source', '¿De dónde salió el dinero?')}
      <button class="btn primary" type="submit">Agregar</button>
    </form>`, (sheet) => {
    const f = $('#f', sheet);
    const upd = () => {
      const fija = f.kind.value === 'fija';
      $('#rateField', sheet).classList.toggle('hidden', !fija);
      $('#kindHint', sheet).textContent = fija
        ? 'Crece sola cada día con la tasa que pongas (como CETES u otra cuenta de ahorro).'
        : 'Sube y baja (acciones, bolsa, cripto). Tú actualizas su valor cuando quieras.';
    };
    f.addEventListener('change', upd);
    upd();
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = f.iname.value.trim();
      if (!name) return toast('Ponle un nombre');
      const type = f.kind.value;
      let rate = 0;
      if (type === 'fija') {
        rate = Number(f.rate.value.replace(',', '.'));
        if (!Number.isFinite(rate) || rate < 0 || rate > 100) return toast('Escribe una tasa válida');
      }
      const c = parseAmount(f.amount.value, true);
      if (c === null) return toast('Escribe un monto válido');
      const inv = { id: uid(), name, type, rate, amount: 0, lastDate: dayKey(), carry: 0 };
      state.investments.push(inv);
      const deltas = { [`i:${inv.id}`]: c };
      if (f.source.value) deltas[`b:${f.source.value}`] = -c;
      record('inv', `Nueva inversión · ${name}`, deltas, c, { invId: inv.id, invName: name, created: true });
      commit('Inversión agregada');
    });
  });
}

function sheetInvestment(id) {
  const inv = state.investments.find((i) => i.id === id);
  if (!inv) return;
  openSheet(inv.name, `
    <div class="inv-head">
      <p class="big num">${money(inv.amount)}</p>
      <p class="muted">${inv.type === 'fija' ? `Tasa fija · ${fmtPct(inv.rate)} anual · crece sola` : 'Valor variable · actualízalo tú'}</p>
    </div>

    <form id="fValue" class="subform">
      <h4>Actualizar valor</h4>
      <p class="muted">Escribe cuánto vale hoy (por ejemplo, lo que marca tu app de bolsa).</p>
      ${amountField('amount', 'Valor actual')}
      <button class="btn primary" type="submit">Guardar valor</button>
    </form>

    <form id="fMove" class="subform">
      <h4>Aportar o retirar</h4>
      <div class="seg-radio">
        <label><input type="radio" name="dir" value="in" checked><span>Aportar</span></label>
        <label><input type="radio" name="dir" value="out"><span>Retirar</span></label>
      </div>
      ${amountField('amount', 'Monto')}
      ${externalOrBucketSelect('bucket', '¿De dónde sale / a dónde va?')}
      <button class="btn primary" type="submit">Guardar</button>
    </form>

    <form id="fEdit" class="subform">
      <h4>Editar</h4>
      ${textField('iname', 'Nombre', '', inv.name)}
      ${inv.type === 'fija' ? `<label class="field"><span>Tasa anual (%)</span><input name="rate" inputmode="decimal" value="${+inv.rate}"></label>` : ''}
      <button class="btn" type="submit">Guardar cambios</button>
    </form>

    <button class="btn danger" data-action="deleteInv" data-id="${inv.id}">Eliminar inversión</button>`, (sheet) => {
    $('#fValue', sheet).addEventListener('submit', (e) => {
      e.preventDefault();
      const c = parseAmount(e.target.amount.value, true);
      if (c === null) return toast('Escribe un valor válido');
      const d = c - inv.amount;
      if (d === 0) return closeSheet();
      record('inv', `Valor actualizado · ${inv.name}`, { [`i:${inv.id}`]: d }, d, { invId: inv.id, invName: inv.name });
      commit('Valor actualizado');
    });

    $('#fMove', sheet).addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      const c = parseAmount(f.amount.value);
      if (!c) return toast('Escribe un monto válido');
      const out = f.dir.value === 'out';
      if (out && c > inv.amount) return toast('No puedes retirar más de lo que vale');
      const deltas = { [`i:${inv.id}`]: out ? -c : c };
      if (f.bucket.value) deltas[`b:${f.bucket.value}`] = out ? c : -c;
      record('inv', `${out ? 'Retiro de' : 'Aportación a'} ${inv.name}`, deltas, out ? -c : c, { invId: inv.id, invName: inv.name });
      commit(out ? 'Retiro registrado' : 'Aportación registrada');
    });

    $('#fEdit', sheet).addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      const name = f.iname.value.trim();
      if (!name) return toast('Ponle un nombre');
      if (inv.type === 'fija') {
        const rate = Number(f.rate.value.replace(',', '.'));
        if (!Number.isFinite(rate) || rate < 0 || rate > 100) return toast('Escribe una tasa válida');
        runAccruals();
        inv.rate = rate;
      }
      inv.name = name;
      commit('Cambios guardados');
    });
  });
}

/* ---------------- Respaldo ---------------- */

async function exportBackup() {
  const data = JSON.stringify({ ...state, exportedAt: new Date().toISOString() }, null, 2);
  const name = `mi-dinero-respaldo-${dayKey()}.json`;
  const file = new File([data], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Respaldo Mi Dinero' });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

$('#importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const obj = JSON.parse(await file.text());
    if (obj.app !== 'mi-dinero' || !Array.isArray(obj.buckets)) throw new Error('formato');
    if (!confirm('Esto reemplaza TODOS los datos actuales por los del respaldo. ¿Continuar?')) return;
    delete obj.exportedAt;
    state = normalize(obj);
    save();
    runAccruals();
    tab = 'home';
    render();
    toast('Respaldo restaurado');
  } catch (err) {
    toast('Ese archivo no es un respaldo válido de Mi Dinero');
  }
});

/* ---------------- Acciones (clics) ---------------- */

const actions = {
  tab: (el) => { tab = el.dataset.tab; render(); window.scrollTo(0, 0); },
  async currency(el) {
    const c = el.dataset.cur;
    if (c === 'USD' && !fxRate()) {
      toast('Obteniendo tipo de cambio…');
      if (!(await refreshFx(true))) return toast('Sin internet para obtener el tipo de cambio');
    }
    state.currency = c;
    save();
    render();
  },
  add: sheetAdd,
  expense: sheetExpense,
  transfer: sheetTransfer,
  reconcile: sheetReconcile,
  editBalances: sheetEditBalances,
  entry: (el) => sheetEntry(el.dataset.id),
  undo(el) {
    if (!confirm('¿Deshacer este movimiento? Los saldos vuelven a como estaban.')) return;
    undoEntry(el.dataset.id);
    commit('Movimiento deshecho');
  },
  addInv: sheetAddInvestment,
  invDetail: (el) => sheetInvestment(el.dataset.id),
  deleteInv(el) {
    if (!confirm('¿Eliminar esta inversión? Sus movimientos se quedan en el historial.')) return;
    state.investments = state.investments.filter((i) => i.id !== el.dataset.id);
    commit('Inversión eliminada');
  },
  closeSheet,
  fillDefaults: (el) => fillDefaults(el.closest('form')),
  dismissInstall() { state.installHintDismissed = true; save(); render(); },
  redistribute() {
    const form = $('#fBuckets');
    const r = readBucketEditor(form);
    if (r.error) return toast(r.error);
    const total = totalRevolut();
    if (total <= 0) return toast('No hay saldo para redistribuir');
    applyBucketEditor(r.vals);
    const parts = splitByPct(total);
    const lines = state.buckets.map((b, i) => `${b.name}: ${money(parts[i])}`).join('\n');
    if (!confirm(`Tu saldo de ${money(total)} quedará así:\n\n${lines}\n\n¿Continuar?`)) { save(); return render(); }
    const deltas = {};
    state.buckets.forEach((b, i) => { const d = parts[i] - b.balance; if (d) deltas[`b:${b.id}`] = d; });
    record('redistrib', 'Saldo redistribuido', deltas, total);
    save();
    render();
    toast('Saldo redistribuido');
  },
  async fxRefresh() {
    toast('Actualizando…');
    const ok = await refreshFx(true);
    toast(ok ? 'Tipo de cambio actualizado' : 'No se pudo actualizar (¿sin internet?)');
    if (ok && cur() === 'USD' && tab !== 'settings') render();
  },
  export: exportBackup,
  import: () => $('#importFile').click(),
  reset() {
    if (!confirm('¿Seguro? Se borrarán TODOS tus datos de este celular.')) return;
    if (!confirm('Última confirmación: esto no se puede deshacer. ¿Borrar todo?')) return;
    state = defaultState();
    save();
    tab = 'home';
    render();
    toast('Datos borrados');
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const fn = actions[el.dataset.action];
  if (fn) {
    e.preventDefault();
    fn(el);
  }
});

/* ---------------- Toast ---------------- */

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

/* ---------------- Inicio ---------------- */

function refreshIfIdle() {
  if (!sheetRoot.classList.contains('open') && tab !== 'settings') render();
}

runAccruals();
render();
refreshFx().then((ok) => { if (ok && cur() === 'USD') refreshIfIdle(); });

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (runAccruals()) refreshIfIdle();
  refreshFx();
});

if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
