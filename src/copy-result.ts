/** Copies only on explicit user action; never sends data to a server. */
export function mountCopyResult(host: HTMLElement, label: string, value: () => string | null): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  const status = document.createElement('span');
  status.setAttribute('role', 'status');
  button.addEventListener('click', async () => {
    const content = value();
    if (!content) { status.textContent = 'Nothing to copy yet.'; return; }
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(content);
      status.textContent = 'Copied.';
    } catch { status.textContent = 'Unable to copy. Select the text and copy it manually.'; }
  });
  host.append(button, status);
  return button;
}
