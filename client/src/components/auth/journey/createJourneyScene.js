/**
 * "The business journey" - a small isometric 3D diorama for the login page,
 * built procedurally with three.js (no model files to download).
 *
 * Story loop (7 phases): customer visit -> sales order -> invoice ->
 * warehouse packing -> delivery van -> payment collected -> connected overview.
 *
 * Floating cards are plain DOM elements owned by React; this module only
 * positions them over their 3D anchor and flips their `data-show` attribute.
 * All the data on those cards is illustrative.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

export const PHASE_SECONDS = 3.4;
export const PHASES = 7;

const C = {
  brand: 0x3287fc,
  brandDark: 0x1452de,
  navy: 0x1e3a8a,
  island: 0xf3f6fc,
  islandSide: 0xd5deef,
  soil: 0x1b2a4a,
  grass: 0xcfe8da,
  road: 0x55627a,
  wall: 0xffffff,
  wall2: 0xe9eef7,
  glass: 0x9cc7ff,
  glassDark: 0x24324f,
  card: 0xd9a86c,
  skin: 0xf2c6a0,
  skin2: 0xc98f67,
  green: 0x10b981,
  amber: 0xf59e0b,
  tree: 0x34c38f,
  trunk: 0x9a6b4f,
};

const mat = (color, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0.02, ...extra });
const rbox = (w, h, d, r, color, extra) =>
  new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, r), mat(color, extra));
const box = (w, h, d, color, extra) =>
  new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, extra));

const shade = (obj) => {
  obj.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return obj;
};

/** Canvas text -> texture (signs, van branding). */
const textTexture = (
  lines,
  { w = 512, h = 128, bg = '#ffffff', fg = '#1452de', font = 700, size = 64, align = 'center' } = {}
) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (bg) {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
  }
  g.textAlign = align;
  g.textBaseline = 'middle';
  const list = Array.isArray(lines) ? lines : [lines];
  list.forEach((l, i) => {
    g.fillStyle = l.color || fg;
    g.font = `${l.weight || font} ${l.size || size}px Inter, "Segoe UI", system-ui, sans-serif`;
    const y = (h / (list.length + 1)) * (i + 1);
    g.fillText(l.text ?? l, align === 'center' ? w / 2 : 24, y);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
};

const plane = (w, h, texture) =>
  new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshStandardMaterial({ map: texture, roughness: 0.6, transparent: true })
  );

// ---------------------------------------------------------------- props
function person({ shirt, pants = 0x334155, skin = C.skin, hair = 0x2b2118, hat = null }) {
  const g = new THREE.Group();
  const legGeo = new THREE.CapsuleGeometry(0.11, 0.42, 4, 8);
  const legs = [-0.12, 0.12].map((x) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.62, 0);
    const leg = new THREE.Mesh(legGeo, mat(pants));
    leg.position.y = -0.3;
    pivot.add(leg);
    g.add(pivot);
    return pivot;
  });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 0.42, 4, 12), mat(shirt));
  body.position.y = 1.02;
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 20, 16), mat(skin));
  head.position.y = 1.62;
  g.add(head);
  const hairM = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    mat(hat ?? hair)
  );
  hairM.position.y = 1.65;
  if (hat) hairM.scale.set(1.15, 0.8, 1.15);
  g.add(hairM);
  const armGeo = new THREE.CapsuleGeometry(0.075, 0.38, 4, 8);
  const arms = [-0.33, 0.33].map((x) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, 1.3, 0);
    const arm = new THREE.Mesh(armGeo, mat(shirt));
    arm.position.y = -0.26;
    pivot.add(arm);
    g.add(pivot);
    return pivot;
  });
  return { group: shade(g), legs, arms, body };
}

function tree(scale = 1) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.6, 8), mat(C.trunk));
  trunk.position.y = 0.3;
  const crown = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.55, 1),
    mat(C.tree, { flatShading: true })
  );
  crown.position.y = 1.0;
  const crown2 = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.38, 1),
    mat(0x2bb07f, { flatShading: true })
  );
  crown2.position.set(0.18, 1.35, 0.1);
  g.add(trunk, crown, crown2);
  g.scale.setScalar(scale);
  return shade(g);
}

function cardboard(s = 0.42) {
  const b = rbox(s, s * 0.8, s, 0.03, C.card);
  const tape = box(s * 0.18, 0.01, s + 0.01, 0xc08f55);
  tape.position.y = s * 0.4;
  b.add(tape);
  return shade(b);
}

function shop() {
  const g = new THREE.Group();
  const base = rbox(4, 2.5, 3, 0.12, C.wall);
  base.position.y = 1.25;
  const plinth = rbox(4.2, 0.2, 3.2, 0.06, C.wall2);
  plinth.position.y = 0.1;
  const roof = rbox(4.4, 0.32, 3.4, 0.1, C.brandDark);
  roof.position.y = 2.62;
  g.add(base, plinth, roof);
  // shop front (faces +z)
  const door = rbox(0.9, 1.6, 0.08, 0.05, C.glassDark, { roughness: 0.2, metalness: 0.3 });
  door.position.set(-0.9, 0.95, 1.51);
  const win = rbox(1.9, 1.1, 0.08, 0.05, C.glass, {
    roughness: 0.15,
    metalness: 0.2,
    emissive: 0x2a5bd7,
    emissiveIntensity: 0.18,
  });
  win.position.set(0.75, 1.15, 1.51);
  g.add(door, win);
  // striped awning
  for (let i = 0; i < 8; i++) {
    const s = box(0.5, 0.06, 0.9, i % 2 ? 0xffffff : C.brand);
    s.position.set(-1.75 + i * 0.5, 2.05, 1.85);
    s.rotation.x = 0.35;
    g.add(s);
  }
  const sign = plane(
    2.6,
    0.5,
    textTexture([{ text: 'RETAIL STORE', size: 70, weight: 800 }], { bg: '#ffffff', fg: '#1452de' })
  );
  sign.position.set(0, 2.62, 1.71);
  g.add(sign);
  // goods on display
  for (let i = 0; i < 3; i++) {
    const c = cardboard(0.32);
    c.position.set(1.4 - i * 0.38, 0.33, 1.9);
    g.add(c);
  }
  return shade(g);
}

function warehouse() {
  const g = new THREE.Group();
  const base = rbox(6, 3, 4, 0.12, C.wall2);
  base.position.y = 1.5;
  g.add(base);
  const tri = new THREE.Shape();
  tri.moveTo(-3.25, 0);
  tri.lineTo(3.25, 0);
  tri.lineTo(0, 1.1);
  tri.closePath();
  const roof = new THREE.Mesh(
    new THREE.ExtrudeGeometry(tri, {
      depth: 4.3,
      bevelEnabled: true,
      bevelSize: 0.05,
      bevelThickness: 0.05,
      bevelSegments: 2,
    }),
    mat(C.navy)
  );
  roof.position.set(0, 3, -2.15);
  g.add(roof);
  // roller door with slats
  const doorC = document.createElement('canvas');
  doorC.width = 64;
  doorC.height = 64;
  const dg = doorC.getContext('2d');
  dg.fillStyle = '#9aa7bd';
  dg.fillRect(0, 0, 64, 64);
  dg.fillStyle = '#7d8aa3';
  for (let y = 0; y < 64; y += 8) dg.fillRect(0, y, 64, 2);
  const doorT = new THREE.CanvasTexture(doorC);
  doorT.colorSpace = THREE.SRGBColorSpace;
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 2.1, 0.08),
    new THREE.MeshStandardMaterial({ map: doorT, roughness: 0.6 })
  );
  door.position.set(0.6, 1.05, 2.02);
  g.add(door);
  const sign = plane(
    2.4,
    0.5,
    textTexture([{ text: 'WAREHOUSE', size: 72, weight: 800 }], { bg: '#1452de', fg: '#ffffff' })
  );
  sign.position.set(0.6, 2.55, 2.03);
  g.add(sign);
  const dock = rbox(3.2, 0.3, 1, 0.05, 0xcbd5e1);
  dock.position.set(0.6, 0.15, 2.5);
  g.add(dock);
  // windows
  for (const x of [-2.1, -1.2]) {
    const w = rbox(0.6, 0.6, 0.06, 0.04, C.glass, {
      roughness: 0.2,
      emissive: 0x2a5bd7,
      emissiveIntensity: 0.15,
    });
    w.position.set(x, 2.1, 2.02);
    g.add(w);
  }
  return shade(g);
}

function shelf() {
  const g = new THREE.Group();
  const frame = mat(0x64748b);
  for (const x of [-1, 1])
    for (const z of [-0.35, 0.35]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.8, 0.06), frame);
      post.position.set(x, 0.9, z);
      g.add(post);
    }
  const boxes = [];
  for (const y of [0.1, 0.7, 1.3]) {
    const board = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.05, 0.8), mat(0x94a3b8));
    board.position.y = y;
    g.add(board);
    for (let i = 0; i < 4; i++) {
      const b = cardboard(0.36);
      b.position.set(-0.72 + i * 0.48, y + 0.17, 0);
      g.add(b);
      boxes.push(b);
    }
  }
  return { group: shade(g), boxes };
}

function van() {
  const g = new THREE.Group(); // local +x is forward
  const body = rbox(2.1, 1.35, 1.25, 0.14, C.wall);
  body.position.set(-0.3, 1.0, 0);
  const cab = rbox(0.9, 1.0, 1.2, 0.18, C.wall);
  cab.position.set(1.05, 0.82, 0);
  const windshield = rbox(0.1, 0.45, 1.05, 0.04, C.glassDark, { roughness: 0.15, metalness: 0.4 });
  windshield.position.set(1.48, 1.05, 0);
  windshield.rotation.z = -0.25;
  const stripe = box(2.12, 0.16, 1.27, C.brand);
  stripe.position.set(-0.3, 0.55, 0);
  const brandT = textTexture(
    [
      { text: 'ElevIQ', size: 64, weight: 800, color: '#1452de' },
      { text: 'Bizflow', size: 56, weight: 700, color: '#3287fc' },
    ],
    { w: 512, h: 256, bg: null }
  );
  for (const s of [1, -1]) {
    const p = plane(1.5, 0.75, brandT);
    p.position.set(-0.3, 1.12, 0.64 * s);
    if (s < 0) p.rotation.y = Math.PI;
    g.add(p);
  }
  g.add(body, cab, windshield, stripe);
  const lamp = box(0.04, 0.12, 0.22, 0xfff3c4, { emissive: 0xffe08a, emissiveIntensity: 0.8 });
  lamp.position.set(1.5, 0.62, 0.38);
  const lamp2 = lamp.clone();
  lamp2.position.z = -0.38;
  g.add(lamp, lamp2);
  const wheels = [];
  const wGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.22, 20);
  const hubGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.24, 12);
  for (const [x, z] of [
    [-0.9, 0.6],
    [-0.9, -0.6],
    [0.95, 0.6],
    [0.95, -0.6],
  ]) {
    const w = new THREE.Group();
    const tyre = new THREE.Mesh(wGeo, mat(0x1f2937));
    tyre.rotation.x = Math.PI / 2;
    const hub = new THREE.Mesh(hubGeo, mat(0xcbd5e1, { metalness: 0.5, roughness: 0.3 }));
    hub.rotation.x = Math.PI / 2;
    w.add(tyre, hub);
    w.position.set(x, 0.28, z);
    g.add(w);
    wheels.push(w);
  }
  g.scale.setScalar(0.95);
  return { group: shade(g), wheels };
}

function pin(color) {
  const g = new THREE.Group();
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.26, 20, 16),
    mat(color, { emissive: color, emissiveIntensity: 0.25 })
  );
  head.position.y = 0.62;
  const tip = new THREE.Mesh(
    new THREE.ConeGeometry(0.2, 0.42, 16),
    mat(color, { emissive: color, emissiveIntensity: 0.25 })
  );
  tip.position.y = 0.32;
  tip.rotation.x = Math.PI;
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), mat(0xffffff));
  dot.position.set(0, 0.64, 0.2);
  g.add(head, tip, dot);
  return shade(g);
}

function roadRibbon(curve, width) {
  const pts = curve.getSpacedPoints(160);
  const pos = [];
  const idx = [];
  pts.forEach((p, i) => {
    const t = curve.getTangentAt(i / (pts.length - 1));
    const n = new THREE.Vector3(-t.z, 0, t.x).normalize().multiplyScalar(width / 2);
    pos.push(p.x + n.x, 0.03, p.z + n.z, p.x - n.x, 0.03, p.z - n.z);
    if (i) {
      const a = (i - 1) * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat(C.road, { roughness: 0.9 }));
  m.receiveShadow = true;
  return m;
}

const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
const clamp01 = (x) => Math.min(1, Math.max(0, x));

// ---------------------------------------------------------------- scene
export function createJourneyScene(
  container,
  { overlays = [], onPhase, reducedMotion = false, compact = false } = {}
) {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: 'low-power',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, compact ? 1.5 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = !compact;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.display = 'block';
  renderer.domElement.setAttribute('aria-hidden', 'true');
  container.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  const camDir = new THREE.Vector3(1, 0.86, 1).normalize();
  const target = new THREE.Vector3(0, 0.6, 0.6);
  const targetGoal = target.clone();
  let zoom = 1;
  let zoomGoal = 1;

  // lights: soft sky + one warm key light with soft shadows
  scene.add(new THREE.HemisphereLight(0xf4f8ff, 0x9fb0d0, 1.55));
  const key = new THREE.DirectionalLight(0xfff4e6, 2.1);
  key.position.set(-8, 16, 10);
  key.castShadow = !compact;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -16;
  key.shadow.camera.right = 16;
  key.shadow.camera.top = 16;
  key.shadow.camera.bottom = -16;
  key.shadow.radius = 4;
  key.shadow.bias = -0.0006;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x8fb6ff, 0.6);
  rim.position.set(10, 6, -10);
  scene.add(rim);

  // island
  const world = new THREE.Group();
  scene.add(world);
  const top = rbox(22, 0.7, 15, 0.35, C.island);
  top.position.y = -0.35;
  top.receiveShadow = true;
  const soil = rbox(21.6, 1.1, 14.6, 0.3, C.soil, { roughness: 0.9 });
  soil.position.y = -1.05;
  const band = rbox(22.1, 0.16, 15.1, 0.08, C.islandSide);
  band.position.y = -0.62;
  world.add(top, soil, band);
  for (const [x, z, w, d] of [
    [-7.6, -4.4, 5, 4.6],
    [7.3, 4.6, 5.6, 4.2],
    [-1.4, -1.6, 4, 2.6],
  ]) {
    const gr = rbox(w, 0.08, d, 0.04, C.grass);
    gr.position.set(x, 0.02, z);
    gr.receiveShadow = true;
    world.add(gr);
  }

  // road from the warehouse dock to the shop
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(5.6, 0, -0.9),
    new THREE.Vector3(5.2, 0, 1.6),
    new THREE.Vector3(2.4, 0, 3.6),
    new THREE.Vector3(-1.6, 0, 5.0),
    new THREE.Vector3(-5.6, 0, 5.4),
    new THREE.Vector3(-9.4, 0, 5.4),
  ]);
  world.add(roadRibbon(curve, 1.7));
  for (let i = 0; i < 26; i++) {
    const u = (i + 0.5) / 26;
    const p = curve.getPointAt(u);
    const t = curve.getTangentAt(u);
    const dash = box(0.36, 0.02, 0.07, 0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.2 });
    dash.position.set(p.x, 0.05, p.z);
    dash.rotation.y = Math.atan2(-t.z, t.x);
    world.add(dash);
  }

  const shopG = shop();
  shopG.position.set(-5.8, 0, 2.0);
  world.add(shopG);
  const whG = warehouse();
  whG.position.set(5.0, 0, -3.6);
  world.add(whG);
  const sh = shelf();
  sh.group.position.set(0.6, 0, -3.2);
  world.add(sh.group);
  for (const [x, z, s] of [
    [-9.4, -1.0, 1.1],
    [-8.7, -5.6, 0.9],
    [-3.2, -5.8, 1.2],
    [9.4, 1.4, 1.0],
    [8.6, 5.6, 1.15],
    [2.6, 6.2, 0.85],
    [-2.6, -1.2, 0.8],
    [9.6, -5.8, 0.9],
  ]) {
    const t = tree(s);
    t.position.set(x, 0, z);
    world.add(t);
  }
  for (let i = 0; i < 5; i++) {
    const b = cardboard(0.45);
    b.position.set(2.0 + (i % 3) * 0.5, 0.18 + Math.floor(i / 3) * 0.37, -1.2 + (i % 2) * 0.1);
    world.add(b);
  }

  // characters
  const customer = person({ shirt: C.amber, pants: 0x475569, skin: C.skin2 });
  customer.group.position.set(-6.7, 0, 4.0);
  customer.group.rotation.y = 0.5;
  world.add(customer.group);
  const rep = person({ shirt: C.brand, pants: 0x1e293b });
  world.add(rep.group);
  const tablet = rbox(0.42, 0.3, 0.04, 0.03, 0x111827);
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.36, 0.24),
    new THREE.MeshStandardMaterial({ color: 0x9cc7ff, emissive: C.brand, emissiveIntensity: 0.6 })
  );
  screen.position.z = 0.025;
  tablet.add(screen);
  tablet.position.set(0, 1.12, 0.38);
  tablet.rotation.x = -0.5;
  rep.group.add(tablet);
  const worker = person({ shirt: 0x0ea5e9, pants: 0x334155, hat: 0xfacc15 });
  world.add(worker.group);
  const carried = cardboard(0.42);
  carried.position.set(0, 1.18, 0.42);
  worker.group.add(carried);

  const v = van();
  world.add(v.group);
  const pinShop = pin(C.green);
  pinShop.position.set(-4.5, 2.9, 4.0);
  world.add(pinShop);
  const pinWh = pin(C.brand);
  pinWh.position.set(5.6, 4.4, -1.2);
  world.add(pinWh);

  // payment success ring
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.55, 0.7, 40),
    new THREE.MeshBasicMaterial({
      color: C.green,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
    })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(-6.1, 0.06, 4.4);
  world.add(ring);

  // the connected-platform hub and its links (final phase)
  const hub = new THREE.Group();
  const hubTile = rbox(1.5, 0.3, 1.5, 0.12, C.brand, {
    emissive: C.brandDark,
    emissiveIntensity: 0.35,
  });
  // the ElevIQ brand mark (same paths as components/brand/Logo.jsx)
  const markC = document.createElement('canvas');
  markC.width = markC.height = 256;
  const mg = markC.getContext('2d');
  mg.scale(4, 4);
  mg.fillStyle = '#ffffff';
  mg.fill(new window.Path2D('M14 46V18h10.5v20H36v8H14z'));
  mg.globalAlpha = 0.8;
  mg.fill(new window.Path2D('M38 46l-6.5-11 6-10L45 33l6-10 6 10L45 46z'));
  const markT = new THREE.CanvasTexture(markC);
  markT.colorSpace = THREE.SRGBColorSpace;
  const hubLogo = new THREE.Mesh(
    new THREE.PlaneGeometry(1.1, 1.1),
    new THREE.MeshBasicMaterial({ map: markT, transparent: true })
  );
  hubLogo.rotation.x = -Math.PI / 2;
  hubLogo.position.y = 0.16;
  hubTile.add(hubLogo);
  hub.add(hubTile);
  hub.position.set(0, 5.4, 0.6);
  scene.add(hub);
  const nodes = {
    shop: new THREE.Vector3(-5.8, 3.0, 2.0),
    warehouse: new THREE.Vector3(5.0, 4.2, -3.6),
    shelf: new THREE.Vector3(0.6, 1.9, -3.2),
    road: curve.getPointAt(0.45).add(new THREE.Vector3(0, 0.2, 0)),
  };
  const links = Object.values(nodes).map((n) => {
    const mid = hub.position.clone().lerp(n, 0.5);
    mid.y += 1.6;
    const path = new THREE.QuadraticBezierCurve3(hub.position.clone(), mid, n);
    const geo = new THREE.TubeGeometry(path, 48, 0.045, 6, false);
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ color: 0x7fb2ff, transparent: true, opacity: 0.9 })
    );
    scene.add(mesh);
    const pulse = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    scene.add(pulse);
    return { mesh, path, pulse, count: geo.index.count };
  });

  // positions used by the story
  const repStart = new THREE.Vector3(-0.8, 0, 4.0);
  const repStop = new THREE.Vector3(-5.2, 0, 4.25);
  const shelfSpot = new THREE.Vector3(1.0, 0, -2.3);
  const vanSpot = new THREE.Vector3(4.6, 0, -0.9);
  const VAN_STOP = 0.86; // where on the road the van parks at the shop

  const anchors = {
    rep: () => rep.group.position.clone().add(new THREE.Vector3(0, 2.4, 0)),
    customer: () => customer.group.position.clone().add(new THREE.Vector3(0, 2.4, 0)),
    warehouse: () => new THREE.Vector3(3.4, 3.8, -1.4),
    hub: () => hub.position.clone().add(new THREE.Vector3(0, 0.9, 0)),
    shop: () => nodes.shop.clone().add(new THREE.Vector3(0, 0.6, 0)),
    shelf: () => nodes.shelf.clone().add(new THREE.Vector3(0, 0.5, 0)),
    road: () => nodes.road.clone().add(new THREE.Vector3(0, 0.8, 0)),
    van: () => v.group.position.clone().add(new THREE.Vector3(0, 2.0, 0)),
  };

  const walk = (p, t, speed = 9) => {
    const s = Math.sin(t * speed);
    p.legs[0].rotation.x = s * 0.55;
    p.legs[1].rotation.x = -s * 0.55;
    p.arms[0].rotation.x = -s * 0.4;
    p.arms[1].rotation.x = s * 0.4;
    p.body.position.y = 1.02 + Math.abs(s) * 0.03;
  };
  const still = (p) => {
    p.legs.forEach((l) => (l.rotation.x *= 0.8));
    p.arms.forEach((a) => (a.rotation.x *= 0.8));
  };
  const faceTo = (obj, from, to) => {
    obj.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
  };
  const placeVan = (u) => {
    const p = curve.getPointAt(u);
    const t = curve.getTangentAt(u);
    v.group.position.set(p.x, 0, p.z);
    v.group.rotation.y = Math.atan2(-t.z, t.x);
  };

  let lastPhase = -1;
  let wheelSpin = 0;
  let lastVanU = 0;

  const update = (time) => {
    const T = time % (PHASE_SECONDS * PHASES);
    const phase = Math.floor(T / PHASE_SECONDS);
    const u = (T % PHASE_SECONDS) / PHASE_SECONDS;
    if (phase !== lastPhase) {
      lastPhase = phase;
      onPhase?.(phase);
    }

    // sales rep: walks in (0), stays (1-5), walks back out (6)
    if (phase === 0) {
      const k = ease(clamp01(u / 0.7));
      rep.group.position.lerpVectors(repStart, repStop, k);
      faceTo(rep.group, repStart, repStop);
      if (k < 1) walk(rep, time);
      else {
        still(rep);
        faceTo(rep.group, rep.group.position, customer.group.position);
      }
    } else if (phase === 6) {
      const k = ease(clamp01(u / 0.8));
      rep.group.position.lerpVectors(repStop, repStart, k);
      faceTo(rep.group, repStop, repStart);
      walk(rep, time);
    } else {
      rep.group.position.copy(repStop);
      faceTo(rep.group, repStop, customer.group.position);
      still(rep);
    }
    screen.material.emissiveIntensity =
      phase === 1 || phase === 2 || phase === 5 ? 0.9 + Math.sin(time * 6) * 0.25 : 0.45;

    // customer greets in phase 0 and after payment
    const wave = (phase === 0 && u > 0.6) || phase === 5;
    customer.arms[1].rotation.z = wave
      ? 2.5 + Math.sin(time * 9) * 0.35
      : customer.arms[1].rotation.z * 0.85;
    faceTo(
      customer.group,
      customer.group.position,
      phase === 6 || phase === 3 ? new THREE.Vector3(0, 0, 9) : rep.group.position
    );

    // warehouse worker: carries a box from the shelf to the van (3), walks back (4)
    if (phase === 3) {
      const k = ease(clamp01(u / 0.85));
      worker.group.position.lerpVectors(shelfSpot, vanSpot, k);
      faceTo(worker.group, shelfSpot, vanSpot);
      carried.visible = k < 0.98;
      worker.arms.forEach((a) => (a.rotation.x = -1.2));
      worker.legs[0].rotation.x = Math.sin(time * 9) * 0.5;
      worker.legs[1].rotation.x = -Math.sin(time * 9) * 0.5;
    } else if (phase === 4) {
      const k = ease(clamp01(u / 0.85));
      worker.group.position.lerpVectors(vanSpot, shelfSpot, k);
      faceTo(worker.group, vanSpot, shelfSpot);
      carried.visible = false;
      walk(worker, time);
    } else {
      worker.group.position.copy(shelfSpot);
      worker.group.rotation.y = Math.PI * 0.75;
      carried.visible = phase < 3;
      worker.arms.forEach((a) => (a.rotation.x = carried.visible ? -1.2 : 0));
      worker.legs.forEach((l) => (l.rotation.x = 0));
    }
    sh.boxes.forEach((b, i) => {
      b.position.y = b.userData.y ?? (b.userData.y = b.position.y);
      if (phase === 3) b.position.y = b.userData.y + Math.max(0, Math.sin(time * 5 + i)) * 0.04;
    });

    // van: waits at the dock (0-3), drives to the shop (4), parked (5), drives back (6)
    let vanU = 0;
    if (phase === 4) vanU = ease(u) * VAN_STOP;
    else if (phase === 5) vanU = VAN_STOP;
    else if (phase === 6) vanU = VAN_STOP * (1 - ease(clamp01(u / 0.95)));
    placeVan(vanU);
    if (phase === 6) v.group.rotation.y += Math.PI; // reversing looks odd - drive back facing home
    wheelSpin += ((vanU - lastVanU) * curve.getLength()) / 0.28;
    lastVanU = vanU;
    v.wheels.forEach((w) => (w.rotation.z = -wheelSpin * (phase === 6 ? -1 : 1)));
    v.group.position.y = phase === 4 || phase === 6 ? Math.abs(Math.sin(time * 14)) * 0.025 : 0;

    // markers
    pinShop.position.y =
      2.9 + (phase === 4 || phase === 5 ? Math.abs(Math.sin(time * 4)) * 0.35 : 0);
    pinShop.rotation.y = time;
    pinWh.position.y = 4.4 + (phase === 3 ? Math.abs(Math.sin(time * 4)) * 0.35 : 0);
    pinWh.rotation.y = time;

    // payment success pulse
    if (phase === 5) {
      const k = (u * 2) % 1;
      ring.scale.setScalar(0.6 + k * 1.6);
      ring.material.opacity = 0.85 * (1 - k);
    } else ring.material.opacity = 0;

    // connected-platform overview
    const show = phase === 6 ? clamp01(u / 0.35) : 0;
    hub.visible = show > 0;
    hub.scale.setScalar(0.4 + ease(show) * 0.6);
    hub.position.y = 5.4 + Math.sin(time * 2) * 0.12;
    hubTile.rotation.y = time * 0.6;
    links.forEach((l, i) => {
      const grow = phase === 6 ? clamp01((u - 0.08 - i * 0.05) / 0.3) : 0;
      l.mesh.visible = grow > 0;
      l.mesh.geometry.setDrawRange(0, Math.floor((l.count * ease(grow)) / 3) * 3);
      l.pulse.visible = grow >= 1;
      if (l.pulse.visible) l.pulse.position.copy(l.path.getPoint((time * 0.6 + i * 0.25) % 1));
    });

    // camera focus follows the story
    const focus = [
      [-4.2, 0.9, 3.0],
      [-4.4, 1.2, 3.0],
      [-4.4, 1.2, 3.0],
      [3.0, 1.0, -1.8],
      [0.4, 0.6, 2.4],
      [-4.0, 1.0, 3.2],
      [0, 1.4, 0.6],
    ][phase];
    // drift gently towards the action, but keep the whole island in view
    targetGoal.set(focus[0] * 0.45, focus[1], 0.6 + (focus[2] - 0.6) * 0.45);
    zoomGoal = phase === 6 ? 0.94 : 1.04;
  };

  // ---- framing, parallax, overlays
  let width = 1;
  let height = 1;
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  const frame = () => {
    const aspect = width / height;
    const h = Math.max(compact ? 12.5 : 14, (compact ? 26 : 29) / aspect) / zoom;
    camera.left = (-h * aspect) / 2;
    camera.right = (h * aspect) / 2;
    camera.top = h / 2;
    camera.bottom = -h / 2;
    camera.updateProjectionMatrix();
  };
  const resize = () => {
    width = Math.max(1, container.clientWidth);
    height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    frame();
  };

  const tmp = new THREE.Vector3();
  const placeOverlays = (phase) => {
    for (const o of overlays) {
      if (!o.el) continue;
      const on = !reducedMotion ? o.phases.includes(phase) : o.phases.includes(6);
      o.el.dataset.show = String(on);
      if (!on && o.el.dataset.placed) continue;
      const a = anchors[o.anchor]?.();
      if (!a) continue;
      tmp.copy(a).project(camera);
      const x = (tmp.x * 0.5 + 0.5) * width;
      const y = (-tmp.y * 0.5 + 0.5) * height;
      o.el.style.transform = `translate(-50%, -100%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      o.el.dataset.placed = '1';
    }
  };

  const render = (time, dt) => {
    update(time);
    const damp = 1 - Math.exp(-dt * 2.2);
    target.lerp(targetGoal, reducedMotion ? 1 : damp);
    zoom += (zoomGoal - zoom) * (reducedMotion ? 1 : damp);
    pointer.x += (pointer.tx - pointer.x) * Math.min(1, dt * 3);
    pointer.y += (pointer.ty - pointer.y) * Math.min(1, dt * 3);
    const sway = reducedMotion ? 0 : Math.sin(time * 0.25) * 0.05;
    const dir = camDir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), sway + pointer.x * 0.08);
    dir.y += pointer.y * 0.05;
    camera.position.copy(target).add(dir.multiplyScalar(40));
    camera.lookAt(target);
    frame();
    renderer.render(scene, camera);
    placeOverlays(lastPhase);
  };

  const onPointer = (e) => {
    const r = container.getBoundingClientRect();
    pointer.tx = ((e.clientX - r.left) / r.width - 0.5) * 2;
    pointer.ty = ((e.clientY - r.top) / r.height - 0.5) * 2;
  };
  if (!reducedMotion && !compact)
    window.addEventListener('pointermove', onPointer, { passive: true });

  const STATIC_TIME = PHASE_SECONDS * 6 + PHASE_SECONDS * 0.9; // the connected overview
  const ro = new ResizeObserver(() => {
    resize();
    if (reducedMotion) render(STATIC_TIME, 1);
  });
  ro.observe(container);
  resize();

  // ---- loop (paused when off-screen; a single still frame for reduced motion)
  let raf = 0;
  let running = false;
  let last = performance.now();
  let clock = 0;
  const tick = (now) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    clock += dt;
    render(clock, dt);
    raf = requestAnimationFrame(tick);
  };
  const start = () => {
    if (running || reducedMotion) return;
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(tick);
  };
  const stop = () => {
    running = false;
    cancelAnimationFrame(raf);
  };
  const io = new IntersectionObserver(([e]) => (e.isIntersecting ? start() : stop()));
  io.observe(container);
  if (reducedMotion) render(STATIC_TIME, 1);

  return {
    dispose() {
      stop();
      io.disconnect();
      ro.disconnect();
      window.removeEventListener('pointermove', onPointer);
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
        mats.forEach((m) => {
          m.map?.dispose();
          m.dispose();
        });
      });
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}
