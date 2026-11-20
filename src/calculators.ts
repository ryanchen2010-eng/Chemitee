import './calculators.css';
import './solution-calculator.css';
import './reaction-calculator.css';
import { molecules, isIonicCompound } from './molecules';
import { CALCULATOR_TRANSFER_KEY, calculatorCompoundFromMolecule, decodeCalculatorTransfer, type CalculatorCompound } from './calculator-compound';
import { MoleCalculatorPanel } from './mole-calculator-panel';
import { SolutionCalculatorPanel } from './solution-calculator-panel';
import { mountReactionAmounts } from './calculator-reactions';
import { mountEquilibriumCalculator } from './equilibrium-calculator-panel';
import { mountAcidBaseCalculator } from './acid-base-calculator-panel';
import { mountSolubilityCalculator } from './solubility-calculator-panel';
import { mountThermochemistry } from './thermochemistry-panel';
import { mountGasLaws } from './gas-laws-panel';
import './ui-system.css';
import { mountWorkspaceShell } from './workspace-shell';
import { mountCopyResult } from './copy-result';
import './workspace-shell.css';

mountWorkspaceShell(document.querySelector<HTMLElement>('.calculator-shell')!);

const topics = [
  { id: 'moles', name: 'Moles and particles', description: 'Convert mass, moles and counts of a specified entity.', model: 'Local arithmetic' },
  { id: 'solutions', name: 'Solutions', description: 'Concentration, required solute mass and stock dilution.', model: 'Local arithmetic' },
  { id: 'reactions', name: 'Reaction amounts', description: 'Limiting reactants, theoretical yield and required amounts for a supported reaction.', model: 'Verified reaction catalog' },
  { id: 'equilibrium', name: 'Equilibrium', description: 'K/Q or final concentrations for one balanced reversible reaction.', model: 'Defined model · entered constants' },
  { id: 'acid-base', name: 'Acids, bases and buffers', description: 'pH and species concentrations for one acid/base family, including water.', model: 'Defined model · entered constants' },
  { id: 'solubility', name: 'Solubility', description: 'Saturation and Qsp for one salt producing two ion types.', model: 'Defined model · entered constants' },
  { id: 'thermochemistry', name: 'Thermochemistry', description: 'Heat, reaction enthalpy, entropy and Gibbs free energy.', model: 'User-entered thermodynamic data' },
  { id: 'gas-laws', name: 'Gas laws', description: 'Pressure, volume, temperature, moles and partial pressures.', model: 'Ideal-gas model' },
] as const;
// Visual topic cues only; calculations and their assumptions remain in each panel.
const topicSymbols: Record<typeof topics[number]['id'], string> = {
  moles: 'n', solutions: 'c', reactions: '→', equilibrium: 'K',
  'acid-base': 'pH', solubility: 'Ksp', thermochemistry: 'ΔH', 'gas-laws': 'PV = nRT',
};
type TopicId = typeof topics[number]['id'];
function element<T extends Element>(id: string) {
  const item = document.getElementById(id); if (!item) throw new Error(`Missing calculator element: ${id}`); return item as unknown as T;
}
const menu = element<HTMLElement>('calculator-topics');
const mobileTopic = element<HTMLSelectElement>('calculator-topic');
const panels = element<HTMLElement>('calculator-panels');
const overview = element<HTMLElement>('calculator-home');
const layout = element<HTMLElement>('calculator-layout');
const amountChoices = element<HTMLElement>('calculator-amount-topics');
const modelChoices = element<HTMLElement>('calculator-model-topics');
const amountTopics = new Set<TopicId>(['moles', 'solutions', 'reactions', 'gas-laws']);
const back = element<HTMLButtonElement>('calculator-back');
const context = element<HTMLElement>('calculator-context');
const compoundSelect = element<HTMLSelectElement>('calculator-compound');
const notice = element<HTMLElement>('calculator-compound-notice');
const topicButtons = new Map<TopicId, HTMLButtonElement>();
const sections = new Map<TopicId, HTMLElement>();
const initializers = new Map<TopicId, () => void>();
const initialized = new Set<TopicId>();
const compoundRecords = new Map<string, CalculatorCompound>();
const manual = document.createElement('option'); manual.value = ''; manual.textContent = 'Manual entry'; compoundSelect.append(manual);
for (const molecule of molecules) {
  const compound = calculatorCompoundFromMolecule(molecule, isIonicCompound(molecule));
  compoundRecords.set(compound.id, compound);
  const option = document.createElement('option'); option.value = compound.id; option.textContent = `${compound.name} (${compound.formula})`; compoundSelect.append(option);
}
for (const topic of topics) {
  const card = document.createElement('button'); card.type = 'button'; card.className = 'calculator-choice';
  const symbol = document.createElement('span'); symbol.className = 'calculator-choice-symbol'; symbol.textContent = topicSymbols[topic.id]; symbol.setAttribute('aria-hidden', 'true');
  const title = document.createElement('strong'); title.textContent = topic.name;
  const description = document.createElement('span'); description.className = 'calculator-choice-description'; description.textContent = topic.description;
  const action = document.createElement('span'); action.className = 'calculator-choice-action'; action.textContent = 'Open calculator →';
  card.append(symbol, title, description, action);
  card.addEventListener('click', () => { selectTopic(topic.id); element<HTMLElement>('calculator-title').focus(); });
  (amountTopics.has(topic.id) ? amountChoices : modelChoices).append(card);
  const button = document.createElement('button'); button.type = 'button'; button.textContent = topic.name;
  button.setAttribute('aria-controls', `calculator-panel-${topic.id}`); button.addEventListener('click', () => selectTopic(topic.id));
  menu.append(button); topicButtons.set(topic.id, button);
  const option = document.createElement('option'); option.value = topic.id; option.textContent = topic.name; mobileTopic.append(option);
  const section = document.createElement('section'); section.id = `calculator-panel-${topic.id}`;
  section.hidden = true; section.setAttribute('aria-label', topic.name); panels.append(section); sections.set(topic.id, section);
  const copy = document.createElement('div'); copy.className = 'copy-result';
  panels.after(copy); copy.hidden = true;
  const copyButton = mountCopyResult(copy, 'Copy calculator result', () => {
    const result = section.querySelector<HTMLElement>('.calc-result:not([hidden]), .solution-output:not([hidden]), .calculator-output:not([hidden])');
    if (!result || !result.innerText.trim()) return null;
    const notes = [...section.querySelectorAll<HTMLElement>('.calc-note, .solution-caption')].map(node => node.innerText.trim()).filter(Boolean);
    return [`${topic.name} · ${topic.model}`, result.innerText.trim(), ...notes, 'Calculated from entered values; check assumptions and units.'].join('\n');
  });
  const updateCopyAvailability = () => {
    const result = section.querySelector<HTMLElement>('.calc-result:not([hidden]), .solution-output:not([hidden]), .calculator-output:not([hidden])');
    copyButton.disabled = !result || !result.textContent?.trim() || Boolean(result.parentElement?.closest('[hidden]'));
  };
  copyButton.disabled = true;
  new MutationObserver(updateCopyAvailability).observe(section, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden'] });
  copy.dataset.copyControl = topic.id;
}
const molePanel = new MoleCalculatorPanel(sections.get('moles')!);
const solutionHost = document.createElement('details'); solutionHost.id = 'hub-solution-calculator'; solutionHost.open = true;
sections.get('solutions')!.append(solutionHost);
const solutionPanel = new SolutionCalculatorPanel(solutionHost);
initialized.add('moles'); initialized.add('solutions');
initializers.set('reactions', () => mountReactionAmounts(sections.get('reactions')!));
initializers.set('equilibrium', () => mountEquilibriumCalculator(sections.get('equilibrium')!));
initializers.set('acid-base', () => mountAcidBaseCalculator(sections.get('acid-base')!));
initializers.set('solubility', () => mountSolubilityCalculator(sections.get('solubility')!));
initializers.set('thermochemistry', () => mountThermochemistry(sections.get('thermochemistry')!));
initializers.set('gas-laws', () => mountGasLaws(sections.get('gas-laws')!));

function setCompound(compound?: CalculatorCompound) {
  molePanel.setCompound(compound); solutionPanel.setCompound(compound);
  notice.textContent = compound ? `${compound.name} · exact compound mass${compound.molarMass ? ` ${compound.molarMass} g/mol` : ' unavailable; enter manually'}` : '';
}
compoundSelect.addEventListener('change', () => setCompound(compoundRecords.get(compoundSelect.value)));
mobileTopic.addEventListener('change', () => selectTopic(mobileTopic.value as TopicId));
function selectTopic(id: TopicId, updateHistory = true) {
  const topic = topics.find((item) => item.id === id); if (!topic) return;
  overview.hidden = true; layout.hidden = false;
  element<HTMLElement>('calculator-title').textContent = topic.name;
  element<HTMLElement>('calculator-description').textContent = topic.description;
  element<HTMLElement>('calculator-model').textContent = topic.model;
  for (const [key, section] of sections) section.hidden = key !== id;
  for (const node of panels.parentElement!.querySelectorAll<HTMLElement>('.copy-result')) node.hidden = node.dataset.copyControl !== id;
  for (const [key, button] of topicButtons) button.setAttribute('aria-pressed', String(key === id));
  mobileTopic.value = id; context.hidden = id !== 'moles' && id !== 'solutions';
  if (!initialized.has(id)) { initializers.get(id)?.(); initialized.add(id); }
  // Allow bookmarking a calculator without sharing any entered quantities.
  if (updateHistory && location.hash !== `#${id}`) try { history.pushState(null, '', `#${id}`); } catch { /* Selection still works without History API. */ }
}

function showOverview(updateHistory = true) {
  overview.hidden = false; layout.hidden = true;
  if (updateHistory && location.hash) try { history.pushState(null, '', location.pathname + location.search); } catch { /* Navigation remains usable. */ }
}
back.addEventListener('click', () => { showOverview(); element<HTMLElement>('calculator-home-title').focus(); });

let transferred: CalculatorCompound | undefined;
try {
  const raw = sessionStorage.getItem(CALCULATOR_TRANSFER_KEY);
  transferred = decodeCalculatorTransfer(raw);
  sessionStorage.removeItem(CALCULATOR_TRANSFER_KEY);
  if (raw && !transferred) notice.textContent = 'Compound transfer unavailable. Select a compound or enter values manually.';
} catch { notice.textContent = 'Compound transfer unavailable in this browser. Manual entry still works.'; }
if (transferred) {
  const reviewed = compoundRecords.get(transferred.id);
  // Reuse a catalog option only for the exact identity, not a matching formula/name.
  if (reviewed && reviewed.cid === transferred.cid && reviewed.structure === transferred.structure) transferred = reviewed;
  else {
    const key = `transferred:${transferred.id}`;
    compoundRecords.set(key, transferred);
    const option = document.createElement('option'); option.value = key; option.textContent = `${transferred.name} (transferred compound)`; compoundSelect.append(option);
    compoundSelect.value = key;
  }
  if (transferred === reviewed) compoundSelect.value = transferred.id;
  setCompound(transferred);
}
let transferNeedsInitialTopic = Boolean(transferred);
function selectHashTopic() {
  const requested = location.hash.slice(1);
  if (topics.some((topic) => topic.id === requested)) selectTopic(requested as TopicId, false);
  else if (transferNeedsInitialTopic) selectTopic('moles', false);
  else showOverview(false);
  transferNeedsInitialTopic = false;
}
window.addEventListener('hashchange', selectHashTopic);
window.addEventListener('popstate', selectHashTopic);
selectHashTopic();
