/* app.js — המרת נסחי טאבו לאקסל */
'use strict';

const dropZone    = document.getElementById('drop-zone');
const fileInput   = document.getElementById('file-input');
const fileList    = document.getElementById('file-list');
const convertBtn  = document.getElementById('convert-btn');
const spinner     = document.getElementById('spinner');
const spinnerMsg  = document.getElementById('spinner-msg');
const resultCard  = document.getElementById('result-card');
const errorBox    = document.getElementById('error-box');
const downloadBtn = document.getElementById('download-btn');
const resetBtn    = document.getElementById('reset-btn');

const buildingsList   = document.getElementById('buildings-list');
const totalSummary    = document.getElementById('total-summary');
const fTotalSubunits  = document.getElementById('f-total-subunits');
const fTotalOwners    = document.getElementById('f-total-owners');
const warningsNote    = document.getElementById('warnings-note');

// רשימת קבצים שנבחרו — מערך מסודר (כדי לאפשר שינוי סדר)
let selectedFiles = [];  // Array<File>
let downloadId    = null;
let lastBuildings = [];
let dragFromIdx   = null;  // אינדקס הפריט הנגרר

// ── Drag & Drop ──────────────────────────────────────────────────

dropZone.addEventListener('click', () => fileInput.click());

dropZone.addEventListener('dragover', e => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  addFiles(e.dataTransfer.files);
});

fileInput.addEventListener('change', () => {
  addFiles(fileInput.files);
  fileInput.value = ''; // מאפשר בחירה חוזרת של אותו קובץ
});

function addFiles(fileArr) {
  const existingNames = new Set(selectedFiles.map(f => f.name));
  for (const f of fileArr) {
    if (!f.name.toLowerCase().endsWith('.pdf')) {
      showError(`"${f.name}" — יש להעלות קובצי PDF בלבד`);
      continue;
    }
    if (existingNames.has(f.name)) continue; // כפילות לפי שם
    selectedFiles.push(f);
    existingNames.add(f.name);
  }
  renderFileList();
  hideError();
  hideResult();
}

function moveFile(idx, delta) {
  const newIdx = idx + delta;
  if (newIdx < 0 || newIdx >= selectedFiles.length) return;
  const [item] = selectedFiles.splice(idx, 1);
  selectedFiles.splice(newIdx, 0, item);
  renderFileList();
}

function removeFile(idx) {
  selectedFiles.splice(idx, 1);
  renderFileList();
}

function renderFileList() {
  fileList.innerHTML = '';
  selectedFiles.forEach((file, idx) => {
    const li = document.createElement('li');
    li.className = 'file-item';
    li.draggable = true;
    li.dataset.idx = String(idx);
    const isFirst = idx === 0;
    const isLast  = idx === selectedFiles.length - 1;
    li.innerHTML = `
      <span class="drag-handle" title="גרור לסידור">⋮⋮</span>
      <span class="file-order">${idx + 1}</span>
      <span class="file-icon">📄</span>
      <span class="file-name">${escHtml(file.name)}</span>
      <div class="file-actions">
        <button class="order-btn up"   data-idx="${idx}" title="העבר למעלה" ${isFirst ? 'disabled' : ''}>▲</button>
        <button class="order-btn down" data-idx="${idx}" title="העבר למטה"  ${isLast  ? 'disabled' : ''}>▼</button>
        <button class="remove-btn"     data-idx="${idx}" title="הסר">✕</button>
      </div>
    `;

    // Drag & drop לשינוי סדר
    li.addEventListener('dragstart', e => {
      dragFromIdx = idx;
      li.classList.add('dragging');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', String(idx)); } catch (_) {}
      }
    });
    li.addEventListener('dragend', () => {
      li.classList.remove('dragging');
      fileList.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
      dragFromIdx = null;
    });
    li.addEventListener('dragover', e => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      li.classList.add('drop-target');
    });
    li.addEventListener('dragleave', () => li.classList.remove('drop-target'));
    li.addEventListener('drop', e => {
      e.preventDefault();
      li.classList.remove('drop-target');
      const fromIdx = dragFromIdx;
      const toIdx   = idx;
      if (fromIdx === null || fromIdx === toIdx) return;
      const [item] = selectedFiles.splice(fromIdx, 1);
      selectedFiles.splice(toIdx, 0, item);
      renderFileList();
    });

    fileList.appendChild(li);
  });

  // לחצני פעולה
  fileList.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', () => removeFile(Number(btn.dataset.idx)));
  });
  fileList.querySelectorAll('.order-btn.up').forEach(btn => {
    btn.addEventListener('click', () => moveFile(Number(btn.dataset.idx), -1));
  });
  fileList.querySelectorAll('.order-btn.down').forEach(btn => {
    btn.addEventListener('click', () => moveFile(Number(btn.dataset.idx), 1));
  });

  convertBtn.disabled = selectedFiles.length === 0;
  dropZone.classList.toggle('has-file', selectedFiles.length > 0);

  const hint = document.getElementById('reorder-hint');
  if (hint) hint.style.display = selectedFiles.length >= 2 ? 'block' : 'none';
}

// ── Convert ──────────────────────────────────────────────────────

convertBtn.addEventListener('click', async () => {
  if (selectedFiles.length === 0) return;

  setLoading(true);
  hideError();
  hideResult();

  const formData = new FormData();
  for (const f of selectedFiles) {
    formData.append('files', f);
  }

  // הודעת cold start אחרי 5 שניות
  const coldStartTimer = setTimeout(() => {
    spinnerMsg.textContent = 'השרת מתעורר, זה עשוי לקחת עד דקה...';
  }, 5000);

  try {
    const resp = await fetch('https://tabutab.lendover.co.il/convert', { method: 'POST', body: formData, credentials: 'include' });

    // Auth required — show login modal and retry
    if (resp.status === 401) {
      clearTimeout(coldStartTimer);
      setLoading(false);
      await handleAuth401();
      convertBtn.click();
      return;
    }

    // Rate limited
    if (resp.status === 429) {
      clearTimeout(coldStartTimer);
      showError('יותר מדי בקשות. נסה שוב בעוד מספר דקות.');
      return;
    }

    const data = await resp.json();
    clearTimeout(coldStartTimer);

    if (!resp.ok || !data.success) {
      showError(data.error || 'שגיאה לא ידועה');
      return;
    }

    downloadId    = data.download_id;
    lastBuildings = data.buildings || [];

    renderResults(data);
    showResult();

  } catch (err) {
    clearTimeout(coldStartTimer);
    showError('שגיאת רשת — בדוק את החיבור ונסה שוב');
  } finally {
    setLoading(false);
  }
});

function renderResults(data) {
  buildingsList.innerHTML = '';

  data.buildings.forEach(b => {
    const div = document.createElement('div');
    div.className = 'building-row';
    div.innerHTML = `
      <div class="info-grid">
        <div class="info-item">
          <label>גוש</label><span>${escHtml(b.gush || '—')}</span>
        </div>
        <div class="info-item">
          <label>חלקה</label><span>${escHtml(b.chalka || '—')}</span>
        </div>
        <div class="info-item wide">
          <label>כתובת</label><span>${escHtml(b.address || '—')}</span>
        </div>
        <div class="info-item">
          <label>תת-חלקות</label><span>${b.subunit_count}</span>
        </div>
        <div class="info-item">
          <label>בעלים</label><span>${b.owner_count}</span>
        </div>
      </div>
    `;
    buildingsList.appendChild(div);

    // קו מפריד בין בניינים (אם יש יותר מאחד)
    if (data.buildings.length > 1) {
      div.classList.add('building-row--bordered');
    }
  });

  // סיכום כולל — רק אם יש יותר מקובץ אחד
  if (data.buildings.length > 1) {
    fTotalSubunits.textContent = data.total_subunits;
    fTotalOwners.textContent   = data.total_owners;
    totalSummary.style.display = 'block';
  } else {
    totalSummary.style.display = 'none';
  }

  warningsNote.style.display = data.warnings_count > 0 ? 'block' : 'none';
}

// ── Download ─────────────────────────────────────────────────────

downloadBtn.addEventListener('click', async () => {
  if (!downloadId) return;

  const params = new URLSearchParams({ count: String(lastBuildings.length) });
  if (lastBuildings.length === 1) {
    params.set('gush',   lastBuildings[0].gush   || '');
    params.set('chalka', lastBuildings[0].chalka || '');
  }
  const url = `https://tabutab.lendover.co.il/download/${downloadId}?${params}`;

  // Use fetch to check auth before downloading
  try {
    const resp = await fetch(url, { method: 'GET', credentials: 'include' });
    if (resp.status === 401) {
      await handleAuth401();
      // Retry download after auth
      downloadBtn.click();
      return;
    }
    // Download the file
    const blob = await resp.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    // Extract filename from Content-Disposition or use default
    const cd = resp.headers.get('Content-Disposition');
    let filename = 'טאבו.xlsx';
    if (cd) {
      const match = cd.match(/filename\*=UTF-8''(.+)/);
      if (match) filename = decodeURIComponent(match[1]);
    }
    a.download = filename;
    a.click();
    URL.revokeObjectURL(blobUrl);
  } catch (err) {
    showError('שגיאת רשת — בדוק את החיבור');
  }
});

// ── Reset ────────────────────────────────────────────────────────

resetBtn.addEventListener('click', reset);

function reset() {
  selectedFiles = [];
  downloadId    = null;
  lastBuildings = [];
  fileInput.value = '';
  renderFileList();
  hideResult();
  hideError();
}

// ── UI helpers ───────────────────────────────────────────────────

function setLoading(on) {
  spinner.style.display  = on ? 'block' : 'none';
  convertBtn.disabled    = on;
  spinnerMsg.textContent = 'מעבד את הקבצים...';
}

function showResult()  { resultCard.style.display = 'block'; }
function hideResult()  { resultCard.style.display = 'none';  }

function showError(msg) {
  errorBox.textContent   = '⚠ ' + msg;
  errorBox.style.display = 'block';
}
function hideError() { errorBox.style.display = 'none'; }

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
