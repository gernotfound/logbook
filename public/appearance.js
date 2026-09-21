(function () {
  // Runs before the first paint so the loader and React use the same theme.
  var preference = 'system';

  try {
    var saved = localStorage.getItem('logbook:appearance:v1');
    if (saved === 'light' || saved === 'dark') preference = saved;
  } catch {
    // Restricted storage keeps the current session on the system preference.
  }

  var prefersDark = typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: dark)').matches;
  var resolvedTheme = preference === 'system'
    ? (prefersDark ? 'dark' : 'light')
    : preference;

  document.documentElement.dataset.theme = resolvedTheme;
  document.documentElement.dataset.themePreference = preference;
  document.documentElement.style.colorScheme = resolvedTheme;

  var themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) {
    themeColor.setAttribute('content', resolvedTheme === 'dark' ? '#000000' : '#f3f4f6');
  }
}());
