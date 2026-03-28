(function () {
  'use strict';

  var TRACK_URL = 'https://auth.lendover.co.il/track';

  // Generate or retrieve persistent visitor ID
  var vid;
  try {
    vid = localStorage.getItem('_lv_vid');
    if (!vid) {
      vid = Date.now().toString(36) + Math.random().toString(36).slice(2);
      localStorage.setItem('_lv_vid', vid);
    }
  } catch (e) {
    // localStorage unavailable (e.g. private browsing with strict settings)
    vid = Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  var payload = JSON.stringify({
    url: location.href,
    path: location.pathname,
    referrer: document.referrer || null,
    visitor_id: vid,
    source: (window._lvSource || 'site')
  });

  // Use fetch with keepalive so the request survives page navigation
  if (typeof fetch === 'function') {
    var opts = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      credentials: 'include',
      keepalive: true
    };
    // AbortSignal.timeout supported in modern browsers
    try {
      if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
        opts.signal = AbortSignal.timeout(2000);
      }
    } catch (e) {}
    fetch(TRACK_URL, opts).catch(function () {});
  } else if (navigator.sendBeacon) {
    // Fallback for older browsers
    var blob = new Blob([payload], { type: 'application/json' });
    navigator.sendBeacon(TRACK_URL, blob);
  }
})();
