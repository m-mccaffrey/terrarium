// A still, life-size model of the chosen animal. It is shown in the tank as a
// size reference so you can check that hides, branches and dishes fit.
import * as THREE from 'three';
import { SPECIES } from './data.js';
import { skinTexture, eyeTexture } from './textures.js';
import { clamp, lerp } from './util.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const RINGS = 34, RADIAL = 14;

function cylBetween(mesh, a, b, r) {
  const d = V().subVectors(b, a);
  const len = d.length();
  mesh.position.copy(a).addScaledVector(d, 0.5);
  mesh.scale.set(r, len, r);
  if (len > 1e-5) mesh.quaternion.setFromUnitVectors(UP, d.multiplyScalar(1 / len));
}

export class AnimalModel {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'animal';
    this.root = new THREE.Group();
    this.group.add(this.root);
    this.thermalColor = null;
  }

  setSpecies(id) {
    this.speciesId = id;
    this.sp = SPECIES[id];
    this.morph = this.sp.morphs[0];
    this.build();
    this.pose();
  }

  build() {
    this.root.clear();
    const m = this.sp.model;
    this.m = m;
    const total = m.body + m.tail;
    this.bodyFrac = m.body / total;
    this.total = total;
    this.scaleLen = m.body; // used for speeds & steps
    this.maxStep = Math.max(1.2, m.height * 1.6);

    // ---- body + tail tube (deformed every frame) ----
    const count = (RINGS + 1) * (RADIAL + 1);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    const uv = new Float32Array(count * 2);
    const idx = [];
    for (let i = 0; i <= RINGS; i++) {
      for (let j = 0; j <= RADIAL; j++) {
        uv[(i * (RADIAL + 1) + j) * 2] = j / RADIAL;
        uv[(i * (RADIAL + 1) + j) * 2 + 1] = 1 - i / RINGS;
      }
    }
    for (let i = 0; i < RINGS; i++) for (let j = 0; j < RADIAL; j++) {
      const a = i * (RADIAL + 1) + j, b = a + RADIAL + 1;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    const tex = skinTexture(this.morph, m, this.bodyFrac);
    this.skinMat = new THREE.MeshStandardMaterial({ map: tex, roughness: m.smooth ? 0.35 : 0.62, metalness: 0 });
    this.bodyMesh = new THREE.Mesh(geo, this.skinMat);
    this.bodyMesh.castShadow = true;
    this.bodyMesh.frustumCulled = false;
    this.root.add(this.bodyMesh);

    // radius profile along s (0 = neck, 1 = tail tip)
    const bf = this.bodyFrac;
    const W = m.width / 2, tf = m.tailFat / 2;
    this.radiusAt = (s) => {
      if (s <= bf) {
        const t = s / bf;
        // neck → chest → belly → hips
        const r = t < 0.12 ? lerp(0.62, 0.86, t / 0.12) : t < 0.6 ? lerp(0.86, 1.0, (t - 0.12) / 0.48) : lerp(1.0, 0.8, (t - 0.6) / 0.4);
        return W * r;
      }
      const t = (s - bf) / (1 - bf);
      // fat tails swell before tapering
      const swell = tf > W * 0.5 ? Math.sin(Math.PI * Math.min(1, t * 1.6)) * 0.25 : 0;
      const base = lerp(W * 0.8, tf, Math.min(1, t * 4));
      return Math.max(0.03, base * (1 + swell) * Math.pow(1 - t, 0.9));
    };
    this.hf = m.height / m.width; // vertical squash of cross-section

    // ---- head ----
    this.head = new THREE.Group();
    const hl = m.head * 1.25, hw = m.head * 0.95, hh = m.head * 0.62;
    const skull = new THREE.SphereGeometry(1, 24, 16);
    const sp = skull.attributes.position;
    for (let i = 0; i < sp.count; i++) {
      let x = sp.getX(i), y = sp.getY(i), z = sp.getZ(i);
      // taper the snout (+z) and flatten the jaw
      const front = Math.max(0, z);
      x *= 1 - front * 0.38;
      y *= (y < 0 ? 0.7 : 1) * (1 - front * 0.3);
      sp.setXYZ(i, x * hw / 2, y * hh / 2 + (y < 0 ? 0 : 0.0), z * hl / 2);
    }
    skull.computeVertexNormals();
    const headMat = new THREE.MeshStandardMaterial({ color: this.morph.base, roughness: 0.6 });
    this.headMat = headMat;
    const headMesh = new THREE.Mesh(skull, headMat);
    headMesh.castShadow = true;
    headMesh.position.z = hl * 0.38;
    this.head.add(headMesh);
    // belly-coloured jaw underside
    const jaw = new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    jaw.scale(hw * 0.42, hh * 0.32, hl * 0.42);
    const jawMesh = new THREE.Mesh(jaw, new THREE.MeshStandardMaterial({ color: this.morph.belly, roughness: 0.7 }));
    jawMesh.position.set(0, -hh * 0.04, hl * 0.4);
    this.head.add(jawMesh);
    this.headLen = hl;
    // smile line
    const mouth = new THREE.TorusGeometry(hw * 0.38, 0.018 * m.head, 4, 20, Math.PI);
    mouth.rotateX(Math.PI / 2);
    mouth.scale(1, 1, hl / hw * 1.15);
    const mouthMesh = new THREE.Mesh(mouth, new THREE.MeshBasicMaterial({ color: '#3a2a20' }));
    mouthMesh.position.set(0, -hh * 0.08, hl * 0.36);
    this.head.add(mouthMesh);

    // eyes
    const eyeR = m.head * (this.sp.lifestyle === 'arboreal' ? 0.19 : 0.17) * (m.body > 8 ? 0.7 : 1);
    const iris = this.morph.eye || '#4a3a28';
    const eyeMat = new THREE.MeshPhysicalMaterial({ map: eyeTexture(iris, m.pupil), roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.03 });
    this.eyes = [];
    for (const s of [-1, 1]) {
      const eg = new THREE.Group();
      const e = new THREE.Mesh(new THREE.SphereGeometry(eyeR, 20, 14), eyeMat);
      e.rotation.y = s > 0 ? 0 : Math.PI; // texture centre faces outward (+x)
      eg.add(e);
      // lid ring
      const lid = new THREE.Mesh(new THREE.TorusGeometry(eyeR * 0.98, eyeR * 0.18, 6, 18), headMat);
      lid.rotation.y = Math.PI / 2;
      eg.add(lid);
      eg.position.set(s * hw * 0.36, hh * 0.16, hl * 0.46);
      eg.rotation.y = -s * 0.25;
      this.head.add(eg);
      this.eyes.push(eg);
    }
    // crests / horns
    if (m.crest) {
      const crestMat = new THREE.MeshStandardMaterial({ color: this.morph.spot, roughness: 0.6 });
      for (const s of [-1, 1]) {
        for (let k = 0; k < 7; k++) {
          const c = new THREE.Mesh(new THREE.ConeGeometry(0.05 * m.head, 0.18 * m.head, 5), crestMat);
          const a = (k / 6) * Math.PI * 0.9;
          c.position.set(s * (hw * 0.36 + Math.sin(a) * eyeR * 0.6), hh * 0.18 + Math.cos(a) * eyeR * 1.1, hl * 0.46 - (k / 6 - 0.5) * eyeR * 1.6);
          c.rotation.z = -s * (0.6 + a * 0.3);
          this.head.add(c);
        }
        for (let k = 0; k < 6; k++) {
          const c = new THREE.Mesh(new THREE.ConeGeometry(0.045 * m.head, 0.14 * m.head, 5), crestMat);
          c.position.set(s * hw * 0.42, hh * 0.2, hl * 0.1 - k * 0.09 * hl);
          c.rotation.z = -s * 0.9;
          this.head.add(c);
        }
      }
    }
    if (m.horns) {
      for (const s of [-1, 1]) {
        const c = new THREE.Mesh(new THREE.ConeGeometry(0.08 * m.head, 0.2 * m.head, 6), headMat);
        c.position.set(s * hw * 0.3, hh * 0.4, hl * 0.05);
        c.rotation.z = -s * 0.5;
        this.head.add(c);
      }
    }
    if (m.spikes) {
      // bearded dragon beard + head spikes
      const spikeMat = new THREE.MeshStandardMaterial({ color: this.morph.spot, roughness: 0.7 });
      for (let k = 0; k < 14; k++) {
        const a = (k / 13) * Math.PI;
        const c = new THREE.Mesh(new THREE.ConeGeometry(0.06 * m.head, 0.28 * m.head, 5), spikeMat);
        c.position.set(Math.cos(a) * hw * 0.45, -hh * 0.25 - Math.sin(a) * hh * 0.08, hl * 0.12 + Math.sin(a) * hl * 0.12);
        c.rotation.z = Math.PI / 2 + Math.cos(a) * 0.5 + (Math.cos(a) > 0 ? -0.4 : 0.4);
        c.rotation.x = Math.sin(a) * 0.8;
        this.head.add(c);
      }
      for (const s of [-1, 1]) for (let k = 0; k < 4; k++) {
        const c = new THREE.Mesh(new THREE.ConeGeometry(0.05 * m.head, 0.2 * m.head, 5), spikeMat);
        c.position.set(s * hw * 0.42, hh * 0.05, hl * (0.05 - k * 0.1));
        c.rotation.z = -s * 1.2;
        this.head.add(c);
      }
    }
    // tongue
    const tongueMat = new THREE.MeshStandardMaterial({ color: m.tongue || '#e46a7c', roughness: 0.4 });
    this.tongueMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.05 * m.head, 0.25 * m.head, 4, 8), tongueMat);
    this.tongueMesh.rotation.x = Math.PI / 2;
    this.tongueMesh.position.set(0, -hh * 0.1, hl * 0.82);
    this.tongueMesh.visible = false;
    this.head.add(this.tongueMesh);
    this.root.add(this.head);

    // ---- legs ----
    const legMat = new THREE.MeshStandardMaterial({ color: this.morph.base, roughness: 0.65 });
    const footMat = new THREE.MeshStandardMaterial({ color: this.morph.belly, roughness: 0.7 });
    const legR = Math.max(0.09, m.width * 0.11);
    this.legR = legR;
    this.legs = [];
    const unitCyl = new THREE.CylinderGeometry(1, 1, 1, 8);
    const joint = new THREE.SphereGeometry(1, 10, 8);
    const defs = [
      { side: 1, s: 0.08 * bf, front: true, phase: 0 },
      { side: -1, s: 0.08 * bf, front: true, phase: Math.PI },
      { side: 1, s: 0.92 * bf, front: false, phase: Math.PI },
      { side: -1, s: 0.92 * bf, front: false, phase: 0 },
    ];
    for (const d of defs) {
      const upper = new THREE.Mesh(unitCyl, legMat);
      const lower = new THREE.Mesh(unitCyl, legMat);
      const knee = new THREE.Mesh(joint, legMat);
      knee.scale.setScalar(legR * 1.05);
      const foot = new THREE.Group();
      const palm = new THREE.Mesh(joint, footMat);
      palm.scale.set(legR * 1.4, legR * 0.5, legR * 1.4);
      foot.add(palm);
      // toes
      for (let k = 0; k < 5; k++) {
        const a = (k / 4 - 0.5) * 2.2;
        const tl = m.leg * (m.toes === 'thin' ? 0.32 : 0.26);
        const toe = new THREE.Mesh(unitCyl, footMat);
        const dir = V(Math.sin(a) * d.side, 0, Math.cos(a) * (d.front ? 1 : 0.6) + (d.front ? 0 : -0.2)).normalize();
        cylBetween(toe, V(0, 0.01, 0), dir.clone().multiplyScalar(tl), legR * 0.32);
        foot.add(toe);
        if (m.toes === 'pads') {
          const pad = new THREE.Mesh(joint, footMat);
          pad.scale.set(legR * 0.55, legR * 0.3, legR * 0.6);
          pad.position.copy(dir.clone().multiplyScalar(tl));
          foot.add(pad);
        }
      }
      for (const o of [upper, lower, knee, palm]) o.castShadow = true;
      this.root.add(upper, lower, knee, foot);
      this.legs.push({ ...d, upper, lower, knee, foot, lift: 0 });
    }

    // dorsal / flank spikes for beardies; bumps for others
    this.attach = [];
    if (m.spikes || m.bumps || m.crest) {
      const n = m.spikes ? 40 : m.crest ? 26 : 24;
      const cone = new THREE.ConeGeometry(1, 1, 5);
      const mat = new THREE.MeshStandardMaterial({ color: m.spikes ? this.morph.band : this.morph.spot, roughness: 0.7 });
      this.attachMesh = new THREE.InstancedMesh(cone, mat, n);
      this.attachMesh.castShadow = true;
      this.attachMesh.frustumCulled = false;
      for (let i = 0; i < n; i++) {
        const side = i % 2 ? 1 : -1;
        const k = Math.floor(i / 2) / (n / 2);
        const s = m.spikes ? 0.1 * bf + k * bf * 0.85 : m.crest ? 0.02 + k * bf * 0.95 : 0.05 + k * bf * 0.9;
        const ang = m.spikes ? side * 1.15 : m.crest ? side * 0.75 : side * (0.4 + (i % 3) * 0.25);
        const size = m.spikes ? m.width * 0.12 : m.crest ? m.width * 0.08 : m.width * 0.05;
        this.attach.push({ s, ang, size, h: m.spikes ? 1.6 : m.crest ? 1.4 : 0.6 });
      }
      this.root.add(this.attachMesh);
    }
    this.spine = [];
    for (let i = 0; i <= RINGS; i++) this.spine.push({ p: V(), t: V(), n: V(), b: V() });
    this.applyThermalColor();
  }

  // --------- placement + world helpers ---------

  setThermal(color) {
    this.thermalColor = color;
    this.applyThermalColor();
  }

  applyThermalColor() {
    if (!this.skinMat) return;
    const mats = [];
    this.root.traverse((o) => { if (o.material && (o.userData.origMat || !o.material.isMeshBasicMaterial)) mats.push(o); });
    for (const o of mats) {
      if (!o.userData.origMat) o.userData.origMat = o.material;
      if (this.thermalColor) {
        if (!o.userData.thermMat) o.userData.thermMat = new THREE.MeshBasicMaterial({ color: '#fff' });
        o.userData.thermMat.color.setRGB(this.thermalColor[0], this.thermalColor[1], this.thermalColor[2]);
        o.material = o.userData.thermMat;
      } else {
        o.material = o.userData.origMat;
      }
    }
  }

  // Overall length (nose to tail tip) in inches.
  get length() {
    return this.m.body + this.m.tail + this.m.head * 0.9;
  }

  // Natural resting pose: gentle S-curve, legs planted, tail curled to one side.
  pose() {
    const m = this.m;
    const L = this.total;
    const bf = this.bodyFrac;
    const neckZ = m.body * 0.5;
    const bodyY = m.height * 0.5 + this.legR * 1.6;
    for (let i = 0; i <= RINGS; i++) {
      const s = i / RINGS;
      const z = neckZ - s * L;
      let x = Math.sin(s * 3.2) * 0.06 * m.body;
      let y = bodyY;
      if (s > bf) {
        const tt = (s - bf) / (1 - bf);
        x += tt * tt * 0.35 * m.tail;
        y = lerp(bodyY, this.radiusAt(s) * this.hf + 0.02, Math.min(1, tt * 2.2));
      }
      this.spine[i].p.set(x, y, z);
    }
    for (let i = 0; i <= RINGS; i++) {
      const a = this.spine[Math.max(0, i - 1)].p, b = this.spine[Math.min(RINGS, i + 1)].p;
      const f = this.spine[i];
      f.t.subVectors(a, b).normalize();
      f.b.crossVectors(UP, f.t).normalize();
      f.n.crossVectors(f.t, f.b).normalize();
    }
    const pos = this.bodyMesh.geometry.attributes.position;
    for (let i = 0; i <= RINGS; i++) {
      const f = this.spine[i];
      let r = this.radiusAt(i / RINGS);
      if (i === 0) r *= 0.95;
      for (let j = 0; j <= RADIAL; j++) {
        // u = 0.25 is the top of the back, 0.75 the belly
        const a = (j / RADIAL - 0.25) * Math.PI * 2;
        const cx = Math.sin(a) * r;
        let cy = Math.cos(a) * r * this.hf;
        if (cy < 0) cy *= 0.75;
        pos.setXYZ(i * (RADIAL + 1) + j, f.p.x + f.b.x * cx + f.n.x * cy, f.p.y + f.b.y * cx + f.n.y * cy, f.p.z + f.b.z * cx + f.n.z * cy);
      }
    }
    pos.needsUpdate = true;
    this.bodyMesh.geometry.computeVertexNormals();
    this.bodyMesh.geometry.computeBoundingSphere();

    const neck = this.spine[0];
    this.head.position.copy(neck.p).addScaledVector(neck.t, this.headLen * 0.05);
    this.head.position.y += m.height * 0.05;
    this.head.rotation.set(-0.08, Math.atan2(neck.t.x, neck.t.z) + 0.15, 0, 'YXZ');
    this.tongueMesh.visible = false;

    const sideOff = m.width * 0.5;
    const legLen = m.leg;
    for (const leg of this.legs) {
      const f = this.spine[Math.round(leg.s * RINGS)];
      const shoulder = V().copy(f.p).addScaledVector(f.b, leg.side * sideOff * 0.75).addScaledVector(f.n, -m.height * 0.12);
      const foot = V().copy(f.p).addScaledVector(f.b, leg.side * (sideOff + legLen * 0.75));
      foot.z += leg.front ? legLen * 0.35 : -legLen * 0.2;
      foot.y = 0.02;
      const knee = V().lerpVectors(shoulder, foot, 0.5);
      knee.addScaledVector(f.b, leg.side * legLen * 0.25);
      knee.y = Math.max(knee.y, shoulder.y + legLen * 0.12);
      cylBetween(leg.upper, shoulder, knee, this.legR);
      cylBetween(leg.lower, knee, foot, this.legR * 0.85);
      leg.knee.position.copy(knee);
      leg.foot.position.copy(foot);
      leg.foot.rotation.y = Math.atan2(f.t.x, f.t.z);
    }

    if (this.attachMesh) {
      const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = V(), p = V(), dir = V();
      this.attach.forEach((a, i) => {
        const f = this.spine[Math.round(a.s * RINGS)];
        const r = this.radiusAt(a.s);
        dir.copy(f.n).multiplyScalar(Math.cos(a.ang) * this.hf).addScaledVector(f.b, Math.sin(a.ang)).normalize();
        p.copy(f.p).addScaledVector(f.n, Math.cos(a.ang) * r * this.hf).addScaledVector(f.b, Math.sin(a.ang) * r);
        q.setFromUnitVectors(UP, dir);
        sc.set(a.size, a.size * a.h, a.size);
        p.addScaledVector(dir, a.size * a.h * 0.3);
        mtx.compose(p, q, sc);
        this.attachMesh.setMatrixAt(i, mtx);
      });
      this.attachMesh.instanceMatrix.needsUpdate = true;
    }
  }
}
