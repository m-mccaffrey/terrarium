// App state with undo/redo and localStorage persistence.
import { uid } from './util.js';
import { emptyHeights } from './terrain.js';

const CURRENT = 'terrarium-planner:current';
const DESIGNS = 'terrarium-planner:designs';

export function defaultState() {
  return {
    v: 1,
    id: uid(),
    name: 'My Terrarium',
    species: 'leopard',
    tank: { preset: '36x18x18', L: 36, W: 18, H: 18, style: 'glass', background: 'sandstone' },
    substrate: 'aridBio',
    depth: 3,
    terrain: emptyHeights(),
    room: 72,
    misting: 'none',
    units: 'imperial',
    items: [],
    animal: { show: true },
  };
}

function safeGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key, val) {
  try {
    localStorage.setItem(key, val);
    return true;
  } catch {
    return false;
  }
}

export function validState(s) {
  return s && typeof s === 'object' && s.tank && Array.isArray(s.items) && typeof s.species === 'string';
}

export class Store {
  constructor() {
    let s = null;
    try {
      s = JSON.parse(safeGet(CURRENT));
    } catch {
      s = null;
    }
    this.fresh = !validState(s);
    this.state = this.fresh ? defaultState() : { ...defaultState(), ...s };
    this.undoStack = [];
    this.redoStack = [];
    this.listeners = new Set();
    this._saveT = null;
  }

  get() {
    return this.state;
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(meta = {}) {
    for (const fn of this.listeners) fn(this.state, meta);
  }

  // mutator edits the state in place; one undo step per commit (unless merge)
  commit(mutator, meta = {}) {
    const before = JSON.stringify(this.state);
    mutator(this.state);
    if (!meta.merge) {
      this.undoStack.push(before);
      if (this.undoStack.length > 80) this.undoStack.shift();
      this.redoStack = [];
    }
    this.emit(meta);
    this.save();
  }

  replace(next, meta = {}) {
    this.undoStack.push(JSON.stringify(this.state));
    this.redoStack = [];
    this.state = { ...defaultState(), ...next };
    this.emit({ full: true, ...meta });
    this.save();
  }

  undo() {
    if (!this.undoStack.length) return false;
    this.redoStack.push(JSON.stringify(this.state));
    this.state = JSON.parse(this.undoStack.pop());
    this.emit({ full: true, history: true });
    this.save();
    return true;
  }

  redo() {
    if (!this.redoStack.length) return false;
    this.undoStack.push(JSON.stringify(this.state));
    this.state = JSON.parse(this.redoStack.pop());
    this.emit({ full: true, history: true });
    this.save();
    return true;
  }

  save() {
    clearTimeout(this._saveT);
    this._saveT = setTimeout(() => safeSet(CURRENT, JSON.stringify(this.state)), 300);
  }

  // ---- saved designs gallery ----
  listDesigns() {
    try {
      const arr = JSON.parse(safeGet(DESIGNS));
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  saveDesign(thumb) {
    const list = this.listDesigns();
    const entry = { id: this.state.id, name: this.state.name, species: this.state.species, updated: Date.now(), thumb, state: JSON.parse(JSON.stringify(this.state)) };
    const i = list.findIndex((d) => d.id === entry.id);
    if (i >= 0) list[i] = entry;
    else list.unshift(entry);
    let ok = safeSet(DESIGNS, JSON.stringify(list));
    if (!ok) {
      // storage full: drop thumbnails of older designs and retry
      list.forEach((d, k) => { if (k > 0) d.thumb = null; });
      ok = safeSet(DESIGNS, JSON.stringify(list));
    }
    return ok;
  }

  deleteDesign(id) {
    safeSet(DESIGNS, JSON.stringify(this.listDesigns().filter((d) => d.id !== id)));
  }

  openDesign(id) {
    const d = this.listDesigns().find((x) => x.id === id);
    if (d && validState(d.state)) this.replace(JSON.parse(JSON.stringify(d.state)), { opened: true });
  }
}
