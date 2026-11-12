// UI: panels, toolbars, modals and keyboard shortcuts for the terrarium planner.
import { SPECIES, SPECIES_ORDER, TANK_PRESETS, TANK_STYLES, BACKGROUNDS, SUBSTRATES, SUBSTRATE_ORDER, MISTING, CATEGORIES, ITEMS, TEMPLATES } from './data.js';
import { Store, defaultState, validState } from './store.js';
import { Viewer } from './viewer.js';
import { evaluate, WATTS } from './climate.js';
import { generateTerrain, emptyHeights } from './terrain.js';
import { substrateSwatch } from './textures.js';
import { thumbImg } from './thumbs.js';
import { el, uid, randomSeed, clamp, units, fmtTemp, fmtTempRange, fmtDims, fmtVolume, fmtLen, gallons, thermalCss, THERMAL_MIN, THERMAL_MAX, pick } from './util.js';

const $ = (s, r = document) => r.querySelector(s);
const store = new Store();
units.system = store.get().units || 'imperial';

const ui = {
  tab: 'animal',
  decorCat: 'all',
  sculpt: { active: false, mode: 'raise', radius: 4, strength: 1 },
};

// ------------------------------------------------------------------ viewer
const viewer = new Viewer($('#viewport'), store, {
  onStats: (stats) => onStats(stats),
  onSelect: (id) => renderSelBar(id),
  onDropItem: (type, point) => addItem(type, point),
});

store.subscribe((state, meta) => {
  units.system = state.units || 'imperial';
  viewer.sync(state, meta);
  if (meta.source !== 'input') renderTab();
  renderTopbar();
  if (viewer.selected) renderSelBar(viewer.selected);
});

// ------------------------------------------------------------------ helpers
function toast(msg, action) {
  const t = el('div', { class: 'toast' }, [el('span', { text: msg })]);
  if (action) t.append(el('button', { class: 'btn small primary', text: action.label, onclick: () => { action.run(); t.remove(); } }));
  $('#toasts').append(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, action ? 7000 : 3200);
}

// Live edits (sliders, typing) update the view continuously but make one undo step.
let gesture = null;
function live(mutator) {
  if (!gesture) gesture = JSON.stringify(store.get());
  store.commit(mutator, { merge: true, source: 'input' });
}
function endGesture() {
  if (!gesture) return;
  const before = JSON.parse(gesture);
  if (gesture !== JSON.stringify(store.get())) {
    store.undoStack.push(gesture);
    store.redoStack = [];
  }
  gesture = null;
  const t = store.get().tank;
  if ((before.tank.L !== t.L || before.tank.W !== t.W || before.tank.H !== t.H) && !viewer.userMovedCamera) viewer.resetCamera();
  renderTab();
  renderTopbar();
}

function speciesFactor(state = store.get()) {
  return clamp(SPECIES[state.species].model.body / 4.2, 1, 1.6);
}

function seg(options, value, onPick) {
  return el('div', { class: 'seg', role: 'radiogroup' }, options.map(([v, label, title]) =>
    el('button', { class: v === value ? 'on' : '', role: 'radio', 'aria-checked': v === value ? 'true' : 'false', title, onclick: () => onPick(v) }, label)));
}

function slider({ label, min, max, step = 1, value, fmt, onInput }) {
  const out = el('output', { text: fmt(value) });
  const input = el('input', { type: 'range', min, max, step, value });
  input.addEventListener('input', () => { out.textContent = fmt(+input.value); onInput(+input.value); });
  input.addEventListener('change', () => endGesture());
  return el('label', { class: 'slider' }, [el('span', { class: 'slider-label' }, [label, out]), input]);
}

function section(title, children, sub) {
  return el('section', { class: 'card' }, [el('h3', {}, [title, sub ? el('small', { text: sub }) : null]), ...[].concat(children)]);
}

function dimText(v) {
  return units.system === 'metric' ? `${Math.round(v.x * 2.54)} × ${Math.round(v.z * 2.54)} × ${Math.round(v.y * 2.54)} cm` : `${v.x.toFixed(1)} × ${v.z.toFixed(1)} × ${v.y.toFixed(1)} in`;
}

// ------------------------------------------------------------------ item placement
function bgDepth(state) {
  return { none: 0, rock: 1.7, sandstone: 1.8, cork: 1.2 }[state.tank.background] || 0;
}

function findSpot(type, state) {
  const { L, W, H } = state.tank;
  const def = ITEMS[type];
  if (def.mount === 'top') {
    const lamps = state.items.filter((i) => i.type === 'heatLamp');
    if (type === 'heatLamp') return { x: -L * 0.3 + lamps.length * 6, z: -W * 0.05 };
    return { x: 0, z: -W * 0.15 };
  }
  if (def.mount === 'under') return { x: -L * 0.28, z: 0 };
  if (def.mount === 'wall') {
    const wall = pick(['back', 'back', 'left', 'right']);
    const span = (wall === 'back' ? L : W) / 2 - 3;
    return { wall, a: +((Math.random() * 2 - 1) * span).toFixed(2), y: +(H * (0.45 + Math.random() * 0.3)).toFixed(2) };
  }
  // ground: the most open spot
  const bg = bgDepth(state);
  const others = state.items.filter((i) => ITEMS[i.type].mount === 'ground');
  let best = null, bestD = -1;
  for (let k = 0; k < 40; k++) {
    const x = (Math.random() - 0.5) * (L - 6);
    const z = (Math.random() - 0.5) * (W - 5 - bg) + bg / 2;
    let d = Math.min(L, W);
    for (const o of others) d = Math.min(d, Math.hypot(o.x - x, o.z - z));
    if (d > bestD) { bestD = d; best = { x: +x.toFixed(2), z: +z.toFixed(2) }; }
  }
  return best;
}

function newItem(type, at, state = store.get()) {
  const def = ITEMS[type];
  const it = { id: uid(), type, seed: randomSeed(), rot: def.mount === 'ground' ? +(Math.random() * 6.28).toFixed(2) : 0, scale: 1 };
  if (['hides', 'food'].includes(def.cat) || ['slateStack', 'boulder'].includes(type)) it.scale = +speciesFactor(state).toFixed(2);
  if (type === 'heatLamp') it.watts = def.watts;
  if (type === 'uvb' || type === 'heatMat') it.rot = 0;
  Object.assign(it, at || findSpot(type, state));
  fitScale(it, state);
  return it;
}

// keep tall things inside the tank
const ITEM_HEIGHT = { driftwood: 11.5, bamboo: 18, snakePlant: 12, column: 8.5, elephantBush: 9.5 };
function fitScale(it, state) {
  const h = ITEM_HEIGHT[it.type];
  if (!h) return;
  const room = state.tank.H - state.depth - 3.5;
  if (h * it.scale > room) it.scale = +Math.max(0.4, room / h).toFixed(2);
  if (it.type === 'driftwood' && 15 * it.scale > state.tank.L - 3) it.scale = +((state.tank.L - 3) / 15).toFixed(2);
}

function addItem(type, at) {
  const it = newItem(type, at || null);
  store.commit((s) => { s.items.push(it); });
  viewer.select(it.id);
  if (ITEMS[type].mount === 'top') toast(`${ITEMS[type].name} added to the lid. Drag it to move it.`);
}

function removeItem(id) {
  if (id === 'animal') {
    store.commit((s) => { s.animal = { ...(s.animal || {}), show: false }; });
  } else {
    store.commit((s) => { s.items = s.items.filter((i) => i.id !== id); });
  }
  viewer.select(null);
}

function duplicateItem(id) {
  const s = store.get();
  const src = s.items.find((i) => i.id === id);
  if (!src) return;
  const copy = { ...src, id: uid(), seed: randomSeed() };
  if (ITEMS[src.type].mount === 'wall') copy.a = (src.a || 0) + 4;
  else copy.x = clamp((src.x || 0) + 4, -s.tank.L / 2 + 2, s.tank.L / 2 - 2);
  store.commit((st) => { st.items.push(copy); });
  viewer.select(copy.id);
}

function updateItem(id, patch, opts) {
  const fn = id === 'animal'
    ? (s) => { s.animal = { ...(s.animal || {}), ...patch }; }
    : (s) => { const it = s.items.find((i) => i.id === id); if (it) Object.assign(it, patch); };
  if (opts?.live) live(fn);
  else store.commit(fn);
}

// ------------------------------------------------------------------ starter layout
function buildStarter(speciesId, { first = false } = {}) {
  const tpl = TEMPLATES[speciesId];
  const sp = SPECIES[speciesId];
  const next = JSON.parse(JSON.stringify(store.get()));
  next.species = speciesId;
  const p = TANK_PRESETS.find((t) => t.id === tpl.tank);
  next.tank = { ...next.tank, preset: p.id, L: p.L, W: p.W, H: p.H, style: p.style, background: tpl.background };
  next.substrate = tpl.substrate;
  next.depth = tpl.depth;
  next.misting = tpl.misting;
  next.terrain = generateTerrain(tpl.terrain, randomSeed());
  next.animal = { show: next.animal?.show !== false };
  const { L, W, H } = next.tank;
  next.items = tpl.items.map((row) => {
    const def = ITEMS[row[0]];
    if (def.mount === 'wall') {
      const [type, wall, u, h] = row;
      const span = (wall === 'back' || wall === 'front' ? L : W) - 4;
      return newItem(type, { wall, a: +(u * span).toFixed(2), y: +(h * H).toFixed(2) }, next);
    }
    const [type, u, v, extra = {}] = row;
    const it = newItem(type, { x: +(u * (L - 2)).toFixed(2), z: +(v * (W - 2)).toFixed(2) }, next);
    if (extra.rot != null) it.rot = extra.rot;
    if (extra.scale != null) it.scale = extra.scale;
    if (extra.watts) it.watts = extra.watts;
    fitScale(it, next);
    return it;
  });
  store.replace(next, { starter: true });
  // pick the bulb wattage that puts the basking spot in range
  const best = viewer.bestWattage(WATTS, sp);
  if (best) store.commit((s) => s.items.forEach((i) => { if (i.type === 'heatLamp') i.watts = best; }), { merge: true });
  viewer.select(null);
  viewer.userMovedCamera = false;
  viewer.resetCamera();
  if (!first) toast(`Starter layout for a ${sp.name.toLowerCase()} is ready. Change anything you like.`);
}

// ------------------------------------------------------------------ habitat check
function onStats(stats) {
  const result = evaluate(store.get(), stats);
  ui.result = result;
  ui.stats = stats;
  const met = result.checks.filter((c) => c.status === 'good').length;
  const pill = $('#scorePill');
  pill.querySelector('.pct').textContent = `${met} of ${result.checks.length}`;
  pill.querySelector('.word').textContent = 'requirements met';
  pill.querySelector('.bar i').style.width = result.score + '%';
  pill.style.setProperty('--score-color', scoreColor(result.score));
  const bad = result.checks.filter((c) => c.status === 'bad').length;
  const warn = result.checks.filter((c) => c.status === 'warn').length;
  const state = pill.querySelector('.state');
  state.textContent = bad ? `${bad} to fix` : warn ? `${warn} to review` : 'All good';
  state.className = 'state ' + (bad ? 'bad' : warn ? 'warn' : 'good');
  renderChips(stats);
  if (ui.tab === 'check' || ui.tab === 'shop') renderTab();
}

function scoreColor(s) {
  return s >= 85 ? '#1f9d6b' : s >= 65 ? '#7aa83a' : s >= 45 ? '#e0a020' : '#e0583a';
}

function renderChips(stats) {
  const s = store.get();
  const sp = SPECIES[s.species];
  const inR = (v, [a, b]) => v >= a && v <= b;
  const hotOk = sp.hot[0] > 80 ? inR(stats.hot, sp.hot) : stats.hot <= sp.hot[1];
  $('#chips').replaceChildren(
    el('span', { class: 'chip ' + (hotOk ? 'ok' : 'warn'), title: 'Warmest surface (lights on)' }, ['Warm ', el('b', { text: fmtTemp(stats.hot) })]),
    el('span', { class: 'chip ' + (inR(stats.cool, sp.cool) ? 'ok' : 'warn'), title: 'Coolest surface (lights on)' }, ['Cool ', el('b', { text: fmtTemp(stats.cool) })]),
    el('span', { class: 'chip ' + (inR(stats.humidity, sp.humidity) ? 'ok' : 'warn'), title: 'Estimated humidity' }, ['Humidity ', el('b', { text: stats.humidity + '%' })]),
    el('span', { class: 'chip', title: 'Tank volume' }, [el('b', { text: fmtVolume(s.tank.L, s.tank.W, s.tank.H) })])
  );
}

// ------------------------------------------------------------------ top bar
function renderTopbar() {
  const n = $('#designName');
  if (document.activeElement !== n) n.value = store.get().name;
  $('#undoBtn').disabled = !store.undoStack.length;
  $('#redoBtn').disabled = !store.redoStack.length;
}

// ------------------------------------------------------------------ tabs
const TABS = [
  ['animal', '🦎', 'Animal'],
  ['tank', '🏠', 'Tank'],
  ['ground', '⛰️', 'Ground'],
  ['decor', '🪴', 'Decor'],
  ['check', '✅', 'Check'],
  ['shop', '🛒', 'Shopping'],
];

function renderTabs() {
  $('#tabs').replaceChildren(...TABS.map(([id, icon, label]) =>
    el('button', { role: 'tab', 'aria-selected': ui.tab === id ? 'true' : 'false', class: ui.tab === id ? 'on' : '', onclick: () => setTab(id) }, [el('span', { class: 'ico', text: icon }), el('span', { text: label })])));
}

function setTab(id) {
  if (ui.tab === 'ground' && id !== 'ground') setSculpt({ active: false });
  ui.tab = id;
  renderTabs();
  renderTab();
  $('#tabBody').scrollTop = 0;
}

function renderTab() {
  const body = $('#tabBody');
  const keep = body.scrollTop;
  const fn = { animal: renderAnimal, tank: renderTank, ground: renderGround, decor: renderDecor, check: renderCheck, shop: renderShop }[ui.tab];
  body.replaceChildren(...[].concat(fn()).filter(Boolean));
  body.scrollTop = keep;
}

function reqTable(sp) {
  const rows = [
    ['Minimum tank', fmtDims(sp.minTank.L, sp.minTank.W, sp.minTank.H)],
    [sp.hot[0] > 80 ? 'Basking spot' : 'Warmest spot', fmtTempRange(sp.hot)],
    ['Cool side', fmtTempRange(sp.cool)],
    ['Night low', '≥ ' + fmtTemp(sp.nightMin)],
    ['Humidity', `${sp.humidity[0]}–${sp.humidity[1]}%`],
    ['UVB', sp.uvb === 'required' ? 'Required' : 'Recommended'],
    ['Hides', sp.lifestyle === 'arboreal' ? 'Leafy cover, up high' : `${sp.minHides}+ (warm, cool${sp.needsHumidHide ? ', humid' : ''})`],
    ['Lifestyle', `${sp.lifestyle === 'arboreal' ? 'Climber' : 'Ground dweller'}, ${sp.activity === 'diurnal' ? 'active by day' : 'active at night'}`],
    ['Climate', sp.habitat === 'arid' ? 'Desert' : sp.habitat === 'tropical' ? 'Rainforest' : 'Semi-arid'],
    ['Adult size', sp.size],
    ['Lifespan', sp.lifespan],
    ['Diet', sp.diet],
  ];
  return el('dl', { class: 'care' }, rows.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })]));
}

// ---- Animal
function renderAnimal() {
  const s = store.get();
  const sp = SPECIES[s.species];
  const grid = el('div', { class: 'pet-grid' }, SPECIES_ORDER.map((id) => {
    const p = SPECIES[id];
    return el('button', { class: 'pet-card' + (id === s.species ? ' on' : ''), onclick: () => pickSpecies(id), title: p.blurb }, [
      thumbImg('pet', [id, p.morphs[0].id], '🦎', 'pet-thumb'),
      el('strong', { text: p.name }),
      el('small', { text: p.lifestyle === 'arboreal' ? 'Climber' : 'Ground dweller' }),
    ]);
  }));
  const showing = s.animal?.show !== false;
  return [
    section('Which animal is it for?', [grid, el('p', { class: 'hint', text: 'The checklist, starter layout and plant suggestions all follow this choice.' })]),
    section(sp.name, [
      el('p', { class: 'sci', text: sp.sci }),
      el('p', { text: sp.blurb }),
      reqTable(sp),
      el('button', { class: 'btn primary big', onclick: () => buildStarter(s.species) }, '✨ Build a starter layout'),
      el('p', { class: 'hint', text: 'Replaces the current design with a recommended tank, substrate, decor and lighting for this animal.' }),
    ], 'care requirements'),
    section('Size reference', [
      el('p', { class: 'hint', text: `A life-size adult ${sp.name.toLowerCase()} (${sp.size}) is shown in the tank so you can check that hides, branches and dishes fit. Drag it around to try different spots.` }),
      el('div', { class: 'btn-row' }, [
        el('button', { class: 'btn' + (showing ? ' primary' : ''), onclick: () => store.commit((st) => { st.animal = { ...(st.animal || {}), show: !showing }; }) }, showing ? '👁 Showing model' : '👁 Show model'),
        showing ? el('button', { class: 'btn', onclick: () => store.commit((st) => { st.animal = { show: true }; }) }, '↺ Reset position') : null,
      ]),
    ]),
    section('Good to know', el('ul', { class: 'facts' }, sp.facts.map((f) => el('li', { text: f })))),
  ];
}

function pickSpecies(id) {
  const s = store.get();
  if (id === s.species) return;
  const sp = SPECIES[id];
  store.commit((st) => { st.species = id; st.animal = { show: st.animal?.show !== false }; });
  if (s.items.length) toast(`Now checking against ${sp.name} needs.`, { label: '✨ Starter layout', run: () => buildStarter(id) });
  else buildStarter(id);
}

// ---- Tank
function renderTank() {
  const s = store.get();
  const sp = SPECIES[s.species];
  const m = sp.minTank;
  const fits = (t) => t.L >= m.L && t.W >= m.W && t.H >= m.H;
  const presets = el('div', { class: 'preset-grid' }, TANK_PRESETS.map((p) =>
    el('button', { class: 'preset' + (s.tank.preset === p.id ? ' on' : ''), onclick: () => setTankSize(p.L, p.W, p.H, p.id, p.style) }, [
      el('span', { class: 'mini-tank', style: { '--l': p.L, '--h': p.H } }, el('i')),
      el('strong', { text: p.name }),
      el('small', { text: `${fmtDims(p.L, p.W, p.H)} · ${fmtVolume(p.L, p.W, p.H)}` }),
      el('em', { class: fits(p) ? 'fit' : 'nofit', text: fits(p) ? '✓ Meets minimum' : '✗ Below minimum' }),
    ])));
  const dimFmt = (v) => fmtLen(v);
  return [
    section('Tank size', [
      el('p', { class: 'hint' }, [`Minimum for a ${sp.name.toLowerCase()}: `, el('b', { text: fmtDims(m.L, m.W, m.H) }), sp.lifestyle === 'arboreal' ? ' (tall — it climbs).' : ' (long — it roams the floor).']),
      presets,
    ]),
    section('Custom size', [
      slider({ label: 'Length (left to right)', min: 12, max: 72, value: s.tank.L, fmt: dimFmt, onInput: (v) => setTankSize(v, s.tank.W, s.tank.H, 'custom', null, true) }),
      slider({ label: 'Depth (front to back)', min: 12, max: 36, value: s.tank.W, fmt: dimFmt, onInput: (v) => setTankSize(s.tank.L, v, s.tank.H, 'custom', null, true) }),
      slider({ label: 'Height', min: 12, max: 48, value: s.tank.H, fmt: dimFmt, onInput: (v) => setTankSize(s.tank.L, s.tank.W, v, 'custom', null, true) }),
    ], fmtVolume(s.tank.L, s.tank.W, s.tank.H)),
    section('Enclosure type', seg(Object.entries(TANK_STYLES).map(([k, v]) => [k, v.short, v.name]), s.tank.style, (v) => store.commit((st) => { st.tank.style = v; }))),
    section('Background', el('div', { class: 'swatch-row' }, Object.entries(BACKGROUNDS).map(([k, b]) =>
      el('button', { class: 'bg-swatch' + (s.tank.background === k ? ' on' : ''), onclick: () => store.commit((st) => { st.tank.background = k; }) }, [el('span', { style: { background: b.swatch } }), el('small', { text: b.name })])))),
    section('Room & care', [
      slider({ label: 'Room temperature', min: 60, max: 85, value: s.room, fmt: (v) => fmtTemp(v), onInput: (v) => live((st) => { st.room = v; }) }),
      el('h4', { text: 'Misting' }),
      seg(Object.entries(MISTING).map(([k, v]) => [k, v.name]), s.misting, (v) => store.commit((st) => { st.misting = v; })),
      el('h4', { text: 'Units' }),
      seg([['imperial', '°F · inches'], ['metric', '°C · cm']], s.units, (v) => store.commit((st) => { st.units = v; })),
    ]),
  ];
}

function setTankSize(L, W, H, preset, style, isLive) {
  const fn = (st) => {
    const o = st.tank;
    const kx = L / o.L, kz = W / o.W, ky = H / o.H;
    for (const it of st.items) {
      if (ITEMS[it.type].mount === 'wall') {
        it.a = +((it.a || 0) * (it.wall === 'back' || it.wall === 'front' ? kx : kz)).toFixed(2);
        it.y = +((it.y || 0) * ky).toFixed(2);
      } else {
        it.x = +((it.x || 0) * kx).toFixed(2);
        it.z = +((it.z || 0) * kz).toFixed(2);
      }
    }
    if (st.animal && st.animal.x != null) { st.animal.x *= kx; st.animal.z *= kz; }
    st.tank = { ...o, L, W, H, preset: preset || 'custom', style: style || o.style };
    for (const it of st.items) fitScale(it, st);
  };
  if (isLive) live(fn);
  else {
    store.commit(fn);
    if (!viewer.userMovedCamera) viewer.resetCamera();
  }
}

// ---- Ground
function setSculpt(patch) {
  Object.assign(ui.sculpt, patch);
  viewer.setSculpt(ui.sculpt);
  $('#stage').classList.toggle('sculpting', ui.sculpt.active);
}

function renderGround() {
  const s = store.get();
  const subs = el('div', { class: 'sub-grid' }, SUBSTRATE_ORDER.map((id) => {
    const sub = SUBSTRATES[id];
    const good = sub.good.includes(s.species), bad = sub.bad.includes(s.species);
    return el('button', { class: 'sub-card' + (s.substrate === id ? ' on' : ''), onclick: () => pickSubstrate(id) }, [
      el('img', { src: substrateSwatch(id, sub), alt: '' }),
      el('span', {}, [el('strong', { text: sub.name }), el('small', { text: sub.desc })]),
      bad ? el('em', { class: 'nofit', text: '✗ Avoid' }) : good ? el('em', { class: 'fit', text: '✓ Suitable' }) : null,
    ]);
  }));
  const tools = seg([['raise', '⛰️ Raise'], ['lower', '🕳️ Dig'], ['smooth', '〰️ Smooth'], ['flatten', '▬ Flatten']], ui.sculpt.mode, (v) => { setSculpt({ mode: v, active: true }); renderTab(); });
  const sculptToggle = el('button', { class: 'btn ' + (ui.sculpt.active ? 'primary' : ''), onclick: () => { setSculpt({ active: !ui.sculpt.active }); renderTab(); } }, ui.sculpt.active ? '✋ Sculpting (click to stop)' : '✋ Sculpt the ground');
  const presets = el('div', { class: 'btn-row' }, [
    ['flat', '▬ Flat'], ['hills', '⛰️ Hills'], ['dunes', '🏜️ Dunes'], ['slope', '📐 Back slope'], ['valley', '🏞️ Valley'],
  ].map(([k, label]) => el('button', { class: 'btn small', onclick: () => store.commit((st) => { st.terrain = k === 'flat' ? emptyHeights() : generateTerrain(k, randomSeed()); }, { terrain: true }) }, label)));
  const sub = SUBSTRATES[s.substrate];
  return [
    section('Substrate', subs, 'floor covering'),
    section('Depth', [
      slider({ label: 'Base depth', min: 0.5, max: 6, step: 0.5, value: s.depth, fmt: (v) => fmtLen(v, 1), onInput: (v) => live((st) => { st.depth = v; }) }),
      sub.bioactive ? el('p', { class: 'hint', text: `Bioactive: a ${fmtLen(1.5, 1)} drainage layer of clay balls goes underneath, separated by a mesh barrier.` }) : null,
    ]),
    section('Landscape', [
      el('p', { class: 'hint', text: 'Raise hills and dig low spots. Drag on the ground in the 3D view to sculpt; right-drag (or two fingers) still moves the camera.' }),
      sculptToggle,
      ui.sculpt.active ? tools : null,
      ui.sculpt.active ? slider({ label: 'Brush size', min: 1.5, max: 10, step: 0.5, value: ui.sculpt.radius, fmt: (v) => fmtLen(v, 1), onInput: (v) => setSculpt({ radius: v }) }) : null,
      ui.sculpt.active ? slider({ label: 'Strength', min: 0.2, max: 3, step: 0.1, value: ui.sculpt.strength, fmt: (v) => v.toFixed(1) + '×', onInput: (v) => setSculpt({ strength: v }) }) : null,
      el('h4', { text: 'Quick shapes' }),
      presets,
    ]),
  ];
}

function pickSubstrate(id) {
  const sub = SUBSTRATES[id];
  store.commit((st) => {
    st.substrate = id;
    if (sub.flat) { st.depth = 0.5; st.terrain = emptyHeights(); }
    else if (st.depth < 2) st.depth = 3;
  }, { terrain: true });
  if (sub.bad.includes(store.get().species)) toast('⚠️ ' + sub.desc);
}

// ---- Decor
function renderDecor() {
  const s = store.get();
  const sp = SPECIES[s.species];
  const chips = el('div', { class: 'chips-row' }, CATEGORIES.map((c) =>
    el('button', { class: 'pill' + (ui.decorCat === c.id ? ' on' : ''), onclick: () => { ui.decorCat = c.id; renderTab(); } }, c.name)));
  const list = Object.entries(ITEMS).filter(([, d]) => ui.decorCat === 'all' || d.cat === ui.decorCat);
  const grid = el('div', { class: 'item-grid' }, list.map(([type, d]) => {
    let badge = null;
    if (d.climate && d.climate !== 'both') {
      const mismatch = (d.climate === 'arid' && sp.habitat === 'tropical') || (d.climate === 'tropical' && sp.habitat === 'arid');
      badge = el('em', { class: mismatch ? 'nofit' : 'fit', text: d.climate === 'arid' ? 'Desert' : 'Tropical', title: mismatch ? `Not suited to a ${sp.name.toLowerCase()} tank` : 'Suits this climate' });
    }
    const card = el('button', { class: 'item-card', draggable: 'true', title: d.desc, onclick: () => addItem(type) }, [
      thumbImg('item', [type], d.icon),
      el('strong', { text: d.name }),
      badge,
    ]);
    card.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/item', type); e.dataTransfer.effectAllowed = 'copy'; });
    return card;
  }));
  const placed = s.items.map((it) => {
    const d = ITEMS[it.type];
    return el('div', { class: 'placed' + (viewer.selected === it.id ? ' on' : '') }, [
      el('button', { class: 'placed-name', onclick: () => viewer.select(it.id) }, [el('span', { text: d.icon }), d.name, it.type === 'heatLamp' ? el('small', { text: ` ${it.watts}W` }) : null]),
      el('button', { class: 'btn icon small', title: 'Remove', 'aria-label': `Remove ${d.name}`, text: '✕', onclick: () => removeItem(it.id) }),
    ]);
  });
  return [
    section('Add to the tank', [el('p', { class: 'hint', text: 'Click to add, or drag into the 3D view. Click anything in the tank to move, turn or resize it.' }), chips, grid]),
    section(`In the tank (${s.items.length})`, placed.length ? el('div', { class: 'placed-list' }, placed) : el('p', { class: 'hint', text: 'Empty. Add hides, a water dish and some plants.' })),
    s.items.length ? el('button', { class: 'btn danger small', onclick: () => { if (confirm('Remove everything from the tank?')) store.commit((st) => { st.items = []; }); } }, '🧹 Remove all decor') : null,
  ];
}

// ---- Check
function renderCheck() {
  const s = store.get();
  const sp = SPECIES[s.species];
  const r = ui.result, st = ui.stats;
  if (!r) return el('p', { text: 'Loading…' });
  const met = r.checks.filter((c) => c.status === 'good').length;
  const C = 2 * Math.PI * 52;
  const ring = el('div', { class: 'ring', html: `<svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="52" class="track"/><circle cx="60" cy="60" r="52" class="val" stroke="${scoreColor(r.score)}" stroke-dasharray="${(C * r.score) / 100} ${C}" transform="rotate(-90 60 60)"/></svg>` }, [
    el('div', { class: 'ring-text' }, [el('b', { text: `${met}/${r.checks.length}` }), el('small', { text: 'met' })]),
  ]);
  const todo = r.checks.filter((c) => c.status !== 'good');
  const hero = el('div', { class: 'score-hero' }, [
    ring,
    el('div', {}, [
      el('h3', { text: todo.length ? `${todo.length} thing${todo.length > 1 ? 's' : ''} to look at` : `Meets every ${sp.name.toLowerCase()} requirement` }),
      el('p', { class: 'hint', text: todo.length ? `Start with: ${todo[0].title.toLowerCase()}.` : 'Nice planning. Double-check with a real thermometer once it is set up.' }),
    ]),
  ]);
  const table = el('table', { class: 'req-table' }, [
    el('thead', {}, el('tr', {}, [el('th', { text: '' }), el('th', { text: 'Requirement' }), el('th', { text: 'Your setup' }), el('th', { text: 'Target' })])),
    el('tbody', {}, r.checks.flatMap((c) => [
      el('tr', { class: c.status }, [
        el('td', {}, el('span', { class: 'check-ico', text: c.status === 'good' ? '✓' : c.status === 'warn' ? '!' : '✗', title: c.status })),
        el('td', {}, el('strong', { text: c.label || c.title })),
        el('td', { class: 'val', text: c.value ?? '' }),
        el('td', { class: 'tgt', text: c.target ?? '' }),
      ]),
      c.status !== 'good' ? el('tr', { class: 'note ' + c.status }, [el('td'), el('td', { colspan: 3, text: c.detail })]) : null,
    ].filter(Boolean))),
  ]);
  const humid = el('details', { class: 'humid-break' }, [
    el('summary', { text: 'How the humidity estimate works' }),
    el('ul', {}, st.humidityParts.map((p) => el('li', {}, [p.label, el('b', { text: `${p.value > 0 ? '+' : ''}${p.value}%` })]))),
  ]);
  return [
    section('Habitat check', [hero, table, humid], sp.name),
    el('p', { class: 'hint pad', text: 'Temperatures and humidity are planning estimates from bulb wattage, distance and materials. Confirm with a digital thermometer/hygrometer and an infrared temp gun once the enclosure is running.' }),
  ];
}

// ---- Shopping list
function shoppingList() {
  const s = store.get();
  const sp = SPECIES[s.species];
  const { L, W, H } = s.tank;
  const rows = [];
  const preset = TANK_PRESETS.find((p) => p.id === s.tank.preset);
  const vol = gallons(L, W, H);
  rows.push({ group: 'Enclosure', name: `${preset ? preset.name : 'Custom'} — ${TANK_STYLES[s.tank.style].name.toLowerCase()}`, note: fmtDims(L, W, H), qty: 1, price: [Math.round(vol * 2.2 + 40), Math.round(vol * 4 + 80)] });
  if (s.tank.background !== 'none') rows.push({ group: 'Enclosure', name: BACKGROUNDS[s.tank.background].name + ' background', qty: 1, price: [25, 60] });
  const sub = SUBSTRATES[s.substrate];
  const depth = ui.stats ? ui.stats.avgDepth : s.depth;
  const cubicIn = L * W * Math.max(0.3, depth);
  const qty = units.system === 'metric' ? `about ${Math.ceil(cubicIn * 0.016387)} L` : `about ${Math.ceil(cubicIn / 57.75)} qt`;
  rows.push({ group: 'Substrate', name: sub.name, note: sub.perQuart ? `${qty} (avg depth ${fmtLen(depth, 1)})` : 'cut to fit', qty: 1, price: sub.perQuart ? [Math.round((cubicIn / 57.75) * sub.perQuart * 0.8 + 5), Math.round((cubicIn / 57.75) * sub.perQuart * 1.4 + 10)] : sub.price });
  if (sub.bioactive) {
    const leca = L * W * 1.5;
    rows.push({ group: 'Substrate', name: 'Drainage layer (clay balls)', note: units.system === 'metric' ? `about ${Math.ceil(leca * 0.016387)} L` : `about ${Math.ceil(leca / 57.75)} qt`, qty: 1, price: [12, 25] });
    rows.push({ group: 'Substrate', name: 'Substrate barrier mesh', note: `${fmtLen(L)} × ${fmtLen(W)}`, qty: 1, price: [6, 12] });
  }
  const counts = {};
  for (const it of s.items) {
    const key = it.type === 'heatLamp' ? `heatLamp:${it.watts}` : it.type;
    counts[key] = (counts[key] || 0) + 1;
  }
  const groupName = { hides: 'Hides', wood: 'Wood & rock', plants: 'Plants & bio', food: 'Food & water', tech: 'Heat & light' };
  for (const [key, n] of Object.entries(counts)) {
    const [type, w] = key.split(':');
    const d = ITEMS[type];
    rows.push({ group: groupName[d.cat], name: d.name + (w ? ` (${w}W bulb)` : ''), qty: n, price: d.price });
  }
  const extras = [];
  if (s.items.some((i) => i.type === 'heatLamp' || i.type === 'heatMat')) extras.push({ name: 'Thermostat', price: [25, 45], why: 'stops heat sources overheating' });
  if (!s.items.some((i) => i.type === 'gauge')) extras.push({ name: 'Digital thermometer + hygrometer', price: [8, 15], why: 'to confirm the real numbers' });
  extras.push({ name: 'Infrared temp gun', price: [15, 25], why: 'reads basking surface temperature' });
  if (s.items.some((i) => i.type === 'heatLamp' || i.type === 'uvb')) extras.push({ name: 'Outlet timer', price: [8, 15], why: 'day/night light cycle' });
  if (sp.foods.includes('crickets') || sp.foods.includes('mealworms')) extras.push({ name: 'Calcium + D3 powder', price: [8, 12], why: 'dust insects before feeding' });
  if (sp.foods.includes('fruit')) extras.push({ name: 'Complete gecko diet powder', price: [10, 20], why: 'main food for fruit-eating geckos' });
  if (s.misting !== 'none') extras.push({ name: 'Spray bottle or mister', price: [6, 15], why: 'for the misting schedule' });
  extras.push({ name: 'Reptile-safe cleaner', price: [8, 14], why: 'spot cleaning' });
  return { rows, extras };
}

function money([a, b]) {
  return a === b ? `$${a}` : `$${a}–${b}`;
}

function renderShop() {
  const { rows, extras } = shoppingList();
  const groups = {};
  for (const r of rows) (groups[r.group] = groups[r.group] || []).push(r);
  let lo = 0, hi = 0;
  for (const r of rows) { lo += r.price[0] * r.qty; hi += r.price[1] * r.qty; }
  let elo = 0, ehi = 0;
  for (const x of extras) { elo += x.price[0]; ehi += x.price[1]; }
  const table = el('div', { class: 'shop' }, Object.entries(groups).map(([g, list]) => el('div', { class: 'shop-group' }, [
    el('h4', { text: g }),
    ...list.map((r) => el('div', { class: 'shop-row' }, [
      el('span', {}, [r.qty > 1 ? el('b', { text: r.qty + '× ' }) : null, r.name, r.note ? el('small', { text: ' · ' + r.note }) : null]),
      el('span', { class: 'price', text: money([r.price[0] * r.qty, r.price[1] * r.qty]) }),
    ])),
  ])));
  const extra = el('div', { class: 'shop' }, extras.map((x) => el('div', { class: 'shop-row' }, [
    el('span', {}, [x.name, el('small', { text: ' · ' + x.why })]),
    el('span', { class: 'price', text: money(x.price) }),
  ])));
  return [
    section('Shopping list', [
      table,
      el('div', { class: 'total' }, [el('span', { text: 'Habitat estimate' }), el('b', { text: money([lo, hi]) })]),
      el('p', { class: 'hint', text: 'Rough US price ranges for budgeting. Actual prices vary by store and brand.' }),
    ]),
    section('Also needed', [extra, el('div', { class: 'total small' }, [el('span', { text: 'Extras' }), el('b', { text: money([elo, ehi]) })])]),
    el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn primary', onclick: printList }, '🖨️ Print plan'),
      el('button', { class: 'btn', onclick: copyList }, '📋 Copy as text'),
    ]),
  ];
}

function listText() {
  const s = store.get();
  const { rows, extras } = shoppingList();
  const lines = [`${s.name} — ${SPECIES[s.species].name} (${fmtDims(s.tank.L, s.tank.W, s.tank.H)})`, ''];
  for (const r of rows) lines.push(`[ ] ${r.qty > 1 ? r.qty + '× ' : ''}${r.name}${r.note ? ' (' + r.note + ')' : ''} — ${money([r.price[0] * r.qty, r.price[1] * r.qty])}`);
  lines.push('', 'Also needed:');
  for (const x of extras) lines.push(`[ ] ${x.name} — ${money(x.price)}`);
  return lines.join('\n');
}

function copyList() {
  const text = listText();
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast('📋 Copied'), () => toast('Could not copy'));
  else toast('Copy is not available in this browser');
}

function printList() {
  const s = store.get();
  const sp = SPECIES[s.species];
  const img = viewer.capture(1200, 'image/jpeg', 0.88);
  const { rows, extras } = shoppingList();
  const r = ui.result;
  $('#printArea').replaceChildren(
    el('h1', { text: s.name }),
    el('p', { text: `${sp.name} · ${fmtDims(s.tank.L, s.tank.W, s.tank.H)} · ${SUBSTRATES[s.substrate].name}` }),
    el('img', { src: img, alt: 'Terrarium preview' }),
    r ? el('h2', { text: 'Habitat check' }) : null,
    r ? el('table', {}, r.checks.map((c) => el('tr', {}, [el('td', { text: c.status === 'good' ? '✓' : c.status === 'warn' ? '!' : '✗' }), el('td', { text: c.label || c.title }), el('td', { text: c.value ?? '' }), el('td', { text: c.target ?? '' })]))) : null,
    el('h2', { text: 'Shopping list' }),
    el('ul', {}, rows.map((x) => el('li', { text: `☐ ${x.qty > 1 ? x.qty + '× ' : ''}${x.name}${x.note ? ' (' + x.note + ')' : ''} — ${money([x.price[0] * x.qty, x.price[1] * x.qty])}` }))),
    el('h2', { text: 'Also needed' }),
    el('ul', {}, extras.map((x) => el('li', { text: `☐ ${x.name} — ${money(x.price)}` })))
  );
  setTimeout(() => window.print(), 100);
}

// ------------------------------------------------------------------ selection bar
function renderSelBar(id) {
  const bar = $('#selBar');
  const s = store.get();
  if (id === 'animal') {
    const sp = SPECIES[s.species];
    const rot = viewer.animal.root.rotation.y;
    const pos = viewer.animal.group.position;
    const turn = (d) => updateItem('animal', { rot: +(rot + d).toFixed(3), x: +pos.x.toFixed(2), z: +pos.z.toFixed(2) });
    bar.replaceChildren(
      el('strong', {}, [`${sp.name} `, el('small', { text: `life-size · ${fmtLen(viewer.animal.length, 1)} long` })]),
      el('button', { class: 'btn icon', title: 'Turn left (Q)', 'aria-label': 'Turn left', text: '↺', onclick: () => turn(Math.PI / 8) }),
      el('button', { class: 'btn icon', title: 'Turn right (R)', 'aria-label': 'Turn right', text: '↻', onclick: () => turn(-Math.PI / 8) }),
      el('button', { class: 'btn small', onclick: () => removeItem('animal') }, '👁 Hide model'),
      el('button', { class: 'btn icon ghost', title: 'Done (Esc)', 'aria-label': 'Deselect', text: '✕', onclick: () => viewer.select(null) })
    );
    bar.classList.add('show');
    return;
  }
  const it = id && s.items.find((i) => i.id === id);
  if (!it) {
    bar.classList.remove('show');
    if (ui.tab === 'decor') for (const row of document.querySelectorAll('.placed')) row.classList.remove('on');
    return;
  }
  const d = ITEMS[it.type];
  const size = viewer.itemSize(id);
  const kids = [el('strong', {}, [`${d.icon} ${d.name} `, size ? el('small', { text: dimText(size) }) : null])];
  if (d.mount !== 'wall') {
    kids.push(el('button', { class: 'btn icon', title: 'Rotate left (Q)', 'aria-label': 'Rotate left', text: '↺', onclick: () => updateItem(id, { rot: +((it.rot || 0) + Math.PI / 8).toFixed(3) }) }));
    kids.push(el('button', { class: 'btn icon', title: 'Rotate right (R)', 'aria-label': 'Rotate right', text: '↻', onclick: () => updateItem(id, { rot: +((it.rot || 0) - Math.PI / 8).toFixed(3) }) }));
  }
  if (it.type !== 'heatLamp' && it.type !== 'uvb' && it.type !== 'gauge') {
    const sz = el('input', { type: 'range', min: 0.4, max: 2.2, step: 0.05, value: it.scale || 1, 'aria-label': 'Size' });
    sz.addEventListener('input', () => updateItem(id, { scale: +sz.value }, { live: true }));
    sz.addEventListener('change', endGesture);
    kids.push(el('label', { class: 'size' }, [el('span', { text: 'Size' }), sz]));
  }
  if (it.type === 'heatLamp') {
    const sel = el('select', { 'aria-label': 'Bulb wattage' }, WATTS.map((w) => el('option', { value: w, selected: w === it.watts, text: `${w}W bulb` })));
    sel.addEventListener('change', () => updateItem(id, { watts: +sel.value }));
    kids.push(sel);
    kids.push(el('button', { class: 'btn small', title: 'Pick the wattage that best fits this animal', onclick: () => {
      const best = viewer.bestWattage(WATTS, SPECIES[s.species]);
      if (best) { updateItem(id, { watts: best }); toast(`${best}W gives the closest basking temperature here.`); }
    } }, 'Best fit'));
  }
  kids.push(el('button', { class: 'btn icon', title: 'Duplicate (D)', 'aria-label': 'Duplicate', text: '⧉', onclick: () => duplicateItem(id) }));
  kids.push(el('button', { class: 'btn icon danger', title: 'Delete (Del)', 'aria-label': 'Delete', text: '🗑', onclick: () => removeItem(id) }));
  kids.push(el('button', { class: 'btn icon ghost', title: 'Done (Esc)', 'aria-label': 'Deselect', text: '✕', onclick: () => viewer.select(null) }));
  bar.replaceChildren(...kids);
  bar.classList.add('show');
  if (ui.tab === 'decor') {
    const idx = s.items.findIndex((i) => i.id === id);
    document.querySelectorAll('.placed').forEach((row, k) => row.classList.toggle('on', k === idx));
  }
}

// ------------------------------------------------------------------ view tools
function setupTools() {
  const tools = $('#viewTools');
  const mk = (id, icon, label, fn, toggle) => {
    const b = el('button', { id, class: 'tool', title: label, 'aria-label': label, onclick: fn }, [el('span', { text: icon }), el('small', { text: label })]);
    if (toggle) b.setAttribute('aria-pressed', 'false');
    tools.append(b);
    return b;
  };
  const view = (v) => () => { viewer.userMovedCamera = v !== 'front'; viewer.resetCamera(false, v); };
  mk('viewFront', '🎯', '3/4 view', view('front'));
  mk('viewStraight', '⬜', 'Front', view('straight'));
  mk('viewTop', '⬇️', 'Top', view('top'));
  mk('viewSide', '◧', 'Side', view('side'));
  tools.append(el('hr'));
  const therm = mk('thermBtn', '🌡️', 'Heat map', () => {
    const on = !viewer.thermal;
    viewer.setThermal(on);
    therm.setAttribute('aria-pressed', on);
    $('#legend').classList.toggle('show', on);
    if (on) toast('Heat map on. Hover to read temperatures; drag the lamp to see the gradient change.');
  }, true);
  const dims = mk('dimBtn', '📏', 'Sizes', () => {
    viewer.showDims = !viewer.showDims;
    dims.setAttribute('aria-pressed', viewer.showDims);
  }, true);
  dims.setAttribute('aria-pressed', 'true');
  mk('photoBtn', '📸', 'Image', () => takePhoto());

  $('#legend').append(
    el('div', { class: 'legend-bar', style: { background: thermalCss() } }),
    el('div', { class: 'legend-labels' }, [el('span', { text: fmtTemp(THERMAL_MIN) }), el('span', { text: 'Surface temperature' }), el('span', { text: fmtTemp(THERMAL_MAX) })])
  );
  $('#scorePill').addEventListener('click', () => setTab('check'));
}

function takePhoto() {
  const url = viewer.capture(2000);
  const s = store.get();
  const a = el('a', { class: 'btn primary', href: url, download: `${(s.name || 'terrarium').replace(/[^\w-]+/g, '_')}.png` }, '⬇️ Download PNG');
  openModal('Image of your design', [el('img', { class: 'photo', src: url, alt: 'Terrarium design' }), el('div', { class: 'btn-row' }, [a])]);
}

// ------------------------------------------------------------------ modals
function openModal(title, content, opts = {}) {
  const m = $('#modal');
  const close = () => { m.classList.add('hidden'); m.replaceChildren(); };
  const dlg = el('div', { class: 'dialog' + (opts.wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [
    el('header', {}, [el('h2', { text: title }), el('button', { class: 'btn icon ghost', 'aria-label': 'Close', text: '✕', onclick: close })]),
    el('div', { class: 'dialog-body' }, [].concat(content)),
  ]);
  m.replaceChildren(dlg);
  m.classList.remove('hidden');
  m.onclick = (e) => { if (e.target === m) close(); };
  m._close = close;
  return close;
}

function showWelcome() {
  const close = openModal('Terrarium Planner', [
    el('p', { class: 'lead', text: 'Plan an enclosure for a gecko or lizard, check it against the animal\'s care requirements, and get a shopping list. A starter layout for a leopard gecko is loaded so you have something to edit.' }),
    el('ol', { class: 'steps' }, [
      el('li', {}, [el('b', { text: 'Animal — ' }), 'choose the species; its requirements drive everything else']),
      el('li', {}, [el('b', { text: 'Tank — ' }), 'size, enclosure type, background and room temperature']),
      el('li', {}, [el('b', { text: 'Ground — ' }), 'substrate, depth and landscape']),
      el('li', {}, [el('b', { text: 'Decor — ' }), 'hides, wood, plants, dishes, heat and UVB']),
      el('li', {}, [el('b', { text: 'Check & Shopping — ' }), 'what meets the requirements, what doesn\'t, and what to buy']),
    ]),
    el('p', { class: 'hint', text: 'Drag to orbit, scroll or pinch to zoom, click things in the tank to move them. Designs save in this browser.' }),
    el('div', { class: 'btn-row' }, [el('button', { class: 'btn primary big', text: 'Start planning', onclick: () => close() })]),
  ]);
}

function showHelp() {
  openModal('Help', [
    el('h4', { text: 'Camera' }),
    el('ul', {}, [
      el('li', { text: 'Drag to orbit, right-drag (or two fingers) to pan, scroll or pinch to zoom.' }),
      el('li', { text: 'The view buttons jump to a 3/4, front, top or side view.' }),
    ]),
    el('h4', { text: 'Placing things' }),
    el('ul', {}, [
      el('li', { text: 'Click an item in Decor to add it, or drag it into the tank.' }),
      el('li', { text: 'Click an item in the tank to select it, then drag to move it. Lamps slide along the lid; ledges and feeders stick to the walls.' }),
      el('li', { text: 'The bar at the bottom shows the item\'s size and lets you rotate, resize, duplicate or delete it.' }),
      el('li', { text: 'The animal model is life-size. Drag it around to check that it fits in hides and under branches.' }),
    ]),
    el('h4', { text: 'Keyboard' }),
    el('ul', { class: 'keys' }, [
      ['Ctrl/⌘ + Z', 'Undo'], ['Ctrl/⌘ + Shift + Z', 'Redo'], ['Delete', 'Remove selected'], ['R / Q', 'Rotate'], ['D', 'Duplicate'], ['Arrows', 'Nudge (Shift = bigger steps)'], ['Esc', 'Deselect'],
    ].map(([k, v]) => el('li', {}, [el('kbd', { text: k }), ' ', v]))),
    el('h4', { text: 'How the numbers are estimated' }),
    el('ul', {}, [
      el('li', { text: 'Temperatures come from room temperature plus each basking bulb\'s wattage and its distance to every surface. Raising a basking spot closer to the lamp makes it hotter.' }),
      el('li', { text: 'Humidity is estimated from the substrate, misting, water dishes, live plants, ventilation and heat. Open "How the humidity estimate works" in Check for the breakdown.' }),
      el('li', { text: 'Use these for planning, then confirm with real thermometers once the enclosure is running.' }),
    ]),
  ]);
}

function showDesigns() {
  const list = store.listDesigns();
  const cur = store.get();
  const grid = el('div', { class: 'design-grid' }, list.length ? list.map((d) => el('div', { class: 'design' + (d.id === cur.id ? ' on' : '') }, [
    d.thumb ? el('img', { src: d.thumb, alt: '' }) : el('div', { class: 'noimg', text: '🦎' }),
    el('strong', { text: d.name }),
    el('small', { text: `${SPECIES[d.species]?.name || ''} · ${new Date(d.updated).toLocaleDateString()}` }),
    el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn small primary', onclick: () => { store.openDesign(d.id); $('#modal')._close(); toast(`Opened “${d.name}”`); } }, 'Open'),
      el('button', { class: 'btn small danger', onclick: () => { if (confirm(`Delete “${d.name}”?`)) { store.deleteDesign(d.id); showDesigns(); } } }, 'Delete'),
    ]),
  ])) : [el('p', { class: 'hint', text: 'No saved designs yet. Use 💾 Save to keep this one.' })]);
  const fileInput = el('input', { type: 'file', accept: '.json,application/json', class: 'hidden' });
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!validState(data)) throw new Error('bad');
      data.id = uid();
      store.replace(data, { opened: true });
      $('#modal')._close();
      toast('Imported');
    } catch {
      toast('That file is not a terrarium design.');
    }
  });
  openModal('My designs', [
    el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn', onclick: () => { newDesign(); $('#modal')._close(); } }, '➕ New design'),
      el('button', { class: 'btn', onclick: exportDesign }, '📤 Export file'),
      el('button', { class: 'btn', onclick: () => fileInput.click() }, '📥 Import file'),
      fileInput,
    ]),
    grid,
  ], { wide: true });
}

function newDesign() {
  const s = store.get();
  const next = defaultState();
  next.species = s.species;
  next.units = s.units;
  next.name = 'New Terrarium';
  store.replace(next);
  buildStarter(s.species, { first: true });
  store.commit((st) => { st.name = 'New Terrarium'; }, { merge: true });
  toast('New design started from the starter layout.');
}

function exportDesign() {
  const s = store.get();
  const blob = new Blob([JSON.stringify(s, null, 1)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `${s.name.replace(/[^\w-]+/g, '_') || 'terrarium'}.json` });
  document.body.append(a);
  a.click();
  a.remove();
}

function saveDesign() {
  const thumb = viewer.capture(360, 'image/jpeg', 0.75);
  if (store.saveDesign(thumb)) toast(`💾 Saved “${store.get().name}”`);
  else toast('Could not save — browser storage may be full or turned off.');
}

// ------------------------------------------------------------------ keyboard
function onKey(e) {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z') {
    if (typing) return;
    e.preventDefault();
    if (e.shiftKey) store.redo(); else store.undo();
    return;
  }
  if (mod && e.key.toLowerCase() === 'y') { if (!typing) { e.preventDefault(); store.redo(); } return; }
  if (typing) return;
  if (e.key === 'Escape') {
    if (!$('#modal').classList.contains('hidden')) { $('#modal')._close?.(); return; }
    if (ui.sculpt.active) { setSculpt({ active: false }); renderTab(); return; }
    viewer.select(null);
    return;
  }
  const id = viewer.selected;
  if (!id) return;
  if (id === 'animal') {
    const g = viewer.animal.group.position, rot = viewer.animal.root.rotation.y;
    if (e.key === 'r' || e.key === 'q') updateItem('animal', { rot: +(rot + (e.key === 'r' ? -1 : 1) * Math.PI / 8).toFixed(3), x: +g.x.toFixed(2), z: +g.z.toFixed(2) });
    else if (e.key === 'Delete' || e.key === 'Backspace') removeItem('animal');
    return;
  }
  const it = store.get().items.find((i) => i.id === id);
  if (!it) return;
  const mount = ITEMS[it.type].mount;
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeItem(id); }
  else if ((e.key === 'r' || e.key === 'q') && mount !== 'wall') updateItem(id, { rot: +((it.rot || 0) + (e.key === 'r' ? -1 : 1) * Math.PI / 8).toFixed(3) });
  else if (e.key === 'd' && !mod) duplicateItem(id);
  else if (e.key.startsWith('Arrow')) {
    e.preventDefault();
    const step = e.shiftKey ? 2 : 0.5;
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    const dz = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    if (mount === 'wall') updateItem(id, { a: +((it.a || 0) + dx).toFixed(2), y: +((it.y || 0) - dz).toFixed(2) });
    else updateItem(id, { x: +((it.x || 0) + dx).toFixed(2), z: +((it.z || 0) + dz).toFixed(2) });
  }
}

// ------------------------------------------------------------------ boot
function boot() {
  renderTabs();
  setupTools();
  $('#undoBtn').addEventListener('click', () => store.undo());
  $('#redoBtn').addEventListener('click', () => store.redo());
  $('#saveBtn').addEventListener('click', saveDesign);
  $('#designsBtn').addEventListener('click', showDesigns);
  $('#helpBtn').addEventListener('click', showHelp);
  const name = $('#designName');
  name.addEventListener('input', () => live((s) => { s.name = name.value || 'My Terrarium'; }));
  name.addEventListener('change', endGesture);
  window.addEventListener('keydown', onKey);

  viewer.sync(store.get(), { full: true });
  if (store.fresh) {
    buildStarter('leopard', { first: true });
    store.undoStack = [];
    store.redoStack = [];
    showWelcome();
  }
  renderTab();
  renderTopbar();
  window.terrarium = { viewer, store, buildStarter, evaluate: () => ui.result };
}

try {
  boot();
} catch (err) {
  console.error(err);
  const msg = document.getElementById('bootError');
  if (msg) {
    msg.hidden = false;
    msg.querySelector('code').textContent = String(err && err.message ? err.message : err);
  }
}
