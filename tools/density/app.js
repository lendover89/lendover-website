/* app.js — Density (חישוב צפיפות) */
'use strict';

const MAX_PARCELS = 10;
const API_URL     = 'https://density.lendover.co.il/lookup';
const MIN_DISPLAY_MS = 200;

const form           = document.getElementById('lookup-form');
const rowsContainer  = document.getElementById('rows-container');
const addRowBtn      = document.getElementById('add-row-btn');
const rowsCounter    = document.getElementById('rows-counter');
const lookupBtn      = document.getElementById('lookup-btn');
const spinner        = document.getElementById('spinner');
const errorBox       = document.getElementById('error-box');
const notFoundCard   = document.getElementById('not-found-card');
const notFoundText   = document.getElementById('not-found-text');
const resultCard     = document.getElementById('result-card');
const aggregateBox   = document.getElementById('aggregate-box');
const aggSubs        = document.getElementById('agg-subs');
const aggArea        = document.getElementById('agg-area');
const aggDensity     = document.getElementById('agg-density');
const aggNote        = document.getElementById('agg-note');
const resultsTbody   = document.getElementById('results-tbody');
const resetBtn       = document.getElementById('reset-btn');
const resetBtn2      = document.getElementById('reset-btn-2');

let map = null;
let layerGroup = null;

// ── Row management ───────────────────────────────────────────────

function addRow(initialGush = '', initialParcel = '') {
  const rows = rowsContainer.querySelectorAll('.parcel-row');
  if (rows.length >= MAX_PARCELS) return;

  const row = document.createElement('div');
  row.className = 'parcel-row';
  row.innerHTML = `
    <div class="field-group">
      <label>גוש</label>
      <input type="text" inputmode="numeric" class="row-gush" placeholder="למשל 6341" autocomplete="off" value="${initialGush}" />
    </div>
    <div class="field-group">
      <label>חלקה</label>
      <input type="text" inputmode="numeric" class="row-parcel" placeholder="למשל 100" autocomplete="off" value="${initialParcel}" />
    </div>
    <button type="button" class="btn-remove-row" title="הסר חלקה" aria-label="הסר חלקה">×</button>
  `;
  rowsContainer.appendChild(row);
  row.querySelector('.btn-remove-row').addEventListener('click', () => {
    if (rowsContainer.querySelectorAll('.parcel-row').length <= 1) return;
    row.remove();
    updateRowsState();
  });
  updateRowsState();
}

function updateRowsState() {
  const rows = rowsContainer.querySelectorAll('.parcel-row');
  const count = rows.length;
  rowsCounter.textContent = `חלקה ${count} מתוך מקסימום ${MAX_PARCELS}`;
  addRowBtn.disabled = count >= MAX_PARCELS;
  // hide remove button on first row when only one row
  rows.forEach((r, i) => {
    const btn = r.querySelector('.btn-remove-row');
    btn.style.visibility = (count === 1) ? 'hidden' : 'visible';
  });
}

addRowBtn.addEventListener('click', () => addRow());

// initial row
addRow();

// ── Submit ────────────────────────────────────────────────────────

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const rows = Array.from(rowsContainer.querySelectorAll('.parcel-row'));
  const parcels = [];
  for (const r of rows) {
    const gush = r.querySelector('.row-gush').value.trim();
    const parcel = r.querySelector('.row-parcel').value.trim();
    if (!gush && !parcel) continue;  // skip empty rows
    if (!gush || !parcel) {
      showError('כל שורה חייבת לכלול גם גוש וגם חלקה');
      return;
    }
    if (!/^\d+$/.test(gush) || !/^\d+$/.test(parcel)) {
      showError('גוש וחלקה חייבים להיות מספרים שלמים');
      return;
    }
    parcels.push({ gush, parcel });
  }
  if (parcels.length === 0) {
    showError('נא להזין לפחות חלקה אחת');
    return;
  }

  setLoading(true);
  hideAll();
  const t0 = Date.now();

  try {
    const resp = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parcels }),
      credentials: 'include',
    });

    if (resp.status === 401) {
      setLoading(false);
      await handleAuth401();
      form.dispatchEvent(new Event('submit'));
      return;
    }

    if (resp.status === 429) {
      showError('יותר מדי בקשות. נסה שוב בעוד מספר דקות.');
      return;
    }

    const data = await resp.json();

    const elapsed = Date.now() - t0;
    if (elapsed < MIN_DISPLAY_MS) await delay(MIN_DISPLAY_MS - elapsed);

    if (!resp.ok) {
      showError(data.error || 'שגיאת שרת — נסה שוב');
      return;
    }

    if (!data.results || data.results.length === 0) {
      showNotFound(parcels);
      return;
    }

    renderResults(data);
    resultCard.style.display = 'block';
    resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });

  } catch (_err) {
    showError('שגיאת רשת — בדוק שהשרת פועל ונסה שוב');
  } finally {
    setLoading(false);
  }
});

// ── Render ────────────────────────────────────────────────────────

function renderResults(data) {
  // Aggregate
  const agg = data.aggregate || {};
  const isCompound = data.results.length > 1;

  if (isCompound) {
    aggregateBox.style.display = 'block';
    aggSubs.textContent = (agg.total_subparcels ?? 0).toLocaleString('he-IL');
    aggArea.textContent = (agg.total_area_dunam ?? 0).toLocaleString('he-IL', { maximumFractionDigits: 3 });
    aggDensity.textContent = (agg.density != null) ? agg.density.toLocaleString('he-IL', { maximumFractionDigits: 2 }) : '—';
    if (agg.missing_count > 0) {
      aggNote.textContent = `${agg.missing_count} חלקות לא נמצאו ולא נכללו בחישוב המצרפי`;
      aggNote.style.display = 'block';
    } else {
      aggNote.style.display = 'none';
    }
  } else {
    aggregateBox.style.display = 'none';
  }

  // Table
  resultsTbody.innerHTML = '';
  for (const r of data.results) {
    const tr = document.createElement('tr');
    if (!r.found) {
      tr.className = 'row-missing';
      tr.innerHTML = `
        <td>${r.gush_num}</td>
        <td>${r.parcel}</td>
        <td colspan="4" class="missing-cell">לא נמצא</td>
      `;
    } else {
      const subs = r.num_subparcels ?? 0;
      const subsClass = subs === 0 ? 'cell-zero' : '';
      tr.innerHTML = `
        <td>${r.gush_num}</td>
        <td>${r.parcel}</td>
        <td class="${subsClass}">${subs.toLocaleString('he-IL')}</td>
        <td>${r.area_dunam != null ? r.area_dunam.toLocaleString('he-IL', { maximumFractionDigits: 3 }) : '—'}</td>
        <td><strong>${r.density != null ? r.density.toLocaleString('he-IL', { maximumFractionDigits: 2 }) : '—'}</strong></td>
        <td class="cell-locality">${escapeHtml(r.address || r.locality || '—')}</td>
      `;
    }
    resultsTbody.appendChild(tr);
  }

  // Map
  renderMap(data.results.filter(r => r.found && r.geometry));
}

function renderMap(items) {
  if (!map) {
    map = L.map('map', { zoomControl: true, scrollWheelZoom: false }).setView([31.7, 35.0], 8);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
  }
  if (layerGroup) {
    layerGroup.clearLayers();
  } else {
    layerGroup = L.layerGroup().addTo(map);
  }

  if (items.length === 0) {
    document.getElementById('map').style.display = 'none';
    return;
  }
  document.getElementById('map').style.display = 'block';
  map.invalidateSize();

  const allBounds = [];
  for (const r of items) {
    const layer = L.geoJSON(r.geometry, {
      style: {
        color: '#9A5F2E',
        weight: 2,
        opacity: 1,
        fillColor: '#B8743D',
        fillOpacity: 0.4,
      }
    }).bindPopup(buildPopup(r));
    layerGroup.addLayer(layer);
    try {
      allBounds.push(layer.getBounds());
    } catch (_e) {}
  }
  if (allBounds.length > 0) {
    let union = allBounds[0];
    for (let i = 1; i < allBounds.length; i++) union = union.extend(allBounds[i]);
    map.fitBounds(union, { padding: [20, 20], maxZoom: 18 });
  }
}

function buildPopup(r) {
  const subs = r.num_subparcels ?? 0;
  return `
    <div style="font-family:Heebo,sans-serif;direction:rtl;text-align:right;min-width:180px">
      <div style="font-weight:700;font-size:0.95rem;margin-bottom:4px">גוש ${r.gush_num} חלקה ${r.parcel}</div>
      <div style="font-size:0.85rem;color:#666">${escapeHtml(r.address || r.locality || '')}</div>
      <hr style="margin:6px 0;border:none;border-top:1px solid #eee">
      <div style="font-size:0.85rem">דירות: <strong>${subs}</strong></div>
      <div style="font-size:0.85rem">שטח: <strong>${r.area_dunam != null ? r.area_dunam.toFixed(3) : '—'}</strong> דונם</div>
      <div style="font-size:0.95rem;color:#9A5F2E;margin-top:4px">צפיפות: <strong>${r.density != null ? r.density.toFixed(2) : '—'}</strong> יח'/ד'</div>
    </div>
  `;
}

// ── Reset ────────────────────────────────────────────────────────

function doReset() {
  rowsContainer.innerHTML = '';
  addRow();
  hideAll();
  if (layerGroup) layerGroup.clearLayers();
  document.getElementById('rows-container').scrollIntoView({ behavior: 'smooth' });
}

resetBtn.addEventListener('click',  doReset);
resetBtn2.addEventListener('click', doReset);

// ── UI helpers ───────────────────────────────────────────────────

function setLoading(on) {
  spinner.style.display = on ? 'block' : 'none';
  lookupBtn.disabled    = on;
}

function hideAll() {
  errorBox.style.display     = 'none';
  notFoundCard.style.display = 'none';
  resultCard.style.display   = 'none';
}

function showError(msg) {
  errorBox.textContent   = '⚠ ' + msg;
  errorBox.style.display = 'block';
}

function showNotFound(parcels) {
  const txt = parcels.length === 1
    ? `לא נמצאו נתונים עבור גוש ${parcels[0].gush}, חלקה ${parcels[0].parcel}`
    : `לא נמצאו נתונים עבור אף אחת מ-${parcels.length} החלקות שהוזנו`;
  notFoundText.textContent = txt;
  notFoundCard.style.display = 'block';
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[m]));
}
