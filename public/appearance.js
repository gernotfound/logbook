(function () {
  // This parser-blocking, same-origin script runs before the first page content.
  var preference = 'system';
  try {
    var saved = localStorage.getItem('logbook:appearance:v1');
    if (saved === 'light' || saved === 'dark') preference = saved;
  } catch { /* The current session can still follow the system theme. */ }
  var dark = preference === 'dark' || (preference === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  var theme = dark ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.themePreference = preference;
  document.documentElement.style.colorScheme = theme;
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#000000' : '#f3f4f6');
}());
