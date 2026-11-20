import './feedback.css';

declare const __CAPSTONE_PRIVATE_BETA__: boolean;

export function mountFeedback(trigger: HTMLButtonElement) {
  const dialog = document.createElement('dialog');
  dialog.className = 'feedback-dialog'; dialog.setAttribute('aria-labelledby', 'feedback-title');
  const title = __CAPSTONE_PRIVATE_BETA__ ? 'Feedback' : 'Send feedback';
  const heading = `<div class="feedback-heading"><h2 id="feedback-title">${title}</h2><button type="button" class="feedback-close" aria-label="Close feedback">Close</button></div>`;
  if (__CAPSTONE_PRIVATE_BETA__) {
    trigger.textContent = 'Feedback availability';
    dialog.innerHTML = `<div class="feedback-form">${heading}
      <p>Feedback submissions are disabled in Beta V3. Please contact the project owner to report an issue.</p>
    </div>`;
    document.body.append(dialog);
    trigger.addEventListener('click', () => dialog.showModal());
    dialog.querySelector<HTMLButtonElement>('.feedback-close')!.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => trigger.focus());
    return;
  }
  dialog.innerHTML = `<form class="feedback-form" novalidate>${heading}
    <p>Report a problem, flag a chemistry concern, or suggest an improvement.</p>
    <label for="feedback-category">Category</label><select id="feedback-category" required><option value="bug">Bug report</option><option value="chemistry">Chemistry concern</option><option value="suggestion">Suggestion</option></select>
    <label for="feedback-message">What would you like us to know?</label><textarea id="feedback-message" rows="5" minlength="10" maxlength="4000" required aria-describedby="feedback-message-help feedback-error"></textarea>
    <small id="feedback-message-help">10–4000 characters. For a bug, include what happened and what you expected. Please do not include passwords or personal information.</small>
    <label class="feedback-consent"><input id="feedback-context-opt-in" type="checkbox"> Include page and device context</label>
    <div class="feedback-context" hidden><p class="feedback-context-preview"></p><label for="feedback-details">Relevant inputs or steps (optional)</label><textarea id="feedback-details" rows="3" maxlength="1500"></textarea><small>Only the page name, desktop/mobile label and what you type here are included. Drawings, calculations, URLs and screenshots are not collected automatically.</small></div>
    <p class="feedback-privacy">Saved privately on the project server, not posted publicly. No email is sent. This local preview stores reports on this computer.</p>
    <p class="feedback-status" role="status" tabindex="-1"></p><p id="feedback-error" class="feedback-error" role="alert" tabindex="-1"></p>
    <button type="submit" class="feedback-submit">Send feedback</button>
  </form>`;
  document.body.append(dialog);
  const form = dialog.querySelector<HTMLFormElement>('form')!;
  const category = dialog.querySelector<HTMLSelectElement>('#feedback-category')!;
  const message = dialog.querySelector<HTMLTextAreaElement>('#feedback-message')!;
  const consent = dialog.querySelector<HTMLInputElement>('#feedback-context-opt-in')!;
  const context = dialog.querySelector<HTMLElement>('.feedback-context')!;
  const details = dialog.querySelector<HTMLTextAreaElement>('#feedback-details')!;
  const status = dialog.querySelector<HTMLElement>('.feedback-status')!;
  const error = dialog.querySelector<HTMLElement>('.feedback-error')!;
  const submit = dialog.querySelector<HTMLButtonElement>('.feedback-submit')!;
  const close = dialog.querySelector<HTMLButtonElement>('.feedback-close')!;
  let pending = false, saved = false;
  message.addEventListener('input', () => { error.textContent = ''; message.removeAttribute('aria-invalid'); });
  const pages: Record<string,string> = {'/':'Home','/index.html':'Home','/explore.html':'Explorer','/builder.html':'Builder','/reaction-lab.html':'Reaction Lab','/calculators.html':'Calculators'};
  const page = Object.hasOwn(pages, location.pathname) ? location.pathname : '/';
  const device = () => innerWidth <= 760 ? 'mobile' : 'desktop';
  consent.addEventListener('change', () => { context.hidden = !consent.checked; dialog.querySelector('.feedback-context-preview')!.textContent = `Included: ${pages[page]} · ${device()}`; });
  trigger.addEventListener('click', () => {
    if (saved) { form.reset(); context.hidden = true; status.textContent = ''; saved = false; submit.disabled = false; submit.textContent = 'Send feedback'; }
    error.textContent = ''; dialog.showModal(); category.focus();
  });
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', event => { if (pending) event.preventDefault(); });
  dialog.addEventListener('close', () => trigger.focus());
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (pending || saved) return;
    error.textContent = ''; message.removeAttribute('aria-invalid');
    if (message.value.trim().length < 10 || message.value.trim().length > 4000) { error.textContent = 'Please describe your feedback in 10–4000 characters.'; message.setAttribute('aria-invalid','true'); message.focus(); return; }
    pending = true; submit.disabled = true; close.disabled = true; status.textContent = 'Saving feedback…';
    const controller = new AbortController(), timeout = window.setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch('/api/feedback', {method:'POST', headers:{'Content-Type':'application/json','X-Feedback-Request':'1'}, signal:controller.signal, body:JSON.stringify({category:category.value,message:message.value.trim(), ...(consent.checked ? {context:{page,device:device(),details:details.value.trim()}} : {})})});
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Feedback could not be saved. Please try again later.');
      if (typeof body.receipt !== 'string' || !/^[a-f0-9]{32}$/.test(body.receipt)) throw new Error('The server did not confirm that feedback was saved.');
      saved = true; status.textContent = `Feedback saved. Thank you! Reference: ${body.receipt.slice(0,8)}. This is a local submission, not an email.`; submit.textContent = 'Saved'; status.focus();
    } catch (caught) { status.textContent = ''; error.textContent = caught instanceof Error && caught.name !== 'AbortError' && !(caught instanceof TypeError) ? caught.message : 'Could not confirm saving. Your message is still here; please check your connection before retrying.'; error.focus(); }
    finally { clearTimeout(timeout); pending = false; close.disabled = false; submit.disabled = saved; }
  });
}
