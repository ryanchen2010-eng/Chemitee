/** Account access is optional and separate from the shared beta password. */
type AccountStatus = { configured: boolean; authenticated: boolean; workspace?: 'hosted'; context?: string; user?: { name?: string; email?: string } };
const HOSTED_CONTEXT_KEY = 'molecule-playground.account-context.v1';

function clearStaleDrafts(context: string): boolean {
  try {
    const previous = sessionStorage.getItem(HOSTED_CONTEXT_KEY);
    if (previous === context) return false;
    sessionStorage.setItem(HOSTED_CONTEXT_KEY, context);
    if (previous === null) return false;
    for (let index = sessionStorage.length - 1; index >= 0; index--) {
      const key = sessionStorage.key(index);
      if (key?.startsWith('molecule-playground.') && key !== HOSTED_CONTEXT_KEY
          && key !== 'molecule-playground.builder-draft.v1') {
        sessionStorage.removeItem(key);
      }
    }
    return true;
  } catch {
    return false;
  }
}

function notifyHostedTabs(): void {
  if (typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel('molecule-playground-workspace');
  channel.postMessage('session-check');
  channel.close();
}

export function mountAccount(host: HTMLElement): void {
  const status = document.createElement('p');
  status.className = 'workspace-account-status';
  status.setAttribute('role', 'status');
  status.textContent = 'Checking account access…';
  const signIn = document.createElement('a');
  signIn.className = 'workspace-account-action';
  signIn.href = '/api/account/login';
  signIn.textContent = 'Continue with Google';
  signIn.hidden = true;
  const signOut = document.createElement('button');
  signOut.className = 'workspace-account-action';
  signOut.type = 'button';
  signOut.textContent = 'Sign out';
  signOut.hidden = true;
  const error = document.createElement('p');
  error.className = 'workspace-account-error';
  error.setAttribute('role', 'alert');
  const errorMessages: Record<string, string> = {
    'sign-in-failed': 'Google sign-in could not be completed. Please try again.',
    cancelled: 'Google sign-in was cancelled. You can try again when ready.',
    state: 'The sign-in session expired or could not be verified. Please start sign-in again.',
    provider: 'Google could not complete sign-in. Check the local client setup and try again.',
    credentials: 'Google rejected the local client credentials. Check the client ID and secret privately, then restart the preview.',
    grant: 'The Google sign-in request expired or could not be accepted. Please start sign-in again.',
    network: 'The local account service could not reach Google. Check your connection and try again.',
    identity: 'Google’s sign-in response could not be verified. Please try again.',
    unexpected: 'Google sign-in could not be completed. Please try again.',
  };
  const errorCode = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('account_error') : null;
  const message = errorCode && Object.hasOwn(errorMessages, errorCode) ? errorMessages[errorCode] : undefined;
  error.hidden = !message;
  if (message) error.textContent = message;
  host.append(status, signIn, signOut, error);

  let account: AccountStatus | undefined;
  const render = (result: AccountStatus) => {
    account = result;
    const signedIn = account.configured && account.authenticated;
    signIn.hidden = !account.configured || signedIn;
    signOut.hidden = !signedIn;
    status.textContent = signedIn
      ? `Signed in${account.user?.name ? ` as ${account.user.name}` : account.user?.email ? ` as ${account.user.email}` : ''}.`
      : account.configured ? 'Browsing as a guest. Sign in is optional.' : 'Accounts are not configured. You can use the tools as a guest.';
  };
  const unavailable = () => {
    signIn.hidden = true; signOut.hidden = true;
    status.textContent = 'Account service unavailable. You can still use the tools as a guest.';
  };
  let connected = false;
  let revision = 0;
  const apply = (result: AccountStatus) => {
    if (result.workspace === 'hosted' && clearStaleDrafts(result.context ?? 'guest')) {
      window.location.reload();
      return;
    }
    render(result);
  };
  const readAccount = async () => {
    const current = ++revision;
    try {
      const response = await fetch('/api/account/session', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error('Account unavailable');
      const result = await response.json() as AccountStatus;
      if (current !== revision) return;
      if (result.workspace === 'hosted' && !connected) {
        connected = true;
        if (typeof BroadcastChannel !== 'undefined') {
          const channel = new BroadcastChannel('molecule-playground-workspace');
          channel.addEventListener('message', () => { void readAccount(); });
        }
        document.addEventListener('visibilitychange', () => {
          if (!document.hidden) void readAccount();
        });
        window.addEventListener('pageshow', event => {
          if (event.persisted) void readAccount();
        });
        notifyHostedTabs();
      }
      apply(result);
    } catch {
      if (current === revision) unavailable();
    }
  };
  void readAccount();
  signOut.addEventListener('click', async () => {
    signOut.disabled = true;
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Account-Request': '1' };
      if (account?.workspace === 'hosted' && account.context) headers['X-Workspace-Context'] = account.context;
      const response = await fetch('/api/account/logout', { method: 'POST', credentials: 'same-origin', headers, body: '{}' });
      if (response.status === 409 && account?.workspace === 'hosted') { window.location.reload(); return; }
      if (!response.ok) throw new Error('Sign out failed');
      revision++;
      const workspace = account?.workspace;
      if (workspace === 'hosted') notifyHostedTabs();
      apply({ configured: true, authenticated: false, workspace });
      window.dispatchEvent(new Event('account-changed'));
    } catch {
      status.textContent = 'Could not sign out. Please try again.';
    } finally { signOut.disabled = false; }
  });
}
