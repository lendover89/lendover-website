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
    const toolMatch = path.match(/\/tools\/(tabutab|tabucaunt|buildcalc)\//);
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
  let _pendingPurpose = null;  // 'verify' or 'reset'
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
      <div class="auth-links">
        <a id="auth-goto-register">אין לך חשבון? <strong>הירשם</strong></a>
        <br>
        <a id="auth-goto-forgot" style="font-size:0.82rem">שכחתי סיסמה</a>
      </div>
      <p class="auth-privacy-note">
        הפרטים נשמרים בצורה מאובטחת בהתאם ל<a href="https://www.lendover.co.il/privacy.html" target="_blank">מדיניות הפרטיות</a>
      </p>
    `;

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

        // Success
        closeOverlay();
        if (_onSuccess) _onSuccess();

      } catch (err) {
        showError(modal, 'שגיאת רשת — בדוק את החיבור');
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
      <div class="auth-links">
        <a id="auth-goto-login">יש לך חשבון? <strong>התחבר</strong></a>
      </div>
      <p class="auth-privacy-note">
        הפרטים נשמרים בצורה מאובטחת בהתאם ל<a href="https://www.lendover.co.il/privacy.html" target="_blank">מדיניות הפרטיות</a>
      </p>
    `;

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
        showError(modal, 'שגיאת רשת — בדוק את החיבור');
      } finally {
        setLoading(btn, false);
      }
    });
  }

  // ── Verify code screen ───────────────────────────────────────────

  function renderVerifyScreen(modal) {
    modal.innerHTML = `
      <img class="auth-logo" src="https://www.lendover.co.il/logo-transparent-new.png" alt="לנדובר">
      <h2>אימות אימייל</h2>
      <p class="auth-subtitle">שלחנו קוד בן 6 ספרות ל-<strong dir="ltr">${escHtml(_pendingEmail || '')}</strong></p>
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
        <a id="auth-resend-code">לא קיבלת? שלח שוב</a>
      </div>
    `;

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
        const { data } = await authPost('/verify', {
          user_id: _pendingUserId,
          code,
        });

        if (!data.success) {
          showError(modal, data.error || 'קוד שגוי');
          return;
        }

        // Success — cookie set by server
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

  // Fetch CSRF token on load (non-blocking)
  fetchCsrfToken();

})();
