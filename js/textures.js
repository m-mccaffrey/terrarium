// Procedurally painted canvas textures (no image downloads needed).
import * as THREE from 'three';
import { fbm, mulberry32, hexToRgb, valueNoise, clamp } from './util.js';

const cache = new Map();

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function toTexture(c, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
  }
  t.anisotropy = 8;
  return t;
}

// Fill an image with tileable fbm-tinted color.
function paintNoise(ctx, w, h, hex, variance, seed, scale = 8) {
  const img = ctx.getImageData(0, 0, w, h);
  const [r, g, b] = hexToRgb(hex);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n = fbm((x / w) * scale, (y / h) * scale, seed, 4, scale) - 0.5;
      const k = 1 + n * variance;
      const i = (y * w + x) * 4;
      img.data[i] = clamp(r * k, 0, 255);
      img.data[i + 1] = clamp(g * k, 0, 255);
      img.data[i + 2] = clamp(b * k, 0, 255);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

// Draw with wrap-around so speckles tile seamlessly.
function wrapDraw(ctx, w, h, x, y, r, draw) {
  for (const dx of [-w, 0, w]) {
    for (const dy of [-h, 0, h]) {
      if (x + dx + r < 0 || x + dx - r > w || y + dy + r < 0 || y + dy - r > h) continue;
      draw(x + dx, y + dy);
    }
  }
}

function speckle(ctx, w, h, rnd, count, colors, rMin, rMax, alpha = 1, elongate = 1) {
  for (let i = 0; i < count; i++) {
    const x = rnd() * w, y = rnd() * h;
    const r = rMin + rnd() * (rMax - rMin);
    const col = colors[Math.floor(rnd() * colors.length)];
    const ang = rnd() * Math.PI;
    ctx.globalAlpha = alpha * (0.5 + rnd() * 0.5);
    ctx.fillStyle = col;
    wrapDraw(ctx, w, h, x, y, r * elongate, (px, py) => {
      ctx.beginPath();
      ctx.ellipse(px, py, r * elongate, r, ang, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  ctx.globalAlpha = 1;
}

export function substrateTexture(id, sub) {
  const key = 'sub:' + id;
  if (cache.has(key)) return cache.get(key);
  const S = 512;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  const rnd = mulberry32(id.length * 977 + 13);
  switch (id) {
    case 'slate': {
      ctx.fillStyle = '#3c3d40';
      ctx.fillRect(0, 0, S, S);
      const tiles = 2, ts = S / tiles, gap = 5;
      for (let i = 0; i < tiles; i++) for (let j = 0; j < tiles; j++) {
        const tc = canvas(ts - gap, ts - gap);
        const tctx = tc.getContext('2d');
        const shades = ['#6c6e72', '#5f6266', '#74716c', '#686a6f'];
        paintNoise(tctx, tc.width, tc.height, shades[(i * 2 + j) % 4], 0.35, 50 + i * 7 + j, 6);
        // cleft lines in slate
        tctx.strokeStyle = 'rgba(30,30,32,0.25)';
        for (let k = 0; k < 6; k++) {
          tctx.lineWidth = 1 + rnd() * 2;
          tctx.beginPath();
          let y = rnd() * tc.height;
          tctx.moveTo(0, y);
          for (let x = 0; x < tc.width; x += 20) { y += (rnd() - 0.5) * 8; tctx.lineTo(x, y); }
          tctx.stroke();
        }
        ctx.drawImage(tc, i * ts + gap / 2, j * ts + gap / 2);
      }
      break;
    }
    case 'paper': {
      paintNoise(ctx, S, S, '#efeee8', 0.05, 3, 16);
      ctx.strokeStyle = 'rgba(180,178,170,0.35)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) {
        const x = i * 32 + 16, y = j * 32 + 16;
        ctx.beginPath();
        ctx.arc(x, y, 7, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(160,160,150,0.4)';
      ctx.fillRect(0, S / 2 - 1, S, 2);
      break;
    }
    case 'excavator': {
      paintNoise(ctx, S, S, sub.color, 0.35, 9, 4);
      ctx.strokeStyle = 'rgba(110,60,30,0.35)';
      for (let i = 0; i < 26; i++) {
        ctx.lineWidth = 0.8 + rnd() * 1.6;
        ctx.beginPath();
        let x = rnd() * S, y = rnd() * S;
        ctx.moveTo(x, y);
        for (let k = 0; k < 6; k++) { x += (rnd() - 0.5) * 60; y += (rnd() - 0.5) * 60; ctx.lineTo(x, y); }
        ctx.stroke();
      }
      speckle(ctx, S, S, rnd, 900, ['#e7b07c', '#b8743f', '#f0c79a'], 0.6, 1.6);
      break;
    }
    default: {
      paintNoise(ctx, S, S, sub.color, id === 'calciSand' ? 0.12 : 0.45, id.length * 3, 8);
      if (id === 'aridBio' || id === 'calciSand') {
        speckle(ctx, S, S, rnd, 9000, ['#f0d9b5', '#a07850', '#8f6a46', '#e6c9a0', '#ffffff'], 0.5, 1.4, 0.8);
        if (id === 'aridBio') {
          speckle(ctx, S, S, rnd, 120, ['#8d8378', '#a59a8c', '#6f665c'], 2, 5, 0.9);
          speckle(ctx, S, S, rnd, 60, ['#5a4632', '#6f553a'], 1.5, 3, 0.8, 3);
        }
      } else if (id === 'tropicalBio') {
        speckle(ctx, S, S, rnd, 5000, ['#2d1d13', '#5d4330', '#3a281b', '#6e5039'], 0.8, 2.2, 0.8);
        speckle(ctx, S, S, rnd, 220, ['#7a5a3c', '#8b6844', '#4a3220'], 3, 7, 0.85, 2.6); // bark bits
        speckle(ctx, S, S, rnd, 90, ['#4f6a2c', '#3e5a26', '#6b7d35'], 2, 4, 0.7, 2); // moss bits
        speckle(ctx, S, S, rnd, 140, ['#c9c2b4', '#a59c8e'], 1.2, 2.2, 0.6); // perlite / charcoal
      } else if (id === 'coco') {
        ctx.lineCap = 'round';
        for (let i = 0; i < 2600; i++) {
          const x = rnd() * S, y = rnd() * S, a = rnd() * Math.PI * 2, l = 4 + rnd() * 14;
          ctx.strokeStyle = ['#5a341d', '#8f5a35', '#6b3f22', '#a26a40'][Math.floor(rnd() * 4)];
          ctx.globalAlpha = 0.5 + rnd() * 0.5;
          ctx.lineWidth = 0.8 + rnd() * 1.2;
          wrapDraw(ctx, S, S, x, y, l, (px, py) => {
            ctx.beginPath();
            ctx.moveTo(px, py);
            ctx.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l);
            ctx.stroke();
          });
        }
        ctx.globalAlpha = 1;
      } else if (id === 'bark') {
        for (let i = 0; i < 420; i++) {
          const x = rnd() * S, y = rnd() * S, w = 8 + rnd() * 22, h = 5 + rnd() * 10, a = rnd() * Math.PI;
          const col = ['#8a5a34', '#a06c40', '#6e4426', '#b57d4b', '#5c391f'][Math.floor(rnd() * 5)];
          wrapDraw(ctx, S, S, x, y, w, (px, py) => {
            ctx.save();
            ctx.translate(px, py);
            ctx.rotate(a);
            ctx.fillStyle = 'rgba(30,18,8,0.45)';
            ctx.fillRect(-w / 2 + 2, -h / 2 + 2, w, h);
            ctx.fillStyle = col;
            ctx.fillRect(-w / 2, -h / 2, w, h);
            ctx.fillStyle = 'rgba(255,220,180,0.12)';
            ctx.fillRect(-w / 2, -h / 2, w, 1.5);
            ctx.restore();
          });
        }
      }
    }
  }
  const tex = toTexture(c);
  cache.set(key, tex);
  return tex;
}

// Swatch preview (data URL) for substrate cards.
export function substrateSwatch(id, sub) {
  const tex = substrateTexture(id, sub);
  const c = canvas(96, 96);
  c.getContext('2d').drawImage(tex.image, 0, 0, 256, 256, 0, 0, 96, 96);
  return c.toDataURL();
}

export function lecaTexture() {
  if (cache.has('leca')) return cache.get('leca');
  const S = 256;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#3b2a1e';
  ctx.fillRect(0, 0, S, S);
  const rnd = mulberry32(42);
  for (let i = 0; i < 260; i++) {
    const x = rnd() * S, y = rnd() * S, r = 5 + rnd() * 6;
    wrapDraw(ctx, S, S, x, y, r, (px, py) => {
      const g = ctx.createRadialGradient(px - r * 0.3, py - r * 0.3, r * 0.1, px, py, r);
      g.addColorStop(0, '#d9915a');
      g.addColorStop(0.7, '#a85f32');
      g.addColorStop(1, '#5c3218');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  const t = toTexture(c);
  cache.set('leca', t);
  return t;
}

export function woodTexture(kind = 'drift') {
  const key = 'wood:' + kind;
  if (cache.has(key)) return cache.get(key);
  const W = 256, H = 512;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  const palettes = {
    drift: ['#9a8670', '#b4a28a', '#7d6a55', '#c8b9a1'],
    bark: ['#4b3220', '#3a2616', '#5e412a', '#2c1c10'],
    inner: ['#c49a6c', '#d6b088', '#b08458', '#e0c09a'],
    cork: ['#6d4a30', '#56391f', '#83603f', '#3f2814'],
    bamboo: ['#c9b46a', '#b9a35a', '#d9c67e', '#a8924c'],
    plank: ['#8a5a32', '#7a4e2a', '#9a6a3e', '#6c4424'],
  };
  const pal = palettes[kind] || palettes.drift;
  ctx.fillStyle = pal[0];
  ctx.fillRect(0, 0, W, H);
  const rnd = mulberry32(kind.length * 31 + 7);
  if (kind === 'cork') {
    paintNoise(ctx, W, H, pal[0], 0.6, 77, 6);
    for (let i = 0; i < 500; i++) {
      const x = rnd() * W, y = rnd() * H, r = 2 + rnd() * 9;
      ctx.fillStyle = pal[1 + Math.floor(rnd() * 3)];
      ctx.globalAlpha = 0.6;
      wrapDraw(ctx, W, H, x, y, r * 2, (px, py) => {
        ctx.beginPath();
        ctx.ellipse(px, py, r * 0.6, r * 2, 0, 0, Math.PI * 2);
        ctx.fill();
      });
    }
    ctx.globalAlpha = 1;
  } else {
    // grain streaks along the length (v direction)
    for (let i = 0; i < 160; i++) {
      const x = rnd() * W;
      ctx.strokeStyle = pal[Math.floor(rnd() * pal.length)];
      ctx.globalAlpha = 0.35 + rnd() * 0.5;
      ctx.lineWidth = 1 + rnd() * (kind === 'bark' ? 6 : 3);
      ctx.beginPath();
      let xx = x;
      ctx.moveTo(xx, 0);
      for (let y = 0; y <= H; y += 16) {
        xx = x + Math.sin(y * 0.02 + i) * (kind === 'bark' ? 6 : 3);
        ctx.lineTo(xx, y);
      }
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(xx - W, 0);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    if (kind === 'bark') {
      ctx.fillStyle = 'rgba(15,8,2,0.55)';
      for (let i = 0; i < 120; i++) {
        const x = rnd() * W, y = rnd() * H;
        ctx.fillRect(x, y, 2 + rnd() * 3, 10 + rnd() * 40);
      }
    }
    if (kind === 'bamboo') {
      ctx.fillStyle = 'rgba(80,70,30,0.6)';
      for (let y = 0; y < H; y += 128) ctx.fillRect(0, y, W, 6);
    }
  }
  const t = toTexture(c);
  cache.set(key, t);
  return t;
}

export function screenTexture(dark = true) {
  const key = 'screen' + dark;
  if (cache.has(key)) return cache.get(key);
  const S = 64;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  ctx.strokeStyle = dark ? 'rgba(25,25,25,1)' : 'rgba(230,230,230,1)';
  ctx.lineWidth = 6;
  for (let i = 0; i <= S; i += 16) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, S); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(S, i); ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  cache.set(key, t);
  return t;
}

// Reptile skin painted onto a (u = around body, v = along body) layout.
// v = 0 is the neck, v = bodyFrac is the hips, v = 1 the tail tip.
export function skinTexture(morph, model, bodyFrac) {
  const key = 'skin:' + JSON.stringify(morph) + bodyFrac.toFixed(3);
  if (cache.has(key)) return cache.get(key);
  const W = 256, H = 1024;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  const rnd = mulberry32(morph.id.length * 101 + morph.base.length);
  const vb = bodyFrac * H; // pixel row where the tail starts

  // base: belly at u=0.75 (bottom), back at u=0.25 (top)
  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0.0, morph.base);
  grad.addColorStop(0.42, morph.base);
  grad.addColorStop(0.62, morph.belly);
  grad.addColorStop(0.88, morph.belly);
  grad.addColorStop(1.0, morph.base);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  // tail tint
  if (morph.tail && morph.tail !== morph.base) {
    const tg = ctx.createLinearGradient(0, vb, 0, H);
    tg.addColorStop(0, 'rgba(0,0,0,0)');
    tg.addColorStop(0.25, morph.tail);
    tg.addColorStop(1, morph.tail);
    ctx.fillStyle = tg;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(0, vb, W * 0.55, H - vb);
    ctx.fillRect(W * 0.9, vb, W * 0.1, H - vb);
    ctx.globalAlpha = 1;
  }
  const top = W * 0.25;
  const blob = (x, y, rx, ry, color, a = 1) => {
    ctx.globalAlpha = a;
    ctx.fillStyle = color;
    wrapDraw(ctx, W, 1e9, x, y, rx, (px) => {
      ctx.beginPath();
      ctx.ellipse(px, y, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  };
  switch (morph.pattern) {
    case 'spots':
      // body bands that break into spots
      for (let i = 0; i < 4; i++) {
        const y = H * 0.06 + i * (vb * 0.24);
        ctx.fillStyle = morph.band;
        ctx.globalAlpha = 0.35;
        ctx.fillRect(top - W * 0.18, y, W * 0.36, vb * 0.07);
        ctx.globalAlpha = 1;
      }
      for (let i = 0; i < 170; i++) {
        const u = top + (rnd() - 0.5) * W * 0.55;
        const v = rnd() * H * 0.92;
        blob(u, v, 3 + rnd() * 5, 3 + rnd() * 6, morph.spot, 0.9);
      }
      // tail bands
      for (let i = 0; i < 4; i++) {
        const y = vb + (i + 0.5) * ((H - vb) / 5);
        ctx.fillStyle = morph.band;
        ctx.globalAlpha = 0.55;
        ctx.fillRect(0, y, W, (H - vb) * 0.06);
        ctx.globalAlpha = 1;
      }
      break;
    case 'none':
      break;
    case 'harlequin': {
      // cream dorsal + cream flank patches
      ctx.fillStyle = morph.spot;
      ctx.fillRect(top - W * 0.07, 0, W * 0.14, vb);
      for (let i = 0; i < 12; i++) {
        const v = rnd() * vb;
        blob(top + W * 0.22, v, 10 + rnd() * 12, 14 + rnd() * 22, morph.spot, 0.85);
        blob(top - W * 0.22, v, 10 + rnd() * 12, 14 + rnd() * 22, morph.spot, 0.85);
      }
      for (let i = 0; i < 60; i++) blob(rnd() * W, rnd() * H, 2, 2, '#3a2a1a', 0.25);
      break;
    }
    case 'dorsal':
      ctx.fillStyle = morph.spot;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.moveTo(top - W * 0.1, 0);
      for (let y = 0; y <= vb; y += 20) ctx.lineTo(top - W * (0.08 + 0.03 * Math.sin(y * 0.07)), y);
      for (let y = vb; y >= 0; y -= 20) ctx.lineTo(top + W * (0.08 + 0.03 * Math.sin(y * 0.07)), y);
      ctx.fill();
      ctx.globalAlpha = 1;
      break;
    case 'dots':
      for (let i = 0; i < 70; i++) blob(rnd() * W * 0.6, rnd() * H, 2 + rnd() * 4, 2 + rnd() * 4, morph.spot, 0.95);
      break;
    case 'stripes':
      for (let i = 0; i < 4; i++) {
        const u = top + (i - 1.5) * W * 0.11;
        ctx.fillStyle = morph.band;
        ctx.globalAlpha = 0.75;
        ctx.fillRect(u - 4, 0, 8, H);
      }
      ctx.globalAlpha = 1;
      for (let i = 0; i < 40; i++) blob(top + (rnd() - 0.5) * W * 0.5, rnd() * H, 3 + rnd() * 6, 6 + rnd() * 10, morph.spot, 0.6);
      break;
    case 'blotch':
      for (let i = 0; i < 70; i++) {
        blob(top + (rnd() - 0.5) * W * 0.6, rnd() * H, 6 + rnd() * 10, 6 + rnd() * 14, morph.spot, 0.7);
      }
      for (let i = 0; i < 40; i++) blob(top + (rnd() - 0.5) * W * 0.5, rnd() * H, 3 + rnd() * 5, 3 + rnd() * 5, morph.band, 0.7);
      break;
    case 'redspots':
      // red stripe from eyes down the back, red speckles
      ctx.fillStyle = morph.spot;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(top - 5, 0, 10, vb * 0.25);
      ctx.globalAlpha = 1;
      for (let i = 0; i < 70; i++) {
        blob(top + (rnd() - 0.5) * W * 0.32, rnd() * vb * 1.1, 2 + rnd() * 4, 2 + rnd() * 5, morph.spot, 0.9);
      }
      break;
    case 'bands':
    case 'stripe-bands': {
      ctx.fillStyle = morph.spot;
      ctx.fillRect(0, 0, W * 0.55, H);
      ctx.fillRect(W * 0.95, 0, W * 0.05, H);
      const n = 3;
      for (let i = 0; i < n; i++) {
        const y = H * 0.08 + i * (vb / n);
        blob(top, y + vb / n / 2, W * 0.3, vb / n * 0.26, morph.band, 1);
      }
      for (let i = 0; i < 4; i++) {
        const y = vb + (i + 0.5) * ((H - vb) / 4.5);
        ctx.fillStyle = morph.band;
        ctx.fillRect(0, y, W, (H - vb) * 0.09);
      }
      if (morph.pattern === 'stripe-bands') {
        ctx.fillStyle = morph.band;
        ctx.fillRect(top - 6, 0, 12, H);
      }
      break;
    }
    case 'diamonds':
      for (let i = 0; i < 9; i++) {
        const y = (i + 0.5) * (vb / 8);
        ctx.fillStyle = morph.band;
        ctx.globalAlpha = 0.75;
        ctx.save();
        ctx.translate(top, y);
        ctx.rotate(Math.PI / 4);
        ctx.fillRect(-9, -9, 18, 18);
        ctx.restore();
        blob(top - W * 0.16, y, 8, 10, morph.spot, 0.5);
        blob(top + W * 0.16, y, 8, 10, morph.spot, 0.5);
      }
      ctx.globalAlpha = 1;
      for (let i = 0; i < 6; i++) {
        const y = vb + (i + 0.5) * ((H - vb) / 6.5);
        ctx.fillStyle = morph.spot;
        ctx.globalAlpha = 0.45;
        ctx.fillRect(0, y, W, (H - vb) * 0.05);
      }
      ctx.globalAlpha = 1;
      break;
    case 'skink-bands':
      for (let i = 0; i < 12; i++) {
        const y = (i + 0.4) * (H / 12.5);
        ctx.fillStyle = morph.band;
        ctx.globalAlpha = 0.85;
        ctx.fillRect(0, y, W * 0.58, H / 32);
        ctx.fillRect(W * 0.92, y, W * 0.08, H / 32);
      }
      ctx.globalAlpha = 1;
      break;
  }
  // scales / grain
  const img = ctx.getImageData(0, 0, W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const n = valueNoise(x * 0.5, y * 0.5, 3) * 0.14 - 0.07 + (model.bumps ? (valueNoise(x * 0.18, y * 0.18, 9) > 0.72 ? 0.08 : 0) : 0);
      const i = (y * W + x) * 4;
      img.data[i] = clamp(img.data[i] * (1 + n), 0, 255);
      img.data[i + 1] = clamp(img.data[i + 1] * (1 + n), 0, 255);
      img.data[i + 2] = clamp(img.data[i + 2] * (1 + n), 0, 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = toTexture(c);
  t.wrapT = THREE.ClampToEdgeWrapping;
  cache.set(key, t);
  return t;
}

export function eyeTexture(iris, pupil) {
  const key = 'eye:' + iris + pupil;
  if (cache.has(key)) return cache.get(key);
  const S = 128;
  const c = canvas(S * 2, S);
  const ctx = c.getContext('2d');
  // sphere UV: u around, v top→bottom. The eye looks along +x (u = 0.5 ... centered region)
  ctx.fillStyle = iris;
  ctx.fillRect(0, 0, S * 2, S);
  const cx = S * 1.0, cy = S / 2;
  const g = ctx.createRadialGradient(cx, cy, 4, cx, cy, S * 0.5);
  g.addColorStop(0, 'rgba(255,255,255,0.25)');
  g.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S * 2, S);
  // iris veins
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * 8, cy + Math.sin(a) * 8);
    ctx.lineTo(cx + Math.cos(a) * 40, cy + Math.sin(a) * 30);
    ctx.stroke();
  }
  ctx.fillStyle = '#0a0a0a';
  ctx.beginPath();
  if (pupil === 'slit') ctx.ellipse(cx, cy, 5, S * 0.42, 0, 0, Math.PI * 2);
  else ctx.ellipse(cx, cy, 16, 16 * 0.9, 0, 0, Math.PI * 2);
  ctx.fill();
  const t = toTexture(c, false);
  cache.set(key, t);
  return t;
}

export function gaugeTexture(temp, hum) {
  const c = canvas(256, 160);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#c9d9b8';
  ctx.fillRect(0, 0, 256, 160);
  const g = ctx.createLinearGradient(0, 0, 0, 160);
  g.addColorStop(0, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(0,0,0,0.12)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 160);
  ctx.fillStyle = '#1f2a1a';
  ctx.font = 'bold 64px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.fillText(temp, 128, 72);
  ctx.font = 'bold 42px "Courier New", monospace';
  ctx.fillText(hum, 128, 135);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Simple radial glow sprite for lamps and hearts.
export function glowTexture(color = '255,200,120') {
  const key = 'glow' + color;
  if (cache.has(key)) return cache.get(key);
  const S = 128;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, `rgba(${color},1)`);
  g.addColorStop(0.3, `rgba(${color},0.45)`);
  g.addColorStop(1, `rgba(${color},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, t);
  return t;
}


