// app.js — wizard navigation, validation, result rendering, PDF export (v2).
(function () {
  'use strict';

  var E = window.TaxEngine;

  // Wizard state. projectType is set in step 1; the rest is read at calc time.
  var state = { step: 1, projectType: null };

  // --- helpers ---
  function $(id) { return document.getElementById(id); }
  function num(id) { return parseFloat($(id).value) || 0; }
  function isFilled(id) {
    var v = $(id).value;
    return v !== '' && !isNaN(parseFloat(v)) && parseFloat(v) >= 0;
  }
  function isPB() {
    return state.projectType === 'PINUY_BINUY' ||
           state.projectType === 'LOCAL_REPLACEMENT_PLAN';
  }
  function isT38_2() { return state.projectType === 'DEMOLITION_REBUILD_T38_2'; }
  function isReplacementPlan() { return state.projectType === 'LOCAL_REPLACEMENT_PLAN'; }

  // Format a number with thousands separators, e.g. 2400000 -> "2,400,000".
  function fmt(n) {
    return Math.round(n).toLocaleString('he-IL');
  }

  function requireAuthBeforeCalculation() {
    return fetch('https://auth.lendover.co.il/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: '{}'
    }).then(function (resp) {
      if (resp.ok) { return true; }
      if (resp.status === 401 && window.handleAuth401) {
        return window.handleAuth401().then(requireAuthBeforeCalculation);
      }
      throw new Error('auth-check-failed');
    }).catch(function (err) {
      if (err && err.message === 'auth-check-failed') { throw err; }
      if (window.handleAuth401) {
        return window.handleAuth401().then(requireAuthBeforeCalculation);
      }
      throw err;
    });
  }

  // --- step visibility ---
  function showStep(n) {
    state.step = n;
    var steps = document.querySelectorAll('.wizard-step');
    var i;
    for (i = 0; i < steps.length; i++) {
      steps[i].classList.toggle('is-active', steps[i].id === 'step-' + n);
    }
    var dots = document.querySelectorAll('.progress-dot');
    for (i = 0; i < dots.length; i++) {
      var dn = parseInt(dots[i].getAttribute('data-step'), 10);
      dots[i].classList.toggle('is-active', dn === n);
      dots[i].classList.toggle('is-done', dn < n);
    }
    window.scrollTo(0, 0);
  }

  // Show/hide every [data-show] element based on the chosen project type.
  function applyProjectTypeVisibility() {
    var els = document.querySelectorAll('[data-show]');
    for (var i = 0; i < els.length; i++) {
      var allowed = els[i].getAttribute('data-show').split(' ');
      var show = state.projectType && allowed.indexOf(state.projectType) !== -1;
      els[i].style.display = show ? '' : 'none';
    }
  }

  // --- per-step validation; also enables/disables the step's next button ---
  function validateStep1() {
    var ok = state.projectType !== null;
    if (isReplacementPlan() && !$('plan-basis-valid').checked) { ok = false; }
    $('next-1').disabled = !ok;
    return ok;
  }

  function validateStep2() {
    var ok = isFilled('existing-area');
    if (isPB()) {
      ok = ok && isFilled('existing-value') && isFilled('new-price');
    }
    if (isT38_2()) {
      // T38/2 value test compares against max(49z, existing apt value) — need both.
      ok = ok && isFilled('existing-value') && isFilled('new-price');
    }
    $('next-2').disabled = !ok;
    return ok;
  }

  function validateStep3() {
    var ok = isFilled('replacement-area');
    if (isT38_2()) {
      ok = ok && isFilled('ceiling-49z');
    }
    $('next-3').disabled = !ok;
    return ok;
  }

  // --- gather input object for the engine ---
  function gatherInput() {
    var pt = state.projectType;
    var input = { projectType: pt };
    input.existingUnitAreaM2 = num('existing-area');
    input.replacementAreaM2 = num('replacement-area');
    if (pt === 'PINUY_BINUY' || pt === 'LOCAL_REPLACEMENT_PLAN') {
      input.existingUnitValue = num('existing-value');
      input.newPricePerM2 = num('new-price');
      input.cashComponent = num('cash-component');
      input.onlyHomeOwner = $('flag-only-home').checked;
      input.elderly = $('flag-elderly').checked;
      input.needsNursing = $('flag-nursing').checked;
    } else if (pt === 'STRENGTHENING_T38_1') {
      input.dealIncludesCash = $('flag-deal-cash').checked;
    } else if (pt === 'DEMOLITION_REBUILD_T38_2') {
      input.existingUnitValue = num('existing-value');
      input.newPricePerM2 = num('new-price');
      input.ceiling49z = num('ceiling-49z');
      input.boughtUpgradeFromDeveloper = $('flag-upgrade').checked;
      input.upgradeCash = num('upgrade-cash');
    }
    return input;
  }

  // --- result rendering ---

  // Build one result line: label (+ optional sub-note) and a formatted amount.
  function line(label, amount, opts) {
    opts = opts || {};
    var cls = 'result-line' + (opts.cls ? ' ' + opts.cls : '');
    var amt = (typeof amount === 'string') ? amount : (fmt(amount) + ' ₪');
    return '<div class="' + cls + '"><span class="lbl">' + label +
           '</span><span class="amt">' + amt + '</span></div>';
  }

  function splitBox(variant, label, amount) {
    return '<div class="split-box split-' + variant + '">' +
           '<span class="sb-label">' + label + '</span>' +
           '<span class="sb-amount">' + amount + '</span></div>';
  }

  function renderResult(result) {
    var html = '';

    if (result.isPB) {
      var alt = result.ceilingAlternatives;
      html += '<div class="result-block"><h3>תקרת השווי הפטורה</h3>';
      html += line('חלופה א — 150% משווי הדירה הישנה', alt.altA,
                   { cls: alt.altA === result.ceiling ? 'is-max' : '' });
      html += line('חלופה ב — שווי דירת 120 מ״ר במתחם', alt.altB,
                   { cls: alt.altB === result.ceiling ? 'is-max' : '' });
      html += line('חלופה ג — שווי דירה ששטחה 150% משטח הישנה (עד 200 מ״ר)', alt.altC,
                   { cls: alt.altC === result.ceiling ? 'is-max' : '' });
      html += line('<strong>תקרת שווי</strong>', result.ceiling, {});
      html += '</div>';

      html += '<div class="result-block"><h3>התמורה הנמדדת מול התקרה</h3>';
      html += line('שווי דירת התמורה', result.replacementValue);
      if (result.eligibleCash > 0) {
        html += line('רכיב מזומן — נכלל (מוכר מוטב)', result.eligibleCash);
      }
      if (result.nonEligibleCash > 0) {
        html += line('רכיב מזומן — אינו מוכר מוטב, חייב בנפרד', result.nonEligibleCash,
                     { cls: 'is-muted' });
      }
      html += line('<strong>סה״כ נמדד מול התקרה</strong>', result.measuredConsideration);
      html += '</div>';

      html += '<div class="result-block"><h3>פיצול לפטור מול חייב</h3>';
      html += splitBox('exempt', 'רכיב פטור ממס שבח',
                       fmt(result.exemptBase) + ' <small>₪</small>');
      html += splitBox('taxable', 'רכיב חייב במס שבח',
                       fmt(result.taxableExcess) + ' <small>₪</small>');
      html += '</div>';

      html += '<div class="note">דמי שכירות חלופית, הוצאות הובלה ושכר טרחת עו״ד ' +
              'פטורים בנפרד ואינם נספרים מול התקרה.</div>';
      if (result.taxableExcess > 0) {
        html += '<div class="note">"רכיב חייב" הוא בסיס שווי חייב — לא סכום המס. ' +
                'חישוב השבח בפועל דורש ייחוס יחסי של עלות הרכישה, ושיעור המס על ' +
                'העודף שנוי במחלוקת (פיצול ליניארי מוטב מול 25%-40%). יש לאמת מול יועץ מס.</div>';
      }
    }

    if (result.isT38_1) {
      html += '<div class="result-block"><h3>תמ״א 38 — חיזוק: מבחן שטח</h3>';
      html += line('מגבלת שטח זכאי (שטח קיים + 25 מ״ר)', result.areaLimit + ' מ״ר');
      html += line(result.areaOk ? 'דירת התמורה בתוך מגבלת השטח' :
                   'דירת התמורה חורגת ממגבלת השטח',
                   result.areaOk ? '✓ תקין' : '✗ חריגה',
                   { cls: result.areaOk ? 'is-ok' : 'is-fail' });
      html += '</div>';
      if (result.dealHasCashPortion) {
        html += '<div class="note">העסקה כוללת תמורה במזומן. לפי סעיף 49לג(ב), רכיב ' +
                'המזומן ייחשב מכירת זכות אחרת ויחויב במס פרו-רטה — רכיב שירותי הבנייה ' +
                'עצמו נשאר פטור. אין מדובר בשבירת הפטור הכולל, רק חיוב של החלק הכספי.</div>';
      }
    }

    if (result.isT38_2) {
      var valueLimitSource = result.valueLimit === result.ceiling49z ?
        'תקרת 49ז' : 'שווי הדירה הישנה';
      html += '<div class="result-block"><h3>תמ״א 38 — הריסה ובנייה: מבחני פטור</h3>';
      html += line('מבחן שטח (שטח תמורה ≤ ' + fmt(result.areaLimit) + ' מ״ר)',
                   result.areaTestOk ? '✓ עומד' : '✗ לא עומד',
                   { cls: result.areaTestOk ? 'is-ok' : 'is-fail' });
      html += line('מבחן שווי (שווי תמורה ' + fmt(result.replacementValue) +
                   ' ₪ ≤ ' + valueLimitSource + ' ' + fmt(result.valueLimit) + ' ₪)',
                   result.valueTestOk ? '✓ עומד' : '✗ לא עומד',
                   { cls: result.valueTestOk ? 'is-ok' : 'is-fail' });
      html += '</div>';
      html += splitBox(result.exempt ? 'exempt' : 'taxable',
                       result.exempt ? 'פטור — מתקיים מבחן אחד לפחות' :
                                        'אין פטור — שני המבחנים נכשלו',
                       result.exempt ? '✓' : '✗');

      html += '<div class="result-block"><h3>רכיב שדרוג — בסיס מס רכישה</h3>';
      if (result.upgradePurchaseTaxBase > 0) {
        html += line('בסיס מס רכישה על רכיב השדרוג', result.upgradePurchaseTaxBase);
        html += line('שיעור מס רכישה', 'לא צוין — קלט חיצוני', { cls: 'is-muted' });
      } else {
        html += line('לא נרכש שדרוג מהיזם — אין רכיב מס רכישה', '—', { cls: 'is-muted' });
      }
      html += '</div>';
    }

    $('result-body').innerHTML = html;
  }

  // --- event wiring ---
  function init() {
    var choices = document.querySelectorAll('#project-type-grid .choice');
    var i;
    for (i = 0; i < choices.length; i++) {
      choices[i].addEventListener('click', function () {
        var btn = this;
        var all = document.querySelectorAll('#project-type-grid .choice');
        for (var j = 0; j < all.length; j++) { all[j].classList.remove('is-selected'); }
        btn.classList.add('is-selected');
        state.projectType = btn.getAttribute('data-value');
        applyProjectTypeVisibility();
        validateStep1();
      });
    }

    $('plan-basis-valid').addEventListener('change', validateStep1);

    var inputs = document.querySelectorAll('.card input[type=number]');
    for (i = 0; i < inputs.length; i++) {
      inputs[i].addEventListener('input', function () {
        validateStep2();
        validateStep3();
      });
    }

    $('flag-upgrade').addEventListener('change', function () {
      $('upgrade-cash-group').style.display = this.checked ? '' : 'none';
    });

    $('next-1').addEventListener('click', function () { if (validateStep1()) { showStep(2); validateStep2(); } });
    $('next-2').addEventListener('click', function () { if (validateStep2()) { showStep(3); validateStep3(); } });
    $('next-3').addEventListener('click', function () { if (validateStep3()) { showStep(4); } });
    $('back-2').addEventListener('click', function () { showStep(1); });
    $('back-3').addEventListener('click', function () { showStep(2); });
    $('back-4').addEventListener('click', function () { showStep(3); });

    $('calc-btn').addEventListener('click', function () {
      if (!E) { alert('מנוע החישוב לא נטען. רענן את הדף.'); return; }
      var btn = this;
      var oldText = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'בודק הרשמה...';
      requireAuthBeforeCalculation()
        .then(function () {
          var result = E.computeDweller(gatherInput());
          renderResult(result);
          showStep(5);
        })
        .catch(function () {
          alert('כדי לחשב יש להתחבר או להירשם.');
        })
        .then(function () {
          btn.disabled = false;
          btn.textContent = oldText;
        });
    });

    $('reset-btn').addEventListener('click', function () { window.location.reload(); });

    $('export-pdf-btn').addEventListener('click', function () {
      var btn = this;
      var resetBtn = $('reset-btn');
      var target = $('step-5');
      btn.disabled = true;
      var oldText = btn.textContent;
      btn.textContent = 'מייצא...';
      btn.style.display = 'none';
      resetBtn.style.display = 'none';
      window.html2canvas(target, { scale: 2, backgroundColor: '#FFFFFF' })
        .then(function (canvas) {
          var jsPDF = window.jspdf.jsPDF;
          var pdf = new jsPDF('p', 'mm', 'a4');
          var pageW = pdf.internal.pageSize.getWidth();
          var imgW = pageW - 20;
          var imgH = canvas.height * imgW / canvas.width;
          pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 10, 10, imgW, imgH);
          pdf.save('מחשבון-פטור-ממס-התחדשות-עירונית.pdf');
        })
        .catch(function (err) {
          alert('ייצוא ה-PDF נכשל. נסה שוב. (' + err + ')');
        })
        .then(function () {
          btn.style.display = '';
          resetBtn.style.display = '';
          btn.disabled = false;
          btn.textContent = oldText;
        });
    });

    // v4 — mode switcher (dweller / developer)
    var modeTabs = document.querySelectorAll('.mode-tab');
    function setMode(mode) {
      for (var k = 0; k < modeTabs.length; k++) {
        modeTabs[k].classList.toggle('is-active', modeTabs[k].getAttribute('data-mode') === mode);
      }
      document.getElementById('mode-dweller').classList.toggle('is-active', mode === 'dweller');
      document.getElementById('mode-developer').classList.toggle('is-active', mode === 'developer');
      window.scrollTo(0, 0);
    }
    for (i = 0; i < modeTabs.length; i++) {
      modeTabs[i].addEventListener('click', function () {
        setMode(this.getAttribute('data-mode'));
      });
    }

    // Only show step 1 if dweller mode is active on load (mode switcher governs).
    if (document.getElementById('mode-dweller').classList.contains('is-active')) {
      showStep(1);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
