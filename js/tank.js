// The enclosure: frame, glass/PVC panels, screen lid, 3D background and the wooden stand.
import * as THREE from 'three';
import { fbm, mulberry32, clamp } from './util.js';
import { screenTexture, woodTexture } from './textures.js';

const glassMat = new THREE.MeshPhysicalMaterial({
  color: '#eaf6f6', transparent: true, opacity: 0.13, roughness: 0.04, metalness: 0,
  envMapIntensity: 1.4, depthWrite: false, side: THREE.DoubleSide,
});
const frameMat = new THREE.MeshStandardMaterial({ color: '#1b1c1e', roughness: 0.45, metalness: 0.4 });
const handleMat = new THREE.MeshStandardMaterial({ color: '#c8ccd2', roughness: 0.25, metalness: 0.9 });

export function bgDepthFor(style) {
  return { none: 0, rock: 1.7, sandstone: 1.8, cork: 1.2 }[style] ?? 0;
}

function box(w, h, d, x, y, z, m = frameMat) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function pane(w, h, x, y, z, rotY = 0) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glassMat);
  m.position.set(x, y, z);
  m.rotation.y = rotY;
  m.renderOrder = 10;
  m.userData.glass = true;
  return m;
}

function buildBackground(L, H, style) {
  if (style === 'none') return null;
  const segX = Math.round(L * 1.4), segY = Math.round(H * 1.4);
  const geo = new THREE.PlaneGeometry(L - 0.3, H - 0.4, segX, segY);
  const pos = geo.attributes.position;
  const depth = bgDepthFor(style);
  const cols = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const rnd = mulberry32(L * 7 + H);
  const palettes = {
    rock: ['#77736c', '#8a857c', '#6a665f', '#9a948a', '#5d5a55'],
    sandstone: ['#c98b55', '#d9a46c', '#b8743f', '#e3b985', '#a8673a', '#cf9560'],
    cork: ['#4a3020', '#5e3e27', '#3a2416', '#6e4a2e'],
  };
  const pal = palettes[style];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i) + H / 2;
    let d = 0, k = 0;
    if (style === 'rock') {
      const n = fbm(x * 0.09, y * 0.09, 3, 5);
      const r = fbm(x * 0.25, y * 0.25, 8, 3);
      d = n * depth * 1.1 + Math.max(0, r - 0.55) * 1.6;
      k = Math.floor(clamp(fbm(x * 0.15, y * 0.15, 17, 3) * pal.length * 1.4 - 0.2, 0, pal.length - 1));
    } else if (style === 'sandstone') {
      const n = fbm(x * 0.08, y * 0.12, 5, 4);
      const layer = y / 2.6 + n * 1.4;
      const f = layer - Math.floor(layer);
      d = n * depth * 0.6 + (f < 0.35 ? 0.55 : 0) + Math.max(0, fbm(x * 0.05, y * 0.3, 2, 3) - 0.5) * 2;
      k = Math.floor(layer) % pal.length;
      if (k < 0) k += pal.length;
    } else if (style === 'cork') {
      const n = fbm(x * 0.1, y * 0.04, 4, 4);
      d = Math.abs(Math.sin(x * 1.1 + n * 6)) * 0.55 + n * depth * 0.9;
      k = Math.floor(clamp(fbm(x * 0.3, y * 0.08, 6, 3) * pal.length * 1.3 - 0.1, 0, pal.length - 1));
    }
    pos.setZ(i, d);
    c.set(pal[k]);
    const shade = 0.88 + fbm(x * 0.6, y * 0.6, 11, 2) * 0.24;
    cols[i * 3] = c.r * shade; cols[i * 3 + 1] = c.g * shade; cols[i * 3 + 2] = c.b * shade;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const flat = geo.toNonIndexed();
  flat.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: style !== 'cork' });
  const m = new THREE.Mesh(flat, mat);
  m.receiveShadow = true;
  m.castShadow = true;
  m.userData.background = true;
  void rnd;
  return m;
}

export function buildTank({ L, W, H, style, background }) {
  const g = new THREE.Group();
  const glass = [];
  const isPVC = style === 'pvc' || style === 'pvcWhite';
  const pvcColor = style === 'pvcWhite' ? '#f1f1ee' : '#1f2023';
  const pvcMat = new THREE.MeshStandardMaterial({ color: pvcColor, roughness: 0.55 });
  const t = 0.35; // frame bar thickness

  // glass floor
  const floor = box(L, 0.12, W, 0, -0.06, 0, new THREE.MeshStandardMaterial({ color: '#2a2f2f', roughness: 0.4 }));
  g.add(floor);

  if (!isPVC) {
    // bottom and top frame rings
    const ring = (y, h) => {
      g.add(box(L + t, h, t, 0, y, W / 2));
      g.add(box(L + t, h, t, 0, y, -W / 2));
      g.add(box(t, h, W + t, -L / 2, y, 0));
      g.add(box(t, h, W + t, L / 2, y, 0));
    };
    ring(0.2, 1.2);
    ring(H - 0.2, 0.6);
    for (const x of [-L / 2, L / 2]) for (const z of [-W / 2, W / 2]) g.add(box(t, H, t, x, H / 2, z));
    // panes
    glass.push(pane(L, H, 0, H / 2, -W / 2, 0));
    glass.push(pane(W, H, -L / 2, H / 2, 0, Math.PI / 2));
    glass.push(pane(W, H, L / 2, H / 2, 0, Math.PI / 2));
    if (style === 'glass') {
      // two front doors with a centre post, top vent band and handles
      const band = 1.6;
      g.add(box(L + t, band, t, 0, H - band / 2, W / 2));
      const vent = new THREE.Mesh(new THREE.PlaneGeometry(L - 2, band - 0.6), new THREE.MeshStandardMaterial({ map: screenTexture(false), transparent: true, alphaTest: 0.4, color: '#555' }));
      vent.material.map = vent.material.map.clone();
      vent.material.map.repeat.set((L - 2) / 0.5, (band - 0.6) / 0.5);
      vent.material.map.needsUpdate = true;
      vent.position.set(0, H - band / 2, W / 2 + t / 2 + 0.01);
      g.add(vent);
      const dh = H - band - 0.75;
      g.add(box(0.3, dh, t * 0.9, 0, 0.75 + dh / 2, W / 2));
      glass.push(pane(L / 2 - 0.2, dh, -L / 4, 0.75 + dh / 2, W / 2, 0));
      glass.push(pane(L / 2 - 0.2, dh, L / 4, 0.75 + dh / 2, W / 2, 0));
      for (const sx of [-1, 1]) g.add(box(0.5, 0.9, 0.25, sx * 0.75, 0.75 + dh * 0.5, W / 2 + 0.28, handleMat));
    } else {
      glass.push(pane(L, H, 0, H / 2, W / 2, 0));
    }
  } else {
    // PVC: opaque back & sides, sliding glass front
    g.add(box(L + 0.6, H + 0.6, 0.5, 0, H / 2, -W / 2 - 0.25, pvcMat));
    g.add(box(0.5, H + 0.6, W + 0.6, -L / 2 - 0.25, H / 2, 0, pvcMat));
    g.add(box(0.5, H + 0.6, W + 0.6, L / 2 + 0.25, H / 2, 0, pvcMat));
    g.add(box(L + 1.2, 1.4, 0.6, 0, 0.4, W / 2 + 0.2, pvcMat));
    g.add(box(L + 1.2, 1.4, 0.6, 0, H - 0.4, W / 2 + 0.2, pvcMat));
    g.add(box(L + 1.2, 0.5, W + 1.2, 0, -0.25, 0, pvcMat));
    const ph = H - 2.2;
    glass.push(pane(L * 0.53, ph, -L * 0.235, H / 2, W / 2 + 0.05, 0));
    glass.push(pane(L * 0.53, ph, L * 0.235, H / 2, W / 2 + 0.35, 0));
    for (const s of [-1, 1]) g.add(box(0.25, 2.2, 0.3, s * L * 0.42, H / 2, W / 2 + 0.55 + (s > 0 ? 0.3 : 0), handleMat));
  }
  glass.forEach((p) => g.add(p));

  // screen lid
  const scr = screenTexture(true).clone();
  scr.repeat.set(L / 0.45, W / 0.45);
  scr.needsUpdate = true;
  const lid = new THREE.Mesh(
    new THREE.PlaneGeometry(L, W),
    new THREE.MeshStandardMaterial({ map: scr, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, color: '#3a3a3a', roughness: 0.6 })
  );
  lid.rotation.x = -Math.PI / 2;
  lid.position.y = H + 0.02;
  lid.userData.lid = true;
  g.add(lid);
  if (!isPVC) {
    // lid frame
    g.add(box(L + t, 0.3, 0.6, 0, H + 0.12, W / 2 - 0.2));
    g.add(box(L + t, 0.3, 0.6, 0, H + 0.12, -W / 2 + 0.2));
    g.add(box(0.6, 0.3, W + t, -L / 2 + 0.2, H + 0.12, 0));
    g.add(box(0.6, 0.3, W + t, L / 2 - 0.2, H + 0.12, 0));
    g.add(box(0.4, 0.25, W, 0, H + 0.1, 0));
  } else {
    g.add(box(L + 1.2, 0.5, 1.0, 0, H + 0.1, W / 2 - 0.2, pvcMat));
    g.add(box(L + 1.2, 0.5, 1.0, 0, H + 0.1, -W / 2 + 0.2, pvcMat));
  }

  // 3D background
  const bg = buildBackground(L, H, background);
  if (bg) {
    bg.position.set(0, H / 2, -W / 2 + 0.12);
    g.add(bg);
  }

  // wooden stand
  const standTop = box(L + 9, 1.6, W + 7, 0, (isPVC ? -0.5 : -0.4) - 0.8, 0, new THREE.MeshStandardMaterial({ map: woodTexture('plank'), roughness: 0.65 }));
  standTop.material.map = standTop.material.map.clone();
  standTop.material.map.rotation = Math.PI / 2;
  standTop.material.map.repeat.set(2, 3);
  standTop.material.map.needsUpdate = true;
  standTop.castShadow = false;
  g.add(standTop);
  const cabMat = new THREE.MeshStandardMaterial({ color: '#4a3526', roughness: 0.75 });
  const cabH = 26;
  const cab = box(L + 7, cabH, W + 5, 0, standTop.position.y - 0.8 - cabH / 2, 0, cabMat);
  cab.castShadow = false;
  g.add(cab);
  // cabinet door seams + knobs
  const seamMat = new THREE.MeshStandardMaterial({ color: '#2c1f15', roughness: 0.8 });
  const doors = Math.max(2, Math.round((L + 7) / 22));
  for (let i = 1; i < doors; i++) {
    const x = -(L + 7) / 2 + (i * (L + 7)) / doors;
    g.add(box(0.2, cabH - 2, 0.1, x, cab.position.y, (W + 5) / 2 + 0.03, seamMat));
  }
  for (let i = 0; i < doors; i++) {
    const x = -(L + 7) / 2 + ((i + 0.5) * (L + 7)) / doors + (i % 2 ? -1 : 1) * ((L + 7) / doors) * 0.35;
    const k = new THREE.Mesh(new THREE.SphereGeometry(0.35, 16, 10), handleMat);
    k.position.set(x, cab.position.y + cabH * 0.3, (W + 5) / 2 + 0.25);
    g.add(k);
  }
  g.add(box(L + 6.6, 0.15, 0.1, 0, cab.position.y + cabH / 2 - 1, (W + 5) / 2 + 0.03, seamMat));

  const bgDepth = bgDepthFor(background);
  const walls = {
    front: { normal: new THREE.Vector3(0, 0, -1), coord: W / 2 - 0.3, axis: 'x', span: L / 2 - 0.8 },
    back: { normal: new THREE.Vector3(0, 0, 1), coord: -W / 2 + Math.max(0.3, bgDepth + 0.25), axis: 'x', span: L / 2 - 0.8 },
    left: { normal: new THREE.Vector3(1, 0, 0), coord: -L / 2 + 0.3, axis: 'z', span: W / 2 - 0.8 },
    right: { normal: new THREE.Vector3(-1, 0, 0), coord: L / 2 - 0.3, axis: 'z', span: W / 2 - 0.8 },
  };

  return { group: g, glass, background: bg, walls, standTopY: standTop.position.y + 0.8, lid, bgDepth };
}

export { glassMat };
