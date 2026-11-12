// Procedural 3D models for every decor item. Each builder returns a THREE.Group
// whose origin is where it attaches (ground: bottom centre, wall: wall surface,
// top: lid surface, under: tank underside).
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, noise3, lerp, clamp, hexToRgb } from './util.js';
import { woodTexture, gaugeTexture } from './textures.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);

// ---------- materials ----------
const MAT = {};
function mat(key, make) {
  return MAT[key] || (MAT[key] = make());
}
const std = (o) => new THREE.MeshStandardMaterial(o);
export const materials = {
  leaf: () => mat('leaf', () => std({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.55, metalness: 0 })),
  vcol: () => mat('vcol', () => std({ vertexColors: true, roughness: 0.92, flatShading: true })),
  vcolSmooth: () => mat('vcolSmooth', () => std({ vertexColors: true, roughness: 0.8 })),
  vcolInner: () => mat('vcolInner', () => std({ vertexColors: true, roughness: 0.95, side: THREE.BackSide, color: '#5b5650', flatShading: true })),
  drift: () => mat('drift', () => std({ map: woodTexture('drift'), roughness: 0.9 })),
  bark: () => mat('bark', () => std({ map: woodTexture('bark'), roughness: 0.95 })),
  inner: () => mat('inner', () => std({ map: woodTexture('inner'), roughness: 0.9, side: THREE.BackSide })),
  innerFront: () => mat('innerFront', () => std({ map: woodTexture('inner'), roughness: 0.9, side: THREE.DoubleSide })),
  cork: () => mat('cork', () => std({ map: woodTexture('cork'), roughness: 1 })),
  corkInner: () => mat('corkInner', () => std({ color: '#4a3020', roughness: 1, side: THREE.BackSide })),
  bamboo: () => mat('bamboo', () => std({ map: woodTexture('bamboo'), roughness: 0.55 })),
  plank: () => mat('plank', () => std({ map: woodTexture('plank'), roughness: 0.8 })),
  gold: () => mat('gold', () => std({ color: '#e7b53c', metalness: 0.9, roughness: 0.28 })),
  metal: () => mat('metal', () => std({ color: '#2b2c30', metalness: 0.5, roughness: 0.45 })),
  alu: () => mat('alu', () => std({ color: '#d9dce2', metalness: 0.95, roughness: 0.22, side: THREE.DoubleSide })),
  water: () => mat('water', () => new THREE.MeshPhysicalMaterial({ color: '#4fa8c8', roughness: 0.04, metalness: 0, transparent: true, opacity: 0.72, clearcoat: 1, clearcoatRoughness: 0.05 })),
  bulb: () => mat('bulb', () => std({ color: '#fff4d6', emissive: '#ffb04a', emissiveIntensity: 2.4, roughness: 0.3 })),
  uvbTube: () => mat('uvbTube', () => std({ color: '#f4f2ff', emissive: '#dcd6ff', emissiveIntensity: 1.6, roughness: 0.3 })),
  black: () => mat('black', () => std({ color: '#151515', roughness: 0.6 })),
  white: () => mat('white', () => std({ color: '#f4f1ea', roughness: 0.5 })),
  ceramic: (c) => mat('ceramic' + c, () => std({ color: c, roughness: 0.35 })),
  plain: (c, r = 0.8) => mat('plain' + c + r, () => std({ color: c, roughness: r })),
  plainDouble: (c, r = 0.8) => mat('plainD' + c + r, () => std({ color: c, roughness: r, side: THREE.DoubleSide })),
};

export function setLampGlow(on) {
  materials.bulb().emissiveIntensity = on ? 2.4 : 0.0;
  materials.uvbTube().emissiveIntensity = on ? 1.6 : 0.0;
}

// ---------- geometry helpers ----------
function mesh(geo, material, cast = true, receive = true) {
  const m = new THREE.Mesh(geo, material);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

function colorAttr(geo, colorFn) {
  const pos = geo.attributes.position;
  const arr = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const res = colorFn(pos.getX(i), pos.getY(i), pos.getZ(i), i);
    c.set(res);
    arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

// Normalise a geometry so it can be merged with others: non-indexed, position/normal/color only.
function prep(geo, color) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  if (!g.attributes.normal) g.computeVertexNormals();
  g.deleteAttribute('uv');
  if (g.attributes.uv1) g.deleteAttribute('uv1');
  if (!g.attributes.color) {
    const c = new THREE.Color(color || '#888888');
    colorAttr(g, () => c);
  }
  return g;
}

function merge(geos) {
  return mergeGeometries(geos.map((g) => prep(g)), false);
}

const tmpC = new THREE.Color();
function mixColor(a, b, t) {
  return tmpC.set(a).lerp(new THREE.Color(b), clamp(t, 0, 1)).clone();
}

// Leaf: length along +z, width along x, surface normal ≈ +y.
const LEAF_SHAPES = {
  ellipse: (t) => Math.pow(Math.sin(Math.PI * t), 0.8),
  heart: (t) => Math.pow(Math.sin(Math.PI * Math.pow(t, 0.7)), 0.9) * (1.15 - 0.35 * t),
  lance: (t) => Math.min(1, t * 7) * (1 - Math.pow(t, 3)),
  strap: (t) => Math.min(1, 0.55 + t * 3) * (1 - Math.pow(t, 6)),
  spoon: (t) => (0.35 + 0.65 * t) * Math.pow(Math.sin(Math.PI * Math.min(t * 0.92 + 0.08, 1)), 0.55),
  triangle: (t) => Math.min(1, 0.6 + t * 4) * (1 - t),
  round: (t) => Math.sqrt(Math.max(0, Math.sin(Math.PI * t))),
};
function leafGeo({ len, width, shape = 'ellipse', segL = 6, segW = 2, curl = 0, fold = 0.2, colorFn, twist = 0 }) {
  const cols = segW * 2 + 1;
  const pos = [], colors = [], idx = [];
  const wf = LEAF_SHAPES[shape];
  for (let i = 0; i <= segL; i++) {
    const t = i / segL;
    const w = Math.max(0.001, wf(t)) * width * 0.5;
    const tw = twist * t;
    for (let j = 0; j < cols; j++) {
      const s = j / segW - 1;
      let x = s * w;
      let y = curl * len * t * t + fold * Math.abs(s) * w;
      const z = t * len;
      if (tw) {
        const cx = x * Math.cos(tw) - y * Math.sin(tw);
        y = x * Math.sin(tw) + y * Math.cos(tw);
        x = cx;
      }
      pos.push(x, y, z);
      const c = colorFn ? colorFn(t, s) : new THREE.Color('#3d8a3a');
      colors.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < segL; i++) {
    for (let j = 0; j < cols - 1; j++) {
      const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g.toNonIndexed();
}

const _m = new THREE.Matrix4();
function orient(geo, origin, dir, upHint = UP, roll = 0) {
  const z = dir.clone().normalize();
  let x = new THREE.Vector3().crossVectors(upHint, z);
  if (x.lengthSq() < 1e-6) x.set(1, 0, 0);
  x.normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  if (roll) geo.rotateZ(roll);
  _m.makeBasis(x, y, z).setPosition(origin);
  geo.applyMatrix4(_m);
  return geo;
}
const dirFrom = (yaw, elev) => V(Math.sin(yaw) * Math.cos(elev), Math.sin(elev), Math.cos(yaw) * Math.cos(elev));

// Tube along a CatmullRom curve with a varying radius.
function tubeGeo(points, radiusFn, { radial = 8, segs, colorFn, uvScale = 10 } = {}) {
  const curve = new THREE.CatmullRomCurve3(points);
  const len = curve.getLength();
  segs = segs || Math.max(6, Math.round(len * 1.5));
  const frames = curve.computeFrenetFrames(segs, false);
  const pos = [], nor = [], uv = [], col = [], idx = [];
  const P = V(), N = V();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    curve.getPointAt(t, P);
    const r = radiusFn(t);
    const n = frames.normals[i], b = frames.binormals[i];
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      N.copy(n).multiplyScalar(Math.cos(a)).addScaledVector(b, Math.sin(a));
      pos.push(P.x + N.x * r, P.y + N.y * r, P.z + N.z * r);
      nor.push(N.x, N.y, N.z);
      uv.push(j / radial, (t * len) / uvScale);
      if (colorFn) {
        const c = colorFn(t, j / radial);
        col.push(c.r, c.g, c.b);
      }
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j, b = a + radial + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (colorFn) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.userData.curve = curve;
  return g;
}

// Lumpy rock with flat-shaded facets and per-face colour variation.
function rockGeo(rnd, { radius = 1, detail = 2, sx = 1, sy = 1, sz = 1, rough = 0.4, colors = ['#8a8780'], sink = 0.12 }) {
  const g = new THREE.IcosahedronGeometry(radius, detail);
  const pos = g.attributes.position;
  const seed = Math.floor(rnd() * 1000);
  const v = V();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = noise3(v.x * 1.2 / radius + seed, v.y * 1.2 / radius, v.z * 1.2 / radius, seed);
    v.multiplyScalar(1 + (n - 0.5) * 2.4 * rough);
    v.x *= sx; v.y *= sy; v.z *= sz;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  // flatten the underside
  const floor = -radius * sy * 0.4;
  let minY = Infinity;
  for (let i = 0; i < pos.count; i++) {
    let y = pos.getY(i);
    if (y < floor) y = floor + (y - floor) * 0.1;
    pos.setY(i, y);
    minY = Math.min(minY, y);
  }
  g.translate(0, -minY - radius * sy * sink, 0);
  // per-face colour
  const cols = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let f = 0; f < pos.count; f += 3) {
    const cy = (pos.getY(f) + pos.getY(f + 1) + pos.getY(f + 2)) / 3;
    c.set(colors[Math.floor(rnd() * colors.length)]);
    const k = 0.82 + rnd() * 0.3 + cy * 0.015;
    for (let q = 0; q < 3; q++) {
      cols[(f + q) * 3] = c.r * k; cols[(f + q) * 3 + 1] = c.g * k; cols[(f + q) * 3 + 2] = c.b * k;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  g.computeVertexNormals();
  return g;
}

// Hemisphere shell with an entrance cut at the front (+z).
function domeShell(rnd, { rx, h, rz, gap = 0.55, gapH = 0.62, rough = 0.18, colors, wSeg = 30, hSeg = 12 }) {
  const src = new THREE.SphereGeometry(1, wSeg, hSeg, 0, Math.PI * 2, 0, Math.PI / 2).toNonIndexed();
  const sp = src.attributes.position, su = src.attributes.uv;
  const out = [], uvs = [];
  const seed = Math.floor(rnd() * 1000);
  const v = V();
  for (let f = 0; f < sp.count; f += 3) {
    let cx = 0, cy = 0, cz = 0;
    for (let q = 0; q < 3; q++) { cx += sp.getX(f + q); cy += sp.getY(f + q); cz += sp.getZ(f + q); }
    cx /= 3; cy /= 3; cz /= 3;
    const az = Math.atan2(cx, cz);
    const arch = gapH * Math.sqrt(Math.max(0, 1 - Math.pow(az / gap, 2)));
    if (Math.abs(az) < gap && cy < arch) continue;
    for (let q = 0; q < 3; q++) {
      v.fromBufferAttribute(sp, f + q);
      const n = noise3(v.x * 2 + seed, v.y * 2, v.z * 2, seed);
      const k = 1 + (n - 0.5) * 2 * rough * (v.y > 0.02 ? 1 : 0.3);
      out.push(v.x * k * rx, v.y * k * h, v.z * k * rz);
      uvs.push(su.getX(f + q) * 3, su.getY(f + q) * 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  if (colors) {
    const cols = [];
    const c = new THREE.Color();
    for (let f = 0; f < out.length / 3; f += 3) {
      c.set(colors[Math.floor(rnd() * colors.length)]);
      const k = 0.85 + rnd() * 0.25;
      for (let q = 0; q < 3; q++) cols.push(c.r * k, c.g * k, c.b * k);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  }
  g.computeVertexNormals();
  return g;
}

function latheGeo(profile, segs = 32) {
  return new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x, y)), segs);
}

// ---------- food contents (dishes / feeders) ----------
function foodContents(kind, amount, radius, rnd) {
  const g = new THREE.Group();
  if (!kind || amount <= 0) return g;
  if (kind === 'mealworms' || kind === 'worms') {
    const geos = [];
    for (let i = 0; i < amount; i++) {
      const a = rnd() * Math.PI * 2, r = rnd() * radius * 0.6;
      const pts = [];
      const yaw = rnd() * Math.PI * 2, bend = (rnd() - 0.5) * 1.5;
      for (let k = 0; k < 5; k++) {
        const t = k / 4 - 0.5;
        pts.push(V(Math.cos(a) * r + Math.cos(yaw + bend * t) * t * 1.1, 0.12 + i * 0.02, Math.sin(a) * r + Math.sin(yaw + bend * t) * t * 1.1));
      }
      geos.push(tubeGeo(pts, (t) => 0.13 * Math.pow(Math.sin(Math.PI * (0.1 + t * 0.8)), 0.4), { radial: 6, segs: 8, colorFn: (t, u) => mixColor('#d9a24a', '#8a5a22', (Math.sin(t * 40) * 0.5 + 0.5) * 0.5) }));
    }
    g.add(mesh(merge(geos), materials.vcolSmooth()));
  } else if (kind === 'salad') {
    const geos = [];
    for (let i = 0; i < 10 * Math.min(1, amount); i++) {
      const a = rnd() * Math.PI * 2, r = rnd() * radius * 0.65;
      const lg = leafGeo({ len: 0.9 + rnd() * 0.6, width: 0.7 + rnd() * 0.5, shape: 'round', fold: 0.3, curl: 0.2, colorFn: (t, s) => mixColor('#4f9a32', '#9fd25a', Math.abs(s)) });
      orient(lg, V(Math.cos(a) * r, 0.15 + rnd() * 0.25, Math.sin(a) * r), dirFrom(rnd() * 6.28, (rnd() - 0.5) * 0.6));
      geos.push(lg);
    }
    for (let i = 0; i < 5 * Math.min(1, amount); i++) {
      const b = new THREE.BoxGeometry(0.35, 0.35, 0.35);
      b.rotateY(rnd() * 3);
      const a = rnd() * Math.PI * 2, r = rnd() * radius * 0.6;
      b.translate(Math.cos(a) * r, 0.3, Math.sin(a) * r);
      colorAttr(b, () => '#f09a2c');
      geos.push(b);
    }
    g.add(mesh(merge(geos), materials.leaf()));
  } else if (kind === 'fruit') {
    const disc = new THREE.CylinderGeometry(radius * 0.85, radius * 0.8, 0.25, 24);
    disc.translate(0, 0.15, 0);
    g.add(mesh(disc, materials.plain('#f08a3a', 0.25)));
  }
  return g;
}

function dishFoodApi(group, rnd, holderY, radius) {
  const holder = new THREE.Group();
  holder.position.y = holderY;
  group.add(holder);
  const ud = group.userData;
  ud.food = null;
  ud.foodAmount = 0;
  ud.setFood = (kind, amount) => {
    ud.food = amount > 0 ? kind : null;
    ud.foodAmount = amount;
    holder.clear();
    if (amount > 0) holder.add(foodContents(kind, amount, radius, rnd));
  };
  ud.eatOne = () => {
    if (!ud.food) return false;
    const step = ud.food === 'fruit' || ud.food === 'salad' ? 0.34 : 1;
    ud.setFood(ud.food, Math.max(0, +(ud.foodAmount - step).toFixed(2)));
    return true;
  };
}

// ---------- builders ----------
const B = {};

B.rockCave = (rnd) => {
  const g = new THREE.Group();
  const geo = domeShell(rnd, { rx: 4, h: 3.3, rz: 3.4, colors: ['#8b867c', '#7a756c', '#9b958a', '#6f6a62'], rough: 0.2 });
  const outer = mesh(geo, materials.vcol());
  const inner = mesh(geo, materials.vcolInner(), false, true);
  g.add(outer, inner);
  g.userData.solid = [outer];
  g.userData.hideCenter = V(0, 0.2, -0.5);
  return g;
};

B.coconut = B.cocoHut = (rnd) => {
  const g = new THREE.Group();
  const geo = domeShell(rnd, { rx: 2.6, h: 2.4, rz: 2.6, rough: 0.06, gap: 0.5, gapH: 0.7 });
  const outer = mesh(geo, materials.cork());
  const inner = mesh(geo, materials.plain('#efe6d2', 0.9).clone(), false, true);
  inner.material.side = THREE.BackSide;
  g.add(outer, inner);
  g.userData.solid = [outer];
  g.userData.hideCenter = V(0, 0.2, -0.3);
  return g;
};

B.humidHide = (rnd) => {
  const g = new THREE.Group();
  const geo = domeShell(rnd, { rx: 3.2, h: 2.6, rz: 2.8, colors: ['#4f5a4a', '#5a6652', '#47513f'], rough: 0.12, gap: 0.45, gapH: 0.6 });
  const outer = mesh(geo, materials.vcol());
  const inner = mesh(geo, materials.vcolInner(), false, true);
  // damp moss peeking out of the door
  const moss = rockGeo(rnd, { radius: 1.6, detail: 2, sx: 1.6, sy: 0.35, sz: 1.3, rough: 0.5, colors: ['#4f7a2c', '#5f8f34', '#3d6524'] });
  const mm = mesh(moss, materials.vcol());
  g.add(outer, inner, mm);
  g.userData.solid = [outer];
  g.userData.hideCenter = V(0, 0.3, -0.3);
  return g;
};

B.halfLog = (rnd) => {
  const g = new THREE.Group();
  const r = 2.4, len = 8;
  const geo = new THREE.CylinderGeometry(r, r * 1.05, len, 20, 4, true, 0, Math.PI);
  // a little irregularity
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + (noise3(x * 0.8, y * 0.3, z * 0.8, 7) - 0.5) * 0.18;
    p.setXYZ(i, x * k, y, z * k);
  }
  geo.computeVertexNormals();
  geo.rotateZ(Math.PI / 2);
  const outer = mesh(geo, materials.bark());
  const inner = mesh(geo, materials.inner(), false, true);
  g.add(outer, inner);
  for (const s of [-1, 1]) {
    const ring = new THREE.RingGeometry(r * 0.86, r * 1.02, 20, 1, 0, Math.PI);
    ring.rotateY(Math.PI / 2);
    ring.translate((len / 2) * s, 0, 0);
    g.add(mesh(ring, materials.innerFront()));
  }
  g.userData.solid = [outer];
  g.userData.hideCenter = V(0, 0.2, 0);
  return g;
};

B.corkTube = (rnd) => {
  const g = new THREE.Group();
  const r = 2.2, len = 11;
  const geo = new THREE.CylinderGeometry(r, r * 0.92, len, 22, 8, true);
  const p = geo.attributes.position;
  const seed = rnd() * 100;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = Math.atan2(x, z);
    const k = 1 + (noise3(Math.cos(a) * 1.5 + seed, y * 0.35, Math.sin(a) * 1.5, 3) - 0.5) * 0.45;
    p.setXYZ(i, x * k, y, z * k);
  }
  geo.computeVertexNormals();
  geo.rotateZ(Math.PI / 2);
  geo.translate(0, r * 0.82, 0);
  const outer = mesh(geo, materials.cork());
  const inner = mesh(geo, materials.corkInner(), false, true);
  g.add(outer, inner);
  g.userData.solid = [outer];
  g.userData.hideCenter = V(0, 0.4, 0);
  g.userData.climbPath = [V(-len / 2 + 0.5, r * 1.7, 0), V(len / 2 - 0.5, r * 1.7, 0)];
  return g;
};

B.corkFlat = (rnd) => {
  const g = new THREE.Group();
  const r = 4.2, len = 11;
  const geo = new THREE.CylinderGeometry(r, r, len, 18, 6, true, 0.55, Math.PI - 1.1);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + (noise3(x * 0.7, y * 0.3, z * 0.7, 21) - 0.5) * 0.35;
    p.setXYZ(i, x * k, y, z * k);
  }
  geo.computeVertexNormals();
  geo.rotateZ(Math.PI / 2);
  geo.rotateZ(0.32);
  geo.computeBoundingBox();
  geo.translate(0, -geo.boundingBox.min.y - 0.3, 0);
  const outer = mesh(geo, materials.cork());
  const inner = mesh(geo, materials.corkInner(), false, true);
  g.add(outer, inner);
  g.userData.solid = [outer];
  g.userData.hideCenter = V(2.5, 0.3, 0);
  const bb = geo.boundingBox;
  g.userData.climbPath = [V(-len / 2 + 0.3, 1.5, 0), V(0, (bb.max.y - bb.min.y) * 0.55, 0), V(len / 2 - 1, bb.max.y - bb.min.y, 0)];
  return g;
};

B.driftwood = (rnd) => {
  const g = new THREE.Group();
  const L = 15, H = 10;
  const pts = [];
  for (let i = 0; i <= 5; i++) {
    const t = i / 5;
    pts.push(V(-L / 2 + t * L, 0.15 + Math.pow(t, 1.15) * H + (i > 0 && i < 5 ? (rnd() - 0.5) * 1.6 : 0), (i > 0 ? (rnd() - 0.5) * 3 : 0)));
  }
  const rad = (t) => lerp(0.95, 0.38, t) * (1 + 0.12 * Math.sin(t * 23));
  const trunk = tubeGeo(pts, rad, { radial: 10 });
  const geos = [trunk];
  // side branches
  const curve = trunk.userData.curve;
  for (const [t0, side] of [[0.45, 1], [0.7, -1]]) {
    const p0 = curve.getPointAt(t0);
    const dir = V(0.3 + rnd() * 0.4, 0.8, side * (0.6 + rnd() * 0.5)).normalize();
    const p1 = p0.clone().addScaledVector(dir, 2.5);
    const p2 = p1.clone().add(V(0.8, 0.8 + rnd(), side * 1.5));
    geos.push(tubeGeo([p0, p1, p2], (t) => lerp(0.42, 0.12, t), { radial: 7 }));
  }
  // root stub
  geos.push(tubeGeo([pts[0].clone(), pts[0].clone().add(V(-1.5, -0.1, 1)), pts[0].clone().add(V(-2.6, -0.4, 1.8))], (t) => lerp(0.5, 0.15, t), { radial: 6 }));
  const m = mesh(mergeGeometries(geos), materials.drift());
  g.add(m);
  g.userData.solid = [m];
  g.userData.climbPath = [];
  for (let i = 0; i <= 8; i++) {
    const t = 0.04 + (i / 8) * 0.9;
    g.userData.climbPath.push(curve.getPointAt(t).add(V(0, rad(t) + 0.1, 0)));
  }
  return g;
};

B.bamboo = (rnd) => {
  const g = new THREE.Group();
  const geos = [];
  const poles = [[0, 0, 15, 0.5], [1.3, 0.6, 12, 0.42], [-0.9, 1.0, 17, 0.45]];
  let path = null;
  for (const [x, z, h, r] of poles) {
    const tilt = (rnd() - 0.5) * 0.25, tilt2 = (rnd() - 0.5) * 0.2;
    const c = new THREE.CylinderGeometry(r, r * 1.05, h, 12, 1);
    c.translate(0, h / 2 - 0.4, 0);
    const nodes = [];
    for (let y = 2.4; y < h - 0.5; y += 2.6) {
      const n = new THREE.TorusGeometry(r * 1.02, 0.07, 6, 14);
      n.rotateX(Math.PI / 2);
      n.translate(0, y, 0);
      nodes.push(n);
    }
    const one = mergeGeometries([c.toNonIndexed(), ...nodes.map((n) => n.toNonIndexed())]);
    one.rotateZ(tilt);
    one.rotateX(tilt2);
    one.translate(x, 0, z);
    geos.push(one);
    if (!path) {
      const top = V(0, h - 0.6, 0).applyAxisAngle(V(0, 0, 1), tilt).applyAxisAngle(V(1, 0, 0), tilt2).add(V(x, 0, z));
      path = [V(x, 0.3, z + r + 0.2), top.clone().add(V(0, 0, r + 0.2))];
    }
  }
  const m = mesh(mergeGeometries(geos), materials.bamboo());
  g.add(m);
  // a few leaves at the top
  const leafGeos = [];
  for (let i = 0; i < 6; i++) {
    const lg = leafGeo({ len: 2.6, width: 0.5, shape: 'lance', curl: -0.15, colorFn: (t) => mixColor('#5b8f2c', '#9dbb4a', t) });
    orient(lg, V(-0.9, 14 + i * 0.4, 1), dirFrom(i * 1.1, 0.2));
    leafGeos.push(lg);
  }
  g.add(mesh(merge(leafGeos), materials.leaf()));
  g.userData.solid = [m];
  g.userData.climbPath = path;
  return g;
};

B.boulder = (rnd) => {
  const g = new THREE.Group();
  const geo = rockGeo(rnd, { radius: 3, detail: 3, sx: 1.25, sy: 0.85, sz: 1.0, rough: 0.35, colors: ['#9c9284', '#8c8376', '#a89d8d', '#7f776c'] });
  const m = mesh(geo, materials.vcol());
  g.add(m);
  g.userData.solid = [m];
  return g;
};

B.slateStack = (rnd) => {
  const g = new THREE.Group();
  const geos = [];
  const slabs = [[5.2, 0, 0, 0], [4.0, -0.6, 0.3, 0.6], [2.9, -1.1, 0.5, 1.2]];
  for (const [r, ox, oz, y] of slabs) {
    const shape = new THREE.Shape();
    const n = 9;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = r * (0.72 + rnd() * 0.3);
      const x = Math.cos(a) * rr * 1.15, z = Math.sin(a) * rr * 0.85;
      if (i === 0) shape.moveTo(x, z); else shape.lineTo(x, z);
    }
    shape.closePath();
    const eg = new THREE.ExtrudeGeometry(shape, { depth: 0.5, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.1, bevelSegments: 1 });
    eg.rotateX(-Math.PI / 2);
    eg.rotateY(rnd() * 6.28);
    eg.translate(ox, y + 0.07, oz);
    const shade = ['#5d6065', '#6b6d71', '#55575c'][geos.length % 3];
    colorAttr(eg, () => shade);
    geos.push(eg);
  }
  const m = mesh(merge(geos), materials.vcol());
  g.add(m);
  g.userData.solid = [m];
  g.userData.climbPath = [V(3, 0.7, 0), V(0, 1.4, 0.3), V(-1.1, 2.0, 0.5)];
  return g;
};

// Conformable group: each child sits on the terrain individually.
function makeConform(group, parts) {
  group.userData.conform = (groundY) => {
    for (const p of parts) p.obj.position.y = groundY(p.obj.position.x, p.obj.position.z) + p.dy;
  };
}

B.pebbles = (rnd) => {
  const g = new THREE.Group();
  const parts = [];
  const cols = [['#d8d4cc', '#c9c3b8'], ['#8a8680', '#7c7770'], ['#b39a7a', '#a38a6a'], ['#5a5854', '#4d4b48']];
  for (let i = 0; i < 9; i++) {
    const r = 0.5 + rnd() * 0.5;
    const geo = rockGeo(rnd, { radius: r, detail: 1, sx: 1.2, sy: 0.6, sz: 1, rough: 0.15, colors: cols[i % 4] });
    const m = mesh(geo, materials.vcol());
    const a = rnd() * Math.PI * 2, d = rnd() * 2.6;
    m.position.set(Math.cos(a) * d, 0, Math.sin(a) * d);
    m.rotation.y = rnd() * 6;
    g.add(m);
    parts.push({ obj: m, dy: -0.05 });
  }
  makeConform(g, parts);
  return g;
};

B.ledge = (rnd) => {
  const g = new THREE.Group();
  const w = 7, d = 3.6;
  const back = new THREE.BoxGeometry(w, 2.4, 0.4);
  back.translate(0, -0.6, 0.2);
  const shelf = new THREE.BoxGeometry(w, 0.6, d);
  shelf.translate(0, -0.3, d / 2);
  const lip = new THREE.BoxGeometry(w, 0.5, 0.35);
  lip.translate(0, 0.15, d - 0.18);
  const m = mesh(mergeGeometries([back.toNonIndexed(), shelf.toNonIndexed(), lip.toNonIndexed()]), materials.cork());
  g.add(m);
  g.userData.solid = [m];
  g.userData.perch = V(0, 0.05, d / 2);
  return g;
};

B.ledgeFeeder = (rnd) => {
  const g = new THREE.Group();
  const back = new THREE.BoxGeometry(4.4, 2.2, 0.35);
  back.translate(0, -0.4, 0.17);
  const shelf = new THREE.BoxGeometry(4.4, 0.45, 3);
  shelf.translate(0, -0.25, 1.5);
  const m = mesh(mergeGeometries([back.toNonIndexed(), shelf.toNonIndexed()]), materials.plain('#3a3a3a', 0.7));
  g.add(m);
  const cup = mesh(latheGeo([[0, 0], [0.95, 0], [1.1, 1.0], [1.0, 1.05], [0.85, 0.12], [0, 0.12]], 24), materials.white());
  cup.position.set(0, 0, 1.6);
  g.add(cup);
  dishFoodApi(g, rnd, 0.6, 0.9);
  g.userData.foodHolder = g.children[g.children.length - 1];
  g.userData.foodHolder.position.set(0, 0.55, 1.6);
  g.userData.solid = [m];
  g.userData.feedPoint = V(0, 0.6, 1.6);
  return g;
};

B.vine = (rnd) => {
  const g = new THREE.Group();
  const w = 18;
  const pts = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const x = -w / 2 + t * w;
    const sag = -Math.sin(Math.PI * t) * 5.5 + (rnd() - 0.5) * 0.6;
    pts.push(V(x, sag, 0.5 + Math.sin(Math.PI * t) * 1.6));
  }
  // dangling end
  const end = pts[pts.length - 1];
  pts.push(end.clone().add(V(0.8, -2.5, 0.4)), end.clone().add(V(0.4, -5.5, 0.9)));
  const vineGeo = tubeGeo(pts, () => 0.22, { radial: 7, colorFn: (t) => mixColor('#5f4a2c', '#6f6a34', Math.sin(t * 30) * 0.5 + 0.5) });
  const curve = vineGeo.userData.curve;
  const leaves = [vineGeo];
  for (let i = 0; i < 30; i++) {
    const t = i / 30;
    const p = curve.getPointAt(t);
    const lg = leafGeo({ len: 1.5 + rnd() * 0.6, width: 0.9, shape: 'ellipse', curl: -0.15, fold: 0.15, colorFn: (tt, s) => mixColor('#2f7a34', '#62a948', tt * 0.7 + Math.abs(s) * 0.2) });
    orient(lg, p, V((rnd() - 0.5) * 1.5, -0.5 - rnd(), 0.6 + rnd()).normalize(), UP);
    leaves.push(lg);
  }
  g.add(mesh(merge(leaves), materials.leaf()));
  for (const x of [-w / 2, w / 2]) {
    const cup = new THREE.CylinderGeometry(0.55, 0.7, 0.3, 16);
    cup.rotateX(Math.PI / 2);
    cup.translate(x, 0, 0.15);
    g.add(mesh(cup, materials.plain('#cfe3e8', 0.2)));
  }
  return g;
};

B.waterDish = (rnd) => {
  const g = new THREE.Group();
  const r = 3, h = 1.2;
  const bowl = mesh(latheGeo([[0, 0.05], [r * 0.95, 0], [r * 1.05, h * 0.75], [r, h], [r * 0.85, h * 0.98], [r * 0.78, h * 0.3], [0, h * 0.22]], 36), materials.ceramic('#7d776e'));
  g.add(bowl);
  const water = new THREE.CircleGeometry(r * 0.83, 32);
  water.rotateX(-Math.PI / 2);
  water.translate(0, h * 0.8, 0);
  const w = mesh(water, materials.water(), false, false);
  g.add(w);
  g.userData.solid = [bowl];
  g.userData.water = w;
  return g;
};

B.foodDish = (rnd) => {
  const g = new THREE.Group();
  const r = 2.4, h = 0.8;
  const bowl = mesh(latheGeo([[0, 0.05], [r * 0.9, 0], [r * 1.05, h * 0.9], [r, h], [r * 0.85, h * 0.95], [r * 0.78, h * 0.25], [0, h * 0.2]], 32), materials.ceramic('#d58f62'));
  g.add(bowl);
  dishFoodApi(g, rnd, 0.1, r * 0.75);
  g.userData.solid = [bowl];
  return g;
};

B.heatLamp = (rnd) => {
  const g = new THREE.Group();
  const outer = mesh(latheGeo([[2.9, 0.1], [2.8, 1.2], [2.4, 2.6], [1.4, 3.6], [0.6, 3.9], [0.0, 4.0]], 32), materials.metal());
  const inner = mesh(latheGeo([[2.85, 0.12], [2.75, 1.2], [2.35, 2.55], [1.35, 3.5], [0.0, 3.85]], 32), materials.alu(), false, false);
  inner.material = materials.alu();
  g.add(outer, inner);
  const rim = new THREE.TorusGeometry(2.9, 0.12, 8, 32);
  rim.rotateX(Math.PI / 2);
  rim.translate(0, 0.12, 0);
  g.add(mesh(rim, materials.metal()));
  const socket = new THREE.CylinderGeometry(0.55, 0.55, 0.9, 16);
  socket.translate(0, 3.4, 0);
  g.add(mesh(socket, materials.white()));
  const bulbGeo = new THREE.SphereGeometry(1.25, 24, 16);
  bulbGeo.scale(1, 1.15, 1);
  bulbGeo.translate(0, 1.95, 0);
  const bulb = mesh(bulbGeo, materials.bulb(), false, false);
  g.add(bulb);
  // cord
  const cord = tubeGeo([V(0, 3.9, 0), V(0.4, 5.2, -0.4), V(1.5, 5.6, -2.5), V(3, 5.4, -4.5)], () => 0.12, { radial: 6 });
  g.add(mesh(cord, materials.black()));
  g.userData.lightLocal = V(0, 1.95, 0);
  g.userData.bulb = bulb;
  return g;
};

B.uvb = (rnd) => {
  const g = new THREE.Group();
  const len = 22;
  const housing = new THREE.BoxGeometry(len, 1.2, 2.6);
  housing.translate(0, 0.7, 0);
  g.add(mesh(housing, materials.plain('#e8eaee', 0.35)));
  const capL = new THREE.BoxGeometry(0.8, 1.4, 2.8);
  capL.translate(-len / 2, 0.7, 0);
  const capR = capL.clone().translate(len, 0, 0);
  g.add(mesh(mergeGeometries([capL, capR]), materials.metal()));
  const tube = new THREE.CylinderGeometry(0.36, 0.36, len - 1.2, 14);
  tube.rotateZ(Math.PI / 2);
  tube.translate(0, 0.32, 0);
  const t = mesh(tube, materials.uvbTube(), false, false);
  g.add(t);
  const refl = new THREE.CylinderGeometry(1.1, 1.1, len - 1.2, 16, 1, true, Math.PI / 2, Math.PI);
  refl.rotateZ(Math.PI / 2);
  refl.translate(0, 0.25, 0);
  g.add(mesh(refl, materials.alu(), false, false));
  g.userData.uvbLen = len;
  return g;
};

B.heatMat = (rnd) => {
  const g = new THREE.Group();
  const w = 8, d = 11;
  const c = document.createElement('canvas');
  c.width = 128; c.height = 176;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1c1c1e';
  ctx.fillRect(0, 0, 128, 176);
  ctx.strokeStyle = '#d2552a';
  ctx.lineWidth = 4;
  ctx.beginPath();
  for (let y = 14; y < 166; y += 16) {
    ctx.moveTo(12, y);
    ctx.lineTo(116, y);
  }
  ctx.stroke();
  ctx.fillStyle = '#e8e8e8';
  ctx.font = 'bold 14px sans-serif';
  ctx.fillText('HEAT MAT', 30, 92);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const box = new THREE.BoxGeometry(w, 0.15, d);
  box.translate(0, -0.075, 0);
  const m = mesh(box, [materials.black(), materials.black(), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }), materials.black(), materials.black(), materials.black()], false, false);
  g.add(m);
  g.userData.matSize = [w, d];
  return g;
};

B.gauge = (rnd) => {
  const g = new THREE.Group();
  const body = new THREE.BoxGeometry(3.2, 2.3, 0.7);
  body.translate(0, 0, 0.35);
  g.add(mesh(body, materials.plain('#2b2d30', 0.5)));
  const screen = new THREE.PlaneGeometry(2.6, 1.6);
  screen.translate(0, 0.1, 0.72);
  const sm = new THREE.MeshBasicMaterial({ map: gaugeTexture('--°', '--%') });
  const s = new THREE.Mesh(screen, sm);
  g.add(s);
  g.userData.setReading = (t, h) => {
    if (sm.map) sm.map.dispose();
    sm.map = gaugeTexture(t, h);
    sm.needsUpdate = true;
  };
  return g;
};

// ----- plants -----
function plantMesh(geos) {
  const m = mesh(merge(geos), materials.leaf());
  return m;
}

B.pothos = (rnd) => {
  const g = new THREE.Group();
  const geos = [];
  const n = 6;
  for (let i = 0; i < n; i++) {
    const yaw = (i / n) * Math.PI * 2 + rnd() * 0.6;
    const reach = 3.5 + rnd() * 3.5, up = 1.5 + rnd() * 3;
    const d = V(Math.sin(yaw), 0, Math.cos(yaw));
    const pts = [V(0, 0, 0), d.clone().multiplyScalar(reach * 0.25).add(V(0, up, 0)), d.clone().multiplyScalar(reach * 0.65).add(V(0, up * 0.6, 0)), d.clone().multiplyScalar(reach).add(V(0, 0.25, 0)), d.clone().multiplyScalar(reach + 2).add(V(rnd() - 0.5, 0.2, rnd() - 0.5))];
    const stem = tubeGeo(pts, () => 0.09, { radial: 5, colorFn: () => new THREE.Color('#5a8a32') });
    geos.push(stem);
    const curve = stem.userData.curve;
    const nl = 7 + Math.floor(rnd() * 3);
    for (let k = 1; k <= nl; k++) {
      const t = k / (nl + 0.5);
      const p = curve.getPointAt(t);
      const tan = curve.getTangentAt(t);
      const side = V().crossVectors(tan, UP).normalize().multiplyScalar(k % 2 ? 1 : -1);
      const dir = side.clone().multiplyScalar(0.7).add(V(0, 0.55, 0)).add(tan.clone().multiplyScalar(0.3)).normalize();
      const size = lerp(1.9, 1.2, t) * (0.85 + rnd() * 0.3);
      const vari = rnd();
      const lg = leafGeo({
        len: size, width: size * 0.85, shape: 'heart', fold: 0.12, curl: -0.12, segL: 5,
        colorFn: (tt, s) => {
          const streak = Math.sin(s * 9 + tt * 6 + vari * 10) > 0.55 ? 0.55 : 0;
          return mixColor(mixColor('#2f7a2c', '#4f9e3a', tt), '#e3d96a', streak * (0.4 + vari * 0.6));
        },
      });
      orient(lg, p, dir, tan);
      geos.push(lg);
    }
  }
  g.add(plantMesh(geos));
  return g;
};

B.snakePlant = (rnd) => {
  const g = new THREE.Group();
  const geos = [];
  const n = 8;
  for (let i = 0; i < n; i++) {
    const yaw = (i / n) * Math.PI * 2 + rnd();
    const elev = 1.2 + rnd() * 0.3;
    const len = 7 + rnd() * 5;
    const ph = rnd() * 10;
    const lg = leafGeo({
      len, width: 1.5 + rnd() * 0.6, shape: 'lance', segL: 10, segW: 2, fold: 0.25, curl: -0.03, twist: (rnd() - 0.5) * 1.2,
      colorFn: (t, s) => {
        if (Math.abs(s) > 0.82) return new THREE.Color('#d9cf5a');
        const band = Math.sin(t * 38 + ph + Math.abs(s) * 2) * 0.5 + 0.5;
        return mixColor('#1f4a2a', '#6f9a5a', band * 0.55);
      },
    });
    const r0 = 0.3 + rnd() * 0.6;
    orient(lg, V(Math.sin(yaw) * r0, -0.2, Math.cos(yaw) * r0), dirFrom(yaw, elev), UP);
    geos.push(lg);
  }
  g.add(plantMesh(geos));
  return g;
};

B.bromeliad = (rnd) => {
  const g = new THREE.Group();
  const geos = [];
  for (let i = 0; i < 18; i++) {
    const outer = i < 11;
    const yaw = (i / (outer ? 11 : 7)) * Math.PI * 2 + (outer ? 0 : 0.3);
    const elev = outer ? 0.45 + rnd() * 0.15 : 0.95 + rnd() * 0.2;
    const len = outer ? 5 + rnd() * 1.2 : 3.2 + rnd() * 0.8;
    const lg = leafGeo({
      len, width: outer ? 1.2 : 0.9, shape: 'strap', segL: 8, fold: 0.35, curl: outer ? -0.28 : -0.12,
      colorFn: (t, s) => (outer ? mixColor('#2c6b3a', '#5a9a45', t * 0.8 + Math.abs(s) * 0.15) : mixColor('#c0203e', '#f25a7c', t)),
    });
    orient(lg, V(0, outer ? 0.4 : 0.8, 0), dirFrom(yaw, elev), UP);
    geos.push(lg);
  }
  g.add(plantMesh(geos));
  return g;
};

B.fern = (rnd) => {
  const g = new THREE.Group();
  const geos = [];
  const n = 12;
  for (let i = 0; i < n; i++) {
    const yaw = (i / n) * Math.PI * 2 + rnd() * 0.4;
    const elev = 0.7 + rnd() * 0.5;
    const len = 6 + rnd() * 2;
    const d0 = dirFrom(yaw, elev);
    const out = V(Math.sin(yaw), 0, Math.cos(yaw));
    const pts = [V(0, 0.2, 0), d0.clone().multiplyScalar(len * 0.35).add(V(0, 0.2, 0)), out.clone().multiplyScalar(len * 0.7).add(V(0, len * 0.42, 0)), out.clone().multiplyScalar(len).add(V(0, len * 0.18, 0))];
    const rachis = tubeGeo(pts, (t) => lerp(0.08, 0.03, t), { radial: 4, colorFn: () => new THREE.Color('#4a7a2a') });
    geos.push(rachis);
    const curve = rachis.userData.curve;
    for (let k = 2; k < 18; k++) {
      const t = k / 18;
      const p = curve.getPointAt(t);
      const tan = curve.getTangentAt(t);
      const side = V().crossVectors(tan, UP).normalize();
      const sz = Math.sin(Math.PI * Math.min(1, t * 1.1)) * 1.5 + 0.2;
      for (const s of [1, -1]) {
        const dir = side.clone().multiplyScalar(s).add(tan.clone().multiplyScalar(0.45)).normalize();
        const lg = leafGeo({ len: sz, width: 0.38, shape: 'lance', segL: 3, segW: 1, fold: 0.1, curl: -0.1, colorFn: (tt) => mixColor('#3f8a2e', '#7cc04a', tt * 0.6 + t * 0.3) });
        orient(lg, p, dir, UP);
        geos.push(lg);
      }
    }
  }
  g.add(plantMesh(geos));
  return g;
};

B.fittonia = (rnd) => {
  const g = new THREE.Group();
  const geos = [];
  for (let i = 0; i < 40; i++) {
    const yaw = rnd() * Math.PI * 2;
    const elev = 0.15 + rnd() * 1.1;
    const r = 0.4 + rnd() * 1.6;
    const origin = V(Math.sin(yaw) * r, 0.2 + Math.cos((r / 2) * 1.2) * 1.2 * rnd(), Math.cos(yaw) * r);
    const lg = leafGeo({
      len: 1.1 + rnd() * 0.5, width: 0.85, shape: 'ellipse', segL: 5, fold: 0.15, curl: -0.1,
      colorFn: (t, s) => {
        const vein = Math.abs(Math.sin(t * 14)) < 0.25 || Math.abs(s) < 0.12;
        return vein ? new THREE.Color('#f7c2cf') : mixColor('#d84a6a', '#2f6a35', Math.pow(Math.abs(s), 0.8) * 0.8);
      },
    });
    orient(lg, origin, dirFrom(yaw, elev), UP);
    geos.push(lg);
  }
  g.add(plantMesh(geos));
  return g;
};

B.haworthia = (rnd) => {
  const g = new THREE.Group();
  const geos = [];
  const n = 16;
  for (let i = 0; i < n; i++) {
    const yaw = i * 2.39996;
    const inner = i / n;
    const elev = 0.6 + inner * 0.7;
    const lg = leafGeo({
      len: 3.0 - inner * 1.2, width: 0.95 - inner * 0.3, shape: 'triangle', segL: 8, segW: 2, fold: 0.55, curl: 0.12,
      colorFn: (t, s) => (Math.sin(t * 34 + Math.abs(s) * 3) > 0.55 ? new THREE.Color('#e9efe2') : mixColor('#24442c', '#3f6a40', t)),
    });
    orient(lg, V(0, 0.1 + inner * 0.3, 0), dirFrom(yaw, elev), UP);
    geos.push(lg);
  }
  g.add(plantMesh(geos));
  return g;
};

B.echeveria = (rnd) => {
  const g = new THREE.Group();
  const geos = [];
  const n = 30;
  for (let i = 0; i < n; i++) {
    const yaw = i * 2.39996;
    const k = i / n;
    const elev = 0.15 + k * 1.15;
    const len = 2.6 - k * 1.5;
    const lg = leafGeo({
      len, width: 1.25 - k * 0.55, shape: 'spoon', segL: 6, segW: 2, fold: 0.38, curl: 0.06,
      colorFn: (t, s) => mixColor(mixColor('#8fb5ad', '#a9c9bf', Math.abs(s)), '#e08aa4', Math.pow(t, 6) * 1.2),
    });
    orient(lg, V(0, 0.2 + k * 0.6, 0), dirFrom(yaw, elev), UP);
    geos.push(lg);
  }
  g.add(plantMesh(geos));
  return g;
};

B.elephantBush = (rnd) => {
  const g = new THREE.Group();
  const geos = [];
  const trunkC = (t) => mixColor('#7a3c2c', '#9a5a40', t);
  const trunk = tubeGeo([V(0, 0, 0), V(0.3, 2.5, 0.2), V(-0.2, 5, 0), V(0.2, 7, 0.3)], (t) => lerp(0.45, 0.18, t), { radial: 7, colorFn: trunkC });
  geos.push(trunk);
  const tips = [];
  const tc = trunk.userData.curve;
  for (let i = 0; i < 6; i++) {
    const t = 0.3 + i * 0.12;
    const p0 = tc.getPointAt(Math.min(t, 1));
    const yaw = i * 2.2 + rnd();
    const p2 = p0.clone().add(V(Math.sin(yaw) * (2 + rnd() * 1.5), 1 + rnd() * 1.5, Math.cos(yaw) * (2 + rnd() * 1.5)));
    const p1 = p0.clone().lerp(p2, 0.5).add(V(0, 0.4, 0));
    geos.push(tubeGeo([p0, p1, p2], (tt) => lerp(0.18, 0.07, tt), { radial: 5, colorFn: trunkC }));
    tips.push(p2, p1);
  }
  tips.push(V(0.2, 7, 0.3));
  for (const tip of tips) {
    for (let k = 0; k < 9; k++) {
      const s = new THREE.SphereGeometry(0.3, 6, 4);
      s.scale(1, 0.55, 0.8);
      s.rotateY(rnd() * 3);
      s.rotateX((rnd() - 0.5) * 1.2);
      s.translate(tip.x + (rnd() - 0.5) * 1.4, tip.y + (rnd() - 0.4) * 1.0, tip.z + (rnd() - 0.5) * 1.4);
      const c = mixColor('#4f8a32', '#86b84a', rnd());
      colorAttr(s, () => c);
      geos.push(s);
    }
  }
  g.add(plantMesh(geos));
  return g;
};

B.moss = (rnd) => {
  const g = new THREE.Group();
  const geo = rockGeo(rnd, { radius: 2.2, detail: 3, sx: 1.3, sy: 0.4, sz: 1.1, rough: 0.6, colors: ['#4f7f2c', '#5d9234', '#3f6c24', '#6fa040'], sink: 0.25 });
  const m = mesh(geo, materials.vcol());
  g.add(m);
  return g;
};

B.leafLitter = (rnd) => {
  const g = new THREE.Group();
  const parts = [];
  const cols = [['#8a5a2a', '#b07a3a'], ['#6e4a26', '#9a6a34'], ['#b8742c', '#d9a050'], ['#5a4426', '#7a6038'], ['#9a3e22', '#c46a3a']];
  for (let i = 0; i < 26; i++) {
    const [a, b] = cols[Math.floor(rnd() * cols.length)];
    const lg = leafGeo({ len: 1.3 + rnd() * 1.0, width: 0.8 + rnd() * 0.5, shape: 'ellipse', segL: 4, segW: 1, fold: 0.15, curl: 0.08, colorFn: (t, s) => mixColor(a, b, t + Math.abs(s) * 0.3) });
    orient(lg, V(0, 0, 0), dirFrom(rnd() * 6.28, (rnd() - 0.5) * 0.25), UP);
    lg.translate(0, 0, -0.6);
    const m = mesh(lg, materials.leaf(), false, true);
    const ang = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * 4;
    m.position.set(Math.cos(ang) * d, 0, Math.sin(ang) * d);
    m.rotation.y = rnd() * 6;
    g.add(m);
    parts.push({ obj: m, dy: 0.06 + rnd() * 0.05 });
  }
  makeConform(g, parts);
  return g;
};

B.isopods = (rnd) => {
  const g = B.leafLitter(rnd);
  // trim the litter down a bit
  const keep = g.children.slice(0, 9);
  g.clear();
  keep.forEach((k) => { k.position.multiplyScalar(0.55); g.add(k); });
  const litterConform = [];
  keep.forEach((k) => litterConform.push({ obj: k, dy: 0.08 }));
  const bugs = [];
  const styles = [['#9aa0a6', '#6c7277'], ['#e08a3a', '#c06a24'], ['#f2efe6', '#2a2a2a'], ['#6a5a50', '#4a3c34']];
  for (let i = 0; i < 9; i++) {
    const bug = new THREE.Group();
    const [c1, c2] = styles[i % styles.length];
    const body = new THREE.SphereGeometry(0.2, 10, 6);
    body.scale(0.85, 0.45, 1.6);
    const segs = [];
    for (let k = -2; k <= 2; k++) {
      const s = new THREE.TorusGeometry(0.16, 0.025, 4, 10, Math.PI);
      s.rotateY(Math.PI / 2);
      s.scale(1.05, 0.5, 1);
      s.translate(0, 0.02, k * 0.1);
      segs.push(s);
    }
    bug.add(mesh(body, materials.plain(c1, 0.6), false, false));
    bug.add(mesh(mergeGeometries(segs.map((s) => s.toNonIndexed())), materials.plain(c2, 0.6), false, false));
    const a = rnd() * Math.PI * 2, d = rnd() * 2;
    bug.position.set(Math.cos(a) * d, 0, Math.sin(a) * d);
    bug.rotation.y = rnd() * 6;
    bug.userData = { speed: 0.6 + rnd() * 0.6, pause: rnd() * 2, turn: 0 };
    g.add(bug);
    bugs.push(bug);
  }
  let groundY = () => 0;
  g.userData.conform = (fn) => {
    groundY = fn;
    for (const p of litterConform) p.obj.position.y = fn(p.obj.position.x, p.obj.position.z) + p.dy;
    for (const b of bugs) b.position.y = fn(b.position.x, b.position.z) + 0.06;
  };
  g.userData.tick = (dt) => {
    for (const b of bugs) {
      const u = b.userData;
      if (u.pause > 0) { u.pause -= dt; continue; }
      if (Math.random() < dt * 0.25) { u.pause = 0.5 + Math.random() * 2.5; continue; }
      u.turn += (Math.random() - 0.5) * dt * 6;
      u.turn *= 0.95;
      b.rotation.y += u.turn * dt;
      const sp = u.speed * dt;
      b.position.x += Math.sin(b.rotation.y) * sp;
      b.position.z += Math.cos(b.rotation.y) * sp;
      const d = Math.hypot(b.position.x, b.position.z);
      if (d > 3.2) {
        b.rotation.y = Math.atan2(-b.position.x, -b.position.z) + (Math.random() - 0.5);
      }
      b.position.y = groundY(b.position.x, b.position.z) + 0.06;
    }
  };
  return g;
};

// ----- fun -----
B.mushroom = (rnd) => {
  const g = new THREE.Group();
  const stem = mesh(latheGeo([[0, 0], [1.9, 0], [2.0, 0.6], [1.85, 2.0], [1.55, 3.2], [0, 3.2]], 32), materials.plain('#f3e6c8', 0.8));
  g.add(stem);
  const capGeo = new THREE.SphereGeometry(3.3, 32, 14, 0, Math.PI * 2, 0, Math.PI / 2);
  capGeo.scale(1, 0.72, 1);
  capGeo.translate(0, 3.0, 0);
  const cap = mesh(capGeo, materials.plain('#d8352e', 0.45));
  g.add(cap);
  const under = new THREE.CircleGeometry(3.3, 32);
  under.rotateX(Math.PI / 2);
  under.translate(0, 3.0, 0);
  g.add(mesh(under, materials.plain('#efe2c4', 0.9)));
  // white spots, flattened so they hug the cap
  const sp = [];
  for (let i = 0; i < 13; i++) {
    const a = rnd() * Math.PI * 2, e = 0.3 + rnd() * 1.05;
    const n = V(Math.cos(e) * Math.sin(a), Math.sin(e) / 0.72, Math.cos(e) * Math.cos(a)).normalize();
    const s = new THREE.SphereGeometry(0.42 + rnd() * 0.3, 10, 6);
    s.scale(1, 0.25, 1);
    const q = new THREE.Quaternion().setFromUnitVectors(UP, n);
    s.applyQuaternion(q);
    s.translate(Math.cos(e) * Math.sin(a) * 3.3, 3.0 + Math.sin(e) * 3.3 * 0.72, Math.cos(e) * Math.cos(a) * 3.3);
    sp.push(s);
  }
  g.add(mesh(mergeGeometries(sp), materials.white()));
  // door + window
  const door = new THREE.Shape();
  door.moveTo(-0.65, 0);
  door.lineTo(-0.65, 1.1);
  door.absarc(0, 1.1, 0.65, Math.PI, 0, true);
  door.lineTo(0.65, 0);
  const dg = new THREE.ShapeGeometry(door, 8);
  dg.translate(0, 0.05, 1.98);
  g.add(mesh(dg, materials.plain('#6b3f22', 0.8)));
  const knob = new THREE.SphereGeometry(0.1, 8, 6);
  knob.translate(0.38, 0.85, 2.02);
  g.add(mesh(knob, materials.gold()));
  const win = new THREE.CircleGeometry(0.42, 20);
  win.translate(0, 0, 0);
  const wm = mesh(win, materials.plain('#ffd36a', 0.4));
  wm.position.set(-1.1, 2.1, 1.62);
  wm.rotation.y = -0.6;
  g.add(wm);
  g.userData.solid = [stem, cap];
  g.userData.hideCenter = V(0, 0.2, 0);
  return g;
};

B.chest = (rnd) => {
  const g = new THREE.Group();
  const w = 6, h = 2.8, d = 3.8;
  const body = new THREE.BoxGeometry(w, h, d);
  body.translate(0, h / 2, 0);
  const bm = mesh(body, materials.plank());
  g.add(bm);
  const bands = [];
  for (const x of [-w / 2 + 0.6, w / 2 - 0.6]) {
    const b = new THREE.BoxGeometry(0.4, h + 0.05, d + 0.08);
    b.translate(x, h / 2, 0);
    bands.push(b);
  }
  const lock = new THREE.BoxGeometry(0.7, 0.8, 0.2);
  lock.translate(0, h - 0.35, d / 2 + 0.08);
  bands.push(lock);
  g.add(mesh(mergeGeometries(bands), materials.gold()));
  // open lid hinged at the back
  const lidGeo = new THREE.CylinderGeometry(d / 2, d / 2, w, 20, 1, false, 0, Math.PI);
  lidGeo.rotateZ(Math.PI / 2);
  lidGeo.translate(0, 0, d / 2);
  const lid = new THREE.Group();
  const lm = mesh(lidGeo, materials.plank());
  lid.add(lm);
  lid.position.set(0, h, -d / 2);
  lid.rotation.x = -1.15;
  g.add(lid);
  // gold coins
  const coins = [];
  for (let i = 0; i < 40; i++) {
    const c = new THREE.CylinderGeometry(0.32, 0.32, 0.08, 12);
    c.rotateX((rnd() - 0.5) * 1.2);
    c.rotateZ((rnd() - 0.5) * 1.2);
    const r = rnd();
    c.translate((rnd() - 0.5) * (w - 1), h + 0.05 + Math.pow(1 - Math.abs(r - 0.5) * 2, 1.5) * 0.7 * rnd(), (r - 0.5) * (d - 0.6));
    coins.push(c);
  }
  g.add(mesh(mergeGeometries(coins), materials.gold()));
  const gem = new THREE.OctahedronGeometry(0.4);
  gem.translate(0.8, h + 0.6, 0.2);
  g.add(mesh(gem, materials.plain('#3fd0b0', 0.1)));
  g.userData.solid = [bm];
  g.userData.hideCenter = V(0, 0.2, 0);
  return g;
};

B.column = (rnd) => {
  const g = new THREE.Group();
  const geos = [];
  const base = new THREE.BoxGeometry(3.8, 0.8, 3.8);
  base.translate(0, 0.4, 0);
  geos.push(base);
  const shaft = new THREE.CylinderGeometry(1.35, 1.5, 7.5, 32, 10);
  const p = shaft.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = Math.atan2(x, z);
    const k = 1 - 0.07 * Math.max(0, Math.cos(a * 16));
    let ny = y;
    if (y > 3.7) ny = y - (noise3(x, 0, z, 5) * 1.6 + 0.2);
    p.setXYZ(i, x * k, ny, z * k);
  }
  shaft.computeVertexNormals();
  shaft.translate(0, 0.8 + 3.75, 0);
  geos.push(shaft);
  const piece = new THREE.CylinderGeometry(1.35, 1.35, 3, 24, 1);
  piece.rotateZ(Math.PI / 2);
  piece.rotateY(0.6);
  piece.translate(2.6, 1.2, 1.8);
  geos.push(piece);
  const geo = merge(geos);
  const pos = geo.attributes.position;
  const col = geo.attributes.color;
  for (let i = 0; i < pos.count; i++) {
    const n = noise3(pos.getX(i) * 0.6, pos.getY(i) * 0.6, pos.getZ(i) * 0.6, 9);
    const c = mixColor('#e9e2d2', '#a8a090', Math.max(0, n - 0.35) * 2.2);
    col.setXYZ(i, c.r, c.g, c.b);
  }
  const m = mesh(geo, materials.vcolSmooth());
  g.add(m);
  g.userData.solid = [m];
  return g;
};

B.skull = (rnd) => {
  const g = new THREE.Group();
  const bone = ['#e9dfc6', '#d9cdb0', '#cfc2a2'];
  // cranium
  const cran = domeShell(rnd, { rx: 3.2, h: 2.8, rz: 4.6, colors: bone, rough: 0.1, gap: 0.42, gapH: 0.45 });
  cran.translate(0, 0, 0);
  const cm = mesh(cran, materials.vcol());
  g.add(cm);
  const inner = mesh(cran, materials.vcolInner(), false, true);
  g.add(inner);
  // snout ridge
  const snout = rockGeo(rnd, { radius: 1.6, detail: 2, sx: 1.1, sy: 0.7, sz: 2.2, rough: 0.12, colors: bone, sink: 0 });
  snout.translate(0, 1.0, 3.6);
  g.add(mesh(snout, materials.vcol()));
  // eye sockets
  for (const s of [-1, 1]) {
    const e = new THREE.SphereGeometry(0.85, 14, 10);
    e.scale(0.6, 1, 1);
    e.translate(s * 2.75, 1.9, 0.6);
    g.add(mesh(e, materials.plain('#1d1712', 1)));
  }
  // teeth
  const teeth = [];
  for (let i = 0; i < 12; i++) {
    const t = i / 11;
    const a = lerp(-1.05, 1.05, t);
    const c = new THREE.ConeGeometry(0.22, 0.9, 6);
    c.rotateX(Math.PI);
    c.translate(Math.sin(a) * 1.7, 0.35, 3.0 + Math.cos(a) * 2.6);
    teeth.push(c);
  }
  g.add(mesh(mergeGeometries(teeth), materials.plain('#f6f0de', 0.5)));
  g.userData.solid = [cm];
  g.userData.hideCenter = V(0, 0.2, -0.5);
  return g;
};

export const BUILDERS = B;

export function buildItem(type, seed = 1) {
  const rnd = mulberry32(seed);
  const fn = B[type];
  const g = fn ? fn(rnd) : new THREE.Group();
  g.userData.type = type;
  if (!g.userData.solid) g.userData.solid = [];
  return g;
}

// Dispose geometries (materials are shared) when an item is removed.
export function disposeItem(g) {
  g.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
  });
}
