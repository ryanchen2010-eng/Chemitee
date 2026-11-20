const storageKey = 'molecule-playground.appearance.v1';

export function mountThemeToggle(button: HTMLButtonElement) {
  const root = document.documentElement;
  let dark = root.dataset.theme === 'dark';
  const update = () => {
    root.dataset.theme = dark ? 'dark' : 'light';
    button.setAttribute('aria-pressed', String(dark));
  };
  button.setAttribute('aria-label', 'Dark mode');
  button.title = 'Dark mode';
  button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 15.3A8.8 8.8 0 0 1 8.7 3.5 8.8 8.8 0 1 0 20.5 15.3Z"/></svg>';
  button.addEventListener('click', () => {
    dark = !dark;
    update();
    try { localStorage.setItem(storageKey, dark ? 'dark' : 'light'); } catch { /* The current page can still change themes. */ }
  });
  update();
}
