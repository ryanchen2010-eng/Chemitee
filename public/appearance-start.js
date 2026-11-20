// Restore the local display preference before the page draws its background.
try {
  if (localStorage.getItem('molecule-playground.appearance.v1') === 'dark') {
    document.documentElement.dataset.theme = 'dark';
  }
} catch {
  // Leave the initial light appearance when storage is unavailable.
}
