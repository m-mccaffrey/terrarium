// Small shared helpers: math, seeded randomness, noise, units, colors.

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

let idCounter = 0;
export const uid = () =>
  Date.now().toString(36).slice(-5) + (idCounter++).toString(36) + Math.random().toString(36).slice(2, 5);

// Deterministic PRNG so that a saved design rebuilds identical rocks/plants.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const randomSeed = () => Math.floor(Math.random() * 1e9);

// ---- Value noise (tileable when a period is given) ----
function hash2(x, y, seed) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const mod = (a, n) => ((a % n) + n) % n;

export function valueNoise(x, y, seed = 0, period = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  let x0 = xi, x1 = xi + 1, y0 = yi, y1 = yi + 1;
  if (period) { x0 = mod(x0, period); x1 = mod(x1, period); y0 = mod(y0, period); y1 = mod(y1, period); }
  const u = fade(xf), v = fade(yf);
  const a = hash2(x0, y0, seed), b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed), d = hash2(x1, y1, seed);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

export function fbm(x, y, seed = 0, octaves = 4, period = 0) {
  let amp = 0.5, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + i * 17, period ? period * freq : 0);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

// 3D-ish noise for displacing rocks: blend of 2D noises on three planes.
export function noise3(x, y, z, seed = 0) {
  return (fbm(x, y, seed, 3) + fbm(y, z, seed + 5, 3) + fbm(z, x, seed + 11, 3)) / 3;
}

// ---- Units ----
export const units = { system: 'imperial' };

export function fmtLen(inches, digits = 0) {
  if (units.system === 'metric') {
    const cm = inches * 2.54;
    return `${cm.toFixed(digits)} cm`;
  }
  return `${inches.toFixed(digits)}″`;
}
export function fmtDims(L, W, H) {
  if (units.system === 'metric') {
    return `${Math.round(L * 2.54)} × ${Math.round(W * 2.54)} × ${Math.round(H * 2.54)} cm`;
  }
  return `${Math.round(L)} × ${Math.round(W)} × ${Math.round(H)} in`;
}
export function fmtTemp(f, digits = 0) {
  if (units.system === 'metric') return `${((f - 32) * 5 / 9).toFixed(digits)}°C`;
  return `${f.toFixed(digits)}°F`;
}
export function fmtTempRange([a, b]) {
  if (units.system === 'metric') {
    const c = (f) => Math.round((f - 32) * 5 / 9);
    return `${c(a)}–${c(b)}°C`;
  }
  return `${a}–${b}°F`;
}
export const gallons = (L, W, H) => (L * W * H) / 231;
export function fmtVolume(L, W, H) {
  if (units.system === 'metric') return `${Math.round(L * W * H * 0.016387)} L`;
  return `${Math.round(gallons(L, W, H))} gal`;
}

// ---- Colors ----
export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
}
export function mixHex(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex(lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t));
}
export function shadeHex(hex, amt) {
  return amt >= 0 ? mixHex(hex, '#ffffff', amt) : mixHex(hex, '#000000', -amt);
}

// Thermal camera palette: cold blue → cyan → green → yellow → orange → red → white-hot.
const THERMAL_STOPS = [
  [0.0, [20, 24, 82]],
  [0.18, [36, 84, 200]],
  [0.34, [32, 180, 210]],
  [0.5, [70, 200, 90]],
  [0.64, [240, 220, 60]],
  [0.78, [250, 140, 30]],
  [0.9, [230, 40, 40]],
  [1.0, [255, 235, 235]],
];
export const THERMAL_MIN = 66, THERMAL_MAX = 106;
// sRGB 0..1 by default; pass linear=true for vertex colours / material colours.
export function thermalColor(tempF, out = [0, 0, 0], linear = false) {
  const t = clamp((tempF - THERMAL_MIN) / (THERMAL_MAX - THERMAL_MIN), 0, 1);
  out[0] = 1; out[1] = 0.92; out[2] = 0.92;
  for (let i = 1; i < THERMAL_STOPS.length; i++) {
    const [p1, c1] = THERMAL_STOPS[i];
    if (t <= p1) {
      const [p0, c0] = THERMAL_STOPS[i - 1];
      const k = (t - p0) / (p1 - p0);
      out[0] = lerp(c0[0], c1[0], k) / 255;
      out[1] = lerp(c0[1], c1[1], k) / 255;
      out[2] = lerp(c0[2], c1[2], k) / 255;
      break;
    }
  }
  if (linear) for (let i = 0; i < 3; i++) out[i] = Math.pow(out[i], 2.2);
  return out;
}
export function thermalCss() {
  return `linear-gradient(90deg, ${THERMAL_STOPS.map(([p, c]) => `rgb(${c.join(',')}) ${p * 100}%`).join(', ')})`;
}

export function pick(arr, rnd = Math.random) {
  return arr[Math.floor(rnd() * arr.length)];
}

export function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

export function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return e;
}
