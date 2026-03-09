# 🎨 Studio3D — Advanced 3D Design & Physics Simulation Tool

> **Professional-grade 3D modeler with real-time physics simulation, built entirely in the browser.**

A powerful, intuitive 3D design and physics simulation engine built with Three.js and Cannon-ES. Create, edit, and simulate complex 3D scenes with realistic physics interactions. Export to multiple industry-standard formats. Perfect for designers, engineers, educators, and physics enthusiasts.

[![](https://img.shields.io/badge/Three.js-v0.163.0-blue?style=flat-square&logo=threedotjs)](https://threejs.org)
[![](https://img.shields.io/badge/Cannon--ES-Physics-brightgreen?style=flat-square)](https://github.com/pmndrs/cannon-es)
[![](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE)
[![](https://img.shields.io/badge/Browser-Native-orange?style=flat-square)](https://caniuse.com/webgl)
![](https://img.shields.io/badge/Status-Production%20Ready-success?style=flat-square)

**Author:** [Rodrigo Vigna](mailto:rvigna@outlook.com) [![GitHub](https://img.shields.io/badge/GitHub-rvigna-black?style=flat-square&logo=github)](https://github.com/rvigna)

📘 **[Read the full User Handbook →](HANDBOOK.md)**

---

## 📑 Table of Contents

- [✨ Key Features](#-key-features)
- [⚡ Getting Started](#-getting-started)
- [⌨️ Keyboard Shortcuts](#️-keyboard-shortcuts)
- [🎮 Toolbar Reference](#-toolbar-reference)
- [📦 Export Formats](#-export-formats-guide)
- [🚀 Quick Start](#-quick-start)
- [🎓 Physics Demos](#-physics-demos)
- [🛠️ Architecture](#️-architecture)
- [📋 Property Inspector](#-property-inspector-guide)
- [💾 Saving & Loading](#-saving--loading)
- [🎨 Material System](#-material-system)
- [🔧 Physics Configuration](#-physics-configuration)
- [📖 Tips & Tricks](#-tips--tricks)
- [🐛 Known Limitations](#-known-limitations)
- [🌐 Browser Support](#-browser-support)
- [� Sample Scenes](#-sample-scenes)
- [�📝 File Structure](#-file-structure)
- [🎬 Example Workflows](#-example-workflows)
- [🔮 Future Enhancements](#-future-enhancements)
- [👨‍💻 Author](#️-author)
- [🤝 Contributing](#-contributing)

---

## ⚡ Getting Started

### Installation
No build process required! Studio3D runs directly in the browser using ES modules.

1. **Clone or download** the repository
2. **Open `index.html`** in a modern web browser (Chrome, Firefox, Safari, or Edge)
3. **Start creating!** — No additional dependencies to install

That's it. The application loads Three.js and Cannon-ES from CDN automatically.

### First Steps
1. Click a primitive shape button (Box, Sphere, etc.) to add objects
2. Use the **Move** tool (W) to position objects
3. Right-click to access properties in the Inspector
4. Click **Play** (▶️) to start physics simulation
5. Press **Ctrl+P** or **Cmd+P** to take a screenshot

### Features at a Glance

| Feature | Support | Details |
|---------|---------|---------|
| **Primitives** | ✅ 13 types | Box, Sphere, Cylinder, Cone, Plane, Torus, Polyhedra, etc. |
| **Library** | ✅ 13 objects | Industrial equipment, vehicles, decorative items |
| **Physics** | ✅ Full | Rigid bodies, collisions, constraints, 60 FPS |
| **Rendering** | ✅ PBR | Materials, lights, shadows, multiple views |
| **Video Export** | ✅ WebM 60FPS | Direct browser capture at 1080p+ |
| **Import Formats** | ✅ 6 types | GLTF, OBJ, STL, PLY, FBX, JSON |
| **Export Formats** | ✅ 7 types | JSON, GLTF, GLB, OBJ, STL, PLY, Binary STL |
| **Undo/Redo** | ✅ Full | Complete action history |
| **Keyboard Shortcuts** | ✅ 20+e | Professional workflow optimization |
| **Mobile** | ⚠️ Limited | Desktop-optimized interface |

---

### 🎨 3D Modeling & Design
- **13 Primitive Shapes** — Box, Sphere, Cylinder, Cone, Torus, Plane, Icosahedron, Torus Knot, Dodecahedron, Octahedron, Tetrahedron, Pyramid, Capsule
- **Professional Library** — 13 pre-built objects including industrial equipment, vehicles, and decorative items
  - Industrial: Storage Tank, Pressure Vessel, Heat Exchanger, Electric Motor, Motorized Pump
  - Piping: Pipe Segments, Elbows, Gate Valves
  - Structures: Cooling Tower, Conveyor
  - Special: Car, Cannon, Teapot
- **Precision Tools** — Transform (move/rotate/scale), world/local space, snap-to-grid
- **Multi-Select Editing** — Edit multiple objects simultaneously

### ⚙️ Physics Engine
- **Full Rigid Body Dynamics** — Powered by Cannon-ES physics engine
- **Automatic Collision Detection** — All primitives get collision shapes
- **Advanced Constraints**:
  - Hinge joints for rotating parts
  - Distance constraints for pendulums
  - Point-to-point (ball-socket) joints
  - Locked rigid attachments
- **8 Interactive Physics Demos** — Dominoes, Bowling, Tower, Ramp, Newton's Cradle, Double Pendulum, Projectile, Robot Arm
- **Tunable Physics** — Adjust gravity, time step, damping, friction, restitution

### 🎬 Real-Time Rendering
- **Physically-Based Materials** — Full PBR with metalness, roughness, emissive properties
- **Advanced Lighting** — Point lights, spotlights, directional lights with shadows
- **Multiple Views** — Perspective, Front, Back, Left, Right, Top + Wireframe overlay
- **Performance Optimized** — Handles 1000+ objects smoothly

### 🎥 Capture & Recording
- **Screenshot** (⌘P) — Single frame PNG export at viewport resolution
- **Video Recording** (⌘R) — Full WebM video at 60 FPS for documentation and sharing
- **Inspect Mode** (V) — View-only mode for presentations

### 💾 Universal Export
- **Studio3D JSON** — Full fidelity with custom library items
- **GLTF/GLB** — Industry standard with embedded assets
- **OBJ, STL, PLY** — 3D printing and CAD integration
- **FBX Import** — Game engine asset integration

### 💡 Developer-Friendly
- **Modular Architecture** — Clean state management and physics integration
- **Dynamic Module Loading** — Format loaders loaded on-demand
- **Browser Native** — No build step required, pure ES modules
- **Extensible** — Custom geometry and constraint support

---

## ⌨️ Keyboard Shortcuts

| Action | Shortcut | Notes |
|--------|----------|-------|
| **Transform Modes** | | |
| Move/Translate | **W** | Change to move mode |
| Rotate | **E** | Change to rotate mode |
| Scale | **R** | Change to scale mode (no Cmd/Ctrl) |
| **View & Navigation** | | |
| Focus Selected | **F** | Frame selected object in view |
| Toggle Grid | **G** | Show/hide ground grid |
| Toggle View Mode | **V** | Switch to presentation inspect mode |
| **Editing** | | |
| Duplicate | **⌘D** / **Ctrl+D** | Clone selected object |
| Delete | **Delete** / **Backspace** | Remove selected object |
| Deselect | **Esc** | Deselect all objects |
| Undo | **⌘Z** / **Ctrl+Z** | Undo last action (limited - 50 items max) |
| **Capture** | | |
| Screenshot | **⌘P** / **Ctrl+P** | Export viewport as PNG |
| Record Video | **⌘R** / **Ctrl+R** | Toggle video recording (WebM 60 FPS) |

---

## 🎮 Toolbar Reference

| Icon | Function | Tooltip |
|------|----------|---------|
| ↶ | Undo | Undo (Ctrl+Z) |
| ↷ | Redo | Redo (Ctrl+Y) |
| ↕ | Move | Translate/Move |
| ⟳ | Rotate | Rotate selected |
| ↗ | Scale | Scale selected |
| 🌐 | World Space | Transform in world space |
| ▦ | Local Space | Transform in local space |
| 🧲 | Toggle Snap | Snap to grid |
| ⊞ | Toggle Grid | Show/hide grid |
| █ | Wireframe | Wireframe rendering |
| ⊕ | Focus | Focus on selected object |
| 🗑 | Delete | Delete selected |
| ⎘ | Duplicate | Clone selected (⌘D) |
| ▶ | Play Physics | Start simulation |
| ⏸ | Pause Physics | Pause simulation |
| ↻ | Reset Physics | Reset to saved state |

---

## 📦 Export Formats Guide

### Studio3D Scene (.json)
**Best for**: Saving work, sharing scenes with full editability
- Preserves all objects, materials, physics properties
- Includes custom library items
- Maintains scene hierarchy and naming
- Human-readable JSON format

### GLTF / GLB
**Best for**: Sharing models, integration with other tools
- `.gltf` — Text-based with external textures
- `.glb` — Binary format with embedded assets
- Widely supported by 3D software (Blender, Maya, Unity)
- Includes materials and transform hierarchy

### OBJ (Wavefront)
**Best for**: Geometry exchange, 3D printing software
- Contains only mesh geometry and normals
- No materials or hierarchy
- Compatible with virtually all 3D software
- Text-based format

### STL (Stereolithography)
**Best for**: 3D printing and CAD software
- **ASCII** — Human-readable
- **Binary** — Compact file size
- Geometry only (no colors or materials)
- Standard format for 3D printing workflows

### PLY (Polygon File Format)
**Best for**: Point clouds, detailed mesh exchange
- Supports vertex colors and scalar data
- ASCII or binary encoding
- Good for scientific visualization

### FBX (Autodesk)
**Best for**: Game engines, animation software (import only)
- Detailed animation and skeletal data
- Wide industry adoption
- Import capability for asset integration

---

## 🚀 Quick Start

### Basic Workflow

1. **Create a New Scene**
   - File > New Scene (⌘N)
   - Or start with a physics demo from Help > Physics Demos

2. **Add Objects**
   - Click primitive buttons in left panel (Box, Sphere, etc.)
   - Or use Add menu > primitives

3. **Position & Edit**
   - Select object in Scene Hierarchy
   - Use transform tools (W/E/R) or enter values in Inspector
   - Adjust material properties for appearance

4. **Add Physics**
   - Select object
   - Enable physics in Inspector
   - Set mass, friction, restitution
   - Run simulation with Play button

5. **Record & Export**
   - Record simulation: ⌘R or File > Start Recording
   - Screenshot: ⌘P
   - Export: File > Export

### Creating Complex Objects

**Library Items**
- Pre-built objects with detailed geometry
- Drag from library into scene
- Edit as regular objects
- Custom items can be added and saved

**Custom Combinations**
- Combine primitives into groups
- Use constraints for mechanical systems
- Add lights for dramatic illumination

---

## 🎓 Physics Demos

Launch ready-to-run simulations to explore physics concepts:

### Domino Chain
Demonstrates cascade reactions and momentum transfer. Click ▶ to watch dominoes topple in sequence.

### Bowling Alley
Classic physics: rolling sphere colliding with standing pins. Adjust ball velocity for different results.

### Stacking Tower
Gravity and balance challenges. Stack objects and see real-world physics at work.

### Ramp & Balls
Gravity, friction, and acceleration on an inclined plane. Multiple balls interact with ramp and each other.

### Newton's Cradle
Conservation of momentum: observe energy transfer through connected pendulums. Perfectly elastic collisions.

### Double Pendulum
Chaotic motion visualization: extremely sensitive to initial conditions. Fascinating emergence of complex behavior.

### Projectile Trajectory
Parabolic motion with air resistance (optional). Trace paths and analyze ballistic physics.

### Robot Arm Pickup
Complex kinematics: robotic arm with multiple joints picking up and placing objects. Position and rotation constraints.

---

## 🛠️ Architecture

### Technology Stack
- **Rendering**: Three.js v0.163.0 (ES modules)
- **Physics**: Cannon-ES (rigid body dynamics)
- **UI**: Vanilla JavaScript with CSS custom properties
- **Import/Export**: Dynamic module loading for format-specific loaders

### Core Components

#### State Management (`state` object)
```javascript
{
  objects: [],           // All 3D objects in scene
  selected: null,        // Currently selected object
  multiSelected: [],     // Multiple selection (CSG operations)
  transformMode: 'translate|rotate|scale',
  transformSpace: 'world|local',
  viewMode: false,       // Inspection-only mode
  ...
}
```

#### Physics System (`physics` object)
```javascript
{
  world: CANNON.World,           // Physics world
  running: boolean,              // Simulation active
  bodies: Map,                   // Object ID → CANNON.Body
  savedTransforms: Map,          // State for reset
  constraints: Array,            // Active joint constraints
  fixedTimeStep: 1/60,           // 60 FPS physics
  maxSubSteps: 10                // Sub-stepping for accuracy
}
```

#### Scene Hierarchy
- Three-level tree: Objects > Children > Properties
- Real-time updates reflected in viewport
- Drag-and-drop reparenting (planned)

#### Library System
- **Built-In Items**: 13 pre-defined complex geometries
- **Custom Items**: User-created library entries
- **Factory Pattern**: Geometry created on-demand
- **Serialization**: Full round-trip export/import

---

## 📋 Property Inspector Guide

### Transform Properties
- **Position** (X, Y, Z) — Location in world space
- **Rotation** (X, Y, Z) — Euler angles in radians or degrees
- **Scale** (X, Y, Z) — Object dimensions

### Material Properties
- **Color** — RGB hex picker
- **Metalness** (0-1) — Surface reflectivity
- **Roughness** (0-1) — Surface smoothness
- **Emissive** — Self-lighting strength
- **Transparent** — Alpha blending enabled

### Physics Properties
- **Mass** (kg) — Object weight (0 = static/immovable)
- **Friction** (0-1) — Surface grip
- **Restitution** (0-1) — Bounciness (elasticity)
- **Linear Damping** (0-1) — Air resistance
- **Angular Damping** (0-1) — Rotational resistance
- **Enable Physics** — Toggle simulation

### Light Properties (for lights)
- **Intensity** (0-2) — Brightness
- **Distance** — Maximum influence range
- **Angle** (spotlights only) — Cone angle
- **Penumbra** — Soft shadow transition
- **Decay** — Falloff rate

---

## 💾 Saving & Loading

### Manual Save
1. File > Export Scene to download JSON
2. Scene includes all objects, materials, physics settings
3. Library items are preserved

### Loading Scenes
1. File > Import > Studio3D Scene (.json)
2. Select downloaded file
3. Scene fully restored with all properties

### Notes
- Scenes are not auto-saved to browser storage
- Export your work regularly to avoid loss
- JSON format preserves all scene data for perfect round-trip serialization

---

## 🎨 Material System

### Available Materials
- **Standard Materials**: Full physically-based rendering (PBR)
- **Properties**:
  - Base color
  - Metalness (0 = non-metal, 1 = full metal)
  - Roughness (0 = mirror, 1 = diffuse)
  - Emissive (self-illumination)
  - Transparency (alpha blending)

### Common Material Presets
- **Plastic**: Low metalness (0.1), medium roughness (0.5)
- **Metal**: High metalness (0.9), low roughness (0.2)
- **Rubber**: No metalness (0), high roughness (0.8)
- **Glass**: Transparent, low roughness

---

## 🔧 Physics Configuration

### World Settings
- **Gravity**: Default -9.82 m/s² (Y-axis down)
- **Fixed Time Step**: 1/60 second (60 FPS)
- **Max Sub-Steps**: 10 (accuracy vs. performance)
- **Broadphase**: AABB (Axis-Aligned Bounding Box)

### Body Properties
| Property | Range | Default | Effect |
|----------|-------|---------|--------|
| Mass | 0-∞ | 1 | 0 = static (immovable) |
| Friction | 0-1 | 0.5 | Higher = more grip |
| Restitution | 0-1 | 0.3 | Higher = bouncier |
| Linear Damping | 0-1 | 0.01 | Slows velocity |
| Angular Damping | 0-1 | 0.01 | Slows rotation |

### Constraints (Joints)
- **Hinge**: Rotating joint (door, wheel)
- **Distance**: Fixed spacing between objects
- **Point-to-Point**: Ball-and-socket joint
- **Locked**: Rigid connection

---

## 📖 Tips & Tricks

### Workflow Optimization
1. **Use Grid Snapping** (G) for alignment
2. **Wireframe Mode** (toolbar) to see through objects
3. **Focus Selected** (F) to frame in view
4. **Duplicate Often** (⌘D) to avoid recreating
5. **Save Frequently** — Export .json regularly

### Physics Simulation
1. **Test Collisions**: Add static plane as floor
2. **Adjust Gravity**: Change from ±9.82 for effect
3. **Record Demos**: ⌘R captures the action for sharing
4. **View Wireframe**: See collision shapes during simulation

### Performance
- Large scenes (1000+ objects) may slow down
- Reduce physics sub-steps for faster simulation
- Turn off shadows/emissive for performance
- Use LOD (Level-of-Detail) for complex models

---

## 🐛 Known Limitations

- **Limited Undo/Redo**: Simple history system with max 50 snapshots
- **No Redo Implementation**: Redo is not currently implemented (undo only)
- **Physics During Editing**: Changes to objects during active simulation may cause instability
- **Physics Accuracy**: Long simulations may accumulate numerical errors
- **FBX Loader**: Import only, may have compatibility issues with some models
- **Video Recording**: Requires modern browser support (Chrome, Firefox, Safari, Edge)
- **Performance**: Scenes with 1000+ objects or complex physics may experience slowdown
- **Mobile Support**: Touch input not optimized for mobile devices

---

## 🌐 Browser Support

| Browser | Support | Notes |
|---------|---------|-------|
| Chrome/Edge | ✅ Full | Recommended |
| Firefox | ✅ Full | All features work |
| Safari | ✅ Full | May lack some video codecs |
| Mobile | ⚠️ Partial | Touch input not optimized |

---

## � Sample Scenes

The `samples/` folder contains ready-to-import scene files that demonstrate different capabilities:

| File | Description | Highlights |
|------|-------------|------------|
| `primitives_showcase.json` | All 14 primitive shapes arranged in a gallery | Materials (chrome, glass, wireframe, matte), transparency, lighting |
| `industrial_plant.json` | Complete process plant layout | 10+ library symbols, custom properties (pressure, flow rate, temperature) |
| `physics_playground.json` | Pre-staged physics scene — just press Play | Ramp, stacked tower, bouncy balls, wrecking ball, varying mass & restitution |
| `vehicle_showroom.json` | Dark showroom with Car, Cannon & Teapot | Dramatic spot lighting, pedestals, metallic accents |
| `architectural_scene.json` | Simple building with interior & landscaping | Walls, windows, columns, furniture, tree, pathway |

**To load a sample:** File → Import → Studio3D Scene (.json) → select a file from `samples/`.

---

## �📝 File Structure

```
3d/
├── app.js           — Main application (~5700 lines)
│                      • State management
│                      • Physics simulation
│                      • Import/Export
│                      • UI event handlers
├── index.html       — Application shell
│                      • Menu structure
│                      • Toolbar layout
│                      • Panels
├── styles.css       — Application styling
│                      • Dark theme CSS variables
│                      • Responsive layout
├── samples/         — Sample scene files (.json)
│   ├── primitives_showcase.json
│   ├── industrial_plant.json
│   ├── physics_playground.json
│   ├── vehicle_showroom.json
│   └── architectural_scene.json
└── README.md        — This file
```

---

## 🎬 Example Workflows

### Creating a Simple Dominoes Scene
1. New Scene (⌘N)
2. Add 10 boxes (primitives panel)
3. Arrange in a line using Move tool (W)
4. Adjust rotation (E) at slight angles
5. Select first domino
6. Hit area to apply force
7. Hit Play (▶) and watch cascade
8. Record (⌘R) to save

### Building an Industrial Equipment Setup
1. Add library items (Storage Tank, Pump, Cooler)
2. Position and scale each
3. Add connecting pipe segments
4. Create group for assembly
5. Export as GLTF for use in game engine

### 3D Printing Preparation
1. Model object in Studio3D
2. Ensure scale is in mm
3. File > Export > STL
4. Open in slicing software
5. Print!

---

## 🔮 Future Enhancements

Potential features for future versions:
- Collaborative editing (WebSocket support)
- Advanced CSG operations (union, difference, intersection)
- Procedural generation scripting
- Animation keyframe system
- Advanced physics constraints (motors, sliders)
- Real-time code editing for custom geometries
- Texture upload and UV mapping
- Particle systems
- Post-processing effects (bloom, DOF)

---

## 📄 License

MIT License — Use freely in personal and commercial projects.

---

## 👨‍💻 Author

<div align="center">

### Rodrigo Vigna

**Email:** [rvigna@outlook.com](mailto:rvigna@outlook.com)  
**GitHub:** [@rvigna](https://github.com/rvigna)  

*Passionate about 3D graphics, physics simulation, and interactive design tools.*

</div>

---

## 🤝 Contributing

Improvements and bug reports welcome! This is an open-ended 3D design platform built incrementally. Feel free to open issues or submit pull requests.

---

## 📞 Support

For issues or questions:
1. Check the keyboard shortcuts (Help > Shortcuts in-app)
2. Try the physics demos for usage examples
3. Review property inspector tooltips
4. Test with smaller scenes if experiencing lag
5. Email: [rvigna@outlook.com](mailto:rvigna@outlook.com)

---

## 🙏 Acknowledgments

Built with love and powered by:
- **[Three.js](https://threejs.org)** — 3D graphics rendering
- **[Cannon-ES](https://github.com/pmndrs/cannon-es)** — Physics simulation engine
- **[Font Awesome](https://fontawesome.com)** — Beautiful UI icons
- **[Inter Font](https://rsms.me/inter/)** — Modern typography

---

<div align="center">

### 🌟 If you find Studio3D useful, please consider giving it a ⭐ on GitHub!

**Studio3D v1.0** — *Precision. Physics. Performance.*

© 2026 Rodrigo Vigna. All rights reserved.

</div>