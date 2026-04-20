// Two-stage client:
//   1. POST /parse with PDF → get building JSON + warnings, render editable table.
//   2. POST /merge with template + address + edited building JSON → download zip.

const _isLocal = /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);
const BACKEND_URL = window.APPENDIX_MERGER_BACKEND ?? (_isLocal ? "" : "https://tabu2docs.lendover.co.il");

const uploadCard = document.getElementById("upload-card");
const uploadForm = document.getElementById("upload-form");
const previewBtn = document.getElementById("preview-btn");
const uploadStatus = document.getElementById("upload-status");

const reviewCard = document.getElementById("review-card");
const editGush = document.getElementById("edit-gush");
const editChalka = document.getElementById("edit-chalka");
const countsEl = document.getElementById("counts");
const warningsList = document.getElementById("warnings-list");
const ownersTbody = document.querySelector("#owners-table tbody");

const backBtn = document.getElementById("back-btn");
const generateBtn = document.getElementById("generate-btn");
const generateStatus = document.getElementById("generate-status");

// In-memory state kept between stages so we don't need another upload round-trip.
let cachedTemplate = null;   // File
let cachedAddress = "";
let cachedBuilding = null;   // edited structure

function setBusy(btn, busy) {
  btn.disabled = busy;
}

function setStatus(el, text, kind = "info") {
  el.textContent = text;
  el.dataset.kind = kind;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function parseFilenameFromDisposition(header) {
  if (!header) return null;
  const mStar = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header);
  if (mStar) {
    try { return decodeURIComponent(mStar[1].trim()); } catch { /* ignore */ }
  }
  const m = /filename\s*=\s*"?([^";]+)"?/i.exec(header);
  return m ? m[1].trim() : null;
}

function isLikelyCompanyId(oid) {
  const s = (oid || "").trim();
  return s.length === 9 && s.startsWith("5");
}

function suspiciousName(name) {
  const s = (name || "").trim();
  if (!s) return true;
  return /חלקה|גוש|עמ'|עמוד/.test(s);
}

function suspiciousId(oid) {
  const s = (oid || "").trim();
  if (!s) return false;
  if (!/^\d+$/.test(s)) return true;
  return s.length < 7 || s.length > 9;
}

function renderTable(building) {
  editGush.value = building.gush || "";
  editChalka.value = building.chalka || "";
  const totalSub = (building.subunits || []).length;
  const totalOwners = (building.subunits || []).reduce(
    (s, su) => s + ((su.owners || []).length), 0);
  countsEl.textContent = ` · ${totalSub} תתי־חלקות, ${totalOwners} בעלים`;

  ownersTbody.innerHTML = "";
  (building.subunits || []).forEach((su, subIdx) => {
    (su.owners || []).forEach((o, ownerIdx) => {
      const tr = document.createElement("tr");
      tr.dataset.subIdx = subIdx;
      tr.dataset.ownerIdx = ownerIdx;

      const unitTd = document.createElement("td");
      if (ownerIdx === 0) {
        unitTd.rowSpan = (su.owners || []).length || 1;
        unitTd.textContent = su.unit_num;
        unitTd.className = "unit-cell";
        tr.appendChild(unitTd);
      }

      // name
      const nameTd = document.createElement("td");
      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.value = o.full_name || "";
      nameInput.className = "cell-input";
      nameTd.appendChild(nameInput);
      if (suspiciousName(o.full_name)) nameTd.classList.add("flagged");
      tr.appendChild(nameTd);

      // id
      const idTd = document.createElement("td");
      const idInput = document.createElement("input");
      idInput.type = "text";
      idInput.value = o.id || "";
      idInput.className = "cell-input mono";
      idTd.appendChild(idInput);
      if (suspiciousId(o.id)) idTd.classList.add("flagged");
      tr.appendChild(idTd);

      // label (ת.ז. / ח.פ.) — auto, read-only
      const labelTd = document.createElement("td");
      const labelSpan = document.createElement("span");
      labelSpan.className = "id-label";
      const updateLabel = () => {
        labelSpan.textContent = isLikelyCompanyId(idInput.value) ? "ח.פ." : "ת.ז.";
      };
      updateLabel();
      idInput.addEventListener("input", updateLabel);
      labelTd.appendChild(labelSpan);
      tr.appendChild(labelTd);

      // fraction
      const fracTd = document.createElement("td");
      const fracInput = document.createElement("input");
      fracInput.type = "text";
      fracInput.value = o.fraction || "בשלמות";
      fracInput.className = "cell-input mono";
      fracTd.appendChild(fracInput);
      tr.appendChild(fracTd);

      // delete button
      const rmTd = document.createElement("td");
      const rmBtn = document.createElement("button");
      rmBtn.type = "button";
      rmBtn.className = "icon-btn";
      rmBtn.title = "הסר בעל";
      rmBtn.textContent = "✕";
      rmBtn.addEventListener("click", () => {
        tr.remove();
        // Collapse rowspan if the unit's first row is gone.
        reflowUnitCells();
      });
      rmTd.appendChild(rmBtn);
      tr.appendChild(rmTd);

      ownersTbody.appendChild(tr);
    });
  });
}

function reflowUnitCells() {
  // Rebuild the first-col rowspan after a row deletion.
  const rows = Array.from(ownersTbody.querySelectorAll("tr"));
  // Remove existing unit cells we inserted
  rows.forEach(r => {
    const first = r.firstElementChild;
    if (first && first.classList.contains("unit-cell")) first.remove();
  });
  const groups = new Map();
  rows.forEach((r, i) => {
    const k = r.dataset.subIdx;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  });
  for (const [subIdx, groupRows] of groups.entries()) {
    const td = document.createElement("td");
    td.className = "unit-cell";
    td.rowSpan = groupRows.length;
    // Pull unit num from first row — we stored it in data- attr? Fallback
    // to the building state.
    const firstOwner = (cachedBuilding.subunits[subIdx] || {});
    td.textContent = firstOwner.unit_num;
    groupRows[0].insertBefore(td, groupRows[0].firstElementChild);
  }
}

function collectEdits() {
  const subunits = cachedBuilding.subunits.map(su => ({ ...su, owners: [] }));
  const rows = ownersTbody.querySelectorAll("tr");
  rows.forEach(tr => {
    const subIdx = Number(tr.dataset.subIdx);
    const inputs = tr.querySelectorAll(".cell-input");
    if (inputs.length < 3) return;
    const [nameIn, idIn, fracIn] = inputs;
    subunits[subIdx].owners.push({
      full_name: nameIn.value.trim(),
      id: idIn.value.trim(),
      fraction: fracIn.value.trim() || "בשלמות",
    });
  });
  return {
    gush: editGush.value.trim(),
    chalka: editChalka.value.trim(),
    subunits: subunits.filter(su => su.owners.length > 0),
  };
}

// Stage 1 — parse
uploadForm.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const fd = new FormData(uploadForm);
  const pdf = fd.get("pdf");
  const template = fd.get("template");
  const address = (fd.get("address") || "").toString().trim();
  if (!(pdf instanceof File) || !pdf.size) { setStatus(uploadStatus, "בחר קובץ PDF", "error"); return; }
  if (!(template instanceof File) || !template.size) { setStatus(uploadStatus, "בחר תבנית Word", "error"); return; }
  if (!address) { setStatus(uploadStatus, "הזן כתובת פרויקט", "error"); return; }

  cachedTemplate = template;
  cachedAddress = address;

  setBusy(previewBtn, true);
  setStatus(uploadStatus, "טוען ומנתח את הנסח…");

  try {
    const parseFd = new FormData();
    parseFd.append("pdf", pdf);
    const resp = await fetch(`${BACKEND_URL}/parse`, {
      method: "POST",
      credentials: "include",
      body: parseFd,
    });
    if (resp.status === 401) {
      setStatus(uploadStatus, "יש להיכנס למערכת לפני השימוש", "error");
      if (typeof window.lendoverAuth?.prompt === "function") window.lendoverAuth.prompt();
      return;
    }
    if (!resp.ok) {
      let msg = `שגיאה ${resp.status}`;
      try { const j = await resp.json(); if (j?.error) msg += ` — ${j.error}`; } catch {}
      setStatus(uploadStatus, msg, "error"); return;
    }
    const body = await resp.json();
    cachedBuilding = body.building;
    renderTable(cachedBuilding);
    warningsList.hidden = !(body.warnings && body.warnings.length);
    warningsList.innerHTML = "";
    (body.warnings || []).forEach(w => {
      const li = document.createElement("li");
      li.textContent = w;
      warningsList.appendChild(li);
    });
    uploadCard.hidden = true;
    reviewCard.hidden = false;
    setStatus(uploadStatus, "");
    reviewCard.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    setStatus(uploadStatus, `שגיאת רשת: ${err.message || err}`, "error");
  } finally {
    setBusy(previewBtn, false);
  }
});

backBtn.addEventListener("click", () => {
  reviewCard.hidden = true;
  uploadCard.hidden = false;
  setStatus(generateStatus, "");
});

// --- Progress bar helpers ------------------------------------------------
const progressBlock = document.getElementById("progress-block");
const progressFill  = document.getElementById("progress-fill");
const progressLabel = document.getElementById("progress-label");

function showProgress() {
  progressBlock.hidden = false;
  progressFill.classList.remove("indet");
  progressFill.style.width = "0%";
  progressLabel.textContent = "מתחיל…";
}
function setProgress(pct, label) {
  progressFill.classList.remove("indet");
  progressFill.style.width = Math.max(0, Math.min(100, pct)) + "%";
  if (label != null) progressLabel.textContent = label;
}
function setIndeterminate(label) {
  progressFill.classList.add("indet");
  progressFill.style.width = "100%";
  if (label != null) progressLabel.textContent = label;
}
function hideProgress(delay = 0) {
  setTimeout(() => { progressBlock.hidden = true; }, delay);
}

// Smoothly inches a pseudo-progress forward between [start, ceiling]
// over ~expectedMs, so the user perceives motion during server-side work.
function startPseudoProgress(start, ceiling, expectedMs, labelFn) {
  let cancelled = false;
  let current = start;
  const startedAt = performance.now();
  function tick() {
    if (cancelled) return;
    const elapsed = performance.now() - startedAt;
    // Asymptotic ease: never quite reaches ceiling — real completion jumps it.
    const pct = start + (ceiling - start) * (1 - Math.exp(-elapsed / expectedMs));
    current = Math.max(current, pct);
    progressFill.style.width = current.toFixed(1) + "%";
    if (labelFn) progressLabel.textContent = labelFn(current);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  return () => { cancelled = true; };
}

// Stage 2 — merge (XHR so we get real upload progress)
generateBtn.addEventListener("click", () => {
  if (!cachedTemplate) { setStatus(generateStatus, "התבנית חסרה, חזור להעלאה", "error"); return; }
  const edited = collectEdits();
  if (!edited.subunits.length) { setStatus(generateStatus, "אין תתי־חלקות עם בעלים", "error"); return; }

  setBusy(generateBtn, true);
  setStatus(generateStatus, "");
  showProgress();

  const fd = new FormData();
  fd.append("template", cachedTemplate);
  fd.append("address", cachedAddress);
  fd.append("building", JSON.stringify(edited));

  const xhr = new XMLHttpRequest();
  xhr.open("POST", `${BACKEND_URL}/merge`);
  xhr.responseType = "blob";
  xhr.withCredentials = true;

  // Upload progress — 0..40%
  xhr.upload.onprogress = (ev) => {
    if (ev.lengthComputable) {
      const pct = (ev.loaded / ev.total) * 40;
      setProgress(pct, `מעלה קבצים… ${Math.round(ev.loaded / 1024)} KB / ${Math.round(ev.total / 1024)} KB`);
    } else {
      setProgress(20, "מעלה קבצים…");
    }
  };

  let stopPseudo = null;

  xhr.upload.onload = () => {
    // Upload is complete — server now parsing + rendering + zipping.
    setProgress(42, "ממזג ומייצר מסמכים…");
    const subCount = (edited.subunits || []).length;
    // Rough budget: ~250ms per subunit + 1s for combine + 1s for split.
    const expectedMs = Math.max(1500, subCount * 260 + 2000);
    stopPseudo = startPseudoProgress(42, 94, expectedMs, (pct) => {
      if (pct < 70) return "ממזג ומייצר מסמכים…";
      if (pct < 88) return "מחבר ומפצל לפי נספחים…";
      return "מכין את קובץ ה-ZIP…";
    });
  };

  xhr.onload = () => {
    if (stopPseudo) stopPseudo();
    if (xhr.status === 401) {
      setStatus(generateStatus, "יש להיכנס למערכת לפני השימוש", "error");
      hideProgress();
      setBusy(generateBtn, false);
      if (typeof window.lendoverAuth?.prompt === "function") window.lendoverAuth.prompt();
      return;
    }
    if (xhr.status < 200 || xhr.status >= 300) {
      // Try to surface server error text.
      const reader = new FileReader();
      reader.onload = () => {
        let msg = `שגיאה ${xhr.status}`;
        try { const j = JSON.parse(reader.result); if (j?.error) msg += ` — ${j.error}`; } catch {}
        setStatus(generateStatus, msg, "error");
      };
      reader.readAsText(xhr.response);
      hideProgress();
      setBusy(generateBtn, false);
      return;
    }

    setProgress(100, "מוריד את הקובץ…");
    const subunitCount = xhr.getResponseHeader("X-Subunit-Count");
    const filename = parseFilenameFromDisposition(xhr.getResponseHeader("Content-Disposition")) || "merged.zip";
    downloadBlob(xhr.response, filename);
    setStatus(generateStatus, `הורדת הקובץ החלה — ${subunitCount} תתי־חלקות.`, "success");
    hideProgress(1500);
    setBusy(generateBtn, false);
  };

  xhr.onerror = () => {
    if (stopPseudo) stopPseudo();
    setStatus(generateStatus, "שגיאת רשת — נסה שוב", "error");
    hideProgress();
    setBusy(generateBtn, false);
  };

  xhr.send(fd);
});
