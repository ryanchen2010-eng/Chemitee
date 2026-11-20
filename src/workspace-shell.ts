import { mountFeedback } from './feedback';
import { mountSupportAssistant } from './support-assistant';
import { mountAccount } from './account';
import { mountThemeToggle } from './workspace-theme';
/** Shared presentation chrome. Existing route links and tool nodes stay intact. */
const ICONS: Record<string, string> = {
  '/': '<path d="m3 10 9-7 9 7v10H6V10m4 10v-7h4v7"/>',
  '/explore.html': '<circle cx="7" cy="6" r="3"/><circle cx="18" cy="9" r="3"/><circle cx="9" cy="19" r="3"/><path d="m10 7 5 1M8 9l1 7m3 2 4-6"/>',
  '/builder.html': '<path d="m4 16 12-12 4 4L8 20H4v-4m9-9 4 4"/>',
  '/reaction-lab.html': '<path d="M9 3h6m-5 0v7L4 20h16l-6-10V3M7 15h10"/>',
  '/calculators.html': '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M8 6h8M8 11h1m3 0h1m3 0h1M8 15h1m3 0h1m3 0h1M8 19h1m3 0h1m3 0h1"/>',
};

export function workspaceIcon(route: string): SVGSVGElement {
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('focusable', 'false');
  icon.classList.add('workspace-icon');
  icon.innerHTML = ICONS[route] ?? ICONS['/explore.html'];
  return icon;
}

export function mountWorkspaceShell(shell: HTMLElement): void {
  if (shell.querySelector(':scope > .workspace-topbar')) return;
  const nav = shell.querySelector<HTMLElement>('nav[aria-label="Project pages"]');
  if (!nav) throw new Error('The workspace requires its existing project navigation.');
  const header = nav.closest('header');
  document.body.classList.add('workspace-page');
  shell.classList.add('workspace-shell');
  nav.classList.add('workspace-nav');
  const topbar = document.createElement('header');
  topbar.className = 'workspace-topbar';
  const bar = document.createElement('div');
  bar.className = 'workspace-topbar-inner';
  const brand = shell.querySelector<HTMLAnchorElement>('.site-brand') ?? document.createElement('a');
  brand.className = 'workspace-brand';
  brand.textContent = 'Molecule Playground';
  brand.prepend(workspaceIcon('/explore.html'));
  brand.href = '/';
  brand.setAttribute('aria-label', 'Molecule Playground home');
  for (const link of nav.querySelectorAll('a')) {
    link.prepend(workspaceIcon(link.getAttribute('href') ?? '/'));
  }
  const menu = document.createElement('div');
  menu.className = 'workspace-menu';
  menu.id = 'workspace-menu';
  const menuToggle = document.createElement('button');
  menuToggle.className = 'workspace-menu-toggle';
  menuToggle.type = 'button';
  menuToggle.textContent = 'Menu';
  menuToggle.setAttribute('aria-controls', 'workspace-menu');
  const theme = document.createElement('button');
  theme.type = 'button';
  theme.className = 'workspace-theme';
  mountThemeToggle(theme);

  const utilities = document.createElement('div');
  utilities.id = 'workspace-help';
  utilities.className = 'workspace-utilities';
  utilities.tabIndex = -1;
  const feedback = document.createElement('button');
  feedback.type = 'button';
  feedback.className = 'workspace-feedback';
  feedback.textContent = 'Send feedback';
  mountFeedback(feedback);
  const accountMenu = document.createElement('details');
  accountMenu.className = 'workspace-account-menu';
  const accountLabel = document.createElement('summary');
  accountLabel.textContent = 'My molecules';
  const accountPanel = document.createElement('div');
  accountPanel.className = 'workspace-account-panel';
  const library = document.createElement('a');
  library.className = 'workspace-library-link';
  library.href = '/builder.html#personal-library';
  library.textContent = 'Go to My molecules';
  const account = document.createElement('section');
  account.className = 'workspace-account';
  account.setAttribute('aria-label', 'Account');
  mountAccount(account);
  accountPanel.append(library, account);
  accountMenu.append(accountLabel, accountPanel);
  accountMenu.open = new URLSearchParams(window.location.search).has('account_error');
  accountMenu.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !accountMenu.open) return;
    event.stopPropagation();
    accountMenu.open = false;
    accountLabel.focus();
  });
  accountMenu.addEventListener('focusout', event => {
    if (event.relatedTarget instanceof Node && !accountMenu.contains(event.relatedTarget)) accountMenu.open = false;
  });
  const support = document.createElement('button');
  support.type = 'button';
  support.className = 'workspace-support';
  support.setAttribute('aria-label', 'Open support assistant');
  support.title = 'Support assistant';
  support.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14a2 2 0 0 1-2 2H9l-4 4V6a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2Z"/><path d="M8 8h9m-9 4h6"/></svg>';
  mountSupportAssistant(support);
  const help = document.createElement('a');
  help.className = 'workspace-help-link';
  help.href = '#workspace-help';
  help.textContent = feedback.textContent;
  utilities.append(feedback);
  menu.append(nav, accountMenu, help);
  bar.append(brand, menuToggle, menu, theme, support);
  mountMenu(menuToggle, menu, accountMenu.open);
  topbar.append(bar);
  shell.prepend(topbar);
  shell.append(utilities);
  if (header && !header.querySelector('h1')) header.hidden = true;
}

function mountMenu(toggle: HTMLButtonElement, menu: HTMLElement, initiallyOpen: boolean) {
  const setOpen = (open: boolean) => toggle.setAttribute('aria-expanded', String(open));
  const isOpen = () => toggle.getAttribute('aria-expanded') === 'true';
  setOpen(initiallyOpen);
  toggle.addEventListener('click', () => setOpen(!isOpen()));
  menu.addEventListener('click', event => {
    if (event.target instanceof Element && event.target.closest('.workspace-help-link')) setOpen(false);
  });
  const bar = toggle.parentElement;
  bar?.addEventListener('keydown', event => {
    if (event.key === 'Escape' && isOpen()) { setOpen(false); toggle.focus(); }
  });
  bar?.addEventListener('focusout', event => {
    if (event.relatedTarget instanceof Node && !bar.contains(event.relatedTarget)) setOpen(false);
  });
}
