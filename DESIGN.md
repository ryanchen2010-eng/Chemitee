# Molecule Playground

## Studio Notebook

Home gives the chemistry tools a single starting point beside a real water model. Working pages lead with the task and put provenance, calculation assumptions, and advanced controls next to the result they qualify. Reaction Lab uses a Reactants, Pathway, Result order on every screen.

- **Type.** Mona Sans for the interface. Geist Mono for chemical formulas, equations, and specimen values. Serve the fonts and their licenses from `public/fonts`.
- **Appearance.** Warm paper, white panels, a blush specimen background, and raspberry actions. Dark mode uses the same layout, component shapes, and typography over near-black with a fine, static star field. Semantic foreground and surface tokens maintain legibility in both modes. The user selects dark mode from the shared header.
- **Layout.** One responsive header, with a compact menu when space runs short. Use plainly labeled native controls. Keep the search, drawing, reaction inputs, or calculator topic close to the top of the page, with help available from the header and feedback in the footer and mobile menu.
- **State.** Distinguish current and error states with labels as well as color. Keep focus visible and use native details and dialogs for supporting information. Preserve keyboard and touch choices for camera and atom interactions. Motion is limited to feedback and brief reveals, with reduced-motion support.
- **Scientific surfaces.** Explorer and Builder use the active appearance for their 3D viewer backgrounds. Ketcher and 2D diagrams use light drawing paper. Preserve the app's colors for element, atom, and bond meaning.

`src/ui-system.css` defines shared tokens and control states. `src/workspace-shell.ts` and `src/workspace-shell.css` provide shared navigation, responsive layout, and appearance controls. Tool CSS handles the composition of the existing inputs and output surfaces.

The Home image at `public/molecules/water-home.png` is a transparent capture of the project's 3Dmol.js rendering of `public/molecules/water-reference.sdf`. The image stays visible while the live preview loads. The preview uses the same mouse and touch gestures as the other viewers. The source file documents the idealized geometry and its references.
