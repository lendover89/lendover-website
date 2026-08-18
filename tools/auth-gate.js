/* auth-gate.js — Authentication gate for lendover.co.il tools
 * Handles: registration, login, email verification, password reset
 * Shows modal on 401 responses — does NOT block the page on load (preview mode)
 */
'use strict';

(function () {

  // Detect tool subdomain and route auth through its /auth/ proxy
  // to avoid cross-origin cookie issues
  const AUTH_API = (function () {
    const path = window.location.pathname;
    const toolMatch = path.match(/\/tools\/(tabutab|tabucaunt|buildcalc|groundwater|tabu2docs)\//);
    if (toolMatch) {
      return 'https://' + toolMatch[1] + '.lendover.co.il/auth';
    }
    return 'https://auth.lendover.co.il';
  })();

  // ── State ────────────────────────────────────────────────────────

  let _overlay = null;
  let _currentScreen = 'login';
  let _pendingUserId = null;
  let _pendingEmail = null;
  let _pendingPurpose = null;  // 'verify', 'reset', or 'oidc_link'
  let _pendingProvider = null;  // 'google' | 'microsoft', set when _pendingPurpose is 'oidc_link'
  let _pendingLinkToken = null;  // binds the verify-code submit to one pending OIDC link
  let _pendingNotice = '';  // one-shot message shown atop the next rendered screen, then cleared
  let _csrfToken = '';
  let _onSuccess = null;  // callback after successful auth

  // ── CSS (embedded) ───────────────────────────────────────────────

  const CSS = `
    #auth-overlay {
      position: fixed; inset: 0; z-index: 10000;
      display: flex; align-items: center; justify-content: center;
      padding: 16px;
    }
    #auth-overlay .auth-backdrop {
      position: absolute; inset: 0;
      background: rgba(0,0,0,0.6);
      backdrop-filter: blur(2px);
    }
    #auth-overlay .auth-modal {
      position: relative; z-index: 1;
      background: #fff;
      border-top: 3px solid #B8743D;
      border-radius: 6px;
      width: 100%; max-width: 420px;
      max-height: 90vh; overflow-y: auto;
      padding: 28px 24px 24px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.25);
      direction: rtl;
      font-family: 'Heebo', 'Assistant', Arial, sans-serif;
      color: #2C2C2C;
    }
    #auth-overlay .auth-logo {
      display: block; margin: 0 auto 12px; height: 48px;
    }
    #auth-overlay h2 {
      text-align: center; font-size: 1.3rem; font-weight: 700;
      margin: 0 0 4px; color: #2C2C2C;
    }
    #auth-overlay .auth-subtitle {
      text-align: center; font-size: 0.9rem; color: #777;
      margin: 0 0 20px;
    }
    #auth-overlay .auth-field {
      margin-bottom: 14px;
    }
    #auth-overlay .auth-field label {
      display: block; font-size: 0.85rem; font-weight: 600;
      margin-bottom: 4px; color: #444;
    }
    #auth-overlay .auth-field input {
      width: 100%; padding: 10px 14px;
      border: 1px solid #E2DDD6; border-radius: 4px;
      font-size: 15px; font-family: inherit;
      background: #FAFAF8; color: #2C2C2C;
      outline: none; transition: border-color 0.2s;
      box-sizing: border-box;
    }
    #auth-overlay .auth-field input:focus {
      border-color: #B8743D;
    }
    #auth-overlay .auth-field input[dir="ltr"] {
      text-align: left;
    }
    #auth-overlay .auth-error {
      color: #c0392b; background: #fdf0ef;
      border: 1px solid #f5c6cb; border-radius: 4px;
      padding: 8px 12px; font-size: 0.85rem;
      margin-bottom: 14px; display: none;
    }
    #auth-overlay .auth-success-msg {
      color: #27ae60; background: #eafaf1;
      border: 1px solid #a3d9a5; border-radius: 4px;
      padding: 8px 12px; font-size: 0.85rem;
      margin-bottom: 14px; display: none;
    }
    #auth-overlay .auth-btn {
      width: 100%; padding: 12px;
      background: #B8743D; color: #fff;
      border: none; border-radius: 4px;
      font-size: 1rem; font-weight: 700;
      font-family: inherit; cursor: pointer;
      transition: background 0.2s;
    }
    #auth-overlay .auth-btn:hover {
      background: #9A5F2E;
    }
    #auth-overlay .auth-btn:disabled {
      background: #ccc; cursor: not-allowed;
    }
    #auth-overlay .auth-links {
      text-align: center; margin-top: 16px;
      font-size: 0.85rem;
    }
    #auth-overlay .auth-links a {
      color: #B8743D; text-decoration: none;
      cursor: pointer;
    }
    #auth-overlay .auth-links a:hover {
      text-decoration: underline;
    }
    #auth-overlay .auth-privacy-note {
      text-align: center; font-size: 0.78rem;
      color: #999; margin-top: 14px;
    }
    #auth-overlay .auth-privacy-note a {
      color: #B8743D; text-decoration: none;
    }
    #auth-overlay .auth-code-input {
      text-align: center; font-size: 28px; font-weight: 700;
      letter-spacing: 8px; direction: ltr;
    }
    #auth-overlay .auth-spinner {
      display: inline-block; width: 16px; height: 16px;
      border: 2px solid #fff; border-top-color: transparent;
      border-radius: 50%; animation: auth-spin 0.6s linear infinite;
      vertical-align: middle; margin-inline-start: 8px;
    }
    .lendover-webinar-banner {
      position: sticky;
      top: 0;
      z-index: 9990;
      direction: rtl;
      font-family: 'Heebo', 'Assistant', Arial, sans-serif;
      background:
        linear-gradient(90deg, rgba(34, 220, 229, 0.18), transparent 30%),
        linear-gradient(270deg, rgba(184, 116, 61, 0.14), transparent 34%),
        #071012;
      border-bottom: 1px solid rgba(34, 220, 229, 0.28);
      box-shadow: 0 12px 30px rgba(0,0,0,0.16);
    }
    .lendover-webinar-banner__inner {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto auto auto;
      align-items: center;
      gap: 14px;
      width: min(1120px, calc(100% - 28px));
      min-height: 58px;
      margin: 0 auto;
      padding: 9px 0;
      color: #f7fbfb;
    }
    .lendover-webinar-banner__kicker {
      color: #22dce5;
      font-size: 13px;
      font-weight: 900;
      white-space: nowrap;
    }
    .lendover-webinar-banner__title {
      min-width: 0;
      color: #f7fbfb;
      font-size: 17px;
      font-weight: 900;
      line-height: 1.18;
      overflow-wrap: anywhere;
    }
    .lendover-webinar-banner__meta {
      color: rgba(247, 251, 251, 0.84);
      font-size: 14px;
      font-weight: 800;
      white-space: nowrap;
    }
    .lendover-webinar-banner__cta {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 84px;
      padding: 8px 13px;
      color: #061012;
      background: #22dce5;
      border-radius: 6px;
      text-decoration: none;
      font-size: 14px;
      font-weight: 900;
      white-space: nowrap;
    }
    .lendover-webinar-banner__cta:hover {
      background: #7cf6ff;
    }
    .lendover-webinar-banner__close {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      padding: 0;
      color: #f7fbfb;
      background: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.18);
      border-radius: 999px;
      cursor: pointer;
      font-size: 20px;
      font-weight: 700;
      line-height: 1;
    }
    .lendover-webinar-banner__close:hover,
    .lendover-webinar-banner__close:focus-visible {
      color: #061012;
      background: #7cf6ff;
      outline: none;
    }
    @keyframes auth-spin {
      to { transform: rotate(360deg); }
    }
    #auth-overlay .auth-field-row {
      display: flex; gap: 12px;
    }
    #auth-overlay .auth-field-row .auth-field {
      flex: 1;
    }
    @media (max-width: 480px) {
      #auth-overlay .auth-modal {
        padding: 20px 16px 16px;
      }
      #auth-overlay .auth-field-row {
        flex-direction: column; gap: 0;
      }
      .lendover-webinar-banner__inner {
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 6px 10px;
        width: calc(100% - 20px);
        min-height: 0;
        padding: 9px 0;
      }
      .lendover-webinar-banner__kicker,
      .lendover-webinar-banner__title,
      .lendover-webinar-banner__meta {
        grid-column: 1;
      }
      .lendover-webinar-banner__kicker {
        font-size: 12px;
      }
      .lendover-webinar-banner__title {
        font-size: 14px;
      }
      .lendover-webinar-banner__meta {
        font-size: 12px;
        white-space: normal;
      }
      .lendover-webinar-banner__cta {
        grid-column: 1 / -1;
        width: 100%;
        min-width: 0;
        padding: 8px 10px;
      }
      .lendover-webinar-banner__close {
        grid-column: 2;
        grid-row: 1 / span 2;
      }
    }
    #auth-overlay .ig-oidc-sep {
      display: flex; align-items: center; gap: 10px;
      margin: 16px 0; color: #94a3b8; font-size: 13px;
    }
    #auth-overlay .ig-oidc-sep::before,
    #auth-overlay .ig-oidc-sep::after {
      content: ''; flex: 1; height: 1px; background: #e2e8f0;
    }
    #auth-overlay .ig-oidc-wrap {
      display: flex; flex-direction: column; gap: 8px;
    }
    #auth-overlay .ig-oidc-btn {
      width: 100%; padding: 11px 14px;
      border: 1px solid #cbd5e1; border-radius: 8px;
      background: #fff; color: #0f172a;
      font-size: 15px; font-family: inherit; cursor: pointer;
    }
    #auth-overlay .ig-oidc-btn:hover {
      background: #f8fafc;
    }
    #auth-overlay .ig-notice {
      margin: 0 0 14px; padding: 10px 12px; border-radius: 8px;
      background: #eff6ff; border: 1px solid #bfdbfe;
      color: #1e3a8a; font-size: 14px; line-height: 1.5;
    }
  `;

  // ── Inject CSS ───────────────────────────────────────────────────

  function injectCSS() {
    if (document.getElementById('auth-gate-css')) return;
    const style = document.createElement('style');
    style.id = 'auth-gate-css';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function injectToolWebinarBanner() {
    const isLendover = /(^|\.)lendover\.co\.il$/i.test(window.location.hostname);
    const isToolsPage = /^\/tools\//.test(window.location.pathname);
    const webinarEndsAt = new Date('2026-07-29T13:00:00+03:00');
    const storageKey = 'lendover-isramap-webinar-banner-dismissed-20260729';
    if (!isLendover || !isToolsPage || Date.now() >= webinarEndsAt.getTime()) return;
    if (document.getElementById('lendoverWebinarBanner')) return;
    try {
      if (window.localStorage.getItem(storageKey) === '1') return;
    } catch (_) {}

    const banner = document.createElement('aside');
    banner.id = 'lendoverWebinarBanner';
    banner.className = 'lendover-webinar-banner';
    banner.setAttribute('aria-label', 'וובינר מקצועי לעורכי דין נדל"ן');
    banner.innerHTML = `
      <div class="lendover-webinar-banner__inner">
        <span class="lendover-webinar-banner__kicker">וובינר IsraMap לעורכי דין נדל"ן</span>
        <span class="lendover-webinar-banner__title">מה צריך לראות במפה לפני מו"מ, חתימה או ליווי פרויקט</span>
        <span class="lendover-webinar-banner__meta">29.7.2026 · 13:00</span>
        <a class="lendover-webinar-banner__cta" href="https://isramap.co.il/webinar-lawyers.html">להרשמה</a>
        <button class="lendover-webinar-banner__close" type="button" aria-label="סגור באנר וובינר">×</button>
      </div>`;

    banner.querySelector('.lendover-webinar-banner__close')?.addEventListener('click', () => {
      try {
        window.localStorage.setItem(storageKey, '1');
      } catch (_) {}
      banner.remove();
    });
    document.body.prepend(banner);
  }

  // ── CSRF ─────────────────────────────────────────────────────────

  async function fetchCsrfToken() {
    try {
      const resp = await fetch(AUTH_API + '/csrf-token', { credentials: 'include' });
      const data = await resp.json();
      _csrfToken = data.csrf_token || '';
    } catch (e) {
      _csrfToken = '';
    }
  }

  // ── Cookie helper ───────────────────────────────────────────────

  function setSessionCookie(token) {
    const maxAge = 30 * 24 * 3600; // 30 days
    document.cookie = 'session_token=' + encodeURIComponent(token)
      + '; domain=lendover.co.il'
      + '; path=/'
      + '; max-age=' + maxAge
      + '; secure'
      + '; samesite=lax';
  }

  // ── Auth API helper ──────────────────────────────────────────────

  async function authPost(endpoint, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (_csrfToken) headers['X-CSRF-Token'] = _csrfToken;

    const resp = await fetch(AUTH_API + endpoint, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    return { status: resp.status, data };
  }

  // ── Social login (OIDC) ──────────────────────────────────
  // Fail-closed: if this fetch fails, or the payload isn't shaped as
  // expected, we render NO buttons. The password form, which always
  // works, stays the whole login surface.

  let _oidcProviders = null;

  async function loadOidcProviders() {
    if (_oidcProviders !== null) return _oidcProviders;
    try {
      const resp = await fetch(AUTH_API + '/oidc/providers', { credentials: 'include' });
      const data = await resp.json();
      _oidcProviders = (data && Array.isArray(data.providers)) ? data.providers : [];
    } catch (e) {
      _oidcProviders = [];
    }
    return _oidcProviders;
  }

  const OIDC_LABELS = { google: 'גוגל', microsoft: 'מיקרוסופט' };

  function oidcButtonsHtml(providers) {
    if (!providers || !providers.length) return '';
    // dir="rtl" per button: an unrecognized provider slug falls back to its
    // raw (Latin) name, and a Hebrew label beside a Latin word renders
    // reversed without an explicit dir on that element.
    // escHtml() on BOTH the attribute and the label: today /oidc/providers
    // can only ever emit "google" or "microsoft", but that is a property of
    // today's server, not of this markup, and this is a login form.
    const buttons = providers.map((p) => {
      const label = OIDC_LABELS[p] || p;
      return '<button type="button" class="ig-oidc-btn" data-oidc="' + escHtml(p) + '" dir="rtl">'
           + 'המשך עם ' + escHtml(label) + '</button>';
    }).join('');
    return '<div class="ig-oidc-sep"><span>או</span></div>'
         + '<div class="ig-oidc-wrap">' + buttons + '</div>';
  }

  function wireOidcButtons(modal) {
    modal.querySelectorAll('[data-oidc]').forEach((btn) => {
      btn.addEventListener('click', () => {
        // The callback lands on auth.lendover.co.il (or the tool's own
        // /auth proxy) while the user is on www.lendover.co.il/tools/<tool>/.
        // The destination has to travel with the request: the server
        // resolves and allowlists it before using it, so it must be an
        // absolute URL, not a bare path.
        const back = encodeURIComponent(window.location.href);
        window.location.href = AUTH_API + '/oidc/' + btn.getAttribute('data-oidc')
                             + '/start?return_to=' + back;
      });
    });
  }

  // ── Screen rendering ─────────────────────────────────────────────

  function renderOverlay() {
    injectCSS();

    if (_overlay) {
      _overlay.remove();
    }

    _overlay = document.createElement('div');
    _overlay.id = 'auth-overlay';

    const backdrop = document.createElement('div');
    backdrop.className = 'auth-backdrop';
    _overlay.appendChild(backdrop);

    const modal = document.createElement('div');
    modal.className = 'auth-modal';
    _overlay.appendChild(modal);

    switch (_currentScreen) {
      case 'login':       renderLoginScreen(modal); break;
      case 'register':    renderRegisterScreen(modal); break;
      case 'verify':      renderVerifyScreen(modal); break;
      case 'forgot':      renderForgotScreen(modal); break;
      case 'reset':       renderResetScreen(modal); break;
    }

    // One-shot notice (e.g. an OIDC result message), anchored after the
    // header block (logo/title/subtitle) and before .auth-error -- every
    // screen has one -- then cleared so switching screens never repeats it.
    if (_pendingNotice) {
      const notice = document.createElement('div');
      notice.className = 'ig-notice';
      notice.textContent = _pendingNotice;
      const errEl = modal.querySelector('.auth-error');
      modal.insertBefore(notice, errEl || modal.firstChild);
      _pendingNotice = '';
    }

    document.body.appendChild(_overlay);
    document.body.style.overflow = 'hidden';

    // Focus first input
    const firstInput = modal.querySelector('input');
    if (firstInput) setTimeout(() => firstInput.focus(), 100);
  }

  function closeOverlay() {
    if (_overlay) {
      _overlay.remove();
      _overlay = null;
    }
    document.body.style.overflow = '';
  }

  function showError(modal, msg) {
    const el = modal.querySelector('.auth-error');
    if (el) { el.textContent = msg; el.style.display = 'block'; }
  }

  function hideError(modal) {
    const el = modal.querySelector('.auth-error');
    if (el) el.style.display = 'none';
  }

  function showSuccess(modal, msg) {
    const el = modal.querySelector('.auth-success-msg');
    if (el) { el.textContent = msg; el.style.display = 'block'; }
  }

  function setLoading(btn, on) {
    btn.disabled = on;
    const spinnerEl = btn.querySelector('.auth-spinner');
    if (on && !spinnerEl) {
      const sp = document.createElement('span');
      sp.className = 'auth-spinner';
      btn.appendChild(sp);
    } else if (!on && spinnerEl) {
      spinnerEl.remove();
    }
  }

  // ── Login screen ─────────────────────────────────────────────────

  function renderLoginScreen(modal) {
    modal.innerHTML = `
      <img class="auth-logo" src="https://www.lendover.co.il/logo-transparent-new.png" alt="לנדובר">
      <h2>התחברות</h2>
      <p class="auth-subtitle">התחבר כדי להשתמש בכלים</p>
      <div class="auth-error"></div>
      <form id="auth-login-form" novalidate>
        <div class="auth-field">
          <label for="auth-login-email">אימייל</label>
          <input type="email" id="auth-login-email" dir="ltr" placeholder="name@example.com" required autocomplete="email">
        </div>
        <div class="auth-field">
          <label for="auth-login-pass">סיסמה</label>
          <input type="password" id="auth-login-pass" placeholder="הסיסמה שלך" required autocomplete="current-password">
        </div>
        <button type="submit" class="auth-btn">התחבר</button>
      </form>
      <div class="ig-oidc-host"></div>
      <div class="auth-links">
        <a id="auth-goto-register">אין לך חשבון? <strong>הירשם</strong></a>
        <br>
        <a id="auth-goto-forgot" style="font-size:0.82rem">שכחתי סיסמה</a>
      </div>
      <p class="auth-privacy-note">
        בהרשמה אתה מאשר את <a href="https://www.lendover.co.il/terms.html" target="_blank">תנאי השימוש</a> ואת <a href="https://www.lendover.co.il/privacy.html" target="_blank">מדיניות הפרטיות</a> של לנדובר ב.ר 2026 בע"מ
      </p>
    `;

    loadOidcProviders().then((providers) => {
      const host = modal.querySelector('.ig-oidc-host');
      if (!host) return;
      host.innerHTML = oidcButtonsHtml(providers);
      wireOidcButtons(modal);
    });

    modal.querySelector('#auth-goto-register').addEventListener('click', () => {
      _currentScreen = 'register';
      renderOverlay();
    });

    modal.querySelector('#auth-goto-forgot').addEventListener('click', () => {
      _currentScreen = 'forgot';
      renderOverlay();
    });

    modal.querySelector('#auth-login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = modal.querySelector('.auth-btn');
      const email = modal.querySelector('#auth-login-email').value.trim();
      const password = modal.querySelector('#auth-login-pass').value;

      if (!email || !password) {
        showError(modal, 'נא למלא אימייל וסיסמה');
        return;
      }

      hideError(modal);
      setLoading(btn, true);

      try {
        const { status, data } = await authPost('/login', { email, password });

        if (data.needs_verification) {
          _pendingUserId = data.user_id;
          _pendingEmail = data.email;
          _pendingPurpose = 'verify';
          _currentScreen = 'verify';
          renderOverlay();
          return;
        }

        if (!data.success) {
          showError(modal, data.error || 'שגיאה בהתחברות');
          return;
        }

        // Set session cookie from JS (cross-origin Set-Cookie is blocked by browsers)
        if (data.token) setSessionCookie(data.token);

        // Success
        closeOverlay();
        if (_onSuccess) _onSuccess();

      } catch (err) {
        showError(modal, 'שגיאת רשת, בדוק את החיבור');
      } finally {
        setLoading(btn, false);
      }
    });
  }

  // ── Register screen ──────────────────────────────────────────────

  function renderRegisterScreen(modal) {
    modal.innerHTML = `
      <img class="auth-logo" src="https://www.lendover.co.il/logo-transparent-new.png" alt="לנדובר">
      <h2>הרשמה</h2>
      <p class="auth-subtitle">צור חשבון כדי להשתמש בכלים בחינם</p>
      <div class="auth-error"></div>
      <form id="auth-register-form" novalidate>
        <div class="auth-field">
          <label for="auth-reg-name">שם מלא *</label>
          <input type="text" id="auth-reg-name" placeholder="שם מלא" required autocomplete="name">
        </div>
        <div class="auth-field">
          <label for="auth-reg-email">אימייל *</label>
          <input type="email" id="auth-reg-email" dir="ltr" placeholder="name@example.com" required autocomplete="email">
        </div>
        <div class="auth-field-row">
          <div class="auth-field">
            <label for="auth-reg-phone">טלפון *</label>
            <input type="tel" id="auth-reg-phone" dir="ltr" placeholder="0501234567" required autocomplete="tel">
          </div>
          <div class="auth-field">
            <label for="auth-reg-company">חברה / ארגון</label>
            <input type="text" id="auth-reg-company" placeholder="לא חובה" autocomplete="organization">
          </div>
        </div>
        <div class="auth-field">
          <label for="auth-reg-pass">סיסמה *</label>
          <input type="password" id="auth-reg-pass" placeholder="לפחות 6 תווים" required autocomplete="new-password">
        </div>
        <div class="auth-field">
          <label for="auth-reg-pass2">אימות סיסמה *</label>
          <input type="password" id="auth-reg-pass2" placeholder="הקלד שוב את הסיסמה" required autocomplete="new-password">
        </div>
        <button type="submit" class="auth-btn">הירשם</button>
      </form>
      <div class="ig-oidc-host"></div>
      <div class="auth-links">
        <a id="auth-goto-login">יש לך חשבון? <strong>התחבר</strong></a>
      </div>
      <p class="auth-privacy-note">
        בהרשמה אתה מאשר את <a href="https://www.lendover.co.il/terms.html" target="_blank">תנאי השימוש</a> ואת <a href="https://www.lendover.co.il/privacy.html" target="_blank">מדיניות הפרטיות</a> של לנדובר ב.ר 2026 בע"מ
      </p>
    `;

    loadOidcProviders().then((providers) => {
      const host = modal.querySelector('.ig-oidc-host');
      if (!host) return;
      host.innerHTML = oidcButtonsHtml(providers);
      wireOidcButtons(modal);
    });

    modal.querySelector('#auth-goto-login').addEventListener('click', () => {
      _currentScreen = 'login';
      renderOverlay();
    });

    modal.querySelector('#auth-register-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = modal.querySelector('.auth-btn');
      const name = modal.querySelector('#auth-reg-name').value.trim();
      const email = modal.querySelector('#auth-reg-email').value.trim();
      const phone = modal.querySelector('#auth-reg-phone').value.trim().replace(/-/g, '').replace(/ /g, '');
      const company = modal.querySelector('#auth-reg-company').value.trim();
      const password = modal.querySelector('#auth-reg-pass').value;
      const password2 = modal.querySelector('#auth-reg-pass2').value;

      // Client-side validation
      if (!name || name.length < 2) {
        showError(modal, 'נא להזין שם מלא (2 תווים לפחות)');
        return;
      }
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        showError(modal, 'כתובת אימייל לא תקינה');
        return;
      }
      if (!phone || !/^0[0-9]{8,9}$/.test(phone)) {
        showError(modal, 'מספר טלפון לא תקין (למשל 0501234567)');
        return;
      }
      if (password.length < 6) {
        showError(modal, 'הסיסמה חייבת להכיל לפחות 6 תווים');
        return;
      }
      if (password !== password2) {
        showError(modal, 'הסיסמאות אינן תואמות');
        return;
      }

      hideError(modal);
      setLoading(btn, true);

      try {
        const { status, data } = await authPost('/register', {
          name, email, phone, company, password,
        });

        if (!data.success) {
          showError(modal, data.error || 'שגיאה בהרשמה');
          return;
        }

        // Move to verification screen
        _pendingUserId = data.user_id;
        _pendingEmail = data.email;
        _pendingPurpose = 'verify';
        _currentScreen = 'verify';
        renderOverlay();

      } catch (err) {
        showError(modal, 'שגיאת רשת, בדוק את החיבור');
      } finally {
        setLoading(btn, false);
      }
    });
  }

  // ── Verify code screen ───────────────────────────────────────────

  function renderVerifyScreen(modal) {
    // 'oidc_link' is a different flow from an ordinary registration/login
    // verify: the code confirms a pending Google/Microsoft link rather than
    // a freshly-registered email, there is no known _pendingEmail to show,
    // and /resend-code is not purpose-aware -- it would mail a code that can
    // never satisfy /oidc/verify-link. So this state gets its own subtitle,
    // and instead of the resend control it gets a real way back to the
    // provider buttons, which live on the login screen. Telling the user to
    // "close the window" was the previous copy; there is no close control on
    // this overlay, so that instruction described an action the UI does not
    // offer and left the screen with no exit at all.
    const isOidcLink = _pendingPurpose === 'oidc_link';
    const subtitle = isOidcLink
      ? 'הזן את הקוד שנשלח לכתובת המייל שלך כדי להשלים את החיבור'
      : `שלחנו קוד בן 6 ספרות ל-<strong dir="ltr">${escHtml(_pendingEmail || '')}</strong>`;
    const linksHtml = isOidcLink
      ? 'לא קיבלת קוד? <a id="auth-oidc-back-to-login">חזרה להתחברות</a> והתחבר שוב עם הספק'
      : '<a id="auth-resend-code">לא קיבלת? שלח שוב</a>';

    modal.innerHTML = `
      <img class="auth-logo" src="https://www.lendover.co.il/logo-transparent-new.png" alt="לנדובר">
      <h2>אימות אימייל</h2>
      <p class="auth-subtitle">${subtitle}</p>
      <div class="auth-error"></div>
      <div class="auth-success-msg"></div>
      <form id="auth-verify-form" novalidate>
        <div class="auth-field">
          <label for="auth-verify-code">קוד אימות</label>
          <input type="text" id="auth-verify-code" class="auth-code-input"
                 dir="ltr" maxlength="6" pattern="[0-9]{6}"
                 inputmode="numeric" autocomplete="one-time-code"
                 placeholder="000000" required>
        </div>
        <button type="submit" class="auth-btn">אמת</button>
      </form>
      <div class="auth-links">
        ${linksHtml}
      </div>
    `;

    if (isOidcLink) {
      // A genuine exit. Clearing the oidc_link state first means the login
      // screen renders its normal self (provider buttons included) rather
      // than bouncing straight back into a half-finished link.
      modal.querySelector('#auth-oidc-back-to-login').addEventListener('click', () => {
        _pendingPurpose = null;
        _pendingProvider = null;
        _pendingLinkToken = null;
        _currentScreen = 'login';
        renderOverlay();
      });
    } else {
      modal.querySelector('#auth-resend-code').addEventListener('click', async () => {
        hideError(modal);
        try {
          const { data } = await authPost('/resend-code', { user_id: _pendingUserId });
          if (data.success) {
            showSuccess(modal, 'קוד חדש נשלח למייל');
          } else {
            showError(modal, data.error || 'שליחת הקוד נכשלה');
          }
        } catch (err) {
          showError(modal, 'שגיאת רשת');
        }
      });
    }

    modal.querySelector('#auth-verify-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = modal.querySelector('.auth-btn');
      const code = modal.querySelector('#auth-verify-code').value.trim();

      if (!code || code.length !== 6) {
        showError(modal, 'נא להזין קוד בן 6 ספרות');
        return;
      }

      hideError(modal);
      setLoading(btn, true);

      try {
        if (isOidcLink) {
          const { data } = await authPost('/oidc/verify-link', {
            user_id: _pendingUserId,
            provider: _pendingProvider,
            // Binds this code to one pending identity. Two pending links for
            // the same user+provider can coexist by design (that's what
            // stops an account takeover) -- the token is what says which one
            // this code authorizes. Omitting it isn't a missing field, it's
            // a hole in that defense.
            link_token: _pendingLinkToken,
            code,
          });
          if (!data || !data.success) {
            showError(modal, (data && data.error) || 'הקוד שגוי או שפג תוקפו');
            return;
          }
          if (data.token) setSessionCookie(data.token);
          // The link token is single-use and this identity is now resolved;
          // leaving either in module state past this point serves no purpose
          // in a file whose whole job is auth.
          _pendingProvider = null;
          _pendingLinkToken = null;
          _pendingPurpose = null;
          closeOverlay();
          if (_onSuccess) _onSuccess();
          return;
        }

        const { data } = await authPost('/verify', {
          user_id: _pendingUserId,
          code,
        });

        if (!data.success) {
          showError(modal, data.error || 'קוד שגוי');
          return;
        }

        // Set session cookie from JS
        if (data.token) setSessionCookie(data.token);

        // Success
        closeOverlay();
        if (_onSuccess) _onSuccess();

      } catch (err) {
        showError(modal, 'שגיאת רשת');
      } finally {
        setLoading(btn, false);
      }
    });
  }

  // ── Forgot password screen ───────────────────────────────────────

  function renderForgotScreen(modal) {
    modal.innerHTML = `
      <img class="auth-logo" src="https://www.lendover.co.il/logo-transparent-new.png" alt="לנדובר">
      <h2>שכחתי סיסמה</h2>
      <p class="auth-subtitle">הזן את כתובת המייל שלך ונשלח קוד איפוס</p>
      <div class="auth-error"></div>
      <form id="auth-forgot-form" novalidate>
        <div class="auth-field">
          <label for="auth-forgot-email">אימייל</label>
          <input type="email" id="auth-forgot-email" dir="ltr" placeholder="name@example.com" required autocomplete="email">
        </div>
        <button type="submit" class="auth-btn">שלח קוד איפוס</button>
      </form>
      <div class="auth-links">
        <a id="auth-goto-login-2">חזרה להתחברות</a>
      </div>
    `;

    modal.querySelector('#auth-goto-login-2').addEventListener('click', () => {
      _currentScreen = 'login';
      renderOverlay();
    });

    modal.querySelector('#auth-forgot-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = modal.querySelector('.auth-btn');
      const email = modal.querySelector('#auth-forgot-email').value.trim();

      if (!email) {
        showError(modal, 'נא להזין כתובת אימייל');
        return;
      }

      hideError(modal);
      setLoading(btn, true);

      try {
        const { data } = await authPost('/forgot-password', { email });

        if (data.user_id) {
          _pendingUserId = data.user_id;
          _pendingEmail = email;
          _pendingPurpose = 'reset';
          _currentScreen = 'reset';
          renderOverlay();
        } else {
          // Still show success (prevent email enumeration)
          showSuccess(modal, data.message || 'אם המייל רשום, נשלח קוד איפוס');
        }

      } catch (err) {
        showError(modal, 'שגיאת רשת');
      } finally {
        setLoading(btn, false);
      }
    });
  }

  // ── Reset password screen ────────────────────────────────────────

  function renderResetScreen(modal) {
    modal.innerHTML = `
      <img class="auth-logo" src="https://www.lendover.co.il/logo-transparent-new.png" alt="לנדובר">
      <h2>איפוס סיסמה</h2>
      <p class="auth-subtitle">הזן את הקוד שנשלח ל-<strong dir="ltr">${escHtml(_pendingEmail || '')}</strong></p>
      <div class="auth-error"></div>
      <form id="auth-reset-form" novalidate>
        <div class="auth-field">
          <label for="auth-reset-code">קוד איפוס</label>
          <input type="text" id="auth-reset-code" class="auth-code-input"
                 dir="ltr" maxlength="6" pattern="[0-9]{6}"
                 inputmode="numeric" autocomplete="one-time-code"
                 placeholder="000000" required>
        </div>
        <div class="auth-field">
          <label for="auth-reset-pass">סיסמה חדשה</label>
          <input type="password" id="auth-reset-pass" placeholder="לפחות 6 תווים" required autocomplete="new-password">
        </div>
        <div class="auth-field">
          <label for="auth-reset-pass2">אימות סיסמה</label>
          <input type="password" id="auth-reset-pass2" placeholder="הקלד שוב" required autocomplete="new-password">
        </div>
        <button type="submit" class="auth-btn">עדכן סיסמה</button>
      </form>
      <div class="auth-links">
        <a id="auth-goto-login-3">חזרה להתחברות</a>
      </div>
    `;

    modal.querySelector('#auth-goto-login-3').addEventListener('click', () => {
      _currentScreen = 'login';
      renderOverlay();
    });

    modal.querySelector('#auth-reset-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = modal.querySelector('.auth-btn');
      const code = modal.querySelector('#auth-reset-code').value.trim();
      const newPassword = modal.querySelector('#auth-reset-pass').value;
      const newPassword2 = modal.querySelector('#auth-reset-pass2').value;

      if (!code || code.length !== 6) {
        showError(modal, 'נא להזין קוד בן 6 ספרות');
        return;
      }
      if (newPassword.length < 6) {
        showError(modal, 'הסיסמה חייבת להכיל לפחות 6 תווים');
        return;
      }
      if (newPassword !== newPassword2) {
        showError(modal, 'הסיסמאות אינן תואמות');
        return;
      }

      hideError(modal);
      setLoading(btn, true);

      try {
        const { data } = await authPost('/reset-password', {
          user_id: _pendingUserId,
          code,
          new_password: newPassword,
        });

        if (!data.success) {
          showError(modal, data.error || 'שגיאה באיפוס הסיסמה');
          return;
        }

        // Show success and go to login
        _currentScreen = 'login';
        renderOverlay();
        const loginModal = _overlay.querySelector('.auth-modal');
        const successEl = document.createElement('div');
        successEl.className = 'auth-success-msg';
        successEl.style.display = 'block';
        successEl.textContent = 'הסיסמה עודכנה בהצלחה. ניתן להתחבר.';
        loginModal.insertBefore(successEl, loginModal.querySelector('form'));

      } catch (err) {
        showError(modal, 'שגיאת רשת');
      } finally {
        setLoading(btn, false);
      }
    });
  }

  // ── OIDC result handling ──────────────────────────────
  // The callback (auth.lendover.co.il/oidc/<provider>/callback, or the
  // tool's own /auth proxy) redirects back here with ?authresult=<code>
  // and, for the code-verification path, also ?uid=&p=&t=.

  const OIDC_RESULT_HE = {
    cancelled:           '',
    ok:                  '',
    bad_state:           'תוקף הבקשה פג. נסה להתחבר שוב.',
    failed:              'ההתחברות דרך הספק נכשלה. נסה שוב או התחבר עם מייל וסיסמה.',
    provider_error:      'ההתחברות דרך הספק אינה זמינה כרגע. נסה שוב או התחבר עם מייל וסיסמה.',
    blocked:             'החשבון חסום. צור קשר עם התמיכה.',
    // Shown to someone who has just come back from the provider, so it must
    // not advise trying that same provider again -- the account simply has
    // no email address to link.
    no_email:            'לא קיבלנו כתובת מייל מהחשבון הזה. הירשם עם מייל וסיסמה, או נסה חשבון אחר.',
    verify_email:        'שלחנו קוד לכתובת המייל שלך. הזן אותו כדי להשלים את החיבור.',
    // Rate-limited, not the same as a blocked account -- the wording must
    // not imply the account itself is locked.
    too_many_attempts:   'יותר מדי ניסיונות. נסה שוב בעוד כמה דקות.',
  };

  /**
   * Pure parse of the OIDC callback's query string -- no window/document
   * access, so it can be called directly with any string for testing.
   * @param {string} search - e.g. window.location.search
   * @returns {null|{code:string, uid:?number, provider:?string, token:?string, notice:string}}
   */
  function parseOidcResultParams(search) {
    const m = /[?&]authresult=([a-z_]+)/.exec(search);
    if (!m) return null;
    const code = m[1];
    const uidM = /[?&]uid=(\d+)/.exec(search);
    const provM = /[?&]p=(google|microsoft)/.exec(search);
    const tokM = /[?&]t=([A-Za-z0-9_-]+)/.exec(search);
    // hasOwnProperty, not `OIDC_RESULT_HE[code] || ''`: the capture group is
    // [a-z_]+, and `constructor` is the one Object.prototype key that is all
    // lowercase, so a plain lookup returns a *function* and renders
    // "function Object() { [native code] }" into the banner.
    const notice = Object.prototype.hasOwnProperty.call(OIDC_RESULT_HE, code)
      ? OIDC_RESULT_HE[code] : '';
    return {
      code,
      uid: uidM ? parseInt(uidM[1], 10) : null,
      provider: provM ? provM[1] : null,
      token: tokM ? tokM[1] : null,
      notice,
    };
  }

  /**
   * Read the outcome the OIDC callback left in the URL, then strip it so a
   * reload never replays it. Called once at load, after state is declared.
   */
  function consumeAuthResult() {
    const parsed = parseOidcResultParams(window.location.search);
    if (!parsed) return;

    const url = new URL(window.location.href);
    ['authresult', 'uid', 'p', 't'].forEach((k) => url.searchParams.delete(k));
    window.history.replaceState({}, '', url.toString());

    if (parsed.code === 'verify_email' && parsed.uid && parsed.provider && parsed.token) {
      _pendingUserId = parsed.uid;
      _pendingProvider = parsed.provider;
      _pendingLinkToken = parsed.token;
      _pendingPurpose = 'oidc_link';
      _pendingNotice = parsed.notice;
      _currentScreen = 'verify';
      renderOverlay();
    } else if (parsed.notice) {
      // Arming _pendingNotice is not enough on these pages. Nothing renders
      // it until something else calls renderOverlay(), and the tool pages
      // only open the modal from handleAuth401() -- i.e. after some LATER
      // action 401s. Left alone, every OIDC failure is silent: the user
      // returns from the provider to an unchanged page, and the message
      // finally surfaces bolted onto an unrelated click minutes later.
      // showAuthModal() sets _currentScreen and does not touch
      // _pendingNotice, so the banner renders on the login screen.
      _pendingNotice = parsed.notice;
      if (typeof window.showAuthModal === 'function') window.showAuthModal();
    }
  }

  // ── Utilities ────────────────────────────────────────────────────

  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Public API ───────────────────────────────────────────────────

  /**
   * Show the auth modal. Call this when a fetch returns 401.
   * @param {Function} [onSuccess] - Called after successful login/register
   */
  window.showAuthModal = function (onSuccess) {
    _onSuccess = onSuccess || null;
    _currentScreen = 'login';
    fetchCsrfToken().then(() => renderOverlay());
  };

  /**
   * Handle a 401 response from a tool API.
   * Returns a promise that resolves when the user authenticates.
   * Usage: if (resp.status === 401) await handleAuth401();
   */
  window.handleAuth401 = function () {
    return new Promise((resolve) => {
      window.showAuthModal(() => resolve());
    });
  };

  // Show the IsraMap webinar banner on Lendover tool pages while the campaign is active.
  injectCSS();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectToolWebinarBanner, { once: true });
  } else {
    injectToolWebinarBanner();
  }

  // Fetch CSRF token on load (non-blocking)
  fetchCsrfToken();

  // Handle a return from an OIDC provider, if the URL carries one.
  // MUST be readyState-guarded: this can render the overlay, renderOverlay()
  // does document.body.appendChild(), and groundwater/index.html loads this
  // script from <head>, where document.body is still null.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', consumeAuthResult, { once: true });
  } else {
    consumeAuthResult();
  }

})();
