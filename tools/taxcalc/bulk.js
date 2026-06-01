// bulk.js — developer mode: parse Excel, auto-map columns, process, render, export.
(function () {
  'use strict';

  var E = window.TaxEngine;

  // --- state ---
  var state = {
    projectType: null,
    defaultPrice: 0,
    ceiling49z: 2428100,
    rows: [],
    headers: [],
    mapping: {},
    rawWorkbook: null,
    results: []
  };

  // --- mapping options ---
  var MAPPING_KEYS = [
    { key: 'IGNORE', label: '(התעלם)' },
    { key: 'IDENTIFIER', label: 'מזהה דייר/דירה (פס-טרו)' },
    { key: 'EXISTING_AREA', label: 'שטח דירה קיימת (מ״ר)' },
    { key: 'EXISTING_VALUE', label: 'שווי דירה קיימת (₪)' },
    { key: 'NEW_PRICE_PER_M2', label: 'מחיר מ״ר חדש (₪/מ״ר)' },
    { key: 'REPLACEMENT_AREA', label: 'שטח דירת תמורה (מ״ר)' },
    { key: 'CASH_COMPONENT', label: 'רכיב מזומן (₪)' },
    { key: 'FLAG_ONLY_HOME', label: 'מוכר מוטב / דירה יחידה (כן/לא)' },
    { key: 'FLAG_ELDERLY', label: 'קשיש (כן/לא)' },
    { key: 'FLAG_NURSING', label: 'נזקק סיעוד (כן/לא)' },
    { key: 'FLAG_DEAL_CASH', label: 'יש מזומן בעסקה — T38/1 (כן/לא)' },
    { key: 'FLAG_BOUGHT_UPGRADE', label: 'נרכש שדרוג מהיזם — T38/2 (כן/לא)' },
    { key: 'UPGRADE_CASH', label: 'סכום שדרוג במזומן (₪)' }
  ];

  function detectMapping(header) {
    var h = (header || '').toString().toLowerCase().replace(/["'״׳]/g, '');
    if (/^\s*(id|name|מספר|שם|מזהה|דייר|בעלים|owner)/.test(h) || /תת.?חלק/.test(h)) return 'IDENTIFIER';
    if (/שטח.*קיים|שטח.*ישנ|שטח.*נוכח|שטח.*דירה.*ישנ|existing.*area|old.*area|current.*area/.test(h)) return 'EXISTING_AREA';
    if (/שווי.*קיים|שווי.*ישנ|שווי.*דירה.*ישנ|מחיר.*דירה.*ישנ|existing.*value|old.*value/.test(h)) return 'EXISTING_VALUE';
    if (/מחיר.*מ.?ר|שווי.*מ.?ר|מחיר.*חדש|price.*sqm|price.*m2|new.*price/.test(h)) return 'NEW_PRICE_PER_M2';
    if (/שטח.*תמור|שטח.*חדש|שטח.*חליף|שטח.*דירה.*חדש|דירת.*תמור|replacement.*area|new.*area/.test(h)) return 'REPLACEMENT_AREA';
    if (/מזומן.*נוסף|תמורה.*כספית|תמור.*נוספ|cash.*component|רכיב.*מזומן/.test(h)) return 'CASH_COMPONENT';
    if (/דירה.*יחיד|מוכר.*מוטב|sole.*apt|only.*home/.test(h)) return 'FLAG_ONLY_HOME';
    if (/קשיש|elderly|senior/.test(h)) return 'FLAG_ELDERLY';
    if (/סיעוד|nursing/.test(h)) return 'FLAG_NURSING';
    if (/שדרוג.*נרכש|רכש.*שדרוג|bought.*upgrade/.test(h)) return 'FLAG_BOUGHT_UPGRADE';
    if (/שדרוג.*סכום|סכום.*שדרוג|upgrade.*cash|upgrade.*amount/.test(h)) return 'UPGRADE_CASH';
    if (/מזומן.*עסקה|deal.*cash|cash.*deal/.test(h)) return 'FLAG_DEAL_CASH';
    if (/^מזומן$|^cash$/.test(h.trim())) return 'CASH_COMPONENT';
    if (/^שטח$|^area$/.test(h.trim())) return 'EXISTING_AREA';
    if (/^שווי$|^מחיר$|^value$|^price$/.test(h.trim())) return 'EXISTING_VALUE';
    return 'IGNORE';
  }

  function $(id) { return document.getElementById(id); }
  function fmt(n) { return Math.round(n).toLocaleString('he-IL'); }
  function parseNum(v) {
    if (v == null || v === '') return 0;
    var s = v.toString().replace(/[,\s₪]/g, '');
    var n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  }
  function parseBool(v) {
    if (v === true || v === 1) return true;
    if (v == null || v === '') return false;
    var s = v.toString().trim().toLowerCase();
    return s === 'כן' || s === 'yes' || s === 'true' || s === '1' || s === '✓' || s === 'v' || s === 'x';
  }

  function applyVisibility() {
    var els = document.querySelectorAll('#mode-developer [data-show]');
    for (var i = 0; i < els.length; i++) {
      var allowed = els[i].getAttribute('data-show').split(' ');
      els[i].style.display = state.projectType && allowed.indexOf(state.projectType) !== -1 ? '' : 'none';
    }
  }

  function validateParams() {
    var ok = state.projectType !== null;
    if (state.projectType === 'PINUY_BINUY' || state.projectType === 'LOCAL_REPLACEMENT_PLAN' ||
        state.projectType === 'DEMOLITION_REBUILD_T38_2') {
      ok = ok && $('dev-price').value !== '' && parseNum($('dev-price').value) > 0;
    }
    if (state.projectType === 'DEMOLITION_REBUILD_T38_2') {
      ok = ok && $('dev-ceiling49z').value !== '' && parseNum($('dev-ceiling49z').value) > 0;
    }
    $('dev-next-params').disabled = !ok;
    return ok;
  }

  function showDevStep(n) {
    var steps = ['params', 'upload', 'mapping', 'results'];
    for (var i = 0; i < steps.length; i++) {
      $('dev-step-' + steps[i]).style.display = (i === n) ? '' : 'none';
    }
    window.scrollTo(0, 0);
  }

  function readFile(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function (e) {
        try {
          var data = new Uint8Array(e.target.result);
          var wb = XLSX.read(data, { type: 'array' });
          resolve(wb);
        } catch (err) { reject(err); }
      };
      reader.onerror = function () { reject(new Error('שגיאת קריאה')); };
      reader.readAsArrayBuffer(file);
    });
  }

  function parseWorkbook(wb) {
    var sheetName = wb.SheetNames[0];
    var sheet = wb.Sheets[sheetName];
    var rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    if (rows.length < 2) throw new Error('הקובץ ריק או חסר נתונים');
    var headers = rows[0].map(function (h) { return (h == null ? '' : h.toString()); });
    var data = rows.slice(1).filter(function (r) {
      return r.some(function (c) { return c !== '' && c != null; });
    }).map(function (r) {
      var obj = {};
      for (var i = 0; i < headers.length; i++) { obj[headers[i]] = r[i]; }
      return obj;
    });
    return { headers: headers, rows: data };
  }

  function renderMappingTable() {
    var html = '<div class="mapping-row"><span>שם עמודה בקובץ</span><span>מיפוי</span><span>תצוגה מקדימה (3 ראשונות)</span></div>';
    for (var i = 0; i < state.headers.length; i++) {
      var h = state.headers[i];
      var current = state.mapping[h] || detectMapping(h);
      state.mapping[h] = current;
      var preview = state.rows.slice(0, 3).map(function (r) {
        var v = r[h];
        return (v == null || v === '') ? '—' : v.toString();
      }).join(' | ');
      var opts = MAPPING_KEYS.map(function (m) {
        return '<option value="' + m.key + '"' + (m.key === current ? ' selected' : '') + '>' + m.label + '</option>';
      }).join('');
      html += '<div class="mapping-row">' +
              '<span><strong>' + (h || '(ריק)') + '</strong></span>' +
              '<select data-header="' + h.replace(/"/g, '&quot;') + '">' + opts + '</select>' +
              '<span class="preview">' + preview + '</span>' +
              '</div>';
    }
    $('dev-mapping-table').innerHTML = html;
    var selects = $('dev-mapping-table').querySelectorAll('select');
    for (var j = 0; j < selects.length; j++) {
      selects[j].addEventListener('change', function () {
        state.mapping[this.getAttribute('data-header')] = this.value;
      });
    }
  }

  // --- per-row input builder ---
  function buildRowInput(row, mapping) {
    var input = { projectType: state.projectType };
    var idCol = null;
    for (var h in mapping) {
      if (mapping[h] === 'IDENTIFIER') { idCol = h; break; }
    }
    var rowId = idCol ? (row[idCol] != null ? row[idCol].toString() : '') : '';

    var get = function (key) {
      for (var k in mapping) { if (mapping[k] === key) return row[k]; }
      return undefined;
    };

    var existingArea = parseNum(get('EXISTING_AREA'));
    var existingValue = parseNum(get('EXISTING_VALUE'));
    var newPriceCell = get('NEW_PRICE_PER_M2');
    var newPrice = (newPriceCell != null && newPriceCell !== '') ? parseNum(newPriceCell) : state.defaultPrice;
    var replArea = parseNum(get('REPLACEMENT_AREA'));
    var cash = parseNum(get('CASH_COMPONENT'));

    input.existingUnitAreaM2 = existingArea;
    input.replacementAreaM2 = replArea;

    if (state.projectType === 'PINUY_BINUY' || state.projectType === 'LOCAL_REPLACEMENT_PLAN') {
      input.existingUnitValue = existingValue;
      input.newPricePerM2 = newPrice;
      input.cashComponent = cash;
      input.onlyHomeOwner = parseBool(get('FLAG_ONLY_HOME'));
      input.elderly = parseBool(get('FLAG_ELDERLY'));
      input.needsNursing = parseBool(get('FLAG_NURSING'));
    } else if (state.projectType === 'STRENGTHENING_T38_1') {
      input.dealIncludesCash = parseBool(get('FLAG_DEAL_CASH'));
    } else if (state.projectType === 'DEMOLITION_REBUILD_T38_2') {
      input.existingUnitValue = existingValue;
      input.newPricePerM2 = newPrice;
      input.ceiling49z = state.ceiling49z;
      input.boughtUpgradeFromDeveloper = parseBool(get('FLAG_BOUGHT_UPGRADE'));
      input.upgradeCash = parseNum(get('UPGRADE_CASH'));
    }
    return { rowId: rowId, input: input };
  }

  // Per-project-type required-field check. Splits into HARD (block calc) and SOFT (warn but calc).
  // Returns { hard: [...], soft: [...] }.
  function missingRequired(input) {
    var hard = [], soft = [];
    var pt = input.projectType;
    if (!(input.existingUnitAreaM2 > 0)) hard.push('שטח דירה קיימת');
    if (!(input.replacementAreaM2 > 0)) hard.push('שטח דירת תמורה');
    if (pt === 'PINUY_BINUY' || pt === 'LOCAL_REPLACEMENT_PLAN') {
      if (!(input.newPricePerM2 > 0)) hard.push('מחיר מ״ר חדש');
      if (!(input.existingUnitValue > 0)) soft.push('שווי דירה קיימת');
    }
    if (pt === 'DEMOLITION_REBUILD_T38_2') {
      if (!(input.newPricePerM2 > 0)) hard.push('מחיר מ״ר חדש');
      if (!(input.ceiling49z > 0)) hard.push('תקרת 49ז');
      if (!(input.existingUnitValue > 0)) soft.push('שווי דירה קיימת');
    }
    return { hard: hard, soft: soft };
  }

  function processAll() {
    var out = [];
    for (var i = 0; i < state.rows.length; i++) {
      var built = buildRowInput(state.rows[i], state.mapping);
      var miss = missingRequired(built.input);
      var status, taxableBase = 0, result = null, isPartial = false;
      if (miss.hard.length > 0) {
        status = 'INCOMPLETE';
      } else {
        result = E.computeDweller(built.input);
        if (result.isPB) {
          status = result.taxableExcess > 0 ? 'TAXABLE' : 'EXEMPT';
          taxableBase = result.taxableExcess;
        } else if (result.isT38_1) {
          status = result.areaOk ? (result.dealHasCashPortion ? 'PARTIAL' : 'EXEMPT') : 'TAXABLE';
        } else if (result.isT38_2) {
          status = result.exempt ? 'EXEMPT' : 'TAXABLE';
        }
        if (miss.soft.length > 0) { isPartial = true; }
      }
      var reason = '';
      if (result) {
        if (result.isPB) {
          var alt = result.ceilingAlternatives;
          var existingArea = built.input.existingUnitAreaM2 || 0;
          var altCArea = Math.min(1.5 * existingArea, 200);
          var mark = function (val) { return val === result.ceiling ? ' ★' : ''; };
          var fmtAlt = function (val) { return val > 0 ? fmt(val) + ' ₪' : '—'; };
          reason =
            'חלופה א (150% משווי הישנה): ' + fmtAlt(alt.altA) + mark(alt.altA) + '\n' +
            'חלופה ב (שווי דירת 120 מ״ר): ' + fmtAlt(alt.altB) + mark(alt.altB) + '\n' +
            'חלופה ג (שווי דירת ' + altCArea + ' מ״ר): ' + fmtAlt(alt.altC) + mark(alt.altC);
        } else if (result.isT38_1) {
          reason = 'מגבלת שטח: ' + result.areaLimit + ' מ״ר (שטח קיים + 25)';
        } else if (result.isT38_2) {
          var areaOkSym = result.areaTestOk ? '✓' : '✗';
          var valueOkSym = result.valueTestOk ? '✓' : '✗';
          var which2 = result.valueLimit === result.ceiling49z ? 'תקרת 49ז' : 'שווי הדירה הישנה';
          reason =
            'מבחן שטח (≤' + result.areaLimit + ' מ״ר): ' + areaOkSym + '\n' +
            'מבחן שווי (≤' + fmt(result.valueLimit) + ' ₪ — ' + which2 + '): ' + valueOkSym;
        }
      }
      out.push({
        rowIndex: i + 1,
        rowId: built.rowId,
        input: built.input,
        result: result,
        status: status,
        isPartial: isPartial,
        missingHard: miss.hard,
        missingSoft: miss.soft,
        reason: reason,
        taxableBase: taxableBase
      });
    }
    state.results = out;
    return out;
  }

  function computeKpis(results) {
    var total = results.length;
    var exempt = 0, taxable = 0, partial = 0, incomplete = 0, partialResult = 0, sumTaxable = 0;
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      if (r.status === 'EXEMPT') exempt++;
      else if (r.status === 'TAXABLE') taxable++;
      else if (r.status === 'PARTIAL') partial++;
      else if (r.status === 'INCOMPLETE') incomplete++;
      if (r.isPartial) partialResult++;
      sumTaxable += r.taxableBase || 0;
    }
    return {
      total: total, exempt: exempt, taxable: taxable, partial: partial,
      incomplete: incomplete, partialResult: partialResult,
      sumTaxable: sumTaxable,
      taxableShare: total > 0 ? (taxable / total) : 0
    };
  }

  function renderKpis(kpis) {
    var html = '';
    html += '<div class="kpi-card"><div class="kpi-label">סה״כ דיירים</div><div class="kpi-value">' + kpis.total + '</div></div>';
    html += '<div class="kpi-card kpi-success"><div class="kpi-label">פטורים</div><div class="kpi-value">' + kpis.exempt + '</div></div>';
    html += '<div class="kpi-card kpi-danger"><div class="kpi-label">חורגים / חייבים</div><div class="kpi-value">' + kpis.taxable + '</div></div>';
    if (kpis.partial > 0) {
      html += '<div class="kpi-card"><div class="kpi-label">חלקיים</div><div class="kpi-value">' + kpis.partial + '</div></div>';
    }
    if (kpis.incomplete > 0) {
      html += '<div class="kpi-card kpi-warning"><div class="kpi-label">חסר נתונים</div><div class="kpi-value">' + kpis.incomplete + '</div></div>';
    }
    if (kpis.partialResult > 0) {
      html += '<div class="kpi-card kpi-warning"><div class="kpi-label">תוצאה חלקית</div><div class="kpi-value">' + kpis.partialResult + '</div></div>';
    }
    if (state.projectType === 'PINUY_BINUY' || state.projectType === 'LOCAL_REPLACEMENT_PLAN') {
      html += '<div class="kpi-card kpi-danger"><div class="kpi-label">סה״כ רכיב חייב (פינוי-בינוי)</div>' +
              '<div class="kpi-value">' + fmt(kpis.sumTaxable) + ' <small>₪</small></div></div>';
    }
    $('dev-kpi-row').innerHTML = html;
  }

  function statusLabel(s, missingHard, missingSoft, isPartial) {
    var base = '';
    if (s === 'EXEMPT') base = '<span style="color:#2E7D52;font-weight:700">פטור</span>';
    else if (s === 'TAXABLE') base = '<span style="color:#C0392B;font-weight:700">חייב/חורג</span>';
    else if (s === 'PARTIAL') base = '<span style="color:#8A5A1A;font-weight:700">חלקי</span>';
    else if (s === 'INCOMPLETE') {
      var why = missingHard && missingHard.length ? ' (חסר: ' + missingHard.join(', ') + ')' : '';
      return '<span style="color:#8A6D3B;font-weight:700">חסר נתונים' + why + '</span>';
    } else base = (s || '—');
    if (isPartial && missingSoft && missingSoft.length) {
      base += '<small style="color:#8A6D3B;font-weight:600"> ★ תוצאה חלקית — חסר: ' +
              missingSoft.join(', ') + '</small>';
    }
    return base;
  }

  function renderResultsTable(results) {
    var pt = state.projectType;
    var isPB = pt === 'PINUY_BINUY' || pt === 'LOCAL_REPLACEMENT_PLAN';
    var isT38_1 = pt === 'STRENGTHENING_T38_1';
    var isT38_2 = pt === 'DEMOLITION_REBUILD_T38_2';

    var cols = ['#', 'מזהה'];
    if (isPB) cols = cols.concat(['שטח קיים', 'שווי קיים', 'שטח תמורה', 'שווי תמורה', 'תקרה', 'נמדד', 'פטור', 'חייב', 'סטטוס']);
    if (isT38_1) cols = cols.concat(['שטח קיים', 'שטח תמורה', 'מגבלת שטח', 'מזומן בעסקה?', 'סטטוס']);
    if (isT38_2) cols = cols.concat(['שטח קיים', 'שווי קיים', 'שטח תמורה', 'שווי תמורה', 'מגבלת שטח', 'תקרת שווי', 'מבחן שטח', 'מבחן שווי', 'סטטוס']);

    var html = '<div class="results-table-wrap"><table class="results-table"><thead><tr>';
    for (var c = 0; c < cols.length; c++) html += '<th>' + cols[c] + '</th>';
    html += '</tr></thead><tbody>';

    function cell(v, css) {
      return '<td class="' + (css || '') + '">' + (v === '' || v == null ? '—' : v) + '</td>';
    }
    function n(v) { return (v > 0) ? fmt(v) : '—'; }

    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      var cls = r.status === 'TAXABLE' ? 'row-taxable' :
                r.status === 'EXEMPT' ? 'row-exempt' :
                r.status === 'INCOMPLETE' ? 'row-incomplete' : '';
      if (r.isPartial) { cls += ' row-partial-result'; }
      var inc = r.status === 'INCOMPLETE';
      html += '<tr class="' + cls + '">';
      html += '<td>' + r.rowIndex + '</td>';
      html += '<td>' + (r.rowId || '—') + '</td>';
      if (isPB) {
        html += cell(n(r.input.existingUnitAreaM2), 'num');
        html += cell(n(r.input.existingUnitValue), 'num');
        html += cell(n(r.input.replacementAreaM2), 'num');
        html += cell(inc ? '—' : n(r.result.replacementValue), 'num');
        html += cell(inc ? '—' : n(r.result.ceiling), 'num');
        html += cell(inc ? '—' : n(r.result.measuredConsideration), 'num');
        html += cell(inc ? '—' : n(r.result.exemptBase), 'num');
        html += cell(inc ? '—' : fmt(r.result.taxableExcess), 'num');
        html += '<td>' + statusLabel(r.status, r.missingHard, r.missingSoft, r.isPartial) +
  (r.reason ? '<div style="color:#555;margin-top:6px;font-size:0.82rem;font-weight:500;white-space:pre-line;line-height:1.5">' + r.reason + '</div>' : '') +
  '</td>';
      } else if (isT38_1) {
        html += cell(n(r.input.existingUnitAreaM2), 'num');
        html += cell(n(r.input.replacementAreaM2), 'num');
        html += cell(inc ? '—' : (n(r.result.areaLimit) + ' מ״ר'), 'num');
        html += cell(inc ? '—' : (r.result.dealHasCashPortion ? 'כן (פרו-רטה)' : 'לא'));
        html += '<td>' + statusLabel(r.status, r.missingHard, r.missingSoft, r.isPartial) +
  (r.reason ? '<div style="color:#555;margin-top:6px;font-size:0.82rem;font-weight:500;white-space:pre-line;line-height:1.5">' + r.reason + '</div>' : '') +
  '</td>';
      } else if (isT38_2) {
        html += cell(n(r.input.existingUnitAreaM2), 'num');
        html += cell(n(r.input.existingUnitValue), 'num');
        html += cell(n(r.input.replacementAreaM2), 'num');
        html += cell(inc ? '—' : n(r.result.replacementValue), 'num');
        html += cell(inc ? '—' : (n(r.result.areaLimit) + ' מ״ר'), 'num');
        html += cell(inc ? '—' : n(r.result.valueLimit), 'num');
        html += cell(inc ? '—' : (r.result.areaTestOk ? '✓' : '✗'));
        html += cell(inc ? '—' : (r.result.valueTestOk ? '✓' : '✗'));
        html += '<td>' + statusLabel(r.status, r.missingHard, r.missingSoft, r.isPartial) +
  (r.reason ? '<div style="color:#555;margin-top:6px;font-size:0.82rem;font-weight:500;white-space:pre-line;line-height:1.5">' + r.reason + '</div>' : '') +
  '</td>';
      }
      html += '</tr>';
    }
    html += '</tbody></table></div>';
    $('dev-results-table-wrap').innerHTML = html;
  }

  // --- exports ---
  function exportExcel() {
    if (!state.results.length) { alert('אין תוצאות לייצוא.'); return; }
    var pt = state.projectType;
    var isPB = pt === 'PINUY_BINUY' || pt === 'LOCAL_REPLACEMENT_PLAN';
    var isT38_1 = pt === 'STRENGTHENING_T38_1';
    var isT38_2 = pt === 'DEMOLITION_REBUILD_T38_2';

    var newHeaders = state.headers.slice();
    var appendCols;
    if (isPB) appendCols = ['שווי דירת תמורה (מחושב)', 'תקרת שווי', 'נמדד מול תקרה', 'רכיב פטור', 'רכיב חייב', 'סטטוס'];
    else if (isT38_1) appendCols = ['מגבלת שטח', 'מזומן בעסקה (פרו-רטה)', 'סטטוס'];
    else if (isT38_2) appendCols = ['שווי דירת תמורה (מחושב)', 'מגבלת שטח', 'תקרת שווי (max 49ז / שווי ישן)', 'מבחן שטח', 'מבחן שווי', 'סטטוס'];
    else appendCols = ['סטטוס'];
    newHeaders = newHeaders.concat(appendCols);

    var aoa = [newHeaders];
    for (var i = 0; i < state.results.length; i++) {
      var r = state.results[i];
      var row = [];
      for (var c = 0; c < state.headers.length; c++) {
        row.push(state.rows[i][state.headers[c]]);
      }
      var statusOut;
      if (r.status === 'INCOMPLETE') {
        statusOut = 'INCOMPLETE — חסר: ' + (r.missingHard || []).join(', ');
      } else {
        statusOut = r.status;
        if (r.reason) statusOut += ' — ' + r.reason.replace(/\n/g, ' | ');
        if (r.isPartial && r.missingSoft && r.missingSoft.length) {
          statusOut += ' (תוצאה חלקית — חסר: ' + r.missingSoft.join(', ') + ')';
        }
      }
      if (isPB) {
        if (r.result) {
          row.push(Math.round(r.result.replacementValue));
          row.push(Math.round(r.result.ceiling));
          row.push(Math.round(r.result.measuredConsideration));
          row.push(Math.round(r.result.exemptBase));
          row.push(Math.round(r.result.taxableExcess));
        } else { row.push('', '', '', '', ''); }
        row.push(statusOut);
      } else if (isT38_1) {
        if (r.result) {
          row.push(r.result.areaLimit);
          row.push(r.result.dealHasCashPortion ? 'כן' : 'לא');
        } else { row.push('', ''); }
        row.push(statusOut);
      } else if (isT38_2) {
        if (r.result) {
          row.push(Math.round(r.result.replacementValue));
          row.push(r.result.areaLimit);
          row.push(Math.round(r.result.valueLimit));
          row.push(r.result.areaTestOk ? 'עומד' : 'לא עומד');
          row.push(r.result.valueTestOk ? 'עומד' : 'לא עומד');
        } else { row.push('', '', '', '', ''); }
        row.push(statusOut);
      }
      aoa.push(row);
    }
    var ws = XLSX.utils.aoa_to_sheet(aoa);
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'תוצאות');
    var kpis = computeKpis(state.results);
    var kpiAoa = [
      ['פרמטר', 'ערך'],
      ['סוג פרויקט', pt],
      ['סה״כ דיירים', kpis.total],
      ['פטורים', kpis.exempt],
      ['חורגים', kpis.taxable]
    ];
    if (kpis.partial) kpiAoa.push(['חלקיים', kpis.partial]);
    if (kpis.incomplete) kpiAoa.push(['חסר נתונים', kpis.incomplete]);
    if (kpis.partialResult) kpiAoa.push(['תוצאה חלקית (חסר שווי דירה ישנה)', kpis.partialResult]);
    if (isPB) kpiAoa.push(['סה״כ רכיב חייב (₪)', Math.round(kpis.sumTaxable)]);
    var kpiWs = XLSX.utils.aoa_to_sheet(kpiAoa);
    XLSX.utils.book_append_sheet(wb, kpiWs, 'סיכום');
    XLSX.writeFile(wb, 'תוצאות-פרויקט-התחדשות-עירונית.xlsx');
  }

  function exportPdf() {
    var btn = $('dev-export-pdf');
    var resetBtn = $('dev-reset');
    var excelBtn = $('dev-export-excel');
    var target = $('dev-step-results');
    btn.disabled = true;
    var oldText = btn.textContent;
    btn.textContent = 'מייצא...';
    btn.style.display = 'none';
    resetBtn.style.display = 'none';
    excelBtn.style.display = 'none';
    window.html2canvas(target, { scale: 2, backgroundColor: '#FFFFFF' })
      .then(function (canvas) {
        var jsPDF = window.jspdf.jsPDF;
        var pdf = new jsPDF('p', 'mm', 'a4');
        var pageW = pdf.internal.pageSize.getWidth();
        var pageH = pdf.internal.pageSize.getHeight();
        var imgW = pageW - 20;
        var imgH = canvas.height * imgW / canvas.width;
        var dataUrl = canvas.toDataURL('image/png');
        if (imgH <= pageH - 20) {
          pdf.addImage(dataUrl, 'PNG', 10, 10, imgW, imgH);
        } else {
          var sliceH = (pageH - 20) * canvas.width / imgW;
          var ySrc = 0;
          while (ySrc < canvas.height) {
            var sliceCanvas = document.createElement('canvas');
            sliceCanvas.width = canvas.width;
            sliceCanvas.height = Math.min(sliceH, canvas.height - ySrc);
            sliceCanvas.getContext('2d').drawImage(canvas, 0, ySrc, canvas.width, sliceCanvas.height, 0, 0, canvas.width, sliceCanvas.height);
            var slH = sliceCanvas.height * imgW / canvas.width;
            if (ySrc > 0) pdf.addPage();
            pdf.addImage(sliceCanvas.toDataURL('image/png'), 'PNG', 10, 10, imgW, slH);
            ySrc += sliceH;
          }
        }
        pdf.save('דוח-פרויקט-התחדשות-עירונית.pdf');
      })
      .catch(function (err) {
        alert('ייצוא ה-PDF נכשל: ' + err);
      })
      .then(function () {
        btn.style.display = '';
        resetBtn.style.display = '';
        excelBtn.style.display = '';
        btn.disabled = false;
        btn.textContent = oldText;
      });
  }

  // --- init ---
  function init() {
    var choices = document.querySelectorAll('#dev-project-type-grid .choice');
    for (var i = 0; i < choices.length; i++) {
      choices[i].addEventListener('click', function () {
        var all = document.querySelectorAll('#dev-project-type-grid .choice');
        for (var j = 0; j < all.length; j++) { all[j].classList.remove('is-selected'); }
        this.classList.add('is-selected');
        state.projectType = this.getAttribute('data-value');
        applyVisibility();
        validateParams();
      });
    }
    $('dev-price').addEventListener('input', validateParams);
    $('dev-ceiling49z').addEventListener('input', validateParams);

    $('dev-next-params').addEventListener('click', function () {
      if (!validateParams()) return;
      state.defaultPrice = parseNum($('dev-price').value);
      state.ceiling49z = parseNum($('dev-ceiling49z').value) || 2428100;
      showDevStep(1);
    });
    $('dev-back-upload').addEventListener('click', function () { showDevStep(0); });
    $('dev-back-mapping').addEventListener('click', function () { showDevStep(1); });

    var dz = $('dev-dropzone');
    var fileInput = $('dev-file');
    dz.addEventListener('click', function () { fileInput.click(); });
    dz.addEventListener('dragover', function (e) { e.preventDefault(); dz.classList.add('is-dragover'); });
    dz.addEventListener('dragleave', function () { dz.classList.remove('is-dragover'); });
    dz.addEventListener('drop', function (e) {
      e.preventDefault();
      dz.classList.remove('is-dragover');
      if (e.dataTransfer.files.length) { handleFile(e.dataTransfer.files[0]); }
    });
    fileInput.addEventListener('change', function () {
      if (this.files.length) { handleFile(this.files[0]); }
    });

    $('dev-next-upload').addEventListener('click', function () {
      renderMappingTable();
      showDevStep(2);
    });

    $('dev-process-btn').addEventListener('click', function () {
      var results = processAll();
      var kpis = computeKpis(results);
      renderKpis(kpis);
      renderResultsTable(results);
      showDevStep(3);
    });

    $('dev-export-excel').addEventListener('click', function () {
      try { exportExcel(); }
      catch (err) { alert('ייצוא Excel נכשל: ' + err.message); }
    });
    $('dev-export-pdf').addEventListener('click', function () { exportPdf(); });

    $('dev-reset').addEventListener('click', function () { window.location.reload(); });
  }

  function handleFile(file) {
    var errBox = $('dev-upload-error');
    var info = $('dev-file-info');
    errBox.style.display = 'none';
    info.style.display = 'none';
    $('dev-next-upload').disabled = true;
    readFile(file).then(function (wb) {
      state.rawWorkbook = wb;
      var parsed = parseWorkbook(wb);
      state.headers = parsed.headers;
      state.rows = parsed.rows;
      state.mapping = {};
      info.textContent = 'נטען: ' + file.name + ' — ' + parsed.rows.length + ' שורות, ' +
                         parsed.headers.length + ' עמודות';
      info.style.display = '';
      $('dev-next-upload').disabled = false;
    }).catch(function (err) {
      errBox.textContent = 'שגיאה בקריאת הקובץ: ' + err.message;
      errBox.style.display = '';
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
