/**
 * Printing uses the light theme (white paper, dark ink) whatever theme is on screen, then restores it.
 * Covers the "Export PDF" button and the browser's own Print command.
 */
export function installPrintTheme() {
  let previous: string | null = null;
  window.addEventListener('beforeprint', () => {
    previous = document.documentElement.getAttribute('data-theme');
    document.documentElement.setAttribute('data-theme', 'light');
  });
  window.addEventListener('afterprint', () => {
    if (previous === null) document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', previous);
  });
}
