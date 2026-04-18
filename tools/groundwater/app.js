/* app.js — Groundwater depth calculator | lendover.co.il */
'use strict';

const API = 'https://groundwater.lendover.co.il';

// ── Map ────────────────────────────────────────────────────────────
const map = L.map('map', { zoomControl: true, attributionControl: true })
  .setView([32.08, 34.79], 10);   // Tel-Aviv default

L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '© OpenStreetMap',
}).addTo(map);

// Layer groups
const markerLayer  = L.layerGroup().addTo(map);
const polygonLayer = L.featureGroup().addTo(map);
const parcelLayer  = L.layerGroup().addTo(map);
const coverageLayer = L.geoJSON(null, { className: 'aquifer-coverage', interactive: false }).addTo(map);

// Load aquifer coverage once (public endpoint — no auth)
fetch(API + '/api/aquifers').then(r => r.json()).then(data => {
  (data.aquifers || []).forEach(aq => {
    if (aq.extent_wgs84) coverageLayer.addData({
      type: 'Feature',
      geometry: aq.extent_wgs84,
      properties: { name: aq.display_name_he },
    });
  });
}).catch(() => {/* non-critical */});

// ── Tabs ───────────────────────────────────────────────────────────
const tabs = document.querySelectorAll('.tab');
const panes = {
  point:   document.getElementById('pane-point'),
  polygon: document.getElementById('pane-polygon'),
  parcel:  document.getElementById('pane-parcel'),
};
let currentTab = 'point';
tabs.forEach(t => t.addEventListener('click', () => setTab(t.dataset.tab)));

function setTab(name) {
  if (name === currentTab) return;
  currentTab = name;
  tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  Object.entries(panes).forEach(([k, el]) => el.classList.toggle('active', k === name));
  hideResult(); hideMsgs();
  if (name !== 'polygon') stopDrawing();
}

// ── Elements ───────────────────────────────────────────────────────
const resultEl  = document.getElementById('result');
const rTitle    = document.getElementById('result-title');
const rMain     = document.getElementById('result-main');
const rMeta     = document.getElementById('result-meta');
const rNote     = document.getElementById('result-note');
const errorEl   = document.getElementById('error');
const infoEl    = document.getElementById('info');

function showResult() { resultEl.hidden = false; }
function hideResult() { resultEl.hidden = true; }
function hideMsgs() { errorEl.hidden = true; infoEl.hidden = true; }
function showError(msg) { errorEl.textContent = msg; errorEl.hidden = false; }
function showInfo(msg)  { infoEl.textContent  = msg; infoEl.hidden  = false; }

// ── Auth helper ────────────────────────────────────────────────────
async function apiPost(path, body) {
  const resp = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'include',
  });
  if (resp.status === 401 && typeof window.handleAuth401 === 'function') {
    await window.handleAuth401();
    // retry once
    const retry = await fetch(API + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'include',
    });
    return { status: retry.status, data: await retry.json().catch(() => ({})) };
  }
  return { status: resp.status, data: await resp.json().catch(() => ({})) };
}

async function apiGet(path) {
  const resp = await fetch(API + path, { credentials: 'include' });
  if (resp.status === 401 && typeof window.handleAuth401 === 'function') {
    await window.handleAuth401();
    const retry = await fetch(API + path, { credentials: 'include' });
    return { status: retry.status, data: await retry.json().catch(() => ({})) };
  }
  return { status: resp.status, data: await resp.json().catch(() => ({})) };
}

function handleRate(status) {
  if (status === 429) { showError('יותר מדי בקשות. נסה שוב בעוד מספר דקות.'); return true; }
  return false;
}

// ── Render a point result ──────────────────────────────────────────
function renderPointResult(r) {
  hideMsgs();
  rMain.classList.remove('multi');

  if (r.coverage === 'none') {
    rTitle.textContent = 'אין נתונים באזור זה';
    rMain.textContent  = '—';
    rMeta.innerHTML    = '';
    rNote.textContent  = r.message || 'נקודה מחוץ לאקוויפר החוף';
    rNote.hidden = false;
    showResult();
    return;
  }

  if (r.coverage === 'partial' || r.depth == null) {
    rTitle.textContent = 'אין ערך בנקודה זו';
    rMain.textContent  = '—';
    rMeta.innerHTML    = metaHtml([
      ['גובה קרקע (מ׳ מעל פני הים)', r.elevation != null ? r.elevation.toFixed(2) : '—'],
      ['מפלס מי תהום',               r.waterLevel != null ? r.waterLevel.toFixed(2) : '—'],
    ]);
    rNote.textContent = r.message || 'ייתכן שהנקודה רחוקה מקו מפלס מדוד';
    rNote.hidden = false;
    showResult();
    return;
  }

  rTitle.textContent = 'עומק עד מי תהום';
  rMain.textContent  = `${r.depth.toFixed(1)} מ׳`;
  rMeta.innerHTML    = metaHtml([
    ['גובה קרקע',      `${r.elevation.toFixed(2)} מ׳ מעל פני הים`],
    ['מפלס מי תהום',    `${r.waterLevel.toFixed(2)} מ׳ מעל פני הים`],
    ['אקוויפר',         r.aquiferDisplay || r.aquifer || '—'],
  ]);
  if (r.note) {
    rNote.textContent = r.note;
    rNote.hidden = false;
  } else {
    rNote.hidden = true;
  }
  showResult();
}

function renderAreaResult(r, extra) {
  hideMsgs();
  rMain.classList.add('multi');

  if (r.coverage === 'none' || r.pixelCount === 0) {
    rTitle.textContent = 'אין נתונים בשטח זה';
    rMain.classList.remove('multi');
    rMain.textContent  = '—';
    rMeta.innerHTML    = '';
    rNote.textContent  = r.message || 'השטח מחוץ לאזור אקוויפר החוף';
    rNote.hidden = false;
    showResult();
    return;
  }

  rTitle.textContent = extra?.title || 'עומק עד מי תהום בשטח';
  rMain.innerHTML = `
    <div class="stat"><div class="stat-label">מינימום</div><div class="stat-val">${r.min.toFixed(1)} מ׳</div></div>
    <div class="stat"><div class="stat-label">ממוצע</div><div class="stat-val">${r.mean.toFixed(1)} מ׳</div></div>
    <div class="stat"><div class="stat-label">מקסימום</div><div class="stat-val">${r.max.toFixed(1)} מ׳</div></div>
  `;
  const meta = [
    ['אקוויפר', r.aquiferDisplay || r.aquifer || '—'],
    ['פיקסלים במדגם', r.pixelCount.toLocaleString('he-IL')],
  ];
  if (extra?.extraMeta) meta.unshift(...extra.extraMeta);
  rMeta.innerHTML = metaHtml(meta);
  rNote.hidden = true;
  showResult();
}

function metaHtml(pairs) {
  return pairs.map(([k, v]) => `<dt>${escHtml(k)}</dt><dd>${escHtml(v)}</dd>`).join('');
}
function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── POINT: click on map ────────────────────────────────────────────
map.on('click', async (e) => {
  if (currentTab !== 'point') return;
  markerLayer.clearLayers();
  L.marker(e.latlng).addTo(markerLayer);
  hideMsgs(); hideResult();

  const { status, data } = await apiPost('/api/depth/point', {
    x: e.latlng.lng, y: e.latlng.lat, srs: 'EPSG:4326',
  });
  if (handleRate(status)) return;
  if (status === 401) { showError('נדרשת התחברות'); return; }
  if (!String(status).startsWith('2')) { showError(data.message || data.error || 'שגיאה'); return; }
  renderPointResult(data);
});

document.getElementById('clear-point').addEventListener('click', () => {
  markerLayer.clearLayers(); hideResult(); hideMsgs();
});

// ── POLYGON: Leaflet.draw ──────────────────────────────────────────
let drawer = null;
document.getElementById('start-draw').addEventListener('click', () => {
  stopDrawing();
  polygonLayer.clearLayers();
  hideResult(); hideMsgs();
  drawer = new L.Draw.Polygon(map, {
    shapeOptions: { color: '#B8743D', weight: 2, fillOpacity: 0.12 },
    allowIntersection: false,
    showArea: true,
  });
  drawer.enable();
  showInfo('לחץ על המפה כדי להוסיף נקודות. לחיצה כפולה לסיום.');
});

function stopDrawing() {
  if (drawer) { drawer.disable(); drawer = null; }
}

map.on(L.Draw.Event.CREATED, async (e) => {
  stopDrawing();
  const layer = e.layer;
  polygonLayer.addLayer(layer);
  hideMsgs();

  const geometry = layer.toGeoJSON().geometry; // WGS84
  const { status, data } = await apiPost('/api/depth/polygon', { geometry });
  if (handleRate(status)) return;
  if (status === 401) { showError('נדרשת התחברות'); return; }
  if (!String(status).startsWith('2')) { showError(data.message || data.error || 'שגיאה'); return; }
  renderAreaResult(data, { title: 'עומק עד מי תהום בשטח המסומן' });
});

document.getElementById('clear-polygon').addEventListener('click', () => {
  polygonLayer.clearLayers(); stopDrawing(); hideResult(); hideMsgs();
});

// ── PARCEL ─────────────────────────────────────────────────────────
document.getElementById('parcel-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  parcelLayer.clearLayers();
  hideResult(); hideMsgs();

  const gush   = Number(document.getElementById('gush').value);
  const parcel = Number(document.getElementById('parcel').value);
  if (!gush || !parcel) { showError('נא להזין גוש וחלקה'); return; }

  const { status, data } = await apiPost('/api/depth/parcel', { gush, parcel });
  if (handleRate(status)) return;
  if (status === 401) { showError('נדרשת התחברות'); return; }
  if (status === 404) { showError(data.message || 'גוש/חלקה לא נמצאו'); return; }
  if (!String(status).startsWith('2')) { showError(data.message || data.error || 'שגיאה'); return; }

  // Draw parcel
  if (data.geometry) {
    const gj = L.geoJSON(data.geometry, {
      style: { color: '#9A5F2E', weight: 2, fillOpacity: 0.12 },
    }).addTo(parcelLayer);
    const b = gj.getBounds();
    if (b.isValid()) map.fitBounds(b, { maxZoom: 17, padding: [20, 20] });
  }

  renderAreaResult(data, {
    title: `עומק בחלקה ${gush}/${parcel}${data.locality ? ` — ${data.locality}` : ''}`,
    extraMeta: [['גוש/חלקה', `${gush} / ${parcel}`], ['ישוב', data.locality || '—']],
  });
});
