declare const __CAPSTONE_PRIVATE_BETA__: boolean;

type Folder = { id: string; name: string };
type Molecule = { id: string; name: string; molfile: string; folder: string | null };
type Library = { folders: Folder[]; molecules: Molecule[]; context?: string; workspace?: 'hosted' };

const iconPaths = {
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  molecule: '<path d="M7.8 8.3l3 2.5m3 1.1 3.2 2.7m-6.5-.8-3 3"/><circle cx="6" cy="7" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="16" r="2"/><circle cx="6" cy="18" r="2"/>',
  next: '<path d="m10 6 6 6-6 6"/>',
  back: '<path d="m10 6-6 6 6 6M4 12h16"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  add: '<path d="M12 5v14M5 12h14"/>',
};
const icon = (name: keyof typeof iconPaths) => `<svg aria-hidden="true" viewBox="0 0 24 24">${iconPaths[name]}</svg>`;

/** Both account services derive ownership from the signed-in session. */
export function mountPersonalLibrary(host: HTMLElement, editor: { save: () => Promise<string>; open: (molfile: string) => Promise<void> }, hosted?: {
  context: Promise<string | null>;
  reset: () => void;
}): void {
  if (__CAPSTONE_PRIVATE_BETA__ && !hosted) {
    host.innerHTML = `<h2>My molecules</h2><p class="library-status">Account-linked saves are disabled in Beta V3. Export a drawing to keep a copy.</p>`;
    return;
  }
  host.innerHTML = `
    <div class="library-entry">
      <div><h2>My molecules</h2><p>Save drawings and organize them in folders.</p></div>
      <div class="library-entry-actions"><button type="button" class="secondary-button library-open">Open library</button><button type="button" class="primary-button library-save-open">Save drawing</button></div>
    </div>
    <p class="library-status" role="status"></p>
    <form class="library-save-form" hidden>
      <h3>Save drawing</h3>
      <label>Molecule name<input name="name" maxlength="120" required autocomplete="off"></label>
      <label>Save in<select name="folder" aria-label="Save in"></select></label>
      <div class="library-form-actions"><button type="submit" class="primary-button">Save</button><button type="button" class="secondary-button library-save-cancel">Cancel</button></div>
    </form>
    <dialog class="library-dialog" aria-labelledby="library-title">
      <div class="library-dialog-header">
        <div class="library-title-row"><div><h2 id="library-title">My molecules</h2><p>${hosted ? 'Saved to your account' : 'Saved on this computer'}</p></div><button type="button" class="secondary-button library-close" autofocus>Close</button></div>
        <nav class="library-folder-nav" aria-label="Folder navigation" hidden><button type="button" class="library-home">${icon('back')} Back to My molecules</button></nav>
      </div>
      <div class="library-content">
        <h3 class="library-current" tabindex="-1" hidden><span class="library-item-icon library-folder-icon">${icon('folder')}</span><span class="library-current-name"></span></h3>
        <p class="library-dialog-status" role="status"></p>
        <section class="library-folders" aria-labelledby="library-folders-title">
          <div class="library-section-header"><h3 id="library-folders-title" tabindex="-1">Folders</h3><button type="button" class="secondary-button library-new-folder" aria-controls="library-folder-form" aria-expanded="false">${icon('add')} New folder</button></div>
          <form class="library-folder-form" id="library-folder-form" hidden><label>Folder name<input name="name" maxlength="120" required autocomplete="off"></label><div class="library-form-actions"><button type="submit" class="primary-button">Create folder</button><button type="button" class="secondary-button library-folder-cancel">Cancel</button></div></form>
          <p class="library-no-folders">Create a folder to group saved molecules.</p>
          <ul class="library-folder-grid" role="list"></ul>
        </section>
        <section aria-labelledby="library-files-title">
          <h3 id="library-files-title" tabindex="-1"></h3>
          <ul class="library-file-list" role="list"></ul>
          <div class="library-empty" hidden><p class="library-empty-title"></p><p class="library-empty-hint"></p></div>
        </section>
      </div>
    </dialog>`;
  const get = <T extends Element>(selector: string): T => {
    const node = host.querySelector<T>(selector); if (!node) throw new Error(`Missing library control: ${selector}`); return node;
  };
  const status = get<HTMLElement>('.library-status'), dialogStatus = get<HTMLElement>('.library-dialog-status');
  const openButton = get<HTMLButtonElement>('.library-open'), saveOpen = get<HTMLButtonElement>('.library-save-open');
  const saveForm = get<HTMLFormElement>('.library-save-form'), saveName = get<HTMLInputElement>('.library-save-form input'), saveFolder = get<HTMLSelectElement>('.library-save-form select');
  const dialog = get<HTMLDialogElement>('.library-dialog'), content = get<HTMLElement>('.library-content');
  const folderNav = get<HTMLElement>('.library-folder-nav'), home = get<HTMLButtonElement>('.library-home');
  const current = get<HTMLElement>('.library-current'), currentName = get<HTMLElement>('.library-current-name');
  const folders = get<HTMLElement>('.library-folders'), folderGrid = get<HTMLElement>('.library-folder-grid');
  const foldersTitle = get<HTMLElement>('#library-folders-title'), noFolders = get<HTMLElement>('.library-no-folders');
  const filesTitle = get<HTMLElement>('#library-files-title'), fileList = get<HTMLElement>('.library-file-list');
  const empty = get<HTMLElement>('.library-empty'), emptyTitle = get<HTMLElement>('.library-empty-title'), emptyHint = get<HTMLElement>('.library-empty-hint');
  const newFolder = get<HTMLButtonElement>('.library-new-folder'), folderForm = get<HTMLFormElement>('.library-folder-form'), folderName = get<HTMLInputElement>('.library-folder-form input');
  const button = (label: string, handler: () => void, className = 'secondary-button') => {
    const node = document.createElement('button'); node.type = 'button'; node.className = className; node.textContent = label; node.addEventListener('click', handler); return node;
  };
  let data: Library = { folders: [], molecules: [] }, folderId: string | null = null;
  let context: string | undefined;
  let revision = 0, busy = false, loaded = false;
  let expanded: { trigger: HTMLButtonElement; panel: HTMLElement } | undefined;
  const setStatus = (message: string) => { status.textContent = message; dialogStatus.textContent = message; };
  const clearPrivateData = () => {
    data = { folders: [], molecules: [] }; loaded = false; folderId = null;
    closeActions(); currentName.textContent = ''; folderGrid.replaceChildren(); fileList.replaceChildren();
    saveForm.reset(); saveForm.hidden = true; setFolderForm(false);
    if (dialog.open) dialog.close();
  };
  async function refresh(feedback = ''): Promise<boolean> {
    const request = ++revision;
    try {
      if (hosted) {
        context = (await hosted.context) ?? undefined;
        if (request !== revision) return false;
        if (!context) { clearPrivateData(); setStatus('Sign in to save and open molecules.'); return false; }
      }
      const headers: Record<string, string> = context ? { 'X-Workspace-Context': context } : {};
      const response = await fetch('/api/account/library', { credentials: 'same-origin', cache: 'no-store', headers });
      if (request !== revision) return false;
      if (hosted && (response.status === 409 || response.status === 401)) { clearPrivateData(); hosted.reset(); return false; }
      if (response.status === 401) { clearPrivateData(); openButton.disabled = saveOpen.disabled = true; setStatus('Sign in to save and open molecules.'); return false; }
      if (!response.ok) throw new Error();
      const result = await response.json() as Library;
      if (request !== revision) return false;
      if (hosted && (result.workspace !== 'hosted' || result.context !== context)) throw new Error('Workspace mismatch');
      const needsRender = !loaded || JSON.stringify(data) !== JSON.stringify(result);
      data = result; loaded = true; openButton.disabled = saveOpen.disabled = false;
      if (folderId && !data.folders.some(folder => folder.id === folderId)) folderId = null;
      setStatus(feedback); if (needsRender) render(); return true;
    } catch {
      if (request === revision) { clearPrivateData(); openButton.disabled = saveOpen.disabled = true; setStatus('Saved molecules are unavailable. Refresh the page to try again.'); }
      return false;
    }
  }
  async function change(body: Record<string, unknown>, feedback: string): Promise<boolean> {
    if (busy) return false;
    busy = true;
    try {
      if (hosted && !context) return false;
      const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Account-Request': '1' };
      if (context) headers['X-Workspace-Context'] = context;
      const response = await fetch('/api/account/library', { method: 'POST', credentials: 'same-origin', headers, body: JSON.stringify(body) });
      if (hosted && (response.status === 409 || response.status === 401)) { clearPrivateData(); hosted.reset(); return false; }
      if (response.status === 401) { await refresh(); return false; }
      if (!response.ok) throw new Error();
      return await refresh(feedback);
    } catch { setStatus('Could not update your library. Please try again.'); return false; }
    finally { busy = false; }
  }
  function closeActions() {
    if (!expanded) return;
    expanded.panel.hidden = true;
    expanded.trigger.setAttribute('aria-expanded', 'false');
    expanded = undefined;
  }

  function setFolderForm(visible: boolean) {
    folderForm.hidden = !visible;
    newFolder.setAttribute('aria-expanded', String(visible));
    if (visible) folderName.focus();
    else folderForm.reset();
  }

  function renderItem(item: Folder | Molecule, count: number) {
    const isMolecule = 'molfile' in item;
    const kind = isMolecule ? 'molecule' : 'folder';
    const row = document.createElement('li');
    row.className = 'library-item';
    row.id = `library-${kind}-${item.id}`;
    const controls = document.createElement('div');
    controls.className = 'library-item-controls';

    const open = button('', () => {
      if (isMolecule) {
        if (confirm('Open this molecule? Your current drawing will be replaced.')) {
          void editor.open(item.molfile).then(() => dialog.close()).catch(() => setStatus('Could not open this molecule.'));
        }
      } else {
        folderId = item.id;
        setFolderForm(false);
        setStatus('');
        render(false);
        content.scrollTop = 0;
        current.focus();
      }
    }, 'library-item-open');
    open.setAttribute('aria-label', `Open ${kind} ${item.name}`);
    open.innerHTML = `<span class="library-item-icon library-${kind}-icon">${icon(kind)}</span>
      <span class="library-item-text"><span class="library-item-name"></span></span>
      <span class="library-item-affordance" aria-hidden="true">${isMolecule ? 'Open' : icon('next')}</span>`;
    open.querySelector('.library-item-name')!.textContent = item.name;
    if (!isMolecule) {
      const description = document.createElement('span');
      description.className = 'library-item-count';
      description.id = `${row.id}-count`;
      description.textContent = count === 1 ? '1 molecule' : `${count} molecules`;
      open.querySelector('.library-item-text')!.append(description);
      open.setAttribute('aria-describedby', description.id);
    }

    const actions = document.createElement('div');
    actions.className = 'library-options-panel';
    actions.id = `${row.id}-actions`;
    actions.hidden = true;
    const manage = button('', () => {
      const wasOpen = !actions.hidden;
      closeActions();
      if (wasOpen) return;
      actions.hidden = false;
      manage.setAttribute('aria-expanded', 'true');
      expanded = { trigger: manage, panel: actions };
    }, 'library-manage');
    manage.innerHTML = icon('more');
    manage.title = `Manage ${kind}`;
    manage.setAttribute('aria-label', `Manage ${kind} ${item.name}`);
    manage.setAttribute('aria-controls', actions.id);
    manage.setAttribute('aria-expanded', 'false');

    const rename = button('Rename', () => {
      const name = prompt(`New ${kind} name`, item.name);
      if (name?.trim()) void change({ action: `rename_${kind}`, id: item.id, name }, isMolecule ? 'Molecule renamed.' : 'Folder renamed.');
    });
    const remove = button(`Delete ${kind}`, () => {
      const detail = isMolecule ? 'This cannot be undone.' : 'Its molecules will move to My molecules.';
      if (!confirm(`Delete “${item.name}”? ${detail}`)) return;
      const feedback = isMolecule ? 'Molecule deleted.' : 'Folder deleted. Its molecules are in My molecules.';
      void change({ action: `delete_${kind}`, id: item.id }, feedback);
    }, 'secondary-button library-delete');
    const actionButtons = document.createElement('div');
    actionButtons.className = 'library-form-actions';
    actionButtons.append(rename, remove);
    actions.append(actionButtons);

    if (isMolecule && data.folders.length) {
      const moveForm = document.createElement('form');
      moveForm.className = 'library-move-form';
      const moveLabel = document.createElement('label');
      moveLabel.htmlFor = `${row.id}-destination`;
      moveLabel.textContent = 'Move to';
      const move = document.createElement('select');
      move.id = moveLabel.htmlFor;
      move.setAttribute('aria-label', `Move ${item.name} to`);
      move.add(new Option('My molecules (no folder)', ''));
      for (const dest of data.folders) move.add(new Option(dest.name, dest.id));
      const initial = item.folder ?? '';
      move.value = initial;
      const submit = document.createElement('button');
      submit.type = 'submit';
      submit.className = 'primary-button';
      submit.textContent = 'Move';
      submit.disabled = true;
      let moving = false;
      move.addEventListener('change', () => { submit.disabled = move.value === initial; });
      moveForm.addEventListener('submit', async event => {
        event.preventDefault();
        if (submit.disabled || moving) return;
        const destination = move.value || null;
        moving = true;
        submit.focus();
        move.disabled = true;
        submit.setAttribute('aria-disabled', 'true');
        try {
          await change({ action: 'move_molecule', id: item.id, folder: destination }, `Moved “${item.name}”.`);
        } finally {
          moving = false;
          move.disabled = false;
          submit.removeAttribute('aria-disabled');
        }
      });
      moveForm.append(moveLabel, move, submit);
      actions.append(moveForm);
    }

    controls.append(open, manage);
    row.append(controls, actions);
    return row;
  }

  function render(restoreFocus = true) {
    const focused = document.activeElement;
    const focusedItem = restoreFocus && focused?.closest<HTMLElement>('.library-item');
    const folder = data.folders.find(item => item.id === folderId);
    folderNav.hidden = current.hidden = !folder;
    currentName.textContent = folder?.name ?? '';
    folders.hidden = !!folder;

    const chosen = saveFolder.value;
    saveFolder.replaceChildren(new Option('My molecules (no folder)', ''));
    for (const item of data.folders) saveFolder.add(new Option(item.name, item.id));
    saveFolder.value = chosen && data.folders.some(item => item.id === chosen) ? chosen : '';

    closeActions();
    const counts = new Map<string, number>();
    for (const item of data.molecules) {
      if (item.folder) counts.set(item.folder, (counts.get(item.folder) ?? 0) + 1);
    }
    noFolders.hidden = data.folders.length > 0;
    folderGrid.replaceChildren(...(folder ? [] : data.folders.map(item => renderItem(item, counts.get(item.id) ?? 0))));
    const items = data.molecules.filter(item => item.folder === folderId);
    fileList.replaceChildren(...items.map(item => renderItem(item, 0)));

    filesTitle.textContent = folder ? 'Molecules' : 'Unfiled molecules';
    empty.hidden = items.length > 0;
    if (!empty.hidden) {
      emptyTitle.textContent = folder ? 'This folder is empty.' : data.molecules.length ? 'No unfiled molecules.' : 'No molecules here yet.';
      emptyHint.textContent = folder
        ? 'Choose this folder when saving a drawing, or move a saved molecule here.'
        : 'Use Save drawing in Builder to add a molecule.';
    }
    if (!restoreFocus || !dialog.open) return;
    if (!folder && (focused === home || focused === current)) {
      foldersTitle.focus();
    } else if (focusedItem) {
      const selector = focused?.matches('.library-item-open') ? '.library-item-open' : '.library-manage';
      const control = document.getElementById(focusedItem.id)?.querySelector<HTMLButtonElement>(selector);
      const heading = focusedItem.id.startsWith('library-folder-') ? foldersTitle : filesTitle;
      (control ?? heading).focus();
    }
  }
  openButton.disabled = saveOpen.disabled = true;
  openButton.addEventListener('click', () => {
    folderId = null;
    setFolderForm(false);
    setStatus('');
    render(false);
    content.scrollTop = 0;
    dialog.showModal();
  });
  get<HTMLButtonElement>('.library-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', event => {
    if (expanded) {
      event.preventDefault();
      const { trigger } = expanded;
      closeActions();
      trigger.focus();
    } else if (!folderForm.hidden) {
      event.preventDefault();
      setFolderForm(false);
      newFolder.focus();
    }
  });
  home.addEventListener('click', () => {
    const previous = folderId;
    folderId = null;
    setStatus('');
    render(false);
    const folder = document.getElementById(`library-folder-${previous}`);
    (folder?.querySelector<HTMLButtonElement>('.library-item-open') ?? foldersTitle).focus();
  });
  newFolder.addEventListener('click', () => {
    closeActions();
    setFolderForm(folderForm.hidden);
    if (folderForm.hidden) newFolder.focus();
  });
  get<HTMLButtonElement>('.library-folder-cancel').addEventListener('click', () => { setFolderForm(false); newFolder.focus(); });
  folderForm.addEventListener('submit', async event => {
    event.preventDefault();
    const name = folderName.value.trim();
    if (!name) { folderName.focus(); return; }
    const submit = folderForm.querySelector<HTMLButtonElement>('[type=submit]')!;
    submit.disabled = true;
    try {
      if (await change({ action: 'create_folder', name }, `Folder “${name}” created.`)) {
        setFolderForm(false);
        if (dialog.open && !folders.hidden) newFolder.focus();
      }
    } finally { submit.disabled = false; }
  });
  saveOpen.addEventListener('click', () => { saveForm.hidden = false; saveFolder.value = folderId ?? ''; saveName.focus(); });
  get<HTMLButtonElement>('.library-save-cancel').addEventListener('click', () => { saveForm.reset(); saveForm.hidden = true; saveOpen.focus(); });
  saveForm.addEventListener('submit', async event => {
    event.preventDefault(); const name = saveName.value.trim(); if (!name) { saveName.focus(); return; }
    const folder = saveFolder.value || null, submit = saveForm.querySelector<HTMLButtonElement>('[type=submit]')!; submit.disabled = true; setStatus('Saving…');
    try { const molfile = await editor.save(); if (await change({ action: 'save_molecule', name, molfile, folder }, `Saved “${name}”.`)) { saveForm.reset(); saveForm.hidden = true; saveOpen.focus(); } }
    catch { setStatus('Could not read the drawing. Wait for the editor and try again.'); } finally { submit.disabled = false; }
  });
  window.addEventListener('account-changed', () => { clearPrivateData(); openButton.disabled = saveOpen.disabled = true; if (hosted) hosted.reset(); else void refresh(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
  void refresh();
}
