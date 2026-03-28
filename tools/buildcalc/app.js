/* app.js — מחשבון תכסית | frontend logic + SVG rendering */
'use strict';

// ── State ──────────────────────────────────────────────────────────────────────

let currentRing = null;       // outer ring: [[x,y], ...] in ITM coords (open)
let currentSetbacks = [];     // float[] — one per edge
let parcelCache = {};         // cache key → API response
let pendingAbort = null;      // AbortController for debounced setback request
let svgTransform = null;      // current SVG coordinate transform
let leafletMap = null;        // Leaflet map instance (created once)
let parcelPolygon = null;     // L.polygon currently on the map
let streetLayer = null;       // OSM tile layer
let satelliteLayer = null;    // ESRI satellite tile layer

// ITM (EPSG:2039) projection string — matches PARCEL_ALL.prj
const _ITM_PROJ = '+proj=tmerc +lat_0=31.73439361111111 +lon_0=35.20451694444445 +k=1.0000067 +x_0=219529.584 +y_0=626907.39 +ellps=GRS80 +units=m +no_defs';
// Lazy factory — proj4 is loaded after this script
const _toWgs84 = () => proj4(_ITM_PROJ, 'WGS84');

// ── DOM refs ───────────────────────────────────────────────────────────────────

const parcelRowsEl   = document.getElementById('parcel-rows');
const addParcelBtn   = document.getElementById('add-parcel-btn');
const searchBtn      = document.getElementById('search-btn');
const spinner        = document.getElementById('spinner');
const errorBox       = document.getElementById('error-box');
const resultCard     = document.getElementById('result-card');
const setbackList    = document.getElementById('setback-controls');
const setbackWarning = document.getElementById('setback-warning');
const infoNote       = document.getElementById('info-note');
const exportBtn      = document.getElementById('export-svg-btn');
const resetBtn       = document.getElementById('reset-btn');
const svg            = document.getElementById('parcel-svg');

const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_W  = 600;
const SVG_H  = 460;
const PAD    = 62;   // pixels inside viewBox

// ── Helpers ────────────────────────────────────────────────────────────────────

function edgeLength(p1, p2) {
  const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
  return Math.sqrt(dx * dx + dy * dy);
}

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.style.display = 'block';
}

function hideError() {
  errorBox.style.display = 'none';
  errorBox.textContent = '';
}

function setSearching(on) {
  spinner.style.display = on ? 'block' : 'none';
  searchBtn.disabled = on;
}

// ── SVG coordinate transform ───────────────────────────────────────────────────

function buildTransform(ring) {
  const xs = ring.map(p => p[0]);
  const ys = ring.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;

  let scale = Math.min(
    (SVG_W - 2 * PAD) / rangeX,
    (SVG_H - 2 * PAD) / rangeY
  );
  scale = Math.min(scale, 5000); // guard against degenerate tiny parcels

  const drawW = rangeX * scale;
  const drawH = rangeY * scale;
  const offsetX = (SVG_W - drawW) / 2;
  const offsetY = (SVG_H - drawH) / 2;
  return { scale, minX, minY, offsetX, offsetY };
}

// ITM → SVG (flips Y because SVG Y grows downward, ITM Y grows upward)
function itmToSvg(x, y, t) {
  return [
    t.offsetX + (x - t.minX) * t.scale,
    SVG_H - t.offsetY - (y - t.minY) * t.scale
  ];
}

// ── SVG element creation helpers ───────────────────────────────────────────────

function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function svgText(x, y, text, attrs = {}) {
  const el = svgEl('text', {
    x, y,
    'text-anchor': 'middle',
    'dominant-baseline': 'central',
    'font-size': '11',
    'font-family': 'Heebo, Arial, sans-serif',
    fill: '#3C3C3C',
    ...attrs,
  });
  el.textContent = text;
  return el;
}

// ── SVG rendering ──────────────────────────────────────────────────────────────

function renderSVG(outerRing, innerRing, validInner) {
  // Clear
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  const t = buildTransform(outerRing);
  svgTransform = t;

  const n = outerRing.length;
  const outerSvg = outerRing.map(p => itmToSvg(p[0], p[1], t));

  // Centroid in SVG space (for outward label offsets)
  const cx = outerSvg.reduce((s, p) => s + p[0], 0) / n;
  const cy = outerSvg.reduce((s, p) => s + p[1], 0) / n;

  // ── Outer fill polygon ──
  svg.appendChild(svgEl('polygon', {
    points: outerSvg.map(p => p.join(',')).join(' '),
    fill: 'rgba(184,116,61,0.12)',
    stroke: 'none',
  }));

  // ── Inner setback polygon + edge labels ──
  if (validInner && innerRing && innerRing.length >= 3) {
    const innerSvg = innerRing.map(p => itmToSvg(p[0], p[1], t));
    const ni = innerRing.length;

    svg.appendChild(svgEl('polygon', {
      points: innerSvg.map(p => p.join(',')).join(' '),
      fill: 'rgba(91,200,196,0.22)',
      stroke: '#5BC8C4',
      'stroke-width': '1.5',
      'stroke-dasharray': '6,3',
    }));

    // Inner centroid (for inward label direction)
    const icx = innerSvg.reduce((s, p) => s + p[0], 0) / ni;
    const icy = innerSvg.reduce((s, p) => s + p[1], 0) / ni;

    for (let i = 0; i < ni; i++) {
      const ip1 = innerSvg[i];
      const ip2 = innerSvg[(i + 1) % ni];
      const mx = (ip1[0] + ip2[0]) / 2;
      const my = (ip1[1] + ip2[1]) / 2;
      // Push label inward (toward centroid)
      const idx = icx - mx, idy = icy - my;
      const id = Math.sqrt(idx * idx + idy * idy) || 1;
      const lx = mx + (idx / id) * 20;
      const ly = my + (idy / id) * 20;

      const itmI1 = innerRing[i];
      const itmI2 = innerRing[(i + 1) % ni];
      const ilen = edgeLength(itmI1, itmI2);

      svg.appendChild(svgEl('rect', {
        x: lx - 18, y: ly - 8, width: 36, height: 16, rx: 3,
        fill: 'rgba(224,247,246,0.90)', stroke: 'none',
      }));
      svg.appendChild(svgText(lx, ly, `${ilen.toFixed(1)}מ'`, {
        'font-size': '10', fill: '#1E5C59',
      }));
    }
  }

  // ── Outer edges (individual lines for per-edge highlighting) + labels ──
  for (let i = 0; i < n; i++) {
    const p1 = outerSvg[i];
    const p2 = outerSvg[(i + 1) % n];

    // Edge line
    const line = svgEl('line', {
      x1: p1[0], y1: p1[1],
      x2: p2[0], y2: p2[1],
      stroke: '#B8743D',
      'stroke-width': '2',
      'stroke-linecap': 'round',
    });
    line.id = `edge-line-${i}`;
    svg.appendChild(line);

    // Edge length label — positioned outward from centroid
    const mx = (p1[0] + p2[0]) / 2;
    const my = (p1[1] + p2[1]) / 2;
    const odx = mx - cx, ody = my - cy;
    const od = Math.sqrt(odx * odx + ody * ody) || 1;
    const labelX = mx + (odx / od) * 24;
    const labelY = my + (ody / od) * 24;

    // Length in ITM = meters
    const itmP1 = outerRing[i];
    const itmP2 = outerRing[(i + 1) % n];
    const len = edgeLength(itmP1, itmP2);

    // Background rect for readability
    const bg = svgEl('rect', {
      x: labelX - 18, y: labelY - 8,
      width: 36, height: 16,
      rx: 3,
      fill: 'rgba(255,255,255,0.82)',
      stroke: 'none',
    });
    svg.appendChild(bg);
    svg.appendChild(svgText(labelX, labelY, `${len.toFixed(1)}מ'`, { 'font-size': '10', fill: '#5A3A1A' }));
  }

  // ── Vertex dots ──
  for (let i = 0; i < n; i++) {
    const [vx, vy] = outerSvg[i];
    svg.appendChild(svgEl('circle', {
      cx: vx, cy: vy, r: 3,
      fill: '#B8743D',
    }));
  }
}

// ── Highlight edge ─────────────────────────────────────────────────────────────

function highlightEdge(idx, on) {
  const line = document.getElementById(`edge-line-${idx}`);
  if (!line) return;
  if (on) {
    line.setAttribute('stroke', '#E74C3C');
    line.setAttribute('stroke-width', '3.5');
  } else {
    line.setAttribute('stroke', '#B8743D');
    line.setAttribute('stroke-width', '2');
  }
  // Also highlight the setback-row
  const row = document.getElementById(`setback-row-${idx}`);
  if (row) row.classList.toggle('highlighted', on);
}

// ── Setback controls ───────────────────────────────────────────────────────────

function renderSetbackControls(ring) {
  setbackList.innerHTML = '';
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const len = edgeLength(ring[i], ring[(i + 1) % n]);
    const row = document.createElement('div');
    row.className = 'setback-row';
    row.id = `setback-row-${i}`;

    row.innerHTML = `
      <span class="edge-num">${i + 1}</span>
      <span class="edge-label">${len.toFixed(1)} מ'</span>
      <input type="number" class="setback-input" id="setback-input-${i}"
             data-edge="${i}"
             value="${currentSetbacks[i].toFixed(1)}"
             min="0" max="${(len / 2 - 0.01).toFixed(2)}" step="0.1">
      <span class="unit-label">מ'</span>
    `;
    setbackList.appendChild(row);

    const inp = row.querySelector('.setback-input');
    inp.addEventListener('focus', () => highlightEdge(i, true));
    inp.addEventListener('blur',  () => highlightEdge(i, false));
    inp.addEventListener('input', debounceSetback);
    inp.addEventListener('change', debounceSetback);
  }
}

// ── Debounced setback request ──────────────────────────────────────────────────

let _debounceTimer = null;

function debounceSetback() {
  if (_debounceTimer) clearTimeout(_debounceTimer);
  // Cancel any in-flight request
  if (pendingAbort) { pendingAbort.abort(); pendingAbort = null; }
  _debounceTimer = setTimeout(requestSetback, 300);
}

async function requestSetback() {
  if (!currentRing) return;

  // Collect current values from inputs
  const inputs = setbackList.querySelectorAll('.setback-input');
  inputs.forEach(inp => {
    const i = parseInt(inp.dataset.edge);
    currentSetbacks[i] = Math.max(0, parseFloat(inp.value) || 0);
  });

  pendingAbort = new AbortController();
  try {
    const resp = await fetch('https://buildcalc.lendover.co.il/api/setback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rings: [currentRing], setbacks: currentSetbacks }),
      signal: pendingAbort.signal,
      credentials: 'include',
    });

    // Auth required — show login modal and retry
    if (resp.status === 401) {
      await handleAuth401();
      requestSetback();
      return;
    }

    // Rate limited
    if (resp.status === 429) {
      showSetbackWarning('יותר מדי בקשות. נסה שוב בעוד מספר דקות.');
      return;
    }

    const data = await resp.json();
    if (!data.success) {
      showSetbackWarning(data.error || 'שגיאה לא ידועה');
      return;
    }
    updateSetbackResult(data);
  } catch (e) {
    if (e.name !== 'AbortError') {
      showSetbackWarning('שגיאת תקשורת — נסה שוב');
    }
  } finally {
    pendingAbort = null;
  }
}

function updateSetbackResult(data) {
  if (!data.valid) {
    showSetbackWarning(data.warning || 'הנסיגה לא תקינה');
    renderSVG(currentRing, null, false);
    updateCoverageUI({ inner_area: 0, coverage_pct: 0, outer_area: data.outer_area });
    return;
  }

  hideSetbackWarning();
  renderSVG(currentRing, data.inner_ring, true);
  updateCoverageUI(data);
}

function showSetbackWarning(msg) {
  setbackWarning.textContent = msg;
  setbackWarning.style.display = 'block';
  setbackWarning.className = 'warnings-note error-note';
}

function hideSetbackWarning() {
  setbackWarning.style.display = 'none';
}

function updateCoverageUI(data) {
  document.getElementById('cov-inner-area').textContent =
    data.inner_area > 0 ? data.inner_area.toFixed(1) : '—';
  document.getElementById('cov-pct').textContent =
    data.coverage_pct > 0 ? data.coverage_pct.toFixed(1) : '—';
  document.getElementById('cov-outer-area').textContent =
    data.outer_area > 0 ? data.outer_area.toFixed(1) : '—';
}

// ── Preset buttons ─────────────────────────────────────────────────────────────

document.querySelectorAll('.preset-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const val = parseFloat(btn.dataset.val);
    setbackList.querySelectorAll('.setback-input').forEach(inp => {
      inp.value = val.toFixed(1);
    });
    if (_debounceTimer) clearTimeout(_debounceTimer);
    if (pendingAbort) { pendingAbort.abort(); pendingAbort = null; }
    requestSetback();
  });
});

// ── Parcel row management ──────────────────────────────────────────────────────

function addParcelRow(gush = '', parcel = '') {
  const row = document.createElement('div');
  row.className = 'parcel-row';
  row.innerHTML = `
    <div class="field-group">
      <label>גוש</label>
      <input type="number" class="gush-input" placeholder="למשל: 6144"
             min="1" max="999999" value="${gush}">
    </div>
    <div class="field-group">
      <label>חלקה</label>
      <input type="number" class="parcel-input" placeholder="למשל: 60"
             min="1" max="99999" value="${parcel}">
    </div>
    <button class="remove-parcel-btn" title="הסר שורה">✕</button>
  `;
  parcelRowsEl.appendChild(row);

  // Enter key on any input triggers search
  row.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') searchParcel(); });
  });

  row.querySelector('.remove-parcel-btn').addEventListener('click', () => {
    row.remove();
    updateRemoveButtons();
  });

  updateRemoveButtons();
}

function updateRemoveButtons() {
  const rows = parcelRowsEl.querySelectorAll('.parcel-row');
  rows.forEach(row => {
    row.querySelector('.remove-parcel-btn').style.display =
      rows.length > 1 ? 'inline-block' : 'none';
  });
}

function getParcelInputs() {
  const rows = parcelRowsEl.querySelectorAll('.parcel-row');
  const items = [];
  for (const row of rows) {
    const gush   = parseInt(row.querySelector('.gush-input').value);
    const parcel = parseInt(row.querySelector('.parcel-input').value);
    items.push({ gush, parcel });
  }
  return items;
}

// ── Parcel search ──────────────────────────────────────────────────────────────

async function searchParcel() {
  const items = getParcelInputs();

  // Client-side validation
  for (const { gush, parcel } of items) {
    if (!gush || gush < 1 || gush > 999999) {
      showError('הזן מספר גוש תקין (1–999999)');
      return;
    }
    if (!parcel || parcel < 1 || parcel > 99999) {
      showError('הזן מספר חלקה תקין (1–99999)');
      return;
    }
  }

  hideError();

  // Cache key: sorted "gush-parcel" pairs joined by "_"
  const cacheKey = items.map(i => `${i.gush}-${i.parcel}`).sort().join('_');
  if (parcelCache[cacheKey]) {
    displayParcel(parcelCache[cacheKey]);
    return;
  }

  setSearching(true);
  try {
    const body = items.length === 1
      ? { gush: items[0].gush, parcel: items[0].parcel }
      : { parcels: items };

    const resp = await fetch('https://buildcalc.lendover.co.il/api/parcel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'include',
    });

    // Auth required — show login modal and retry
    if (resp.status === 401) {
      setSearching(false);
      await handleAuth401();
      searchParcel();
      return;
    }

    // Rate limited
    if (resp.status === 429) {
      showError('יותר מדי בקשות. נסה שוב בעוד מספר דקות.');
      return;
    }

    const data = await resp.json();
    if (!data.success) {
      showError(data.error || 'חלקה לא נמצאה');
      return;
    }
    parcelCache[cacheKey] = data;
    displayParcel(data);
  } catch (e) {
    showError('שגיאת תקשורת — בדוק חיבור לאינטרנט');
  } finally {
    setSearching(false);
  }
}

function displayParcel(data) {
  // Fill info fields
  document.getElementById('info-gush').textContent     = data.gush;
  document.getElementById('info-parcel').textContent   = data.parcel;
  document.getElementById('info-legal-area').textContent =
    data.legal_area > 0 ? data.legal_area.toFixed(1) : '—';
  document.getElementById('info-computed-area').textContent =
    data.computed_area > 0 ? data.computed_area.toFixed(1) : '—';

  // Info note (merged parcel, multi-part, etc.)
  if (data.info) {
    infoNote.textContent = data.info;
    infoNote.style.display = 'block';
  } else {
    infoNote.style.display = 'none';
  }

  // Set up ring + setbacks
  currentRing = data.rings[0].map(p => [p[0], p[1]]);
  // Strip closing point if present
  if (currentRing.length > 1) {
    const first = currentRing[0], last = currentRing[currentRing.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) {
      currentRing = currentRing.slice(0, -1);
    }
  }

  const n = currentRing.length;
  currentSetbacks = new Array(n).fill(1.0);

  // Show result card
  resultCard.style.display = 'block';
  resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Render SVG (initial, without inner polygon)
  renderSVG(currentRing, null, false);

  // Update map / reset view
  const onMap = document.querySelector('.view-btn[data-view="map"]')?.classList.contains('active');
  if (parcelPolygon) { parcelPolygon.remove(); parcelPolygon = null; }
  if (onMap) {
    updateMap(currentRing);
  } else {
    document.querySelectorAll('.view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === 'svg'));
    document.getElementById('svg-container').style.display = '';
    document.getElementById('map-container').style.display = 'none';
  }

  // Render setback controls
  renderSetbackControls(currentRing);

  // Request initial setback calculation
  requestSetback();
}

// ── Leaflet map ────────────────────────────────────────────────────────────────

function initMap() {
  if (leafletMap) return;
  leafletMap = L.map('parcel-map', { center: [31.5, 34.8], zoom: 7 });
  streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 21,
  }).addTo(leafletMap);
  satelliteLayer = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { attribution: '© Esri', maxZoom: 21 }
  );
}

function updateMap(ring) {
  initMap();
  if (parcelPolygon) { parcelPolygon.remove(); parcelPolygon = null; }
  const toWgs = _toWgs84();
  const latlngs = ring.map(p => { const [lon, lat] = toWgs.forward(p); return [lat, lon]; });
  parcelPolygon = L.polygon(latlngs, {
    color: '#B8743D', weight: 2.5,
    fillColor: '#B8743D', fillOpacity: 0.15,
  }).addTo(leafletMap);
  leafletMap.fitBounds(parcelPolygon.getBounds(), { padding: [20, 20] });
}

// ── View toggle + Map layer toggle — event delegation ─────────────────────────

document.addEventListener('click', e => {
  const viewBtn = e.target.closest('.view-btn');
  if (viewBtn) {
    const view = viewBtn.dataset.view;
    document.querySelectorAll('.view-btn').forEach(b => b.classList.toggle('active', b === viewBtn));
    document.getElementById('svg-container').style.display = view === 'svg' ? '' : 'none';
    document.getElementById('map-container').style.display = view === 'map' ? '' : 'none';
    if (view === 'map' && currentRing) {
      updateMap(currentRing);
      requestAnimationFrame(() => leafletMap && leafletMap.invalidateSize());
    }
    return;
  }

  const layerBtn = e.target.closest('.map-layer-btn');
  if (layerBtn && leafletMap) {
    const layer = layerBtn.dataset.layer;
    document.querySelectorAll('.map-layer-btn').forEach(b => b.classList.toggle('active', b === layerBtn));
    if (layer === 'satellite') {
      leafletMap.removeLayer(streetLayer);
      satelliteLayer.addTo(leafletMap);
    } else {
      leafletMap.removeLayer(satelliteLayer);
      streetLayer.addTo(leafletMap);
    }
  }
});

// ── SVG Export ─────────────────────────────────────────────────────────────────

exportBtn.addEventListener('click', () => {
  const svgEl2 = document.getElementById('parcel-svg');
  const serializer = new XMLSerializer();
  let svgStr = serializer.serializeToString(svgEl2);

  // Add XML declaration and font import
  const header = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n`;
  svgStr = header + svgStr;

  const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const items = getParcelInputs().filter(i => i.gush && i.parcel);
  const label = items.length === 1
    ? `גוש${items[0].gush}_חלקה${items[0].parcel}`
    : items.map(i => `${i.gush}-${i.parcel}`).join('_');
  a.href = url;
  a.download = `תכסית_${label}.svg`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

// ── Reset ──────────────────────────────────────────────────────────────────────

resetBtn.addEventListener('click', () => {
  resultCard.style.display = 'none';
  currentRing = null;
  currentSetbacks = [];
  if (parcelPolygon) { parcelPolygon.remove(); parcelPolygon = null; }
  setbackList.innerHTML = '';
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  hideSetbackWarning();
  // Restore single empty parcel row
  parcelRowsEl.innerHTML = '';
  addParcelRow();
  parcelRowsEl.querySelector('.gush-input').focus();
});

// ── Event listeners ────────────────────────────────────────────────────────────

searchBtn.addEventListener('click', searchParcel);
addParcelBtn.addEventListener('click', () => addParcelRow());

// ── Init: create first parcel row ──────────────────────────────────────────────

addParcelRow();
