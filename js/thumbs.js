// Renders little 3D snapshots of every decor item and every pet for the menus.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildItem, disposeItem } from './models.js';
import { AnimalModel } from './animal.js';

const cache = new Map();
const waiting = new Map();
let renderer, scene, camera, queue = [], busy = false;

function setup() {
  if (renderer) return true;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch {
    return false;
  }
  renderer.setSize(176, 176);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  scene = new THREE.Scene();
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.7;
  scene.add(new THREE.HemisphereLight('#fffaf0', '#8a8070', 1.2));
  const d = new THREE.DirectionalLight('#ffffff', 2.2);
  d.position.set(-3, 6, 5);
  scene.add(d);
  camera = new THREE.PerspectiveCamera(30, 1, 0.1, 500);
  return true;
}

function snap(obj, view = [0.75, 0.6, 1]) {
  scene.add(obj);
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const dir = new THREE.Vector3(...view).normalize();
  const dist = sphere.radius / Math.sin((camera.fov * Math.PI) / 360) * 1.02;
  camera.position.copy(sphere.center).addScaledVector(dir, dist);
  camera.lookAt(sphere.center);
  camera.near = dist / 50;
  camera.far = dist * 4;
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  scene.remove(obj);
  return url;
}

function pump() {
  if (busy) return;
  busy = true;
  const run = () => {
    const start = performance.now();
    while (queue.length && performance.now() - start < 24) {
      const job = queue.shift();
      if (cache.has(job.key)) continue;
      let url = null;
      try {
        if (!setup()) throw new Error('no webgl');
        url = job.make();
      } catch (e) {
        url = null;
      }
      cache.set(job.key, url);
      for (const cb of waiting.get(job.key) || []) cb(url);
      waiting.delete(job.key);
    }
    if (queue.length) setTimeout(run, 16);
    else busy = false;
  };
  setTimeout(run, 30);
}

function request(key, make, cb) {
  if (cache.has(key)) {
    cb(cache.get(key));
    return;
  }
  if (!waiting.has(key)) {
    waiting.set(key, []);
    queue.push({ key, make });
  }
  waiting.get(key).push(cb);
  pump();
}

export function itemThumb(type, cb) {
  request('item:' + type, () => {
    const g = buildItem(type, 7);
    if (type === 'foodDish') g.userData.setFood('mealworms', 6);
    if (type === 'ledgeFeeder') g.userData.setFood('fruit', 1);
    const view = type === 'heatMat' ? [0.3, 1.4, 0.8] : type === 'vine' || type === 'ledge' || type === 'gauge' || type === 'ledgeFeeder' ? [0.5, 0.35, 1] : [0.75, 0.6, 1];
    const url = snap(g, view);
    disposeItem(g);
    return url;
  }, cb);
}

export function petThumb(species, morph, cb) {
  request(`pet:${species}:${morph}`, () => {
    const c = new AnimalModel();
    c.setSpecies(species);
    c.root.rotation.set(0, -0.6, 0);
    const url = snap(c.group, [0.25, 0.8, 1]);
    return url;
  }, cb);
}

// <img> helper that fills itself in when the snapshot is ready.
export function thumbImg(kind, args, fallback, cls = 'thumb') {
  const wrap = document.createElement('span');
  wrap.className = cls + ' loading';
  wrap.textContent = fallback;
  const done = (url) => {
    if (!url) return;
    wrap.textContent = '';
    wrap.classList.remove('loading');
    const img = new Image();
    img.alt = '';
    img.src = url;
    wrap.append(img);
  };
  if (kind === 'item') itemThumb(args[0], done);
  else petThumb(args[0], args[1], done);
  return wrap;
}
