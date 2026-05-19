/* report.js — branded PDF report export for the building-fees calculator.
   Exposes window.exportReport(). Depends (at call time) on app.js globals
   $, STATE, readLevyState and the globals html2canvas + jspdf. */
'use strict';

(function () {
  /* ----- small helpers ----- */
  function pad(n) { return String(n).padStart(2, '0'); }
  function dateDisplay(d) { return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear(); }
  function dateISO(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function sanitizeFile(s) { return String(s).replace(/[\/\\:*?"<>|]/g, '-').trim(); }

  /* ----- gather the report model from app state + the rendered DOM ----- */
  function buildReportModel() {
    var d = STATE.data || {};
    var ls = readLevyState();

    var units = parseFloat(document.getElementById('units').value) || 0;
    var plot = STATE.plot || 0;
    var densityText = 'לא חושבה';
    if (units > 0 && plot > 0) {
      var upd = units / (plot / 1000);
      densityText = (upd <= 5 ? 'נמוכה' : 'רגילה') +
        ' (' + upd.toLocaleString('he-IL', { maximumFractionDigits: 1 }) + ' יח"ד/דונם)';
    }

    var workSel = document.getElementById('work-type');
    var workText = workSel && workSel.selectedOptions[0]
      ? workSel.selectedOptions[0].textContent.trim() : '';

    var existingMap = { none: 'לא', demolish: 'נהרסים', keep: 'נשארים' };

    function feeLines(containerId) {
      var lines = [].map.call(
        document.querySelectorAll('#' + containerId + ' .fee-line'),
        function (el) {
          return {
            label: el.querySelector('.lbl').textContent.trim(),
            amount: el.querySelector('.amt').textContent.trim()
          };
        });
      var na = document.querySelector('#' + containerId + ' .fee-na');
      return { lines: lines, na: na ? na.textContent.trim() : '' };
    }

    var levies = [].filter.call(
      document.querySelectorAll('#levy-list .levy-item'),
      function (it) {
        var cb = it.querySelector('input[type=checkbox]');
        return cb && cb.checked;
      }).map(function (it) {
        var whens = [].map.call(it.querySelectorAll('.levy-when'),
          function (s) { return s.textContent.trim(); });
        return {
          name: it.querySelector('.levy-name').textContent.trim(),
          detail: whens.join(' · '),
          amount: it.querySelector('.levy-amt').textContent.trim()
        };
      });

    var waterSubRow = document.getElementById('water-subtotal-row');

    return {
      authority: d.authority || '',
      committee: d.committee || '',
      workType: workText,
      area: STATE.area || 0,
      plot: plot,
      units: units,
      densityText: densityText,
      existingText: existingMap[ls.existing] || 'לא',
      isDemolish: ls.existing === 'demolish',
      demoArea: ls.demoArea || 0,
      agra: feeLines('agra-lines'),
      agraTotal: document.getElementById('agra-total').textContent.trim(),
      water: feeLines('water-lines'),
      waterTotal: document.getElementById('water-total').textContent.trim(),
      waterHasTotal: !!(waterSubRow && waterSubRow.style.display !== 'none'),
      levies: levies,
      levyTotal: document.getElementById('levy-total').textContent.trim(),
      grandTotal: document.getElementById('grand-total').textContent.trim() + ' ₪',
      generated: dateDisplay(new Date())
    };
  }

  /* ----- build the off-screen .pdf-report element ----- */
  function feeTable(model, kind) {
    var block = model[kind];
    if (block.lines.length === 0) {
      return '<table><tr><td class="rp-na" colspan="2">' + esc(block.na) + '</td></tr></table>';
    }
    var rows = block.lines.map(function (l) {
      return '<tr><td>' + esc(l.label) + '</td><td class="rp-amt">' + esc(l.amount) + '</td></tr>';
    });
    return '<table>' + rows.join('') + '</table>';
  }

  function buildReportElement(model) {
    var num = function (n) { return n.toLocaleString('he-IL', { maximumFractionDigits: 0 }); };

    var prop = [
      '<div><b>רשות מקומית:</b> ' + esc(model.authority) + '</div>',
      '<div><b>ועדה מקומית:</b> ' + esc(model.committee || '—') + '</div>',
      '<div><b>סוג עבודה:</b> ' + esc(model.workType || '—') + '</div>',
      '<div><b>שטח בנייה:</b> ' + num(model.area) + ' מ"ר</div>',
      '<div><b>שטח מגרש:</b> ' + (model.plot > 0 ? num(model.plot) + ' מ"ר' : '—') + '</div>',
      '<div><b>יח"ד:</b> ' + (model.units > 0 ? num(model.units) : '—') + '</div>',
      '<div><b>צפיפות:</b> ' + esc(model.densityText) + '</div>',
      '<div><b>מבנים קיימים:</b> ' + esc(model.existingText) + '</div>'
    ];
    if (model.isDemolish) {
      prop.push('<div class="rp-demo"><b>שטח הריסה:</b> ' + num(model.demoArea) + ' מ"ר</div>');
    }

    var levyRows;
    if (model.levies.length === 0) {
      levyRows = '<tr><td class="rp-na" colspan="2">לא נבחרו היטלי פיתוח.</td></tr>';
    } else {
      levyRows = model.levies.map(function (l) {
        return '<tr><td>' + esc(l.name) +
          (l.detail ? '<span class="rp-detail">' + esc(l.detail) + '</span>' : '') +
          '</td><td class="rp-amt">' + esc(l.amount) + '</td></tr>';
      }).join('');
    }

    var html =
      '<div class="rp-head">' +
        '<img src="ifc-logo.png" alt="IFC">' +
        '<div class="rp-title">' +
          '<h1>דוח אומדן אגרות והיטלי בנייה</h1>' +
          '<div class="rp-date">הופק: ' + esc(model.generated) + '</div>' +
        '</div>' +
        '<img src="lendover-logo.png" alt="לנדובר">' +
      '</div>' +
      '<div class="rp-body">' +
        '<div class="rp-prop">' + prop.join('') + '</div>' +

        '<div class="rp-sec">אגרות היתר בנייה</div>' +
        feeTable(model, 'agra') +
        (model.agra.lines.length
          ? '<table><tr class="rp-sub"><td>סה"כ אגרות</td><td class="rp-amt">' +
            esc(model.agraTotal) + '</td></tr></table>' : '') +

        '<div class="rp-sec">דמי הקמה — מים וביוב</div>' +
        feeTable(model, 'water') +
        (model.waterHasTotal
          ? '<table><tr class="rp-sub"><td>סה"כ דמי הקמה</td><td class="rp-amt">' +
            esc(model.waterTotal) + '</td></tr></table>' : '') +

        '<div class="rp-sec">היטלי פיתוח <small>— נכללים המסומנים בלבד</small></div>' +
        '<table>' + levyRows +
          (model.levies.length
            ? '<tr class="rp-sub"><td>סה"כ היטלי פיתוח</td><td class="rp-amt">' +
              esc(model.levyTotal) + '</td></tr>' : '') +
        '</table>' +

        '<div class="rp-grand">' +
          '<span class="rp-gl">סה"כ משוער</span>' +
          '<span class="rp-gv">' + esc(model.grandTotal) + '</span>' +
        '</div>' +

        '<p class="rp-disc">כל הסכומים ללא מע"מ. החישוב הוא אומדן בלבד ואינו כולל ' +
        'היטל השבחה; אינו מחליף בדיקה מול הרשות. סיווג היטלי הפיתוח אוטומטי. ' +
        'מבוסס קטלוג תעריפים ארצי, עדכני לתאריך ההפקה.</p>' +
      '</div>' +
      '<div class="rp-foot">' +
        '<div><b>אהרון לנדובר</b><br>יועץ אסטרטגי בהתחדשות עירונית</div>' +
        '<div class="rp-contact">058-5197507 · Aharon@Lendover.co.il<br>' +
        'lendover.co.il · רוטשילד 124, ראשון לציון</div>' +
      '</div>';

    /* The .pdf-report element MUST stay in normal flow (no position:fixed/absolute
       and no off-screen offset) — html2canvas yields a 0-height canvas for an
       element positioned off-screen. It is hidden from the user by a 0×0
       overflow:hidden wrapper instead (see exportReport). */
    var el = document.createElement('div');
    el.className = 'pdf-report';
    el.innerHTML = html;
    return el;
  }

  /* ----- wait for every <img> inside an element to finish loading ----- */
  function imagesReady(el) {
    var imgs = [].slice.call(el.querySelectorAll('img'));
    return Promise.all(imgs.map(function (img) {
      if (img.complete) return Promise.resolve();
      return new Promise(function (resolve) {
        img.addEventListener('load', resolve);
        img.addEventListener('error', resolve);
      });
    }));
  }

  /* ----- public entry point ----- */
  function exportReport() {
    if (!STATE.data) return;
    var btn = document.getElementById('export-pdf-btn');
    var label = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'מכין PDF…'; }

    var model = buildReportModel();
    var el = buildReportElement(model);
    /* Hide the report from the user with a 0-height overflow:hidden wrapper,
       while the report element itself stays in normal flow so html2canvas
       renders it. The wrapper MUST be at least as wide as the report and
       direction:ltr — otherwise, in the RTL document, the report overflows
       to negative x (off-screen) and html2canvas captures it blank. */
    var wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;left:0;top:0;width:820px;height:0;' +
      'overflow:hidden;direction:ltr;';
    wrap.appendChild(el);
    document.body.appendChild(wrap);

    var filename = 'אומדן-אגרות-' + sanitizeFile(model.authority) + '-' +
      dateISO(new Date()) + '.pdf';

    imagesReady(el).then(function () {
      return html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
    }).then(function (canvas) {
      /* place the whole report on one A4 page, scaled to fit and centered */
      var pdf = new jspdf.jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
      var pageW = pdf.internal.pageSize.getWidth();
      var pageH = pdf.internal.pageSize.getHeight();
      var scale = Math.min(pageW / canvas.width, pageH / canvas.height);
      var imgW = canvas.width * scale;
      var imgH = canvas.height * scale;
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG',
        (pageW - imgW) / 2, (pageH - imgH) / 2, imgW, imgH);
      pdf.save(filename);
      wrap.remove();
      if (btn) { btn.disabled = false; btn.textContent = label; }
    }).catch(function (e) {
      wrap.remove();
      if (btn) { btn.disabled = false; btn.textContent = label; }
      alert('יצירת ה-PDF נכשלה — נסה שוב.');
      console.error('exportReport failed:', e);
    });
  }

  window.exportReport = exportReport;
})();
