import { Component } from "react";
import { EVENTS, TH, MID } from "./archive.js";
import { tintOf } from "./tints.js";

const SHUT = ["1/500", "1/250", "1/1000", "1/125", "1/2000", "1/60"];
const APER = ["f/2", "f/2.8", "f/1.8", "f/4", "f/5.6"];
const ASPECTS = [1.5, 1.5, 1.5, 0.75, 1.3333, 1.0];
const PINS = ["ivory", "graphite", "red"];
const rnd = s => { const x = Math.sin(s * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const zclamp = z => Math.max(0.3, Math.min(2.8, z));
const pad2 = n => String(n).padStart(2, "0");
const pad3 = n => String(n).padStart(3, "0");
const SILVER = [214, 221, 230];
const mixRgb = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

// Grid placements [row, col, rowSpan, colSpan] for each contact-sheet layout.
function spans(style, rows, cols){
  const out = [];
  if (style === "sheet") {
    for (let r = 1; r <= rows; r++) for (let c = 1; c <= cols; c++) out.push([r, c, 1, 1]);
    return out;
  }
  if (style === "plate") {
    out.push([1, 1, 2, 4], [1, 5, 1, 2], [2, 5, 1, 2]);
    for (let r = 3; r <= rows; r++) for (let c = 1; c <= 5; c += 2) out.push([r, c, 1, 2]);
    return out;
  }
  if (style === "mosaic") {
    let r = 1;
    while (r <= rows) {
      if (rows - r >= 1) {
        const flip = (r % 4) === 1;
        out.push([r, flip ? 1 : 4, 2, 3], [r, flip ? 4 : 1, 1, 3], [r + 1, flip ? 4 : 1, 1, 3]);
        r += 2;
      } else { for (let c = 1; c <= 5; c += 2) out.push([r, c, 1, 2]); r += 1; }
    }
    return out;
  }
  for (let r = 1; r <= rows; r++) for (let c = 1; c <= 5; c++) out.push([r, c, 1, 1]);
  return out;
}

// Pin and tape sprites rendered in Blender (see art/). Each pin sprite is
// centred on its needle; each tape sprite is centred on the print's top edge,
// with its angle to that edge baked in.
const art = import.meta.glob("./assets/{pins,tape}/*.webp", { eager: true, query: "?url", import: "default" });
const pinArt = (colour, variant) => art["./assets/pins/pin-" + colour + "-" + variant + ".webp"];
const tapeArt = variant => art["./assets/tape/tape-" + variant + ".webp"];

function Pin({ colour, variant, style }){
  return <img className="ns-pin" src={pinArt(colour, variant)} style={style} alt="" draggable={false} aria-hidden="true" />;
}

// `width` is the length of tape the print wants; the sprite's canvas is a bit
// wider (84mm of canvas to 70mm of tape).
function Tape({ variant, width }){
  return <img className="ns-tape" src={tapeArt(variant)} style={{ width: width * 1.2 + "px" }} alt="" draggable={false} aria-hidden="true" />;
}

export default class LightTable extends Component {
  static defaultProps = {
    tableStyle: "Contact sheet", // "Contact sheet" | "Plate" | "Mosaic"
    loupeZoom: 2.8,
    corkTone: "#C8813F",
    haptics: true,
    tickSound: false,
    drift: true
  };

  constructor(p){
    super(p);
    this.rolls = EVENTS.map(e => ({ name: e[0], date: e[1], count: e[2] }));
    const items = [];
    EVENTS.forEach((e, ei) => {
      const n = Math.max(6, Math.round(e[2] / 14));
      for (let k = 0; k < n; k++) items.push({ e: ei, k: k, first: k === 0, ef: ei + k / n, date: e[1] });
    });
    this.items = items;
    this.state = { board: null, lifted: null, keep: {}, w: window.innerWidth, h: window.innerHeight };
    this.pos = 0; this.target = 0; this.vel = 0; this.drag = null; this.moved = false; this.last = Date.now();
    this.ptrs = new Map(); this.pinch = null; this.fling = 0;
    this.v = { x: 0, y: 0, z: 1 }; this.vt = { x: 0, y: 0, z: 1 }; this.bv = { x: 0, y: 0, z: 0 };
  }
  get narrow(){ return (this.lastW || this.state.w || 1280) < 760; }
  get reduce(){ return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); }
  clampPos(v){ return Math.max(0, Math.min(this.items.length - 1, v)); }
  touch(){ this.last = Date.now(); }

  boardItems(e){
    const key = e + "|" + (this.narrow ? 1 : 0);
    if (this._be === key && this._bi) return this._bi;
    const r = this.rolls[e], n = Math.min(42, Math.max(12, Math.round(r.count / 6)));
    const TRW = this.narrow ? 760 : 1120, G = 30;
    const out = [], rowsOf = [];
    let row = [], sum = 0;
    for (let i = 0; i < n; i++) {
      const a = ASPECTS[Math.floor(rnd(e * 97 + i * 7 + 3) * ASPECTS.length) % ASPECTS.length];
      row.push({ i: i, a: a }); sum += a;
      if (sum >= (this.narrow ? 3.1 : 4.3)) { rowsOf.push({ cells: row, sum: sum }); row = []; sum = 0; }
    }
    if (row.length) rowsOf.push({ cells: row, sum: sum, partial: true });
    let y = 0, prevH = 0;
    rowsOf.forEach(rw => {
      const avail = TRW - G * (rw.cells.length - 1);
      const h = rw.partial && prevH ? prevH : Math.round(avail / rw.sum);
      prevH = h;
      const rowW = rw.cells.reduce((t, c) => t + Math.round(h * c.a), 0) + G * (rw.cells.length - 1);
      let x = -Math.round(Math.min(rowW, TRW)) / 2;
      rw.cells.forEach(c => {
        const s = e * 97 + c.i * 7, w = Math.round(h * c.a);
        const r2 = rnd(s + 2), att = r2 > 0.62 ? 1 : r2 > 0.4 ? 2 : 0;
        out.push({ id: e * 13 + c.i, i: c.i, att: att, w: w, h: h, x: Math.round(x), y: y,
          rot: (rnd(s + 6) * 2 - 1) * 0.4,
          expo: (0.95 + rnd(s + 12) * 0.1).toFixed(3),
          sat: (0.95 + rnd(s + 13) * 0.1).toFixed(3),
          pin: PINS[rnd(s + 21) < 0.12 ? 2 : rnd(s + 21) < 0.5 ? 1 : 0],
          pinV: 1 + Math.floor(rnd(s + 31) * 3), pinV2: 1 + Math.floor(rnd(s + 37) * 3),
          tapeV: 1 + Math.floor(rnd(s + 41) * 4) });
        x += w + G;
      });
      y += h + G + 16;
    });
    const mid = (y - G - 16) / 2;
    out.forEach(o => { o.y -= mid; });
    this._be = key; this._bi = out; return out;
  }
  openBoard(e, k){
    const its = this.boardItems(e), it = its[Math.min(its.length - 1, Math.max(0, k || 0))];
    const cx = it.x + it.w / 2, cy = it.y + it.h / 2, z = this.narrow ? 0.8 : 0.96;
    this.vt = { x: cx, y: cy, z: z };
    this.v = this.reduce ? { x: cx, y: cy, z: z } : { x: cx, y: cy, z: z * 0.46 };
    this.bv = { x: 0, y: 0, z: 0 }; this.anchor = null;
    this.fadeLoupe(0);
    this.setState({ board: e });
  }
  rect(){
    const r = this.stageEl ? this.stageEl.getBoundingClientRect() : null;
    return r && r.width ? r : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  }
  step(k){
    const L = this.state.lifted; if (!L) return;
    const n = this.boardItems(L.e).length;
    this.setState({ lifted: { e: L.e, k: (L.k + k + n) % n } });
  }

  componentDidMount(){
    this.alive = true;
    window.addEventListener("wheel", this.onWheel, { passive: false });
    window.addEventListener("pointerdown", this.onDown);
    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("pointercancel", this.onUp);
    window.addEventListener("keydown", this.onKey);
    document.documentElement.addEventListener("mouseleave", this.onLeave);
    this.ro = new ResizeObserver(es => {
      const cr = es[es.length - 1].contentRect;
      if (!cr.width || !cr.height) return;
      const w = Math.round(cr.width), h = Math.round(cr.height);
      if (w !== this.state.w || h !== this.state.h) this.setState({ w: w, h: h });
    });
    if (this.stageEl) this.ro.observe(this.stageEl);
    this.raf = requestAnimationFrame(this.loop);
  }
  componentDidUpdate(){ this.syncLift(); }
  componentWillUnmount(){
    this.alive = false; cancelAnimationFrame(this.raf);
    if (this.ro) { this.ro.disconnect(); this.ro = null; }
    if (this.fitRo) { this.fitRo.disconnect(); this.fitRo = null; }
    window.removeEventListener("wheel", this.onWheel);
    window.removeEventListener("pointerdown", this.onDown);
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("pointercancel", this.onUp);
    window.removeEventListener("keydown", this.onKey);
    document.documentElement.removeEventListener("mouseleave", this.onLeave);
  }

  onWheel = ev => {
    if (this.state.lifted) return;
    ev.preventDefault(); this.touch();
    if (this.state.board !== null) {
      const s = this.rect();
      const sx = ev.clientX - s.left, sy = ev.clientY - s.top;
      const dm = ev.deltaMode === 1 ? 16 : 1, ax = sx - s.width / 2, ay = sy - s.height / 2;
      const z1 = zclamp(this.vt.z * Math.exp(-ev.deltaY * dm * (ev.ctrlKey ? 0.01 : 0.0019)));
      const wx = this.v.x + ax / this.v.z, wy = this.v.y + ay / this.v.z;
      this.anchor = { sx: ax, sy: ay, wx: wx, wy: wy };
      this.vt = { z: z1, x: wx - ax / z1, y: wy - ay / z1 };
      return;
    }
    const dm = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 400 : 1;
    const d = (Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.deltaY) * dm * 0.0055;
    this.target = this.clampPos(this.target + Math.max(-1.2, Math.min(1.2, d)));
    this.wheelAt = performance.now(); this.wheelSnap = true;
  };
  onDown = ev => {
    if (this.state.lifted) return;
    this.touch(); this.moved = false; this.fling = 0; this.anchor = null;
    this.ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (this.state.board !== null && this.ptrs.size === 2) {
      const [a, b] = [...this.ptrs.values()], s = this.rect();
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: this.vt.z,
        mx: (a.x + b.x) / 2 - s.left, my: (a.y + b.y) / 2 - s.top, vx: this.vt.x, vy: this.vt.y, rect: s };
      this.drag = null; this.moved = true;
      return;
    }
    const mt = performance.now();
    if (this.state.board !== null) { this.vt = { x: this.v.x, y: this.v.y, z: this.vt.z }; this.drag = { b: 1, x: ev.clientX, y: ev.clientY, px: ev.clientX, py: ev.clientY, vx: this.v.x, vy: this.v.y, mt: mt, mx: 0, my: 0 }; }
    else { this.drag = { x: ev.clientX, y: ev.clientY, px: ev.clientX, t: this.pos, mt: mt }; this.target = this.pos; this.vel = 0; this.fadeLoupe(0); }
  };
  onMove = ev => {
    this.px = ev.clientX; this.py = ev.clientY; this.mouse = ev.pointerType === "mouse";
    if (this.ptrs.has(ev.pointerId)) this.ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (this.pinch && this.ptrs.size >= 2) {
      const [a, b] = [...this.ptrs.values()], p = this.pinch;
      const z1 = zclamp(p.z * (Math.hypot(a.x - b.x, a.y - b.y) / p.d));
      const wx = p.vx + (p.mx - p.rect.width / 2) / p.z, wy = p.vy + (p.my - p.rect.height / 2) / p.z;
      const mx = (a.x + b.x) / 2 - p.rect.left, my = (a.y + b.y) / 2 - p.rect.top;
      this.vt = { z: z1, x: wx - (mx - p.rect.width / 2) / z1, y: wy - (my - p.rect.height / 2) / z1 };
      this.v = { x: this.vt.x, y: this.vt.y, z: z1 }; this.bv = { x: 0, y: 0, z: 0 }; this.dirtyNow = true;
      this.touch();
      return;
    }
    if (this.drag) {
      const dx = ev.clientX - this.drag.x, dy = ev.clientY - this.drag.y;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) this.moved = true;
      const inst = ev.clientX - this.drag.px, instY = ev.clientY - (this.drag.py == null ? ev.clientY : this.drag.py);
      const now = performance.now(), mdt = Math.max(1, now - (this.drag.mt || now)), k = Math.min(1, mdt / 40);
      this.drag.mt = now; this.drag.px = ev.clientX; this.drag.py = ev.clientY;
      if (this.drag.b) {
        const z = this.v.z;
        this.v = { z: z, x: this.drag.vx - dx / z, y: this.drag.vy - dy / z };
        this.vt = { z: this.vt.z, x: this.v.x, y: this.v.y };
        this.drag.mx = this.drag.mx * (1 - k) + (-inst / z / mdt) * k;
        this.drag.my = this.drag.my * (1 - k) + (-instY / z / mdt) * k;
        this.bv = { x: 0, y: 0, z: this.bv.z };
      } else {
        this.target = this.clampPos(this.drag.t - dx / 140);
        this.pos = this.target; this.vel = 0;
        this.fling = this.fling * (1 - k) + (-inst / 140 / mdt * 1000) * k;
      }
      this.dirtyNow = true;
      this.touch();
    }
  };
  onUp = ev => {
    this.ptrs.delete(ev.pointerId);
    if (this.ptrs.size < 2) this.pinch = null;
    const d0 = this.drag;
    this.drag = null;
    if (!d0) return;
    const stale = performance.now() - (d0.mt || 0) > 90;
    if (!d0.b && this.state.board === null) {
      const f = stale ? 0 : Math.max(-60, Math.min(60, this.fling));
      this.vel = f; this.target = this.clampPos(Math.round(this.pos + f * 0.22));
      this.fling = 0; this.touch();
    } else if (d0.b && !stale) {
      const mx = d0.mx * 1000, my = d0.my * 1000;
      this.bv = { x: mx, y: my, z: this.bv.z };
      this.vt = { z: this.vt.z, x: this.v.x + mx * 0.32, y: this.v.y + my * 0.32 };
    }
  };
  onKey = ev => {
    const L = this.state.lifted, B = this.state.board;
    if (ev.key === "Escape") { if (L) return this.setState({ lifted: null }); if (B !== null) return this.setState({ board: null }); }
    if (L) {
      if (ev.key === "ArrowRight") { ev.preventDefault(); return this.step(1); }
      if (ev.key === "ArrowLeft") { ev.preventDefault(); return this.step(-1); }
      return;
    }
    if (B !== null) {
      this.anchor = null;
      const pan = ev.shiftKey ? 320 : 140;
      if (ev.key === "ArrowRight") { ev.preventDefault(); this.vt = { z: this.vt.z, x: this.vt.x + pan, y: this.vt.y }; }
      if (ev.key === "ArrowLeft") { ev.preventDefault(); this.vt = { z: this.vt.z, x: this.vt.x - pan, y: this.vt.y }; }
      if (ev.key === "ArrowDown") { ev.preventDefault(); this.vt = { z: this.vt.z, x: this.vt.x, y: this.vt.y + pan }; }
      if (ev.key === "ArrowUp") { ev.preventDefault(); this.vt = { z: this.vt.z, x: this.vt.x, y: this.vt.y - pan }; }
      if (ev.key === "+" || ev.key === "=") this.vt = { x: this.vt.x, y: this.vt.y, z: zclamp(this.vt.z * 1.25) };
      if (ev.key === "-") this.vt = { x: this.vt.x, y: this.vt.y, z: zclamp(this.vt.z / 1.25) };
      return;
    }
    const N = this.items.length;
    if (ev.key === "ArrowRight") { ev.preventDefault(); this.touch(); this.target = this.clampPos(Math.round(this.target) + 1); }
    if (ev.key === "ArrowLeft") { ev.preventDefault(); this.touch(); this.target = this.clampPos(Math.round(this.target) - 1); }
    if (ev.key === "Home") { this.touch(); this.target = 0; }
    if (ev.key === "End") { this.touch(); this.target = N - 1; }
  };
  onLeave = () => { this.px = null; this.fadeLoupe(0); };

  // One frame of physics: springs the table scrub or the board camera toward
  // their targets and re-renders only when something actually moved.
  loop = () => {
    if (!this.alive) return;
    const N = this.items.length, rm = this.reduce;
    const tn = performance.now(), dt = Math.min(0.034, Math.max(0.001, (tn - (this.tprev || tn - 16)) / 1000)); this.tprev = tn;
    let dirty = !!this.dirtyNow; this.dirtyNow = false;
    const spring = (x, v, t, w) => { v += (w * w * (t - x) - 2 * w * v) * dt; return [x + v * dt, v]; };
    if (this.state.board === null) {
      if (this.props.drift && !rm && !this.state.lifted && !this.drag && Date.now() - this.last > 5000 && this.target < N - 1) this.target = Math.min(N - 1, this.target + 0.16 * dt);
      if (this.wheelSnap && !this.drag && tn - (this.wheelAt || 0) > 170) { this.wheelSnap = false; this.target = this.clampPos(Math.round(this.target)); }
      if (this.drag) {}
      else if (rm) { if (this.pos !== this.target) { this.pos = this.target; dirty = true; } }
      else if (Math.abs(this.vel) > 0.003 || Math.abs(this.target - this.pos) > 0.0006) {
        const r = spring(this.pos, this.vel, this.target, 10.5); this.pos = r[0]; this.vel = r[1]; dirty = true;
      } else if (this.pos !== this.target) { this.pos = this.target; this.vel = 0; dirty = true; }
      const tgtE = (this.items[Math.max(0, Math.min(N - 1, Math.round(this.pos)))] || this.items[0]).e;
      if (this.epos !== undefined && Math.abs(tgtE - this.epos) > 0.0008) dirty = true;
    } else if (rm) {
      if (this.v.x !== this.vt.x || this.v.y !== this.vt.y || this.v.z !== this.vt.z) { this.v = { x: this.vt.x, y: this.vt.y, z: this.vt.z }; dirty = true; }
    } else {
      const v = this.v, vt = this.vt, bv = this.bv, CL = 2400;
      vt.x = Math.max(-CL, Math.min(CL, vt.x)); vt.y = Math.max(-CL, Math.min(CL, vt.y));
      const zr = spring(v.z, bv.z, vt.z, 14); let nz = zr[0]; bv.z = zr[1];
      let nx = v.x, ny = v.y;
      if (this.anchor) {
        const A = this.anchor; nx = A.wx - A.sx / nz; ny = A.wy - A.sy / nz; bv.x = 0; bv.y = 0;
        if (Math.abs(vt.z - nz) < 0.0003 && Math.abs(bv.z) < 0.002) { this.anchor = null; nz = vt.z; nx = vt.x; ny = vt.y; }
      } else if (!(this.drag && this.drag.b)) {
        const rx = spring(v.x, bv.x, vt.x, 7.5), ry = spring(v.y, bv.y, vt.y, 7.5);
        nx = rx[0]; bv.x = rx[1]; ny = ry[0]; bv.y = ry[1];
      }
      const far = Math.abs(vt.x - nx) > 0.2 || Math.abs(vt.y - ny) > 0.2 || Math.abs(vt.z - nz) > 0.0002 || Math.abs(bv.x) > 0.8 || Math.abs(bv.y) > 0.8 || Math.abs(bv.z) > 0.002;
      if (far) { this.v = { x: nx, y: ny, z: nz }; dirty = true; }
      else if (v.x !== vt.x || v.y !== vt.y || v.z !== vt.z) { this.v = { x: vt.x, y: vt.y, z: vt.z }; this.bv = { x: 0, y: 0, z: 0 }; dirty = true; }
    }
    if (this.state.board === null) this.detent();
    if (dirty) this.forceUpdate();
    if (this.state.board === null && this.mouse) this.updateLoupe(dt);
    this.raf = requestAnimationFrame(this.loop);
  };

  // Feedback each time the playhead crosses a frame: haptic tick, a pulse on
  // the playhead, and (optionally) a shutter click. Roll boundaries hit harder.
  detent(){
    const N = this.items.length, fi = Math.max(0, Math.min(N - 1, Math.round(this.pos)));
    if (this.lastDetent === undefined) { this.lastDetent = fi; return; }
    if (fi === this.lastDetent) return;
    this.lastDetent = fi;
    const roll = !!(this.items[fi] && this.items[fi].first), now = performance.now();
    if (now - (this.lastClick || 0) < 28) return;
    this.lastClick = now;
    const user = !!this.drag || now - (this.wheelAt || 0) < 400 || Date.now() - this.last < 600;
    if (this.props.haptics && user && navigator.vibrate) { try { navigator.vibrate(roll ? 12 : 4); } catch (e) {} }
    const h = this.headEl;
    if (h && h.animate && !this.reduce) h.animate([{ transform: roll ? "scale(1.22,1.06)" : "scale(1.1,1.02)", borderColor: "rgba(255,255,255,.75)" }, { transform: "none", borderColor: "rgba(255,255,255,.3)" }], { duration: roll ? 320 : 180, easing: "cubic-bezier(.2,.8,.2,1)" });
    if (this.props.tickSound && user) this.click(roll);
  }
  click(roll){
    try {
      const A = this.actx || (this.actx = new (window.AudioContext || window.webkitAudioContext)());
      if (A.state === "suspended") A.resume();
      const len = Math.floor(A.sampleRate * (roll ? 0.012 : 0.005)), b = A.createBuffer(1, len, A.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
      const src = A.createBufferSource(), f = A.createBiquadFilter(), g = A.createGain();
      f.type = "bandpass"; f.frequency.value = roll ? 2400 : 3600; f.Q.value = 1.4; g.gain.value = roll ? 0.22 : 0.12;
      src.buffer = b; src.connect(f); f.connect(g); g.connect(A.destination); src.start();
    } catch (e) {}
  }
  zoomBy(f){
    this.anchor = null;
    this.vt = { x: this.vt.x, y: this.vt.y, z: zclamp(this.vt.z * f) }; this.touch();
  }
  fitBoard(){
    this.anchor = null;
    if (this.state.board === null) return;
    const its = this.boardItems(this.state.board);
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    its.forEach(o => { x0 = Math.min(x0, o.x); x1 = Math.max(x1, o.x + o.w); y0 = Math.min(y0, o.y); y1 = Math.max(y1, o.y + o.h); });
    const W = this.lastW || 1280, H = this.lastH || 800;
    const z = Math.max(0.3, Math.min(1.4, Math.min((W - 80) / (x1 - x0), (H - 260) / (y1 - y0))));
    this.vt = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: z }; this.touch();
  }
  fadeLoupe(o){
    const on = !!o, b = this.loupeEl && this.loupeEl.firstElementChild;
    if (this.loupeOn === on || !b) return;
    this.loupeOn = on; b.style.opacity = on ? "1" : "0"; b.style.transform = on ? "scale(1)" : "scale(.7)";
  }
  // The loupe follows the pointer over contact-sheet frames, magnifying the
  // mid-size image under it. Driven straight on the DOM to stay off React.
  updateLoupe(dt){
    const lp = this.loupeEl, st = this.stageEl, li = this.lensEl;
    if (!lp || !st || !li) return;
    if (this.state.lifted || this.state.board !== null || this.px == null || this.narrow || this.drag) return this.fadeLoupe(0);
    const hit = document.elementFromPoint(this.px, this.py);
    const img = hit && hit.closest ? hit.closest("[data-frame]") : null;
    if (!img) return this.fadeLoupe(0);
    const s = st.getBoundingClientRect(), tx = this.px - s.left, ty = this.py - s.top;
    if (!this.loupeOn || this.lx == null) { this.lx = tx; this.ly = ty; }
    else { const k = 1 - Math.exp(-(dt || 0.016) * 24); this.lx += (tx - this.lx) * k; this.ly += (ty - this.ly) * k; }
    this.fadeLoupe(1);
    const z = this.props.loupeZoom, R = 86, r = img.getBoundingClientRect();
    const cx = this.lx + s.left, cy = this.ly + s.top;
    lp.style.transform = "translate3d(" + this.lx.toFixed(2) + "px," + this.ly.toFixed(2) + "px,0)";
    const src = img.getAttribute("data-src");
    if (li._src !== src) { li._src = src; li.style.backgroundImage = "url(" + src + ")"; }
    li.style.backgroundSize = (r.width * z).toFixed(1) + "px " + (r.height * z).toFixed(1) + "px";
    li.style.backgroundPosition = (R - (cx - r.left) * z).toFixed(1) + "px " + (R - (cy - r.top) * z).toFixed(1) + "px";
  }

  // Swaps the full-screen preview image, cross-fading once the next one loads.
  syncLift(){
    const el = this.liftEl, L = this.state.lifted;
    if (!el || !L) return;
    const want = MID(L.e * 13 + L.k);
    if (el.getAttribute("src") === want) return;
    if (el.getAttribute("src")) {
      el.style.transition = "none"; el.style.opacity = "0"; el.style.transform = "scale(.985)";
      el.onload = () => requestAnimationFrame(() => { el.style.transition = "opacity .42s cubic-bezier(.2,.8,.2,1),transform .6s cubic-bezier(.16,.84,.14,1)"; el.style.opacity = "1"; el.style.transform = "none"; });
    }
    el.src = want;
  }
  download(){
    const L = this.state.lifted; if (!L) return;
    const src = MID(L.e * 13 + L.k), a = document.createElement("a");
    a.href = src;
    a.download = this.rolls[L.e].name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + pad3(L.k + 1) + src.slice(src.lastIndexOf("."));
    document.body.appendChild(a); a.click(); a.remove();
  }

  setStage = el => {
    this.stageEl = el;
    if (el && this.ro) this.ro.observe(el);
  };
  setLoupe = el => { this.loupeEl = el; };
  setLens = el => { this.lensEl = el; };
  setHead = el => { this.headEl = el; };
  setLiftImg = el => {
    if (this.fitRo) { this.fitRo.disconnect(); this.fitRo = null; }
    this.liftEl = el;
    if (!el) return;
    this.syncLift();
    const row = el.parentElement && el.parentElement.parentElement;
    if (!row) return;
    const fit = () => {
      el.style.maxHeight = Math.max(90, row.clientHeight - 2) + "px";
      el.style.maxWidth = Math.max(90, row.clientWidth - 2) + "px";
    };
    fit();
    this.fitRo = new ResizeObserver(fit);
    this.fitRo.observe(row);
  };

  render(){
    const pos = this.pos, N = this.items.length;
    const W = this.state.w || 1280, H = this.state.h || 800;
    this.lastW = W; this.lastH = H;
    const narrow = W < 760;
    const ci = Math.max(0, Math.min(N - 1, Math.round(pos))), cit = this.items[ci], cur = this.rolls[cit.e];
    const i0 = Math.floor(pos), fr = pos - i0, a0 = this.items[i0] || cit, a1 = this.items[i0 + 1] || a0;
    const within = a0.ef - Math.floor(a0.ef) + (a1.ef - a0.ef) * fr;
    if (this.epos === undefined) this.epos = cit.e;
    const de = cit.e - this.epos;
    this.epos += Math.abs(de) < 0.0008 ? de : de * (this.reduce ? 1 : 0.135);
    const ef = this.epos;
    const B = this.state.board, z = this.v.z;
    const TICK = narrow ? 6 : 9;

    const styleName = String(this.props.tableStyle);
    const style = styleName === "Plate" ? "plate" : styleName === "Mosaic" ? "mosaic" : "sheet";
    const cols = style === "sheet" ? (narrow ? 4 : 5) : 6;
    const maxRows = style === "sheet" ? (narrow ? 4 : 5) : 4;
    const gap = style === "sheet" ? 5 : 7, pad = narrow ? 12 : 15;
    const topPad = narrow ? 86 : 108, botPad = narrow ? 104 : 132;
    const band = Math.max(200, H - topPad - botPad);
    const sheetW = Math.round(Math.min(narrow ? W - 24 : W * 0.62, style === "sheet" ? 880 : 940));
    const CU = (sheetW - pad * 2 - gap * (cols - 1)) / cols;
    const RU = style === "sheet" ? CU / 1.5 : (2 * CU + gap) / 1.5;
    const chrome = (narrow ? 30 : 34) + 24 + pad * 2 + 16 + gap;
    const ROWS = Math.max(2, Math.min(maxRows, Math.floor((band - chrome + gap) / (RU + gap))));
    const CELL = sheetW + (narrow ? 34 : 56);
    const plan = spans(style, ROWS, cols);

    // Contact sheets within reach of the current roll, fanned out either side.
    const sheets = [];
    if (B === null) this.rolls.forEach((r, i) => {
      const d = i - ef, a = Math.abs(d);
      if (a > 1.6) return;
      sheets.push({ i: i, r: r,
        t: "translate(-50%,-50%) translateX(" + (d * CELL + (i === cit.e ? -within * 14 : 0)).toFixed(2) + "px) translateY(" + ((i % 2 ? 1 : -1) * 7) + "px) rotate(" + (d * 0.45).toFixed(2) + "deg) scale(" + (1 - Math.min(a, 2) * 0.035).toFixed(4) + ")",
        dim: (Math.min(a, 1.8) * 0.32).toFixed(3) });
    });

    // Timeline: one tick per frame, tinted with that frame's photo. Around the
    // playhead a lens spreads and lifts the ticks (like the macOS Dock), and
    // colour falls away to silver toward the rail's ends.
    const LENS = narrow ? 2.2 : 2.8, MAG = narrow ? 1.1 : 1.35;
    const warp = d => TICK * (d + MAG * LENS * Math.tanh(d / LENS));
    const ready = () => { this.dirtyNow = true; };
    const ticks = [];
    const tlo = Math.max(0, ci - 90), thi = Math.min(N, ci + 91);
    let rollLo = Infinity, rollHi = -Infinity;
    for (let i = tlo; i < thi; i++) {
      const it = this.items[i], d = i - pos, a = Math.abs(d);
      const g = Math.exp(-a * a / 7), major = it.k % 5 === 0;
      const h = ((it.first ? 30 : major ? 16 : 9) + 22 * g) * (narrow ? 0.78 : 1), o0 = it.first ? 0.95 : major ? 0.7 : 0.48;
      const tint = tintOf(TH(it.e * 13 + it.k), ready) || SILVER;
      const c = mixRgb(SILVER, tint, 0.45 + 0.55 * Math.exp(-a * a / 140));
      if (it.e === cit.e) { rollLo = Math.min(rollLo, d); rollHi = Math.max(rollHi, d); }
      ticks.push({ i: i, x: warp(d).toFixed(2), s: (h / 58).toFixed(4), w: (1 + 0.9 * g).toFixed(3), o: (o0 + (1 - o0) * g).toFixed(3),
        c: "rgb(" + c.join(",") + ")", glow: a < 4 ? "0 0 " + (2 + 8 * g).toFixed(1) + "px rgba(" + tint.join(",") + "," + (0.85 * g).toFixed(2) + ")" : "none",
        cap: it.first, capB: (h + 3).toFixed(1) + "px" });
    }
    // The current roll is underlined in the colour of the frame being viewed.
    const span = { x0: warp(rollLo), x1: warp(rollHi), c: (tintOf(TH(cit.e * 13 + cit.k), ready) || SILVER).join(",") };
    let lastX = -1e9; const marks = [];
    this.items.forEach((it, i) => {
      if (!it.first) return;
      const x = warp(i - pos), on = it.e === cit.e, MIN = narrow ? 70 : 88;
      if (!on && x - lastX < MIN) return;
      if (on) while (marks.length && x - marks[marks.length - 1].x < MIN) marks.pop();
      lastX = x;
      const dup = this.items.some(o => o.first && o.e !== it.e && o.date.slice(3) === it.date.slice(3));
      marks.push({ e: it.e, label: dup ? it.date : it.date.slice(3), x: x, c: on ? "#F2F5F9" : "rgba(225,231,238,.8)", o: Math.abs(i - pos) < 140 ? 1 : 0 });
    });

    // Prints pinned to the board, culled to what's near the viewport.
    const pinned = [];
    let bName = "", bMeta = "";
    if (B !== null) {
      const br = this.rolls[B], its = this.boardItems(B);
      const hw = W / (2 * z) + 300, hh = H / (2 * z) + 300;
      const x0 = this.v.x - hw, x1 = this.v.x + hw, y0 = this.v.y - hh, y1 = this.v.y + hh;
      its.forEach(it => {
        if (it.x > x1 || it.x + it.w < x0 || it.y > y1 || it.y + it.h < y0) return;
        pinned.push({ it: it, label: "Open frame " + pad3(it.i + 1) + " of " + br.name });
      });
      bName = br.name;
      bMeta = br.date + " · " + br.count + " frames";
    }

    const ox = W / 2 - this.v.x * z, oy = H / 2 - this.v.y * z;
    const L = this.state.lifted, lr = L ? this.rolls[L.e] : null;
    const lKey = L ? L.e * 1000 + L.k : -1, kept = !!this.state.keep[lKey];
    const strip = [];
    if (L) {
      const n = this.boardItems(L.e).length, span = narrow ? 5 : 9;
      for (let d = -Math.floor(span / 2); d <= Math.floor(span / 2); d++) strip.push({ d: d, k: (L.k + d + n * 2) % n });
    }
    const specs = L ? [
      { k: "Stock", v: "Type-400" },
      { k: "Shutter", v: SHUT[(L.e * 13 + L.k) % SHUT.length] },
      { k: "Aperture", v: APER[(L.e * 7 + L.k) % APER.length] }
    ] : [];
    const showStrip = !!L && H > 560;
    const bt = narrow ? 10 : 16, lbh = narrow ? 48 : 54;
    const corkTone = this.props.corkTone;

    return (
      <div className="ns-stage" ref={this.setStage}>
        <div className="ns-cork" aria-hidden="true">
          <div className="ns-cork__base" />
          <div className="ns-cork__tile" style={{ transform: "translate3d(" + (-((pos * 9) % 768)).toFixed(2) + "px," + (-((pos * 2) % 768)).toFixed(2) + "px,0)" }} />
          <div className="ns-cork__tile ns-cork__tile--soft" style={{ transform: "translate3d(" + (180 - ((pos * 9) % 1236)).toFixed(2) + "px," + (-((pos * 2 + 260) % 1236)).toFixed(2) + "px,0)" }} />
          <div className="ns-cork__tone" style={{ background: corkTone }} />
          <div className="ns-cork__light" />
          <div className="ns-cork__edge" />
        </div>

        <div className="ns-table" style={{ top: Math.round(topPad + band / 2) + "px", opacity: B !== null ? 0 : 1 }}>
          {sheets.map(({ i, r, t, dim }) => (
            <div key={i} className="ns-sheet" style={{ width: sheetW + "px", transform: t }}>
              <div className="ns-sheet__shadow" />
              <div className="ns-sheet__body" style={{ padding: (pad + 16) + "px " + pad + "px " + pad + "px" }}>
                <div className="ns-sheet__sheen" />
                <div className="ns-sheet__head" style={{ marginBottom: gap + "px" }}>
                  <h2 className="ns-sheet__title">{r.name}</h2>
                  <span className="ns-sheet__date">{r.date}</span>
                </div>
                <div className="ns-sheet__grid" style={{ gap: gap + "px", gridTemplateColumns: "repeat(" + cols + ",1fr)", gridAutoRows: RU.toFixed(2) + "px" }}>
                  {plan.map((sp, k) => {
                    const id = i * 13 + k, no = pad2(k + 1);
                    return (
                      <div key={k} className="ns-frame" style={{ gridArea: sp[0] + " / " + sp[1] + " / span " + sp[2] + " / span " + sp[3] }}>
                        <button type="button" className="ns-frame__btn" aria-label={"Open " + r.name + ", frame " + no} onClick={() => { if (!this.moved) this.openBoard(i, k); }}>
                          <img className="ns-frame__img" src={TH(id)} alt="" draggable={false} loading="lazy" data-frame="1" data-src={MID(id)} />
                        </button>
                        <div className="ns-frame__edge" />
                        {style === "sheet" && <div className="ns-frame__no">{no}</div>}
                        {!!this.state.keep[i * 1000 + k] && <div className="ns-frame__kept" />}
                      </div>
                    );
                  })}
                </div>
                <div className="ns-sheet__foot">
                  <span>{"Roll " + pad2(this.rolls.length - i)} · Type-400</span>
                  <span>{r.count + " frames · " + (narrow ? "tap to open" : "click a frame to open the board")}</span>
                </div>
                <Pin colour="ivory" variant={1 + (i % 3)} style={{ left: 22, top: 15 }} />
                <Pin colour="ivory" variant={1 + ((i + 1) % 3)} style={{ left: "calc(100% - 22px)", top: 15 }} />
                <div className="ns-sheet__dim" style={{ opacity: dim }} />
              </div>
            </div>
          ))}
        </div>

        {B !== null && (
          <div className="ns-board">
            <div className="ns-board__base" />
            <div className="ns-board__world" style={{ transform: "translate3d(" + ox.toFixed(2) + "px," + oy.toFixed(2) + "px,0) scale(" + z.toFixed(4) + ")" }}>
              <div className="ns-board__cork" />
              <div className="ns-board__cork ns-board__cork--soft" />
              <div className="ns-board__tone" style={{ background: corkTone }} />
              {pinned.map(({ it, label }) => (
                <div key={it.i} className="ns-print" style={{ left: it.x + "px", top: it.y + "px", width: it.w + "px", height: it.h + "px", transform: "rotate(" + it.rot.toFixed(2) + "deg)" }}>
                  <div className="ns-print__shadow" />
                  <button type="button" className="ns-print__btn" aria-label={label} onClick={() => { if (!this.moved) this.setState({ lifted: { e: B, k: it.i } }); }}>
                    <img className="ns-print__img" src={TH(it.id)} alt="" draggable={false} loading="lazy" data-frame="1" data-src={MID(it.id)} style={{ filter: "brightness(" + it.expo + ") saturate(" + it.sat + ")" }} />
                    <div className="ns-print__edge" />
                    <div className="ns-print__sheen" />
                  </button>
                  {it.att === 1 && <Tape variant={it.tapeV} width={Math.round(Math.min(120, it.w * 0.4))} />}
                  {it.att === 2 && <Pin colour={it.pin} variant={it.pinV} style={{ left: 9, top: 9 }} />}
                  {it.att === 2 && <Pin colour={it.pin} variant={it.pinV2} style={{ left: "calc(100% - 9px)", top: 9 }} />}
                  {it.att === 0 && <Pin colour={it.pin} variant={it.pinV} style={{ left: "50%", top: 13 }} />}
                </div>
              ))}
            </div>
            <div className="ns-board__vignette" />
          </div>
        )}

        <div className="ns-loupe" ref={this.setLoupe} aria-hidden="true">
          <div className="ns-loupe__body">
            <div className="ns-loupe__drop" />
            <div className="ns-loupe__bezel" />
            <div className="ns-loupe__well" />
            <div className="ns-loupe__glass">
              <div className="ns-loupe__img" ref={this.setLens} />
              <div className="ns-loupe__falloff" />
              <div className="ns-loupe__tint" />
              <div className="ns-loupe__flare" />
              <div className="ns-loupe__flare ns-loupe__flare--low" />
              <div className="ns-loupe__rim" />
            </div>
            <div className="ns-loupe__label">{this.props.loupeZoom.toFixed(1) + "×"}</div>
          </div>
        </div>

        <header className="ns-bar">
          <div className="ns-bar__sheen" />
          <div className="ns-bar__gloss" />
          <div className="ns-bar__id">
            <span className="ns-mark" />
            <div className="ns-bar__text">
              <span className="ns-bar__title">{B === null ? "The Archive" : bName}</span>
              <span className="ns-bar__meta" aria-live="polite">{B === null ? cur.name + " · " + cur.date : bMeta}</span>
            </div>
          </div>
          <div className="ns-bar__actions">
            {B !== null && (
              <div className="ns-zoom" role="group" aria-label="Zoom">
                <button type="button" className="ns-zoom__btn" aria-label="Zoom out" onClick={() => this.zoomBy(0.8)}>−</button>
                <span className="ns-zoom__pct">{Math.round(z * 100) + "%"}</span>
                <button type="button" className="ns-zoom__btn ns-zoom__btn--in" aria-label="Zoom in" onClick={() => this.zoomBy(1.25)}>+</button>
                <button type="button" className="ns-zoom__fit" onClick={() => this.fitBoard()}>Fit</button>
              </div>
            )}
            {B !== null && <button type="button" className="ns-back" onClick={() => this.setState({ board: null })}>‹  Table</button>}
          </div>
        </header>

        <div className="ns-rail" role="group" aria-label="Frame timeline">
          <div className="ns-rail__sheen" />
          <div className="ns-rail__gloss" />
          <div className="ns-rail__progress" style={{ transform: "scaleX(" + (N > 1 ? pos / (N - 1) : 0).toFixed(4) + ")" }} />
          <div className="ns-rail__track">
            <div className="ns-rail__base" />
            <div className="ns-rail__ticks">
              <div className="ns-rail__reel">
                {ticks.map(t => (
                  <div key={t.i} className="ns-tick" style={{ transform: "translateX(" + t.x + "px)" }}>
                    <div className="ns-tick__bar" style={{ transform: "scale(" + t.w + "," + t.s + ")", opacity: t.o, backgroundColor: t.c, boxShadow: t.glow }} />
                    <div className="ns-tick__foot" />
                    {t.cap && <div className="ns-tick__cap" style={{ bottom: t.capB }} />}
                  </div>
                ))}
              </div>
            </div>
            <div className="ns-rail__aura" style={{ "--tint": span.c }} />
            <div className="ns-rail__span" style={{ left: "calc(50% + " + span.x0.toFixed(2) + "px)", width: Math.max(0, span.x1 - span.x0).toFixed(2) + "px", "--tint": span.c }} />
            <div className="ns-rail__ruler">
              <div className="ns-rail__marks">
                {marks.map(m => (
                  <div key={m.e} className="ns-rail__label" style={{ left: m.x.toFixed(2) + "px", color: m.c, opacity: m.o }}>{m.label}</div>
                ))}
              </div>
            </div>
          </div>
          <div className="ns-playhead" ref={this.setHead}>
            <div className="ns-playhead__line" />
            <div className="ns-playhead__notch ns-playhead__notch--top" />
            <div className="ns-playhead__notch ns-playhead__notch--bottom" />
          </div>
          <div className="ns-readout ns-readout--start">
            <span className="ns-readout__k">Frame</span>
            <span className="ns-readout__v">{String(ci + 1).padStart(4, "0")}<span className="ns-readout__of"> / {String(N).padStart(4, "0")}</span></span>
          </div>
          <div className="ns-readout ns-readout--end">
            <span className="ns-readout__k">Roll</span>
            <span className="ns-readout__v">{pad2(this.rolls.length - cit.e) + " / " + pad2(this.rolls.length)}</span>
          </div>
        </div>

        <p className="ns-hint">{B === null ? "Drag or ← → to scrub · hover to loupe" : "Drag to pan · scroll or pinch to zoom · esc to exit"}</p>

        {L && (
          <div className="ns-lift" role="dialog" aria-modal="true" aria-label="Frame preview">
            <div className="ns-lift__ambient" style={{ backgroundImage: "url(" + MID(L.e * 13 + L.k) + ")" }} />
            <div className="ns-lift__shade" />
            <div className="ns-lift__stage" style={{ inset: (bt + lbh + 14) + "px " + (narrow ? 10 : 80) + "px " + (showStrip ? bt + 58 + 14 : bt + 14) + "px" }}>
              <figure className="ns-lift__figure">
                <img className="ns-lift__img" ref={this.setLiftImg} alt={lr.name + ", frame " + pad3(L.k + 1)} draggable={false} decoding="async" />
              </figure>
            </div>
            <button type="button" className="ns-glass ns-nav ns-nav--prev" aria-label="Previous frame" onClick={() => this.step(-1)}>‹</button>
            <button type="button" className="ns-glass ns-nav ns-nav--next" aria-label="Next frame" onClick={() => this.step(1)}>›</button>
            <div className="ns-glass ns-liftbar">
              <div className="ns-glass__sheen" />
              <div className="ns-liftbar__id">
                <span className="ns-mark" />
                <div className="ns-liftbar__text">
                  <span className="ns-liftbar__title">{lr.name}</span>
                  <span className="ns-liftbar__meta">{lr.date + " · " + lr.count + " frames on roll"}</span>
                </div>
              </div>
              <div className="ns-liftbar__actions">
                <span className="ns-liftbar__count ns-wide">{pad3(L.k + 1) + " / " + pad3(this.boardItems(L.e).length)}</span>
                <button type="button" className="ns-liftbar__btn" aria-pressed={kept ? "true" : "false"} onClick={() => this.setState(s => { const m = Object.assign({}, s.keep); m[lKey] = !m[lKey]; return { keep: m }; })}>
                  <span className="ns-keep__box" style={{ background: kept ? "#F2F5F9" : "transparent", borderColor: kept ? "#F2F5F9" : "rgba(255,255,255,.55)" }} />
                  {kept ? "Kept" : "Keep"}
                </button>
                <button type="button" className="ns-liftbar__btn ns-wide" onClick={() => this.download()}>Download</button>
                <button type="button" className="ns-liftbar__btn ns-liftbar__close" aria-label="Close preview" onClick={() => this.setState({ lifted: null })}>
                  <span className="ns-wide">Close</span><span className="ns-liftbar__x">×</span>
                </button>
              </div>
            </div>
            {showStrip && (
              <div className="ns-glass ns-strip">
                <div className="ns-glass__sheen" />
                <div className="ns-specs ns-wide">
                  {specs.map(sp => (
                    <div key={sp.k} className="ns-spec">
                      <span className="ns-spec__k">{sp.k}</span>
                      <span className="ns-spec__v">{sp.v}</span>
                    </div>
                  ))}
                </div>
                <div className="ns-strip__reel">
                  {strip.map(({ d, k }) => {
                    const on = d === 0;
                    return (
                      <button key={d} type="button" className="ns-strip__thumb" aria-label={"Frame " + pad3(k + 1)} aria-current={on ? "true" : "false"}
                        style={{ width: (on ? 54 : 46) + "px", opacity: on ? 1 : 0.48, borderColor: on ? "#F2F5F9" : "rgba(255,255,255,.16)" }}
                        onClick={() => this.setState({ lifted: { e: L.e, k: k } })}>
                        <img src={TH(L.e * 13 + k)} alt="" draggable={false} loading="lazy" />
                      </button>
                    );
                  })}
                </div>
                <span className="ns-strip__hint ns-wide">← → frame · esc close</span>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }
}
