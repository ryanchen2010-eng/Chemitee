/** Only the opt-in hosted build uses this boundary. The SQLite draft is untouched. */
export function bindHostedBuilder(workspace: HTMLElement) {
  let reloading = false;
  let revision = 0;
  const notice = document.createElement('p');
  notice.setAttribute('role', 'status');
  notice.hidden = true;
  workspace.before(notice);

  async function readContext(): Promise<string | null> {
    const response = await fetch('/api/account/session', { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) throw new Error('Workspace session unavailable');
    const status = await response.json();
    if (status.workspace !== 'hosted') throw new Error('Workspace service mismatch');
    if (!status.authenticated) return null;
    if (typeof status.context !== 'string' || !/^[a-f0-9]{64}$/.test(status.context)) throw new Error('Missing session context');
    return status.context;
  }

  const context = readContext().catch(() => null);
  const reset = () => {
    if (reloading) return;
    reloading = true;
    workspace.style.visibility = 'hidden';
    notice.hidden = false;
    notice.textContent = 'Your account changed. Reloading Builder…';
    window.location.reload();
  };
  const check = async () => {
    if (reloading || document.hidden) return;
    const request = ++revision;
    const initial = await context;
    if (request !== revision || reloading) return;
    if (initial) workspace.style.visibility = 'hidden';
    try {
      const active = await readContext();
      if (request !== revision || reloading || document.hidden) return;
      if (active !== initial) { reset(); return; }
      workspace.style.visibility = '';
      notice.hidden = true;
    } catch {
      if (initial && request === revision && !reloading) {
        notice.textContent = 'Could not verify your account. Return to this tab to retry, or reload the page.';
        notice.hidden = false;
      }
    }
  };
  const suspend = () => {
    revision++;
    // Hide the tab before the browser can restore its old canvas and library.
    workspace.style.visibility = 'hidden';
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden) suspend(); else void check(); });
  window.addEventListener('focus', () => { void check(); });
  window.addEventListener('pagehide', suspend);
  window.addEventListener('pageshow', event => { if (event.persisted) reset(); });
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel('molecule-playground-workspace');
    channel.addEventListener('message', () => { void check(); });
  }
  return { context, reset };
}
