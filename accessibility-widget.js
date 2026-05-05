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


  function injectStyles() {
    if (document.getElementById('a11y-widget-styles')) return;
    var style = document.createElement('style');
    style.id = 'a11y-widget-styles';
    style.textContent = `
      .a11y-widget-btn {
        position: fixed !important;
        bottom: 96px !important;
        left: 28px !important;
        z-index: 2147483000 !important;
        width: 48px !important;
        height: 48px !important;
        border-radius: 50% !important;
        background: #1a2b4a !important;
        color: #fff !important;
        border: 2px solid #fff !important;
        cursor: pointer !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        font-size: 24px !important;
        box-shadow: 0 4px 16px rgba(0,0,0,0.25) !important;
        transition: transform 0.2s, background 0.2s !important;
        line-height: 1 !important;
        padding: 0 !important;
        margin: 0 !important;
        font-family: Arial, sans-serif !important;
      }
      .a11y-widget-btn:hover { transform: scale(1.08) !important; background: #b08a57 !important; }
      .a11y-widget-btn:focus { outline: 3px solid #b08a57 !important; outline-offset: 2px !important; }
      .a11y-panel {
        position: fixed !important;
        bottom: 152px !important;
        left: 28px !important;
        z-index: 2147482999 !important;
        background: #fff !important;
        color: #1a2b4a !important;
        border-radius: 12px !important;
        box-shadow: 0 8px 32px rgba(0,0,0,0.22) !important;
        padding: 24px !important;
        width: 280px !important;
        display: none !important;
        direction: rtl !important;
        text-align: right !important;
        border: 1px solid #e0e0e0 !important;
        font-family: Arial, sans-serif !important;
        box-sizing: border-box !important;
      }
      .a11y-panel.open { display: block !important; }
      .a11y-panel * { box-sizing: border-box !important; }
      .a11y-panel h3 {
        font-size: 18px !important;
        font-weight: 700 !important;
        color: #1a2b4a !important;
        margin: 0 0 20px !important;
        padding-bottom: 10px !important;
        border-bottom: 2px solid #f4efe7 !important;
        line-height: 1.35 !important;
      }
      .a11y-option {
        display: flex !important;
        justify-content: space-between !important;
        align-items: center !important;
        gap: 12px !important;
        padding: 10px 0 !important;
        border-bottom: 1px solid #f0f0f0 !important;
      }
      .a11y-option span { font-size: 15px !important; color: #1a2b4a !important; font-weight: 600 !important; }
      .a11y-option-btns { display: flex !important; gap: 6px !important; }
      .a11y-btn {
        width: 36px !important; height: 36px !important; border-radius: 6px !important;
        border: 1px solid #ddd !important; background: #f5f5f5 !important; color: #1a2b4a !important;
        cursor: pointer !important; font-size: 16px !important; font-weight: 700 !important;
        display: flex !important; align-items: center !important; justify-content: center !important;
        padding: 0 !important; margin: 0 !important; line-height: 1 !important; font-family: Arial, sans-serif !important;
      }
      .a11y-btn:hover { background: #f4efe7 !important; border-color: #b08a57 !important; }
      .a11y-toggle {
        width: 48px !important; height: 28px !important; min-width: 48px !important;
        border-radius: 14px !important; border: 1px solid #ddd !important; background: #e0e0e0 !important;
        cursor: pointer !important; position: relative !important; padding: 0 !important; margin: 0 !important;
      }
      .a11y-toggle::after {
        content: '' !important; position: absolute !important; top: 3px !important; right: 3px !important;
        width: 20px !important; height: 20px !important; border-radius: 50% !important;
        background: #fff !important; box-shadow: 0 1px 4px rgba(0,0,0,0.2) !important; transition: transform 0.2s !important;
      }
      .a11y-toggle.active { background: #b08a57 !important; }
      .a11y-toggle.active::after { transform: translateX(-20px) !important; }
      .a11y-reset-btn {
        width: 100% !important; margin-top: 16px !important; padding: 10px !important;
        background: #f5f5f5 !important; border: 1px solid #ddd !important; border-radius: 6px !important;
        cursor: pointer !important; font-size: 14px !important; font-family: Arial, sans-serif !important;
        font-weight: 600 !important; color: #1a2b4a !important;
      }
      .a11y-reset-btn:hover { background: #e8e8e8 !important; }
      .a11y-panel-link {
        display: block !important; text-align: center !important; margin-top: 12px !important;
        font-size: 13px !important; color: #b08a57 !important; text-decoration: none !important;
      }
      .a11y-panel-link:hover { text-decoration: underline !important; }
      body.a11y-high-contrast { background: #000 !important; color: #fff !important; }
      body.a11y-high-contrast * { border-color: #fff !important; }
      body.a11y-high-contrast a { color: #ffff00 !important; }
      body.a11y-highlight-links a { text-decoration: underline !important; text-underline-offset: 3px !important; text-decoration-thickness: 2px !important; }
      body.a11y-keyboard-nav *:focus { outline: 3px solid #b08a57 !important; outline-offset: 3px !important; }
      @media (max-width: 768px) {
        .a11y-widget-btn { bottom: 76px !important; left: 16px !important; width: 42px !important; height: 42px !important; font-size: 20px !important; }
        .a11y-panel { bottom: 126px !important; left: 16px !important; right: 16px !important; width: auto !important; }
      }
    `;
    document.head.appendChild(style);
  }

  // Create widget HTML
  function createWidget() {
    injectStyles();
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
      '<a href="/accessibility.html" class="a11y-panel-link">הצהרת נגישות</a>'
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


