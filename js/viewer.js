// The 3D preview: renderer, camera, lights, tank, terrain, decor and the
// life-size animal model, plus picking, dragging, sculpting, heat view and
// on-screen dimension labels.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ITEMS } from './data.js';
import { buildItem, disposeItem, setLampGlow } from './models.js';
import { buildTank, glassMat } from './tank.js';
import { Terrain } from './terrain.js';
import { AnimalModel } from './animal.js';
import { makeClimate, humidityEstimate } from './climate.js';
import { clamp, gallons, thermalColor, fmtTemp, fmtLen } from './util.js';
import { glowTexture } from './textures.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const DOWN = V(0, -1, 0);
const BASES = new Set(['boulder', 'slateStack', 'rockCave', 'halfLog', 'corkTube', 'corkFlat', 'humidHide', 'cocoHut', 'column', 'chest', 'skull', 'mushroom']);
const WALL_ROT = { back: 0, left: Math.PI / 2, right: -Math.PI / 2, front: Math.PI };
const SPREADY = new Set(['pothos', 'fern', 'bromeliad', 'snakePlant', 'leafLitter', 'isopods', 'elephantBush', 'driftwood']);

export class Viewer {
  constructor(container, store, hooks = {}) {
    this.container = container;
    this.store = store;
    this.hooks = hooks;
    this.items = new Map();
    this.thermal = false;
    this.showDims = true;
    this.sculpt = { active: false, mode: 'raise', radius: 4, strength: 1 };
    this.selected = null;
    this.stats = null;

    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }));
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(r.domElement);
    r.domElement.setAttribute('aria-label', '3D terrarium preview');

    const scene = (this.scene = new THREE.Scene());
    const pmrem = new THREE.PMREMGenerator(r);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.55;
    this.dayBg = new THREE.Color('#e6ede2');
    this.thermBg = new THREE.Color('#05070f');
    scene.background = this.dayBg.clone();

    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 2000);
    this.camera.position.set(30, 30, 70);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.53;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 260;
    this.controls.addEventListener('start', () => { this.camAnim = null; this.userMovedCamera = true; });

    this.hemi = new THREE.HemisphereLight('#fff6e6', '#7c7362', 1.05);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#fff3df', 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    scene.add(this.sun, this.sun.target);
    this.fill = new THREE.DirectionalLight('#d4e6ff', 0.45);
    this.fill.position.set(60, 30, -20);
    scene.add(this.fill);

    this.floor = new THREE.Mesh(new THREE.CircleGeometry(400, 48), new THREE.MeshStandardMaterial({ color: '#cbbfa9', roughness: 0.95 }));
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = true;
    scene.add(this.floor);

    this.terrain = new Terrain();
    scene.add(this.terrain.group);
    this.itemsGroup = new THREE.Group();
    scene.add(this.itemsGroup);
    this.lampLights = new THREE.Group();
    scene.add(this.lampLights);
    this.animal = new AnimalModel();
    scene.add(this.animal.group);

    this.selBox = new THREE.Box3Helper(new THREE.Box3(), new THREE.Color('#2f8f5b'));
    this.selBox.material.depthTest = false;
    this.selBox.material.transparent = true;
    this.selBox.renderOrder = 20;
    this.selBox.visible = false;
    scene.add(this.selBox);

    this.brush = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 48), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, depthTest: false }));
    this.brush.rotation.x = -Math.PI / 2;
    this.brush.renderOrder = 30;
    this.brush.visible = false;
    scene.add(this.brush);

    this.thermalMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.raycaster = new THREE.Raycaster();
    this.ray = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.solidList = [];
    this.baseList = [];
    this.selectable = [];

    // overlay labels
    this.hover = document.createElement('div');
    this.hover.className = 'hover-temp';
    this.dimLabels = ['L', 'W', 'H'].map((k) => {
      const d = document.createElement('div');
      d.className = 'dim-label';
      d.dataset.axis = k;
      container.append(d);
      return d;
    });
    container.append(this.hover);

    this.bindEvents();
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ------------------------------------------------------------------ sync
  sync(state, meta = {}) {
    const { L, W, H, style, background } = state.tank;
    const tankKey = JSON.stringify([L, W, H, style, background]);
    let rebuiltTank = false;
    if (tankKey !== this.tankKey) {
      if (this.tank) {
        this.scene.remove(this.tank.group);
        this.tank.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      }
      this.tank = buildTank(state.tank);
      this.scene.add(this.tank.group);
      this.floor.position.y = this.tank.standTopY - 1.6 - 26;
      const dimsChanged = !this.dims || this.dims.L !== L || this.dims.W !== W || this.dims.H !== H;
      this.dims = { L, W, H };
      this.tankKey = tankKey;
      rebuiltTank = true;
      const span = Math.max(L, W, H) * 0.9 + 12;
      const sc = this.sun.shadow.camera;
      sc.left = -span; sc.right = span; sc.top = span; sc.bottom = -span;
      sc.near = 1; sc.far = 400;
      sc.updateProjectionMatrix();
      this.sun.position.set(-L * 0.6 - 20, H + 90, W + 50);
      this.sun.target.position.set(0, H * 0.3, 0);
      if (dimsChanged && !meta.source) this.resetCamera(!this.everFramed);
      this.everFramed = true;
    }
    const terrKey = JSON.stringify([L, W, H, state.depth, state.substrate]);
    if (terrKey !== this.terrKey || rebuiltTank) {
      this.terrain.configure({ L, W, H, depth: state.depth, substrate: state.substrate });
      this.terrKey = terrKey;
    }
    if (state.terrain !== this.lastTerrainRef || meta.full || meta.terrain) {
      this.terrain.setHeights(state.terrain);
      this.lastTerrainRef = state.terrain;
    }

    // items
    const seen = new Set();
    for (const it of state.items) {
      seen.add(it.id);
      const key = JSON.stringify(it);
      let rec = this.items.get(it.id);
      if (rec && (rec.type !== it.type || rec.seed !== it.seed)) {
        this.removeItem(it.id);
        rec = null;
      }
      if (!rec) {
        const group = buildItem(it.type, it.seed || 1);
        group.traverse((o) => { o.userData.itemId = it.id; });
        group.userData.itemId = it.id;
        this.itemsGroup.add(group);
        rec = { id: it.id, type: it.type, seed: it.seed, group, def: ITEMS[it.type] };
        this.items.set(it.id, rec);
      }
      rec.data = it;
      if (rec.key !== key || rebuiltTank) {
        rec.key = key;
        this.applyTransform(rec);
      }
    }
    for (const id of [...this.items.keys()]) if (!seen.has(id)) this.removeItem(id);
    if (this.selected && this.selected !== 'animal' && !this.items.has(this.selected)) this.select(null);

    this.rebuildLists();
    this.settleAll();

    // animal (size reference)
    if (state.species !== this.animalSpecies) {
      this.animal.setSpecies(state.species);
      this.animalSpecies = state.species;
      if (this.thermal) this.animal.setThermal([0.5, 0.5, 0.5]);
    }
    this.placeAnimal(state.animal);

    this.updateLamps();
    this.computeStats();
    if (this.thermal) this.refreshThermal();
    this.updateGauges();
  }

  removeItem(id) {
    const rec = this.items.get(id);
    if (!rec) return;
    this.itemsGroup.remove(rec.group);
    disposeItem(rec.group);
    this.items.delete(id);
  }

  // Keep a ground item's footprint inside the glass.
  clampGround(rec, x, z) {
    const { L, W } = this.dims;
    const g = rec.group;
    g.position.set(x, g.position.y, z);
    g.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(g);
    const slack = SPREADY.has(rec.type) ? 0.2 : 0;
    const shrink = (a, b) => [a + (b - a) * slack / 2, b - (b - a) * slack / 2];
    const [minX, maxX] = shrink(box.min.x, box.max.x);
    const [minZ, maxZ] = shrink(box.min.z, box.max.z);
    const bg = this.tank.bgDepth || 0;
    const fit = (lo, hi, a, b) => (hi - lo >= b - a ? (a + b) / 2 - (lo + hi) / 2 : lo < a ? a - lo : hi > b ? b - hi : 0);
    const dx = fit(minX, maxX, -L / 2 + 0.3, L / 2 - 0.3);
    const dz = fit(minZ, maxZ, -W / 2 + 0.3 + (SPREADY.has(rec.type) ? 0 : bg * 0.6), W / 2 - 0.3);
    return [x + dx, z + dz];
  }

  applyTransform(rec, it = rec.data) {
    const { L, W, H } = this.dims;
    const g = rec.group;
    g.scale.setScalar(it.scale || 1);
    const mount = rec.def.mount;
    if (mount === 'ground') {
      g.rotation.set(0, it.rot || 0, 0);
      const [x, z] = this.clampGround(rec, it.x || 0, it.z || 0);
      g.position.set(x, g.position.y, z);
    } else if (mount === 'wall') {
      const wall = this.tank.walls[it.wall] || this.tank.walls.back;
      const along = clamp(it.a || 0, -wall.span, wall.span);
      const y = clamp(it.y ?? H * 0.5, 1, H - 1);
      if (wall.axis === 'x') g.position.set(along, y, wall.coord - wall.normal.z * 0.25);
      else g.position.set(wall.coord - wall.normal.x * 0.25, y, along);
      g.rotation.set(0, WALL_ROT[it.wall] ?? 0, 0);
    } else if (mount === 'top') {
      g.position.set(clamp(it.x || 0, -L / 2 + 2, L / 2 - 2), H + 0.08, clamp(it.z || 0, -W / 2 + 2, W / 2 - 2));
      g.rotation.set(0, it.rot || 0, 0);
      if (it.type === 'uvb') g.scale.set(Math.min(1, (L - 3) / 22), 1, 1);
    } else if (mount === 'under') {
      g.position.set(clamp(it.x || 0, -L / 2 + 3, L / 2 - 3), -0.13, clamp(it.z || 0, -W / 2 + 3, W / 2 - 3));
      g.rotation.set(0, it.rot || 0, 0);
    }
    g.updateMatrixWorld(true);
  }

  rebuildLists() {
    this.solidList = [];
    this.baseList = [];
    this.selectable = [];
    for (const rec of this.items.values()) {
      for (const m of rec.group.userData.solid || []) {
        this.solidList.push(m);
        if (BASES.has(rec.type)) this.baseList.push(m);
      }
      this.selectable.push(rec.group);
    }
  }

  // Ground items rest on the terrain (or on top of rocks/hides).
  settleAll() {
    const recs = [...this.items.values()].filter((r) => r.def.mount === 'ground');
    recs.sort((a, b) => (BASES.has(b.type) ? 1 : 0) - (BASES.has(a.type) ? 1 : 0));
    const settled = [];
    for (const rec of recs) {
      this.settleOne(rec, BASES.has(rec.type) ? [] : settled);
      if (BASES.has(rec.type)) settled.push(...(rec.group.userData.solid || []));
    }
  }

  surfaceAt(x, z, onto, ignoreId) {
    let y = this.terrain.heightAt(x, z);
    if (onto.length) {
      this.ray.set(V(x, y + 8, z), DOWN);
      this.ray.far = 9;
      const hit = this.ray.intersectObjects(onto, false).find((h) => h.object.userData.itemId !== ignoreId);
      if (hit && hit.point.y > y) y = hit.point.y - 0.05;
    }
    return y;
  }

  settleOne(rec, onto) {
    const g = rec.group;
    g.position.y = this.surfaceAt(g.position.x, g.position.z, onto, rec.id);
    g.updateMatrixWorld(true);
    if (g.userData.conform) {
      const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
      const p = V();
      g.userData.conform((lx, lz) => {
        p.set(lx, 0, lz).applyMatrix4(g.matrixWorld);
        const h = this.terrain.heightAt(clamp(p.x, -this.dims.L / 2, this.dims.L / 2), clamp(p.z, -this.dims.W / 2, this.dims.W / 2));
        return V(p.x, h, p.z).applyMatrix4(inv).y;
      });
    }
  }

  // ------------------------------------------------------------------ animal model
  defaultAnimalSpot() {
    const { L, W } = this.dims;
    let best = { x: 0, z: W * 0.25 }, bestD = -1;
    const box = new THREE.Box3();
    const boxes = [...this.items.values()].filter((r) => r.def.mount === 'ground' && r.group.userData.solid.length).map((r) => box.clone().setFromObject(r.group));
    for (let i = 0; i < 60; i++) {
      const x = (i % 10 / 9 - 0.5) * (L - this.animal.length * 0.9 - 2);
      const z = (Math.floor(i / 10) / 5 - 0.5) * (W - 6) * 0.8 + W * 0.08;
      let d = 99;
      for (const b of boxes) d = Math.min(d, b.distanceToPoint(V(x, b.min.y, z)));
      d -= Math.abs(z - W * 0.2) * 0.05;
      if (d > bestD) { bestD = d; best = { x, z }; }
    }
    return best;
  }

  placeAnimal(a) {
    const show = !a || a.show !== false;
    this.animal.group.visible = show;
    if (!show) return;
    let spot = a && a.x != null ? a : null;
    if (!spot) {
      const key = [this.animalSpecies, this.dims.L, this.dims.W, this.items.size].join();
      if (key !== this._autoKey) { this._autoSpot = this.defaultAnimalSpot(); this._autoKey = key; }
      spot = this._autoSpot;
    }
    const rot = a && a.rot != null ? a.rot : -0.9;
    this.setAnimalPose(spot.x, spot.z, rot);
  }

  setAnimalPose(x, z, rot) {
    const { L, W } = this.dims;
    const half = this.animal.length * 0.35;
    x = clamp(x, -L / 2 + half, L / 2 - half);
    z = clamp(z, -W / 2 + 1.5 + (this.tank.bgDepth || 0), W / 2 - 1.5);
    const fx = Math.sin(rot), fz = Math.cos(rot);
    const s = this.animal.m.body * 0.5;
    const yc = this.surfaceAt(x, z, this.baseList);
    const yn = this.surfaceAt(x + fx * s, z + fz * s, this.baseList);
    const yt = this.surfaceAt(x - fx * s, z - fz * s, this.baseList);
    const pitch = clamp(Math.atan2(yn - yt, s * 2), -0.5, 0.5);
    this.animal.group.position.set(x, Math.max(yc, (yn + yt) / 2), z);
    this.animal.root.rotation.set(-pitch, rot, 0, 'YXZ');
    this.animal.group.updateMatrixWorld(true);
    return { x: +x.toFixed(2), z: +z.toFixed(2) };
  }

  // ------------------------------------------------------------------ lamps + climate
  updateLamps() {
    this.lampLights.clear();
    let shadowUsed = false;
    for (const rec of this.items.values()) {
      if (rec.type !== 'heatLamp') continue;
      const watts = rec.data.watts || 75;
      const p = rec.group.localToWorld(rec.group.userData.lightLocal.clone());
      const spot = new THREE.SpotLight('#ffb062', this.thermal ? 0 : watts * 4.5, 0, Math.PI / 3.4, 0.85, 2);
      spot.position.copy(p).add(V(0, -1.4, 0));
      spot.target.position.set(p.x, 0, p.z);
      if (!shadowUsed) {
        spot.castShadow = true;
        spot.shadow.mapSize.set(1024, 1024);
        spot.shadow.bias = -0.0005;
        spot.shadow.camera.near = 1;
        spot.shadow.camera.far = this.dims.H + 10;
        shadowUsed = true;
      }
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('255,190,110'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: this.thermal ? 0 : 0.6 }));
      glow.position.copy(p);
      glow.scale.setScalar(5 + watts / 20);
      this.lampLights.add(spot, spot.target, glow);
    }
  }

  lampsFor(override) {
    const lamps = [], mats = [];
    for (const rec of this.items.values()) {
      if (rec.type === 'heatLamp') {
        const p = rec.group.localToWorld(rec.group.userData.lightLocal.clone());
        lamps.push({ x: p.x, y: p.y, z: p.z, watts: override ?? rec.data.watts ?? 75, id: rec.id });
      } else if (rec.type === 'heatMat') {
        const s = rec.data.scale || 1;
        const turned = Math.abs(Math.sin(rec.data.rot || 0)) > 0.7;
        mats.push({ x: rec.group.position.x, z: rec.group.position.z, w: (turned ? 11 : 8) * s, d: (turned ? 8 : 11) * s });
      }
    }
    return { lamps, mats };
  }

  climate(night = false, override) {
    const s = this.store.get();
    const { L, W, H } = s.tank;
    const { lamps, mats } = this.lampsFor(override);
    return makeClimate({ room: s.room, lamps, mats, vol: gallons(L, W, H), night });
  }

  samplePoints() {
    if (this._samples && this._samplesKey === this.statsKey) return this._samples;
    const pts = [];
    const { L, W } = this.dims;
    for (let j = 0; j <= 16; j++) for (let i = 0; i <= 32; i++) {
      const x = (i / 32 - 0.5) * (L - 1.5), z = (j / 16 - 0.5) * (W - 1.5);
      pts.push({ p: V(x, this.terrain.heightAt(x, z) + 0.05, z), ground: true });
    }
    const box = new THREE.Box3();
    for (const rec of this.items.values()) {
      if (!rec.group.userData.solid.length || rec.def.mount !== 'ground') continue;
      box.setFromObject(rec.group);
      const c = box.getCenter(V());
      pts.push({ p: V(c.x, box.max.y, c.z), ground: false });
      for (const q of rec.group.userData.climbPath || []) pts.push({ p: rec.group.localToWorld(q.clone()), ground: false });
    }
    this._samples = pts;
    this._samplesKey = this.statsKey;
    return pts;
  }

  computeStats(override) {
    const s = this.store.get();
    if (override == null) this.statsKey = Math.random();
    const temp = this.climate(false, override);
    const nightT = this.climate(true, override);
    let hot = -Infinity, cool = Infinity, night = Infinity, hotPos = null;
    for (const { p, ground } of this.samplePoints()) {
      const t = temp(p.x, p.y, p.z);
      if (t > hot) { hot = t; hotPos = p; }
      if (ground) {
        if (t < cool) cool = t;
        const tn = nightT(p.x, p.y, p.z);
        if (tn < night) night = tn;
      }
    }
    const { lamps } = this.lampsFor(override);
    const hum = humidityEstimate(s, s.items, lamps.reduce((a, l) => a + l.watts, 0));
    const hides = [];
    const counts = { water: 0, food: 0, climb: 0, cover: 0, livePlants: 0, uvb: 0, gauge: 0 };
    const plantMismatch = [];
    const box = new THREE.Box3();
    // floor coverage on a 1-inch grid (union of footprints, so overlaps count once)
    const bg = this.tank.bgDepth || 0;
    const nx = Math.ceil(this.dims.L), nz = Math.max(1, Math.ceil(this.dims.W - bg));
    const cells = new Uint8Array(nx * nz);
    const habitat = s.species && this.animal.sp ? this.animal.sp.habitat : 'arid';
    for (const rec of this.items.values()) {
      const def = rec.def, tags = def.tags;
      if (tags.includes('hide') && rec.group.userData.hideCenter) {
        const c = rec.group.localToWorld(rec.group.userData.hideCenter.clone());
        hides.push({ id: rec.id, type: rec.type, temp: temp(c.x, c.y + 0.5, c.z), humid: tags.includes('humid') });
      }
      if (rec.type === 'waterDish') counts.water++;
      if (tags.includes('food')) counts.food++;
      if (tags.includes('climb')) counts.climb++;
      if (tags.includes('cover')) counts.cover++;
      if (def.live) {
        counts.livePlants++;
        if ((def.climate === 'arid' && habitat === 'tropical') || (def.climate === 'tropical' && habitat === 'arid')) plantMismatch.push(def.name);
      }
      if (rec.type === 'uvb') counts.uvb++;
      if (rec.type === 'gauge') counts.gauge++;
      if (def.mount === 'ground' && !['leafLitter', 'isopods', 'pebbles', 'moss', 'driftwood', 'bamboo'].includes(rec.type)) {
        box.setFromObject(rec.group);
        const f = def.live ? 0.45 : 0.75; // footprints are rounder than their bounding boxes
        const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
        const hx = ((box.max.x - box.min.x) / 2) * f, hz = ((box.max.z - box.min.z) / 2) * f;
        const x0 = Math.max(0, Math.floor(cx - hx + this.dims.L / 2)), x1 = Math.min(nx - 1, Math.floor(cx + hx + this.dims.L / 2));
        const z0 = Math.max(0, Math.floor(cz - hz + this.dims.W / 2 - bg)), z1 = Math.min(nz - 1, Math.floor(cz + hz + this.dims.W / 2 - bg));
        for (let zi = z0; zi <= z1; zi++) for (let xi = x0; xi <= x1; xi++) cells[zi * nx + xi] = 1;
      }
    }
    const stats = {
      hot, cool, night, hotPos,
      humidity: hum.value, humidityParts: hum.parts,
      hides, counts,
      lampCount: lamps.length,
      plantMismatch: [...new Set(plantMismatch)],
      coverage: cells.reduce((a, b) => a + b, 0) / cells.length,
      avgDepth: this.terrain.averageDepth(),
    };
    if (override == null) {
      this.stats = stats;
      this.hooks.onStats?.(stats);
    }
    return stats;
  }

  // Try each bulb wattage and pick the one closest to the species' ideal.
  bestWattage(options, sp) {
    if (!this.lampsFor().lamps.length) return null;
    const mid = (sp.hot[0] + sp.hot[1]) / 2;
    let best = null, bestErr = Infinity;
    for (const w of options) {
      const st = this.computeStats(w);
      let err = Math.abs(st.hot - mid);
      if (st.hot > sp.hot[1]) err += 10;
      if (st.cool > sp.cool[1]) err += (st.cool - sp.cool[1]) * 2;
      if (err < bestErr) { bestErr = err; best = w; }
    }
    return best;
  }

  updateGauges() {
    if (!this.stats) return;
    const t = this.climate(false);
    for (const rec of this.items.values()) {
      if (rec.type !== 'gauge') continue;
      const p = rec.group.getWorldPosition(V());
      rec.group.userData.setReading(fmtTemp(t(p.x, p.y, p.z)), `${this.stats.humidity}%`);
    }
  }

  itemSize(id) {
    const rec = this.items.get(id);
    if (!rec) return null;
    const g = rec.group;
    const rot = g.rotation.y;
    g.rotation.y = 0;
    g.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(g).getSize(V());
    g.rotation.y = rot;
    g.updateMatrixWorld(true);
    return size;
  }

  // ------------------------------------------------------------------ modes
  setThermal(on) {
    this.thermal = on;
    if (on) this.refreshThermal();
    else {
      this.terrain.setThermal(null);
      this.restoreThermal(this.itemsGroup);
      if (this.tank) this.restoreThermal(this.tank.group);
      this.animal.setThermal(null);
      glassMat.opacity = 0.13;
    }
    this.hemi.intensity = on ? 0.9 : 1.05;
    this.sun.intensity = on ? 0.45 : 2.2;
    this.fill.intensity = on ? 0.15 : 0.45;
    this.scene.environmentIntensity = on ? 0 : 0.55;
    this.scene.background.copy(on ? this.thermBg : this.dayBg);
    this.renderer.toneMapping = on ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
    this.floor.visible = !on;
    setLampGlow(!on);
    this.updateLamps();
  }

  refreshThermal() {
    const t = this.climate(false);
    this.thermalFn = t;
    this.terrain.setThermal(t, (temp, out) => thermalColor(temp, out, true));
    this.applyThermalTo(this.itemsGroup, t);
    if (this.tank) this.applyThermalTo(this.tank.group, t);
    const p = this.animal.group.position;
    this.animal.setThermal(thermalColor(t(p.x, p.y + 0.5, p.z), [0, 0, 0], true));
    glassMat.opacity = 0.05;
  }

  applyThermalTo(root, t) {
    const v = V(), c = [0, 0, 0];
    root.traverse((o) => {
      if (!o.isMesh || o.userData.glass) return;
      const geo = o.geometry;
      if (!('origColor' in geo.userData)) geo.userData.origColor = geo.attributes.color || null;
      if (!o.userData.origMaterial) o.userData.origMaterial = o.material;
      o.updateWorldMatrix(true, false);
      const pos = geo.attributes.position;
      const arr = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        thermalColor(t(v.x, v.y, v.z), c, true);
        arr[i * 3] = c[0]; arr[i * 3 + 1] = c[1]; arr[i * 3 + 2] = c[2];
      }
      geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      o.material = o.userData.lid ? o.userData.origMaterial : this.thermalMat;
    });
  }

  restoreThermal(root) {
    root.traverse((o) => {
      if (!o.isMesh || !o.userData.origMaterial) return;
      o.material = o.userData.origMaterial;
      const geo = o.geometry;
      if ('origColor' in geo.userData) {
        if (geo.userData.origColor) geo.setAttribute('color', geo.userData.origColor);
        else geo.deleteAttribute('color');
        delete geo.userData.origColor;
      }
    });
  }

  setSculpt(opts) {
    Object.assign(this.sculpt, opts);
    this.brush.visible = false;
    if (!this.sculpt.active) this.renderer.domElement.style.cursor = '';
  }

  cameraGoal(view = 'front') {
    const { L, W, H } = this.dims;
    const vfov = (this.camera.fov * Math.PI) / 180;
    const aspect = this.camera.aspect;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    const fitW = (L + 16) / 2 / Math.tan(hfov / 2) + W / 2;
    const fitH = (H + 20) / 2 / Math.tan(vfov / 2) + W / 2;
    const views = {
      front: { dir: V(0.32, 0.34, 1), target: V(0, H * 0.4, 0), dist: Math.max(fitW, fitH) * 1.08 },
      straight: { dir: V(0, 0.08, 1), target: V(0, H * 0.48, 0), dist: Math.max(fitW, fitH) * 1.0 },
      top: { dir: V(0.0, 1, 0.12), target: V(0, H * 0.3, 0), dist: Math.max((L + 10) / 2 / Math.tan(hfov / 2), (W + 10) / 2 / Math.tan(vfov / 2)) + H },
      side: { dir: V(1, 0.2, 0.15), target: V(0, H * 0.45, 0), dist: Math.max((W + 16) / 2 / Math.tan(hfov / 2), (H + 20) / 2 / Math.tan(vfov / 2)) + L / 2 },
    };
    const v = views[view] || views.front;
    return { pos: v.target.clone().addScaledVector(v.dir.normalize(), v.dist), target: v.target };
  }

  resetCamera(instant = false, view = 'front') {
    if (!this.dims) return;
    const goal = this.cameraGoal(view);
    if (instant) {
      this.camera.position.copy(goal.pos);
      this.controls.target.copy(goal.target);
      this.camAnim = null;
    } else {
      this.camAnim = { t: 0, fromP: this.camera.position.clone(), fromT: this.controls.target.clone(), ...goal };
    }
  }

  // ------------------------------------------------------------------ selection + dragging
  select(id) {
    this.selected = id;
    this.selBox.visible = !!id;
    this.hooks.onSelect?.(id);
  }

  bindEvents() {
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => this.onDown(e), { capture: true });
    window.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    el.addEventListener('pointerleave', () => { this.brush.visible = false; this.hover.style.display = 'none'; });
    el.addEventListener('dragover', (e) => e.preventDefault());
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      const type = e.dataTransfer.getData('text/item');
      if (type) this.hooks.onDropItem?.(type, this.dropPoint(e, type));
    });
  }

  setPointer(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  // nearest of: an item, or the animal model
  pick() {
    const targets = this.animal.group.visible ? [...this.selectable, this.animal.root] : this.selectable;
    const hits = this.raycaster.intersectObjects(targets, true);
    for (const h of hits) {
      if (h.object.isSprite) continue;
      let o = h.object;
      while (o && !o.userData.itemId && o !== this.animal.root) o = o.parent;
      if (o === this.animal.root) return { id: 'animal', point: h.point };
      if (o) return { id: o.userData.itemId, point: h.point };
    }
    return null;
  }

  terrainPoint() {
    const h = this.raycaster.intersectObject(this.terrain.mesh, false)[0];
    return h ? h.point : null;
  }

  dropPoint(e, type) {
    this.setPointer(e);
    const def = ITEMS[type];
    if (def.mount === 'ground') {
      const p = this.terrainPoint();
      return p ? { x: p.x, z: p.z } : null;
    }
    if (def.mount === 'wall') return this.wallPoint();
    const plane = new THREE.Plane(V(0, 1, 0), def.mount === 'top' ? -this.dims.H : 0);
    const p = this.raycaster.ray.intersectPlane(plane, V());
    return p ? { x: p.x, z: p.z } : null;
  }

  wallPoint() {
    let best = null;
    for (const [name, w] of Object.entries(this.tank.walls)) {
      if (name === 'front') continue;
      const plane = w.axis === 'x' ? new THREE.Plane(V(0, 0, 1), -w.coord) : new THREE.Plane(V(1, 0, 0), -w.coord);
      const p = this.raycaster.ray.intersectPlane(plane, V());
      if (!p) continue;
      const along = w.axis === 'x' ? p.x : p.z;
      if (Math.abs(along) > w.span + 2 || p.y < -2 || p.y > this.dims.H + 2) continue;
      const d = p.distanceTo(this.raycaster.ray.origin);
      if (!best || d < best.d) best = { d, wall: name, a: +clamp(along, -w.span, w.span).toFixed(2), y: +clamp(p.y, 1.5, this.dims.H - 1.5).toFixed(2) };
    }
    if (best) delete best.d;
    return best;
  }

  onDown(e) {
    if (e.button !== 0) return;
    this.setPointer(e);
    this.down = { x: e.clientX, y: e.clientY, moved: false };
    const hit = this.pick();
    if (hit) {
      this.select(hit.id);
      const g = hit.id === 'animal' ? this.animal.group : this.items.get(hit.id).group;
      this.drag = { id: hit.id, rec: this.items.get(hit.id), offset: V(g.position.x - hit.point.x, 0, g.position.z - hit.point.z), moved: false };
      this.controls.enabled = false;
      this.renderer.domElement.style.cursor = 'grabbing';
      return;
    }
    if (this.sculpt.active) {
      const p = this.terrainPoint();
      if (p) {
        this.sculpting = { flatten: this.terrain.heightAt(p.x, p.z) - this.terrain.base };
        this.controls.enabled = false;
      }
    }
  }

  onMove(e) {
    if (e.target !== this.renderer.domElement && !this.drag && !this.sculpting) return;
    this.setPointer(e);
    if (this.down && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 4) this.down.moved = true;
    if (this.drag) {
      if (this.down?.moved) this.dragTo(this.drag);
      return;
    }
    if (this.sculpt.active) {
      const p = this.terrainPoint();
      this.brush.visible = !!p;
      if (p) {
        this.brush.position.set(p.x, p.y + 0.1, p.z);
        this.brush.scale.setScalar(this.sculpt.radius);
        this.brushPoint = p;
      }
    }
    const now = performance.now();
    if (now - (this.lastHover || 0) > 50) {
      this.lastHover = now;
      const hit = this.pick();
      this.renderer.domElement.style.cursor = hit ? 'grab' : this.sculpt.active ? 'crosshair' : '';
      if (this.thermal && this.thermalFn) {
        const p = hit?.point || this.terrainPoint();
        if (p) {
          const r = this.container.getBoundingClientRect();
          this.hover.style.display = 'block';
          this.hover.style.left = e.clientX - r.left + 14 + 'px';
          this.hover.style.top = e.clientY - r.top - 10 + 'px';
          this.hover.textContent = fmtTemp(this.thermalFn(p.x, p.y, p.z));
        } else this.hover.style.display = 'none';
      } else this.hover.style.display = 'none';
    }
  }

  dragTo(drag) {
    const { L, W, H } = this.dims;
    if (drag.id === 'animal') {
      const p = this.raycaster.intersectObjects([this.terrain.mesh, ...this.baseList], false)[0]?.point;
      if (!p) return;
      const rot = this.animal.root.rotation.y;
      drag.result = this.setAnimalPose(p.x + drag.offset.x, p.z + drag.offset.z, rot);
      drag.moved = true;
      return;
    }
    const { rec } = drag;
    const def = rec.def;
    const g = rec.group;
    if (def.mount === 'ground') {
      const others = this.baseList.filter((m) => m.userData.itemId !== rec.id);
      const p = this.raycaster.intersectObjects([this.terrain.mesh, ...others], false)[0]?.point;
      if (!p) return;
      const [x, z] = this.clampGround(rec, p.x + drag.offset.x, p.z + drag.offset.z);
      g.position.x = x;
      g.position.z = z;
      this.settleOne(rec, BASES.has(rec.type) ? [] : others);
      drag.result = { x: +x.toFixed(2), z: +z.toFixed(2) };
    } else if (def.mount === 'wall') {
      const w = this.wallPoint();
      if (!w) return;
      drag.result = w;
      this.applyTransform(rec, { ...rec.data, ...w });
    } else {
      const plane = new THREE.Plane(V(0, 1, 0), def.mount === 'top' ? -H : 0);
      const p = this.raycaster.ray.intersectPlane(plane, V());
      if (!p) return;
      drag.result = { x: +clamp(p.x, -L / 2 + 2, L / 2 - 2).toFixed(2), z: +clamp(p.z, -W / 2 + 2, W / 2 - 2).toFixed(2) };
      this.applyTransform(rec, { ...rec.data, ...drag.result });
      if (rec.type === 'heatLamp') this.updateLamps();
    }
    drag.moved = true;
    if (this.thermal && performance.now() - (this.lastThermal || 0) > 120) {
      this.lastThermal = performance.now();
      this.refreshThermal();
    }
  }

  onUp(e) {
    if (this.drag) {
      const d = this.drag;
      this.drag = null;
      this.controls.enabled = true;
      this.renderer.domElement.style.cursor = '';
      if (d.moved && d.result) {
        if (d.id === 'animal') this.store.commit((s) => { s.animal = { ...(s.animal || {}), show: true, ...d.result, rot: this.animal.root.rotation.y }; });
        else this.store.commit((s) => { const it = s.items.find((i) => i.id === d.id); if (it) Object.assign(it, d.result); });
      }
    }
    if (this.sculpting) {
      this.sculpting = null;
      this.controls.enabled = true;
      const heights = this.terrain.heightsArray();
      this.store.commit((s) => { s.terrain = heights; });
    }
    if (this.down && !this.down.moved && e.target === this.renderer.domElement && !this.pick() && !this.sculpt.active) this.select(null);
    this.down = null;
  }

  // ------------------------------------------------------------------ frame loop
  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = w + 'px';
    this.renderer.domElement.style.height = h + 'px';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.dims && !this.userMovedCamera) this.resetCamera(true);
  }

  frame() {
    const now = performance.now() / 1000;
    const dt = Math.min(now - (this.lastT || now), 0.1);
    this.lastT = now;

    if (this.camAnim) {
      const a = this.camAnim;
      a.t = Math.min(1, a.t + dt * 1.8);
      const k = 1 - Math.pow(1 - a.t, 3);
      this.camera.position.lerpVectors(a.fromP, a.pos, k);
      this.controls.target.lerpVectors(a.fromT, a.target, k);
      if (a.t >= 1) this.camAnim = null;
    }

    if (this.sculpting && this.brushPoint) {
      const p = this.brushPoint;
      if (this.terrain.sculpt(p.x, p.z, this.sculpt.mode, this.sculpt.radius, this.sculpt.strength, dt, this.sculpting.flatten)) {
        this.settleAll();
        this.brush.position.y = this.terrain.heightAt(p.x, p.z) + 0.1;
        this._samplesKey = null;
      }
    }

    if (this.selected) {
      const obj = this.selected === 'animal' ? this.animal.group : this.items.get(this.selected)?.group;
      if (obj) {
        this.selBox.box.setFromObject(obj);
        this.selBox.box.expandByScalar(0.3);
      }
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.updateDimLabels();
  }

  updateDimLabels() {
    if (!this.dims) return;
    const { L, W, H } = this.dims;
    const w = this.container.clientWidth, h = this.container.clientHeight;
    const cam = this.camera.position;
    // pick the visible front-bottom edge and the side nearest the camera
    const sx = cam.x >= 0 ? 1 : -1, sz = cam.z >= 0 ? 1 : -1;
    const pts = {
      L: V(0, -0.5, (sz * W) / 2 + 0.6),
      W: V((sx * L) / 2 + 0.6, -0.5, 0),
      H: V((sx * L) / 2 + 0.6, H / 2, (sz * W) / 2 + 0.6),
    };
    const text = { L: fmtLen(L), W: fmtLen(W), H: fmtLen(H) };
    for (const d of this.dimLabels) {
      const k = d.dataset.axis;
      const p = pts[k].clone().project(this.camera);
      const vis = this.showDims && p.z < 1 && Math.abs(p.x) < 0.98 && Math.abs(p.y) < 0.98;
      d.style.display = vis ? 'block' : 'none';
      if (!vis) continue;
      d.style.transform = `translate(${(p.x * 0.5 + 0.5) * w}px, ${(-p.y * 0.5 + 0.5) * h}px) translate(-50%, -50%)`;
      const label = `${k === 'L' ? '↔' : k === 'W' ? '⤢' : '↕'} ${text[k]}`;
      if (d.textContent !== label) d.textContent = label;
    }
  }

  // ------------------------------------------------------------------ export
  capture(maxW = 1600, type = 'image/png', quality = 0.92) {
    const wasSel = this.selBox.visible, wasBrush = this.brush.visible;
    this.selBox.visible = false;
    this.brush.visible = false;
    this.renderer.render(this.scene, this.camera);
    const src = this.renderer.domElement;
    const scale = Math.min(1, maxW / src.width);
    const c = document.createElement('canvas');
    c.width = Math.round(src.width * scale);
    c.height = Math.round(src.height * scale);
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    this.selBox.visible = wasSel;
    this.brush.visible = wasBrush;
    return c.toDataURL(type, quality);
  }
}
