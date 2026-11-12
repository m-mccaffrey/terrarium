// Sculptable substrate heightfield inside the tank, with a visible soil cross-section.
import * as THREE from 'three';
import { clamp, lerp, fbm, mulberry32 } from './util.js';
import { substrateTexture, lecaTexture } from './textures.js';
import { SUBSTRATES } from './data.js';

export const NX = 64, NZ = 32;
export const emptyHeights = () => new Array((NX + 1) * (NZ + 1)).fill(0);

export function generateTerrain(style, seed = 7) {
  const h = emptyHeights();
  const rnd = mulberry32(seed);
  const s2 = Math.floor(rnd() * 1000);
  for (let j = 0; j <= NZ; j++) {
    for (let i = 0; i <= NX; i++) {
      const u = i / NX, v = j / NZ; // v = 0 is the back
      let y = 0;
      const n = fbm(u * 3, v * 1.5, s2, 4);
      if (style === 'hills') y = (n - 0.45) * 4 + (1 - v) * 1.6;
      else if (style === 'dunes') y = Math.sin(u * 7 + n * 4) * 0.7 + (n - 0.45) * 3 + (1 - v) * 1.4;
      else if (style === 'slope') y = (1 - v) * 3.2 + (n - 0.5) * 0.8;
      else if (style === 'valley') y = Math.pow(Math.abs(u - 0.5) * 2, 1.5) * 3.5 + (n - 0.5) * 1.2 + (1 - v) * 0.8;
      // keep the front edge low and tidy
      y *= 0.35 + 0.65 * (1 - Math.pow(v, 3));
      h[j * (NX + 1) + i] = Math.max(-1.5, y);
    }
  }
  return h;
}

export class Terrain {
  constructor() {
    this.group = new THREE.Group();
    this.heights = new Float32Array((NX + 1) * (NZ + 1));
    this.L = 36; this.W = 18; this.depth = 3; this.base = 3; this.drainage = 0; this.maxH = 18;
    this.substrate = 'aridBio';
    this.thermal = false;

    this.geo = new THREE.BufferGeometry();
    const count = (NX + 1) * (NZ + 1);
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    this.geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3).fill(1), 3));
    const idx = [];
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
      const a = j * (NX + 1) + i, b = a + 1, c = a + NX + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    this.geo.setIndex(idx);
    this.material = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
    this.thermalMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = true;
    this.mesh.name = 'terrain';
    this.group.add(this.mesh);

    // Skirt (cross-section) around the four edges.
    const skirtCount = 2 * (NX + 1) * 2 + 2 * (NZ + 1) * 2;
    this.skirtGeo = new THREE.BufferGeometry();
    this.skirtGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(skirtCount * 3), 3));
    this.skirtGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(skirtCount * 2), 2));
    this.skirtGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(skirtCount * 3).fill(1), 3));
    const sidx = [];
    let off = 0;
    const strip = (n, flip) => {
      for (let i = 0; i < n - 1; i++) {
        const a = off + i * 2, b = a + 1, c = a + 2, d = a + 3;
        if (flip) sidx.push(a, c, b, b, c, d);
        else sidx.push(a, b, c, b, d, c);
      }
      off += n * 2;
    };
    strip(NX + 1, false); // front
    strip(NX + 1, true); // back
    strip(NZ + 1, false); // left
    strip(NZ + 1, true); // right
    this.skirtGeo.setIndex(sidx);
    this.skirtMaterial = new THREE.MeshStandardMaterial({ roughness: 1, color: '#bbbbbb', side: THREE.DoubleSide });
    this.skirt = new THREE.Mesh(this.skirtGeo, this.skirtMaterial);
    this.skirt.receiveShadow = true;
    this.group.add(this.skirt);

    // Drainage layer (for bioactive)
    this.drainMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ map: lecaTexture(), roughness: 0.9 }));
    this.drainMesh.receiveShadow = true;
    this.group.add(this.drainMesh);
    this.barrier = new THREE.Mesh(new THREE.BoxGeometry(1, 0.08, 1), new THREE.MeshStandardMaterial({ color: '#2b2b2b', roughness: 0.8 }));
    this.group.add(this.barrier);
  }

  setHeights(arr) {
    for (let i = 0; i < this.heights.length; i++) this.heights[i] = arr && arr[i] != null ? arr[i] : 0;
    this.updateGeometry();
  }

  configure({ L, W, H, depth, substrate }) {
    this.L = L; this.W = W; this.maxH = H; this.depth = depth;
    this.substrate = substrate;
    const sub = SUBSTRATES[substrate];
    this.drainage = sub.bioactive ? 1.5 : 0;
    this.base = this.drainage + depth;
    const tex = substrateTexture(substrate, sub);
    this.material.map = tex;
    this.material.roughness = sub.roughness;
    this.material.color.set('#ffffff');
    this.material.needsUpdate = true;
    this.skirtMaterial.map = tex;
    this.skirtMaterial.color.set('#9a9a9a');
    this.skirtMaterial.needsUpdate = true;
    this.drainMesh.visible = this.drainage > 0;
    this.barrier.visible = this.drainage > 0;
    const inset = 0.06;
    this.drainMesh.scale.set(L - inset * 2, this.drainage, W - inset * 2);
    this.drainMesh.position.set(0, this.drainage / 2, 0);
    this.drainMesh.material.map.repeat.set(L / 8, this.drainage / 8);
    this.barrier.scale.set(L - inset * 2, 1, W - inset * 2);
    this.barrier.position.set(0, this.drainage, 0);
    this.updateGeometry();
  }

  // world-space surface height
  idx(i, j) { return j * (NX + 1) + i; }
  surfaceAtIJ(i, j) {
    return clamp(this.base + this.heights[this.idx(i, j)], this.drainage + 0.25, this.maxH * 0.7);
  }
  heightAt(x, z) {
    const u = clamp((x / this.L + 0.5) * NX, 0, NX);
    const v = clamp((z / this.W + 0.5) * NZ, 0, NZ);
    const i0 = Math.min(Math.floor(u), NX - 1), j0 = Math.min(Math.floor(v), NZ - 1);
    const fu = u - i0, fv = v - j0;
    const a = this.surfaceAtIJ(i0, j0), b = this.surfaceAtIJ(i0 + 1, j0);
    const c = this.surfaceAtIJ(i0, j0 + 1), d = this.surfaceAtIJ(i0 + 1, j0 + 1);
    return lerp(lerp(a, b, fu), lerp(c, d, fu), fv);
  }

  updateGeometry() {
    const { L, W } = this;
    const inset = 0.06;
    const pos = this.geo.attributes.position, uv = this.geo.attributes.uv;
    for (let j = 0; j <= NZ; j++) {
      for (let i = 0; i <= NX; i++) {
        const k = this.idx(i, j);
        const x = (i / NX - 0.5) * (L - inset * 2);
        const z = (j / NZ - 0.5) * (W - inset * 2);
        pos.setXYZ(k, x, this.surfaceAtIJ(i, j), z);
        uv.setXY(k, x / 12, z / 12);
      }
    }
    pos.needsUpdate = true;
    uv.needsUpdate = true;
    this.geo.computeVertexNormals();
    this.geo.computeBoundingSphere();
    this.geo.computeBoundingBox();

    // skirt
    const sp = this.skirtGeo.attributes.position, su = this.skirtGeo.attributes.uv;
    let o = 0;
    const bottom = this.drainage;
    const put = (x, y, z, along) => {
      sp.setXYZ(o, x, y, z);
      su.setXY(o, along / 12, y / 12);
      o++;
    };
    const zf = W / 2 - inset, zb = -W / 2 + inset, xl = -L / 2 + inset, xr = L / 2 - inset;
    for (let i = 0; i <= NX; i++) { const x = (i / NX - 0.5) * (L - inset * 2); put(x, this.surfaceAtIJ(i, NZ), zf, x); put(x, bottom, zf, x); }
    for (let i = 0; i <= NX; i++) { const x = (i / NX - 0.5) * (L - inset * 2); put(x, this.surfaceAtIJ(i, 0), zb, x); put(x, bottom, zb, x); }
    for (let j = 0; j <= NZ; j++) { const z = (j / NZ - 0.5) * (W - inset * 2); put(xl, this.surfaceAtIJ(0, j), z, z); put(xl, bottom, z, z); }
    for (let j = 0; j <= NZ; j++) { const z = (j / NZ - 0.5) * (W - inset * 2); put(xr, this.surfaceAtIJ(NX, j), z, z); put(xr, bottom, z, z); }
    sp.needsUpdate = true;
    su.needsUpdate = true;
    this.skirtGeo.computeVertexNormals();
    this.skirtGeo.computeBoundingSphere();
  }

  // Brush: mode raise | lower | smooth | flatten. Returns true if anything changed.
  sculpt(x, z, mode, radius, strength, dt, flattenTo) {
    const { L, W } = this;
    let changed = false;
    const copy = mode === 'smooth' ? Float32Array.from(this.heights) : null;
    for (let j = 0; j <= NZ; j++) {
      for (let i = 0; i <= NX; i++) {
        const px = (i / NX - 0.5) * L, pz = (j / NZ - 0.5) * W;
        const d = Math.hypot(px - x, pz - z);
        if (d > radius) continue;
        const f = Math.pow(1 - d / radius, 2) * (3 - 2 * (1 - d / radius)) * strength * dt;
        const k = this.idx(i, j);
        let h = this.heights[k];
        if (mode === 'raise') h += f * 6;
        else if (mode === 'lower') h -= f * 6;
        else if (mode === 'flatten') h = lerp(h, flattenTo, clamp(f * 4, 0, 1));
        else if (mode === 'smooth') {
          let sum = 0, n = 0;
          for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
            const ii = i + di, jj = j + dj;
            if (ii < 0 || jj < 0 || ii > NX || jj > NZ) continue;
            sum += copy[this.idx(ii, jj)]; n++;
          }
          h = lerp(h, sum / n, clamp(f * 5, 0, 1));
        }
        h = clamp(h, -(this.depth - 0.3), this.maxH * 0.6 - this.base);
        if (h !== this.heights[k]) { this.heights[k] = h; changed = true; }
      }
    }
    if (changed) this.updateGeometry();
    return changed;
  }

  heightsArray() {
    return Array.from(this.heights, (v) => Math.round(v * 100) / 100);
  }

  // average substrate depth (for the shopping list)
  averageDepth() {
    let s = 0;
    for (let j = 0; j <= NZ; j++) for (let i = 0; i <= NX; i++) s += this.surfaceAtIJ(i, j) - this.drainage;
    return s / ((NX + 1) * (NZ + 1));
  }

  setThermal(fnTemp, colorFn) {
    if (!fnTemp) {
      this.mesh.material = this.material;
      this.skirt.material = this.skirtMaterial;
      this.thermal = false;
      return;
    }
    this.thermal = true;
    const pos = this.geo.attributes.position, col = this.geo.attributes.color;
    const c = [0, 0, 0];
    for (let k = 0; k < pos.count; k++) {
      colorFn(fnTemp(pos.getX(k), pos.getY(k), pos.getZ(k)), c);
      col.setXYZ(k, c[0], c[1], c[2]);
    }
    col.needsUpdate = true;
    const sp = this.skirtGeo.attributes.position, sc = this.skirtGeo.attributes.color;
    for (let k = 0; k < sp.count; k++) {
      colorFn(fnTemp(sp.getX(k), sp.getY(k), sp.getZ(k)) - 2, c);
      sc.setXYZ(k, c[0], c[1], c[2]);
    }
    sc.needsUpdate = true;
    this.mesh.material = this.thermalMaterial;
    this.skirt.material = this.thermalMaterial;
  }
}
