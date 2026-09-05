/**
 * §6 Theme Mode — no full-page flash.
 *
 * This string is injected as a *blocking* inline <script> in the root layout so
 * `data-theme` is on <html> before the first paint. It must stay dependency-free
 * and synchronous. The `.theme-transition` class (aurora.css) is added only
 * afterwards, by ThemeProvider, so the very first paint is not animated.
 */
/**
 * v2 resets the legacy dark-locked preference once. New choices continue to
 * persist normally, while existing browsers enter the Soft Lavender theme on
 * their first load after the redesign.
 */
export const THEME_STORAGE_KEY = 'ai-coach:theme:v2';

export const themeNoFlashScript = `
(function(){
  try {
    var el = document.documentElement;
    var stored = localStorage.getItem('${THEME_STORAGE_KEY}');
    var mode = stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'light';
    var resolved = mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : mode === 'dark' ? 'dark' : 'light';
    el.setAttribute('data-theme', resolved);
    el.style.colorScheme = resolved;
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();
`;
