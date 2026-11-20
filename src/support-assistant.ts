import './support-assistant.css';

// Only explicitly requested illustrations use the separately billed image path.
export function requestsIllustration(text: string): boolean {
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
  if (/\b(?:do not|don't|dont|never|without)\s+(?:create|generate|make|draw|produce|render|show)\b/.test(normalized)) return false;
  if (/\b(how (?:do|can|to)|how would|can you (?:explain|tell)|what (?:is|are)|why|help me (?:understand|learn))\b/.test(normalized)) return false;
  return /\b(?:create|generate|make|draw|produce|render|show me)\b.{0,80}\b(?:image|picture|illustration|artwork|drawing|diagram|photo)\b/.test(normalized) || /^(?:draw|illustrate|sketch)\s+(?:me\s+)?(?:a|an|the)\s+/.test(normalized);
}

export function mountSupportAssistant(trigger: HTMLButtonElement) {
  const dialog = document.createElement('dialog');
  dialog.className = 'support-dialog'; dialog.setAttribute('aria-labelledby','support-title');
  dialog.innerHTML = `<form class="support-form" novalidate>
    <div class="support-heading"><h2 id="support-title">Support assistant</h2><button type="button" class="support-close">Close</button></div>
    <p class="support-availability" role="status">Checking availability…</p>
    <label for="support-question">Message</label><textarea id="support-question" rows="3" maxlength="1000" aria-describedby="support-error" placeholder="Ask a question or request an image" required></textarea>
    <button type="submit" class="support-submit" disabled>Ask assistant</button>
    <p id="support-error" class="support-error" role="alert" tabindex="-1"></p>
    <section class="support-response" aria-live="polite" tabindex="-1" hidden><h3>Chat</h3><div class="support-history"></div><p class="support-answer"></p><img class="support-image" alt="AI-generated illustration, not a verified structure or screenshot" hidden><p class="support-disclaimer">AI can be wrong and does not validate chemistry. Images are illustrations, not verified structures or actual screenshots. Check the tool’s own results and limitations.</p><details><summary>Website help supplied to the AI</summary><div class="support-references"></div></details></section>
  </form>`;
  document.body.append(dialog);
  const form = dialog.querySelector<HTMLFormElement>('form')!, question = dialog.querySelector<HTMLTextAreaElement>('#support-question')!;
  const close = dialog.querySelector<HTMLButtonElement>('.support-close')!, submit = dialog.querySelector<HTMLButtonElement>('.support-submit')!;
  const image = dialog.querySelector<HTMLImageElement>('.support-image')!, transcript = dialog.querySelector<HTMLElement>('.support-history')!;
  const availability = dialog.querySelector<HTMLElement>('.support-availability')!, error = dialog.querySelector<HTMLElement>('#support-error')!, response = dialog.querySelector<HTMLElement>('.support-response')!, answer = dialog.querySelector<HTMLElement>('.support-answer')!, references = dialog.querySelector<HTMLElement>('.support-references')!;
  let revision = 0, ready = false, pending = false, request: AbortController | undefined;
  let history: {role:'user'|'assistant'; content:string}[] = [];
  const clearAnswer = () => { response.hidden = true; answer.textContent = ''; references.replaceChildren(); transcript.replaceChildren(); image.hidden = true; image.removeAttribute('src'); history = []; };
  const update = () => { submit.disabled = !ready || pending; question.disabled = pending; };
  const allowedLinks = new Set(['/', '/explore.html','/builder.html','/reaction-lab.html','/calculators.html','/calculators.html#gas-laws']);
  trigger.addEventListener('click', async () => {
    dialog.showModal(); question.focus(); ready = false; availability.textContent = 'Checking availability…'; update();
    const current = ++revision; request = new AbortController(); const controller = request, timer = setTimeout(() => controller.abort(),8000);
    try {
      const result = await fetch('/api/support/status',{signal:request.signal}); const body = await result.json();
      if (current !== revision) return;
      ready = result.ok && body.enabled === true;
      availability.textContent = ready ? '' : 'Assistant unavailable.';
    } catch { if (current === revision) availability.textContent = 'Assistant unavailable. Please try again.'; }
    finally { clearTimeout(timer); if (current === revision) update(); }
  });
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { revision++; request?.abort(); form.reset(); clearAnswer(); error.textContent = ''; pending = false; ready = false; update(); trigger.focus(); });
  question.addEventListener('input', () => { error.textContent = ''; });
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (!ready || pending) return;
    error.textContent = '';
    if (question.value.trim().length < 3) { error.textContent = 'Enter a message in 3–1000 characters.'; question.focus(); return; }
    pending = true; update(); availability.textContent = 'Generating an AI reply…'; const current = ++revision;
    const sentQuestion = question.value.trim(), requestedMode = requestsIllustration(sentQuestion) ? 'image' : 'text';
    request = new AbortController(); const controller = request, timer = setTimeout(() => controller.abort(),requestedMode === 'image' ? 160000 : 25000);
    try {
      const result = await fetch('/api/support/ask', {method:'POST',headers:{'Content-Type':'application/json','X-Support-Request':'1'},signal:controller.signal,body:JSON.stringify({question:sentQuestion,consent:true,...(requestedMode === 'image' ? {mode:'image',imageConsent:true} : {}),...(history.length ? {history:history.slice(-6)} : {})})});
      const body = await result.json(); if (current !== revision) return;
      if (!result.ok) throw new Error(typeof body.error === 'string' ? body.error : 'AI support is unavailable.');
      if (body.kind !== 'ai' || typeof body.answer !== 'string' || !body.answer.trim() || body.answer.length > 6000) throw new Error('The AI service returned an invalid reply.');
      if (requestedMode === 'image' && (typeof body.image !== 'string' || body.image.length > 6000000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.image))) throw new Error('The AI service did not return a valid image.');
      if (!response.hidden) { const oldReply = document.createElement('p'); oldReply.textContent = `Assistant: ${answer.textContent}`; transcript.append(oldReply); if (!image.hidden) transcript.append(image.cloneNode(true)); }
      const userTurn = document.createElement('p'); userTurn.textContent = `You: ${sentQuestion}`; transcript.append(userTurn);
      answer.textContent = body.answer;
      image.hidden = requestedMode !== 'image'; if (requestedMode === 'image') image.src = `data:image/png;base64,${body.image}`; else image.removeAttribute('src');
      history.push({role:'user',content:sentQuestion},{role:'assistant',content:body.answer.slice(0,1000)}); history = history.slice(-6);
      question.value = '';
      references.replaceChildren();
      for (const ref of Array.isArray(body.references) ? body.references : []) { if (!allowedLinks.has(ref.href) || typeof ref.title !== 'string') continue; const link = document.createElement('a'); link.href = ref.href; link.textContent = ref.title; references.append(link); }
      response.hidden = false; response.focus();
    } catch(caught) { if (current === revision) {error.textContent = caught instanceof Error && caught.name !== 'AbortError' && !(caught instanceof TypeError) ? caught.message : 'The reply could not be completed. No automatic retry was made; your question is still here.'; error.focus();} }
    finally { clearTimeout(timer); if (current === revision) { pending = false; availability.textContent = ''; update(); } }
  });
}
