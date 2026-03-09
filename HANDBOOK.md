# 📘 Studio3D — User Handbook

> A practical, step-by-step guide to designing 3D scenes, running physics simulations, and exporting your work in Studio3D.

**Author:** Rodrigo Vigna · [rvigna@outlook.com](mailto:rvigna@outlook.com)  
**Version:** Studio3D 1.0 · Three.js v0.163.0 · Cannon-ES v0.20.0

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Getting Started](#2-getting-started)
3. [Interface Overview](#3-interface-overview)
4. [Working with Objects](#4-working-with-objects)
5. [Transforming Objects](#5-transforming-objects)
6. [Materials & Appearance](#6-materials--appearance)
7. [Lighting](#7-lighting)
8. [Physics Simulation](#8-physics-simulation)
9. [Physics Demos](#9-physics-demos)
10. [Import & Export](#10-import--export)
11. [Saving & Loading Scenes](#11-saving--loading-scenes)
12. [Capture: Screenshots & Video](#12-capture-screenshots--video)
13. [Keyboard Shortcuts Reference](#13-keyboard-shortcuts-reference)
14. [Tutorials](#14-tutorials)
15. [Tips & Best Practices](#15-tips--best-practices)
16. [Troubleshooting & FAQ](#16-troubleshooting--faq)

---

## 1. Introduction

Studio3D is a **browser-native 3D design and physics simulation tool**. It runs entirely inside a web browser — no installation, no build step, and no plugins required. Open `index.html` and you are ready to model.

### What you can do with Studio3D

| Capability | Details |
|------------|---------|
| **3D Modeling** | 13 primitive shapes + 13 pre-built library objects |
| **Real-Time Physics** | Rigid-body dynamics, collisions, joints, and 8 interactive demos |
| **PBR Rendering** | Physically-based materials, dynamic shadows, multiple light types |
| **Multi-Format I/O** | Import 6 formats, export 7 formats (GLTF, OBJ, STL, PLY, FBX, JSON) |
| **Capture** | PNG screenshots and WebM video recording at 60 FPS |
| **Undo/Redo** | Full scene-snapshot undo history (up to 50 steps) |

### Who is this handbook for?

This handbook is aimed at **new and intermediate users** who want a practical, task-oriented guide. If you are looking for technical implementation details, see [HOW_IT_WAS_BUILT.md](HOW_IT_WAS_BUILT.md). For a feature reference, see [README.md](README.md).

---

## 2. Getting Started

### System Requirements

| Browser | Support |
|---------|---------|
| Google Chrome / Microsoft Edge | ✅ Recommended |
| Mozilla Firefox | ✅ Full support |
| Apple Safari | ✅ Full support (some video codecs may differ) |
| Mobile browsers | ⚠️ Limited — desktop interface not touch-optimized |

An internet connection is required on first load to fetch Three.js and Cannon-ES from CDN. Subsequent loads may use the browser cache.

### Launching the Application

1. **Clone or download** the repository.
2. **Open `index.html`** in any supported browser.
3. The application loads instantly — no install step needed.

> **Tip:** For the best experience, use Chrome or Edge on a desktop or laptop with a dedicated GPU.

### Your First 60 Seconds

Once the app opens:

1. Click the **Box** button in the left toolbar to add a box to the scene.
2. Press **W** to activate the Move tool and drag the red/green/blue arrows to reposition the box.
3. Click **▶ Play** in the toolbar to start the physics simulation — the box will fall under gravity.
4. Click **⏸ Pause** or press **Space** to stop it.
5. Click **↺ Reset** to restore the box to its original position.

---

## 3. Interface Overview

Studio3D uses a classic 3D-application layout with five main regions.

```
┌──────────────────────── Title Bar ─────────────────────────┐
├──────────────────────── Menu Bar ──────────────────────────┤
│ File  Edit  Add  View  Physics  Help                       │
├──── Left Panel ────┬─────── Viewport ───────┬─ Right Panel ┤
│                    │                        │              │
│  Primitives        │   <3D Canvas>          │  Scene Tree  │
│  Library           │                        │              │
│  Toolbar           │                        │  Properties  │
│                    │                        │  Inspector   │
├────────────────────┴────────────────────────┴──────────────┤
└──────────────────────── Status Bar ────────────────────────┘
```

### Title Bar

Displays the application name and current scene name. A recording indicator appears here when a video capture is in progress.

### Menu Bar

All application commands are accessible through six menus:

| Menu | Contents |
|------|----------|
| **File** | New Scene, Import, Export, Screenshot, Record Video |
| **Edit** | Undo, Redo, Duplicate, Delete, Select All |
| **Add** | All 13 primitives, all 13 library items, lights |
| **View** | Camera presets (Front, Back, Left, Right, Top, Perspective), Wireframe, Grid |
| **Physics** | Play, Pause, Reset, Physics Demos, World Settings |
| **Help** | Keyboard Shortcuts, About |

### Left Panel — Primitives & Library

The left panel contains two collapsible sections:

**Primitives** — Click any button to add the shape to the scene at the origin:

| Button | Shape |
|--------|-------|
| Box | Rectangular cuboid |
| Sphere | UV sphere |
| Cylinder | Circular cylinder |
| Cone | Tapered cylinder (tip at top) |
| Plane | Flat rectangular surface |
| Torus | Donut ring |
| Icosahedron | 20-face polyhedron |
| Torus Knot | Twisted torus knot |
| Dodecahedron | 12-face polyhedron |
| Octahedron | 8-face polyhedron |
| Tetrahedron | 4-face pyramid |
| Pyramid | Square-base pyramid |
| Capsule | Cylinder with hemispherical caps |

**Library** — Pre-built complex objects:

| Category | Objects |
|----------|---------|
| Industrial | Storage Tank, Pressure Vessel, Heat Exchanger, Electric Motor, Motorized Pump |
| Piping | Pipe Segment, Pipe Elbow, Gate Valve |
| Structures | Cooling Tower, Conveyor Belt |
| Special | Car, Cannon, Teapot |

### Top Toolbar

A row of icon buttons for the most common actions:

| Icon | Action | Shortcut |
|------|--------|---------|
| ↶ | Undo | Ctrl+Z / ⌘Z |
| ↷ | Redo | Ctrl+Y / ⌘Y |
| ↕ | Move tool | W |
| ⟳ | Rotate tool | E |
| ↗ | Scale tool | R |
| 🌐 | World space | — |
| ▦ | Local space | — |
| 🧲 | Snap to grid | G |
| ⊞ | Toggle grid | — |
| █ | Wireframe | — |
| ⊕ | Focus selected | F |
| 🗑 | Delete selected | Delete |
| ⎘ | Duplicate | Ctrl+D / ⌘D |
| ▶ | Play physics | — |
| ⏸ | Pause physics | — |
| ↺ | Reset physics | — |

### Viewport (3D Canvas)

The central canvas renders the scene in real time. Interaction:

| Action | Gesture |
|--------|---------|
| **Orbit camera** | Left-click + drag |
| **Pan camera** | Right-click + drag, or Middle-click + drag |
| **Zoom** | Scroll wheel |
| **Select object** | Left-click on object |
| **Deselect** | Esc, or click empty area |
| **Context menu** | Right-click on object |
| **Move/Rotate/Scale** | Drag the colored gizmo handles |

When an object is selected, a transform gizmo appears:
- **Move**: Red (X), Green (Y), Blue (Z) arrows plus plane handles
- **Rotate**: Red, Green, Blue arc handles
- **Scale**: Red, Green, Blue handle bars plus center cube for uniform scale

### Right Panel — Scene Tree & Properties Inspector

**Scene Tree** (upper section): Lists every object in the scene. Click an entry to select it in the viewport. Objects can be renamed by double-clicking. Right-clicking opens a context menu.

**Properties Inspector** (lower section): Dynamically shows editable properties for the selected object:

- **Transform** — Position, Rotation, Scale (X/Y/Z numeric fields)
- **Material** — Color picker, Metalness, Roughness, Emissive, Opacity, Wireframe
- **Physics** — Enable toggle, Mass, Friction, Restitution, Linear/Angular Damping, Body Type
- **Light** (lights only) — Intensity, Color, Distance, Angle, Penumbra, Decay

### Status Bar

Displays the current transform mode, object count, physics state, and FPS counter.

---

## 4. Working with Objects

### Adding a Primitive

1. Click any primitive button in the left panel (e.g., **Sphere**).
2. The object appears at the world origin (0, 0, 0) with a default gray material.
3. It is automatically selected and shown in the Properties Inspector.

### Adding a Library Object

1. Scroll down in the left panel to the **Library** section.
2. Click the desired item (e.g., **Storage Tank**).
3. The pre-built group object appears in the scene and is selected.

### Selecting Objects

- **Single select**: Left-click an object in the viewport or Scene Tree.
- **Deselect**: Press **Esc** or click on an empty area.

### Renaming an Object

1. Double-click the object's name in the **Scene Tree**.
2. Type the new name.
3. Press **Enter** to confirm.

### Duplicating an Object

- Press **Ctrl+D** (Windows/Linux) or **⌘D** (macOS).
- Or: Right-click the object → **Duplicate**.
- The copy is created slightly offset from the original and becomes selected.

### Deleting an Object

- Press **Delete** or **Backspace** while an object is selected.
- Or: Right-click the object → **Delete**.
- Or: Click the 🗑 toolbar button.

### Hiding and Showing Objects

- Right-click the object → **Hide** to make it invisible without deleting it.
- Right-click the hidden entry in the Scene Tree → **Show** to restore it.

### Grouping Objects

1. Select the first object.
2. Hold **Shift** and click additional objects.
3. Right-click → **Group Selection**.
4. The group appears as a single entry in the Scene Tree and can be transformed as a unit.

---

## 5. Transforming Objects

### Transform Modes

Activate a mode by pressing its shortcut key or clicking the toolbar button:

| Mode | Key | Gizmo |
|------|-----|-------|
| **Move** (Translate) | W | Arrows |
| **Rotate** | E | Arcs |
| **Scale** | R | Bars + center cube |

### World vs. Local Space

Toggle between coordinate spaces using the toolbar:
- **World Space** (🌐): Gizmo axes align with the world X/Y/Z axes.
- **Local Space** (▦): Gizmo axes align with the object's own orientation.

Use Local Space when the object is rotated and you want to move it along its own axes.

### Numeric Input

For precise positioning, enter exact values in the Properties Inspector:
1. Select the object.
2. In the **Transform** section of the Inspector, click the X, Y, or Z field.
3. Type the exact value and press **Enter** or **Tab**.

### Snap to Grid

Press **G** to toggle grid snapping. When enabled, all move operations snap to the configured grid increment (default: 1 unit). This is useful for aligning objects precisely.

### Focusing the Camera on a Selection

Press **F** to frame the selected object in the viewport. The camera orbits to face the object and zooms to fit it in view.

---

## 6. Materials & Appearance

### Accessing Material Properties

1. Select any object.
2. In the Properties Inspector (right panel), scroll to the **Material** section.

### Material Properties

| Property | Range | Effect |
|----------|-------|--------|
| **Color** | RGB hex | Base surface color |
| **Metalness** | 0 – 1 | 0 = non-metal (plastic), 1 = full metal |
| **Roughness** | 0 – 1 | 0 = mirror-like, 1 = fully diffuse |
| **Emissive** | 0 – 1 | Adds a self-glowing color tint (good for glowing screens) |
| **Opacity** | 0 – 1 | 1 = fully opaque, 0 = fully transparent |
| **Transparent** | Toggle | Must be enabled for opacity to take effect |
| **Wireframe** | Toggle | Displays mesh as lines only |

### Common Material Recipes

| Look | Metalness | Roughness | Notes |
|------|-----------|-----------|-------|
| Plastic | 0.0 – 0.1 | 0.4 – 0.6 | Everyday objects |
| Brushed metal | 0.8 – 1.0 | 0.4 – 0.6 | Steel, aluminum |
| Polished chrome | 0.9 – 1.0 | 0.0 – 0.1 | Mirror-like |
| Rubber / matte | 0.0 | 0.8 – 1.0 | Tires, gaskets |
| Glass | 0.0 | 0.0 – 0.1 | Enable Transparent + lower Opacity to ~0.3 |
| Emissive screen | 0.0 | 0.8 | Set Emissive to orange or blue |

### Applying a Color

1. Click the **Color** swatch in the Material section.
2. Use the color picker or type a hex value.
3. The object updates in real time.

---

## 7. Lighting

Studio3D includes three default lights and allows you to add additional lights from the **Add** menu.

### Default Lights

| Light | Type | Purpose |
|-------|------|---------|
| Ambient | `AmbientLight` | Fills all shadow areas with a soft base illumination |
| Sun | `DirectionalLight` | Casts directional shadows from above-right |
| Sky | `HemisphereLight` | Simulates sky/ground gradient for a natural look |

### Adding a Light

1. Open the **Add** menu in the menu bar.
2. Choose **Point Light**, **Spot Light**, or **Directional Light**.
3. The light object appears in the scene and can be selected and moved like any object.

### Light Properties (in the Inspector)

| Property | Effect |
|----------|--------|
| **Intensity** | Brightness (0 = off, 2 = double-bright) |
| **Color** | Tint of the emitted light |
| **Distance** | Maximum influence radius (0 = infinite) |
| **Angle** | Spotlight cone angle in radians |
| **Penumbra** | Soft-edge gradient at the cone boundary (0 – 1) |
| **Decay** | Light falloff rate with distance |

### Shadow Casting

The default directional (Sun) light casts **PCF soft shadows**. To get clean shadows:
- Keep the scene within the directional light's shadow frustum (roughly centered near the origin).
- Avoid placing objects very far from the scene center.

### Ambient & Background Color

Go to **View > Scene Settings** to adjust:
- **Background color** — The solid color behind all 3D objects.
- **Ambient light color and intensity** — Overall fill light level.

---

## 8. Physics Simulation

### Enabling Physics on an Object

1. Select the object.
2. In the Properties Inspector, scroll to the **Physics** section.
3. Check **Enable Physics**.
4. Set the **Mass** (kg). A mass of **0** means the body is static (immovable).

### Physics Body Properties

| Property | Range | Default | Effect |
|----------|-------|---------|--------|
| **Mass** | 0 – ∞ | 1 kg | 0 = static, >0 = dynamic (falls under gravity) |
| **Friction** | 0 – 1 | 0.5 | Surface grip against other objects |
| **Restitution** | 0 – 1 | 0.3 | Bounciness (0 = no bounce, 1 = perfect bounce) |
| **Linear Damping** | 0 – 1 | 0.01 | Slows translation over time (simulates air drag) |
| **Angular Damping** | 0 – 1 | 0.01 | Slows rotation over time |

### Physics Body Types

| Type | Behavior |
|------|----------|
| **Dynamic** | Fully simulated — gravity, collisions, forces all apply |
| **Static** | Immovable (floor, walls) — other objects collide with it |
| **Kinematic** | Moved programmatically — collides but ignores gravity |

### Collision Shapes

Studio3D automatically assigns the closest Cannon-ES collision primitive to each geometry:

| Geometry | Collision Shape |
|----------|----------------|
| Box | Box |
| Sphere | Sphere |
| Cylinder | Cylinder |
| Cone | Cylinder (zero top radius) |
| Plane | Thin box slab |
| Any group or imported mesh | Bounding-box (AABB) |

### Playing the Simulation

1. Configure all objects' physics properties.
2. Press **▶ Play** in the toolbar or via **Physics > Play**.
3. The simulation runs at 60 FPS. Objects with physics enabled start interacting.
4. Press **⏸ Pause** to freeze the simulation at the current frame.
5. Press **↺ Reset** to revert all objects to their pre-play transforms and start over.

> **Important:** Reset restores the exact pre-play state. Edits made *during* a running simulation are not preserved after Reset.

### Physics World Settings

Access via **Physics > World Settings**:

| Setting | Default | Notes |
|---------|---------|-------|
| **Gravity Y** | –9.82 m/s² | Change to 0 for zero-gravity, positive for inverted gravity |
| **Fixed Time Step** | 1/60 s | Smaller = more accurate but slower |
| **Max Sub-Steps** | 10 | Higher = more stable at high speeds |

### Constraints (Joints)

Constraints connect two objects with a mechanical relationship. Available constraint types:

| Constraint | Degrees of Freedom | Common Use |
|-----------|-------------------|------------|
| **Hinge** | 1 rotational axis | Doors, wheels, hinges |
| **Distance** | Fixed distance | Pendulums, chains |
| **Point-to-Point** | Ball socket | Robot arms, rag-dolls |
| **Locked** | Rigid attachment | Compound rigid bodies |

Add constraints via **Physics > Add Constraint**, then select the two bodies and set parameters.

---

## 9. Physics Demos

Eight ready-to-run demos are accessible from **Physics > Demos** (or **Help > Physics Demos**). Each demo loads a pre-built scene. Press **▶ Play** to run it.

### Domino Chain

- **Demonstrates:** Cascade reactions, momentum transfer
- **Try:** Press Play and watch the first domino topple the rest in sequence
- **Experiment:** Delete a domino to create a gap in the chain and see where the cascade stops

### Bowling Alley

- **Demonstrates:** Rolling-sphere collisions with standing objects
- **Try:** Press Play to bowl the ball into the pins
- **Experiment:** Adjust the ball's restitution and mass to change how pins react

### Stacking Tower

- **Demonstrates:** Gravity, balance, and instability
- **Try:** Press Play and watch the tower sway and fall
- **Experiment:** Change the mass of individual blocks to see which topple first

### Ramp & Balls

- **Demonstrates:** Inclined-plane physics, friction, acceleration
- **Try:** Press Play and observe balls rolling down the ramp
- **Experiment:** Increase friction values to slow the balls; reduce to near 0 for ice-like surfaces

### Newton's Cradle

- **Demonstrates:** Conservation of momentum and elastic collisions
- **Try:** Press Play — the end ball swings and transfers energy through the cradle
- **Experiment:** Change the restitution of the balls (0 = inelastic, 1 = perfectly elastic)

### Double Pendulum

- **Demonstrates:** Chaotic motion sensitive to initial conditions
- **Try:** Press Play and observe the unpredictable path of the lower pendulum
- **Experiment:** Slightly modify the initial angle of the top arm and compare the diverging trajectories

### Projectile Trajectory

- **Demonstrates:** Parabolic ballistic motion
- **Try:** Press Play to launch the projectile and trace its arc
- **Experiment:** Change gravity (World Settings) to see how trajectory changes on other planets

### Robot Arm Pickup

- **Demonstrates:** Multi-joint kinematics and constraints
- **Try:** Press Play to watch the arm reach, grasp, and place an object
- **Experiment:** Adjust the hinge constraints to change the arm's reach and orientation

---

## 10. Import & Export

### Importing Files

1. Go to **File > Import**.
2. Select the format (GLTF/GLB, OBJ, STL, PLY, FBX, or Studio3D JSON).
3. Choose the file from your disk.
4. The model is added to the scene and selected.

### Supported Import Formats

| Format | Extension | Notes |
|--------|-----------|-------|
| Studio3D Scene | `.json` | Full fidelity — materials, physics, hierarchy |
| GLTF | `.gltf` / `.glb` | Textures and materials preserved |
| Wavefront OBJ | `.obj` | Geometry and normals only |
| STL | `.stl` | Geometry only (ASCII or binary) |
| PLY | `.ply` | Geometry + optional vertex colors |
| FBX | `.fbx` | Geometry and hierarchy (import only) |

### Exporting Files

1. Go to **File > Export**.
2. Choose the desired format.
3. The file is downloaded immediately to your browser's download folder.

### Supported Export Formats

| Format | Extension | Best For |
|--------|-----------|----------|
| Studio3D Scene | `.json` | Saving work — full round-trip fidelity |
| GLTF (text) | `.gltf` | Sharing with Blender, Unity, web viewers |
| GLB (binary) | `.glb` | Single-file distribution |
| Wavefront OBJ | `.obj` | Universal geometry exchange |
| STL (ASCII) | `.stl` | 3D printing, human-readable |
| STL (Binary) | `.stl` | 3D printing, compact file size |
| PLY | `.ply` | Point clouds, scientific visualization |

### Format Selection Guide

```
Want to re-open the scene in Studio3D later?
    → Studio3D JSON (.json)

Want to send to Blender / Unity / web viewer?
    → GLTF/GLB

Want to 3D print?
    → STL (binary for smaller file, ASCII for readability)

Want maximum compatibility with any 3D tool?
    → OBJ (geometry only, widely supported)

Working with point clouds or scientific data?
    → PLY
```

---

## 11. Saving & Loading Scenes

Studio3D does **not** auto-save to browser storage. Always export your work manually.

### Saving a Scene

1. Go to **File > Export > Studio3D Scene (.json)**.
2. A `.json` file is downloaded to your browser's downloads folder.
3. This file preserves all objects, materials, physics settings, lights, names, and hierarchy.

### Loading a Scene

1. Go to **File > Import > Studio3D Scene (.json)**.
2. Select the previously saved `.json` file.
3. The scene is fully restored.

### Best Practices

- **Save often.** Export a new `.json` after each significant change.
- **Use descriptive filenames.** e.g., `bridge_physics_v3.json`.
- **Keep backups.** Store copies before running destructive operations like Delete All or importing a new scene over the current one.

---

## 12. Capture: Screenshots & Video

### Taking a Screenshot

| Method | Steps |
|--------|-------|
| **Keyboard** | Press **Ctrl+P** (Windows/Linux) or **⌘P** (macOS) |
| **Menu** | File > Screenshot |

A `studio3d-screenshot.png` file is downloaded immediately at the current viewport resolution.

> **Tip:** Set up your scene composition, hide UI panels if needed using the View menu, then press Ctrl+P for a clean render.

### Recording a Video

| Method | Steps |
|--------|-------|
| **Keyboard** | Press **Ctrl+R** (Windows/Linux) or **⌘R** (macOS) to start, press again to stop |
| **Menu** | File > Start Recording / Stop Recording |

- The recording indicator appears in the title bar while recording.
- Recording captures the live canvas at **60 FPS** in **WebM (VP9)** format.
- When you stop recording, a `.webm` file is downloaded.
- For best results, start the physics simulation before starting the recording.

> **Tip:** Convert `.webm` to `.mp4` using tools like FFmpeg or HandBrake for wider compatibility.

---

## 13. Keyboard Shortcuts Reference

### Transform Modes

| Action | Shortcut |
|--------|---------|
| Move tool | **W** |
| Rotate tool | **E** |
| Scale tool | **R** |

### Navigation

| Action | Shortcut |
|--------|---------|
| Focus selected object | **F** |
| Toggle grid | **G** |
| Toggle inspect / presentation mode | **V** |

### Editing

| Action | Shortcut |
|--------|---------|
| Duplicate selected | **Ctrl+D** / **⌘D** |
| Delete selected | **Delete** / **Backspace** |
| Deselect all | **Esc** |
| Undo | **Ctrl+Z** / **⌘Z** |
| Redo | **Ctrl+Y** / **⌘Y** |

### Capture

| Action | Shortcut |
|--------|---------|
| Screenshot | **Ctrl+P** / **⌘P** |
| Toggle video recording | **Ctrl+R** / **⌘R** |

### Physics

| Action | Shortcut |
|--------|---------|
| Play / Pause simulation | **Space** |

---

## 14. Tutorials

### Tutorial 1 — Build and Drop a Stack of Boxes

This tutorial introduces primitives, transforms, and physics.

**Goal:** Create a tower of three boxes and watch it fall under gravity.

1. **Add a floor plane**
   - Click **Plane** in the Primitives panel.
   - In the Inspector, set Position Y to `0`.
   - In the Physics section, enable physics, set **Mass to 0** (static body).

2. **Add three boxes**
   - Click **Box** three times — three boxes appear at the origin.
   - Select each box and set their Y positions: `0.5`, `1.5`, `2.5` (stacked vertically).
   - In the Physics section of each box, enable physics, leave Mass at `1`.

3. **Run the simulation**
   - Click **▶ Play**. The boxes fall onto the plane and stack (or tumble).

4. **Save your work**
   - File > Export > Studio3D Scene (.json).

---

### Tutorial 2 — Create a Chrome Ball on a Reflective Surface

This tutorial explores materials and lighting.

**Goal:** Create a photorealistic metallic sphere on a smooth surface.

1. **Set up the floor**
   - Add a **Plane**, scale it to `X=10, Z=10` in the Inspector.
   - Set material: Color `#1a1a2e`, Metalness `0.8`, Roughness `0.1`.

2. **Add a sphere**
   - Click **Sphere**.
   - Set Position Y to `1`.
   - Set material: Color `#cccccc`, Metalness `1.0`, Roughness `0.05`.

3. **Adjust the lighting**
   - Select the **Sun** light in the Scene Tree.
   - Increase Intensity to `1.5`.
   - Add a **Point Light** (Add menu) and move it to `X=3, Y=3, Z=3`.
   - Set Point Light color to a warm yellow `#fffbe6`, Intensity `1.2`.

4. **Take a screenshot**
   - Press **F** to focus on the sphere.
   - Press **Ctrl+P** to capture a PNG.

---

### Tutorial 3 — Newton's Cradle from Scratch

This tutorial covers library objects, physics, and constraints.

**Goal:** Build a functional Newton's Cradle manually.

1. **Create the frame**
   - Add two **Box** primitives as vertical supports: positions `X=-2, Y=1` and `X=2, Y=1`.
   - Add two thin **Box** primitives as horizontal bars: position `Y=2`, scale `X=4, Y=0.1, Z=0.1`.
   - Set all frame pieces to Mass `0` (static).

2. **Create pendulum balls**
   - Add five **Sphere** primitives, scale each to `0.5`.
   - Position them in a row along the X axis: X = `–1, –0.5, 0, 0.5, 1`, all at Y = `0`.
   - Enable physics, set Mass `1`, Restitution `0.99` (near-perfect elastic).

3. **Run and observe**
   - Press **▶ Play**.
   - Or: Load the built-in Newton's Cradle demo from Physics > Demos for a pre-wired version with distance constraints.

> **Note:** The built-in demo includes pre-configured `Distance` constraints that hold each ball to the frame. For manual builds, use **Physics > Add Constraint > Distance** and connect each ball's top to the frame bar above it.

---

### Tutorial 4 — Exporting a Model for 3D Printing

This tutorial covers scale, export, and STL format.

**Goal:** Create a simple bracket and export it for 3D printing.

1. **Design the bracket**
   - Add a **Box**: scale `X=4, Y=0.5, Z=2` (base plate).
   - Add another **Box**: scale `X=0.5, Y=2, Z=2`, position `X=-2, Y=1` (back wall).
   - Group the two objects: select both, right-click → **Group Selection**.

2. **Check scale**
   - Studio3D uses units in meters by default.
   - For a 4 cm × 0.5 cm × 2 cm bracket, set scale X to `0.04`, Y to `0.005`, Z to `0.02`.
   - Alternatively, treat 1 unit = 1 mm and scale accordingly in your slicer.

3. **Export as STL**
   - File > Export > STL (Binary).
   - The `.stl` file is ready for any slicing software (Cura, PrusaSlicer, etc.).

---

### Tutorial 5 — Recording a Physics Simulation

This tutorial covers the Record feature end-to-end.

**Goal:** Record a domino chain simulation as a WebM video.

1. **Load the Domino demo**
   - Physics > Demos > Domino Chain.

2. **Position the camera**
   - Orbit the viewport to get a dramatic side angle.
   - Press **F** on a domino to frame the scene.

3. **Start recording**
   - Press **Ctrl+R** (or ⌘R). The recording indicator appears in the title bar.

4. **Play the simulation**
   - Press **▶ Play** (or Space). The dominoes topple while the camera is recording.

5. **Stop recording**
   - Press **Ctrl+R** again. A `studio3d-recording.webm` file is downloaded.

6. **(Optional) Convert to MP4**
   - Use FFmpeg: `ffmpeg -i studio3d-recording.webm output.mp4`

---

## 15. Tips & Best Practices

### Workflow Efficiency

- **Duplicate instead of recreating.** Once you've set a material, duplicate the object (Ctrl+D) to reuse it.
- **Name your objects.** Double-click names in the Scene Tree to rename. Clear names save time in complex scenes.
- **Use the Scene Tree to select.** When objects overlap in the viewport, click the entry in the Scene Tree instead.
- **Save with Ctrl+S shortcut intention.** Use File > Export frequently to avoid losing work.

### Modeling

- **Start with primitives.** Build complex shapes by combining and positioning multiple primitives.
- **Use Plane as a floor.** Always add a static Plane (mass 0) before running physics so objects have something to land on.
- **Snap to grid (G).** Essential for lining up walls, floors, and symmetrical objects.
- **Focus (F) after adding objects.** If an object seems to disappear, press F to find it in the scene.

### Physics

- **Set floor mass to 0.** Any object you want to be immovable (floor, walls) must have Mass = 0.
- **Tune restitution for realistic bounce.** Values above 0.9 create very bouncy objects. Keep around 0.3–0.5 for realistic collisions.
- **Avoid modifying objects during simulation.** Stop the simulation, make changes, then press Reset and Play again.
- **Reset before re-running.** Always Reset (↺) before pressing Play again to start from clean initial state.

### Performance

- **Reduce physics sub-steps** in Physics > World Settings if the simulation runs slowly.
- **Disable physics on non-interacting objects.** Only enable physics on objects that need to participate in the simulation.
- **Lower shadow quality** or disable shadows (View menu) in scenes with 500+ objects.
- **Export regularly.** The undo stack (max 50 steps) is your only safety net.

### Camera

- **Use preset views.** View menu → Front/Top/Left etc. for aligning objects to axes.
- **Middle-click drag to pan** instead of rotating when making fine alignments.
- **Wireframe mode** (toolbar) lets you see overlapping objects and collision shapes.

---

## 16. Troubleshooting & FAQ

### The application doesn't load / shows a blank screen

**Cause:** The browser cannot load Three.js or Cannon-ES from CDN (no internet, or CDN is blocked).

**Fix:**
- Confirm you have an active internet connection.
- Try a different browser (Chrome recommended).
- Check the browser console (F12) for network errors.
- If the CDN is unreliable, download Three.js and Cannon-ES locally and update the `<script type="importmap">` in `index.html` to point to local paths.

---

### Objects fall through the floor

**Cause:** The floor plane does not have physics enabled, or its Mass is not 0.

**Fix:**
1. Select the floor/plane.
2. In the Inspector, enable **Physics**.
3. Set **Mass to 0** (static body).
4. Reset and re-run the simulation.

---

### Physics simulation is unstable / objects fly off-screen

**Possible causes and fixes:**

| Cause | Fix |
|-------|-----|
| Objects overlapping at start | Separate objects before pressing Play |
| Very high restitution values | Lower Restitution to 0.3 – 0.5 |
| Very high velocities at start | Reduce initial velocity or gravity |
| Too few solver iterations | Increase iterations in Physics > World Settings |

---

### I can't select an object in the viewport

**Fix:**
- Click directly on the mesh surface (not beside it).
- Use the **Scene Tree** to click the object by name.
- Check if the object is hidden (look for a hidden indicator in the Scene Tree; right-click → Show).

---

### My GLTF / OBJ import looks wrong (wrong scale, missing materials)

**GLTF:** Materials are preserved. If they look wrong, the file may use textures (image files) that were not bundled in the `.glb`. Use GLB format which embeds textures.

**OBJ:** OBJ files contain geometry only; materials are not imported. Re-apply materials in Studio3D after import.

**Scale:** Different tools use different unit scales (mm vs. cm vs. m). After import, use the Scale fields in the Inspector to resize the model.

---

### Undo does not work as expected

- Studio3D uses a **snapshot-based undo** (up to 50 steps). Each undo restores the entire scene from a saved snapshot.
- Undo is available for: add, delete, transform, property changes.
- **Redo** is also supported via Ctrl+Y / ⌘Y.
- Physics simulation steps are **not** undoable. Use Reset (↺) to revert to the pre-play state.

---

### Screenshot/video is blank or shows wrong content

- The screenshot and video capture the **3D canvas only** (not the UI panels).
- Ensure the canvas is visible and not covered by a dialog.
- For video recording, make sure your browser supports `MediaRecorder` with VP9 codec (Chrome/Firefox preferred).

---

### The app is running slowly

**Optimize performance with these steps:**

1. Reduce the number of physics-enabled objects.
2. Decrease **Max Sub-Steps** in Physics > World Settings.
3. Disable shadows (View > Shadows or renderer settings).
4. Switch to **Wireframe** mode (toolbar) to reduce rendering load.
5. Close other browser tabs and GPU-intensive applications.
6. Use Chrome or Edge for best WebGL performance.

---

### Can I use Studio3D offline?

Yes, with a small modification:
1. Download Three.js (`three.module.js`) and Cannon-ES (`cannon-es.js`) locally.
2. Edit `index.html` — update the `<script type="importmap">` block to point to the local file paths instead of CDN URLs.
3. Open `index.html` from a local HTTP server (e.g., `python -m http.server 8080`) — browsers block ES module loading from `file://` for security reasons.

---

### How do I add custom library items?

Currently, library items are defined in `app.js` using the `buildLibraryItem()` factory function. To add a custom item:
1. Open `app.js` in a text editor.
2. Find the `buildLibraryItem()` function.
3. Add a new `case` that constructs a `THREE.Group` from primitives.
4. Add a corresponding button in `index.html` with a `data-action="add-library-item"` attribute.

See [HOW_IT_WAS_BUILT.md](HOW_IT_WAS_BUILT.md) → Library & Primitives System for technical details.

---

## Appendix A — All Primitive Shapes

| Shape | Constructor | Key Parameters |
|-------|-------------|----------------|
| Box | `BoxGeometry` | width, height, depth |
| Sphere | `SphereGeometry` | radius, widthSegments, heightSegments |
| Cylinder | `CylinderGeometry` | radiusTop, radiusBottom, height |
| Cone | `ConeGeometry` | radius, height |
| Plane | `PlaneGeometry` | width, height |
| Torus | `TorusGeometry` | radius, tube |
| Icosahedron | `IcosahedronGeometry` | radius, detail |
| Torus Knot | `TorusKnotGeometry` | radius, tube, tubularSegments |
| Dodecahedron | `DodecahedronGeometry` | radius |
| Octahedron | `OctahedronGeometry` | radius |
| Tetrahedron | `TetrahedronGeometry` | radius |
| Pyramid | `ConeGeometry` (4 sides) | radius, height |
| Capsule | `CapsuleGeometry` | radius, length |

---

## Appendix B — File Formats Comparison

| Format | Materials | Physics | Hierarchy | Textures | 3D Print | Game Engine |
|--------|-----------|---------|-----------|----------|----------|-------------|
| Studio3D JSON | ✅ Full | ✅ Full | ✅ | ❌ | ❌ | ❌ |
| GLTF/GLB | ✅ PBR | ❌ | ✅ | ✅ (GLB) | ❌ | ✅ |
| OBJ | ❌ | ❌ | ❌ | ❌ | ✅ | ⚠️ |
| STL | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| PLY | ⚠️ Vertex colors | ❌ | ❌ | ❌ | ✅ | ⚠️ |
| FBX | ⚠️ | ❌ | ✅ | ✅ | ❌ | ✅ |

---

## Appendix C — Physics Property Quick Reference

| Property | Value | Result |
|----------|-------|--------|
| Mass | 0 | Static (immovable) |
| Mass | 1 – 10 | Typical dynamic object |
| Mass | 100+ | Heavy / slow to move |
| Friction | 0 | Ice surface |
| Friction | 0.5 | Normal surface |
| Friction | 1 | Very sticky |
| Restitution | 0 | No bounce (clay) |
| Restitution | 0.5 | Moderate bounce |
| Restitution | 1 | Perfect elastic bounce |
| Linear Damping | 0 | No air resistance |
| Linear Damping | 0.5 | Viscous fluid feel |
| Linear Damping | 1 | Immediately stops |

---

*Studio3D Handbook · Built by [Rodrigo Vigna](mailto:rvigna@outlook.com) · MIT License*
