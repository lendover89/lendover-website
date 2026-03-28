/* app.js — TabuCaunt lookup */
'use strict';

const form           = document.getElementById('lookup-form');
const gushInput      = document.getElementById('gush');
const halkaInput     = document.getElementById('halka');
const lookupBtn      = document.getElementById('lookup-btn');
const spinner        = document.getElementById('spinner');
const errorBox       = document.getElementById('error-box');
const notFoundCard   = document.getElementById('not-found-card');
const notFoundText   = document.getElementById('not-found-text');
const resultCard     = document.getElementById('result-card');
const rGush          = document.getElementById('r-gush');
const rHalka         = document.getElementById('r-halka');
const rTotal         = document.getElementById('r-total');
const rType          = document.getElementById('r-type');
const rSummary       = document.getElementById('r-summary');
const breakdownSec   = document.getElementById('breakdown-section');
const breakdownList  = document.getElementById('breakdown-list');
const resetBtn       = document.getElementById('reset-btn');
const resetBtn2      = document.getElementById('reset-btn-2');

const MIN_DISPLAY_MS = 200; // prevent result "flash" on instant responses

// ── Form submission ───────────────────────────────────────────────

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const gush  = gushInput.value.trim();
  const halka = halkaInput.value.trim();

  if (!gush || !halka) {
    showError('נא להזין גוש וחלקה');
    return;
  }

  setLoading(true);
  hideAll();

  const t0 = Date.now();

  try {
    const resp = await fetch('https://tabucaunt.lendover.co.il/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gush, halka }),
      credentials: 'include',
    });

    // Auth required — show login modal and retry
    if (resp.status === 401) {
      setLoading(false);
      await handleAuth401();
      form.dispatchEvent(new Event('submit'));
      return;
    }

    // Rate limited
    if (resp.status === 429) {
      showError('יותר מדי בקשות. נסה שוב בעוד מספר דקות.');
      return;
    }

    const data = await resp.json();

    // Ensure spinner shows for at least MIN_DISPLAY_MS
    const elapsed = Date.now() - t0;
    if (elapsed < MIN_DISPLAY_MS) {
      await delay(MIN_DISPLAY_MS - elapsed);
    }

    if (!resp.ok) {
      showError(data.error || 'שגיאת שרת — נסה שוב');
      return;
    }

    if (!data.found) {
      showNotFound(gush, halka);
      return;
    }

    renderResult(gush, halka, data);
    resultCard.style.display = 'block';

  } catch (_err) {
    showError('שגיאת רשת — בדוק שהשרת פועל ונסה שוב');
  } finally {
    setLoading(false);
  }
});

// ── Render result ────────────────────────────────────────────────

function renderResult(gush, halka, data) {
  rGush.textContent  = gush;
  rHalka.textContent = halka;
  rTotal.textContent = data.total_owners;
  rType.textContent  = data.ownership_type;
  rSummary.textContent =
    'סה"כ ' + data.total_owners + ' רשומות בעלות — גוש ' + gush + ', חלקה ' + halka;

  breakdownList.innerHTML = '';

  if (data.is_mixed && data.breakdown) {
    breakdownSec.style.display = 'block';
    for (const [type, count] of Object.entries(data.breakdown)) {
      const row   = document.createElement('div');
      row.className = 'breakdown-row';

      const label = document.createElement('span');
      label.className   = 'breakdown-label';
      label.textContent = type || 'לא ידוע';

      const pill  = document.createElement('span');
      pill.className   = 'breakdown-count';
      pill.textContent = count;

      row.appendChild(label);
      row.appendChild(pill);
      breakdownList.appendChild(row);
    }
  } else {
    breakdownSec.style.display = 'none';
  }
}

// ── Reset ────────────────────────────────────────────────────────

function doReset() {
  gushInput.value  = '';
  halkaInput.value = '';
  hideAll();
  gushInput.focus();
}

resetBtn.addEventListener('click',  doReset);
resetBtn2.addEventListener('click', doReset);

// ── UI helpers ────────────────────────────────────────────────────

function setLoading(on) {
  spinner.style.display = on ? 'block' : 'none';
  lookupBtn.disabled    = on;
}

function hideAll() {
  errorBox.style.display    = 'none';
  notFoundCard.style.display = 'none';
  resultCard.style.display   = 'none';
}

function showError(msg) {
  errorBox.textContent   = '⚠ ' + msg;
  errorBox.style.display = 'block';
}

function showNotFound(gush, halka) {
  notFoundText.textContent  =
    'לא נמצאו רשומות עבור גוש ' + gush + ', חלקה ' + halka;
  notFoundCard.style.display = 'block';
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
