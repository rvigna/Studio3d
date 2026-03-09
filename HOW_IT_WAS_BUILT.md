# 🔨 How Studio3D Was Built

This document explains the technical design decisions, architecture patterns, and implementation details behind Studio3D — a browser-native 3D design and physics simulation tool.

---

## Table of Contents

- [Philosophy & Goals](#philosophy--goals)
- [Technology Choices](#technology-choices)
- [Project Structure](#project-structure)
- [Rendering Engine](#rendering-engine)
- [Physics Integration](#physics-integration)
- [UI Architecture](#ui-architecture)
- [State Management](#state-management)
- [Import / Export System](#import--export-system)
- [Library & Primitives System](#library--primitives-system)
- [Undo / Redo System](#undo--redo-system)
- [Scene Hierarchy & Selection](#scene-hierarchy--selection)
- [Screenshot & Video Capture](#screenshot--video-capture)
- [No-Build Philosophy](#no-build-philosophy)

---

## Philosophy & Goals

Studio3D was built with three guiding principles:

1. **Zero friction to start** — No installs, no bundlers, no build step. Open `index.html` and go.
2. **Single-file logic** — All application logic lives in `app.js` for easy reading, debugging, and portability.
3. **Real capabilities** — Despite its simplicity, deliver a full physics simulation and PBR rendering pipeline comparable to desktop tools.

---

## Technology Choices

### Three.js (v0.163.0) — 3D Rendering

Three.js was chosen as the rendering layer because it provides a mature, well-documented abstraction over WebGL while supporting:
- Physically-based rendering (PBR) via `MeshStandardMaterial`
- Built-in primitive geometries (Box, Sphere, Cylinder, Torus, etc.)
- Transform controls (`TransformControls`) for interactive object manipulation
- Camera orbit controls (`OrbitControls`)
- Format loaders for GLTF, OBJ, STL, PLY, and FBX
- Shadow mapping and multiple light types

Three.js is loaded as an ES module from a CDN (jsDelivr) using an **import map**, which means no bundler is needed:

```html
<script type="importmap">
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.163.0/build/three.module.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.163.0/examples/jsm/"
  }
}
</script>
```

### Cannon-ES (v0.20.0) — Physics Simulation

Cannon-ES is a maintained fork of Cannon.js providing rigid-body dynamics. It was selected because it:
- Works in the browser without WASM or native bindings
- Has a straightforward API for shapes, bodies, and constraints
- Supports sleep (allows idle bodies to pause computation)
- Supports joint constraints (hinge, distance, point-to-point) needed for demos like Newton's Cradle and the Robot Arm

### Vanilla JavaScript + CSS — UI Layer

No UI framework (React, Vue, Svelte) was used. Instead:
- DOM is structured in `index.html` with semantic IDs and classes
- CSS custom properties (variables) drive the entire design system
- JavaScript directly manipulates the DOM for panels, menus, and property inputs

This keeps the dependency count at zero and makes the codebase trivially debuggable in browser DevTools.

---

## Project Structure

```
Studio3D/
├── index.html      # Application shell, import map, and UI layout
├── app.js          # All application logic (~5,700 lines)
└── styles.css      # Dark-theme design system (~570 lines)
```

The intentional minimal structure is part of the design — there are no build artifacts, no `node_modules`, and no configuration files.

---

## Rendering Engine

### Scene Setup

On load, `app.js` creates the Three.js scene graph:

```javascript
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
```

Three lights are added by default:
- **Ambient light** — provides baseline illumination
- **Directional light** — casts shadows from above-right
- **Hemisphere light** — sky/ground gradient for natural look

### Animation Loop

The main loop runs at native refresh rate via `requestAnimationFrame`. Each frame it:
1. Steps the physics simulation (if running)
2. Updates visual positions from physics bodies
3. Updates pendulum string visuals and trail particles
4. Renders the scene
5. Updates the FPS counter

```javascript
function animate() {
  requestAnimationFrame(animate);
  if (physics.running) stepPhysics();
  renderer.render(scene, camera);
}
```

### Transform Controls

`TransformControls` (a Three.js add-on) provides the interactive move/rotate/scale gizmo. It is wired to listen for `dragging-changed` events to pause OrbitControls while transforming, preventing camera movement from conflicting with object movement.

---

## Physics Integration

### World Initialization

The Cannon-ES world is created with tuned defaults:

```javascript
physics.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
physics.world.broadphase = new CANNON.SAPBroadphase(physics.world);
physics.world.allowSleep = true;
physics.world.solver.iterations = 6;
physics.world.solver.tolerance = 0.1;
```

- **SAP Broadphase** (Sweep and Prune) is used instead of the default NaiveBroadphase — it scales better with many objects
- **Sleep** is enabled so resting objects pause computation
- **Solver tuning** balances accuracy and performance (6 iterations, 0.1 tolerance)

### Geometry → Collision Shape Mapping

Every Three.js geometry type is mapped to the closest Cannon-ES collision primitive:

| Three.js geometry | Cannon-ES shape |
|-------------------|-----------------|
| `BoxGeometry` | `CANNON.Box` |
| `SphereGeometry` | `CANNON.Sphere` |
| `CylinderGeometry` | `CANNON.Cylinder` |
| `ConeGeometry` | `CANNON.Cylinder` (top radius = 0) |
| `PlaneGeometry` | `CANNON.Box` (thin slab) |
| Groups / Other | Bounding-box `CANNON.Box` |

This mapping lives in `getPhysicsShape()` and reads the geometry parameters (width, height, radius, etc.) and the object's current scale to construct a correctly sized collision shape.

### Physics ↔ Three.js Sync

After each physics step, every physics-enabled object has its Three.js position and quaternion overwritten from the Cannon-ES body:

```javascript
physics.bodies.forEach((body, id) => {
  const obj = findObjectById(id);
  if (obj) {
    obj.position.copy(body.position);
    obj.quaternion.copy(body.quaternion);
  }
});
```

This one-way sync (physics → visual) means the physics engine is the source of truth during simulation.

### Play / Stop / Reset

- **Play**: Saves current transforms, creates physics bodies for all enabled objects, starts the animation loop physics step
- **Stop**: Removes all bodies and constraints, restores the saved transforms (effectively a rewind)
- **Reset**: Calls stop then re-applies saved transforms, allowing re-play from the same initial state

---

## UI Architecture

### Layout

The UI uses a flexbox layout with five regions:

```
┌──────────────── Title Bar ────────────────┐
├──────────────── Menu Bar ─────────────────┤
├─ Toolbar ─┬──── Viewport ────┬─ Properties ┤
│           │                  │             │
│  (left)   │   <canvas>       │  (right)    │
│           │                  │             │
├───────────┴──────────────────┴─────────────┤
└──────────────── Status Bar ────────────────┘
```

Pixel-exact sizes are defined in CSS variables:
- Title bar: 38 px
- Menu bar: 32 px
- Toolbar: 40 px
- Left / right panels: 260 px
- Status bar: 24 px

The `<canvas>` fills the remaining space and the Three.js renderer is resized whenever the window resizes.

### Property Inspector

The right panel's property inspector is entirely dynamically generated. When an object is selected, `showInspector(obj)` builds HTML input elements based on the object's `userData`:

- **Transform** — three `<input type="number">` fields for X/Y/Z per property
- **Material** — color picker, sliders for metalness/roughness/emissive, transparency toggle
- **Physics** — mass, friction, restitution, damping fields; body type radio buttons
- **Light** — intensity, distance, angle (spotlight), penumbra, decay fields

All inputs use `input` event listeners that write changes back to the Three.js object immediately, providing live feedback.

### Menus

Menus use CSS-driven dropdowns: a `.menu-item:hover .menu-dropdown` selector reveals child menus without any JavaScript toggle logic. Sub-menus use a nested `.submenu` class with `left: 100%` positioning.

---

## State Management

All mutable application state is stored in two plain JavaScript objects:

```javascript
const state = {
  objects: [],            // All scene objects (THREE.Mesh / THREE.Group)
  selected: null,         // Currently selected object
  multiSelected: [],      // Secondary selection (used for CSG)
  undoStack: [],
  redoStack: [],
  transformMode: 'translate',
  transformSpace: 'world',
  snap: false,
  snapValue: 1,
  ...
};

const physics = {
  world: null,            // CANNON.World instance
  running: false,
  bodies: new Map(),      // id → CANNON.Body
  savedTransforms: new Map(),
  constraints: [],
  ...
};
```

Because the application is single-page with no framework, state mutation is direct property assignment. UI and scene updates are triggered explicitly from event handlers rather than through reactive bindings.

---

## Import / Export System

### Dynamic Module Loading

Format-specific loaders and exporters (GLTF, OBJ, STL, PLY, FBX) are not imported at startup. Instead, they are loaded on demand using dynamic `import()`:

```javascript
async function loadModule(path) {
  return await import(path);
}

// Example usage
const { GLTFLoader } = await loadModule('three/addons/loaders/GLTFLoader.js');
```

This avoids startup failures if a particular loader module is unavailable and keeps initial load time minimal.

### Native JSON Format

Studio3D's own `.json` format serializes every scene object including:
- Geometry type and parameters
- Transform (position, rotation, scale)
- Material properties (color, metalness, roughness, emissive, opacity)
- Physics settings (mass, friction, restitution, damping, body type)
- Light type and properties
- Library item flags and custom names

Geometry is **reconstructed** on load from its type + parameters (e.g., `BoxGeometry` with `{width, height, depth}`) rather than serializing raw vertex data, keeping file sizes small.

For imported models (GLTF, OBJ, etc.) that cannot be reconstructed from parameters, the traversed mesh geometry's vertex positions and faces are stored directly.

---

## Library & Primitives System

### Primitives

The 13 built-in primitive shapes map directly to Three.js geometry constructors:

```javascript
function createGeometry(type, params) {
  switch (type) {
    case 'box':       return new THREE.BoxGeometry(...);
    case 'sphere':    return new THREE.SphereGeometry(...);
    case 'cylinder':  return new THREE.CylinderGeometry(...);
    // ...
  }
}
```

Each new object gets a `userData` object stamped with a unique incrementing ID, its geometry type, default physics settings, and display name.

### Library Items

The 13 library items (tanks, pipes, valves, vehicles, etc.) are procedurally constructed from groups of primitives. For example, a **Storage Tank** is a `THREE.Group` containing:
- A `CylinderGeometry` body
- Two `SphereGeometry` hemisphere caps
- Optionally, nozzle stubs built from smaller cylinders

All library items use a **factory pattern**: `buildLibraryItem(type)` returns a `THREE.Group`, which is then added to the scene and registered in `state.objects` like any other object.

---

## Undo / Redo System

Undo/redo is implemented as a snapshot stack. Before any mutating operation (add, delete, transform, property change), the entire scene state is serialized to a JSON string and pushed onto `state.undoStack`:

```javascript
function saveUndo() {
  const snapshot = JSON.stringify(serializeScene());
  state.undoStack.push(snapshot);
  if (state.undoStack.length > 50) state.undoStack.shift(); // cap at 50
  state.redoStack = [];
}
```

To undo, the last snapshot is popped and `deserializeScene()` fully rebuilds the scene from it. This approach trades memory for simplicity — no action-specific inverses need to be implemented.

---

## Scene Hierarchy & Selection

The scene tree panel in the right sidebar mirrors `state.objects`. Each time objects are added, removed, or renamed, `rebuildSceneTree()` clears and regenerates the list.

Selection state is tracked in `state.selected` (single) and `state.multiSelected` (array for CSG). Clicking an object in the viewport uses a Three.js `Raycaster` to find the intersected mesh, then walks up the object hierarchy to find the root scene object.

Context menus (right-click) are positioned at the mouse coordinate and list actions relevant to the current selection (duplicate, delete, group, focus, hide/show).

---

## Screenshot & Video Capture

### Screenshots

Screenshots use the `canvas.toDataURL('image/png')` API on the Three.js renderer's canvas, after calling `renderer.render(scene, camera)` explicitly to ensure the frame is flushed. The data URL is turned into a download link and clicked programmatically.

### Video Recording

Video recording uses the `MediaRecorder` API with the canvas stream:

```javascript
const stream = renderer.domElement.captureStream(60); // 60 FPS
const recorder = new MediaRecorder(stream, { mimeType: 'video/webm; codecs=vp9' });
recorder.ondataavailable = e => chunks.push(e.data);
recorder.onstop = () => {
  const blob = new Blob(chunks, { type: 'video/webm' });
  // trigger download
};
recorder.start();
```

Recording runs until the user stops it, capturing the live canvas including any running physics simulation at up to 60 FPS.

---

## No-Build Philosophy

Studio3D deliberately avoids any build toolchain. This was achieved through:

1. **Import maps** — allow bare specifiers (`import * as THREE from 'three'`) to resolve to CDN URLs without a bundler
2. **ES modules** — native browser feature, no transpilation needed
3. **Dynamic `import()`** — lazy-loads format-specific loaders only when used
4. **CDN delivery** — Three.js, Cannon-ES, Font Awesome, and Inter font are all fetched from jsDelivr / Google Fonts

The result is a tool that anyone can fork, read, and modify with nothing more than a text editor and a browser.

---

*Built by [Rodrigo Vigna](mailto:rvigna@outlook.com)*
