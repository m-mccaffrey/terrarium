// Temperature + humidity model and the "habitat checkup" scoring.
import { SPECIES, SUBSTRATES, MISTING, ITEMS } from './data.js';
import { fmtTemp, fmtTempRange, fmtDims, fmtVolume, gallons } from './util.js';

export const WATTS = [25, 40, 50, 60, 75, 100, 150];

// Returns temp(x, y, z) in °F. Lamps: [{x,y,z,watts}], mats: [{x,z,w,d}]
export function makeClimate({ room, lamps, mats, vol, night }) {
  const totalW = night ? 0 : lamps.reduce((s, l) => s + l.watts, 0);
  const ambient = room + totalW * 0.05 * Math.sqrt(40 / Math.max(5, vol)) + (mats.length ? 1.2 : 0);
  return (x, y, z) => {
    let t = ambient;
    if (!night) {
      for (const l of lamps) {
        const d2 = (l.x - x) ** 2 + (l.y - y) ** 2 + (l.z - z) ** 2;
        t += (72 * l.watts) / (d2 + 50);
      }
    }
    for (const m of mats) {
      const dx = Math.max(0, Math.abs(x - m.x) - m.w / 2), dz = Math.max(0, Math.abs(z - m.z) - m.d / 2);
      t += 16 * Math.exp(-(dx * dx + dz * dz) / 4) * Math.exp(-Math.max(0, y) / 2.5);
    }
    return t;
  };
}

export function humidityEstimate(state, items, totalWatts) {
  const sub = SUBSTRATES[state.substrate];
  const parts = [];
  parts.push({ label: sub.name, value: sub.humidity });
  const mist = MISTING[state.misting] || MISTING.none;
  if (mist.add) parts.push({ label: `Misting ${mist.name.toLowerCase()}`, value: mist.add });
  // the same dish or plant matters less in a bigger tank
  const { L, W, H } = state.tank;
  const k = Math.max(0.5, Math.min(1.5, Math.sqrt(40 / gallons(L, W, H))));
  const dishes = items.filter((i) => i.type === 'waterDish').length;
  if (dishes) parts.push({ label: `Water dish${dishes > 1 ? 'es' : ''}`, value: +Math.min(6, dishes * 3 * k).toFixed(1) });
  const live = items.filter((i) => ITEMS[i.type]?.live).length;
  if (live) parts.push({ label: `${live} live plant${live > 1 ? 's' : ''}`, value: +Math.min(10, live * 1.5 * k).toFixed(1) });
  const pvc = state.tank.style === 'pvc' || state.tank.style === 'pvcWhite';
  parts.push({ label: pvc ? 'PVC walls hold moisture' : 'Screen top lets air out', value: pvc ? 3 : -4 });
  if (totalWatts) parts.push({ label: 'Heat lamps dry the air', value: -Math.round(totalWatts / 25) });
  const total = Math.max(10, Math.min(95, parts.reduce((s, p) => s + p.value, 0)));
  return { value: Math.round(total), parts };
}

const status = (ok, near) => (ok ? 'good' : near ? 'warn' : 'bad');

export function evaluate(state, stats) {
  const sp = SPECIES[state.species];
  const { L, W, H } = state.tank;
  const checks = [];
  const add = (c) => checks.push(c);
  const arboreal = sp.lifestyle === 'arboreal';

  // 1. Tank size
  {
    const m = sp.minTank;
    const ok = L >= m.L && W >= m.W && H >= m.H;
    const volOk = gallons(L, W, H) >= gallons(m.L, m.W, m.H) * 0.75 && H >= m.H * 0.75;
    let title = ok ? `Size OK: ${fmtVolume(L, W, H)}` : volOk ? 'Tank is a little small' : 'Tank is too small';
    let detail = `Your tank is ${fmtDims(L, W, H)}. A ${sp.name.toLowerCase()} needs at least ${fmtDims(m.L, m.W, m.H)}.`;
    if (!ok && arboreal && H < m.H) detail += ' Tree-climbers need a tall tank!';
    if (!ok && !arboreal && L < m.L) detail += ' Ground-dwellers need a long tank to roam.';
    add({ id: 'size', label: 'Enclosure size', value: fmtDims(L, W, H), target: `≥ ${fmtDims(m.L, m.W, m.H)}`, weight: 20, status: status(ok, volOk), icon: '📏', title, detail });
  }

  // 2. Basking / warm spot
  const basker = sp.hot[0] > 80;
  {
    const [lo, hi] = sp.hot;
    const t = stats.hot;
    if (basker) {
      const ok = t >= lo && t <= hi;
      const near = t >= lo - 4 && t <= hi + 4;
      const title = ok ? `Basking spot ${fmtTemp(t)}` : t < lo ? `Basking spot is too cool (${fmtTemp(t)})` : `Basking spot is too hot (${fmtTemp(t)})`;
      let detail = `${sp.name}s like their warmest spot at ${fmtTempRange(sp.hot)}.`;
      if (!stats.lampCount && t < lo) detail += ' Add a basking lamp from Heat & Light.';
      else if (t < lo) detail += ' Try a stronger bulb, or put a rock or slate under the lamp so it\'s closer.';
      else if (t > hi) detail += ' Try a weaker bulb, or move climbing spots away from the lamp.';
      add({ id: 'hot', label: 'Basking spot', value: fmtTemp(t), target: fmtTempRange(sp.hot), weight: 15, status: status(ok, near), icon: '☀️', title, detail });
    } else {
      const ok = t <= hi && t >= lo - 2;
      const near = t <= hi + 4;
      const title = t > hi ? `Too hot! Warmest spot is ${fmtTemp(t)}` : t < lo - 2 ? `A bit chilly (${fmtTemp(t)})` : `Warmest spot ${fmtTemp(t)}`;
      const detail = t > hi
        ? `${sp.name}s can overheat above ${fmtTemp(hi)}. Use a weaker bulb or none at all.`
        : `${sp.name}s are happy at ${fmtTempRange(sp.hot)}${stats.lampCount ? '' : ' — normal room temperature works, no heat lamp needed'}.`;
      add({ id: 'hot', label: 'Warmest spot', value: fmtTemp(t), target: fmtTempRange(sp.hot), weight: 15, status: status(ok, near), icon: '🌡️', title, detail });
    }
  }

  // 3. Cool side
  {
    const [lo, hi] = sp.cool;
    const t = stats.cool;
    const ok = t >= lo && t <= hi;
    const near = t >= lo - 3 && t <= hi + 3;
    const title = ok ? `Cool side ${fmtTemp(t)}` : t > hi ? `No cool place to chill (${fmtTemp(t)})` : `Cool side is cold (${fmtTemp(t)})`;
    let detail = `The coolest spot should be ${fmtTempRange(sp.cool)} so your pet can cool off.`;
    if (t > hi) detail += ' Move the lamp to one end, use a weaker bulb, or pick a longer tank.';
    if (t < lo) detail += ' Raise the room temperature or add a heat mat.';
    add({ id: 'cool', label: 'Cool side', value: fmtTemp(t), target: fmtTempRange(sp.cool), weight: 10, status: status(ok, near), icon: '❄️', title, detail });
  }

  // 4. Gradient (baskers only)
  if (basker) {
    const grad = stats.hot - stats.cool;
    const ok = grad >= 10;
    add({
      id: 'gradient', label: 'Temperature gradient', value: `${Math.round(grad)}°F`, target: '≥ 10°F', weight: 6, status: status(ok, grad >= 6), icon: '🌈',
      title: ok ? `Warm side + cool side (${Math.round(grad)}° difference)` : 'Needs a warm side and a cool side',
      detail: 'Reptiles move between warm and cool spots to control their body temperature. Put the heat lamp at one end of the tank.',
    });
  }

  // 5. Night temperature
  {
    const ok = stats.night >= sp.nightMin;
    add({
      id: 'night', label: 'Night low', value: fmtTemp(stats.night), target: `≥ ${fmtTemp(sp.nightMin)}`, weight: 4, status: status(ok, stats.night >= sp.nightMin - 4), icon: '🌙',
      title: ok ? `Nights stay above ${fmtTemp(sp.nightMin)}` : `Nights get too cold (${fmtTemp(stats.night)})`,
      detail: ok ? 'Lights go off at night. A small drop is natural and healthy.' : 'Raise the room temperature or add a heat mat (on a thermostat) for nighttime.',
    });
  }

  // 6. Humidity
  {
    const [lo, hi] = sp.humidity;
    const h = stats.humidity;
    const ok = h >= lo && h <= hi;
    const near = h >= lo - 6 && h <= hi + 6;
    const title = ok ? `Humidity ${h}%` : h < lo ? `Too dry (${h}%)` : `Too humid (${h}%)`;
    let detail = `${sp.name}s need ${lo}–${hi}% humidity.`;
    if (h < lo) detail += ' Try a jungle substrate, live plants, or misting.';
    if (h > hi) detail += ' Try a drier substrate or mist less often. Too much moisture can cause sickness.';
    add({ id: 'humidity', label: 'Humidity', value: `${h}%`, target: `${lo}–${hi}%`, weight: 10, status: status(ok, near), icon: '💧', title, detail });
  }

  // 7. Hides
  {
    const hides = stats.hides;
    if (!arboreal) {
      // night-active ground geckos rest in a warm hide to digest; day baskers just need a cool retreat
      const needWarm = sp.activity !== 'diurnal';
      const warm = hides.some((h) => h.temp >= (basker ? sp.hot[0] - 10 : sp.hot[0]));
      const cool = hides.some((h) => h.temp <= sp.cool[1] + 1.5);
      const humid = hides.some((h) => h.humid);
      const missing = [];
      if (needWarm && !warm) missing.push('a warm hide (near the heat)');
      if (!cool) missing.push('a cool hide (far from the heat)');
      if (sp.needsHumidHide && !humid) missing.push('a humid hide');
      if (hides.length < sp.minHides && missing.length === 0) missing.push(`${sp.minHides - hides.length} more hide${sp.minHides - hides.length > 1 ? 's' : ''}`);
      add({
        id: 'hides', label: 'Hides', value: `${hides.length}`, target: `${sp.minHides}+: ${[needWarm ? 'warm' : null, 'cool', sp.needsHumidHide ? 'humid' : null].filter(Boolean).join(' + ')}`, weight: 12, status: missing.length === 0 ? 'good' : missing.length === 1 ? 'warn' : 'bad', icon: '🏠',
        title: missing.length === 0 ? `${hides.length} cozy hides` : `Needs ${missing[0]}${missing.length > 1 ? ` + ${missing.length - 1} more` : ''}`,
        detail: missing.length === 0
          ? `Hides on ${needWarm ? 'both the warm and cool sides' : 'the cool side'}${sp.needsHumidHide ? ', plus a humid hide for shedding' : ''}.`
          : `Missing: ${missing.join(', ')}. Hides help your pet feel safe.`,
      });
    } else {
      const cover = stats.counts.cover + hides.length;
      add({
        id: 'hides', label: 'Cover', value: `${cover}`, target: '≥ 4 leafy plants / hides', weight: 12, status: status(cover >= 4, cover >= 2), icon: '🌿',
        title: cover >= 4 ? 'Plenty of cover' : 'Needs more places to hide',
        detail: 'Tree geckos hide among leaves and cork bark. Add leafy plants, vines or a cork round — especially up high.',
      });
    }
  }

  // 8. Water
  add({
    id: 'water', label: 'Water dish', value: stats.counts.water ? 'Yes' : 'None', target: 'Yes', weight: 8, status: stats.counts.water ? 'good' : arboreal ? 'warn' : 'bad', icon: '💦',
    title: stats.counts.water ? 'Fresh water dish' : 'No water dish',
    detail: stats.counts.water ? 'Change the water every day!' : arboreal ? 'Tree geckos lick water droplets after misting, but a small dish is still a good idea.' : 'Every reptile needs a shallow dish of fresh water.',
  });

  // 9. Substrate
  {
    const sub = SUBSTRATES[state.substrate];
    const good = sub.good.includes(state.species);
    const bad = sub.bad.includes(state.species);
    add({
      id: 'substrate', label: 'Substrate', value: sub.name, target: sub.good.includes(state.species) ? 'Suitable' : 'See notes', weight: 10, status: bad ? 'bad' : good ? 'good' : 'warn', icon: '🟫',
      title: bad ? `${sub.name}: not safe` : good ? `${sub.name}: great choice` : sub.temporary ? `${sub.name}: just for now` : `${sub.name}: not ideal`,
      detail: bad ? sub.desc : good ? sub.desc : sub.temporary ? 'Paper towels are great for quarantine, but a natural substrate lets your pet dig and explore.' : `This isn't the best match for a ${sp.habitat} animal.`,
    });
  }

  // 10. UVB
  if (sp.uvb) {
    const req = sp.uvb === 'required';
    add({
      id: 'uvb', label: 'UVB lighting', value: stats.counts.uvb ? 'Yes' : 'None', target: req ? 'Required' : 'Recommended', weight: req ? 10 : 4, status: stats.counts.uvb ? 'good' : req ? 'bad' : 'warn', icon: '🔆',
      title: stats.counts.uvb ? 'UVB sunshine light' : req ? 'Needs a UVB light!' : 'UVB light recommended',
      detail: req
        ? 'This species needs UVB to make vitamin D3 and grow strong bones.'
        : 'A low-level UVB light helps with healthy bones and natural day/night rhythms.',
    });
  }

  // 11. Climbing
  {
    const n = stats.counts.climb;
    const ok = arboreal ? n >= 3 : n >= 1;
    add({
      id: 'climb', label: 'Climbing', value: `${n} item${n === 1 ? '' : 's'}`, target: arboreal ? '≥ 3' : '≥ 1', weight: arboreal ? 10 : 5, status: status(ok, n >= 1), icon: '🧗',
      title: ok ? (arboreal ? `${n} things to climb` : 'Things to climb on') : arboreal ? 'Needs branches to climb!' : 'Add something to climb',
      detail: arboreal ? 'Tree geckos spend most of their time up high. Add branches, bamboo, vines and ledges.' : 'Rocks and wood give exercise and enrichment.',
    });
  }

  // 12. Plants that fit the climate
  if (stats.counts.livePlants) {
    const mis = stats.plantMismatch;
    add({
      id: 'plants', label: 'Plant climate', value: mis.length ? `${mis.length} mismatch` : 'All match', target: sp.habitat, weight: 5, status: mis.length ? 'warn' : 'good', icon: '🪴',
      title: mis.length ? `${mis[0]}${mis.length > 1 ? ` + ${mis.length - 1} more` : ''} won't like this climate` : 'Plants match the climate',
      detail: mis.length ? `${mis.join(', ')} ${mis.length > 1 ? 'need' : 'needs'} a different climate than a ${sp.habitat} tank.` : 'Your plants should grow happily here.',
    });
  } else {
    add({
      id: 'plants', label: 'Live plants', value: 'None', target: 'Optional', weight: 3, status: 'warn', icon: '🪴', title: 'No live plants yet',
      detail: `Live plants make a tank feel natural and help with humidity. Try ${sp.habitat === 'arid' ? 'succulents like haworthia or echeveria' : 'pothos, bromeliads or ferns'}.`,
    });
  }

  // 13. Floor space
  if (!arboreal) {
    const c = stats.coverage;
    add({
      id: 'space', label: 'Open floor', value: `${Math.round((1 - c) * 100)}%`, target: '≥ 35%', weight: 5, status: status(c <= 0.65, c <= 0.8), icon: '🦶',
      title: c <= 0.65 ? 'Room to roam' : 'Getting crowded',
      detail: `About ${Math.round(c * 100)}% of the floor is covered. Ground-dwellers need open space to walk around.`,
    });
  }

  // 14. Food
  {
    const needDish = sp.foods.includes('mealworms') || sp.foods.includes('salad') || sp.foods.includes('fruit');
    if (needDish) {
      const ok = stats.counts.food > 0;
      add({
        id: 'food', label: 'Feeding station', value: ok ? 'Yes' : 'None', target: 'Yes', weight: 3, status: ok ? 'good' : 'warn', icon: '🍽️',
        title: ok ? 'Food dish ready' : 'Add a food dish',
        detail: sp.foods.includes('fruit') ? 'A ledge feeder up high is perfect for fruit mix.' : 'A dish keeps worms and greens from escaping into the substrate.',
      });
    }
  }

  const total = checks.reduce((s, c) => s + c.weight, 0);
  const got = checks.reduce((s, c) => s + c.weight * (c.status === 'good' ? 1 : c.status === 'warn' ? 0.5 : 0), 0);
  const score = Math.round((got / total) * 100);
  const order = { bad: 0, warn: 1, good: 2 };
  const sorted = [...checks].sort((a, b) => order[a.status] - order[b.status] || b.weight - a.weight);
  return { score, checks: sorted };
}
