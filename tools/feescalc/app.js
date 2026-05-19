/* app.js — מחשבון אגרות והיטלי בנייה | lendover.co.il */
'use strict';

const API = location.hostname.endsWith('lendover.co.il')
  ? 'https://feescalc.lendover.co.il'
  : 'http://127.0.0.1:5006';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n).toLocaleString('he-IL', { maximumFractionDigits: 0 });
const fmt2 = (n) => Number(n).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let AUTHORITIES = [];
const STATE = { data: null, area: 0, plot: 0, agraTotal: 0, waterTotal: 0, levyTotal: 0 };

/* ── load authority list ── */
async function loadAuthorities() {
  try {
    const r = await fetch(API + '/api/authorities');
    AUTHORITIES = await r.json();
    const dl = $('authority-list');
    dl.innerHTML = '';
    AUTHORITIES.forEach((a) => {
      const o = document.createElement('option');
      o.value = a.name;
      dl.appendChild(o);
    });
  } catch (e) {
    showError('לא ניתן לטעון את רשימת הרשויות. ודא שהשרת פעיל.');
  }
}

function showError(msg) { const b = $('error-box'); b.textContent = msg; b.style.display = 'block'; }
function clearError() { $('error-box').style.display = 'none'; }

/* ── calculate ── */
async function calculate() {
  clearError();
  const authority = $('authority').value.trim();
  const area = parseFloat($('area').value);
  if (!authority) { showError('בחר רשות מקומית.'); return; }
  if (!AUTHORITIES.some((a) => a.name === authority)) { showError('רשות לא מזוהה — בחר מהרשימה.'); return; }
  if (!area || area <= 0) { showError('הזן שטח בנייה תקין (מ"ר).'); return; }

  $('spinner').style.display = 'block';
  $('result-card').style.display = 'none';
  $('calc-btn').disabled = true;
  try {
    const r = await fetch(API + '/api/fees?authority=' + encodeURIComponent(authority));
    if (!r.ok) throw new Error('http ' + r.status);
    STATE.data = await r.json();
    STATE.area = area;
    STATE.plot = parseFloat($('plot').value) || 0;
    render();
  } catch (e) {
    showError('שגיאה בטעינת התעריפים. נסה שוב.');
  } finally {
    $('spinner').style.display = 'none';
    $('calc-btn').disabled = false;
  }
}

/* ── render result ── */
function render() {
  const d = STATE.data, area = STATE.area;
  const workType = $('work-type').value;

  // צפיפות נגזרת: ≤5 יח"ד/דונם = נמוכה
  const units = parseFloat($('units').value);
  const plot = STATE.plot;
  let density = 'regular', updPerDunam = null;
  if (units > 0 && plot > 0) {
    updPerDunam = units / (plot / 1000);
    density = updPerDunam <= 5 ? 'low' : 'regular';
  }

  $('r-authority').textContent = d.authority;
  $('r-committee').textContent = d.committee || '';

  /* --- אגרות --- */
  const min = d.agra.find((x) => x.item.indexOf('מינימום') > -1);
  const rateItem = workType === 'use'
    ? (d.agra.find((x) => x.item === 'שימוש חורג') || d.agra.find((x) => x.item.indexOf('שימוש חורג') > -1))
    : d.agra.find((x) => x.item.indexOf('בנייה') > -1);
  const lines = $('agra-lines');
  lines.innerHTML = '';
  let agraTotal = 0;
  if (!d.agra.length) {
    lines.innerHTML = '<div class="fee-na">אין תעריפי אגרות מספריים לרשות זו בקטלוג.</div>';
  } else {
    if (min) { agraTotal += min.amount; addLine(lines, 'אגרת מינימום / פתיחת בקשה', '', min.amount); }
    if (rateItem) {
      const sub = rateItem.amount * area;
      agraTotal += sub;
      addLine(lines, rateItem.item, fmt2(rateItem.amount) + ' ₪/מ"ר × ' + fmt(area) + ' מ"ר', sub);
    }
  }
  $('agra-total').textContent = fmt(agraTotal) + ' ₪';
  STATE.agraTotal = agraTotal;

  /* --- דמי הקמה --- */
  const wl = $('water-lines');
  wl.innerHTML = '';
  let waterTotal = 0;
  const w = d.water || {};
  const rate = density === 'low' ? w.setup_low : w.setup_regular;
  if (rate != null) {
    waterTotal = rate * area;
    const densTxt = density === 'low' ? 'צפיפות נמוכה' : 'רגיל';
    const densDetail = updPerDunam != null ? densTxt + ' — ' + fmt2(updPerDunam) + ' יח"ד/דונם' : densTxt + ' (ברירת מחדל)';
    addLine(wl, 'דמי הקמה (' + densDetail + ')' + (w.corporation ? ' — ' + w.corporation : ''),
            fmt2(rate) + ' ₪/מ"ר × ' + fmt(area) + ' מ"ר', waterTotal);
    $('water-total').textContent = fmt(waterTotal) + ' ₪';
    $('water-subtotal-row').style.display = '';
  } else {
    wl.innerHTML = '<div class="fee-na">אין תעריף דמי הקמה מספרי לרשות זו בקטלוג (' +
                   esc(w.corporation || 'תאגיד לא ודאי') + ').</div>';
    $('water-subtotal-row').style.display = 'none';
  }
  STATE.waterTotal = waterTotal;

  renderLevies();

  /* --- disclaimer --- */
  const links = [];
  if (d.permit_url) links.push('<a href="' + esc(d.permit_url.split(' ')[0]) + '" target="_blank" rel="noopener">מקור אגרות</a>');
  if (w.water_url) links.push('<a href="' + esc(w.water_url.split(' ')[0]) + '" target="_blank" rel="noopener">מקור דמי הקמה</a>');
  $('r-disclaimer').innerHTML =
    'כל הסכומים ללא מע"מ. החישוב הוא אומדן בלבד; אינו כולל היטל השבחה. ' +
    'סיווג היטלי הפיתוח אוטומטי — אין להסתמך ללא בדיקה מול הרשות.' +
    (d.effective_date && d.effective_date !== 'לא חולץ' ? ' עדכני לתאריך ' + esc(d.effective_date) + '.' : '') +
    (links.length ? '<br>' + links.join(' &nbsp;|&nbsp; ') : '');

  $('result-card').style.display = '';
  $('result-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ── levies ── */
const TYPE_LABEL = { 'כביש': 'כביש', 'מדרכה': 'מדרכה', 'תיעול': 'תיעול', 'ביוב': 'ביוב',
                     'שצפ': 'שצ"פ', 'מים': 'מים', 'תשתיות': 'תשתיות', 'אחר': 'אחר' };

/* read the physical-question controls into a levy state object */
function readLevyState() {
  const existsYes = document.querySelector('input[name="levy-existing"]:checked').value === 'yes';
  const fate = document.querySelector('input[name="levy-fate"]:checked').value;
  const existing = existsYes ? fate : 'none';
  return {
    existing: existing,
    area: STATE.area,
    plot: STATE.plot,
    demoArea: parseFloat($('demo-area').value) || 0,
    agricultural: $('levy-agri').checked,
  };
}

function renderLevies() {
  const d = STATE.data;
  const block = $('block-levy');
  if (!d.levies || !d.levies.length) {
    block.style.display = 'none';
    STATE.levyTotal = 0;
    $('levy-total').textContent = '0 ₪';
    updateGrand();
    return;
  }
  block.style.display = '';

  const state = readLevyState();
  const list = $('levy-list');
  list.innerHTML = '';

  d.levies.forEach((l, idx) => {
    const q = levyQty(state, l.charge_base);
    const checked = q.ok && levyAutoChecked(l, state);
    let amount = 0, detail = '';
    if (q.ok) {
      amount = q.qty * l.amount * (l.sign === '-' ? -1 : 1);
      const credited = state.existing === 'demolish' && state.demoArea > 0
                       && l.charge_base === 'שטח_מבנה';
      detail = credited
        ? fmt2(l.amount) + ' ₪ × (' + fmt(state.area) + ' − ' + fmt(state.demoArea)
          + ' הריסה) = ' + fmt(q.qty) + ' מ"ר'
        : fmt2(l.amount) + ' ₪ × ' + fmt(q.qty) + ' מ"ר (' + q.basis + ')';
    }
    const comp = levyComponent(l.charge_base);
    const note = (comp === 'land' && state.existing !== 'none')
      ? 'מניחים ששולם בעבר — סמן אם לא' : (l.applies_when || '');

    const row = document.createElement('label');
    row.className = 'levy-item' + (q.ok ? '' : ' levy-item--na');
    const amtText = q.ok
      ? (amount < 0 ? '−' : '') + fmt(Math.abs(amount)) + ' ₪'
      : q.reason;
    row.innerHTML =
      '<input type="checkbox" data-idx="' + idx + '" data-amt="' + (q.ok ? amount : 0) + '"' +
        (checked ? ' checked' : '') + (q.ok ? '' : ' disabled') + '>' +
      '<span class="levy-type-badge">' + esc(TYPE_LABEL[l.levy_type] || l.levy_type) + '</span>' +
      '<span class="levy-desc"><span class="levy-name">' + esc(l.item) + '</span>' +
      (note ? '<small class="levy-when">' + esc(note) + '</small>' : '') +
      (q.ok ? '<small class="levy-when">' + detail + '</small>' : '') +
      '</span>' +
      '<span class="levy-amt' + (amount < 0 ? ' levy-amt--credit' : '') + '">' + amtText + '</span>';
    list.appendChild(row);
  });

  list.querySelectorAll('input[type=checkbox]').forEach((cb) => {
    cb.addEventListener('change', recomputeLevy);
  });
  recomputeLevy();
}

function recomputeLevy() {
  let total = 0;
  $('levy-list').querySelectorAll('input[type=checkbox]:checked').forEach((cb) => {
    total += parseFloat(cb.dataset.amt) || 0;
  });
  STATE.levyTotal = total;
  $('levy-total').textContent = (total < 0 ? '−' : '') + fmt(Math.abs(total)) + ' ₪';
  updateGrand();
}

function updateGrand() {
  const g = STATE.agraTotal + STATE.waterTotal + STATE.levyTotal;
  $('grand-total').textContent = fmt(g);
}

function addLine(container, label, sub, amount) {
  const el = document.createElement('div');
  el.className = 'fee-line';
  el.innerHTML = '<span class="lbl">' + esc(label) + (sub ? ' <small>(' + esc(sub) + ')</small>' : '') +
                 '</span><span class="amt">' + fmt(amount) + ' ₪</span>';
  container.appendChild(el);
}

function reset() {
  $('result-card').style.display = 'none';
  ['authority', 'area', 'units', 'plot', 'demo-area'].forEach((id) => { $(id).value = ''; });
  clearError();
  $('authority').focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

$('calc-btn').addEventListener('click', calculate);
$('reset-btn').addEventListener('click', reset);
$('export-pdf-btn').addEventListener('click', () => window.exportReport());
$('area').addEventListener('keydown', (e) => { if (e.key === 'Enter') calculate(); });
function onLevyControlChange() {
  const existsYes = document.querySelector('input[name="levy-existing"]:checked').value === 'yes';
  $('levy-fate-group').style.display = existsYes ? '' : 'none';
  const demolish = document.querySelector('input[name="levy-fate"]:checked').value === 'demolish';
  $('levy-demo-group').style.display = (existsYes && demolish) ? '' : 'none';
  if (STATE.data) renderLevies();
}
document.querySelectorAll('input[name="levy-existing"], input[name="levy-fate"]')
  .forEach((el) => el.addEventListener('change', onLevyControlChange));
$('levy-agri').addEventListener('change', () => { if (STATE.data) renderLevies(); });
$('demo-area').addEventListener('input', () => { if (STATE.data) renderLevies(); });
loadAuthorities();
