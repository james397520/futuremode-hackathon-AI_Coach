/**
 * §6 Theme Mode — no full-page flash.
 *
 * This string is injected as a *blocking* inline <script> in the root layout so
 * `data-theme` is on <html> before the first paint. It must stay dependency-free
 * and synchronous. The `.theme-transition` class (aurora.css) is added only
 * afterwards, by ThemeProvider, so the very first paint is not animated.
 */
export const THEME_STORAGE_KEY = 'ai-coach:theme';

export const themeNoFlashScript = `
(function(){
  try {
    var k = '${THEME_STORAGE_KEY}';
    var stored = null;
    try { stored = window.localStorage.getItem(k); } catch (e) {}
    var mode = (stored === 'light' || stored === 'dark' || stored === 'system') ? stored : 'system';
    var resolved = mode;
    if (mode === 'system') {
      resolved = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
    }
    var el = document.documentElement;
    el.setAttribute('data-theme', resolved);
    el.style.colorScheme = resolved;
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();
`;
