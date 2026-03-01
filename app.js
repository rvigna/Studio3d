import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import * as CANNON from 'cannon-es';

// Loaders & Exporters are loaded dynamically on demand to avoid
// startup failures if a module is unavailable in this Three.js version.
async function loadModule(path) {
  try {
    return await import(path);
  } catch (err) {
    console.error(`Failed to load module: ${path}`, err);
    throw new Error(`Module not available: ${path.split('/').pop()}`);
  }
}

// ─── Core State ───
const state = {
  objects: [],
  selected: null,
  multiSelected: [],  // for CSG: holds [objectA, objectB]
  undoStack: [],
  redoStack: [],
  snap: false,
  snapValue: 1,
  gridVisible: true,
  wireframeMode: false,
  transformMode: 'translate',
  transformSpace: 'world',
  objectCounter: 0,
  viewMode: false,
  clock: new THREE.Clock(),
  frameCount: 0,
  fpsTime: 0,
};

// ─── Physics State ───
const physics = {
  world: null,
  running: false,
  bodies: new Map(),         // Map<object.userData.id, CANNON.Body>
  savedTransforms: new Map(), // Map<object.userData.id, {pos, rot, scale}>
  groundBody: null,
  fixedTimeStep: 1 / 60,
  maxSubSteps: 10,
  constraints: [],            // CANNON.Constraint[] — cleared on reset
  anchorBodies: [],           // Static anchor bodies for pendulums
  pendulumVisuals: [],        // {stringMesh, pivotPos, ballObj} — updated each frame
  trails: [],                  // {line, positions, count, maxCount, trackedObj} — path trails
};

function cleanupTrails() {
  physics.trails.forEach(t => {
    scene.remove(t.line);
    t.line.geometry.dispose();
    t.line.material.dispose();
  });
  physics.trails = [];
}

function initPhysicsWorld() {
  physics.world = new CANNON.World({
    gravity: new CANNON.Vec3(0, -9.82, 0),
  });
  physics.world.broadphase = new CANNON.SAPBroadphase(physics.world);
  physics.world.allowSleep = true;

  // Solver tuning for performance
  physics.world.solver.iterations = 6;
  physics.world.solver.tolerance = 0.1;

  // Default contact material (avoids creating per-pair materials)
  physics.world.defaultContactMaterial.friction = 0.5;
  physics.world.defaultContactMaterial.restitution = 0.3;
  physics.world.defaultContactMaterial.contactEquationStiffness = 1e8;
  physics.world.defaultContactMaterial.contactEquationRelaxation = 3;

  // Ground plane
  const groundShape = new CANNON.Plane();
  physics.groundBody = new CANNON.Body({ mass: 0, shape: groundShape });
  physics.groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  physics.world.addBody(physics.groundBody);
}

function getPhysicsShape(obj) {
  // Create a CANNON shape that approximates the Three.js geometry
  if (!obj.geometry && obj.isGroup) {
    // For groups, compute bounding box
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    return new CANNON.Box(new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2));
  }
  if (!obj.geometry) return new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5));

  const geomType = obj.geometry.type;
  const p = obj.geometry.parameters || {};
  const sx = obj.scale.x, sy = obj.scale.y, sz = obj.scale.z;

  switch (geomType) {
    case 'BoxGeometry':
      return new CANNON.Box(new CANNON.Vec3(
        (p.width || 1) * sx / 2,
        (p.height || 1) * sy / 2,
        (p.depth || 1) * sz / 2
      ));
    case 'SphereGeometry':
      return new CANNON.Sphere((p.radius || 0.6) * Math.max(sx, sy, sz));
    case 'CylinderGeometry': {
      const r = Math.max(p.radiusTop || 0.5, p.radiusBottom || 0.5) * Math.max(sx, sz);
      const h = (p.height || 1) * sy;
      return new CANNON.Cylinder(r, r, h, 16);
    }
    case 'ConeGeometry': {
      const rr = (p.radius || 0.5) * Math.max(sx, sz);
      const hh = (p.height || 1) * sy;
      return new CANNON.Cylinder(0, rr, hh, 16);
    }
    case 'PlaneGeometry':
      return new CANNON.Box(new CANNON.Vec3(
        (p.width || 2) * sx / 2, 0.01, (p.height || 2) * sz / 2
      ));
    default: {
      // Fallback: compute bounding box from geometry
      obj.geometry.computeBoundingBox();
      const bb = obj.geometry.boundingBox;
      const halfExtents = new CANNON.Vec3(
        (bb.max.x - bb.min.x) * sx / 2,
        (bb.max.y - bb.min.y) * sy / 2,
        (bb.max.z - bb.min.z) * sz / 2
      );
      return new CANNON.Box(halfExtents);
    }
  }
}

function createPhysicsBody(obj) {
  const physProps = obj.userData.physics || {};
  const bodyType = physProps.bodyType || 'dynamic';
  const mass = bodyType === 'dynamic' ? (physProps.mass ?? 1) : 0;
  const friction = physProps.friction ?? 0.5;
  const restitution = physProps.restitution ?? 0.3;

  const shape = getPhysicsShape(obj);
  const body = new CANNON.Body({
    mass,
    shape,
    position: new CANNON.Vec3(obj.position.x, obj.position.y, obj.position.z),
    type: bodyType === 'kinematic' ? CANNON.Body.KINEMATIC :
          bodyType === 'static' ? CANNON.Body.STATIC : CANNON.Body.DYNAMIC,
    material: new CANNON.Material({ friction, restitution }),
    sleepSpeedLimit: 0.1,
    sleepTimeLimit: 0.5,
  });
  body.quaternion.set(obj.quaternion.x, obj.quaternion.y, obj.quaternion.z, obj.quaternion.w);
  body.allowSleep = true;

  // Disable collision response for idealized pendulum bobs etc.
  if (obj.userData.noCollision) {
    body.collisionResponse = false;
  }

  return body;
}

function enablePhysicsForObject(obj) {
  if (!obj || !obj.userData) return;
  const id = obj.userData.id;
  if (physics.bodies.has(id)) return; // already added

  if (!obj.userData.physics) {
    obj.userData.physics = { enabled: true, bodyType: 'dynamic', mass: 1, friction: 0.5, restitution: 0.3 };
  } else {
    obj.userData.physics.enabled = true;
  }

  const body = createPhysicsBody(obj);
  physics.bodies.set(id, body);

  if (physics.world) physics.world.addBody(body);
}

function disablePhysicsForObject(obj) {
  if (!obj || !obj.userData) return;
  const id = obj.userData.id;
  const body = physics.bodies.get(id);
  if (body && physics.world) physics.world.removeBody(body);
  physics.bodies.delete(id);
  if (obj.userData.physics) obj.userData.physics.enabled = false;
}

function updatePhysicsBody(obj) {
  const id = obj.userData.id;
  const body = physics.bodies.get(id);
  if (!body) return;
  const phys = obj.userData.physics || {};

  // Update mass & type
  const bodyType = phys.bodyType || 'dynamic';
  body.type = bodyType === 'kinematic' ? CANNON.Body.KINEMATIC :
              bodyType === 'static' ? CANNON.Body.STATIC : CANNON.Body.DYNAMIC;
  body.mass = bodyType === 'dynamic' ? (phys.mass ?? 1) : 0;
  body.updateMassProperties();

  // Update material
  body.material = new CANNON.Material({
    friction: phys.friction ?? 0.5,
    restitution: phys.restitution ?? 0.3,
  });
}

function savePhysicsTransforms() {
  physics.savedTransforms.clear();
  state.objects.forEach(obj => {
    physics.savedTransforms.set(obj.userData.id, {
      pos: obj.position.clone(),
      rot: obj.quaternion.clone(),
      scale: obj.scale.clone(),
    });
  });
}

function restorePhysicsTransforms() {
  state.objects.forEach(obj => {
    const saved = physics.savedTransforms.get(obj.userData.id);
    if (saved) {
      obj.position.copy(saved.pos);
      obj.quaternion.copy(saved.rot);
      obj.scale.copy(saved.scale);
    }
    // Also reset body position/velocity
    const body = physics.bodies.get(obj.userData.id);
    if (body) {
      body.position.set(obj.position.x, obj.position.y, obj.position.z);
      body.quaternion.set(obj.quaternion.x, obj.quaternion.y, obj.quaternion.z, obj.quaternion.w);
      body.velocity.setZero();
      body.angularVelocity.setZero();
      body.force.setZero();
      body.torque.setZero();
    }
  });
}

function startPhysics() {
  if (physics.running) return;
  if (!physics.world) initPhysicsWorld();

  // Save current transforms for reset
  savePhysicsTransforms();

  // Ensure all physics-enabled objects have bodies
  state.objects.forEach(obj => {
    if (obj.userData.physics?.enabled) {
      const id = obj.userData.id;
      if (!physics.bodies.has(id)) {
        const body = createPhysicsBody(obj);
        physics.bodies.set(id, body);
        physics.world.addBody(body);
      } else {
        // Sync body position to current mesh position
        const body = physics.bodies.get(id);
        body.position.set(obj.position.x, obj.position.y, obj.position.z);
        body.quaternion.set(obj.quaternion.x, obj.quaternion.y, obj.quaternion.z, obj.quaternion.w);
        body.velocity.setZero();
        body.angularVelocity.setZero();
      }
    }
  });

  // Create pendulum constraints (e.g. Newton's Cradle, Double Pendulum)
  let hasConstraints = false;
  // First pass: create constraints for bodies anchored to a static pivot
  state.objects.forEach(obj => {
    if (obj.userData.pendulumPivot && !obj.userData.pendulumParentId) {
      const pv = obj.userData.pendulumPivot;
      const ballBody = physics.bodies.get(obj.userData.id);
      if (ballBody) {
        hasConstraints = true;
        ballBody.allowSleep = false;
        ballBody.linearFactor.set(1, 1, 0);
        ballBody.angularFactor.set(0, 0, 0);
        ballBody.linearDamping = 0;
        ballBody.angularDamping = 0;

        const anchor = new CANNON.Body({ mass: 0 });
        anchor.position.set(pv.x, pv.y, pv.z);
        anchor.collisionResponse = false;
        physics.world.addBody(anchor);
        physics.anchorBodies.push(anchor);

        const dist = pv.stringLength;
        const constraint = new CANNON.DistanceConstraint(anchor, ballBody, dist);
        physics.world.addConstraint(constraint);
        physics.constraints.push(constraint);
      }
    }
  });
  // Second pass: create constraints for bodies chained to another dynamic body
  state.objects.forEach(obj => {
    if (obj.userData.pendulumParentId) {
      const childBody = physics.bodies.get(obj.userData.id);
      const parentBody = physics.bodies.get(obj.userData.pendulumParentId);
      if (childBody && parentBody) {
        hasConstraints = true;
        childBody.allowSleep = false;
        childBody.linearFactor.set(1, 1, 0);
        childBody.angularFactor.set(0, 0, 0);
        childBody.linearDamping = 0;
        childBody.angularDamping = 0;

        const dist = obj.userData.pendulumPivot?.stringLength || 2;
        const constraint = new CANNON.DistanceConstraint(parentBody, childBody, dist);
        physics.world.addConstraint(constraint);
        physics.constraints.push(constraint);
      }
    }
  });

  // Increase solver accuracy when constraints are present
  if (hasConstraints) {
    physics.world.solver.iterations = 20;
    physics.world.solver.tolerance = 0.001;
  }

  // Detach transform controls during simulation
  transformControls.detach();

  physics.running = true;

  // Apply initial impulses (used by physics demos)
  state.objects.forEach(obj => {
    if (obj.userData.initialImpulse) {
      const body = physics.bodies.get(obj.userData.id);
      if (body) {
        const imp = obj.userData.initialImpulse;
        body.applyImpulse(new CANNON.Vec3(imp.x, imp.y, imp.z));
      }
    }
  });

  document.getElementById('btn-physics-play').style.display = 'none';
  document.getElementById('btn-physics-pause').style.display = '';
  document.getElementById('btn-physics-reset').style.display = '';
  setStatus('Physics simulation running');
}

function pausePhysics() {
  physics.running = false;
  document.getElementById('btn-physics-play').style.display = '';
  document.getElementById('btn-physics-pause').style.display = 'none';
  setStatus('Physics paused');
}

function resetPhysics() {
  physics.running = false;

  restorePhysicsTransforms();

  // Destroy the physics world to prevent accumulated state (contact materials, etc.)
  physics.constraints.forEach(c => { if (physics.world) physics.world.removeConstraint(c); });
  physics.constraints = [];
  physics.anchorBodies.forEach(b => { if (physics.world) physics.world.removeBody(b); });
  physics.anchorBodies = [];
  physics.pendulumVisuals = [];
  // Clean up double pendulum trail
  cleanupTrails();
  physics.bodies.forEach((body) => { if (physics.world) physics.world.removeBody(body); });
  physics.bodies.clear();
  physics.world = null;
  physics.groundBody = null;

  document.getElementById('btn-physics-play').style.display = '';
  document.getElementById('btn-physics-pause').style.display = 'none';
  document.getElementById('btn-physics-reset').style.display = 'none';

  if (state.selected) updatePropertiesPanel();
  setStatus('Physics reset');
}

// ─── Physics Demo Scenes ───

function clearSceneForDemo() {
  // Reset physics
  if (physics.running) resetPhysics();
  physics.constraints.forEach(c => { if (physics.world) physics.world.removeConstraint(c); });
  physics.constraints = [];
  physics.anchorBodies.forEach(b => { if (physics.world) physics.world.removeBody(b); });
  physics.anchorBodies = [];
  physics.pendulumVisuals = [];
  physics.robotArm = null;
  cleanupTrails();
  physics.bodies.forEach((body) => { if (physics.world) physics.world.removeBody(body); });
  physics.bodies.clear();
  physics.savedTransforms.clear();

  // Remove all user objects
  [...state.objects].forEach(obj => {
    const helper = lightHelpers.get(obj.userData.id);
    if (helper) { scene.remove(helper); helper.dispose?.(); lightHelpers.delete(obj.userData.id); }
    scene.remove(obj);
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
      else obj.material.dispose();
    }
  });
  state.objects = [];
  state.selected = null;
  state.objectCounter = 0;
  transformControls.detach();
}

function addDemoObject(geom, mat, name, pos, rot, scale, physProps) {
  state.objectCounter++;
  // Apply polygon offset on static floor/ground objects to prevent z-fighting with grid
  if (physProps && physProps.bodyType === 'static') {
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = 1;
    mat.polygonOffsetUnits = 1;
  }
  const mesh = new THREE.Mesh(geom, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.position.set(pos.x, pos.y, pos.z);
  if (rot) mesh.rotation.set(rot.x, rot.y, rot.z);
  if (scale) mesh.scale.set(scale.x, scale.y, scale.z);
  mesh.userData = {
    name: name || `Demo_${state.objectCounter}`,
    type: 'box',
    id: THREE.MathUtils.generateUUID(),
    visible: true,
    locked: false,
    customProps: {},
    physics: physProps || { enabled: true, bodyType: 'dynamic', mass: 1, friction: 0.5, restitution: 0.3 },
  };
  scene.add(mesh);
  state.objects.push(mesh);
  return mesh;
}

function finishDemo(title) {
  selectObject(null);
  rebuildHierarchy();
  updateViewportInfo();
  document.getElementById('doc-title').value = title;
  setStatus(`Loaded demo: ${title}`);
}

function buildDominoes() {
  clearSceneForDemo();

  // Floor
  const floorGeo = new THREE.BoxGeometry(20, 0.2, 8);
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x8B7355, metalness: 0.1, roughness: 0.8 });
  addDemoObject(floorGeo, floorMat, 'Floor', { x: 5, y: -0.1, z: 0 }, null, null,
    { enabled: true, bodyType: 'static', mass: 0, friction: 0.6, restitution: 0.1 });

  // Dominoes - curved path for visual interest
  const dominoGeo = new THREE.BoxGeometry(0.15, 1.0, 0.5);
  const colors = [0x1a73e8, 0xe53935, 0x43a047, 0xfb8c00, 0x8e24aa, 0x00acc1];
  const count = 30;
  for (let i = 0; i < count; i++) {
    const t = i / count;
    // Gentle S-curve
    const x = -4 + i * 0.55;
    const z = Math.sin(t * Math.PI * 2) * 1.5;
    const angle = Math.atan2(
      Math.cos((i / count) * Math.PI * 2) * 1.5 * Math.PI * 2 / count,
      0.55
    );
    const color = colors[i % colors.length];
    const mat = new THREE.MeshStandardMaterial({ color, metalness: 0.2, roughness: 0.6 });
    addDemoObject(dominoGeo, mat, `Domino_${i + 1}`, { x, y: 0.5, z }, { x: 0, y: -angle, z: 0 }, null,
      { enabled: true, bodyType: 'dynamic', mass: 0.3, friction: 0.4, restitution: 0.1 });
  }

  // Pusher ball
  const ballGeo = new THREE.SphereGeometry(0.4, 32, 16);
  const ballMat = new THREE.MeshStandardMaterial({ color: 0xff1744, metalness: 0.4, roughness: 0.3 });
  const pusher = addDemoObject(ballGeo, ballMat, 'Pusher_Ball', { x: -5.5, y: 0.8, z: 0 }, null, null,
    { enabled: true, bodyType: 'dynamic', mass: 3, friction: 0.3, restitution: 0.2 });

  // Give the ball an initial velocity push (will be applied when physics starts via a custom impulse)
  pusher.userData.initialImpulse = { x: 8, y: 0, z: 0 };

  finishDemo('Domino Chain');
}

function buildBowling() {
  clearSceneForDemo();

  // Lane
  const laneGeo = new THREE.BoxGeometry(4, 0.1, 16);
  const laneMat = new THREE.MeshStandardMaterial({ color: 0xDEB887, metalness: 0.1, roughness: 0.4 });
  addDemoObject(laneGeo, laneMat, 'Lane', { x: 0, y: -0.05, z: 0 }, null, null,
    { enabled: true, bodyType: 'static', mass: 0, friction: 0.3, restitution: 0.1 });

  // Gutters
  const gutterGeo = new THREE.BoxGeometry(0.3, 0.3, 16);
  const gutterMat = new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0.3, roughness: 0.6 });
  addDemoObject(gutterGeo, gutterMat, 'Gutter_Left', { x: -2.15, y: 0.1, z: 0 }, null, null,
    { enabled: true, bodyType: 'static', mass: 0, friction: 0.5, restitution: 0.1 });
  addDemoObject(gutterGeo, gutterMat, 'Gutter_Right', { x: 2.15, y: 0.1, z: 0 }, null, null,
    { enabled: true, bodyType: 'static', mass: 0, friction: 0.5, restitution: 0.1 });

  // Pins (standard triangle formation)
  const pinGeo = new THREE.CylinderGeometry(0.08, 0.12, 0.7, 16);
  const pinMat = new THREE.MeshStandardMaterial({ color: 0xFFFAFA, metalness: 0.1, roughness: 0.5 });
  const pinPositions = [
    // Row 1 (front)
    { x: 0, z: -5 },
    // Row 2
    { x: -0.35, z: -5.55 }, { x: 0.35, z: -5.55 },
    // Row 3
    { x: -0.7, z: -6.1 }, { x: 0, z: -6.1 }, { x: 0.7, z: -6.1 },
    // Row 4 (back)
    { x: -1.05, z: -6.65 }, { x: -0.35, z: -6.65 }, { x: 0.35, z: -6.65 }, { x: 1.05, z: -6.65 },
  ];
  pinPositions.forEach((p, i) => {
    addDemoObject(pinGeo, pinMat.clone(), `Pin_${i + 1}`, { x: p.x, y: 0.35, z: p.z }, null, null,
      { enabled: true, bodyType: 'dynamic', mass: 0.5, friction: 0.4, restitution: 0.2 });
  });

  // Bowling ball
  const ballGeo = new THREE.SphereGeometry(0.35, 32, 16);
  const ballMat = new THREE.MeshStandardMaterial({ color: 0x1565C0, metalness: 0.5, roughness: 0.3 });
  const ball = addDemoObject(ballGeo, ballMat, 'Bowling_Ball', { x: 0, y: 0.35, z: 6 }, null, null,
    { enabled: true, bodyType: 'dynamic', mass: 6, friction: 0.3, restitution: 0.1 });
  ball.userData.initialImpulse = { x: 0, y: 0, z: -30 };

  // Camera position for bowling view
  camera.position.set(3, 4, 10);
  camera.lookAt(0, 0, -5);
  orbitControls.target.set(0, 0, -2);

  finishDemo('Bowling Alley');
}

function buildTower() {
  clearSceneForDemo();

  // Ground platform
  const groundGeo = new THREE.BoxGeometry(12, 0.3, 12);
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x607D8B, metalness: 0.2, roughness: 0.7 });
  addDemoObject(groundGeo, groundMat, 'Platform', { x: 0, y: -0.15, z: 0 }, null, null,
    { enabled: true, bodyType: 'static', mass: 0, friction: 0.7, restitution: 0.1 });

  // Tower layers — alternating perpendicular blocks (Jenga-style)
  const blockGeo = new THREE.BoxGeometry(0.8, 0.3, 2.4);
  const layerColors = [0xD7CCC8, 0xBCAAA4, 0xA1887F, 0x8D6E63, 0x795548, 0x6D4C41];
  const layers = 10;
  const blocksPerLayer = 3;
  const spacing = 0.82;

  for (let layer = 0; layer < layers; layer++) {
    const y = layer * 0.3 + 0.15;
    const rotY = (layer % 2 === 0) ? 0 : Math.PI / 2;
    const color = layerColors[layer % layerColors.length];
    const mat = new THREE.MeshStandardMaterial({ color, metalness: 0.1, roughness: 0.7 });

    for (let b = 0; b < blocksPerLayer; b++) {
      const offset = (b - 1) * spacing;
      const px = (layer % 2 === 0) ? offset : 0;
      const pz = (layer % 2 === 0) ? 0 : offset;
      addDemoObject(blockGeo, mat.clone(), `Block_L${layer + 1}_${b + 1}`,
        { x: px, y, z: pz }, { x: 0, y: rotY, z: 0 }, null,
        { enabled: true, bodyType: 'dynamic', mass: 0.4, friction: 0.6, restitution: 0.05 });
    }
  }

  // Wrecking ball on the side
  const ballGeo = new THREE.SphereGeometry(0.6, 32, 16);
  const ballMat = new THREE.MeshStandardMaterial({ color: 0xB71C1C, metalness: 0.6, roughness: 0.3 });
  const ball = addDemoObject(ballGeo, ballMat, 'Wrecking_Ball', { x: -5, y: 2, z: 0 }, null, null,
    { enabled: true, bodyType: 'dynamic', mass: 15, friction: 0.3, restitution: 0.3 });
  ball.userData.initialImpulse = { x: 50, y: 5, z: 0 };

  camera.position.set(6, 5, 8);
  camera.lookAt(0, 1.5, 0);
  orbitControls.target.set(0, 1.5, 0);

  finishDemo('Stacking Tower (Jenga)');
}

function buildRamp() {
  clearSceneForDemo();

  // Ground
  const groundGeo = new THREE.BoxGeometry(20, 0.2, 10);
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x78909C, metalness: 0.1, roughness: 0.8 });
  addDemoObject(groundGeo, groundMat, 'Ground', { x: 2, y: -0.1, z: 0 }, null, null,
    { enabled: true, bodyType: 'static', mass: 0, friction: 0.5, restitution: 0.2 });

  // Main ramp
  const rampGeo = new THREE.BoxGeometry(8, 0.3, 4);
  const rampMat = new THREE.MeshStandardMaterial({ color: 0x4CAF50, metalness: 0.2, roughness: 0.5 });
  addDemoObject(rampGeo, rampMat, 'Ramp', { x: -3, y: 2, z: 0 },
    { x: 0, y: 0, z: 0.35 }, null,
    { enabled: true, bodyType: 'static', mass: 0, friction: 0.3, restitution: 0.1 });

  // Second ramp (catch ramp, opposite angle)
  const ramp2Geo = new THREE.BoxGeometry(6, 0.3, 4);
  const ramp2Mat = new THREE.MeshStandardMaterial({ color: 0x2196F3, metalness: 0.2, roughness: 0.5 });
  addDemoObject(ramp2Geo, ramp2Mat, 'Ramp_2', { x: 5, y: 0.5, z: 0 },
    { x: 0, y: 0, z: -0.2 }, null,
    { enabled: true, bodyType: 'static', mass: 0, friction: 0.3, restitution: 0.1 });

  // Bumper wall at end
  const wallGeo = new THREE.BoxGeometry(0.3, 1.5, 5);
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xF44336, metalness: 0.3, roughness: 0.5 });
  addDemoObject(wallGeo, wallMat, 'Bumper_Wall', { x: 9, y: 0.75, z: 0 }, null, null,
    { enabled: true, bodyType: 'static', mass: 0, friction: 0.5, restitution: 0.8 });

  // Rolling objects at top of ramp
  const ballGeo = new THREE.SphereGeometry(0.3, 32, 16);
  const ballColors = [0xF44336, 0xFF9800, 0xFFEB3B, 0x4CAF50, 0x2196F3, 0x9C27B0];
  for (let i = 0; i < 6; i++) {
    const mat = new THREE.MeshStandardMaterial({ color: ballColors[i], metalness: 0.4, roughness: 0.3 });
    addDemoObject(ballGeo, mat, `Ball_${i + 1}`,
      { x: -6.5 + i * 0.2, y: 4.5 + i * 0.7, z: -1 + i * 0.4 }, null, null,
      { enabled: true, bodyType: 'dynamic', mass: 1 + i * 0.5, friction: 0.2, restitution: 0.6 });
  }

  // A cube and a cylinder for variety
  const cubeGeo = new THREE.BoxGeometry(0.6, 0.6, 0.6);
  const cubeMat = new THREE.MeshStandardMaterial({ color: 0xE91E63, metalness: 0.3, roughness: 0.4 });
  addDemoObject(cubeGeo, cubeMat, 'Tumbling_Cube', { x: -6, y: 5, z: 0.8 }, null, null,
    { enabled: true, bodyType: 'dynamic', mass: 1.5, friction: 0.5, restitution: 0.4 });

  const cylGeo = new THREE.CylinderGeometry(0.25, 0.25, 0.8, 32);
  const cylMat = new THREE.MeshStandardMaterial({ color: 0x00BCD4, metalness: 0.3, roughness: 0.4 });
  addDemoObject(cylGeo, cylMat, 'Rolling_Cylinder', { x: -5.5, y: 5.5, z: -0.5 },
    { x: 0, y: 0, z: Math.PI / 2 }, null,
    { enabled: true, bodyType: 'dynamic', mass: 1.2, friction: 0.3, restitution: 0.5 });

  camera.position.set(5, 6, 10);
  camera.lookAt(0, 1, 0);
  orbitControls.target.set(0, 1, 0);

  finishDemo('Ramp & Balls');
}

function buildNewtonsCradle() {
  clearSceneForDemo();

  const numBalls = 5;
  const ballRadius = 0.4;
  const spacing = ballRadius * 2;      // balls exactly touching
  const stringLength = 2.8;
  const pivotY = 4.0;
  const restY = pivotY - stringLength;  // ~1.2 — resting ball center
  const startX = -(numBalls - 1) * spacing / 2;
  const frameW = (numBalls - 1) * spacing + 2.0; // slightly wider than ball row

  // Frame material
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x37474F, metalness: 0.5, roughness: 0.3 });

  // Base
  const baseGeo = new THREE.BoxGeometry(frameW + 1, 0.15, 2);
  addDemoObject(baseGeo, frameMat.clone(), 'Base', { x: 0, y: -0.075, z: 0 }, null, null,
    { enabled: true, bodyType: 'static', mass: 0, friction: 0.5, restitution: 0.1 });

  // Upright posts
  const postH = pivotY;
  const postGeo = new THREE.CylinderGeometry(0.07, 0.07, postH, 16);
  const halfW = frameW / 2;
  addDemoObject(postGeo, frameMat.clone(), 'Post_LF', { x: -halfW, y: postH / 2, z: 0.6 }, null, null,
    { enabled: true, bodyType: 'static', mass: 0, friction: 0.3, restitution: 0.1 });
  addDemoObject(postGeo, frameMat.clone(), 'Post_LB', { x: -halfW, y: postH / 2, z: -0.6 }, null, null,
    { enabled: true, bodyType: 'static', mass: 0, friction: 0.3, restitution: 0.1 });
  addDemoObject(postGeo, frameMat.clone(), 'Post_RF', { x: halfW, y: postH / 2, z: 0.6 }, null, null,
    { enabled: true, bodyType: 'static', mass: 0, friction: 0.3, restitution: 0.1 });
  addDemoObject(postGeo, frameMat.clone(), 'Post_RB', { x: halfW, y: postH / 2, z: -0.6 }, null, null,
    { enabled: true, bodyType: 'static', mass: 0, friction: 0.3, restitution: 0.1 });

  // Top bars
  const barLen = frameW + 0.2;
  const barGeo = new THREE.CylinderGeometry(0.05, 0.05, barLen, 16);
  addDemoObject(barGeo, frameMat.clone(), 'Top_Bar_F', { x: 0, y: pivotY, z: 0.6 },
    { x: 0, y: 0, z: Math.PI / 2 }, null,
    { enabled: true, bodyType: 'static', mass: 0, friction: 0.3, restitution: 0.1 });
  addDemoObject(barGeo, frameMat.clone(), 'Top_Bar_B', { x: 0, y: pivotY, z: -0.6 },
    { x: 0, y: 0, z: Math.PI / 2 }, null,
    { enabled: true, bodyType: 'static', mass: 0, friction: 0.3, restitution: 0.1 });

  // String material
  const stringMat = new THREE.MeshStandardMaterial({ color: 0xAAAAAA, metalness: 0.1, roughness: 0.5 });
  const stringBaseLen = stringLength; // reference length for scale updates

  // Ball material
  const ballGeo = new THREE.SphereGeometry(ballRadius, 32, 16);
  const ballMat = new THREE.MeshStandardMaterial({ color: 0xC0C0C0, metalness: 0.85, roughness: 0.1 });

  // Pull angle for left ball (~40°)
  const pullAngle = Math.PI * 0.22;

  for (let i = 0; i < numBalls; i++) {
    const restX = startX + i * spacing;
    const pivotX = restX;
    const pivotZ = 0;

    // Ball position: leftmost is pulled back along pendulum arc
    let bx = restX;
    let by = restY;
    if (i === 0) {
      bx = pivotX - stringLength * Math.sin(pullAngle);
      by = pivotY - stringLength * Math.cos(pullAngle);
    }

    // Create ball
    const ball = addDemoObject(ballGeo, ballMat.clone(), `Ball_${i + 1}`,
      { x: bx, y: by, z: 0 }, null, null,
      { enabled: true, bodyType: 'dynamic', mass: 1, friction: 0.0, restitution: 1.0 });

    // Mark with pendulum pivot for constraint creation in startPhysics
    ball.userData.pendulumPivot = { x: pivotX, y: pivotY, z: pivotZ, stringLength };

    // Two strings per ball (front & back, like a real cradle)
    const stringGeo = new THREE.CylinderGeometry(0.012, 0.012, stringBaseLen, 6);
    for (const zOff of [0.3, -0.3]) {
      const pPos = { x: pivotX, y: pivotY, z: zOff };
      // Initial position: midpoint between pivot and ball
      const mx = (pPos.x + bx) / 2, my = (pPos.y + by) / 2, mz = (pPos.z + 0) / 2;
      const sMesh = addDemoObject(stringGeo, stringMat.clone(),
        `String_${i + 1}_${zOff > 0 ? 'F' : 'B'}`,
        { x: mx, y: my, z: mz }, null, null,
        { enabled: false, bodyType: 'static', mass: 0, friction: 0, restitution: 0 });
      sMesh.userData.baseLength = stringBaseLen;
      sMesh.castShadow = false;

      // Orient string toward ball
      const dir = new THREE.Vector3(bx - pPos.x, by - pPos.y, 0 - pPos.z).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      sMesh.quaternion.copy(q);

      // Register for visual updates during simulation
      physics.pendulumVisuals.push({ stringMesh: sMesh, pivotPos: pPos, ballObj: ball });
    }
  }

  camera.position.set(0, 3, 7);
  camera.lookAt(0, 2, 0);
  orbitControls.target.set(0, 2, 0);

  finishDemo("Newton's Cradle");
}

function buildDoublePendulum() {
  clearSceneForDemo();

  const pivotX = 0, pivotY = 5.5, pivotZ = 0;
  const arm1Len = 2.0;
  const arm2Len = 1.6;
  const mass1 = 2.0;
  const mass2 = 1.5;
  const bobRadius1 = 0.3;
  const bobRadius2 = 0.25;

  // Starting angle for first arm (~80° to the right for dramatic chaos)
  const angle1 = Math.PI * 0.45;
  // Second arm hangs straight down from first bob
  const angle2 = 0;

  // Position of bob 1
  const b1x = pivotX + arm1Len * Math.sin(angle1);
  const b1y = pivotY - arm1Len * Math.cos(angle1);
  // Position of bob 2
  const b2x = b1x + arm2Len * Math.sin(angle2);
  const b2y = b1y - arm2Len * Math.cos(angle2);

  // ─── Frame ───
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x37474F, metalness: 0.5, roughness: 0.3 });

  // Vertical post (visual only — no physics needed)
  const postGeo = new THREE.CylinderGeometry(0.06, 0.06, pivotY + 0.5, 16);
  addDemoObject(postGeo, frameMat.clone(), 'Support_Post',
    { x: pivotX, y: (pivotY + 0.5) / 2, z: pivotZ }, null, null,
    { enabled: false, bodyType: 'static', mass: 0, friction: 0, restitution: 0 });

  // Base plate
  const baseGeo = new THREE.BoxGeometry(3, 0.15, 2);
  addDemoObject(baseGeo, frameMat.clone(), 'Base_Plate',
    { x: pivotX, y: -0.075, z: pivotZ }, null, null,
    { enabled: true, bodyType: 'static', mass: 0, friction: 0.5, restitution: 0.1 });

  // Pivot decoration (small sphere)
  const pivotDeco = new THREE.SphereGeometry(0.1, 16, 8);
  addDemoObject(pivotDeco, frameMat.clone(), 'Pivot_Joint',
    { x: pivotX, y: pivotY, z: pivotZ }, null, null,
    { enabled: false, bodyType: 'static', mass: 0, friction: 0, restitution: 0 });

  // ─── Bob 1 (upper, red) ───
  const bob1Geo = new THREE.SphereGeometry(bobRadius1, 32, 16);
  const bob1Mat = new THREE.MeshStandardMaterial({ color: 0xE53935, metalness: 0.6, roughness: 0.2 });
  const bob1 = addDemoObject(bob1Geo, bob1Mat, 'Bob_1',
    { x: b1x, y: b1y, z: 0 }, null, null,
    { enabled: true, bodyType: 'dynamic', mass: mass1, friction: 0.0, restitution: 0.0 });
  const bob1Id = bob1.userData.id;
  // Mark as non-colliding (pendulum bobs shouldn't collide with each other or ground)
  bob1.userData.noCollision = true;

  // Mark bob 1 with pendulumPivot for static anchor constraint
  bob1.userData.pendulumPivot = { x: pivotX, y: pivotY, z: pivotZ, stringLength: arm1Len };

  // ─── Bob 2 (lower, blue) ───
  const bob2Geo = new THREE.SphereGeometry(bobRadius2, 32, 16);
  const bob2Mat = new THREE.MeshStandardMaterial({ color: 0x1E88E5, metalness: 0.6, roughness: 0.2 });
  const bob2 = addDemoObject(bob2Geo, bob2Mat, 'Bob_2',
    { x: b2x, y: b2y, z: 0 }, null, null,
    { enabled: true, bodyType: 'dynamic', mass: mass2, friction: 0.0, restitution: 0.0 });
  bob2.userData.noCollision = true;

  // Mark bob 2 to be chained to bob 1
  bob2.userData.pendulumParentId = bob1Id;
  bob2.userData.pendulumPivot = { x: b1x, y: b1y, z: 0, stringLength: arm2Len };

  // ─── Arm visuals (rigid rods) ───
  const stringMat = new THREE.MeshStandardMaterial({ color: 0xCCCCCC, metalness: 0.2, roughness: 0.4 });

  // Arm 1: pivot → bob 1
  const arm1Geo = new THREE.CylinderGeometry(0.025, 0.025, arm1Len, 8);
  const pivotPos1 = { x: pivotX, y: pivotY, z: pivotZ };
  const mx1 = (pivotX + b1x) / 2, my1 = (pivotY + b1y) / 2;
  const arm1Mesh = addDemoObject(arm1Geo, stringMat.clone(), 'Arm_1',
    { x: mx1, y: my1, z: 0 }, null, null,
    { enabled: false, bodyType: 'static', mass: 0, friction: 0, restitution: 0 });
  arm1Mesh.userData.baseLength = arm1Len;
  arm1Mesh.castShadow = false;
  const dir1 = new THREE.Vector3(b1x - pivotX, b1y - pivotY, 0).normalize();
  arm1Mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir1);
  physics.pendulumVisuals.push({ stringMesh: arm1Mesh, pivotPos: pivotPos1, ballObj: bob1 });

  // Arm 2: bob 1 → bob 2 (pivot follows bob1 dynamically)
  const arm2Geo = new THREE.CylinderGeometry(0.025, 0.025, arm2Len, 8);
  const mx2 = (b1x + b2x) / 2, my2 = (b1y + b2y) / 2;
  const arm2Mesh = addDemoObject(arm2Geo, stringMat.clone(), 'Arm_2',
    { x: mx2, y: my2, z: 0 }, null, null,
    { enabled: false, bodyType: 'static', mass: 0, friction: 0, restitution: 0 });
  arm2Mesh.userData.baseLength = arm2Len;
  arm2Mesh.castShadow = false;
  const dir2 = new THREE.Vector3(b2x - b1x, b2y - b1y, 0).normalize();
  arm2Mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir2);
  physics.pendulumVisuals.push({ stringMesh: arm2Mesh, pivotPos: null, pivotObj: bob1, ballObj: bob2 });

  // ─── Trail visualization ───
  // Bob 1 trail (red, semi-transparent)
  addTrailToObject(bob1, 0xE53935, 2000);
  // Bob 2 trail (blue)
  addTrailToObject(bob2, 0x1E88E5, 2000);

  camera.position.set(0, 4, 9);
  camera.lookAt(0, 3.5, 0);
  orbitControls.target.set(0, 3.5, 0);

  finishDemo('Double Pendulum');
}

// ─── Robot Arm Pickup Demo ───

function buildRobotArm() {
  clearSceneForDemo();

  // ─── Scene Setup ───
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x455A64, metalness: 0.2, roughness: 0.7 });
  const floorGeo = new THREE.BoxGeometry(16, 0.15, 10);
  addDemoObject(floorGeo, floorMat, 'Floor',
    { x: 0, y: -0.075, z: 0 }, null, null,
    { enabled: true, bodyType: 'static', mass: 0, friction: 0.8, restitution: 0.1 });

  // Pickup table (left)
  const tableMat = new THREE.MeshStandardMaterial({ color: 0x795548, metalness: 0.1, roughness: 0.8 });
  const tableTopGeo = new THREE.BoxGeometry(2.2, 0.12, 2.2);
  addDemoObject(tableTopGeo, tableMat.clone(), 'Pickup_Table_Top',
    { x: -3.5, y: 1.0, z: 0 }, null, null,
    { enabled: true, bodyType: 'static', mass: 0, friction: 0.6, restitution: 0.1 });
  // Table legs
  const legGeo = new THREE.CylinderGeometry(0.06, 0.06, 1.0, 8);
  for (const [lx, lz] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) {
    addDemoObject(legGeo.clone(), tableMat.clone(), 'Table_Leg',
      { x: -3.5 + lx, y: 0.5, z: lz }, null, null,
      { enabled: true, bodyType: 'static', mass: 0, friction: 0.3, restitution: 0.1 });
  }

  // Drop-off table (right)
  const dropMat = new THREE.MeshStandardMaterial({ color: 0x5D4037, metalness: 0.1, roughness: 0.8 });
  const dropTopGeo = new THREE.BoxGeometry(2.2, 0.12, 2.2);
  addDemoObject(dropTopGeo, dropMat.clone(), 'Dropoff_Table_Top',
    { x: 3.5, y: 1.0, z: 0 }, null, null,
    { enabled: true, bodyType: 'static', mass: 0, friction: 0.6, restitution: 0.1 });
  for (const [lx, lz] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) {
    addDemoObject(legGeo.clone(), dropMat.clone(), 'Table_Leg',
      { x: 3.5 + lx, y: 0.5, z: lz }, null, null,
      { enabled: true, bodyType: 'static', mass: 0, friction: 0.3, restitution: 0.1 });
  }

  // Target marker on drop table
  const markerGeo = new THREE.RingGeometry(0.15, 0.35, 32);
  const markerMat = new THREE.MeshBasicMaterial({ color: 0x4CAF50, side: THREE.DoubleSide, transparent: true, opacity: 0.6 });
  const marker = new THREE.Mesh(markerGeo, markerMat);
  marker.rotation.x = -Math.PI / 2;
  marker.position.set(3.5, 1.07, 0);
  scene.add(marker);
  // Store for cleanup
  state.objects.push(marker);
  marker.userData = { id: ++state.objectCounter, name: 'Target_Marker', physics: { enabled: false } };

  // ─── The Ball ───
  const ballRadius = 0.2;
  const ballGeo = new THREE.SphereGeometry(ballRadius, 32, 16);
  const ballMat = new THREE.MeshStandardMaterial({ color: 0xF44336, metalness: 0.4, roughness: 0.2 });
  const ball = addDemoObject(ballGeo, ballMat, 'Ball',
    { x: -3.5, y: 1.06 + ballRadius, z: 0 }, null, null,
    { enabled: true, bodyType: 'dynamic', mass: 0.5, friction: 0.5, restitution: 0.3 });

  // ─── Robot Arm (kinematic segments) ───
  const metalMat = new THREE.MeshStandardMaterial({ color: 0xB0BEC5, metalness: 0.7, roughness: 0.25 });
  const accentMat = new THREE.MeshStandardMaterial({ color: 0x1565C0, metalness: 0.5, roughness: 0.3 });
  const jointMat = new THREE.MeshStandardMaterial({ color: 0x37474F, metalness: 0.6, roughness: 0.3 });

  // Base pedestal
  const baseGeo = new THREE.CylinderGeometry(0.6, 0.7, 0.3, 32);
  addDemoObject(baseGeo, metalMat.clone(), 'Arm_Base',
    { x: 0, y: 0.15, z: 0 }, null, null,
    { enabled: true, bodyType: 'static', mass: 0, friction: 0.5, restitution: 0.1 });

  // Turntable (rotates around Y)
  const turntableGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.15, 32);
  const turntable = addDemoObject(turntableGeo, accentMat.clone(), 'Turntable',
    { x: 0, y: 0.375, z: 0 }, null, null,
    { enabled: true, bodyType: 'kinematic', mass: 0, friction: 0.3, restitution: 0.1 });

  // Shoulder joint
  const shoulderGeo = new THREE.SphereGeometry(0.2, 16, 12);
  const shoulder = addDemoObject(shoulderGeo, jointMat.clone(), 'Shoulder_Joint',
    { x: 0, y: 0.55, z: 0 }, null, null,
    { enabled: true, bodyType: 'kinematic', mass: 0, friction: 0.1, restitution: 0.1 });

  // Upper arm
  const upperArmLen = 1.4;
  const upperArmGeo = new THREE.BoxGeometry(0.16, upperArmLen, 0.16);
  const upperArm = addDemoObject(upperArmGeo, metalMat.clone(), 'Upper_Arm',
    { x: 0, y: 0.55 + upperArmLen / 2, z: 0 }, null, null,
    { enabled: true, bodyType: 'kinematic', mass: 0, friction: 0.1, restitution: 0.1 });

  // Elbow joint
  const elbowGeo = new THREE.SphereGeometry(0.15, 16, 12);
  const elbow = addDemoObject(elbowGeo, jointMat.clone(), 'Elbow_Joint',
    { x: 0, y: 0.55 + upperArmLen, z: 0 }, null, null,
    { enabled: true, bodyType: 'kinematic', mass: 0, friction: 0.1, restitution: 0.1 });

  // Forearm
  const forearmLen = 1.2;
  const forearmGeo = new THREE.BoxGeometry(0.13, forearmLen, 0.13);
  const forearm = addDemoObject(forearmGeo, metalMat.clone(), 'Forearm',
    { x: 0, y: 0.55 + upperArmLen + forearmLen / 2, z: 0 }, null, null,
    { enabled: true, bodyType: 'kinematic', mass: 0, friction: 0.1, restitution: 0.1 });

  // Wrist
  const wristGeo = new THREE.SphereGeometry(0.1, 16, 12);
  const wrist = addDemoObject(wristGeo, jointMat.clone(), 'Wrist',
    { x: 0, y: 0.55 + upperArmLen + forearmLen, z: 0 }, null, null,
    { enabled: true, bodyType: 'kinematic', mass: 0, friction: 0.1, restitution: 0.1 });

  // Gripper fingers
  const fingerLen = 0.35;
  const fingerGeo = new THREE.BoxGeometry(0.04, fingerLen, 0.1);
  const fingerMatL = accentMat.clone();
  const fingerMatR = accentMat.clone();
  const fingerL = addDemoObject(fingerGeo.clone(), fingerMatL, 'Finger_L',
    { x: -0.08, y: 0.55 + upperArmLen + forearmLen + fingerLen / 2, z: 0 }, null, null,
    { enabled: true, bodyType: 'kinematic', mass: 0, friction: 1.0, restitution: 0.0 });
  const fingerR = addDemoObject(fingerGeo.clone(), fingerMatR, 'Finger_R',
    { x: 0.08, y: 0.55 + upperArmLen + forearmLen + fingerLen / 2, z: 0 }, null, null,
    { enabled: true, bodyType: 'kinematic', mass: 0, friction: 1.0, restitution: 0.0 });

  // ─── Trail for ball ───
  addTrailToObject(ball, 0xF44336, 3000);

  // ─── Store robot arm state for animation ───
  const shoulderY = 0.55;
  physics.robotArm = {
    // References
    turntable,
    shoulder,
    upperArm,
    elbow,
    forearm,
    wrist,
    fingerL,
    fingerR,
    ball,
    // Geometry
    shoulderY,
    upperArmLen,
    forearmLen,
    fingerLen,
    // Animation state
    phase: 'WAIT',       // WAIT → REACH → GRAB → LIFT → ROTATE → LOWER → RELEASE → RETURN → DONE
    phaseTime: 0,
    totalTime: 0,
    baseAngle: 0,        // Y rotation of turntable (radians)
    shoulderAngle: 0,    // Forward tilt of upper arm (radians, 0=vertical)
    elbowAngle: 0,       // Bend of forearm relative to upper arm
    gripOpen: 1,         // 1=open, 0=closed
    grabbed: false,
    grabConstraint: null,
    // Targets
    pickupPos: new THREE.Vector3(-3.5, 1.06 + ballRadius, 0),
    dropoffPos: new THREE.Vector3(3.5, 1.06 + ballRadius, 0),
    pickupAngle: Math.PI / 2,    // Base rotation to face pickup table (left)
    dropoffAngle: -Math.PI / 2,  // Base rotation to face dropoff table (right)
  };

  camera.position.set(5, 5, 8);
  camera.lookAt(0, 1.5, 0);
  orbitControls.target.set(0, 1.5, 0);

  finishDemo('Robot Arm Pickup');

  // Draw initial arm pose so it's visible before Play is pressed
  updateArmPose(physics.robotArm);

  // Auto-start physics — the arm is fully animated, no manual setup needed
  startPhysics();
}

// ─── Robot Arm IK & Animation ───

function solveArmIK(arm, targetX, targetY, targetZ) {
  // Simple 2-link IK in the plane defined by the base rotation
  // Returns { shoulderAngle, elbowAngle, baseAngle } or null if unreachable
  const dx = targetX;
  const dz = targetZ;
  const baseAngle = Math.atan2(-dx, -dz) + Math.PI; // Angle to face target

  // Distance in the horizontal plane from base
  const horizDist = Math.sqrt(dx * dx + dz * dz);
  // Vertical distance from shoulder
  const vertDist = targetY - arm.shoulderY;

  // Distance from shoulder to target in the arm's plane
  const L1 = arm.upperArmLen;
  const L2 = arm.forearmLen + arm.fingerLen * 0.7; // Effective reach including part of gripper
  const dist = Math.sqrt(horizDist * horizDist + vertDist * vertDist);

  if (dist > L1 + L2) {
    // Out of reach — extend fully toward target
    const angle = Math.atan2(horizDist, vertDist);
    return { baseAngle, shoulderAngle: angle, elbowAngle: 0 };
  }
  if (dist < Math.abs(L1 - L2) + 0.05) {
    return { baseAngle, shoulderAngle: 0, elbowAngle: Math.PI * 0.8 };
  }

  // Law of cosines
  const cosElbow = (L1 * L1 + L2 * L2 - dist * dist) / (2 * L1 * L2);
  const elbowAngle = Math.PI - Math.acos(Math.max(-1, Math.min(1, cosElbow)));

  const cosAlpha = (L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist);
  const alpha = Math.acos(Math.max(-1, Math.min(1, cosAlpha)));
  const beta = Math.atan2(horizDist, vertDist);
  const shoulderAngle = beta - alpha;

  return { baseAngle, shoulderAngle, elbowAngle };
}

function updateArmPose(arm) {
  const { turntable, shoulder, upperArm, elbow, forearm, wrist, fingerL, fingerR,
          shoulderY, upperArmLen, forearmLen, fingerLen, baseAngle, shoulderAngle, elbowAngle, gripOpen } = arm;

  // Turntable rotation
  turntable.rotation.y = baseAngle;
  const tBody = physics.bodies.get(turntable.userData.id);
  if (tBody) {
    tBody.quaternion.setFromEuler(0, baseAngle, 0);
    tBody.position.set(turntable.position.x, turntable.position.y, turntable.position.z);
  }

  // Build arm chain in arm's local plane (rotated by baseAngle around Y)
  // Direction vectors in world space
  const sinB = Math.sin(baseAngle);
  const cosB = Math.cos(baseAngle);

  // Shoulder position (fixed)
  const sx = 0, sy = shoulderY, sz = 0;

  // Upper arm direction: tilt by shoulderAngle in the arm's plane
  // In arm-local coords: forward = sin(shoulderAngle), up = cos(shoulderAngle)
  const uaDirLocal = { fwd: Math.sin(shoulderAngle), up: -Math.cos(shoulderAngle) };
  // Upper arm endpoint
  const uaEndX = sx + uaDirLocal.fwd * upperArmLen * sinB;
  const uaEndY = sy + uaDirLocal.up * upperArmLen;  // Note: negative cos means going up when angle=0
  const uaEndZ = sz + uaDirLocal.fwd * upperArmLen * cosB;

  // Wait, let me reconsider: shoulderAngle=0 means vertical (arm pointing up)
  // As shoulderAngle increases, arm tilts forward (toward target)
  // "Forward" in arm-local plane is in the direction (sinB, 0, cosB)

  // Correction: upper arm goes from shoulder downward/forward
  // angle=0 → pointing straight up, angle=PI/2 → horizontal forward
  // The arm hangs from the shoulder, so direction is:
  // local_x = sin(shoulderAngle) (forward), local_y = -cos(shoulderAngle) (down when angle=0...no)
  // Actually let's think of it as: arm starts pointing straight up at angle=0
  // we want it natural: angle=0 = straight up, positive angle = tilt toward target
  const ua_fwd = Math.sin(shoulderAngle);
  const ua_up = Math.cos(shoulderAngle);

  const uaEnd = new THREE.Vector3(
    sx + ua_fwd * upperArmLen * sinB,
    sy + ua_up * upperArmLen,
    sz + ua_fwd * upperArmLen * cosB
  );

  // Upper arm midpoint and orientation
  const uaMid = new THREE.Vector3(
    (sx + uaEnd.x) / 2,
    (sy + uaEnd.y) / 2,
    (sz + uaEnd.z) / 2
  );
  upperArm.position.copy(uaMid);
  const uaDir = new THREE.Vector3(uaEnd.x - sx, uaEnd.y - sy, uaEnd.z - sz).normalize();
  upperArm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), uaDir);

  // Shoulder visual
  shoulder.position.set(sx, sy, sz);
  shoulder.rotation.y = baseAngle;

  // Elbow position = upper arm endpoint
  elbow.position.copy(uaEnd);

  // Forearm direction: relative to upper arm, bend by elbowAngle
  const totalAngle = shoulderAngle - elbowAngle;
  const fa_fwd = Math.sin(totalAngle);
  const fa_up = Math.cos(totalAngle);

  const faEnd = new THREE.Vector3(
    uaEnd.x + fa_fwd * forearmLen * sinB,
    uaEnd.y + fa_up * forearmLen,
    uaEnd.z + fa_fwd * forearmLen * cosB
  );

  const faMid = new THREE.Vector3(
    (uaEnd.x + faEnd.x) / 2,
    (uaEnd.y + faEnd.y) / 2,
    (uaEnd.z + faEnd.z) / 2
  );
  forearm.position.copy(faMid);
  const faDir = new THREE.Vector3(faEnd.x - uaEnd.x, faEnd.y - uaEnd.y, faEnd.z - uaEnd.z).normalize();
  forearm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), faDir);

  // Wrist = forearm endpoint
  wrist.position.copy(faEnd);

  // Fingers extend from wrist in same direction as forearm
  const gripSpread = 0.04 + gripOpen * 0.1; // 0.04 (closed) to 0.14 (open)
  // Perpendicular to arm direction, in the plane containing the arm
  const perpX = cosB;
  const perpZ = -sinB;

  const fingerMid = new THREE.Vector3(
    faEnd.x + faDir.x * fingerLen / 2,
    faEnd.y + faDir.y * fingerLen / 2,
    faEnd.z + faDir.z * fingerLen / 2
  );

  fingerL.position.set(
    fingerMid.x - perpX * gripSpread,
    fingerMid.y,
    fingerMid.z - perpZ * gripSpread
  );
  fingerL.quaternion.copy(forearm.quaternion);

  fingerR.position.set(
    fingerMid.x + perpX * gripSpread,
    fingerMid.y,
    fingerMid.z + perpZ * gripSpread
  );
  fingerR.quaternion.copy(forearm.quaternion);

  // Sync kinematic bodies
  [turntable, shoulder, upperArm, elbow, forearm, wrist, fingerL, fingerR].forEach(obj => {
    const body = physics.bodies.get(obj.userData.id);
    if (body) {
      body.position.set(obj.position.x, obj.position.y, obj.position.z);
      body.quaternion.set(obj.quaternion.x, obj.quaternion.y, obj.quaternion.z, obj.quaternion.w);
    }
  });

  // Return wrist/gripper tip position for grab logic
  return { wristPos: faEnd.clone(), tipPos: fingerMid.clone(), gripDir: faDir.clone() };
}

function lerp(a, b, t) { return a + (b - a) * Math.max(0, Math.min(1, t)); }
function smoothstep(t) { const s = Math.max(0, Math.min(1, t)); return s * s * (3 - 2 * s); }

function stepRobotArm(dt) {
  const arm = physics.robotArm;
  if (!arm || arm.phase === 'DONE') return;

  arm.phaseTime += dt;
  arm.totalTime += dt;

  // Wait before starting
  if (arm.phase === 'WAIT') {
    if (arm.phaseTime > 0.8) {
      arm.phase = 'ROTATE_TO_PICK';
      arm.phaseTime = 0;
    }
    updateArmPose(arm);
    return;
  }

  const phaseDuration = {
    'ROTATE_TO_PICK': 1.2,
    'REACH': 1.5,
    'GRAB': 0.5,
    'LIFT': 1.2,
    'ROTATE_TO_DROP': 1.8,
    'LOWER': 1.2,
    'RELEASE': 0.4,
    'RETURN': 1.5,
  };

  const dur = phaseDuration[arm.phase] || 1.0;
  const t = smoothstep(arm.phaseTime / dur);

  switch (arm.phase) {
    case 'ROTATE_TO_PICK': {
      // Rotate base to face the pickup table
      arm.baseAngle = lerp(0, arm.pickupAngle, t);
      arm.shoulderAngle = lerp(0, 0.15, t); // Slight tilt forward
      arm.elbowAngle = 0;
      arm.gripOpen = 1;
      break;
    }
    case 'REACH': {
      // IK to reach toward the ball
      const ik = solveArmIK(arm, arm.pickupPos.x, arm.pickupPos.y + 0.05, arm.pickupPos.z);
      if (ik) {
        arm.baseAngle = lerp(arm.pickupAngle, ik.baseAngle, t);
        arm.shoulderAngle = lerp(0.15, ik.shoulderAngle, t);
        arm.elbowAngle = lerp(0, ik.elbowAngle, t);
      }
      arm.gripOpen = 1;
      break;
    }
    case 'GRAB': {
      // Close gripper
      arm.gripOpen = lerp(1, 0, t);
      if (t >= 1 && !arm.grabbed) {
        // Attach ball to gripper with a lock constraint
        const ballBody = physics.bodies.get(arm.ball.userData.id);
        const fingerBody = physics.bodies.get(arm.fingerL.userData.id);
        if (ballBody && fingerBody) {
          ballBody.type = CANNON.Body.KINEMATIC;
          ballBody.mass = 0;
          ballBody.updateMassProperties();
          arm.grabbed = true;
        }
      }
      break;
    }
    case 'LIFT': {
      // Raise arm upward (reduce shoulder angle toward vertical)
      const ik = solveArmIK(arm, arm.pickupPos.x, arm.pickupPos.y + 0.05, arm.pickupPos.z);
      const liftShoulder = 0.3;
      const liftElbow = 0.2;
      arm.shoulderAngle = lerp(ik ? ik.shoulderAngle : arm.shoulderAngle, liftShoulder, t);
      arm.elbowAngle = lerp(ik ? ik.elbowAngle : arm.elbowAngle, liftElbow, t);
      arm.gripOpen = 0;
      break;
    }
    case 'ROTATE_TO_DROP': {
      // Swing base from pickup side to dropoff side
      arm.baseAngle = lerp(arm.pickupAngle, arm.dropoffAngle, t);
      arm.shoulderAngle = 0.3;
      arm.elbowAngle = 0.2;
      arm.gripOpen = 0;
      break;
    }
    case 'LOWER': {
      // Lower arm to dropoff position
      const ik = solveArmIK(arm, arm.dropoffPos.x, arm.dropoffPos.y + 0.05, arm.dropoffPos.z);
      if (ik) {
        arm.shoulderAngle = lerp(0.3, ik.shoulderAngle, t);
        arm.elbowAngle = lerp(0.2, ik.elbowAngle, t);
        arm.baseAngle = lerp(arm.dropoffAngle, ik.baseAngle, t);
      }
      arm.gripOpen = 0;
      break;
    }
    case 'RELEASE': {
      // Open gripper and release ball
      arm.gripOpen = lerp(0, 1, t);
      if (t >= 0.3 && arm.grabbed) {
        const ballBody = physics.bodies.get(arm.ball.userData.id);
        if (ballBody) {
          ballBody.type = CANNON.Body.DYNAMIC;
          ballBody.mass = 0.5;
          ballBody.updateMassProperties();
          ballBody.velocity.setZero();
          arm.grabbed = false;
        }
      }
      break;
    }
    case 'RETURN': {
      // Return arm to home position
      const ik = solveArmIK(arm, arm.dropoffPos.x, arm.dropoffPos.y + 0.05, arm.dropoffPos.z);
      arm.baseAngle = lerp(arm.dropoffAngle, 0, t);
      arm.shoulderAngle = lerp(ik ? ik.shoulderAngle : arm.shoulderAngle, 0, t);
      arm.elbowAngle = lerp(ik ? ik.elbowAngle : arm.elbowAngle, 0, t);
      arm.gripOpen = 1;
      break;
    }
  }

  // Update arm visual positions
  const pose = updateArmPose(arm);

  // If ball is grabbed, move it with the gripper tip
  if (arm.grabbed && pose) {
    const ballBody = physics.bodies.get(arm.ball.userData.id);
    if (ballBody) {
      ballBody.position.set(pose.tipPos.x, pose.tipPos.y, pose.tipPos.z);
      ballBody.velocity.setZero();
      arm.ball.position.copy(pose.tipPos);
    }
  }

  // Phase transitions
  if (arm.phaseTime >= dur) {
    const transitions = {
      'ROTATE_TO_PICK': 'REACH',
      'REACH': 'GRAB',
      'GRAB': 'LIFT',
      'LIFT': 'ROTATE_TO_DROP',
      'ROTATE_TO_DROP': 'LOWER',
      'LOWER': 'RELEASE',
      'RELEASE': 'RETURN',
      'RETURN': 'DONE',
    };
    arm.phase = transitions[arm.phase] || 'DONE';
    arm.phaseTime = 0;
  }
}

function addTrailToObject(obj, color, maxPoints) {
  const max = maxPoints || 800;
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(max * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setDrawRange(0, 0);
  const mat = new THREE.LineBasicMaterial({ color: color || 0xffffff, opacity: 0.6, transparent: true });
  const line = new THREE.Line(geo, mat);
  scene.add(line);
  physics.trails.push({ line, positions, count: 0, maxCount: max, trackedObj: obj });
}

function buildProjectileTrajectory() {
  clearSceneForDemo();

  // Ground
  const groundGeo = new THREE.BoxGeometry(40, 0.15, 12);
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x5D8233, metalness: 0.05, roughness: 0.9 });
  addDemoObject(groundGeo, groundMat, 'Ground', { x: 10, y: -0.075, z: 0 }, null, null,
    { enabled: true, bodyType: 'static', mass: 0, friction: 0.6, restitution: 0.2 });

  // Launch pad / cannon base
  const padGeo = new THREE.BoxGeometry(2, 0.5, 2);
  const padMat = new THREE.MeshStandardMaterial({ color: 0x455A64, metalness: 0.4, roughness: 0.5 });
  addDemoObject(padGeo, padMat, 'Launch_Pad', { x: -8, y: 0.25, z: 0 }, null, null,
    { enabled: true, bodyType: 'static', mass: 0, friction: 0.5, restitution: 0.1 });

  // Cannon barrel (tilted cylinder)
  const barrelGeo = new THREE.CylinderGeometry(0.2, 0.25, 2.5, 16);
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x37474F, metalness: 0.6, roughness: 0.3 });
  addDemoObject(barrelGeo, barrelMat, 'Cannon_Barrel', { x: -7.5, y: 1.2, z: 0 },
    { x: 0, y: 0, z: Math.PI / 6 }, null,
    { enabled: true, bodyType: 'static', mass: 0, friction: 0.3, restitution: 0.1 });

  // Target wall
  const wallGeo = new THREE.BoxGeometry(0.4, 4, 6);
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xB71C1C, metalness: 0.2, roughness: 0.6 });
  addDemoObject(wallGeo, wallMat, 'Target_Wall', { x: 22, y: 2, z: 0 }, null, null,
    { enabled: true, bodyType: 'static', mass: 0, friction: 0.5, restitution: 0.3 });

  // Target stacked boxes on wall
  const targetGeo = new THREE.BoxGeometry(0.8, 0.8, 0.8);
  const targetColors = [0xFFC107, 0xFF9800, 0xFF5722, 0xF44336, 0xE91E63, 0x9C27B0];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const tMat = new THREE.MeshStandardMaterial({
        color: targetColors[(row * 3 + col) % targetColors.length], metalness: 0.2, roughness: 0.5
      });
      addDemoObject(targetGeo, tMat, `Target_${row}_${col}`,
        { x: 21, y: 0.4 + row * 0.82, z: -0.85 + col * 0.85 }, null, null,
        { enabled: true, bodyType: 'dynamic', mass: 0.5, friction: 0.4, restitution: 0.2 });
    }
  }

  // ─── Projectiles at different angles ───
  const launchX = -7;
  const launchY = 1.8;
  const angles = [
    { deg: 30, speed: 18, color: 0xF44336, label: '30°' },
    { deg: 45, speed: 18, color: 0x4CAF50, label: '45°' },
    { deg: 60, speed: 18, color: 0x2196F3, label: '60°' },
  ];

  angles.forEach((cfg, i) => {
    const rad = (cfg.deg * Math.PI) / 180;
    const vx = cfg.speed * Math.cos(rad);
    const vy = cfg.speed * Math.sin(rad);
    const zOffset = -2 + i * 2; // spread projectiles along Z

    const ballGeo = new THREE.SphereGeometry(0.2, 24, 12);
    const ballMat = new THREE.MeshStandardMaterial({ color: cfg.color, metalness: 0.5, roughness: 0.2 });
    const ball = addDemoObject(ballGeo, ballMat, `Projectile_${cfg.label}`,
      { x: launchX, y: launchY, z: zOffset }, null, null,
      { enabled: true, bodyType: 'dynamic', mass: 2, friction: 0.3, restitution: 0.4 });
    ball.userData.initialImpulse = { x: vx * 2, y: vy * 2, z: 0 };

    // Add trail
    addTrailToObject(ball, cfg.color, 1000);
  });

  // ─── Theoretical parabola overlays (dashed lines) ───
  // Show the analytical trajectory for comparison
  angles.forEach((cfg, i) => {
    const rad = (cfg.deg * Math.PI) / 180;
    const v0 = cfg.speed;
    const vx = v0 * Math.cos(rad);
    const vy = v0 * Math.sin(rad);
    const g = 9.82;
    const zOffset = -2 + i * 2;

    // Compute total flight time (until y returns to launchY)
    const tFlight = (2 * vy) / g;
    const steps = 100;
    const points = [];
    for (let s = 0; s <= steps; s++) {
      const t = (s / steps) * tFlight * 1.1; // 10% extra
      const px = launchX + vx * t;
      const py = launchY + vy * t - 0.5 * g * t * t;
      if (py < 0) break;
      points.push(new THREE.Vector3(px, py, zOffset));
    }

    const curve = new THREE.BufferGeometry().setFromPoints(points);
    const dashMat = new THREE.LineDashedMaterial({
      color: cfg.color, dashSize: 0.3, gapSize: 0.15, opacity: 0.4, transparent: true
    });
    const dashLine = new THREE.Line(curve, dashMat);
    dashLine.computeLineDistances();
    scene.add(dashLine);
    // Track for cleanup (store on trails system with no trackedObj)
    physics.trails.push({
      line: dashLine,
      positions: null,
      count: 0,
      maxCount: 0,
      trackedObj: null, // static — no updates needed
    });
  });

  // ─── Angle labels (small text sprites) ───
  angles.forEach((cfg, i) => {
    const zOffset = -2 + i * 2;
    const canvas2d = document.createElement('canvas');
    canvas2d.width = 128;
    canvas2d.height = 64;
    const ctx = canvas2d.getContext('2d');
    ctx.fillStyle = '#' + cfg.color.toString(16).padStart(6, '0');
    ctx.font = 'bold 36px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(cfg.label, 64, 42);

    const tex = new THREE.CanvasTexture(canvas2d);
    const spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.position.set(launchX - 1.5, launchY + 0.5, zOffset);
    sprite.scale.set(1.5, 0.75, 1);
    scene.add(sprite);

    // Track sprite for cleanup via a fake trail entry
    const fakeGeo = new THREE.BufferGeometry();
    const fakeLine = new THREE.Line(fakeGeo, new THREE.LineBasicMaterial());
    fakeLine.visible = false;
    scene.add(fakeLine);
    // We'll clean up the sprite manually — store reference
    sprite.userData._cleanupSprite = true;
    state.objects.push(sprite);
    sprite.userData = {
      name: `Label_${cfg.label}`,
      type: 'sprite',
      id: THREE.MathUtils.generateUUID(),
      visible: true,
      locked: true,
      customProps: {},
      physics: { enabled: false },
    };
  });

  camera.position.set(8, 10, 16);
  camera.lookAt(8, 2, 0);
  orbitControls.target.set(8, 2, 0);

  finishDemo('Projectile Trajectory');
}

function loadPhysicsDemo(demo) {
  switch (demo) {
    case 'dominoes': buildDominoes(); break;
    case 'bowling': buildBowling(); break;
    case 'tower': buildTower(); break;
    case 'ramp': buildRamp(); break;
    case 'cradle': buildNewtonsCradle(); break;
    case 'double-pendulum': buildDoublePendulum(); break;
    case 'projectile': buildProjectileTrajectory(); break;
    case 'robot-arm': buildRobotArm(); break;
  }
}

function stepPhysics(dt) {
  if (!physics.running || !physics.world) return;

  // ─── Robot Arm Animation ───
  if (physics.robotArm) stepRobotArm(dt);

  physics.world.step(physics.fixedTimeStep, dt, physics.maxSubSteps);

  // Sync Three.js objects to CANNON bodies
  state.objects.forEach(obj => {
    const body = physics.bodies.get(obj.userData.id);
    if (!body) return;
    if (body.type === CANNON.Body.STATIC) return;

    obj.position.set(body.position.x, body.position.y, body.position.z);
    obj.quaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
  });

  // Update pendulum string visuals (pivot → ball)
  physics.pendulumVisuals.forEach(({ stringMesh, pivotPos, pivotObj, ballObj }) => {
    // For chained pendulums, the pivot follows another body dynamically
    const px = pivotObj ? pivotObj.position.x : pivotPos.x;
    const py = pivotObj ? pivotObj.position.y : pivotPos.y;
    const pz = pivotObj ? pivotObj.position.z : pivotPos.z;
    const bx = ballObj.position.x, by = ballObj.position.y, bz = ballObj.position.z;
    // Midpoint
    stringMesh.position.set((px + bx) / 2, (py + by) / 2, (pz + bz) / 2);
    // Direction & length
    const dx = bx - px, dy = by - py, dz = bz - pz;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    stringMesh.scale.y = len / (stringMesh.userData.baseLength || 1);
    // Orient cylinder Y axis along direction
    const dir = new THREE.Vector3(dx, dy, dz).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    stringMesh.quaternion.copy(q);
  });

  // Update all trails
  physics.trails.forEach(trail => {
    const obj = trail.trackedObj;
    if (obj && trail.count < trail.maxCount) {
      const idx = trail.count * 3;
      trail.positions[idx] = obj.position.x;
      trail.positions[idx + 1] = obj.position.y;
      trail.positions[idx + 2] = obj.position.z;
      trail.count++;
      trail.line.geometry.setDrawRange(0, trail.count);
      trail.line.geometry.attributes.position.needsUpdate = true;
    }
  });
}

function updatePhysicsPanel() {
  const obj = state.selected;
  if (!obj) return;

  const phys = obj.userData.physics || { enabled: false, bodyType: 'dynamic', mass: 1, friction: 0.5, restitution: 0.3 };
  document.getElementById('phys-enabled').checked = !!phys.enabled;
  document.getElementById('phys-body-type').value = phys.bodyType || 'dynamic';
  document.getElementById('phys-mass').value = phys.mass ?? 1;
  document.getElementById('phys-friction').value = phys.friction ?? 0.5;
  document.getElementById('phys-restitution').value = phys.restitution ?? 0.3;
}

function setupPhysicsListeners() {
  document.getElementById('btn-physics-play').addEventListener('click', startPhysics);
  document.getElementById('btn-physics-pause').addEventListener('click', pausePhysics);
  document.getElementById('btn-physics-reset').addEventListener('click', resetPhysics);

  document.getElementById('phys-enabled').addEventListener('change', (e) => {
    if (!state.selected) return;
    if (e.target.checked) {
      enablePhysicsForObject(state.selected);
    } else {
      disablePhysicsForObject(state.selected);
    }
  });

  document.getElementById('phys-body-type').addEventListener('change', (e) => {
    if (!state.selected?.userData.physics) return;
    state.selected.userData.physics.bodyType = e.target.value;
    // Mass is 0 for static/kinematic
    if (e.target.value !== 'dynamic') {
      document.getElementById('phys-mass').value = 0;
      state.selected.userData.physics.mass = 0;
    } else {
      document.getElementById('phys-mass').value = 1;
      state.selected.userData.physics.mass = 1;
    }
    updatePhysicsBody(state.selected);
  });

  document.getElementById('phys-mass').addEventListener('input', (e) => {
    if (!state.selected?.userData.physics) return;
    state.selected.userData.physics.mass = parseFloat(e.target.value) || 0;
    updatePhysicsBody(state.selected);
  });

  document.getElementById('phys-friction').addEventListener('input', (e) => {
    if (!state.selected?.userData.physics) return;
    state.selected.userData.physics.friction = parseFloat(e.target.value);
    updatePhysicsBody(state.selected);
  });

  document.getElementById('phys-restitution').addEventListener('input', (e) => {
    if (!state.selected?.userData.physics) return;
    state.selected.userData.physics.restitution = parseFloat(e.target.value);
    updatePhysicsBody(state.selected);
  });
}

// ─── Three.js Setup ───
const canvas = document.getElementById('viewport');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#2a2a3e');

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
camera.position.set(6, 5, 8);
camera.lookAt(0, 0, 0);

// ─── Controls ───
const orbitControls = new OrbitControls(camera, canvas);
orbitControls.enableDamping = true;
orbitControls.dampingFactor = 0.08;
orbitControls.minDistance = 1;
orbitControls.maxDistance = 200;

const transformControls = new TransformControls(camera, canvas);
scene.add(transformControls);
transformControls.addEventListener('dragging-changed', (e) => {
  orbitControls.enabled = !e.value;
});
transformControls.addEventListener('objectChange', () => {
  if (state.selected) updatePropertiesPanel();
});

// ─── Lighting ───
const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight.position.set(5, 10, 7);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(2048, 2048);
dirLight.shadow.camera.near = 0.5;
dirLight.shadow.camera.far = 50;
dirLight.shadow.camera.left = -15;
dirLight.shadow.camera.right = 15;
dirLight.shadow.camera.top = 15;
dirLight.shadow.camera.bottom = -15;
scene.add(dirLight);

const hemiLight = new THREE.HemisphereLight(0x8888ff, 0x443322, 0.3);
scene.add(hemiLight);

// ─── Grid ───
const gridHelper = new THREE.GridHelper(20, 20, 0x444466, 0x2a2a40);
gridHelper.material.opacity = 0.7;
gridHelper.material.transparent = true;
gridHelper.material.depthWrite = false;
gridHelper.renderOrder = -1;
scene.add(gridHelper);

// ─── Raycaster ───
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// ─── Helpers Map ───
const lightHelpers = new Map();

// ─── Geometry Factories ───
function createGeometry(shape, params = {}) {
  switch (shape) {
    case 'box': return new THREE.BoxGeometry(
      params.width || 1, params.height || 1, params.depth || 1,
      params.widthSegs || 1, params.heightSegs || 1, params.depthSegs || 1
    );
    case 'sphere': return new THREE.SphereGeometry(
      params.radius || 0.6, params.widthSegs || 32, params.heightSegs || 16
    );
    case 'cylinder': return new THREE.CylinderGeometry(
      params.radiusTop || 0.5, params.radiusBottom || 0.5,
      params.height || 1, params.segments || 32
    );
    case 'cone': return new THREE.ConeGeometry(
      params.radius || 0.5, params.height || 1, params.segments || 32
    );
    case 'torus': return new THREE.TorusGeometry(
      params.radius || 0.5, params.tube || 0.2, params.radialSegs || 16, params.tubularSegs || 48
    );
    case 'plane': return new THREE.BoxGeometry(
      params.width || 2, params.depth || 0.05, params.height || 2, params.widthSegs || 1, 1, params.heightSegs || 1
    );
    case 'icosahedron': return new THREE.IcosahedronGeometry(params.radius || 0.6, params.detail || 0);
    case 'torusknot': return new THREE.TorusKnotGeometry(
      params.radius || 0.4, params.tube || 0.15, params.tubularSegs || 64, params.radialSegs || 8,
      params.p || 2, params.q || 3
    );
    case 'dodecahedron': return new THREE.DodecahedronGeometry(params.radius || 0.6, params.detail || 0);
    case 'octahedron': return new THREE.OctahedronGeometry(params.radius || 0.6, params.detail || 0);
    case 'tetrahedron': return new THREE.TetrahedronGeometry(params.radius || 0.6, params.detail || 0);
    case 'pyramid': {
      const geo = new THREE.ConeGeometry(params.radius || 0.5, params.height || 1, 4);
      return geo;
    }
    case 'capsule': {
      const radius = params.radius || 0.3;
      const height = params.height || 1;
      const points = [];
      points.push(new THREE.Vector2(0, height * 0.5));
      points.push(new THREE.Vector2(radius * 0.5, height * 0.45));
      points.push(new THREE.Vector2(radius, height * 0.25));
      points.push(new THREE.Vector2(radius, -height * 0.25));
      points.push(new THREE.Vector2(radius * 0.5, -height * 0.45));
      points.push(new THREE.Vector2(0, -height * 0.5));
      return new THREE.LatheGeometry(points, 16);
    }
    default: return new THREE.BoxGeometry(1, 1, 1);
  }
}

function reconstructGeometry(geoData) {
  // Reconstruct geometry from Three.js geometry type and native parameters
  if (!geoData || !geoData.type) return null;
  const p = geoData.parameters || {};
  switch (geoData.type) {
    case 'BoxGeometry': return new THREE.BoxGeometry(p.width, p.height, p.depth, p.widthSegments, p.heightSegments, p.depthSegments);
    case 'SphereGeometry': return new THREE.SphereGeometry(p.radius, p.widthSegments, p.heightSegments, p.phiStart, p.phiLength, p.thetaStart, p.thetaLength);
    case 'CylinderGeometry': return new THREE.CylinderGeometry(p.radiusTop, p.radiusBottom, p.height, p.radialSegments, p.heightSegments, p.openEnded, p.thetaStart, p.thetaLength);
    case 'ConeGeometry': return new THREE.ConeGeometry(p.radius, p.height, p.radialSegments, p.heightSegments, p.openEnded, p.thetaStart, p.thetaLength);
    case 'TorusGeometry': return new THREE.TorusGeometry(p.radius, p.tube, p.radialSegments, p.tubularSegments, p.arc);
    case 'PlaneGeometry': return new THREE.PlaneGeometry(p.width, p.height, p.widthSegments, p.heightSegments);
    case 'IcosahedronGeometry': return new THREE.IcosahedronGeometry(p.radius, p.detail);
    case 'TorusKnotGeometry': return new THREE.TorusKnotGeometry(p.radius, p.tube, p.tubularSegments, p.radialSegments, p.p, p.q);
    case 'DodecahedronGeometry': return new THREE.DodecahedronGeometry(p.radius, p.detail);
    case 'OctahedronGeometry': return new THREE.OctahedronGeometry(p.radius, p.detail);
    case 'TetrahedronGeometry': return new THREE.TetrahedronGeometry(p.radius, p.detail);
    default: return null;
  }
}

function createDefaultMaterial() {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(Math.random() * 0.3 + 0.55, 0.7, 0.6),
    metalness: 0.1,
    roughness: 0.5,
  });
}

// ─── Add Object ───
function addObject(shape) {
  state.objectCounter++;
  const geom = createGeometry(shape);
  const mat = createDefaultMaterial();
  const mesh = new THREE.Mesh(geom, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.position.y = 0.5;
  mesh.userData = {
    name: `${capitalize(shape)}_${state.objectCounter}`,
    type: shape,
    id: THREE.MathUtils.generateUUID(),
    visible: true,
    locked: false,
    customProps: {},
  };
  scene.add(mesh);
  state.objects.push(mesh);
  selectObject(mesh);
  pushUndo('add', mesh);
  rebuildHierarchy();
  updateViewportInfo();
  setStatus(`Added ${mesh.userData.name}`);
}

// ─── Add Light ───
function addLight(type) {
  state.objectCounter++;
  let light;
  const name = `${capitalize(type)}Light_${state.objectCounter}`;

  switch (type) {
    case 'point':
      light = new THREE.PointLight(0xffffff, 1, 20);
      light.position.set(0, 3, 0);
      break;
    case 'spot':
      light = new THREE.SpotLight(0xffffff, 1, 20, Math.PI / 6);
      light.position.set(0, 4, 0);
      break;
    case 'directional':
      light = new THREE.DirectionalLight(0xffffff, 1);
      light.position.set(3, 5, 3);
      break;
    default: return;
  }
  light.castShadow = true;
  light.userData = { name, type: `${type}-light`, id: THREE.MathUtils.generateUUID(), visible: true, isLight: true, customProps: {} };

  scene.add(light);
  state.objects.push(light);

  // Add helper
  let helper;
  if (type === 'point') helper = new THREE.PointLightHelper(light, 0.3);
  else if (type === 'spot') helper = new THREE.SpotLightHelper(light);
  else if (type === 'directional') helper = new THREE.DirectionalLightHelper(light, 0.5);
  if (helper) {
    scene.add(helper);
    lightHelpers.set(light.userData.id, helper);
  }

  selectObject(light);
  rebuildHierarchy();
  updateViewportInfo();
  setStatus(`Added ${name}`);
}

// ─── Selection ───
function selectObject(obj) {
  state.selected = obj;
  if (!obj) state.multiSelected = [];

  // In view mode, just update the view-only panel
  if (state.viewMode) {
    updateViewModePanel(obj);
    rebuildHierarchy();
    return;
  }

  if (obj) {
    transformControls.attach(obj);
    document.getElementById('props-placeholder').style.display = 'none';
    document.getElementById('props-data').style.display = '';

    const isLight = obj.userData?.isLight;
    const isGroup = obj.isGroup && !isLight;
    const hasMaterial = !!obj.material;

    if (isLight) {
      document.getElementById('props-transform').style.display = '';
      document.getElementById('props-material').style.display = 'none';
      document.getElementById('props-geometry').style.display = 'none';
      document.getElementById('props-light').style.display = '';
      document.getElementById('props-physics').style.display = 'none';
    } else if (isGroup) {
      document.getElementById('props-transform').style.display = '';
      document.getElementById('props-material').style.display = 'none';
      document.getElementById('props-geometry').style.display = 'none';
      document.getElementById('props-light').style.display = 'none';
      document.getElementById('props-physics').style.display = '';
    } else {
      document.getElementById('props-transform').style.display = '';
      document.getElementById('props-material').style.display = hasMaterial ? '' : 'none';
      document.getElementById('props-geometry').style.display = '';
      document.getElementById('props-light').style.display = 'none';
      document.getElementById('props-physics').style.display = '';
    }
    updatePropertiesPanel();
    updateCustomPropsPanel();
    updatePhysicsPanel();
  } else {
    transformControls.detach();
    document.getElementById('props-placeholder').style.display = '';
    document.getElementById('props-transform').style.display = 'none';
    document.getElementById('props-material').style.display = 'none';
    document.getElementById('props-geometry').style.display = 'none';
    document.getElementById('props-light').style.display = 'none';
    document.getElementById('props-data').style.display = 'none';
    document.getElementById('props-physics').style.display = 'none';
  }
  rebuildHierarchy();
}

function addToMultiSelect(obj) {
  if (state.multiSelected.includes(obj)) return;
  state.multiSelected.push(obj);
  if (state.multiSelected.length > 2) state.multiSelected.shift();
  state.selected = obj;
  transformControls.attach(obj);
  rebuildHierarchy();
  updatePropertiesPanel();
  updateCustomPropsPanel();
  setStatus(`Multi-selected ${state.multiSelected.length} objects`);
}

function deselectAll() { selectObject(null); }

// ─── Custom Properties Panel ───
function updateCustomPropsPanel() {
  const obj = state.selected;
  const list = document.getElementById('custom-props-list');
  if (!list) return;
  list.innerHTML = '';
  if (!obj) return;
  if (!obj.userData.customProps) obj.userData.customProps = {};
  const props = obj.userData.customProps;
  Object.keys(props).forEach(key => {
    const row = document.createElement('div');
    row.className = 'custom-prop-row';
    row.innerHTML = `
      <input class="prop-key" value="${key}" data-old-key="${key}" />
      <input class="prop-val" value="${props[key]}" data-key="${key}" />
      <span class="prop-del" title="Remove"><i class="fa-solid fa-xmark"></i></span>
    `;
    row.querySelector('.prop-key').addEventListener('change', (e) => {
      const oldKey = e.target.dataset.oldKey;
      const newKey = e.target.value.trim();
      if (!newKey || (newKey !== oldKey && props[newKey] !== undefined)) {
        e.target.value = oldKey;
        return;
      }
      const val = props[oldKey];
      delete props[oldKey];
      props[newKey] = val;
      updateCustomPropsPanel();
    });
    row.querySelector('.prop-val').addEventListener('change', (e) => {
      props[e.target.dataset.key] = e.target.value;
    });
    row.querySelector('.prop-del').addEventListener('click', () => {
      delete props[key];
      updateCustomPropsPanel();
      setStatus(`Removed property "${key}"`);
    });
    list.appendChild(row);
  });
}

// ─── Properties Panel ───
function updatePropertiesPanel() {
  const obj = state.selected;
  if (!obj) return;

  // Transform
  document.getElementById('pos-x').value = round(obj.position.x, 3);
  document.getElementById('pos-y').value = round(obj.position.y, 3);
  document.getElementById('pos-z').value = round(obj.position.z, 3);
  document.getElementById('rot-x').value = round(THREE.MathUtils.radToDeg(obj.rotation.x), 1);
  document.getElementById('rot-y').value = round(THREE.MathUtils.radToDeg(obj.rotation.y), 1);
  document.getElementById('rot-z').value = round(THREE.MathUtils.radToDeg(obj.rotation.z), 1);
  document.getElementById('scl-x').value = round(obj.scale.x, 3);
  document.getElementById('scl-y').value = round(obj.scale.y, 3);
  document.getElementById('scl-z').value = round(obj.scale.z, 3);

  // Material
  if (obj.material) {
    const c = '#' + obj.material.color.getHexString();
    document.getElementById('mat-color').value = c;
    document.getElementById('mat-color-hex').value = c;
    document.getElementById('mat-metalness').value = obj.material.metalness;
    document.getElementById('mat-roughness').value = obj.material.roughness;
    document.getElementById('mat-opacity').value = obj.material.opacity;
    document.getElementById('mat-transparent').checked = obj.material.transparent;
    document.getElementById('mat-wireframe').checked = obj.material.wireframe;
  }

  // Light
  if (obj.userData.isLight) {
    const c = '#' + obj.color.getHexString();
    document.getElementById('light-color').value = c;
    document.getElementById('light-color-hex').value = c;
    document.getElementById('light-intensity').value = obj.intensity;
    if (obj.distance !== undefined) document.getElementById('light-distance').value = obj.distance;
  }
}

// ─── Property Inputs ───
function setupPropertyListeners() {
  // Transform
  ['pos-x','pos-y','pos-z'].forEach((id, i) => {
    document.getElementById(id).addEventListener('input', (e) => {
      if (!state.selected) return;
      const axes = ['x','y','z'];
      state.selected.position[axes[i]] = parseFloat(e.target.value) || 0;
    });
  });
  ['rot-x','rot-y','rot-z'].forEach((id, i) => {
    document.getElementById(id).addEventListener('input', (e) => {
      if (!state.selected) return;
      const axes = ['x','y','z'];
      state.selected.rotation[axes[i]] = THREE.MathUtils.degToRad(parseFloat(e.target.value) || 0);
    });
  });
  ['scl-x','scl-y','scl-z'].forEach((id, i) => {
    document.getElementById(id).addEventListener('input', (e) => {
      if (!state.selected) return;
      const axes = ['x','y','z'];
      state.selected.scale[axes[i]] = parseFloat(e.target.value) || 1;
    });
  });

  // Material
  document.getElementById('mat-color').addEventListener('input', (e) => {
    if (!state.selected?.material) return;
    state.selected.material.color.set(e.target.value);
    document.getElementById('mat-color-hex').value = e.target.value;
  });
  document.getElementById('mat-color-hex').addEventListener('change', (e) => {
    if (!state.selected?.material) return;
    try {
      state.selected.material.color.set(e.target.value);
      document.getElementById('mat-color').value = e.target.value;
    } catch (_) {}
  });
  document.getElementById('mat-metalness').addEventListener('input', (e) => {
    if (!state.selected?.material) return;
    state.selected.material.metalness = parseFloat(e.target.value);
  });
  document.getElementById('mat-roughness').addEventListener('input', (e) => {
    if (!state.selected?.material) return;
    state.selected.material.roughness = parseFloat(e.target.value);
  });
  document.getElementById('mat-opacity').addEventListener('input', (e) => {
    if (!state.selected?.material) return;
    state.selected.material.opacity = parseFloat(e.target.value);
    if (state.selected.material.opacity < 1) {
      state.selected.material.transparent = true;
      document.getElementById('mat-transparent').checked = true;
    }
  });
  document.getElementById('mat-transparent').addEventListener('change', (e) => {
    if (!state.selected?.material) return;
    state.selected.material.transparent = e.target.checked;
    state.selected.material.needsUpdate = true;
  });
  document.getElementById('mat-wireframe').addEventListener('change', (e) => {
    if (!state.selected?.material) return;
    state.selected.material.wireframe = e.target.checked;
  });

  // Light properties
  document.getElementById('light-color').addEventListener('input', (e) => {
    if (!state.selected?.userData.isLight) return;
    state.selected.color.set(e.target.value);
    document.getElementById('light-color-hex').value = e.target.value;
    updateLightHelper(state.selected);
  });
  document.getElementById('light-color-hex').addEventListener('change', (e) => {
    if (!state.selected?.userData.isLight) return;
    try {
      state.selected.color.set(e.target.value);
      document.getElementById('light-color').value = e.target.value;
      updateLightHelper(state.selected);
    } catch (_) {}
  });
  document.getElementById('light-intensity').addEventListener('input', (e) => {
    if (!state.selected?.userData.isLight) return;
    state.selected.intensity = parseFloat(e.target.value);
  });
  document.getElementById('light-distance').addEventListener('input', (e) => {
    if (!state.selected?.userData.isLight) return;
    if (state.selected.distance !== undefined) state.selected.distance = parseFloat(e.target.value);
  });

  // Environment
  document.getElementById('bg-color').addEventListener('input', (e) => {
    scene.background.set(e.target.value);
    document.getElementById('bg-color-hex').value = e.target.value;
  });
  document.getElementById('bg-color-hex').addEventListener('change', (e) => {
    try {
      scene.background.set(e.target.value);
      document.getElementById('bg-color').value = e.target.value;
    } catch (_) {}
  });
  document.getElementById('ambient-intensity').addEventListener('input', (e) => {
    ambientLight.intensity = parseFloat(e.target.value);
  });
  document.getElementById('fog-enabled').addEventListener('change', (e) => {
    if (e.target.checked) {
      scene.fog = new THREE.Fog(scene.background, 10, 50);
    } else {
      scene.fog = null;
    }
  });
}

function updateLightHelper(light) {
  const helper = lightHelpers.get(light.userData.id);
  if (helper && helper.update) helper.update();
}

// ─── Hierarchy ───
// Track expanded state of hierarchy nodes
const hierarchyExpanded = new Set();

function rebuildHierarchy() {
  const list = document.getElementById('hierarchy-list');
  list.innerHTML = '';
  state.objects.forEach((obj) => {
    renderHierarchyNode(obj, list, 0, true);
  });
}

function renderHierarchyNode(obj, container, depth, isTopLevel) {
  const isSelected = state.selected === obj;
  const isMulti = state.multiSelected.includes(obj);
  const el = document.createElement('div');
  el.className = 'hier-item' + (isSelected ? ' selected' : '') + (isMulti && !isSelected ? ' multi-selected' : '');
  if (isMulti && !isSelected) el.style.background = 'rgba(239,197,91,0.15)';
  if (depth > 0) el.style.paddingLeft = `${8 + depth * 16}px`;

  const icon = obj.userData?.isLight ? 'fa-lightbulb' : (obj.isGroup || (obj.children && obj.children.some(c => c.isMesh || c.isGroup)) ? 'fa-object-group' : 'fa-cube');
  const badge = isMulti ? '<span class="multi-select-badge">B</span>' : (state.multiSelected.length > 0 && state.multiSelected[0] === obj ? '<span class="multi-select-badge">A</span>' : '');
  const objName = obj.userData?.name || obj.name || 'Unnamed';
  const objId = obj.userData?.id || obj.uuid;

  // Check if this node has expandable children
  const meshChildren = (obj.children || []).filter(c => c.isMesh || c.isGroup || c.isLight);
  const hasChildren = meshChildren.length > 0 && !obj.userData?.isLight;
  const isExpanded = hierarchyExpanded.has(objId);

  let toggleHtml = '';
  if (hasChildren) {
    toggleHtml = `<span class="hier-toggle"><i class="fa-solid ${isExpanded ? 'fa-caret-down' : 'fa-caret-right'}"></i></span>`;
  } else if (depth > 0) {
    toggleHtml = '<span class="hier-toggle-spacer"></span>';
  }

  el.innerHTML = `
    ${toggleHtml}
    <i class="fa-solid ${icon}"></i>
    <span class="hier-name">${objName}${badge}</span>
    <span class="hier-vis" data-id="${objId}">
      <i class="fa-solid ${obj.visible ? 'fa-eye' : 'fa-eye-slash'}"></i>
    </span>
    ${isTopLevel ? `<span class="hier-del" data-id="${objId}" title="Delete"><i class="fa-solid fa-xmark"></i></span>` : ''}
  `;

  el.addEventListener('click', (e) => {
    if (e.target.closest('.hier-toggle')) {
      if (isExpanded) {
        hierarchyExpanded.delete(objId);
      } else {
        hierarchyExpanded.add(objId);
      }
      rebuildHierarchy();
      return;
    }
    if (e.target.closest('.hier-del')) {
      deleteObject(obj);
      return;
    }
    if (e.target.closest('.hier-vis')) {
      obj.visible = !obj.visible;
      if (obj.userData) obj.userData.visible = obj.visible;
      const helper = lightHelpers.get(objId);
      if (helper) helper.visible = obj.visible;
      rebuildHierarchy();
      return;
    }
    // Ctrl+click for multi-select (CSG)
    if (e.ctrlKey || e.metaKey) {
      addToMultiSelect(obj);
      return;
    }
    state.multiSelected = [obj];
    selectObject(obj);
  });
  // Double-click to rename
  el.addEventListener('dblclick', (e) => {
    if (e.target.closest('.hier-vis') || e.target.closest('.hier-del') || e.target.closest('.hier-toggle')) return;
    startInlineRename(obj, el);
  });
  container.appendChild(el);

  // Render children if expanded
  if (hasChildren && isExpanded) {
    meshChildren.forEach(child => {
      renderHierarchyNode(child, container, depth + 1, false);
    });
  }
}

function startInlineRename(obj, el) {
  const nameSpan = el.querySelector('.hier-name');
  const input = document.createElement('input');
  input.className = 'hier-name-input';
  input.value = obj.userData.name;
  input.addEventListener('blur', () => finishRename(obj, input, nameSpan));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') { input.value = obj.userData.name; input.blur(); }
    e.stopPropagation();
  });
  nameSpan.replaceWith(input);
  input.focus();
  input.select();
}

function finishRename(obj, input, nameSpan) {
  const newName = input.value.trim() || obj.userData.name;
  obj.userData.name = newName;
  rebuildHierarchy();
  setStatus(`Renamed to ${newName}`);
}

// ─── Delete ───
function deleteObject(obj) {
  if (!obj) return;
  const name = obj.userData.name;
  pushUndo('delete', obj);
  if (state.selected === obj) transformControls.detach();

  // Remove physics body
  disablePhysicsForObject(obj);

  // Remove light helper
  const helper = lightHelpers.get(obj.userData.id);
  if (helper) {
    scene.remove(helper);
    helper.dispose?.();
    lightHelpers.delete(obj.userData.id);
  }

  scene.remove(obj);
  if (obj.geometry) obj.geometry.dispose();
  if (obj.material) {
    if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
    else obj.material.dispose();
  }
  state.objects = state.objects.filter(o => o !== obj);
  state.multiSelected = state.multiSelected.filter(o => o !== obj);
  if (state.selected === obj) {
    state.selected = null;
    selectObject(null);
  }
  rebuildHierarchy();
  updateViewportInfo();
  setStatus(`Deleted ${name}`);
}

function deleteSelected() {
  if (!state.selected) return;
  deleteObject(state.selected);
}

// ─── Duplicate ───
function duplicateSelected() {
  if (!state.selected) return;
  const obj = state.selected;
  if (obj.userData.isLight) {
    // Clone light
    const lightType = obj.userData.type.replace('-light', '');
    addLight(lightType);
    const newLight = state.selected;
    newLight.position.copy(obj.position).add(new THREE.Vector3(1, 0, 1));
    newLight.color.copy(obj.color);
    newLight.intensity = obj.intensity;
    updatePropertiesPanel();
  } else {
    state.objectCounter++;
    const cloned = obj.clone();
    cloned.material = obj.material.clone();
    cloned.position.add(new THREE.Vector3(1, 0, 1));
    cloned.userData = {
      ...obj.userData,
      name: `${capitalize(obj.userData.type)}_${state.objectCounter}`,
      id: THREE.MathUtils.generateUUID(),
      customProps: { ...(obj.userData.customProps || {}) },
    };
    scene.add(cloned);
    state.objects.push(cloned);
    selectObject(cloned);
    pushUndo('add', cloned);
    rebuildHierarchy();
    updateViewportInfo();
  }
  setStatus('Duplicated object');
}

// ─── CSG Boolean Operations ───
function performCSG(operation) {
  if (state.multiSelected.length < 2) {
    setStatus('Select two objects: click A, then Ctrl+click B');
    return;
  }
  const objA = state.multiSelected[0];
  const objB = state.multiSelected[1];

  if (!objA.isMesh || !objB.isMesh) {
    setStatus('CSG requires two mesh objects');
    return;
  }

  // Convert meshes to world-space BSP and perform operation
  try {
    const result = csgOperation(objA, objB, operation);
    if (!result) return;

    state.objectCounter++;
    const name = `${capitalize(operation)}_${state.objectCounter}`;
    result.userData = {
      name,
      type: 'csg-' + operation,
      id: THREE.MathUtils.generateUUID(),
      visible: true,
      customProps: {},
    };
    scene.add(result);
    state.objects.push(result);

    // Remove originals
    deleteObject(objA);
    deleteObject(objB);

    state.multiSelected = [];
    selectObject(result);
    pushUndo('add', result);
    rebuildHierarchy();
    updateViewportInfo();
    setStatus(`${capitalize(operation)} complete → ${name}`);
  } catch (err) {
    console.error('CSG error:', err);
    setStatus(`CSG failed: ${err.message}`);
  }
}

// Simple CSG implementation using geometry clipping
function csgOperation(meshA, meshB, operation) {
  // Ensure geometries are indexed and have position
  const geomA = meshA.geometry.clone().applyMatrix4(meshA.matrixWorld);
  const geomB = meshB.geometry.clone().applyMatrix4(meshB.matrixWorld);

  // Convert to non-indexed
  const gA = geomA.index ? geomA.toNonIndexed() : geomA;
  const gB = geomB.index ? geomB.toNonIndexed() : geomB;

  const posA = gA.getAttribute('position');
  const posB = gB.getAttribute('position');

  // Build triangle arrays
  const trisA = buildTriangles(posA);
  const trisB = buildTriangles(posB);

  // Compute bounding boxes
  const boxA = new THREE.Box3().setFromBufferAttribute(posA);
  const boxB = new THREE.Box3().setFromBufferAttribute(posB);

  let resultVertices;

  if (operation === 'union') {
    // Union: all of A + parts of B not inside A
    resultVertices = [...flatten(trisA), ...flatten(filterTriangles(trisB, trisA, boxA, false))];
  } else if (operation === 'subtract') {
    // Subtract: parts of A not inside B
    resultVertices = flatten(filterTriangles(trisA, trisB, boxB, false));
    // Add inverted B triangles that are inside A
    const insideB = filterTriangles(trisB, trisA, boxA, true);
    insideB.forEach(tri => { const t = tri[0]; tri[0] = tri[2]; tri[2] = t; }); // flip winding
    resultVertices.push(...flatten(insideB));
  } else if (operation === 'intersect') {
    // Intersect: parts of A inside B + parts of B inside A
    resultVertices = [
      ...flatten(filterTriangles(trisA, trisB, boxB, true)),
      ...flatten(filterTriangles(trisB, trisA, boxA, true)),
    ];
  }

  if (!resultVertices || resultVertices.length === 0) {
    setStatus('CSG produced empty result — objects may not overlap');
    return null;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(resultVertices, 3));
  geometry.computeVertexNormals();

  const material = meshA.material.clone();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function buildTriangles(posAttr) {
  const tris = [];
  for (let i = 0; i < posAttr.count; i += 3) {
    tris.push([
      [posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)],
      [posAttr.getX(i+1), posAttr.getY(i+1), posAttr.getZ(i+1)],
      [posAttr.getX(i+2), posAttr.getY(i+2), posAttr.getZ(i+2)],
    ]);
  }
  return tris;
}

function triCenter(tri) {
  return [
    (tri[0][0] + tri[1][0] + tri[2][0]) / 3,
    (tri[0][1] + tri[1][1] + tri[2][1]) / 3,
    (tri[0][2] + tri[1][2] + tri[2][2]) / 3,
  ];
}

function filterTriangles(trisToTest, trisReference, refBox, keepInside) {
  // Build a simple raycasting test using Three.js
  // Create a temporary mesh from reference triangles to test point containment
  const refVerts = flatten(trisReference);
  const refGeom = new THREE.BufferGeometry();
  refGeom.setAttribute('position', new THREE.Float32BufferAttribute(refVerts, 3));
  refGeom.computeVertexNormals();
  const refMesh = new THREE.Mesh(refGeom, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));

  const raycaster = new THREE.Raycaster();
  const result = [];

  for (const tri of trisToTest) {
    const center = triCenter(tri);
    const point = new THREE.Vector3(center[0], center[1], center[2]);

    // Quick bounding box check
    if (!refBox.containsPoint(point) && keepInside) continue;
    if (!refBox.containsPoint(point) && !keepInside) { result.push(tri); continue; }

    // Ray cast in +X direction and count intersections
    raycaster.set(point, new THREE.Vector3(1, 0, 0));
    const hits = raycaster.intersectObject(refMesh, false);
    const inside = hits.length % 2 === 1;

    if (keepInside && inside) result.push(tri);
    if (!keepInside && !inside) result.push(tri);
  }

  refGeom.dispose();
  return result;
}

function flatten(tris) {
  const verts = [];
  for (const tri of tris) {
    verts.push(tri[0][0], tri[0][1], tri[0][2]);
    verts.push(tri[1][0], tri[1][1], tri[1][2]);
    verts.push(tri[2][0], tri[2][1], tri[2][2]);
  }
  return verts;
}

// ─── Merge ───
function mergeSelected() {
  if (state.multiSelected.length < 2) {
    setStatus('Select two or more objects to merge (Ctrl+click)');
    return;
  }
  const meshes = state.multiSelected.filter(o => o.isMesh);
  if (meshes.length < 2) {
    setStatus('Merge requires at least two mesh objects');
    return;
  }

  // Merge geometries into one
  const geometries = meshes.map(m => {
    const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
    return g.index ? g.toNonIndexed() : g;
  });

  // Combine all position attributes
  let totalVerts = 0;
  geometries.forEach(g => totalVerts += g.getAttribute('position').count);

  const mergedPositions = new Float32Array(totalVerts * 3);
  let offset = 0;
  geometries.forEach(g => {
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      mergedPositions[offset++] = pos.getX(i);
      mergedPositions[offset++] = pos.getY(i);
      mergedPositions[offset++] = pos.getZ(i);
    }
  });

  const mergedGeom = new THREE.BufferGeometry();
  mergedGeom.setAttribute('position', new THREE.BufferAttribute(mergedPositions, 3));
  mergedGeom.computeVertexNormals();

  state.objectCounter++;
  const name = `Merged_${state.objectCounter}`;
  const material = meshes[0].material.clone();
  const merged = new THREE.Mesh(mergedGeom, material);
  merged.castShadow = true;
  merged.receiveShadow = true;
  merged.userData = {
    name,
    type: 'merged',
    id: THREE.MathUtils.generateUUID(),
    visible: true,
    customProps: {},
  };

  scene.add(merged);
  state.objects.push(merged);

  // Remove originals
  const toDelete = [...meshes];
  toDelete.forEach(m => deleteObject(m));

  state.multiSelected = [];
  selectObject(merged);
  pushUndo('add', merged);
  rebuildHierarchy();
  updateViewportInfo();
  setStatus(`Merged ${meshes.length} objects → ${name}`);
}

// ─── Group / Ungroup ───
function groupSelected() {
  if (state.multiSelected.length < 2) {
    setStatus('Select two or more objects to group (Ctrl+click)');
    return;
  }
  state.objectCounter++;
  const group = new THREE.Group();
  const name = `Group_${state.objectCounter}`;
  group.userData = {
    name,
    type: 'group',
    id: THREE.MathUtils.generateUUID(),
    visible: true,
    customProps: {},
  };

  // Compute center of selected objects
  const center = new THREE.Vector3();
  state.multiSelected.forEach(o => center.add(o.position));
  center.divideScalar(state.multiSelected.length);
  group.position.copy(center);

  state.multiSelected.forEach(o => {
    scene.remove(o);
    state.objects = state.objects.filter(x => x !== o);
    o.position.sub(center);
    group.add(o);
  });

  scene.add(group);
  state.objects.push(group);
  state.multiSelected = [];
  selectObject(group);
  pushUndo('add', group);
  rebuildHierarchy();
  updateViewportInfo();
  setStatus(`Grouped → ${name}`);
}

function ungroupSelected() {
  const obj = state.selected;
  if (!obj || !obj.isGroup || obj.userData.type !== 'group') {
    setStatus('Select a group to ungroup');
    return;
  }
  const children = [...obj.children];
  const parentPos = obj.position.clone();
  children.forEach(child => {
    obj.remove(child);
    child.position.add(parentPos);
    scene.add(child);
    state.objects.push(child);
  });
  scene.remove(obj);
  state.objects = state.objects.filter(o => o !== obj);
  state.selected = null;
  state.multiSelected = [];
  selectObject(children[0] || null);
  rebuildHierarchy();
  updateViewportInfo();
  setStatus('Ungrouped');
}

// ─── Symbol Library ───
const symbolLibrary = [];

function createStorageTankGeometry() {
  const group = new THREE.Group();
  // Main cylindrical body
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1, 2.5, 32),
    new THREE.MeshStandardMaterial({ color: 0x8899aa, roughness: 0.4, metalness: 0.6 })
  );
  body.position.y = 1.25;
  body.castShadow = true;
  group.add(body);
  // Domed top
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x8899aa, roughness: 0.4, metalness: 0.6 })
  );
  dome.position.y = 2.5;
  dome.castShadow = true;
  group.add(dome);
  // Bottom cone
  const bottom = new THREE.Mesh(
    new THREE.ConeGeometry(1, 0.5, 32),
    new THREE.MeshStandardMaterial({ color: 0x8899aa, roughness: 0.4, metalness: 0.6 })
  );
  bottom.position.y = -0.25;
  bottom.rotation.x = Math.PI;
  group.add(bottom);
  // Support legs (4)
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2;
    const leg = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 1.0, 8),
      new THREE.MeshStandardMaterial({ color: 0x556677, roughness: 0.6, metalness: 0.4 })
    );
    leg.position.set(Math.cos(angle) * 0.85, -0.5, Math.sin(angle) * 0.85);
    group.add(leg);
  }
  // Top nozzle
  const nozzle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1, 0.1, 0.4, 12),
    new THREE.MeshStandardMaterial({ color: 0x667788, roughness: 0.3, metalness: 0.7 })
  );
  nozzle.position.y = 3.15;
  group.add(nozzle);
  return group;
}

function createMotorizedPumpGeometry() {
  const group = new THREE.Group();
  // Pump casing (volute)
  const casing = new THREE.Mesh(
    new THREE.CylinderGeometry(0.6, 0.6, 0.5, 32),
    new THREE.MeshStandardMaterial({ color: 0x336699, roughness: 0.3, metalness: 0.7 })
  );
  casing.rotation.x = Math.PI / 2;
  casing.position.set(0, 0.5, 0);
  casing.castShadow = true;
  group.add(casing);
  // Motor body
  const motor = new THREE.Mesh(
    new THREE.CylinderGeometry(0.35, 0.35, 1.2, 32),
    new THREE.MeshStandardMaterial({ color: 0x445566, roughness: 0.5, metalness: 0.5 })
  );
  motor.rotation.x = Math.PI / 2;
  motor.position.set(0, 0.5, -0.85);
  motor.castShadow = true;
  group.add(motor);
  // Motor end cap
  const endCap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.37, 0.3, 0.15, 32),
    new THREE.MeshStandardMaterial({ color: 0x556677, roughness: 0.4, metalness: 0.6 })
  );
  endCap.rotation.x = Math.PI / 2;
  endCap.position.set(0, 0.5, -1.5);
  group.add(endCap);
  // Inlet pipe (suction)
  const inlet = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.15, 0.6, 16),
    new THREE.MeshStandardMaterial({ color: 0x556677, roughness: 0.4, metalness: 0.6 })
  );
  inlet.rotation.x = Math.PI / 2;
  inlet.position.set(0, 0.5, 0.55);
  group.add(inlet);
  // Outlet pipe (discharge) - vertical
  const outlet = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.12, 0.5, 16),
    new THREE.MeshStandardMaterial({ color: 0x556677, roughness: 0.4, metalness: 0.6 })
  );
  outlet.position.set(0, 1.05, 0);
  group.add(outlet);
  // Baseplate
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.1, 2.4),
    new THREE.MeshStandardMaterial({ color: 0x445566, roughness: 0.7, metalness: 0.3 })
  );
  base.position.set(0, 0.05, -0.4);
  group.add(base);
  return group;
}

function createValveGeometry() {
  const group = new THREE.Group();
  // Valve body
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(0.3, 16, 16),
    new THREE.MeshStandardMaterial({ color: 0xaa6633, roughness: 0.4, metalness: 0.6 })
  );
  body.position.y = 0.3;
  body.castShadow = true;
  group.add(body);
  // Inlet/outlet pipes
  const pipeL = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1, 0.1, 0.6, 12),
    new THREE.MeshStandardMaterial({ color: 0x887755, roughness: 0.4, metalness: 0.5 })
  );
  pipeL.rotation.z = Math.PI / 2;
  pipeL.position.set(-0.5, 0.3, 0);
  group.add(pipeL);
  const pipeR = pipeL.clone();
  pipeR.position.set(0.5, 0.3, 0);
  group.add(pipeR);
  // Handwheel stem
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, 0.5, 8),
    new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.3, metalness: 0.8 })
  );
  stem.position.y = 0.75;
  group.add(stem);
  // Handwheel
  const wheel = new THREE.Mesh(
    new THREE.TorusGeometry(0.15, 0.025, 8, 16),
    new THREE.MeshStandardMaterial({ color: 0xcc3333, roughness: 0.5, metalness: 0.4 })
  );
  wheel.position.y = 1.0;
  wheel.rotation.x = Math.PI / 2;
  group.add(wheel);
  return group;
}

function createHeatExchangerGeometry() {
  const group = new THREE.Group();
  // Shell (horizontal cylinder)
  const shell = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.5, 2.5, 32),
    new THREE.MeshStandardMaterial({ color: 0x7799aa, roughness: 0.3, metalness: 0.6 })
  );
  shell.rotation.z = Math.PI / 2;
  shell.position.y = 0.8;
  shell.castShadow = true;
  group.add(shell);
  // Left head
  const headL = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x6688aa, roughness: 0.3, metalness: 0.7 })
  );
  headL.rotation.z = Math.PI / 2;
  headL.position.set(-1.25, 0.8, 0);
  group.add(headL);
  // Right head
  const headR = headL.clone();
  headR.rotation.z = -Math.PI / 2;
  headR.position.set(1.25, 0.8, 0);
  group.add(headR);
  // Top nozzles
  for (let x of [-0.6, 0.6]) {
    const noz = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 0.35, 12),
      new THREE.MeshStandardMaterial({ color: 0x667788, roughness: 0.3, metalness: 0.7 })
    );
    noz.position.set(x, 1.45, 0);
    group.add(noz);
  }
  // Support saddles
  for (let x of [-0.7, 0.7]) {
    const saddle = new THREE.Mesh(
      new THREE.BoxGeometry(0.15, 0.8, 0.8),
      new THREE.MeshStandardMaterial({ color: 0x556677, roughness: 0.7, metalness: 0.3 })
    );
    saddle.position.set(x, 0.4, 0);
    group.add(saddle);
  }
  return group;
}

function createPipeSegmentGeometry() {
  const group = new THREE.Group();
  const pipe = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.12, 2.0, 16),
    new THREE.MeshStandardMaterial({ color: 0x778899, roughness: 0.3, metalness: 0.7 })
  );
  pipe.rotation.z = Math.PI / 2;
  pipe.position.y = 0.5;
  pipe.castShadow = true;
  group.add(pipe);
  // Flanges
  for (let x of [-1.0, 1.0]) {
    const flange = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.2, 0.06, 16),
      new THREE.MeshStandardMaterial({ color: 0x667788, roughness: 0.4, metalness: 0.6 })
    );
    flange.rotation.z = Math.PI / 2;
    flange.position.set(x, 0.5, 0);
    group.add(flange);
  }
  return group;
}

function createElbowPipeGeometry() {
  const group = new THREE.Group();
  const curve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.8, 0, 0),
    new THREE.Vector3(0.8, 0.8, 0)
  );
  const tubeGeom = new THREE.TubeGeometry(curve, 20, 0.12, 12, false);
  const elbow = new THREE.Mesh(
    tubeGeom,
    new THREE.MeshStandardMaterial({ color: 0x778899, roughness: 0.3, metalness: 0.7 })
  );
  elbow.position.y = 0.3;
  elbow.castShadow = true;
  group.add(elbow);
  return group;
}

function createPressureVesselGeometry() {
  const group = new THREE.Group();
  // Horizontal vessel body
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.7, 0.7, 2.8, 32),
    new THREE.MeshStandardMaterial({ color: 0x99aabb, roughness: 0.3, metalness: 0.6 })
  );
  body.rotation.z = Math.PI / 2;
  body.position.y = 1.0;
  body.castShadow = true;
  group.add(body);
  // Hemispherical ends
  for (let x of [-1.4, 1.4]) {
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(0.7, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x8899aa, roughness: 0.3, metalness: 0.7 })
    );
    cap.rotation.z = x < 0 ? Math.PI / 2 : -Math.PI / 2;
    cap.position.set(x, 1.0, 0);
    group.add(cap);
  }
  // Top nozzles
  for (let x of [-0.5, 0.5]) {
    const noz = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.1, 0.4, 12),
      new THREE.MeshStandardMaterial({ color: 0x778899, roughness: 0.3, metalness: 0.7 })
    );
    noz.position.set(x, 1.85, 0);
    group.add(noz);
  }
  // Saddle supports
  for (let x of [-0.8, 0.8]) {
    const saddle = new THREE.Mesh(
      new THREE.BoxGeometry(0.15, 1.0, 1.0),
      new THREE.MeshStandardMaterial({ color: 0x556677, roughness: 0.7, metalness: 0.3 })
    );
    saddle.position.set(x, 0.5, 0);
    group.add(saddle);
  }
  return group;
}

function createConveyorGeometry() {
  const group = new THREE.Group();
  // Belt frame
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(3.0, 0.08, 0.6),
    new THREE.MeshStandardMaterial({ color: 0x445566, roughness: 0.6, metalness: 0.4 })
  );
  frame.position.y = 0.8;
  group.add(frame);
  // Belt surface
  const belt = new THREE.Mesh(
    new THREE.BoxGeometry(2.8, 0.04, 0.5),
    new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9, metalness: 0.1 })
  );
  belt.position.y = 0.86;
  group.add(belt);
  // Rollers
  for (let x = -1.2; x <= 1.2; x += 0.6) {
    const roller = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 0.55, 12),
      new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.3, metalness: 0.7 })
    );
    roller.rotation.x = Math.PI / 2;
    roller.position.set(x, 0.74, 0);
    group.add(roller);
  }
  // End drums
  for (let x of [-1.4, 1.4]) {
    const drum = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 0.55, 16),
      new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 0.3, metalness: 0.7 })
    );
    drum.rotation.x = Math.PI / 2;
    drum.position.set(x, 0.8, 0);
    group.add(drum);
  }
  // Legs
  for (let x of [-1.2, 1.2]) {
    for (let z of [-0.25, 0.25]) {
      const leg = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.04, 0.76, 8),
        new THREE.MeshStandardMaterial({ color: 0x556677, roughness: 0.6, metalness: 0.4 })
      );
      leg.position.set(x, 0.38, z);
      group.add(leg);
    }
  }
  return group;
}

function createElectricMotorGeometry() {
  const group = new THREE.Group();
  // Motor body
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.35, 0.35, 0.9, 32),
    new THREE.MeshStandardMaterial({ color: 0x445566, roughness: 0.5, metalness: 0.5 })
  );
  body.rotation.x = Math.PI / 2;
  body.position.y = 0.5;
  body.castShadow = true;
  group.add(body);
  // Front bearing housing
  const front = new THREE.Mesh(
    new THREE.CylinderGeometry(0.25, 0.37, 0.12, 32),
    new THREE.MeshStandardMaterial({ color: 0x556677, roughness: 0.4, metalness: 0.6 })
  );
  front.rotation.x = Math.PI / 2;
  front.position.set(0, 0.5, 0.5);
  group.add(front);
  // Shaft
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 0.5, 12),
    new THREE.MeshStandardMaterial({ color: 0x999999, roughness: 0.2, metalness: 0.9 })
  );
  shaft.rotation.x = Math.PI / 2;
  shaft.position.set(0, 0.5, 0.7);
  group.add(shaft);
  // Fan cover (rear)
  const fanCover = new THREE.Mesh(
    new THREE.CylinderGeometry(0.38, 0.35, 0.2, 32),
    new THREE.MeshStandardMaterial({ color: 0x334455, roughness: 0.6, metalness: 0.4 })
  );
  fanCover.rotation.x = Math.PI / 2;
  fanCover.position.set(0, 0.5, -0.55);
  group.add(fanCover);
  // Mounting feet
  for (let x of [-0.25, 0.25]) {
    const foot = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.15, 0.9),
      new THREE.MeshStandardMaterial({ color: 0x445566, roughness: 0.6, metalness: 0.4 })
    );
    foot.position.set(x, 0.075, 0);
    group.add(foot);
  }
  return group;
}

function createCoolingTowerGeometry() {
  const group = new THREE.Group();
  // Hyperboloid shell
  const points = [];
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    const y = t * 3.5;
    const r = 1.2 - 0.5 * Math.sin(t * Math.PI * 0.7) + 0.1 * t;
    points.push(new THREE.Vector2(r, y));
  }
  const shell = new THREE.Mesh(
    new THREE.LatheGeometry(points, 32),
    new THREE.MeshStandardMaterial({ color: 0x99aabb, roughness: 0.7, metalness: 0.2, side: THREE.DoubleSide })
  );
  shell.castShadow = true;
  group.add(shell);
  // Basin
  const basin = new THREE.Mesh(
    new THREE.CylinderGeometry(1.4, 1.4, 0.15, 32),
    new THREE.MeshStandardMaterial({ color: 0x667788, roughness: 0.6, metalness: 0.3 })
  );
  basin.position.y = 0.075;
  group.add(basin);
  return group;
}

function createCarGeometry() {
  const group = new THREE.Group();

  const bodyMat   = new THREE.MeshStandardMaterial({ color: 0xB71C1C, roughness: 0.22, metalness: 0.65 });
  const glassMat  = new THREE.MeshStandardMaterial({ color: 0x6EAAC8, roughness: 0.02, metalness: 0.15, transparent: true, opacity: 0.45 });
  const tireMat   = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.92, metalness: 0.03 });
  const rimMat    = new THREE.MeshStandardMaterial({ color: 0xC0C0C0, roughness: 0.15, metalness: 0.95 });
  const chromeMat = new THREE.MeshStandardMaterial({ color: 0xE0E0E0, roughness: 0.08, metalness: 1.00 });
  const lightMat  = new THREE.MeshStandardMaterial({ color: 0xFFEEAA, roughness: 0.05, metalness: 0.1, emissive: 0xFFEEAA, emissiveIntensity: 0.4 });
  const tailMat   = new THREE.MeshStandardMaterial({ color: 0xEE1100, roughness: 0.08, metalness: 0.15, emissive: 0xEE1100, emissiveIntensity: 0.3 });
  const darkMat   = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.75, metalness: 0.25 });
  const intMat    = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.80, metalness: 0.10 });

  const W = 0.88;   // half-width of body
  const BL = 2.20;  // half-length of body

  // ── Body side profile (extruded along X) using Shape ──
  const sideShape = new THREE.Shape();
  // start at front-bottom, go clockwise
  sideShape.moveTo(-BL, 0.30);
  // front bumper lower curve
  sideShape.quadraticCurveTo(-BL - 0.08, 0.30, -BL - 0.10, 0.38);
  sideShape.lineTo(-BL - 0.10, 0.52);
  // front slope up to hood
  sideShape.quadraticCurveTo(-BL - 0.04, 0.58, -BL, 0.58);
  // hood line
  sideShape.lineTo(-BL + 0.95, 0.62);
  // A-pillar (windshield)
  sideShape.lineTo(-BL + 1.72, 1.06);
  // roof
  sideShape.lineTo(-BL + 2.85, 1.08);
  // C-pillar (rear window)
  sideShape.lineTo(-BL + 3.60, 0.68);
  // trunk
  sideShape.lineTo(-BL + 4.28, 0.66);
  // rear end
  sideShape.quadraticCurveTo(-BL + 4.40, 0.64, -BL + 4.42, 0.56);
  sideShape.lineTo(-BL + 4.42, 0.38);
  sideShape.quadraticCurveTo(-BL + 4.42, 0.30, -BL + 4.34, 0.30);
  sideShape.lineTo(-BL, 0.30);

  const bodyExt = new THREE.ExtrudeGeometry(sideShape, {
    steps: 1, depth: W * 2, bevelEnabled: true,
    bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 3
  });
  const bodyMesh = new THREE.Mesh(bodyExt, bodyMat);
  bodyMesh.rotation.y = Math.PI / 2;
  bodyMesh.position.set(-W, 0, 0);
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  group.add(bodyMesh);

  // ── Greenhouse glass (cabin windows as a single extruded shape) ──
  const glassShape = new THREE.Shape();
  // windshield lower edge to roof to rear window
  glassShape.moveTo(-BL + 1.00, 0.63);
  glassShape.lineTo(-BL + 1.68, 1.02);   // A-pillar top
  glassShape.lineTo(-BL + 2.82, 1.04);   // roof line
  glassShape.lineTo(-BL + 3.52, 0.70);   // C-pillar
  glassShape.lineTo(-BL + 3.52, 0.67);   // sill
  glassShape.lineTo(-BL + 1.00, 0.63);   // close

  for (const sx of [-1, 1]) {
    const glassExt = new THREE.ExtrudeGeometry(glassShape, {
      steps: 1, depth: 0.01, bevelEnabled: false
    });
    const gm = new THREE.Mesh(glassExt, glassMat);
    gm.rotation.y = Math.PI / 2;
    gm.position.set(sx * (W - 0.01), 0, 0);
    group.add(gm);
  }

  // ── Windshield (front, tilted glass pane) ──
  const wsFront = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.72, 0.52), glassMat);
  wsFront.position.set(0, 0.84, 0.84);
  wsFront.rotation.x = -0.62;
  group.add(wsFront);

  // ── Rear window ──
  const wsRear = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.72, 0.46), glassMat);
  wsRear.position.set(0, 0.88, -1.36);
  wsRear.rotation.x = 0.55;
  group.add(wsRear);

  // ── A, B, C pillars ──
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6, metalness: 0.3 });
  for (const sx of [-1, 1]) {
    // A-pillar
    const aP = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.50, 0.06), pillarMat);
    aP.position.set(sx * (W - 0.02), 0.84, 0.68);
    aP.rotation.z = sx * 0.52;
    group.add(aP);
    // B-pillar
    const bP = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.38, 0.06), pillarMat);
    bP.position.set(sx * (W - 0.02), 0.86, -0.14);
    group.add(bP);
    // C-pillar
    const cP = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.44, 0.06), pillarMat);
    cP.position.set(sx * (W - 0.02), 0.86, -1.06);
    cP.rotation.z = -sx * 0.38;
    group.add(cP);
  }

  // ── Door seam lines ──
  for (const sx of [-1, 1]) {
    for (const dz of [0.30, -0.14]) {
      const seam = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.32, 0.012), darkMat);
      seam.position.set(sx * (W + 0.04), 0.48, dz);
      group.add(seam);
    }
    // Door handles
    for (const dz of [0.12, -0.32]) {
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.025, 0.10), chromeMat);
      handle.position.set(sx * (W + 0.05), 0.55, dz);
      group.add(handle);
    }
  }

  // ── Front fascia details ──
  // Upper grille
  const grille = new THREE.Mesh(new THREE.BoxGeometry(W * 1.2, 0.14, 0.04), darkMat);
  grille.position.set(0, 0.52, BL + 0.08);
  group.add(grille);
  // Chrome grille bar
  const gBar = new THREE.Mesh(new THREE.BoxGeometry(W * 1.0, 0.025, 0.05), chromeMat);
  gBar.position.set(0, 0.54, BL + 0.09);
  group.add(gBar);
  // Lower intake
  const intake = new THREE.Mesh(new THREE.BoxGeometry(W * 1.6, 0.10, 0.04), darkMat);
  intake.position.set(0, 0.37, BL + 0.08);
  group.add(intake);
  // Splitter
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(W * 1.9, 0.02, 0.16), darkMat);
  splitter.position.set(0, 0.30, BL + 0.02);
  group.add(splitter);

  // ── Headlights (sculpted) ──
  for (const sx of [-1, 1]) {
    // Main headlight housing
    const hlHouse = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.12, 0.10), darkMat);
    hlHouse.position.set(sx * 0.58, 0.58, BL + 0.06);
    group.add(hlHouse);
    // LED element
    const led = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.06, 16), lightMat);
    led.rotation.x = Math.PI / 2;
    led.position.set(sx * 0.58, 0.58, BL + 0.10);
    group.add(led);
    // DRL strip
    const drl = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.018, 0.05), lightMat);
    drl.position.set(sx * 0.58, 0.50, BL + 0.08);
    group.add(drl);
  }

  // ── Tail lights (wrap-around) ──
  for (const sx of [-1, 1]) {
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.10, 0.06), tailMat);
    tl.position.set(sx * 0.60, 0.60, -BL - 0.08);
    group.add(tl);
    // Light bar connector
    const lb = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 0.05), tailMat);
    lb.position.set(sx * 0.82, 0.60, -BL - 0.06);
    group.add(lb);
  }
  // Center tail strip
  const tStrip = new THREE.Mesh(new THREE.BoxGeometry(0.70, 0.025, 0.04), tailMat);
  tStrip.position.set(0, 0.62, -BL - 0.08);
  group.add(tStrip);

  // ── Rear diffuser ──
  const diffuser = new THREE.Mesh(new THREE.BoxGeometry(W * 1.6, 0.06, 0.12), darkMat);
  diffuser.position.set(0, 0.33, -BL - 0.02);
  group.add(diffuser);
  // Dual exhaust tips
  for (const sx of [-1, 1]) {
    const exh = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.042, 0.10, 14), chromeMat);
    exh.rotation.x = Math.PI / 2;
    exh.position.set(sx * 0.40, 0.35, -BL - 0.08);
    group.add(exh);
  }

  // ── Rear spoiler lip ──
  const spoiler = new THREE.Mesh(new THREE.BoxGeometry(W * 1.7, 0.025, 0.12), bodyMat);
  spoiler.position.set(0, 0.68, -1.58);
  group.add(spoiler);

  // ── Side mirrors (stalk + head) ──
  for (const sx of [-1, 1]) {
    // Stalk
    const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.03, 0.04), bodyMat);
    stalk.position.set(sx * (W + 0.08), 0.78, 0.68);
    group.add(stalk);
    // Mirror head (teardrop shape approximation)
    const mHead = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.14), bodyMat);
    mHead.position.set(sx * (W + 0.14), 0.78, 0.66);
    group.add(mHead);
    // Mirror glass
    const mGlass = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.06), glassMat);
    mGlass.position.set(sx * (W + 0.12), 0.78, 0.60);
    group.add(mGlass);
  }

  // ── Wheels (4 corners) ──
  const wheelPositions = [
    [-0.92, 0.32,  1.30],
    [ 0.92, 0.32,  1.30],
    [-0.92, 0.32, -1.30],
    [ 0.92, 0.32, -1.30],
  ];

  wheelPositions.forEach(([wx, wy, wz]) => {
    const wg = new THREE.Group();
    const outward = wx < 0 ? -1 : 1;

    // Tyre (torus for realistic roundness)
    const tyre = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.09, 14, 28), tireMat);
    tyre.rotation.y = Math.PI / 2;
    tyre.castShadow = true;
    wg.add(tyre);

    // Tyre sidewall (fill center disc)
    const sidewall = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.16, 28), tireMat);
    sidewall.rotation.z = Math.PI / 2;
    wg.add(sidewall);

    // Rim face
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.20, 0.04, 22), rimMat);
    rim.rotation.z = Math.PI / 2;
    rim.position.x = outward * 0.06;
    wg.add(rim);

    // 5 spokes (radial)
    for (let s = 0; s < 5; s++) {
      const angle = (s / 5) * Math.PI * 2;
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.16, 0.035), rimMat);
      spoke.position.set(outward * 0.065, Math.sin(angle) * 0.10, Math.cos(angle) * 0.10);
      spoke.rotation.x = angle;
      wg.add(spoke);
    }

    // Hub center cap
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.06, 12), chromeMat);
    hub.rotation.z = Math.PI / 2;
    hub.position.x = outward * 0.08;
    wg.add(hub);

    // Brake disc (visible through spokes)
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.015, 28), intMat);
    disc.rotation.z = Math.PI / 2;
    wg.add(disc);

    // Brake caliper
    const caliper = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 0.08), new THREE.MeshStandardMaterial({ color: 0xCC0000, roughness: 0.4, metalness: 0.5 }));
    caliper.position.set(outward * 0.03, 0.12, 0);
    wg.add(caliper);

    wg.position.set(wx, wy, wz);
    group.add(wg);
  });

  // ── Wheel arch lips ──
  wheelPositions.forEach(([wx, wy, wz]) => {
    const archLip = new THREE.Mesh(
      new THREE.TorusGeometry(0.36, 0.025, 6, 16, Math.PI),
      darkMat
    );
    archLip.rotation.y = (wx < 0 ? -1 : 1) * Math.PI / 2;
    archLip.rotation.z = Math.PI / 2;
    archLip.position.set(wx, wy + 0.05, wz);
    group.add(archLip);
  });

  // ── Undercarriage ──
  const floor = new THREE.Mesh(new THREE.BoxGeometry(W * 1.9, 0.04, BL * 1.88), darkMat);
  floor.position.y = 0.27;
  group.add(floor);

  // ── Roof rails ──
  for (const sx of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.40, 8), chromeMat);
    rail.rotation.x = Math.PI / 2;
    rail.position.set(sx * 0.72, 1.10, -0.16);
    group.add(rail);
  }

  // ── Antenna (shark fin) ──
  const fin = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.10, 8), darkMat);
  fin.position.set(0, 1.14, -0.60);
  group.add(fin);

  return group;
}

function createTeapotGeometry() {
  const group = new THREE.Group();
  const creamMat = new THREE.MeshStandardMaterial({ color: 0xE8D5B0, roughness: 0.28, metalness: 0.08 });
  const accentMat = new THREE.MeshStandardMaterial({ color: 0xB89A6A, roughness: 0.40, metalness: 0.05 });

  // ── Body (LatheGeometry profile) ──
  const bodyPts = [
    new THREE.Vector2(0.00, 0.00),
    new THREE.Vector2(0.26, 0.04),
    new THREE.Vector2(0.50, 0.14),
    new THREE.Vector2(0.60, 0.32),
    new THREE.Vector2(0.58, 0.50),
    new THREE.Vector2(0.48, 0.66),
    new THREE.Vector2(0.31, 0.76),
    new THREE.Vector2(0.29, 0.84),
    new THREE.Vector2(0.32, 0.90),
    new THREE.Vector2(0.30, 0.94),
  ];
  const body = new THREE.Mesh(new THREE.LatheGeometry(bodyPts, 36), creamMat);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // Bottom disk to close the base
  const bottomDisk = new THREE.Mesh(new THREE.CircleGeometry(0.26, 28), accentMat);
  bottomDisk.rotation.x = -Math.PI / 2;
  bottomDisk.position.y = 0.005;
  group.add(bottomDisk);

  // Foot ring
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.24, 0.045, 24), accentMat);
  foot.position.y = 0.022;
  group.add(foot);

  // ── Lid ──
  const lidPts = [
    new THREE.Vector2(0.00, 0.00),
    new THREE.Vector2(0.27, 0.01),
    new THREE.Vector2(0.28, 0.04),
    new THREE.Vector2(0.20, 0.13),
    new THREE.Vector2(0.08, 0.19),
    new THREE.Vector2(0.00, 0.20),
  ];
  const lid = new THREE.Mesh(new THREE.LatheGeometry(lidPts, 32), creamMat);
  lid.position.y = 0.93;
  group.add(lid);

  // Lid knob
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.062, 14, 10), accentMat);
  knob.position.y = 1.14;
  group.add(knob);
  const knobStem = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.030, 0.09, 10), accentMat);
  knobStem.position.y = 1.08;
  group.add(knobStem);

  // ── Spout (TubeGeometry along a QuadraticBezierCurve — +X direction) ──
  const spoutCurve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3( 0.44, 0.28, 0),
    new THREE.Vector3( 0.82, 0.52, 0),
    new THREE.Vector3( 0.90, 0.84, 0)
  );
  // Taper from base to tip using a small-radius tube; we layer two tubes for taper illusion
  const spout = new THREE.Mesh(
    new THREE.TubeGeometry(spoutCurve, 14, 0.072, 12, false),
    creamMat
  );
  spout.castShadow = true;
  group.add(spout);
  // Spout opening rim
  const spoutRim = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.014, 8, 18), accentMat);
  spoutRim.position.set(0.90, 0.84, 0);
  spoutRim.rotation.x = Math.PI / 2;
  group.add(spoutRim);

  // ── Handle (CubicBezierCurve — -X direction) ──
  const handleCurve = new THREE.CubicBezierCurve3(
    new THREE.Vector3(-0.38, 0.72, 0),
    new THREE.Vector3(-0.82, 0.82, 0),
    new THREE.Vector3(-0.82, 0.22, 0),
    new THREE.Vector3(-0.38, 0.30, 0)
  );
  const handle = new THREE.Mesh(
    new THREE.TubeGeometry(handleCurve, 18, 0.052, 8, false),
    accentMat
  );
  handle.castShadow = true;
  group.add(handle);

  return group;
}

function createCannonGeometry() {
  const group = new THREE.Group();
  const woodMat  = new THREE.MeshStandardMaterial({ color: 0x7B5B3A, roughness: 0.88, metalness: 0.05 });
  const ironMat  = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.22, metalness: 0.95 });
  const darkMat  = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.15, metalness: 1.0  });

  const elevationAngle = 0.22; // ~12.5° upward tilt on barrel

  // ── Two wooden trail arms (carriage frame along Z) ──
  for (const sx of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.16, 2.0), woodMat);
    arm.position.set(sx * 0.23, 0.28, 0.05);
    arm.castShadow = true;
    group.add(arm);
  }
  // Front cross-brace
  const fb = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.13, 0.12), woodMat);
  fb.position.set(0, 0.28, 0.88);
  group.add(fb);
  // Rear cross-brace
  const rb = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.13, 0.12), woodMat);
  rb.position.set(0, 0.28, -0.68);
  group.add(rb);

  // ── Spoked wheels (left & right, at axle z = 0.15) ──
  for (const sx of [-1, 1]) {
    const wg = new THREE.Group();

    // Iron rim torus
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.035, 8, 28), ironMat);
    wg.add(rim);

    // 8 wooden spokes
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.74, 6), woodMat);
      spoke.rotation.z = angle;
      spoke.position.set(Math.sin(angle) * 0.19, Math.cos(angle) * 0.19, 0);
      wg.add(spoke);
    }

    // Iron hub cap
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.14, 12), ironMat);
    cap.rotation.x = Math.PI / 2;
    wg.add(cap);

    wg.rotation.y = Math.PI / 2;
    wg.position.set(sx * 0.52, 0.38, 0.15);
    group.add(wg);
  }

  // Iron axle
  const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 1.06, 12), ironMat);
  axle.rotation.z = Math.PI / 2;
  axle.position.set(0, 0.38, 0.15);
  group.add(axle);

  // ── Trunnion block (iron bracket that holds the barrel) ──
  const tblock = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.2, 0.26), ironMat);
  tblock.position.set(0, 0.56, -0.05);
  group.add(tblock);

  // ── Barrel group (rotated for elevation) ──
  const barrelGroup = new THREE.Group();
  barrelGroup.position.set(0, 0.64, -0.05);
  barrelGroup.rotation.x = -elevationAngle; // tilt upward

  // Main barrel tube (tapered: wider at breech)
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.145, 1.85, 22), ironMat);
  barrel.rotation.x = Math.PI / 2;  // point along +Z
  barrel.userData.isCannonBarrel = true;
  barrel.castShadow = true;
  barrelGroup.add(barrel);

  // Muzzle flare ring
  const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.148, 0.10, 0.09, 20), darkMat);
  muzzle.rotation.x = Math.PI / 2;
  muzzle.position.z = 0.97;   // tip of barrel (+Z = forward)
  barrelGroup.add(muzzle);

  // Reinforcing bands
  for (const bz of [-0.55, -0.05, 0.48]) {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.155, 0.155, 0.055, 20), ironMat);
    band.rotation.x = Math.PI / 2;
    band.position.z = bz;
    barrelGroup.add(band);
  }

  // Breech knob (rounded back)
  const breech = new THREE.Mesh(new THREE.SphereGeometry(0.145, 16, 10), ironMat);
  breech.position.z = -0.93;
  barrelGroup.add(breech);

  // Touch-hole (fuse) on top of breech area
  const touchHole = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.13, 8), darkMat);
  touchHole.position.set(0, 0.14, -0.5);
  barrelGroup.add(touchHole);

  group.add(barrelGroup);

  // ── Elevation screw (wedge support under rear of barrel) ──
  const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.38, 10), ironMat);
  screw.rotation.x = -0.9;
  screw.position.set(0, 0.44, -0.42);
  group.add(screw);

  return group;
}

// Library item definitions (built-in)
const builtInLibraryItems = [
  { name: 'Storage Tank', category: 'Vessels', icon: 'fa-oil-well', factory: createStorageTankGeometry },
  { name: 'Pressure Vessel', category: 'Vessels', icon: 'fa-capsules', factory: createPressureVesselGeometry },
  { name: 'Motorized Pump', category: 'Equipment', icon: 'fa-fan', factory: createMotorizedPumpGeometry },
  { name: 'Electric Motor', category: 'Equipment', icon: 'fa-gear', factory: createElectricMotorGeometry },
  { name: 'Gate Valve', category: 'Piping', icon: 'fa-faucet', factory: createValveGeometry },
  { name: 'Heat Exchanger', category: 'Equipment', icon: 'fa-temperature-half', factory: createHeatExchangerGeometry },
  { name: 'Pipe Segment', category: 'Piping', icon: 'fa-minus', factory: createPipeSegmentGeometry },
  { name: 'Pipe Elbow', category: 'Piping', icon: 'fa-turn-up', factory: createElbowPipeGeometry },
  { name: 'Conveyor', category: 'Equipment', icon: 'fa-arrow-right-long', factory: createConveyorGeometry },
  { name: 'Cooling Tower', category: 'Structures', icon: 'fa-tower-broadcast', factory: createCoolingTowerGeometry },
  { name: 'Cannon', category: 'Weapons', icon: 'fa-burst', factory: createCannonGeometry },
  { name: 'Teapot', category: 'Objects', icon: 'fa-mug-hot', factory: createTeapotGeometry },
  { name: 'Car', category: 'Vehicles', icon: 'fa-car', factory: createCarGeometry },
];

function initLibrary() {
  // Load default library items
  builtInLibraryItems.forEach(item => {
    symbolLibrary.push({
      name: item.name,
      category: item.category,
      icon: item.icon,
      builtIn: true,
      factory: item.factory,
      geometry: null, // lazy, built from factory
    });
  });
  rebuildLibraryGrid();
}

function rebuildLibraryGrid() {
  const grid = document.getElementById('library-grid');
  if (!grid) return;
  grid.innerHTML = '';
  symbolLibrary.forEach((item, idx) => {
    const el = document.createElement('div');
    el.className = 'lib-item';
    el.title = `${item.name}\n(${item.category})`;
    el.innerHTML = `
      <span class="lib-category">${item.category}</span>
      ${!item.builtIn ? '<span class="lib-del" data-idx="' + idx + '" title="Remove"><i class="fa-solid fa-xmark"></i></span>' : ''}
      <i class="fa-solid ${item.icon || 'fa-cube'}"></i>
      <span>${item.name}</span>
    `;
    el.addEventListener('click', (e) => {
      if (e.target.closest('.lib-del')) {
        removeLibraryItem(idx);
        return;
      }
      placeLibraryItem(item);
    });
    grid.appendChild(el);
  });
}

function placeLibraryItem(item) {
  let group;
  if (item.factory) {
    group = item.factory();
  } else if (item.serializedChildren) {
    // Imported / saved item — reconstruct from serialized data
    group = deserializeGroup(item.serializedChildren);
  } else {
    setStatus('Cannot place this library item');
    return;
  }

  state.objectCounter++;
  const name = `${item.name}_${state.objectCounter}`;
  group.userData = {
    name,
    type: 'library-' + item.name.toLowerCase().replace(/\s+/g, '-'),
    id: THREE.MathUtils.generateUUID(),
    visible: true,
    customProps: { librarySource: item.name },
    isLibraryInstance: true,
  };
  group.position.y = 0;

  scene.add(group);
  state.objects.push(group);
  selectObject(group);
  pushUndo('add', group);
  rebuildHierarchy();
  updateViewportInfo();
  setStatus(`Placed ${name} from library`);
}

function saveSelectedToLibrary() {
  const obj = state.selected;
  if (!obj) {
    setStatus('Select an object to save to library');
    return;
  }
  const name = prompt('Library item name:', obj.userData.name || 'Custom Item');
  if (!name) return;
  const category = prompt('Category:', 'Custom') || 'Custom';

  // Serialize the object
  const serialized = serializeObject(obj);
  symbolLibrary.push({
    name,
    category,
    icon: 'fa-bookmark',
    builtIn: false,
    factory: null,
    serializedChildren: serialized,
  });
  rebuildLibraryGrid();
  setStatus(`Saved "${name}" to library`);
}

function serializeObject(obj) {
  if (obj.isGroup) {
    return {
      type: 'group',
      children: obj.children.map(c => serializeObject(c)),
      position: obj.position.toArray(),
      rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z],
      scale: obj.scale.toArray(),
    };
  }
  const data = {
    type: 'mesh',
    geometryJson: obj.geometry?.toJSON(),
    materialJson: obj.material?.toJSON(),
    position: obj.position.toArray(),
    rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z],
    scale: obj.scale.toArray(),
  };
  return data;
}

function deserializeGroup(data) {
  if (data.type === 'group') {
    const g = new THREE.Group();
    g.position.fromArray(data.position || [0,0,0]);
    g.rotation.set(...(data.rotation || [0,0,0]));
    g.scale.fromArray(data.scale || [1,1,1]);
    (data.children || []).forEach(c => g.add(deserializeGroup(c)));
    return g;
  }
  // Mesh
  const loader = new THREE.BufferGeometryLoader();
  const geom = data.geometryJson ? loader.parse(data.geometryJson) : new THREE.BoxGeometry(1,1,1);
  const matLoader = new THREE.MaterialLoader();
  const mat = data.materialJson ? matLoader.parse(data.materialJson) : new THREE.MeshStandardMaterial();
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.fromArray(data.position || [0,0,0]);
  mesh.rotation.set(...(data.rotation || [0,0,0]));
  mesh.scale.fromArray(data.scale || [1,1,1]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function importModelToLibrary() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.gltf,.glb,.obj,.stl,.fbx,.ply,.dae';
  input.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const name = prompt('Library item name:', file.name.replace(/\.[^.]+$/, '')) || file.name;
    const category = prompt('Category:', 'Imported') || 'Imported';
    const ext = file.name.split('.').pop().toLowerCase();

    try {
      document.getElementById('loading-overlay').style.display = '';
      document.getElementById('loading-text').textContent = `Importing ${file.name}...`;

      let object;
      const url = URL.createObjectURL(file);
      if (ext === 'glb' || ext === 'gltf') {
        const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
        const loader = new GLTFLoader();
        const gltf = await new Promise((res, rej) => loader.load(url, res, undefined, rej));
        object = gltf.scene;
      } else if (ext === 'obj') {
        const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js');
        const loader = new OBJLoader();
        object = await new Promise((res, rej) => loader.load(url, res, undefined, rej));
      } else if (ext === 'stl') {
        const { STLLoader } = await import('three/addons/loaders/STLLoader.js');
        const loader = new STLLoader();
        const geom = await new Promise((res, rej) => loader.load(url, res, undefined, rej));
        object = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ color: 0x888888 }));
      } else if (ext === 'fbx') {
        const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');
        const loader = new FBXLoader();
        object = await new Promise((res, rej) => loader.load(url, res, undefined, rej));
      } else if (ext === 'ply') {
        const { PLYLoader } = await import('three/addons/loaders/PLYLoader.js');
        const loader = new PLYLoader();
        const geom = await new Promise((res, rej) => loader.load(url, res, undefined, rej));
        object = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ color: 0x888888 }));
      } else if (ext === 'dae') {
        const { ColladaLoader } = await import('three/addons/loaders/ColladaLoader.js');
        const loader = new ColladaLoader();
        const collada = await new Promise((res, rej) => loader.load(url, res, undefined, rej));
        object = collada.scene;
      }
      URL.revokeObjectURL(url);

      if (!object) { setStatus('Import failed'); return; }

      const serialized = serializeObject(object);
      symbolLibrary.push({
        name,
        category,
        icon: 'fa-file-import',
        builtIn: false,
        factory: null,
        serializedChildren: serialized,
      });
      rebuildLibraryGrid();
      setStatus(`Imported "${name}" to library`);
    } catch (err) {
      console.error('Library import error:', err);
      setStatus(`Import failed: ${err.message}`);
    } finally {
      document.getElementById('loading-overlay').style.display = 'none';
    }
  });
  input.click();
}

function removeLibraryItem(idx) {
  const item = symbolLibrary[idx];
  if (!item || item.builtIn) return;
  symbolLibrary.splice(idx, 1);
  rebuildLibraryGrid();
  setStatus(`Removed "${item.name}" from library`);
}

function resetLibraryToDefaults() {
  symbolLibrary.length = 0;
  builtInLibraryItems.forEach(item => {
    symbolLibrary.push({
      name: item.name,
      category: item.category,
      icon: item.icon,
      builtIn: true,
      factory: item.factory,
      geometry: null,
    });
  });
  rebuildLibraryGrid();
  setStatus('Library reset to defaults');
}

// ─── Undo / Redo (simple) ───
function pushUndo(action, obj) {
  const snapshot = {
    action,
    id: obj.userData.id,
    position: obj.position.clone(),
    rotation: obj.rotation.clone(),
    scale: obj.scale.clone(),
  };
  state.undoStack.push(snapshot);
  if (state.undoStack.length > 50) state.undoStack.shift();
  state.redoStack = [];
}

// ─── Viewport Info ───
function updateViewportInfo() {
  let verts = 0, faces = 0;
  state.objects.forEach(obj => {
    if (obj.geometry) {
      const g = obj.geometry;
      verts += g.attributes.position ? g.attributes.position.count : 0;
      faces += g.index ? g.index.count / 3 : (g.attributes.position ? g.attributes.position.count / 3 : 0);
    }
  });
  document.getElementById('viewport-info').textContent =
    `Objects: ${state.objects.length} | Vertices: ${verts.toLocaleString()} | Faces: ${Math.floor(faces).toLocaleString()}`;
}

// ─── Mouse Picking ───
function onCanvasClick(event) {
  if (!state.viewMode && transformControls.dragging) return;

  const rect = canvas.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const meshes = state.objects.filter(o => o.isMesh || o.isGroup);
  const intersects = raycaster.intersectObjects(meshes, true);

  if (intersects.length > 0) {
    // Find the top-level object in state.objects
    let hit = intersects[0].object;
    while (hit.parent && !state.objects.includes(hit)) hit = hit.parent;
    if (!state.objects.includes(hit)) hit = intersects[0].object;

    if (event.ctrlKey || event.metaKey) {
      if (!state.viewMode) addToMultiSelect(hit);
      else selectObject(hit);
    } else {
      state.multiSelected = [hit];
      selectObject(hit);
    }
  } else {
    deselectAll();
  }
}

// ─── Context Menu ───
const ctxMenu = document.getElementById('context-menu');
function showContextMenu(x, y) {
  ctxMenu.style.display = '';
  ctxMenu.style.left = x + 'px';
  ctxMenu.style.top = y + 'px';
}
function hideContextMenu() { ctxMenu.style.display = 'none'; }

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (state.viewMode) return;
  const rect = canvas.getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const meshes = state.objects.filter(o => o.isMesh);
  const intersects = raycaster.intersectObjects(meshes, false);
  if (intersects.length > 0) {
    selectObject(intersects[0].object);
    showContextMenu(e.clientX, e.clientY);
  } else {
    hideContextMenu();
  }
});

document.addEventListener('click', (e) => {
  if (!ctxMenu.contains(e.target)) hideContextMenu();
});

ctxMenu.querySelectorAll('button').forEach(btn => {
  btn.addEventListener('click', () => {
    const action = btn.dataset.action;
    switch (action) {
      case 'duplicate': duplicateSelected(); break;
      case 'delete': deleteSelected(); break;
      case 'focus': focusSelected(); break;
      case 'group': groupSelected(); break;
      case 'ungroup': ungroupSelected(); break;
      case 'hide':
        if (state.selected) {
          state.selected.visible = false;
          rebuildHierarchy();
        }
        break;
      case 'reset-transform':
        if (state.selected) {
          state.selected.position.set(0, 0.5, 0);
          state.selected.rotation.set(0, 0, 0);
          state.selected.scale.set(1, 1, 1);
          updatePropertiesPanel();
        }
        break;
    }
    hideContextMenu();
  });
});

// ─── Focus ───
function focusSelected() {
  const obj = state.selected;
  if (!obj) return;
  const box = new THREE.Box3();
  if (obj.geometry) {
    box.setFromObject(obj);
  } else {
    box.setFromCenterAndSize(obj.position, new THREE.Vector3(2, 2, 2));
  }
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).length();
  const dist = size * 2;

  orbitControls.target.copy(center);
  camera.position.copy(center).add(
    camera.position.clone().sub(orbitControls.target).normalize().multiplyScalar(dist)
  );
  orbitControls.update();
}

// ─── Camera Views ───
function setCameraView(view) {
  const dist = 10;
  const target = orbitControls.target.clone();
  let pos;
  switch (view) {
    case 'front': pos = new THREE.Vector3(0, 0, dist); break;
    case 'back': pos = new THREE.Vector3(0, 0, -dist); break;
    case 'left': pos = new THREE.Vector3(-dist, 0, 0); break;
    case 'right': pos = new THREE.Vector3(dist, 0, 0); break;
    case 'top': pos = new THREE.Vector3(0, dist, 0.01); break;
    case 'bottom': pos = new THREE.Vector3(0, -dist, 0.01); break;
    case 'perspective': pos = new THREE.Vector3(6, 5, 8); break;
    default: return;
  }
  camera.position.copy(target).add(pos);
  orbitControls.update();
  document.getElementById('view-label').textContent = capitalize(view);
}

// ─── Toolbar Event Wiring ───
function setupToolbar() {
  // Transform mode
  document.getElementById('transform-group').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-mode]');
    if (!btn) return;
    state.transformMode = btn.dataset.mode;
    transformControls.setMode(state.transformMode);
    document.querySelectorAll('#transform-group .tool-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });

  // Transform space
  document.getElementById('space-group').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-space]');
    if (!btn) return;
    state.transformSpace = btn.dataset.space;
    transformControls.setSpace(state.transformSpace);
    document.querySelectorAll('#space-group .tool-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });

  // Snap
  document.getElementById('btn-snap').addEventListener('click', function () {
    state.snap = !state.snap;
    this.classList.toggle('active', state.snap);
    const val = state.snap ? state.snapValue : null;
    transformControls.setTranslationSnap(val);
    transformControls.setRotationSnap(val ? THREE.MathUtils.degToRad(15) : null);
    transformControls.setScaleSnap(val ? 0.25 : null);
  });
  document.getElementById('snap-value').addEventListener('change', (e) => {
    state.snapValue = parseFloat(e.target.value) || 1;
    if (state.snap) {
      transformControls.setTranslationSnap(state.snapValue);
    }
  });

  // Grid
  document.getElementById('btn-grid').addEventListener('click', function () {
    state.gridVisible = !state.gridVisible;
    gridHelper.visible = state.gridVisible;
    this.classList.toggle('active', state.gridVisible);
  });

  // Wireframe
  document.getElementById('btn-wireframe').addEventListener('click', function () {
    state.wireframeMode = !state.wireframeMode;
    this.classList.toggle('active', state.wireframeMode);
    state.objects.forEach(obj => {
      if (obj.material) obj.material.wireframe = state.wireframeMode;
    });
  });

  // Focus
  document.getElementById('btn-focus').addEventListener('click', focusSelected);

  // Delete & Duplicate
  document.getElementById('btn-delete').addEventListener('click', deleteSelected);
  document.getElementById('btn-duplicate').addEventListener('click', duplicateSelected);

  // Undo / Redo buttons
  document.getElementById('btn-undo').addEventListener('click', () => setStatus('Undo (limited)'));
  document.getElementById('btn-redo').addEventListener('click', () => setStatus('Redo (limited)'));

  // View navigation
  document.querySelectorAll('.nav-btn[data-view]').forEach(btn => {
    btn.addEventListener('click', () => setCameraView(btn.dataset.view));
  });

  // Zoom
  document.getElementById('btn-zoom-in').addEventListener('click', () => {
    camera.position.lerp(orbitControls.target, 0.2);
    orbitControls.update();
  });
  document.getElementById('btn-zoom-out').addEventListener('click', () => {
    const dir = camera.position.clone().sub(orbitControls.target).normalize();
    camera.position.add(dir.multiplyScalar(2));
    orbitControls.update();
  });
  document.getElementById('btn-zoom-fit').addEventListener('click', () => {
    if (state.objects.length === 0) return;
    const box = new THREE.Box3();
    state.objects.forEach(o => { if (o.geometry) box.expandByObject(o); });
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    const dist = size * 1.5;
    orbitControls.target.copy(center);
    camera.position.copy(center).add(new THREE.Vector3(dist * 0.6, dist * 0.5, dist * 0.6));
    orbitControls.update();
  });

  // Primitives
  document.querySelectorAll('.prim-btn[data-shape]').forEach(btn => {
    btn.addEventListener('click', () => addObject(btn.dataset.shape));
  });

  // Lights
  document.querySelectorAll('.prim-btn[data-light]').forEach(btn => {
    btn.addEventListener('click', () => addLight(btn.dataset.light));
  });

  // View mode toggle
  document.getElementById('btn-view-mode').addEventListener('click', toggleViewMode);
  document.getElementById('btn-exit-view-mode').addEventListener('click', toggleViewMode);

  // Export
  document.getElementById('btn-export').addEventListener('click', exportScene);
  document.getElementById('btn-screenshot').addEventListener('click', takeScreenshot);

  // Hierarchy panel header buttons
  document.getElementById('btn-hier-delete').addEventListener('click', deleteSelected);
  document.getElementById('btn-hier-rename').addEventListener('click', () => {
    if (!state.selected) return;
    const items = document.querySelectorAll('.hier-item');
    for (const el of items) {
      const nameSpan = el.querySelector('.hier-name');
      if (nameSpan && nameSpan.textContent.includes(state.selected.userData.name)) {
        startInlineRename(state.selected, el);
        break;
      }
    }
  });

  // Custom properties
  document.getElementById('btn-add-prop').addEventListener('click', () => {
    if (!state.selected) return;
    if (!state.selected.userData.customProps) state.selected.userData.customProps = {};
    let i = 1;
    while (state.selected.userData.customProps[`prop${i}`] !== undefined) i++;
    state.selected.userData.customProps[`prop${i}`] = '';
    updateCustomPropsPanel();
    setStatus(`Added property "prop${i}"`);
  });

  // CSG / Combine buttons
  document.getElementById('btn-csg-union').addEventListener('click', () => performCSG('union'));
  document.getElementById('btn-csg-subtract').addEventListener('click', () => performCSG('subtract'));
  document.getElementById('btn-csg-intersect').addEventListener('click', () => performCSG('intersect'));
  document.getElementById('btn-merge').addEventListener('click', mergeSelected);

  // Library buttons
  document.getElementById('btn-lib-save').addEventListener('click', saveSelectedToLibrary);
  document.getElementById('btn-lib-import').addEventListener('click', importModelToLibrary);

  // Menu bar dropdowns
  setupMenuBar();
}

// ─── Menu Bar ───
function setupMenuBar() {
  let openMenu = null;

  function closeAllMenus() {
    document.querySelectorAll('.menu-dropdown').forEach(d => d.classList.remove('open'));
    document.querySelectorAll('.menu-btn').forEach(b => b.classList.remove('open'));
    openMenu = null;
  }

  // Toggle dropdown on click
  document.querySelectorAll('.menu-btn[data-menu]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const menuId = 'menu-' + btn.dataset.menu;
      const dropdown = document.getElementById(menuId);
      if (!dropdown) return;

      if (openMenu === menuId) {
        closeAllMenus();
        return;
      }
      closeAllMenus();
      dropdown.classList.add('open');
      btn.classList.add('open');
      openMenu = menuId;
    });

    // Hover to switch between menus when one is open
    btn.addEventListener('mouseenter', () => {
      if (!openMenu) return;
      const menuId = 'menu-' + btn.dataset.menu;
      const dropdown = document.getElementById(menuId);
      if (!dropdown || openMenu === menuId) return;
      closeAllMenus();
      dropdown.classList.add('open');
      btn.classList.add('open');
      openMenu = menuId;
    });
  });

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.menu-item')) closeAllMenus();
  });

  // Menu actions
  document.querySelectorAll('.menu-dropdown button[data-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      closeAllMenus();
      handleMenuAction(action);
    });
  });
}

function handleMenuAction(action) {
  switch (action) {
    // File
    case 'new-scene': newScene(); break;
    case 'import-scene': importScene(); break;
    case 'import-gltf': importFile('gltf'); break;
    case 'import-obj': importFile('obj'); break;
    case 'import-stl': importFile('stl'); break;
    case 'import-fbx': importFile('fbx'); break;
    case 'import-ply': importFile('ply'); break;
    case 'export-scene': exportScene(); break;
    case 'export-gltf': exportAs('gltf'); break;
    case 'export-glb': exportAs('glb'); break;
    case 'export-obj': exportAs('obj'); break;
    case 'export-stl': exportAs('stl'); break;
    case 'export-stl-binary': exportAs('stl-binary'); break;
    case 'export-ply': exportAs('ply'); break;
    case 'screenshot': takeScreenshot(); break;
    case 'record-video': startRecording(); break;
    case 'stop-recording': stopRecording(); break;
    case 'download-video': downloadVideo(); break;
    // Edit
    case 'undo': setStatus('Undo'); break;
    case 'redo': setStatus('Redo'); break;
    case 'duplicate': duplicateSelected(); break;
    case 'delete': deleteSelected(); break;
    case 'select-all': selectAll(); break;
    case 'deselect': deselectAll(); break;
    // View
    case 'view-front': setCameraView('front'); break;
    case 'view-back': setCameraView('back'); break;
    case 'view-left': setCameraView('left'); break;
    case 'view-right': setCameraView('right'); break;
    case 'view-top': setCameraView('top'); break;
    case 'view-perspective': setCameraView('perspective'); break;
    case 'toggle-grid':
      state.gridVisible = !state.gridVisible;
      gridHelper.visible = state.gridVisible;
      break;
    case 'toggle-wireframe':
      state.wireframeMode = !state.wireframeMode;
      document.getElementById('btn-wireframe').classList.toggle('active', state.wireframeMode);
      state.objects.forEach(obj => { if (obj.material) obj.material.wireframe = state.wireframeMode; });
      break;
    case 'focus': focusSelected(); break;
    // Add
    case 'add-box': addObject('box'); break;
    case 'add-sphere': addObject('sphere'); break;
    case 'add-cylinder': addObject('cylinder'); break;
    case 'add-cone': addObject('cone'); break;
    case 'add-torus': addObject('torus'); break;
    case 'add-plane': addObject('plane'); break;
    case 'add-icosahedron': addObject('icosahedron'); break;
    case 'add-torusknot': addObject('torusknot'); break;
    case 'add-dodecahedron': addObject('dodecahedron'); break;
    case 'add-octahedron': addObject('octahedron'); break;
    case 'add-tetrahedron': addObject('tetrahedron'); break;
    case 'add-pyramid': addObject('pyramid'); break;
    case 'add-capsule': addObject('capsule'); break;
    case 'add-point-light': addLight('point'); break;
    case 'add-spot-light': addLight('spot'); break;
    case 'add-dir-light': addLight('directional'); break;
    // Help
    case 'toggle-view-mode': toggleViewMode(); break;
    case 'help-shortcuts': showShortcutsDialog(); break;
    case 'help-about': showAboutDialog(); break;
    case 'reset-library': resetLibraryToDefaults(); break;
    case 'self-test': runSelfTest(); break;
    // Physics demos
    case 'demo-dominoes': loadPhysicsDemo('dominoes'); break;
    case 'demo-bowling': loadPhysicsDemo('bowling'); break;
    case 'demo-tower': loadPhysicsDemo('tower'); break;
    case 'demo-ramp': loadPhysicsDemo('ramp'); break;
    case 'demo-cradle': loadPhysicsDemo('cradle'); break;
    case 'demo-double-pendulum': loadPhysicsDemo('double-pendulum'); break;
    case 'demo-projectile': loadPhysicsDemo('projectile'); break;
    case 'demo-robot-arm': loadPhysicsDemo('robot-arm'); break;
  }
}

function newScene() {
  if (!confirm('Create a new scene? Unsaved changes will be lost.')) return;

  // Reset physics
  if (physics.running) resetPhysics();
  physics.constraints.forEach(c => { if (physics.world) physics.world.removeConstraint(c); });
  physics.constraints = [];
  physics.anchorBodies.forEach(b => { if (physics.world) physics.world.removeBody(b); });
  physics.anchorBodies = [];
  physics.pendulumVisuals = [];
  physics.robotArm = null;
  cleanupTrails();
  physics.bodies.forEach((body) => { if (physics.world) physics.world.removeBody(body); });
  physics.bodies.clear();
  physics.savedTransforms.clear();

  // Remove all user objects
  [...state.objects].forEach(obj => {
    const helper = lightHelpers.get(obj.userData.id);
    if (helper) { scene.remove(helper); helper.dispose?.(); lightHelpers.delete(obj.userData.id); }
    scene.remove(obj);
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
      else obj.material.dispose();
    }
  });
  state.objects = [];
  state.selected = null;
  state.objectCounter = 0;
  transformControls.detach();
  selectObject(null);
  rebuildHierarchy();
  updateViewportInfo();
  document.getElementById('doc-title').value = 'Untitled Scene';
  setStatus('New scene created');
}

function importScene() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (data.background) {
          scene.background.set(data.background);
          document.getElementById('bg-color').value = data.background;
          document.getElementById('bg-color-hex').value = data.background;
        }
        if (data.ambientIntensity !== undefined) {
          ambientLight.intensity = data.ambientIntensity;
          document.getElementById('ambient-intensity').value = data.ambientIntensity;
        }
        // Restore library
        if (data.library) {
          symbolLibrary.length = 0;
          builtInLibraryItems.forEach(item => {
            symbolLibrary.push({
              name: item.name,
              category: item.category,
              icon: item.icon,
              builtIn: true,
              factory: item.factory,
              geometry: null,
            });
          });
          // Add custom library items
          data.library.forEach(libItem => {
            if (!libItem.builtIn && libItem.serializedChildren) {
              symbolLibrary.push({
                name: libItem.name,
                category: libItem.category,
                icon: libItem.icon || 'fa-bookmark',
                builtIn: false,
                factory: null,
                serializedChildren: libItem.serializedChildren,
              });
            }
          });
          rebuildLibraryGrid();
        }
        if (data.objects) {
          data.objects.forEach(o => {
            importSceneObject(o);
          });
        }
        rebuildHierarchy();
        updateViewportInfo();
        setStatus(`Imported ${file.name} (${data.objects?.length || 0} objects)`);
      } catch (err) {
        console.error('Import failed:', err);
        setStatus('Import failed: invalid file');
      }
    };
    reader.readAsText(file);
  });
  input.click();
}

function importSceneObject(o) {
  if (o.isLight) {
    // Determine light type from light sub-object or type field
    const lightType = o.light?.lightType || o.type?.replace('-light', '').replace('light', '') || 'point';
    addLight(lightType);
    const light = state.selected;
    light.position.fromArray(o.position || [0, 3, 0]);
    if (o.rotation) light.rotation.set(o.rotation[0], o.rotation[1], o.rotation[2]);
    if (o.scale) light.scale.fromArray(o.scale);
    // Restore light properties
    if (o.light) {
      if (o.light.color) light.color.set(o.light.color);
      if (o.light.intensity !== undefined) light.intensity = o.light.intensity;
      if (o.light.distance !== undefined && light.distance !== undefined) light.distance = o.light.distance;
    } else if (o.color) {
      light.color.set(o.color);
    }
    // Restore name and custom props
    if (o.name) light.userData.name = o.name;
    if (o.id) light.userData.id = o.id;
    if (o.customProperties) light.userData.customProps = { ...o.customProperties };
    updatePropertiesPanel();
    return;
  }

  // Check if this is a library instance that should be recreated from the library
  if (o.isLibraryInstance && o.librarySymbolName) {
    const libItem = symbolLibrary.find(item => item.name === o.librarySymbolName);
    if (libItem) {
      let group;
      if (libItem.factory) {
        group = libItem.factory();
      } else if (libItem.serializedChildren) {
        group = deserializeGroup(libItem.serializedChildren);
      } else {
        // Fallback: treat as regular group
        group = new THREE.Group();
      }
      
      group.position.fromArray(o.position || [0, 0, 0]);
      if (o.rotation) group.rotation.set(o.rotation[0], o.rotation[1], o.rotation[2]);
      if (o.scale) group.scale.fromArray(o.scale);
      
      state.objectCounter++;
      group.userData = {
        name: o.name || `${o.librarySymbolName}_${state.objectCounter}`,
        type: o.type || 'library-instance',
        id: o.id || THREE.MathUtils.generateUUID(),
        visible: o.visible !== false,
        isLibraryInstance: true,
        customProps: o.customProperties ? { ...o.customProperties } : { librarySource: o.librarySymbolName },
        physics: o.physics ? { ...o.physics } : undefined,
      };
      
      scene.add(group);
      state.objects.push(group);
      selectObject(group);
      return;
    }
  }

  // Check if this is a group / library instance with children
  if (o.children && o.children.length > 0) {
    const group = new THREE.Group();
    group.position.fromArray(o.position || [0, 0, 0]);
    if (o.rotation) group.rotation.set(o.rotation[0], o.rotation[1], o.rotation[2]);
    if (o.scale) group.scale.fromArray(o.scale);

    state.objectCounter++;
    group.userData = {
      name: o.name || `Group_${state.objectCounter}`,
      type: o.type || 'group',
      id: o.id || THREE.MathUtils.generateUUID(),
      visible: o.visible !== false,
      isLibraryInstance: !!o.isLibraryInstance,
      customProps: o.customProperties ? { ...o.customProperties } : {},
      physics: o.physics ? { ...o.physics } : undefined,
    };

    // Recursively add children
    o.children.forEach(child => {
      const childObj = createObjectFromData(child);
      if (childObj) group.add(childObj);
    });

    scene.add(group);
    state.objects.push(group);
    if (o.physics?.enabled) enablePhysicsForObject(group);
    selectObject(group);
    pushUndo('add', group);
    return;
  }

  // Simple mesh object
  const knownShapes = ['box', 'sphere', 'cylinder', 'cone', 'torus', 'plane', 'icosahedron', 'torusknot'];
  const shape = knownShapes.includes(o.type) ? o.type : 'box';

  // Re-create geometry: try reconstructing from Three.js geometry type first, then from shape
  let geom = reconstructGeometry(o.geometry);
  if (!geom) {
    geom = createGeometry(shape);
  }

  // Restore material
  let mat;
  if (o.material) {
    mat = new THREE.MeshStandardMaterial({
      color: o.material.color || '#5b8def',
      metalness: o.material.metalness ?? 0.1,
      roughness: o.material.roughness ?? 0.5,
      opacity: o.material.opacity ?? 1,
      transparent: !!o.material.transparent,
      wireframe: !!o.material.wireframe,
    });
  } else {
    mat = new THREE.MeshStandardMaterial({
      color: o.color || '#5b8def',
      metalness: 0.1,
      roughness: 0.5,
    });
  }

  const mesh = new THREE.Mesh(geom, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.position.fromArray(o.position || [0, 0.5, 0]);
  if (o.rotation) mesh.rotation.set(o.rotation[0], o.rotation[1], o.rotation[2]);
  if (o.scale) mesh.scale.fromArray(o.scale);

  state.objectCounter++;
  mesh.userData = {
    name: o.name || `${capitalize(shape)}_${state.objectCounter}`,
    type: o.type || shape,
    id: o.id || THREE.MathUtils.generateUUID(),
    visible: o.visible !== false,
    locked: false,
    isLibraryInstance: !!o.isLibraryInstance,
    customProps: o.customProperties ? { ...o.customProperties } : {},
    physics: o.physics ? { ...o.physics } : undefined,
  };

  scene.add(mesh);
  state.objects.push(mesh);
  if (o.physics?.enabled) enablePhysicsForObject(mesh);
  selectObject(mesh);
  pushUndo('add', mesh);
}

function createObjectFromData(o) {
  // Helper to create a child object (mesh) from serialized data — non-top-level
  // Try to reconstruct geometry from Three.js geometry type + native parameters first
  let geom = reconstructGeometry(o.geometry);
  if (!geom) {
    const knownShapes = ['box', 'sphere', 'cylinder', 'cone', 'torus', 'plane', 'icosahedron', 'torusknot'];
    const shape = knownShapes.includes(o.type) ? o.type : null;
    geom = shape ? createGeometry(shape) : new THREE.BoxGeometry(1, 1, 1);
  }

  let mat;
  if (o.material) {
    mat = new THREE.MeshStandardMaterial({
      color: o.material.color || '#cccccc',
      metalness: o.material.metalness ?? 0.1,
      roughness: o.material.roughness ?? 0.5,
      opacity: o.material.opacity ?? 1,
      transparent: !!o.material.transparent,
      wireframe: !!o.material.wireframe,
    });
  } else {
    mat = new THREE.MeshStandardMaterial({ color: o.color || '#cccccc' });
  }

  const mesh = new THREE.Mesh(geom, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.position.fromArray(o.position || [0, 0, 0]);
  if (o.rotation) mesh.rotation.set(o.rotation[0], o.rotation[1], o.rotation[2]);
  if (o.scale) mesh.scale.fromArray(o.scale);
  mesh.userData = {
    name: o.name || 'Part',
    type: o.type || 'mesh',
    customProps: o.customProperties ? { ...o.customProperties } : {},
  };

  // If this child has its own children (nested groups)
  if (o.children && o.children.length > 0) {
    const group = new THREE.Group();
    group.position.copy(mesh.position);
    group.rotation.copy(mesh.rotation);
    group.scale.copy(mesh.scale);
    group.userData = { ...mesh.userData };
    o.children.forEach(child => {
      const childObj = createObjectFromData(child);
      if (childObj) group.add(childObj);
    });
    return group;
  }

  return mesh;
}

function selectAll() {
  if (state.objects.length > 0) {
    selectObject(state.objects[state.objects.length - 1]);
    setStatus(`${state.objects.length} objects in scene`);
  }
}

function showShortcutsDialog() {
  const shortcuts = [
    ['W', 'Move tool'], ['E', 'Rotate tool'], ['R', 'Scale tool'],
    ['F', 'Focus selected'], ['G', 'Toggle grid'], ['Del / ⌫', 'Delete selected'],
    ['⌘D', 'Duplicate'], ['⌘Z', 'Undo'], ['Esc', 'Deselect'],
    ['Right-click', 'Context menu'], ['Scroll', 'Zoom'], ['Middle-drag', 'Orbit'],
  ];
  const html = shortcuts.map(([k, v]) =>
    `<div style="display:flex;justify-content:space-between;padding:3px 0;">
      <span style="color:#9999bb;">${v}</span>
      <kbd style="background:#252540;padding:2px 8px;border-radius:4px;font-size:11px;color:#e8e8f0;border:1px solid #35355a;">${k}</kbd>
    </div>`
  ).join('');
  showModal('Keyboard Shortcuts', html);
}

function showAboutDialog() {
  showModal('About Studio3D',
    `<p style="color:#9999bb;line-height:1.6;">Studio3D is a browser-based 3D design tool built with Three.js.<br><br>` +
    `Create and manipulate 3D objects, adjust materials and lighting, and export your scenes.<br><br>` +
    `<span style="color:#666688;">Version 1.0 &middot; Powered by Three.js r163</span></p>`
  );
}

function showModal(title, bodyHtml) {
  // Remove existing modal
  document.getElementById('modal-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'modal-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:2000;display:flex;align-items:center;justify-content:center;';
  const modal = document.createElement('div');
  modal.style.cssText = 'background:#1c1c30;border:1px solid #35355a;border-radius:8px;padding:20px;min-width:320px;max-width:420px;box-shadow:0 12px 40px rgba(0,0,0,0.6);animation:fadeIn 150ms ease;';
  modal.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
      <h3 style="font-size:14px;font-weight:600;color:#e8e8f0;margin:0;">${title}</h3>
      <button id="modal-close" style="background:none;border:none;color:#666688;cursor:pointer;font-size:16px;padding:4px;"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div>${bodyHtml}</div>
  `;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  modal.querySelector('#modal-close').addEventListener('click', () => overlay.remove());
}

// ─── Keyboard Shortcuts ───
function setupKeyboard() {
  document.addEventListener('keydown', (e) => {
    // Ignore if typing in input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    switch (e.key.toLowerCase()) {
      case 'w':
        if (state.viewMode) return;
        state.transformMode = 'translate';
        transformControls.setMode('translate');
        syncTransformButtons();
        break;
      case 'e':
        if (state.viewMode) return;
        state.transformMode = 'rotate';
        transformControls.setMode('rotate');
        syncTransformButtons();
        break;
      case 'r':
        if (state.viewMode) return;
        state.transformMode = 'scale';
        transformControls.setMode('scale');
        syncTransformButtons();
        break;
      case 'delete':
      case 'backspace':
        if (e.metaKey || e.ctrlKey) return;
        if (state.viewMode) return;
        e.preventDefault();
        deleteSelected();
        break;
      case 'f':
        focusSelected();
        break;
      case 'd':
        if (state.viewMode) return;
        if (e.ctrlKey || e.metaKey) { e.preventDefault(); duplicateSelected(); }
        break;
      case 'z':
        if (e.ctrlKey || e.metaKey) setStatus('Undo');
        break;
      case 'escape':
        deselectAll();
        hideContextMenu();
        break;
      case 'g':
        state.gridVisible = !state.gridVisible;
        gridHelper.visible = state.gridVisible;
        break;
      case 'v':
        toggleViewMode();
        break;
      case 'p':
        if (e.ctrlKey || e.metaKey) { e.preventDefault(); takeScreenshot(); }
        break;
      case 'r':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          if (isRecording) stopRecording();
          else startRecording();
        }
        break;
    }
  });
}

function syncTransformButtons() {
  document.querySelectorAll('#transform-group .tool-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === state.transformMode);
  });
}

// ─── Loading Overlay ───
function showLoading(msg = 'Loading...') {
  document.getElementById('loading-text').textContent = msg;
  document.getElementById('loading-overlay').style.display = '';
}
function hideLoading() {
  document.getElementById('loading-overlay').style.display = 'none';
}

// ─── 3D Format Import ───
function importFile(format) {
  const acceptMap = {
    gltf: '.gltf,.glb',
    obj: '.obj',
    stl: '.stl',
    fbx: '.fbx',
    ply: '.ply',
  };
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = acceptMap[format] || '*';
  input.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    showLoading(`Importing ${file.name}...`);
    const url = URL.createObjectURL(file);
    const name = file.name.replace(/\.[^.]+$/, '');

    const onLoaded = (object) => {
      registerImportedObject(object, name, format);
      URL.revokeObjectURL(url);
      hideLoading();
      setStatus(`Imported ${file.name}`);
    };
    const onError = (err) => {
      console.error('Import error:', err);
      URL.revokeObjectURL(url);
      hideLoading();
      setStatus(`Import failed: ${err.message || 'unknown error'}`);
    };
    const onProgress = (xhr) => {
      if (xhr.total) {
        const pct = Math.round((xhr.loaded / xhr.total) * 100);
        document.getElementById('loading-text').textContent = `Importing... ${pct}%`;
      }
    };

    (async () => {
      try {
        switch (format) {
          case 'gltf': {
            const { GLTFLoader } = await loadModule('three/addons/loaders/GLTFLoader.js');
            const loader = new GLTFLoader();
            loader.load(url, (gltf) => onLoaded(gltf.scene), onProgress, onError);
            break;
          }
          case 'obj': {
            const { OBJLoader } = await loadModule('three/addons/loaders/OBJLoader.js');
            const loader = new OBJLoader();
            loader.load(url, onLoaded, onProgress, onError);
            break;
          }
          case 'stl': {
            const { STLLoader } = await loadModule('three/addons/loaders/STLLoader.js');
            const loader = new STLLoader();
            loader.load(url, (geometry) => {
              const mat = createDefaultMaterial();
              const mesh = new THREE.Mesh(geometry, mat);
              onLoaded(mesh);
            }, onProgress, onError);
            break;
          }
          case 'fbx': {
            const { FBXLoader } = await loadModule('three/addons/loaders/FBXLoader.js');
            const loader = new FBXLoader();
            loader.load(url, onLoaded, onProgress, onError);
            break;
          }
          case 'ply': {
            const { PLYLoader } = await loadModule('three/addons/loaders/PLYLoader.js');
            const loader = new PLYLoader();
            loader.load(url, (geometry) => {
              geometry.computeVertexNormals();
              const mat = createDefaultMaterial();
              const mesh = new THREE.Mesh(geometry, mat);
              onLoaded(mesh);
            }, onProgress, onError);
            break;
          }

          default:
            hideLoading();
            setStatus('Unsupported format');
        }
      } catch (err) {
        onError(err);
      }
    })();
  });
  input.click();
}

function registerImportedObject(object, name, format) {
  // Normalize: if it's a group/scene, wrap it; if single mesh, add directly
  state.objectCounter++;
  const objName = `${name}_${state.objectCounter}`;

  // Collect any existing userData/customProps before processing
  // (from GLTF extras, IFC properties, etc.)
  const existingProps = collectImportedProperties(object);

  // Compute bounding box to auto-scale large/tiny models
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  if (maxDim > 0) {
    const targetSize = 3;
    if (maxDim > targetSize * 5 || maxDim < targetSize * 0.1) {
      const s = targetSize / maxDim;
      object.scale.multiplyScalar(s);
    }
  }

  // Center the object
  const box2 = new THREE.Box3().setFromObject(object);
  const center = box2.getCenter(new THREE.Vector3());
  object.position.sub(center);
  object.position.y += box2.getSize(new THREE.Vector3()).y / 2;

  // Ensure shadows
  object.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      if (!child.material) child.material = createDefaultMaterial();
    }
  });

  // Merge existing properties into userData rather than overwriting
  const prevUserData = object.userData || {};
  object.userData = {
    name: existingProps.name || prevUserData.name || objName,
    type: existingProps.type || prevUserData.type || `imported-${format}`,
    id: prevUserData.id || THREE.MathUtils.generateUUID(),
    visible: true,
    imported: true,
    isLibraryInstance: existingProps.isLibraryInstance || !!prevUserData.isLibraryInstance,
    customProps: existingProps.customProps,
  };

  scene.add(object);
  state.objects.push(object);

  // Auto-expand in hierarchy if it has children
  const meshChildren = (object.children || []).filter(c => c.isMesh || c.isGroup || c.isLight);
  if (meshChildren.length > 0) {
    hierarchyExpanded.add(object.userData.id);
  }

  selectObject(object);
  rebuildHierarchy();
  updateViewportInfo();
}

function collectImportedProperties(object) {
  // Collect custom properties from various import sources
  const result = { customProps: {}, name: null, type: null, isLibraryInstance: false };

  // Check root object first
  const ud = object.userData || {};

  // GLTF extras (written by Studio3D exporter)
  if (ud.studio3d_customProperties) {
    Object.assign(result.customProps, ud.studio3d_customProperties);
  }
  if (ud.studio3d_name) result.name = ud.studio3d_name;
  if (ud.studio3d_type) result.type = ud.studio3d_type;
  if (ud.studio3d_libraryInstance) result.isLibraryInstance = true;

  // Direct customProps (from IFC parser, etc.)
  if (ud.customProps && Object.keys(ud.customProps).length > 0) {
    Object.assign(result.customProps, ud.customProps);
  }

  // Traverse children for GLTF extras too
  object.traverse(child => {
    if (child === object) return;
    const cud = child.userData || {};
    // Propagate child GLTF extras to child userData so they survive
    if (cud.studio3d_customProperties) {
      if (!child.userData.customProps) child.userData.customProps = {};
      Object.assign(child.userData.customProps, cud.studio3d_customProperties);
    }
    if (cud.studio3d_name) child.userData.name = cud.studio3d_name;
    if (cud.studio3d_type) child.userData.type = cud.studio3d_type;
  });

  return result;
}

// ─── 3D Format Export ───
function exportAs(format) {
  const meshes = getExportableObjects();
  if (meshes.length === 0) {
    setStatus('Nothing to export — add objects first');
    return;
  }

  showLoading(`Exporting as ${format.toUpperCase()}...`);
  const docTitle = document.getElementById('doc-title').value || 'scene';

  // Small delay to let loading overlay render
  setTimeout(async () => {
    try {
      switch (format) {
        case 'gltf': await exportGLTF(meshes, docTitle, false); break;
        case 'glb': await exportGLTF(meshes, docTitle, true); break;
        case 'obj': await exportOBJ(meshes, docTitle); break;
        case 'stl': await exportSTL(meshes, docTitle, false); break;
        case 'stl-binary': await exportSTL(meshes, docTitle, true); break;
        case 'ply': await exportPLY(meshes, docTitle); break;
        default:
          hideLoading();
          setStatus('Unsupported export format');
      }
    } catch (err) {
      console.error('Export error:', err);
      hideLoading();
      setStatus(`Export failed: ${err.message}`);
    }
  }, 50);
}

function getExportableObjects() {
  return state.objects.filter(o => !o.userData.isLight);
}

function buildExportScene(meshes) {
  const exportScene = new THREE.Scene();
  meshes.forEach(obj => {
    const clone = obj.clone(true);
    deepCloneUserData(clone);
    exportScene.add(clone);
  });
  return exportScene;
}

function deepCloneUserData(obj) {
  // Deep-clone userData so customProps are independent copies
  if (obj.userData) {
    const ud = { ...obj.userData };
    if (ud.customProps) ud.customProps = { ...ud.customProps };
    obj.userData = ud;
    // Set Three.js name from userData for formats that use node names (GLTF, OBJ)
    if (ud.name) obj.name = ud.name;
  }
  if (obj.children) obj.children.forEach(c => deepCloneUserData(c));
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadText(text, filename, mime = 'text/plain') {
  downloadBlob(new Blob([text], { type: mime }), filename);
}

async function exportGLTF(meshes, docTitle, binary) {
  try {
    const { GLTFExporter } = await loadModule('three/addons/exporters/GLTFExporter.js');
    const exporter = new GLTFExporter();
    const exportRoot = buildExportScene(meshes);

    // Prepare userData for GLTF extras: GLTFExporter writes userData as extras
    // Pack custom properties and library info into userData for each node
    exportRoot.traverse(node => {
      const ud = node.userData || {};
      const extras = {};
      if (ud.name) extras.studio3d_name = ud.name;
      if (ud.type) extras.studio3d_type = ud.type;
      if (ud.isLibraryInstance) extras.studio3d_libraryInstance = true;
      if (ud.customProps && Object.keys(ud.customProps).length > 0) {
        extras.studio3d_customProperties = { ...ud.customProps };
      }
      if (Object.keys(extras).length > 0) {
        node.userData = extras;
      }
    });

    exporter.parse(exportRoot, (result) => {
      if (binary) {
        downloadBlob(new Blob([result], { type: 'application/octet-stream' }), `${docTitle}.glb`);
      } else {
        downloadText(JSON.stringify(result, null, 2), `${docTitle}.gltf`, 'model/gltf+json');
      }
      hideLoading();
      setStatus(`Exported ${docTitle}.${binary ? 'glb' : 'gltf'}`);
    }, (err) => {
      hideLoading();
      setStatus(`GLTF export failed: ${err.message}`);
    }, { binary });
  } catch (err) {
    hideLoading();
    setStatus(`GLTF export failed: ${err.message}`);
  }
}

async function exportOBJ(meshes, docTitle) {
  try {
    const { OBJExporter } = await loadModule('three/addons/exporters/OBJExporter.js');
    const exporter = new OBJExporter();
    const exportRoot = buildExportScene(meshes);
    // OBJ uses node.name as group/object names
    const result = exporter.parse(exportRoot);

    // Append custom properties as comments at the end of OBJ
    let objWithProps = result;
    const propsComment = buildPropertiesComment(meshes, '# ');
    if (propsComment) {
      objWithProps += '\n# ===== Studio3D Custom Properties =====\n' + propsComment;
    }
    downloadText(objWithProps, `${docTitle}.obj`);
    hideLoading();
    setStatus(`Exported ${docTitle}.obj`);
  } catch (err) {
    hideLoading();
    setStatus(`OBJ export failed: ${err.message}`);
  }
}

function buildPropertiesComment(meshes, prefix = '# ') {
  const lines = [];
  meshes.forEach(obj => {
    const name = obj.userData.name || obj.name || 'Unnamed';
    const cp = obj.userData.customProps;
    if (!cp || Object.keys(cp).length === 0) return;
    lines.push(`${prefix}Object: ${name}`);
    if (obj.userData.isLibraryInstance) lines.push(`${prefix}  Library Symbol: true`);
    if (obj.userData.type) lines.push(`${prefix}  Type: ${obj.userData.type}`);
    Object.entries(cp).forEach(([k, v]) => {
      lines.push(`${prefix}  ${k}: ${v}`);
    });
    lines.push(prefix);
  });
  return lines.join('\n');
}

async function exportSTL(meshes, docTitle, binary) {
  try {
    const { STLExporter } = await loadModule('three/addons/exporters/STLExporter.js');
    const exporter = new STLExporter();
    const exportRoot = buildExportScene(meshes);
    const result = exporter.parse(exportRoot, { binary });
    if (binary) {
      downloadBlob(new Blob([result], { type: 'application/octet-stream' }), `${docTitle}.stl`);
    } else {
      downloadText(result, `${docTitle}.stl`);
    }
    hideLoading();
    setStatus(`Exported ${docTitle}.stl`);
  } catch (err) {
    hideLoading();
    setStatus(`STL export failed: ${err.message}`);
  }
}

async function exportPLY(meshes, docTitle) {
  try {
    const { PLYExporter } = await loadModule('three/addons/exporters/PLYExporter.js');
    const exporter = new PLYExporter();
    const exportRoot = buildExportScene(meshes);
    exporter.parse(exportRoot, (result) => {
      downloadText(result, `${docTitle}.ply`);
      hideLoading();
      setStatus(`Exported ${docTitle}.ply`);
    });
  } catch (err) {
    hideLoading();
    setStatus(`PLY export failed: ${err.message}`);
  }
}



// ─── IFC Property Extraction ───






// ─── Export (JSON) ───
function exportScene() {
  const data = {
    version: '1.1',
    exportDate: new Date().toISOString(),
    objects: state.objects.map(obj => serializeForExport(obj)),
    library: serializeLibrary(),
    background: '#' + scene.background.getHexString(),
    ambientIntensity: ambientLight.intensity,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (document.getElementById('doc-title').value || 'scene') + '.json';
  a.click();
  URL.revokeObjectURL(url);
  setStatus('Scene exported');
}

function serializeForExport(obj) {
  const entry = {
    name: obj.userData.name || obj.name || 'Unnamed',
    type: obj.userData.type || 'object',
    id: obj.userData.id || null,
    position: obj.position.toArray(),
    rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z],
    scale: obj.scale.toArray(),
    visible: obj.visible,
    isLight: !!obj.userData.isLight,
    isLibraryInstance: !!obj.userData.isLibraryInstance,
  };

  // Store library symbol name for reconstruction
  if (obj.userData.isLibraryInstance && obj.userData.customProps?.librarySource) {
    entry.librarySymbolName = obj.userData.customProps.librarySource;
  }

  // Custom properties
  if (obj.userData.customProps && Object.keys(obj.userData.customProps).length > 0) {
    entry.customProperties = { ...obj.userData.customProps };
  }

  // Material
  if (obj.material) {
    const m = obj.material;
    entry.material = {
      color: '#' + (m.color ? m.color.getHexString() : 'ffffff'),
      metalness: m.metalness ?? 0,
      roughness: m.roughness ?? 0.5,
      opacity: m.opacity ?? 1,
      transparent: !!m.transparent,
      wireframe: !!m.wireframe,
    };
  }

  // Geometry info
  if (obj.geometry) {
    entry.geometry = {
      type: obj.geometry.type || 'BufferGeometry',
      parameters: obj.geometry.parameters ? { ...obj.geometry.parameters } : null,
      vertices: obj.geometry.attributes?.position?.count || 0,
    };
  }

  // Light properties
  if (obj.userData.isLight) {
    entry.light = {
      color: '#' + (obj.color ? obj.color.getHexString() : 'ffffff'),
      intensity: obj.intensity ?? 1,
      distance: obj.distance ?? 0,
      lightType: obj.userData.type || 'point',
    };
  }

  // Children (for groups / library instances)
  if ((obj.isGroup || obj.children.length > 0) && !obj.userData.isLight) {
    const childMeshes = obj.children.filter(c => c.isMesh || c.isGroup);
    if (childMeshes.length > 0) {
      entry.children = childMeshes.map(c => serializeForExport(c));
    }
  }

  // Physics settings
  if (obj.userData.physics?.enabled) {
    entry.physics = {
      enabled: true,
      bodyType: obj.userData.physics.bodyType || 'dynamic',
      mass: obj.userData.physics.mass ?? 1,
      friction: obj.userData.physics.friction ?? 0.5,
      restitution: obj.userData.physics.restitution ?? 0.3,
    };
  }

  return entry;
}

function serializeLibrary() {
  return symbolLibrary.map(item => {
    const entry = {
      name: item.name,
      category: item.category,
      builtIn: !!item.builtIn,
      icon: item.icon || 'fa-cube',
    };
    // For custom symbols, include the serialized geometry data
    if (!item.builtIn && item.serializedChildren) {
      entry.serializedChildren = item.serializedChildren;
    }
    return entry;
  });
}

function takeScreenshot() {
  renderer.render(scene, camera);
  canvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (document.getElementById('doc-title').value || 'screenshot') + '.png';
    a.click();
    URL.revokeObjectURL(url);
    setStatus('Screenshot saved');
  });
}

// ─── Recording ───
let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;

function startRecording() {
  if (isRecording) return;
  try {
    recordedChunks = [];
    const stream = canvas.captureStream(60);
    const options = { mimeType: 'video/webm;codecs=vp9' };
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
      options.mimeType = 'video/webm';
    }
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
      options.mimeType = 'video/mp4';
    }
    mediaRecorder = new MediaRecorder(stream, options);
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) recordedChunks.push(event.data);
    };
    mediaRecorder.start();
    isRecording = true;
    document.querySelector('[data-action="record-video"]').style.display = 'none';
    document.querySelector('[data-action="stop-recording"]').style.display = '';
    setStatus('Recording started — ⌘R to stop');
  } catch (err) {
    setStatus('Error: Recording not supported on this browser');
    console.error(err);
  }
}

function stopRecording() {
  if (!isRecording || !mediaRecorder) return;
  mediaRecorder.stop();
  isRecording = false;
  document.querySelector('[data-action="record-video"]').style.display = '';
  document.querySelector('[data-action="stop-recording"]').style.display = 'none';
  document.querySelector('[data-action="download-video"]').style.display = '';
  setStatus('Recording stopped — Download to save');
}

function downloadVideo() {
  if (recordedChunks.length === 0) {
    setStatus('No recording available');
    return;
  }
  const blob = new Blob(recordedChunks, { type: 'video/webm' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (document.getElementById('doc-title').value || 'recording') + '.webm';
  a.click();
  URL.revokeObjectURL(url);
  setStatus('Video saved');
  recordedChunks = [];
  document.querySelector('[data-action="download-video"]').style.display = 'none';
}

// ─── Resize ───
function onResize() {
  const container = canvas.parentElement;
  const w = container.clientWidth;
  const h = container.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
window.addEventListener('resize', onResize);
new ResizeObserver(onResize).observe(canvas.parentElement);

// ─── Render Loop ───
function animate() {
  requestAnimationFrame(animate);
  const dt = state.clock.getDelta();
  orbitControls.update();

  // Physics step
  stepPhysics(dt);

  // Update light helpers
  lightHelpers.forEach(helper => {
    if (helper.update) helper.update();
  });

  // Update properties panel during simulation
  if (physics.running && state.selected) {
    updatePropertiesPanel();
  }

  renderer.render(scene, camera);

  // FPS counter
  state.frameCount++;
  const elapsed = state.clock.getElapsedTime();
  if (elapsed - state.fpsTime >= 1) {
    document.getElementById('fps-counter').textContent = `${state.frameCount} FPS`;
    state.frameCount = 0;
    state.fpsTime = elapsed;
  }
}

// ─── Utilities ───
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function round(v, d) { const m = Math.pow(10, d); return Math.round(v * m) / m; }
function setStatus(msg) { document.getElementById('status-msg').textContent = msg; }

// ─── View Mode ───
function toggleViewMode() {
  state.viewMode = !state.viewMode;
  document.body.classList.toggle('view-mode', state.viewMode);
  document.getElementById('btn-view-mode').classList.toggle('active', state.viewMode);

  if (state.viewMode) {
    // Enter view mode
    transformControls.detach();
    hideContextMenu();
    if (state.selected) {
      updateViewModePanel(state.selected);
    }
    setStatus('View Mode — click objects to inspect');
  } else {
    // Exit view mode
    if (state.selected) {
      transformControls.attach(state.selected);
      // Re-show edit panels
      selectObject(state.selected);
    }
    setStatus('Edit Mode');
  }
  rebuildHierarchy();
}

function updateViewModePanel(obj) {
  const content = document.getElementById('view-props-content');
  if (!obj) {
    content.style.display = 'none';
    return;
  }
  content.style.display = '';

  // Object info
  const infoEl = document.getElementById('view-obj-info');
  const name = obj.userData?.name || obj.name || 'Unnamed';
  const type = obj.userData?.type || obj.type || 'Object';
  let infoHTML = propRow('Name', name);
  infoHTML += propRow('Type', capitalize(type));
  if (obj.userData?.id) infoHTML += propRow('ID', obj.userData.id);
  if (obj.children && obj.children.length > 0) {
    const meshChildren = obj.children.filter(c => c.isMesh || c.isGroup).length;
    if (meshChildren > 0) infoHTML += propRow('Children', meshChildren);
  }
  infoEl.innerHTML = infoHTML;

  // Transform
  const transEl = document.getElementById('view-transform');
  transEl.innerHTML =
    propRow('Position X', round(obj.position.x, 3)) +
    propRow('Position Y', round(obj.position.y, 3)) +
    propRow('Position Z', round(obj.position.z, 3)) +
    propRow('Rotation X', round(THREE.MathUtils.radToDeg(obj.rotation.x), 1) + '°') +
    propRow('Rotation Y', round(THREE.MathUtils.radToDeg(obj.rotation.y), 1) + '°') +
    propRow('Rotation Z', round(THREE.MathUtils.radToDeg(obj.rotation.z), 1) + '°') +
    propRow('Scale X', round(obj.scale.x, 3)) +
    propRow('Scale Y', round(obj.scale.y, 3)) +
    propRow('Scale Z', round(obj.scale.z, 3));

  // Material
  const matEl = document.getElementById('view-material');
  const geoSection = document.getElementById('view-geometry-section');
  const lightSection = document.getElementById('view-light-section');

  if (obj.userData?.isLight) {
    matEl.innerHTML = propRow('—', 'Light source (no material)');
    geoSection.style.display = 'none';
    lightSection.style.display = '';
    const lightEl = document.getElementById('view-light');
    const light = obj;
    const lc = light.color ? '#' + light.color.getHexString() : '#ffffff';
    lightEl.innerHTML =
      propRow('Color', `<span class="color-swatch" style="background:${lc}"></span>${lc}`) +
      propRow('Intensity', light.intensity ?? '—') +
      propRow('Type', light.userData?.type || light.type);
    if (light.distance !== undefined) lightEl.innerHTML += propRow('Distance', light.distance);
  } else {
    lightSection.style.display = 'none';
    if (obj.material) {
      const mat = obj.material;
      const mc = '#' + (mat.color ? mat.color.getHexString() : 'ffffff');
      let matHTML = propRow('Color', `<span class="color-swatch" style="background:${mc}"></span>${mc}`);
      if (mat.metalness !== undefined) matHTML += propRow('Metalness', round(mat.metalness, 2));
      if (mat.roughness !== undefined) matHTML += propRow('Roughness', round(mat.roughness, 2));
      if (mat.opacity !== undefined) matHTML += propRow('Opacity', round(mat.opacity, 2));
      if (mat.transparent) matHTML += propRow('Transparent', 'Yes');
      if (mat.wireframe) matHTML += propRow('Wireframe', 'Yes');
      matEl.innerHTML = matHTML;
    } else {
      matEl.innerHTML = propRow('—', 'No material');
    }

    // Geometry
    if (obj.geometry) {
      geoSection.style.display = '';
      const geo = obj.geometry;
      const vCount = geo.attributes?.position?.count || 0;
      const iCount = geo.index ? geo.index.count / 3 : vCount / 3;
      let geoHTML = propRow('Vertices', vCount.toLocaleString());
      geoHTML += propRow('Faces', Math.floor(iCount).toLocaleString());
      if (geo.type) geoHTML += propRow('Geometry', geo.type.replace('Geometry', '').replace('Buffer', ''));
      if (geo.parameters) {
        const p = geo.parameters;
        for (const [k, v] of Object.entries(p)) {
          if (typeof v === 'number') geoHTML += propRow(capitalize(k), round(v, 3));
        }
      }
      document.getElementById('view-geometry').innerHTML = geoHTML;
    } else {
      geoSection.style.display = 'none';
    }
  }

  // Custom properties
  const customSection = document.getElementById('view-custom-section');
  const customEl = document.getElementById('view-custom');
  const cp = obj.userData?.customProps;
  if (cp && Object.keys(cp).length > 0) {
    customSection.style.display = '';
    let cpHTML = '';
    for (const [k, v] of Object.entries(cp)) {
      cpHTML += propRow(k, v);
    }
    customEl.innerHTML = cpHTML;
  } else {
    customSection.style.display = 'none';
  }
}

function propRow(label, value) {
  return `<div class="view-prop-label">${label}</div><div class="view-prop-value">${value}</div>`;
}

// ─── Initialization ───
function init() {
  onResize();
  setupPropertyListeners();
  setupToolbar();
  setupKeyboard();
  setupPhysicsListeners();
  initLibrary();
  initPhysicsWorld();

  canvas.addEventListener('click', onCanvasClick);

  // Renderer info
  document.getElementById('renderer-info').textContent =
    `WebGL ${renderer.capabilities.isWebGL2 ? '2' : '1'}`;

  // Add a default floor plane
  const floorGeom = new THREE.PlaneGeometry(20, 20);
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x333344,
    roughness: 0.9,
    metalness: 0.0,
  });
  const floor = new THREE.Mesh(floorGeom, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  floor.userData = { name: 'Floor', type: 'plane', id: 'floor', visible: true };
  scene.add(floor);

  setStatus('Ready — Add objects from the left panel');
  animate();
}

// ─── Self Test ───
async function runSelfTest() {
  const log = [];
  const pass = (msg) => log.push(`✅ ${msg}`);
  const fail = (msg) => log.push(`❌ ${msg}`);
  const check = (cond, msg) => cond ? pass(msg) : fail(msg);
  let errors = 0;

  function assertEqual(actual, expected, label) {
    if (typeof expected === 'number') {
      if (Math.abs(actual - expected) < 0.01) { pass(`${label}: ${actual}`); }
      else { fail(`${label}: expected ${expected}, got ${actual}`); errors++; }
    } else if (actual === expected) {
      pass(`${label}: ${JSON.stringify(actual)}`);
    } else {
      fail(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      errors++;
    }
  }

  function assertObj(obj, label) {
    if (obj) { pass(`${label}: exists`); return true; }
    fail(`${label}: missing`); errors++; return false;
  }

  log.push('═══ STUDIO 3D SELF TEST ═══');
  log.push('');

  // ─── Step 1: Clear scene ───
  log.push('── Step 1: Clear scene ──');
  // Clear without confirm dialog
  [...state.objects].forEach(obj => {
    const helper = lightHelpers.get(obj.userData?.id);
    if (helper) { scene.remove(helper); helper.dispose?.(); lightHelpers.delete(obj.userData.id); }
    scene.remove(obj);
  });
  state.objects = [];
  state.selected = null;
  state.objectCounter = 0;
  transformControls.detach();
  pass('Scene cleared');

  // ─── Step 2: Add primitives ───
  log.push('');
  log.push('── Step 2: Add primitives ──');

  addObject('box');
  const box = state.selected;
  box.position.set(2, 0.5, 0);
  box.rotation.set(0, Math.PI / 4, 0);
  box.scale.set(1.5, 1, 0.8);
  box.material.color.set('#ff5533');
  box.material.metalness = 0.7;
  box.material.roughness = 0.2;
  box.material.opacity = 0.85;
  box.material.transparent = true;
  box.userData.name = 'TestBox';
  box.userData.customProps = { weight: '42kg', material: 'Steel', temperature: '350C' };
  pass('Created box with custom properties');

  addObject('sphere');
  const sphere = state.selected;
  sphere.position.set(-2, 1, 3);
  sphere.material.color.set('#3388ff');
  sphere.userData.name = 'TestSphere';
  sphere.userData.customProps = { diameter: '1.2m' };
  pass('Created sphere with custom property');

  addObject('cylinder');
  const cyl = state.selected;
  cyl.position.set(0, 1, -2);
  cyl.rotation.set(Math.PI / 6, 0, 0);
  cyl.userData.name = 'TestCylinder';
  pass('Created cylinder (no custom props)');

  // ─── Step 3: Add a light ───
  log.push('');
  log.push('── Step 3: Add light ──');
  addLight('point');
  const light = state.selected;
  light.position.set(1, 5, 2);
  light.color.set('#ffaa00');
  light.intensity = 2.5;
  light.userData.name = 'TestLight';
  light.userData.customProps = { zone: 'Area-A' };
  pass('Created point light with custom property');

  // ─── Step 4: Add library symbol ───
  log.push('');
  log.push('── Step 4: Add library symbol ──');
  const tankItem = symbolLibrary.find(s => s.name === 'Storage Tank');
  if (tankItem) {
    placeLibraryItem(tankItem);
    const tank = state.selected;
    tank.position.set(5, 0, 0);
    tank.userData.name = 'TestTank';
    tank.userData.customProps = { capacity: '5000L', pressure: '10bar', fluid: 'Water' };
    pass('Placed Storage Tank library symbol');

    const tankChildCount = tank.children.filter(c => c.isMesh).length;
    pass(`Tank has ${tankChildCount} mesh children`);
  } else {
    fail('Storage Tank not found in library');
    errors++;
  }

  const pumpItem = symbolLibrary.find(s => s.name === 'Motorized Pump');
  if (pumpItem) {
    placeLibraryItem(pumpItem);
    const pump = state.selected;
    pump.position.set(-4, 0, -3);
    pump.rotation.set(0, Math.PI / 3, 0);
    pump.userData.name = 'TestPump';
    pump.userData.customProps = { rpm: '3600', power: '75kW' };
    pass('Placed Motorized Pump library symbol');
  } else {
    fail('Motorized Pump not found in library');
    errors++;
  }

  rebuildHierarchy();
  updateViewportInfo();

  const totalObjects = state.objects.length;
  pass(`Total objects in scene: ${totalObjects}`);

  // ─── Step 5: Serialize (export) ───
  log.push('');
  log.push('── Step 5: Serialize scene ──');
  const exportData = {
    version: '1.1',
    exportDate: new Date().toISOString(),
    objects: state.objects.map(obj => serializeForExport(obj)),
    library: serializeLibrary(),
    background: '#' + scene.background.getHexString(),
    ambientIntensity: ambientLight.intensity,
  };
  const jsonStr = JSON.stringify(exportData, null, 2);
  pass(`Serialized ${exportData.objects.length} objects (${(jsonStr.length / 1024).toFixed(1)} KB)`);

  // Snapshot exported data for comparison
  const snapshot = exportData.objects.map(o => ({
    name: o.name,
    type: o.type,
    position: o.position.map(v => round(v, 3)),
    rotation: o.rotation.map(v => round(v, 3)),
    scale: o.scale.map(v => round(v, 3)),
    isLight: o.isLight,
    isLibraryInstance: o.isLibraryInstance,
    childCount: o.children ? o.children.length : 0,
    customProps: o.customProperties || {},
    materialColor: o.material?.color || null,
    materialMetalness: o.material?.metalness ?? null,
    materialRoughness: o.material?.roughness ?? null,
    materialOpacity: o.material?.opacity ?? null,
    materialTransparent: o.material?.transparent ?? null,
    lightColor: o.light?.color || null,
    lightIntensity: o.light?.intensity ?? null,
    geometryType: o.geometry?.type || null,
  }));

  // ─── Step 6: Clear and reimport ───
  log.push('');
  log.push('── Step 6: Clear & reimport ──');
  [...state.objects].forEach(obj => {
    const helper = lightHelpers.get(obj.userData?.id);
    if (helper) { scene.remove(helper); helper.dispose?.(); lightHelpers.delete(obj.userData.id); }
    scene.remove(obj);
  });
  state.objects = [];
  state.selected = null;
  state.objectCounter = 0;
  transformControls.detach();
  pass('Scene cleared for reimport');

  // Reimport using importSceneObject
  exportData.objects.forEach(o => importSceneObject(o));
  rebuildHierarchy();
  updateViewportInfo();
  pass(`Reimported ${state.objects.length} objects`);

  assertEqual(state.objects.length, totalObjects, 'Object count after reimport');

  // ─── Step 7: Compare each object ───
  log.push('');
  log.push('── Step 7: Verify round-trip ──');

  for (let i = 0; i < snapshot.length; i++) {
    const exp = snapshot[i];
    const obj = state.objects[i];
    if (!obj) { fail(`Object ${i} (${exp.name}): missing after reimport`); errors++; continue; }

    log.push(`  ▸ ${exp.name}:`);

    // Name
    assertEqual(obj.userData.name, exp.name, '    Name');

    // Position
    assertEqual(round(obj.position.x, 3), exp.position[0], '    Pos.x');
    assertEqual(round(obj.position.y, 3), exp.position[1], '    Pos.y');
    assertEqual(round(obj.position.z, 3), exp.position[2], '    Pos.z');

    // Rotation
    assertEqual(round(obj.rotation.x, 3), exp.rotation[0], '    Rot.x');
    assertEqual(round(obj.rotation.y, 3), exp.rotation[1], '    Rot.y');
    assertEqual(round(obj.rotation.z, 3), exp.rotation[2], '    Rot.z');

    // Scale
    assertEqual(round(obj.scale.x, 3), exp.scale[0], '    Scl.x');
    assertEqual(round(obj.scale.y, 3), exp.scale[1], '    Scl.y');
    assertEqual(round(obj.scale.z, 3), exp.scale[2], '    Scl.z');

    // Light
    if (exp.isLight) {
      check(!!obj.userData.isLight, '    isLight flag');
      if (exp.lightColor) assertEqual('#' + obj.color.getHexString(), exp.lightColor, '    Light color');
      if (exp.lightIntensity !== null) assertEqual(obj.intensity, exp.lightIntensity, '    Light intensity');
    }

    // Library instance
    if (exp.isLibraryInstance) {
      check(!!obj.userData.isLibraryInstance, '    isLibraryInstance flag');
    }

    // Material
    if (exp.materialColor && obj.material) {
      assertEqual('#' + obj.material.color.getHexString(), exp.materialColor, '    Mat color');
      if (exp.materialMetalness !== null) assertEqual(obj.material.metalness, exp.materialMetalness, '    Mat metalness');
      if (exp.materialRoughness !== null) assertEqual(obj.material.roughness, exp.materialRoughness, '    Mat roughness');
      if (exp.materialOpacity !== null) assertEqual(obj.material.opacity, exp.materialOpacity, '    Mat opacity');
      if (exp.materialTransparent !== null) assertEqual(obj.material.transparent, exp.materialTransparent, '    Mat transparent');
    }

    // Custom properties
    const importedProps = obj.userData.customProps || {};
    const exportedProps = exp.customProps;
    const allKeys = new Set([...Object.keys(exportedProps), ...Object.keys(importedProps)]);
    allKeys.forEach(key => {
      assertEqual(importedProps[key], exportedProps[key], `    Prop "${key}"`);
    });

    // Children (for groups/library symbols)
    if (exp.childCount > 0) {
      const meshChildren = (obj.children || []).filter(c => c.isMesh || c.isGroup);
      assertEqual(meshChildren.length, exp.childCount, '    Child count');

      // Check children geometry types are preserved
      if (snapshot[i] && exportData.objects[i].children) {
        exportData.objects[i].children.forEach((expChild, ci) => {
          const impChild = meshChildren[ci];
          if (!impChild) { fail(`    Child ${ci}: missing`); errors++; return; }
          if (expChild.geometry?.type && impChild.geometry) {
            assertEqual(impChild.geometry.type, expChild.geometry.type, `    Child ${ci} geom type`);
          }
        });
      }
    }
  }

  // ─── Summary ───
  log.push('');
  log.push('═══════════════════════════');
  const passCount = log.filter(l => l.startsWith('✅')).length;
  const failCount = log.filter(l => l.startsWith('❌')).length;
  log.push(`Results: ${passCount} passed, ${failCount} failed`);
  log.push(failCount === 0 ? '🎉 ALL TESTS PASSED' : `⚠️  ${failCount} FAILURES — see details above`);
  log.push('═══════════════════════════');

  // Output
  const output = log.join('\n');
  console.log(output);

  // Show in a modal overlay
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.85);z-index:10000;display:flex;align-items:center;justify-content:center;';
  const box2 = document.createElement('div');
  box2.style.cssText = 'background:#1e1e2e;border-radius:12px;padding:24px;max-width:700px;max-height:80vh;overflow:auto;font:13px/1.6 monospace;color:#cdd6f4;white-space:pre-wrap;border:1px solid #45475a;';
  box2.textContent = output;
  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Close';
  closeBtn.style.cssText = 'display:block;margin:16px auto 0;padding:8px 24px;background:#5b8def;color:#fff;border:none;border-radius:6px;cursor:pointer;font:14px sans-serif;';
  closeBtn.onclick = () => overlay.remove();
  box2.appendChild(closeBtn);
  overlay.appendChild(box2);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);

  setStatus(failCount === 0 ? `Self-test passed (${passCount}/${passCount})` : `Self-test: ${failCount} failures`);
}

init();
