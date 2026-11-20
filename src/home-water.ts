type WaterViewer = {
  addModel: (data: string, format: string) => unknown;
  setStyle: (selection: Record<string, never>, style: Record<string, unknown>) => unknown;
  zoomTo: () => unknown;
  rotate: (degrees: number, axis: string) => unknown;
  render: () => unknown;
};

type ViewerFactory = {
  createViewer: (host: HTMLElement, options: Record<string, unknown>) => WaterViewer;
};

async function loadRenderer(): Promise<ViewerFactory> {
  const globals = window as unknown as { $3Dmol?: ViewerFactory };
  if (globals.$3Dmol) return globals.$3Dmol;

  const script = document.createElement('script');
  script.src = 'https://3dmol.org/build/3Dmol-min.js';
  try {
    await new Promise<void>((resolve, reject) => {
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Could not load the 3D renderer.'));
      document.head.append(script);
    });
    if (!globals.$3Dmol) throw new Error('The 3D renderer is unavailable.');
    return globals.$3Dmol;
  } finally {
    script.remove();
  }
}

async function prepareViewer(stage: HTMLElement) {
  const response = await fetch('/molecules/water-reference.sdf');
  if (!response.ok) throw new Error('Could not load the water model.');
  const structure = await response.text();
  const factory = await loadRenderer();

  const host = document.createElement('div');
  host.className = 'home-water-model';
  host.setAttribute('aria-hidden', 'true');
  stage.append(host);
  try {
    const viewer = factory.createViewer(host, {
      antialias: true,
      backgroundAlpha: 0,
      minimumZoomToDistance: 1.33,
    });
    viewer.addModel(structure, 'sdf');
    viewer.setStyle({}, { stick: { colorscheme: 'Jmol', radius: 0.12 }, sphere: { colorscheme: 'Jmol', scale: 0.37 } });
    viewer.zoomTo();
    viewer.rotate(6, 'z');
    viewer.render();
  } catch (error) {
    host.remove();
    throw error;
  }
}

export function mountWaterRotation(stage: HTMLElement) {
  function load() {
    void prepareViewer(stage).then(() => {
      stage.classList.add('has-live-model');
      stage.title = 'Drag to rotate · scroll or pinch to zoom';
    }).catch(() => {
      // Keep the still visible and retry if the user interacts with it.
      stage.addEventListener('pointerdown', load, { once: true });
    });
  }

  load();
}
