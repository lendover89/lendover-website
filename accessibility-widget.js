/**
 * Accessibility Widget - אהרון לנדובר
 * כפתור נגישות צף עם אפשרויות: גודל טקסט, ניגודיות, הדגשת קישורים, ניווט מקלדת
 */
(function () {
  'use strict';

  // State
  let fontSizeLevel = 0; // -2 to +4
  let highContrast = false;
  let highlightLinks = false;
  let keyboardNav = false;
  let panelOpen = false;

  // Load saved preferences
  try {
    const saved = JSON.parse(sessionStorage.getItem('a11y_prefs') || '{}');
    fontSizeLevel = saved.fontSizeLevel || 0;
    highContrast = saved.highContrast || false;
    highlightLinks = saved.highlightLinks || false;
    keyboardNav = saved.keyboardNav || false;
  } catch (e) { /* ignore */ }

  function savePrefs() {
    try {
      sessionStorage.setItem('a11y_prefs', JSON.stringify({
        fontSizeLevel, highContrast, highlightLinks, keyboardNav
      }));
    } catch (e) { /* ignore */ }
  }

  // Create widget HTML
  function createWidget() {
    // Main button
    var btn = document.createElement('button');
    btn.className = 'a11y-widget-btn';
    btn.setAttribute('aria-label', 'תפריט נגישות');
    btn.setAttribute('title', 'נגישות');
    btn.innerHTML = '♿';
    btn.addEventListener('click', togglePanel);

    // Panel
    var panel = document.createElement('div');
    panel.className = 'a11y-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'אפשרויות נגישות');
    panel.innerHTML = [
      '<h3>הגדרות נגישות</h3>',
      // Font size
      '<div class="a11y-option">',
      '  <span>גודל טקסט</span>',
      '  <div class="a11y-option-btns">',
      '    <button class="a11y-btn" data-action="font-down" aria-label="הקטנת טקסט">א-</button>',
      '    <button class="a11y-btn" data-action="font-reset" aria-label="איפוס גודל טקסט">א</button>',
      '    <button class="a11y-btn" data-action="font-up" aria-label="הגדלת טקסט">א+</button>',
      '  </div>',
      '</div>',
      // High contrast
      '<div class="a11y-option">',
      '  <span>ניגודיות גבוהה</span>',
      '  <button class="a11y-toggle" data-action="contrast" aria-label="ניגודיות גבוהה" role="switch" aria-checked="false"></button>',
      '</div>',
      // Highlight links
      '<div class="a11y-option">',
      '  <span>הדגשת קישורים</span>',
      '  <button class="a11y-toggle" data-action="links" aria-label="הדגשת קישורים" role="switch" aria-checked="false"></button>',
      '</div>',
      // Keyboard navigation
      '<div class="a11y-option">',
      '  <span>ניווט מקלדת</span>',
      '  <button class="a11y-toggle" data-action="keyboard" aria-label="ניווט מקלדת" role="switch" aria-checked="false"></button>',
      '</div>',
      // Reset
      '<button class="a11y-reset-btn" data-action="reset">איפוס הגדרות</button>',
      // Link to declaration
      '<a href="accessibility.html" class="a11y-panel-link">הצהרת נגישות</a>'
    ].join('\n');

    panel.addEventListener('click', handlePanelClick);

    document.body.appendChild(btn);
    document.body.appendChild(panel);

    // Close panel on Escape
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && panelOpen) {
        togglePanel();
        btn.focus();
      }
    });

    // Close panel when clicking outside
    document.addEventListener('click', function (e) {
      if (panelOpen && !panel.contains(e.target) && e.target !== btn) {
        panelOpen = false;
        panel.classList.remove('open');
      }
    });

    // Apply saved preferences
    applyAll();
  }

  function togglePanel() {
    panelOpen = !panelOpen;
    var panel = document.querySelector('.a11y-panel');
    if (panel) {
      panel.classList.toggle('open', panelOpen);
    }
  }

  function handlePanelClick(e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;

    var action = btn.getAttribute('data-action');

    switch (action) {
      case 'font-up':
        if (fontSizeLevel < 4) fontSizeLevel++;
        applyFontSize();
        break;
      case 'font-down':
        if (fontSizeLevel > -2) fontSizeLevel--;
        applyFontSize();
        break;
      case 'font-reset':
        fontSizeLevel = 0;
        applyFontSize();
        break;
      case 'contrast':
        highContrast = !highContrast;
        applyContrast();
        updateToggle(btn, highContrast);
        break;
      case 'links':
        highlightLinks = !highlightLinks;
        applyLinks();
        updateToggle(btn, highlightLinks);
        break;
      case 'keyboard':
        keyboardNav = !keyboardNav;
        applyKeyboard();
        updateToggle(btn, keyboardNav);
        break;
      case 'reset':
        fontSizeLevel = 0;
        highContrast = false;
        highlightLinks = false;
        keyboardNav = false;
        applyAll();
        break;
    }

    savePrefs();
  }

  function updateToggle(btn, state) {
    btn.classList.toggle('active', state);
    btn.setAttribute('aria-checked', state ? 'true' : 'false');
  }

  function applyFontSize() {
    var size = 100 + (fontSizeLevel * 12.5); // each step = 12.5%
    document.documentElement.style.fontSize = size + '%';
  }

  function applyContrast() {
    document.body.classList.toggle('a11y-high-contrast', highContrast);
    var toggle = document.querySelector('[data-action="contrast"]');
    if (toggle) updateToggle(toggle, highContrast);
  }

  function applyLinks() {
    document.body.classList.toggle('a11y-highlight-links', highlightLinks);
    var toggle = document.querySelector('[data-action="links"]');
    if (toggle) updateToggle(toggle, highlightLinks);
  }

  function applyKeyboard() {
    document.body.classList.toggle('a11y-keyboard-nav', keyboardNav);
    var toggle = document.querySelector('[data-action="keyboard"]');
    if (toggle) updateToggle(toggle, keyboardNav);
  }

  function applyAll() {
    applyFontSize();
    applyContrast();
    applyLinks();
    applyKeyboard();
  }

  // Init
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createWidget);
  } else {
    createWidget();
  }
})();
