// SmartPlay Self-Heal Standard v1, browser half. Loaded with `defer` on every page.
// 1. Error reporting: uncaught errors and rejections go to /api/report, which tags the deployed build.
// 2. Report a problem: any [data-report-problem] link sends the page path and build. Anonymous.
// 3. Startup health check: after load, once per browser session, GET /api/health; report a failure.
// Never blocks render, never throws, adds no UI beyond the footer link's own text.
(function () {
  var MAX_AUTO = 5; // a throwing loop must not send hundreds of reports from one page view
  var sent = 0;

  function post(kind, message) {
    try {
      return fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: kind, message: String(message || '').slice(0, 500), path: location.pathname }),
        keepalive: true,
      }).then(function (r) { return r.ok; }, function () { return false; });
    } catch (e) {
      return Promise.resolve(false);
    }
  }

  function auto(kind, message) {
    if (sent >= MAX_AUTO) return;
    sent += 1;
    post(kind, message);
  }

  window.addEventListener('error', function (e) {
    // "Script error." is a cross-origin script the browser will not describe (extensions, embeds).
    if (!e || !e.message || e.message === 'Script error.') return;
    var src = e.filename ? ' @ ' + e.filename.replace(location.origin, '') + ':' + (e.lineno || 0) : '';
    auto('client_error', e.message + src);
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason;
    auto('unhandled_rejection', (r && r.message) || String(r));
  });

  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest && e.target.closest('[data-report-problem]');
    if (!a) return;
    e.preventDefault();
    if (a.getAttribute('aria-disabled') === 'true') return;
    a.setAttribute('aria-disabled', 'true');
    post('user_report', 'Report a problem').then(function (ok) {
      a.textContent = ok ? 'Sent. Thank you.' : 'Not sent. Email tim@smartplayapps.com';
    });
  });

  function healthCheck() {
    // Once per session: missing config stays missing until a deploy, so every page view re-reporting
    // it would only spend Sentry quota.
    try {
      if (sessionStorage.getItem('sp_health')) return;
      sessionStorage.setItem('sp_health', '1');
    } catch (e) { /* storage blocked: check anyway */ }
    fetch('/api/health', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : { ok: false, problems: ['health returned ' + r.status] }; })
      .then(function (h) { if (!h.ok) post('health', (h.problems || []).join('; ')); },
        function () { post('health', 'health check unreachable'); });
  }
  if (document.readyState === 'complete') healthCheck();
  else window.addEventListener('load', healthCheck);
})();
