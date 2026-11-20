import './styles.css';
import './bond-measurements.css';
import './solution-calculator.css';
import { explorerSamples, findMolecules, isIonicCompound, moleculeFromPubChem, normalizeQuery, type Molecule, type PubChemMatch } from './molecules';
import { renderMoleculeInformation } from './explorer-description';
import { BondMeasurements, type MeasurementAtom, type MeasurementViewer } from './bond-measurements';
import { SolutionCalculatorPanel } from './solution-calculator-panel';
import { solutionCompoundFromMolecule } from './solution-compound';
import { CALCULATOR_TRANSFER_KEY, calculatorCompoundFromMolecule, encodeCalculatorTransfer } from './calculator-compound';
import { createThemedViewer, mountViewerControls, type CameraViewer, type ViewerAppearance } from './viewer-controls';
import { renderChemicalFormula } from './formula-display';
import './ui-system.css';
import { mountWorkspaceShell } from './workspace-shell';
import { resolveExplorerStructure, type StructureProvenance } from './explorer-structure-resolver';
import { rhodiumUnitCell, rhodiumCellMatchesRenderer, RHODIUM_CELL_VECTORS } from './crystal-unit-cell';
import { mountCopyResult } from './copy-result';
import './workspace-shell.css';

type Viewer = MeasurementViewer & CameraViewer & ViewerAppearance & {
  removeAllModels: () => void;
  removeAllSurfaces: () => void;
  removeAllLabels: () => void;
  removeAllShapes: () => void;
  addModel: (data: string, format: string, options?: Record<string, unknown>) => { selectedAtoms: (selection: Record<string, never>) => MeasurementAtom[] };
  addUnitCell: (model: unknown) => unknown;
  setStyle: (selection: Record<string, never>, style: Record<string, unknown>) => void;
  zoomTo: () => void;
  render: () => void;
};

declare global {
  interface Window {
    $3Dmol?: {
      createViewer: (element: HTMLElement, options: Record<string, unknown>) => Viewer;
    };
  }
}

function mustElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Required element was not found: ${selector}`);
  return element;
}

const app = mustElement<HTMLDivElement>('#app');

app.innerHTML = `
  <a class="skip-link" href="#explorer-workspace">Skip to workspace</a>
  <main class="shell" id="main-content" tabindex="-1">
    <header class="hero">
      <div>
        <h1>Explorer</h1>
        <p class="hero-copy">Search a compound. Explore its shape and properties.</p>
      </div>
      <div class="hero-mark" aria-hidden="true">
        <span></span><span></span><span></span>
      </div>
      <nav class="hero-nav" aria-label="Project pages">
        <a class="builder-link" href="/">Home</a>
        <a class="builder-link is-current" href="/explore.html" aria-current="page">Explore</a>
        <a class="builder-link" href="/builder.html">Builder</a>
        <a class="builder-link" href="/reaction-lab.html">Reaction Lab</a>
        <a class="builder-link" href="/calculators.html">Calculators</a>
      </nav>
    </header>

    <section id="explorer-workspace" class="workspace" aria-label="Interactive molecule explorer" tabindex="-1">
      <aside class="library">
        <div class="section-heading">
          <h2>Find a molecule</h2>
        </div>
        <form id="molecule-search-form" class="molecule-search" role="search">
          <label for="molecule-search">Search by name or formula</label>
          <div class="molecule-search__controls">
            <input id="molecule-search" type="search" placeholder="Water, caffeine, H₂O…" autocomplete="off" />
            <button type="submit">Search</button>
          </div>
          <p id="search-status" role="status">${explorerSamples.length} sample molecules. Search PubChem for more.</p>
          <details class="search-help"><summary>Search tips</summary><p>Use a full name or correctly capitalized formula. Brackets distinguish structures with the same formula. Searches use PubChem. Ionic compounds show information only; some other compounds have a 2D view.</p></details>
        </form>
        <details class="molecule-results">
          <summary>Browse molecules</summary>
          <p class="molecule-list-hint">Scroll the list for more compounds.</p>
          <div id="molecule-list" class="molecule-list"></div>
        </details>
      </aside>

      <section class="viewer-panel">
        <div class="viewer-toolbar">
          <div>
            <h2 id="molecule-title"></h2>
            <p id="category" class="viewer-category"></p>
          </div>
          <div id="formula" class="formula" aria-label="Molecular formula"></div>
        </div>

        <p id="ionic-notice" class="ionic-notice" role="status" hidden></p>
        <div id="crystal-controls" class="crystal-controls" hidden aria-label="Structure view">
          <button type="button" id="crystal-info" aria-pressed="true">Compound information</button>
          <button type="button" id="crystal-view" aria-pressed="false">View crystal unit cell</button>
        </div>
        <div class="viewer-stage">
          <div id="molecule-viewer" aria-label="Interactive 3D molecule viewer"></div>
          <div id="molecule-fallback" class="molecule-fallback" hidden>
            <img id="molecule-fallback-image" alt="" />
            <p>PubChem 2D depiction · no 3D model available here</p>
          </div>
          <div id="viewer-status" class="viewer-status" role="status">
            Preparing the 3D viewer…
          </div>
          <div id="viewer-hint" class="viewer-hint">Drag to rotate · scroll to zoom · right-drag to move</div>
        </div>
        <section id="structure-provenance" class="ionic-notice structure-provenance" aria-label="Structure information" hidden></section>
        <div id="explorer-measurements" hidden></div>

        <div class="details">
          <section id="molecule-information" class="molecule-information" aria-labelledby="molecule-information-heading"></section>
          <details id="explorer-solution-calculator"></details>
          <div class="explorer-transfer" aria-label="Use this compound in Calculators">
            <button type="button" id="open-in-calculators">Open in Calculators →</button>
            <span id="calculator-transfer-status" role="status"></span>
          </div>
          <details class="explorer-transfer-options"><summary>Use in Reaction Lab</summary>
            <div class="explorer-transfer" aria-label="Use this compound in Reaction Lab">
              <button type="button" data-reaction-slot="0">Use as molecule 1</button>
              <button type="button" data-reaction-slot="1">Use as molecule 2</button>
            </div>
          </details>
        </div>
      </section>
    </section>
  </main>
`;

mountWorkspaceShell(mustElement<HTMLElement>('.shell'));

const moleculeList = mustElement<HTMLDivElement>('#molecule-list');
const moleculeResults = mustElement<HTMLDetailsElement>('.molecule-results');
moleculeResults.open = window.matchMedia('(min-width: 721px)').matches;
const searchForm = mustElement<HTMLFormElement>('#molecule-search-form');
const searchInput = mustElement<HTMLInputElement>('#molecule-search');
const searchStatus = mustElement<HTMLParagraphElement>('#search-status');
const moleculeTitle = mustElement<HTMLHeadingElement>('#molecule-title');
const category = mustElement<HTMLParagraphElement>('#category');
const formula = mustElement<HTMLDivElement>('#formula');
const moleculeInformation = mustElement<HTMLElement>('#molecule-information');
const viewerStage = mustElement<HTMLDivElement>('.viewer-stage');
const ionicNotice = mustElement<HTMLParagraphElement>('#ionic-notice');
const crystalControls = mustElement<HTMLDivElement>('#crystal-controls');
const crystalInfo = mustElement<HTMLButtonElement>('#crystal-info');
const crystalView = mustElement<HTMLButtonElement>('#crystal-view');
const structureProvenance = mustElement<HTMLElement>('#structure-provenance');

function showStructureInformation(title: string, subtitle: string, detailText: string, sourceUrl?: string) {
  structureProvenance.replaceChildren();
  const heading = document.createElement('strong');
  heading.className = 'structure-provenance-title';
  heading.textContent = title;
  const description = document.createElement('span');
  description.className = 'structure-provenance-subtitle';
  description.textContent = subtitle;
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = 'Source, method and limitations';
  const text = document.createElement('p');
  text.textContent = detailText;
  details.append(summary, text);
  if (sourceUrl) {
    const source = document.createElement('a');
    source.href = sourceUrl; source.target = '_blank'; source.rel = 'noopener noreferrer'; source.textContent = 'Source reference';
    details.append(source);
  }
  structureProvenance.append(heading, description, details);
  structureProvenance.hidden = false;
}

function showMolecularProvenance(provenance: StructureProvenance) {
  const labels: Record<StructureProvenance['kind'], string> = {
    experimental: 'Experimental reference-derived geometry',
    calculated: 'Calculated molecular model',
    idealized: 'Idealized molecular model',
    unknown: 'Molecular model · source unconfirmed',
  };
  showStructureInformation(labels[provenance.kind], `${provenance.source} · ${provenance.physicalForm}`,
    `Method: ${provenance.method}; convergence: ${provenance.convergence}. ${provenance.limitations}`, provenance.sourceUrl);
}
const viewerStatus = mustElement<HTMLDivElement>('#viewer-status');
const fallbackView = mustElement<HTMLDivElement>('#molecule-fallback');
const fallbackImage = mustElement<HTMLImageElement>('#molecule-fallback-image');
const viewerHint = mustElement<HTMLDivElement>('#viewer-hint');
const transferButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-reaction-slot]')];
const EXPLORER_TRANSFER_KEY = 'molecule-playground.explorer-reactant.v1';

const buttons = new Map<string, HTMLButtonElement>();
let displayedMolecules: Molecule[] = [...explorerSamples];
let searchRevision = 0;

function renderMoleculeCards(items: Molecule[], emptyMessage = 'No molecule found. Try a full name or correctly capitalized formula.') {
  displayedMolecules = items;
  moleculeList.replaceChildren();
  buttons.clear();
  const formulaCounts = new Map<string, number>();
  for (const molecule of items) {
    const key = normalizeQuery(molecule.formula);
    formulaCounts.set(key, (formulaCounts.get(key) ?? 0) + 1);
  }
  for (const molecule of items) {
    const button = document.createElement('button');
    button.className = 'molecule-card';
    button.type = 'button';
    button.dataset.moleculeId = molecule.id;
    const formulaBadge = document.createElement('span');
    formulaBadge.className = 'molecule-card__formula';
    renderChemicalFormula(formulaBadge, molecule.formula);
    const text = document.createElement('span');
    text.className = 'molecule-card__text';
    const name = document.createElement('strong');
    name.textContent = molecule.name;
    const detail = document.createElement('small');
    const sameFormula = (formulaCounts.get(normalizeQuery(molecule.formula)) ?? 0) > 1;
    detail.textContent = sameFormula && molecule.structureForm
      ? `[${molecule.structureForm}] · ${molecule.category}`
      : molecule.category;
    if (sameFormula && molecule.structureForm) detail.title = 'Bracketed SMILES notation shows this molecule’s atom connections.';
    text.append(name, detail);
    const arrow = document.createElement('span');
    arrow.className = 'molecule-card__arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '→';
    button.append(formulaBadge, text, arrow);
    moleculeList.append(button);
    buttons.set(molecule.id, button);
  }
  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'molecule-list__empty';
    empty.textContent = emptyMessage;
    moleculeList.append(empty);
  }
}

renderMoleculeCards(explorerSamples);

const viewerHost = mustElement<HTMLDivElement>('#molecule-viewer');
const viewerFactory = window.$3Dmol;
const viewer = viewerFactory ? createThemedViewer(viewerHost, viewerFactory) : undefined;
const measurements = new BondMeasurements(mustElement<HTMLElement>('#explorer-measurements'), viewer);
const cameraControls = mountViewerControls(mustElement<HTMLElement>('.viewer-stage'), viewer, true);
const solutionCalculator = new SolutionCalculatorPanel(mustElement<HTMLDetailsElement>('#explorer-solution-calculator'));

let activeMoleculeId = '';
let activeMolecule: Molecule | null = null;
const copyMolecule = document.createElement('div');
copyMolecule.className = 'copy-result';
mustElement<HTMLElement>('#structure-provenance').after(copyMolecule);
mountCopyResult(copyMolecule, 'Copy name and formula', () => activeMolecule ? `${activeMolecule.name} (${activeMolecule.formula})` : null);
let loadSequence = 0;
let modelReady = false;
let depictionUrl: string | null = null;

async function showMolecule(molecule: Molecule) {
  activeMolecule = molecule;
  solutionCalculator.setCompound(solutionCompoundFromMolecule(molecule));
  if (activeMoleculeId === molecule.id && modelReady) {
    for (const [id, button] of buttons) {
      button.classList.toggle('is-active', id === molecule.id);
      button.setAttribute('aria-pressed', String(id === molecule.id));
    }
    return;
  }

  activeMoleculeId = molecule.id;
  modelReady = false;
  cameraControls.setEnabled(false);
  const sequence = ++loadSequence;
  measurements.reset();

  for (const [id, button] of buttons) {
    const selected = id === molecule.id;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-pressed', String(selected));
    button.disabled = true;
  }

  category.textContent = molecule.category;
  moleculeTitle.textContent = molecule.name;
  renderChemicalFormula(formula, molecule.formula);
  renderMoleculeInformation(moleculeInformation, molecule);

  const ionic = isIonicCompound(molecule);
  const hasCrystal = molecule.origin === 'pubchem' && molecule.cid === 24872;
  crystalControls.hidden = !hasCrystal;
  crystalInfo.setAttribute('aria-pressed', 'true');
  crystalView.setAttribute('aria-pressed', 'false');
  cameraControls.setVisible(!ionic);
  viewerStage.hidden = ionic;
  ionicNotice.hidden = !ionic;
  ionicNotice.textContent = ionic ? (molecule.cid === 24872
    ? 'This rhodium chloride record contains separate charged fragments. No verified discrete molecular 3D model is available; you can separately view a referenced anhydrous RhCl₃ crystal unit cell.'
    : 'This record is treated as an ionic assembly. The Explorer shows compound information rather than a molecular 3D model; this does not mean the compound has no physical structure.') : '';
  structureProvenance.hidden = true;
  structureProvenance.replaceChildren();

  viewerStatus.textContent = `Loading ${molecule.name}…`;
  viewerStatus.classList.remove('is-hidden', 'is-error');
  fallbackView.hidden = true;
  fallbackImage.removeAttribute('src');
  if (depictionUrl) URL.revokeObjectURL(depictionUrl);
  depictionUrl = null;
  viewerHint.textContent = 'Drag to rotate · scroll to zoom · right-drag to move';

  try {
    if (ionic) {
      // This information-only path must not depend on a working WebGL viewer.
      try {
        viewer?.removeAllModels();
        viewer?.removeAllSurfaces();
        viewer?.removeAllLabels();
        viewer?.removeAllShapes();
      } catch {
        // Hidden viewer cleanup cannot trigger a diagram request for an ionic record.
      }
      modelReady = true;
      viewerStatus.textContent = '';
      return;
    }
    viewer?.removeAllModels();
    viewer?.removeAllSurfaces();
    viewer?.removeAllLabels();
    viewer?.removeAllShapes();
    viewer?.render();
    if (!viewer) throw new Error('3Dmol.js did not load. Check the network connection.');
    const { structure, provenance } = await resolveExplorerStructure(molecule);

    if (sequence !== loadSequence) return;

    viewer.removeAllSurfaces();
    viewer.removeAllLabels();
    viewer.removeAllShapes();
    const model = viewer.addModel(structure, 'sdf');
    viewer.setStyle({}, { stick: { colorscheme: 'Jmol', radius: 0.1 }, sphere: { scale: 0.25 } });
    viewer.zoomTo();
    // The compact water reference otherwise occupies very little of the stage.
    if (molecule.cid === 962) viewer.zoom?.(1.4);
    measurements.setAtoms(model.selectedAtoms({}));
    viewer.render();
    modelReady = true;

    showMolecularProvenance(provenance);

    cameraControls.setEnabled(true);

    if (sequence === loadSequence) {
      viewerStatus.textContent = `${molecule.name} ready`;
      window.setTimeout(() => {
        if (sequence === loadSequence) viewerStatus.classList.add('is-hidden');
      }, 700);
    }
  } catch (error) {
    if (sequence !== loadSequence) return;
    measurements.reset();
    if (molecule.origin === 'pubchem') {
      try {
        const response = await fetch(`/api/pubchem/depiction?cid=${molecule.cid}`);
        if (!response.ok) throw new Error('Neither a 3D model nor a 2D depiction is available for this compound.');
        const blob = await response.blob();
        if (sequence !== loadSequence) return;
        depictionUrl = URL.createObjectURL(blob);
        fallbackImage.src = depictionUrl;
        fallbackImage.alt = `PubChem 2D depiction of ${molecule.name}`;
        fallbackView.hidden = false;
        viewerHint.textContent = '2D reference · rotation is unavailable';
        viewerStatus.textContent = molecule.cid === 24872
          ? 'Rhodium chloride: PubChem has no supported 3D conformer, and its solid is an extended crystal. No verified discrete molecular 3D model is available here; showing the 2D record.'
          : 'A 3D model could not be loaded or generated for this record. Showing PubChem’s 2D depiction; this does not mean the compound has no 3D structure.';
        modelReady = true;
        return;
      } catch (fallbackError) {
        if (sequence !== loadSequence) return;
        error = fallbackError;
      }
    }
    console.error(error);
    modelReady = false;
    viewerStatus.textContent = error instanceof Error ? error.message : `Could not load ${molecule.name}.`;
    viewerStatus.classList.add('is-error');
  } finally {
    if (sequence === loadSequence) {
      for (const button of buttons.values()) button.disabled = false;
    }
  }
}

crystalInfo.addEventListener('click', () => {
  if (!activeMolecule || crystalInfo.getAttribute('aria-pressed') === 'true') return;
  modelReady = false;
  void showMolecule(activeMolecule);
});

crystalView.addEventListener('click', async () => {
  if (!activeMolecule || activeMolecule.origin !== 'pubchem' || activeMolecule.cid !== 24872) return;
  const sequence = ++loadSequence;
  modelReady = false;
  measurements.reset();
  crystalInfo.setAttribute('aria-pressed', 'false');
  crystalView.setAttribute('aria-pressed', 'true');
  viewerStage.hidden = false;
  ionicNotice.hidden = true;
  structureProvenance.hidden = true;
  fallbackView.hidden = true;
  cameraControls.setVisible(true);
  cameraControls.setEnabled(false);
  viewerStatus.classList.remove('is-hidden', 'is-error');
  viewerStatus.textContent = 'Loading the crystal unit cell…';
  try {
    if (!viewer) throw new Error('3D viewer unavailable.');
    const response = await fetch('/crystals/rhodium-trichloride-cod-1534198.cif');
    if (!response.ok) throw new Error('Crystal reference is unavailable.');
    const cif = await response.text();
    if (sequence !== loadSequence) return;
    viewer.removeAllModels(); viewer.removeAllSurfaces(); viewer.removeAllLabels(); viewer.removeAllShapes();
    const expandedCif = rhodiumUnitCell(cif);
    const model = viewer.addModel(expandedCif, 'cif', { assignBonds: false });
    const atoms = model.selectedAtoms({});
    if (atoms.length !== 16 || atoms.filter(atom => atom.elem === 'Rh').length !== 4 || atoms.some(atom => ![atom.x, atom.y, atom.z].every(Number.isFinite))) throw new Error('Crystal symmetry could not be displayed reliably.');
    viewer.setStyle({}, { sphere: { colorscheme: 'Jmol', scale: 0.28 } });
    viewer.addUnitCell(model);
    viewer.zoomTo();
    measurements.setAtoms(atoms);
    const periodicAvailable = rhodiumCellMatchesRenderer(expandedCif, atoms);
    if (periodicAvailable) measurements.setPeriodicBasis(RHODIUM_CELL_VECTORS);
    viewer.render();
    modelReady = true;
    showStructureInformation('Crystal unit cell · experimental structure', 'Anhydrous RhCl₃ · monoclinic C 2/m · COD 1534198',
      `Bärnighausen and Handa (1964), X-ray structure. Unit-cell atoms are symmetry-generated; this is an extended solid, not a discrete molecule or hydrated sample. ${periodicAvailable ? 'Distance measurements can use a manually selected neighboring cell image; the nearest image is not chosen automatically. Angles and torsions use displayed atoms only.' : 'Periodic image measurements are unavailable because the displayed cell coordinates could not be verified; measurements use displayed atoms only.'} Layer stacking disorder is not represented.`,
      'https://www.crystallography.net/cod/1534198.html');
    viewerHint.textContent = 'Crystal unit cell · drag to rotate · scroll to zoom';
    viewerStatus.textContent = 'Crystal unit cell ready';
    cameraControls.setEnabled(true);
    window.setTimeout(() => { if (sequence === loadSequence) viewerStatus.classList.add('is-hidden'); }, 700);
  } catch (error) {
    if (sequence !== loadSequence) return;
    viewer?.removeAllModels(); viewer?.removeAllShapes(); viewer?.render();
    measurements.reset();
    viewerStatus.textContent = error instanceof Error ? error.message : 'Crystal view unavailable.';
    viewerStatus.classList.add('is-error');
  }
});

transferButtons.forEach((button) => button.addEventListener('click', () => {
  const molecule = activeMolecule;
  if (!molecule?.structureForm) {
    searchStatus.textContent = 'This compound has no structure to send to Reaction Lab.';
    return;
  }
  try {
    sessionStorage.setItem(EXPLORER_TRANSFER_KEY, JSON.stringify({
      slot: Number(button.dataset.reactionSlot), id: molecule.id, name: molecule.name,
      formula: molecule.formula, smiles: molecule.structureForm,
    }));
    window.location.assign('/reaction-lab.html');
  } catch {
    searchStatus.textContent = 'Browser storage is unavailable; this compound could not be sent to Reaction Lab.';
  }
}));

function openInCalculators() {
  const status = mustElement<HTMLElement>('#calculator-transfer-status');
  if (!activeMolecule) { status.textContent = 'Select a compound first.'; return; }
  try {
    const compound = calculatorCompoundFromMolecule(activeMolecule, isIonicCompound(activeMolecule));
    sessionStorage.setItem(CALCULATOR_TRANSFER_KEY, encodeCalculatorTransfer(compound));
    window.location.assign('/calculators.html#moles');
  } catch { status.textContent = 'Browser storage is unavailable. Open Calculators and select the compound manually.'; }
}
mustElement<HTMLButtonElement>('#open-in-calculators').addEventListener('click', openInCalculators);

moleculeList.addEventListener('click', (event) => {
  const target = (event.target as HTMLElement).closest<HTMLButtonElement>(
    '[data-molecule-id]',
  );
  if (!target) return;

  const molecule = displayedMolecules.find((item) => item.id === target.dataset.moleculeId);
  if (molecule) void showMolecule(molecule);
});

searchForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const query = searchInput.value.trim();
  const requestRevision = ++searchRevision;
  if (!query) {
    renderMoleculeCards(explorerSamples);
    searchStatus.textContent = `${explorerSamples.length} sample molecules. Search PubChem for more.`;
    return;
  }
  const local = findMolecules(query);
  moleculeResults.open = true;
  renderMoleculeCards(local, 'Searching PubChem…');
  searchStatus.textContent = 'Searching PubChem by name or formula…';
  try {
    const response = await fetch(`/api/pubchem/search?q=${encodeURIComponent(query)}`);
    const payload = await response.json() as { results: PubChemMatch[]; limited: boolean } | { error: string };
    if (requestRevision !== searchRevision) return;
    if (!response.ok || 'error' in payload) throw new Error('error' in payload ? payload.error : 'PubChem search failed.');
    const remote = payload.results.map(moleculeFromPubChem);
    const byCid = new Map(remote.map((item) => [item.cid, item]));
    const combined = [...local.map((item) => byCid.get(item.cid) ?? item), ...remote.filter((item) => !local.some((localItem) => localItem.cid === item.cid))];
    renderMoleculeCards(combined);
    searchStatus.textContent = combined.length
      ? `${combined.length} structure${combined.length === 1 ? '' : 's'} found${payload.limited ? ' (first results shown)' : ''}. Select a form to explore.`
      : 'No PubChem record found. Try a full name or correctly capitalized formula.';
    const exact = combined.filter((molecule) => [molecule.name, molecule.formula, molecule.id].some((value) => normalizeQuery(value) === normalizeQuery(query)));
    if (combined.length === 1 && exact.length === 1) void showMolecule(exact[0]);
  } catch (error) {
    if (requestRevision !== searchRevision) return;
    renderMoleculeCards(local);
    searchStatus.textContent = local.length
      ? 'PubChem is unavailable; showing saved matching compounds.'
      : error instanceof Error ? error.message : 'PubChem is unavailable. Try again later.';
  }
});

searchInput.addEventListener('input', () => {
  searchRevision += 1;
  if (!searchInput.value.trim()) {
    renderMoleculeCards(explorerSamples);
    searchStatus.textContent = `${explorerSamples.length} sample molecules. Search PubChem for more.`;
  }
});

await showMolecule(explorerSamples[0]);
