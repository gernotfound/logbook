// Never send OAuth state, client health data or sensitive URL information.
(() => {
  const allowedPaths = new Set(['/', '/index.html', '/about']);
  const current = window.location;
  if (current.protocol !== 'https:' || current.hostname !== 'thelogbook.me'
    || !allowedPaths.has(current.pathname) || current.search || current.hash) return;

  try {
    if (document.referrer) {
      const previous = new URL(document.referrer);
      if (previous.search || previous.hash
        || (previous.origin === current.origin && !allowedPaths.has(previous.pathname))
        || (previous.origin !== current.origin && previous.pathname !== '/')) return;
    }
  } catch {
    return;
  }

  if (window.navigator?.doNotTrack === '1'
    || window.navigator?.globalPrivacyControl === true) return;

  const beacon = document.createElement('script');
  beacon.type = 'module';
  beacon.src = 'https://static.cloudflareinsights.com/beacon.min.js';
  beacon.referrerPolicy = 'no-referrer';
  beacon.setAttribute('data-cf-beacon', JSON.stringify({
    token: 'c375a573603f448f87a2d1b14cfc540e',
    spa: false,
  }));
  document.head.appendChild(beacon);
})();
