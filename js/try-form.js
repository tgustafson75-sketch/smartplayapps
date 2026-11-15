// The shared try-code request form (smartplayapps.com /try and /smartmotion). One script, one endpoint:
// POST /api/try/request. Any <form data-try-form> works; data-app presets the app and hides the picker.
(function () {
  var OPEN = {
    smartmotion: { label: 'Open SmartMotion', url: 'https://smartmotionai.vercel.app/analyze?code=' },
    bay: { label: 'Open SmartBay', url: 'https://smartbayai.com/bay?code=' },
  };
  document.querySelectorAll('form[data-try-form]').forEach(function (f) {
    var msg = f.querySelector('.msg');
    var box = document.getElementById(f.getAttribute('data-result'));
    var q = new URLSearchParams(location.search);
    var preset = f.getAttribute('data-app') || q.get('app');
    if (preset && OPEN[preset]) {
      var r = f.querySelector('input[name="app"][value="' + preset + '"]');
      if (r) r.checked = true;
    }
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var d = Object.fromEntries(new FormData(f).entries());
      if (f.getAttribute('data-app')) d.app = f.getAttribute('data-app');
      d.source = q.get('from') || location.pathname;
      if (!d.app) { msg.textContent = 'Pick SmartMotion or SmartBay.'; return; }
      if (!d.name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email || '')) { msg.textContent = 'Please add your name and a valid email.'; return; }
      if (!d.use_case) { msg.textContent = 'Tell us how you will use it.'; return; }
      var btn = f.querySelector('button[type="submit"]');
      btn.disabled = true;
      msg.textContent = 'Getting your code...';
      fetch('/api/try/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (x) {
          btn.disabled = false;
          if (!x.ok || !x.j.code) { msg.textContent = x.j.message || 'That did not send. Please try again.'; return; }
          msg.textContent = '';
          var o = OPEN[x.j.app];
          var until = new Date(x.j.expires_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
          box.hidden = false;
          box.querySelector('.code').textContent = x.j.code;
          box.querySelector('.until').textContent = until;
          var a = box.querySelector('.open');
          a.textContent = o.label + ' →';
          a.href = o.url + encodeURIComponent(x.j.code);
          f.hidden = true;
          box.scrollIntoView({ behavior: 'smooth', block: 'center' });
        })
        .catch(function () { btn.disabled = false; msg.textContent = 'That did not send. Please try again in a minute.'; });
    });
  });
  // About videos: muted autoplay only while on screen (saves data), a button for sound.
  document.querySelectorAll('.vid').forEach(function (w) {
    var v = w.querySelector('video'), b = w.querySelector('.sound');
    if (b) b.addEventListener('click', function () {
      v.muted = !v.muted;
      if (!v.muted) { v.currentTime = 0; v.play(); }
      b.textContent = v.muted ? 'Sound on' : 'Sound off';
    });
    if (!('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (e.isIntersecting) { var p = v.play(); if (p && p.catch) p.catch(function () {}); } else v.pause();
      });
    }, { threshold: 0.4 }).observe(v);
  });
})();
