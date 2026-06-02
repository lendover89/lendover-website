// מדידת דירות — frontend logic

// ----- config -----
// For preview: connect to local Flask on 5050.
// In production change to: 'https://apartments.lendover.co.il'
const IS_LOCAL = ['localhost', '127.0.0.1', ''].includes(window.location.hostname);
const API_BASE = IS_LOCAL
  ? 'http://127.0.0.1:5050'
  : 'https://planmeter.lendover.co.il';
const POLL_INTERVAL_MS = 3000;
const MAX_FILE_MB = 50;
const EXPECTED_TOTAL_SEC = 150;  // typical end-to-end on warm Modal
const SLOW_AFTER_SEC = 240;      // show "still working, scan deep" hint
const TICK_MS = 500;

// ----- elements -----
const $ = (id) => document.getElementById(id);
const dropZone = $('drop-zone');
const fileInput = $('file-input');
const selFile = $('selected-file');
const fileName = $('file-name');
const fileSize = $('file-size');
const fileClear = $('file-clear');
const tosCb = $('tos-cb');
const convertBtn = $('convert-btn');
const spinner = $('spinner');
const spinnerMsg = $('spinner-msg');
const progressFill = $('progress-fill');
const progressPct = $('progress-pct');
const errorBox = $('error-box');
const resultCard = $('result-card');
const rTotal = $('r-total');
const pagesList = $('pages-list');
const resetBtn = $('reset-btn');

let chosen = null;
let pollTimer = null;
let progressTimer = null;
let jobStartedAt = null;

// ----- file selection -----
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  if (e.dataTransfer.files.length) setFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', (e) => {
  if (e.target.files.length) setFile(e.target.files[0]);
});
fileClear.addEventListener('click', clearFile);
tosCb.addEventListener('change', refreshBtn);

function setFile(f) {
  errorBox.style.display = 'none';
  const ext = (f.name || '').toLowerCase().split('.').pop();
  if (ext !== 'pdf') {
    showError('יש להעלות קובץ PDF בלבד');
    return;
  }
  if (f.size > MAX_FILE_MB * 1024 * 1024) {
    showError(`הקובץ גדול מ-${MAX_FILE_MB} מגה`);
    return;
  }
  chosen = f;
  fileName.textContent = f.name;
  fileSize.textContent = `(${(f.size / 1024 / 1024).toFixed(1)} מגה)`;
  selFile.style.display = 'flex';
  refreshBtn();
}

function clearFile() {
  chosen = null;
  fileInput.value = '';
  selFile.style.display = 'none';
  refreshBtn();
}

function refreshBtn() {
  convertBtn.disabled = !(chosen && tosCb.checked);
}

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.style.display = 'block';
}

// ----- upload + poll -----
convertBtn.addEventListener('click', async () => {
  if (!chosen || !tosCb.checked) return;
  errorBox.style.display = 'none';
  convertBtn.disabled = true;
  spinner.style.display = 'block';
  spinnerMsg.textContent = 'מעלה תשריט…';
  jobStartedAt = Date.now();
  startProgress();

  const fd = new FormData();
  fd.append('file', chosen);
  fd.append('tos_accepted', 'true');

  let job;
  try {
    const resp = await fetch(`${API_BASE}/api/upload`, { method: 'POST', body: fd });
    job = await resp.json();
    if (!resp.ok) throw new Error(job.error || `שגיאה ${resp.status}`);
  } catch (e) {
    spinner.style.display = 'none';
    showError('כשלון בהעלאה: ' + e.message);
    convertBtn.disabled = false;
    return;
  }

  pollStatus(job.job_id);
});

function pollStatus(jobId) {
  let consecutiveErrors = 0;
  pollTimer = setInterval(async () => {
    let data;
    try {
      const resp = await fetch(`${API_BASE}/api/status/${jobId}`);
      data = await resp.json();
      consecutiveErrors = 0;
    } catch (e) {
      consecutiveErrors++;
      if (consecutiveErrors > 5) {
        clearInterval(pollTimer);
        spinner.style.display = 'none';
        showError('אבד הקשר לשרת');
        convertBtn.disabled = false;
      }
      return;
    }
    updateSpinner(data.status);
    if (data.status === 'done') {
      clearInterval(pollTimer);
      stopProgress(true);
      showResult(data.result);
    } else if (data.status === 'failed') {
      clearInterval(pollTimer);
      stopProgress(false);
      spinner.style.display = 'none';
      showError('הריצה נכשלה: ' + (data.error || 'שגיאה לא ידועה'));
      convertBtn.disabled = false;
    }
  }, POLL_INTERVAL_MS);
}

function updateSpinner(status) {
  const m = {
    'queued': 'בתור…',
    'uploading_input': 'שומר את הקובץ…',
    'detecting': 'מזהה דירות…',
    'rendering_overlay': 'מצייר את הזיהוי על התשריט…',
    'uploading_output': 'מעלה תוצאות…',
  };
  spinnerMsg.textContent = m[status] || status;
}

function startProgress() {
  setProgress(0);
  if (progressTimer) clearInterval(progressTimer);
  let hintShown = false;
  progressTimer = setInterval(() => {
    const elapsed = (Date.now() - jobStartedAt) / 1000;
    const t = elapsed / EXPECTED_TOTAL_SEC;
    const pct = t < 1
      ? Math.round(92 * (1 - Math.exp(-2 * t)))
      : Math.min(98, 92 + Math.round(6 * (1 - Math.exp(-0.5 * (t - 1)))));
    setProgress(pct);
    if (!hintShown && elapsed > SLOW_AFTER_SEC) {
      hintShown = true;
      const sub = document.getElementById('spinner-sub');
      if (sub) sub.textContent = 'התשריט מורכב — סריקה מעמיקה מתבצעת. עוד כמה דקות.';
    }
  }, TICK_MS);
}

function setProgress(pct) {
  progressFill.style.width = pct + '%';
  progressPct.textContent = pct + '%';
}

function stopProgress(final = true) {
  if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
  if (final) setProgress(100);
}

function showResult(result) {
  spinner.style.display = 'none';
  rTotal.textContent = result.total_apartments;
  pagesList.innerHTML = '';

  // Zero detections — explain instead of showing empty results.
  if (result.total_apartments === 0) {
    const warn = document.createElement('div');
    warn.className = 'zero-warn';
    warn.innerHTML = `
      <div class="zero-warn-title">⚠ לא זוהו דירות בקובץ</div>
      <p>זה יכול לקרות בכמה מצבים:</p>
      <ul>
        <li>התשריט ישן או סרוק באיכות נמוכה</li>
        <li>יש כמה תכניות קומה דחוסות בעמוד אחד</li>
        <li>הקובץ הוא לא תשריט בית משותף סטנדרטי</li>
      </ul>
      <p>נסה: לחתוך את התשריט לפי קומה (קומה אחת בקובץ), או להעלות PDF נקי יותר.</p>
    `;
    pagesList.appendChild(warn);
    resultCard.style.display = 'block';
    resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }

  // Single combined Excel for the whole file.
  if (result.combined_xlsx_url) {
    const top = document.createElement('div');
    top.className = 'page-item';
    top.innerHTML = `
      <span class="label">📊 Excel מסכם</span>
      <span class="count">כל הדירות בקובץ אחד</span>
      <a class="btn-dl" href="${result.combined_xlsx_url}" download>⬇ הורד Excel</a>
    `;
    pagesList.appendChild(top);
  }

  // Per-page overlays — inline preview + download.
  result.pages.forEach((p) => {
    const div = document.createElement('div');
    div.className = 'page-item-block' + (p.apartments === 0 ? ' empty' : '');
    let inner = `
      <div class="page-item">
        <span class="label">עמוד ${p.page_num + 1}</span>
        <span class="count">${p.apartments} דירות</span>
    `;
    if (p.overlay_url) {
      inner += `<a class="btn-dl btn-overlay" href="${p.overlay_url}" download>⬇ הורד תמונה</a>`;
    }
    inner += `</div>`;
    if (p.overlay_url) {
      inner += `
        <div class="overlay-preview">
          <a href="${p.overlay_url}" target="_blank" rel="noopener" title="לחץ לפתיחה בגודל מלא">
            <img src="${p.overlay_url}" alt="עמוד ${p.page_num + 1} — זיהוי דירות" loading="lazy">
          </a>
        </div>
      `;
    } else if (p.apartments === 0) {
      inner += `<div class="overlay-preview-empty">אין דירות בעמוד הזה</div>`;
    }
    div.innerHTML = inner;
    pagesList.appendChild(div);
  });

  resultCard.style.display = 'block';
  resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

resetBtn.addEventListener('click', () => {
  resultCard.style.display = 'none';
  spinner.style.display = 'none';
  errorBox.style.display = 'none';
  clearFile();
  tosCb.checked = false;
  refreshBtn();
});
