import { Component } from "react";
import type { CSSProperties } from "react";
import type { ArchivePhoto, ArchiveShoot } from "./archive";
import loupeArt from "./assets/loupe/loupe.webp";
const PINS = ["ivory", "graphite", "red"] as const;
type PinColor = typeof PINS[number];
type Span = [row: number, column: number, rowSpan: number, columnSpan: number];
type Roll = ArchiveShoot & { name: string; count: number };
type TimelineItem = { e: number; k: number; first: boolean; ef: number; date: string };
type BoardItem = {
  i: number; att: number; w: number; h: number; x: number; y: number;
  rot: number; expo: string; sat: string; pin: PinColor;
  pinV: number; pinV2: number; tapeV: number;
};
type Camera = { x: number; y: number; z: number };
type Point = { x: number; y: number };
type Lifted = { e: number; k: number };
type StageRect = Pick<DOMRect, "left" | "top" | "width" | "height">;
type BoardDrag = { b: 1; x: number; y: number; px: number; py: number; vx: number; vy: number; mt: number; mx: number; my: number };
type TableDrag = { b?: 0; x: number; y: number; px: number; py?: number; t: number; mt: number; rail: boolean };
type Drag = BoardDrag | TableDrag;
type Pinch = { d: number; z: number; mx: number; my: number; vx: number; vy: number; rect: StageRect };
type Preview = { scale: number; x: number; y: number };
type PreviewGesture =
  | { mode: "pan"; startX: number; startY: number; x: number; y: number }
  | { mode: "pinch"; distance: number; scale: number; centerX: number; centerY: number; x: number; y: number };
type LightTableProps = {
  shoots: ArchiveShoot[];
  initialShoot: string | null;
  tableStyle: "Contact sheet" | "Plate" | "Mosaic";
  loupeZoom: number;
  corkTone: string;
  haptics: boolean;
  tickSound: boolean;
  drift: boolean;
};
type LightTableState = { board: number | null; lifted: Lifted | null; w: number; h: number };
type LensElement = HTMLDivElement & { _src?: string | null };

const rnd = (s: number) => { const x = Math.sin(s * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const zclamp = (z: number) => Math.max(0.3, Math.min(2.8, z));
const pad2 = (n: number) => String(n).padStart(2, "0");
const previewClamp = (value: number) => Math.max(1, Math.min(5, value));

// Grid placements [row, col, rowSpan, colSpan] for each contact-sheet layout.
function spans(style: "sheet" | "plate" | "mosaic", rows: number, cols: number): Span[]{
  const out: Span[] = [];
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
// centred on its needle; tape sprites are rendered with translucent edges.
const art = import.meta.glob<string>("./assets/{pins,tape}/*.webp", { eager: true, query: "?url", import: "default" });
const pinArt = (colour: PinColor, variant: number) => art["./assets/pins/pin-" + colour + "-" + variant + ".webp"];
const tapeArt = (variant: number) => art["./assets/tape/tape-" + variant + ".webp"];
const cornerTapeArt = (variant: number) => art["./assets/tape/tape-corner-" + variant + ".webp"];

function Pin({ colour, variant, style }: { colour: PinColor; variant: number; style: CSSProperties }){
  return <img className="ns-pin" src={pinArt(colour, variant)} style={style} alt="" draggable={false} aria-hidden="true" />;
}

// `width` is the length of tape the print wants; the sprite's canvas is a bit
// wider (84mm of canvas to 70mm of tape).
function Tape({ variant, width }: { variant: number; width: number }){
  return <img className="ns-tape" src={tapeArt(variant)} style={{ width: width * 1.2 + "px" }} alt="" draggable={false} aria-hidden="true" />;
}

function CornerTape({ variant, side, width }: { variant: number; side: string; width: number }){
  const second = variant === 1 ? 2 : 1;
  return <span className={`ns-tape-corner ns-tape-corner--${side}`} style={{ width: `${width}px`, height: `${width}px` }} aria-hidden="true">
    <img className="ns-tape-corner__piece ns-tape-corner__piece--horizontal" src={cornerTapeArt(variant)} alt="" draggable={false} />
    <img className="ns-tape-corner__piece ns-tape-corner__piece--vertical" src={cornerTapeArt(second)} alt="" draggable={false} />
  </span>;
}

export default class LightTable extends Component<LightTableProps, LightTableState> {
  static defaultProps = {
    tableStyle: "Contact sheet", // "Contact sheet" | "Plate" | "Mosaic"
    loupeZoom: 1.8,
    corkTone: "#C8813F",
    haptics: true,
    tickSound: false,
    drift: false
  };

  declare rolls: Roll[];
  declare items: TimelineItem[];
  declare pos: number;
  declare target: number;
  declare vel: number;
  declare drag: Drag | null;
  declare moved: boolean;
  declare last: number;
  declare ptrs: Map<number, Point>;
  declare pinch: Pinch | null;
  declare fling: number;
  declare preview: Preview;
  declare previewPointers: Map<number, Point>;
  declare previewGesture: PreviewGesture | null;
  declare v: Camera;
  declare vt: Camera;
  declare bv: Camera;
  _be?: string;
  _bi?: BoardItem[];
  stageEl: HTMLDivElement | null = null;
  loupeEl: HTMLDivElement | null = null;
  lensEl: LensElement | null = null;
  headEl: HTMLDivElement | null = null;
  railEl: HTMLDivElement | null = null;
  liftEl: HTMLImageElement | null = null;
  liftRootEl: HTMLDivElement | null = null;
  liftStageEl: HTMLDivElement | null = null;
  liftFigureEl: HTMLElement | null = null;
  liftCloseEl: HTMLButtonElement | null = null;
  previewPctEl: HTMLOutputElement | null = null;
  ro: ResizeObserver | null = null;
  fitRo: ResizeObserver | null = null;
  preBoard: Lifted | null = null;
  preBoardFocus: HTMLElement | null = null;
  preLiftFocus: HTMLElement | null = null;
  anchor: { sx: number; sy: number; wx: number; wy: number } | null = null;
  raf = 0;
  alive = false;
  tprev?: number;
  dirtyNow = false;
  epos?: number;
  wheelAt?: number;
  wheelSnap = false;
  px: number | null = null;
  py: number | null = null;
  mouse = false;
  lastW?: number;
  lastH?: number;
  boardFitted = false;
  lastDetent?: number;
  lastClick?: number;
  actx?: AudioContext;
  loupeOn = false;
  lx: number | null = null;
  ly: number | null = null;
  tickSpacing?: number;

  constructor(p: LightTableProps){
    super(p);
    this.rolls = p.shoots.map(shoot => ({
      ...shoot,
      name: shoot.title,
      count: shoot.photos.length,
      date: shoot.displayDate,
    }));
    const items: TimelineItem[] = [];
    this.rolls.forEach((roll, ei) => {
      const n = roll.photos.length;
      for (let k = 0; k < n; k++) items.push({ e: ei, k, first: k === 0, ef: ei + k / n, date: roll.date });
    });
    this.items = items;
    this.state = { board: null, lifted: null, w: window.innerWidth, h: window.innerHeight };
    this.pos = 0; this.target = 0; this.vel = 0; this.drag = null; this.moved = false; this.last = Date.now();
    this.ptrs = new Map(); this.pinch = null; this.fling = 0;
    this.preview = { scale: 1, x: 0, y: 0 };
    this.previewPointers = new Map(); this.previewGesture = null;
    this.v = { x: 0, y: 0, z: 1 }; this.vt = { x: 0, y: 0, z: 1 }; this.bv = { x: 0, y: 0, z: 0 };
    const selected = this.rolls.findIndex(roll => roll.id === p.initialShoot);
    if (selected > 0) {
      this.pos = this.items.findIndex(item => item.e === selected);
      this.target = this.pos;
    }
  }
  photo(e: number, k: number): ArchivePhoto | undefined { return this.rolls[e]?.photos[k]; }
  thumb(e: number, k: number): string { return this.photo(e, k)?.formats?.webp?.thumb || this.photo(e, k)?.thumb || ""; }
  mid(e: number, k: number): string { return this.photo(e, k)?.formats?.webp?.mid || this.photo(e, k)?.mid || ""; }
  full(e: number, k: number): string { return this.photo(e, k)?.formats?.webp?.full || this.photo(e, k)?.full || this.photo(e, k)?.mid || ""; }
  get narrow(){ return (this.lastW || this.state.w || 1280) < 760; }
  get reduce(){ return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); }
  clampPos(v: number){ return Math.max(0, Math.min(this.items.length - 1, v)); }
  touch(){ this.last = Date.now(); }

  boardItems(e: number): BoardItem[]{
    const key = e + "|" + (this.narrow ? 1 : 0);
    if (this._be === key && this._bi) return this._bi;
    const r = this.rolls[e], n = r.photos.length;
    const TRW = this.narrow ? 760 : 1120, G = 30;
    const out: BoardItem[] = [], rowsOf: { cells: { i: number; a: number }[]; sum: number; partial?: boolean }[] = [];
    let row: { i: number; a: number }[] = [], sum = 0;
    for (let i = 0; i < n; i++) {
      const photo = r.photos[i];
      const a = Math.max(0.7, Math.min(2.0, photo.width && photo.height ? photo.width / photo.height : 1.5));
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
        const r2 = rnd(s + 2), att = c.i % 5 === 0 ? 3 : r2 > 0.67 ? 1 : r2 > 0.4 ? 2 : 0;
        out.push({ i: c.i, att: att, w: w, h: h, x: Math.round(x), y: y,
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
  openBoard(e: number, k: number){
    this.boardFitted = false;
    this.preBoardFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.preBoard = { e, k: k || 0 };
    const its = this.boardItems(e), it = its[Math.min(its.length - 1, Math.max(0, k || 0))];
    const cx = it.x + it.w / 2, cy = it.y + it.h / 2, z = this.narrow ? 1.14 : 0.96;
    this.vt = { x: cx, y: cy, z: z };
    this.v = this.reduce ? { x: cx, y: cy, z: z } : { x: cx, y: cy, z: z * 0.46 };
    this.bv = { x: 0, y: 0, z: 0 }; this.anchor = null;
    this.fadeLoupe(0);
    this.setState({ board: e });
  }
  rect(): StageRect{
    const r = this.stageEl ? this.stageEl.getBoundingClientRect() : null;
    return r && r.width ? r : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  }
  step(k: number){
    const L = this.state.lifted; if (!L) return;
    const n = this.boardItems(L.e).length;
    this.setState({ lifted: { e: L.e, k: (L.k + k + n) % n } });
  }
  stepTable(k: number){
    if (this.state.board !== null || this.state.lifted) return;
    this.target = this.clampPos(Math.round(this.target) + k);
    this.touch(); this.dirtyNow = true;
  }

  componentDidMount(){
    this.alive = true;
    window.addEventListener("wheel", this.onWheel, { passive: false });
    window.addEventListener("pointerdown", this.onDown);
    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("pointercancel", this.onUp);
    window.addEventListener("keydown", this.onKey);
    document.addEventListener("visibilitychange", this.onVisibility);
    document.documentElement.addEventListener("mouseleave", this.onLeave);
    this.ro = new ResizeObserver(es => {
      const cr = es[es.length - 1].contentRect;
      if (!cr.width || !cr.height) return;
      const w = Math.round(cr.width), h = Math.round(cr.height);
      if (w !== this.state.w || h !== this.state.h) this.setState({ w: w, h: h });
    });
    if (this.stageEl) this.ro.observe(this.stageEl);
    if (!document.hidden) this.raf = requestAnimationFrame(this.loop);
  }
  componentDidUpdate(_prevProps: Readonly<LightTableProps>, prevState: Readonly<LightTableState>){
    if (this.boardFitted && this.state.board !== null && (prevState.w !== this.state.w || prevState.h !== this.state.h)) this.fitBoard();
    this.syncLift();
    if (prevState.lifted?.e !== this.state.lifted?.e || prevState.lifted?.k !== this.state.lifted?.k) this.fitPreview();
    if (!prevState.lifted && this.state.lifted) {
      this.preLiftFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      this.liftCloseEl?.focus();
    } else if (prevState.lifted && !this.state.lifted && this.preLiftFocus?.isConnected) {
      this.preLiftFocus.focus();
      this.preLiftFocus = null;
    }
    if (prevState.board !== null && this.state.board === null) {
      const photoButton = this.preBoard && this.stageEl?.querySelector<HTMLButtonElement>(`[data-shoot-index="${this.preBoard.e}"][data-photo-index="${this.preBoard.k}"]`);
      (photoButton || (this.preBoardFocus?.isConnected ? this.preBoardFocus : null))?.focus();
      this.preBoardFocus = null;
      this.preBoard = null;
    }
  }
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
    document.removeEventListener("visibilitychange", this.onVisibility);
    document.documentElement.removeEventListener("mouseleave", this.onLeave);
  }

  onVisibility = () => {
    if (document.hidden) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    } else if (this.alive && !this.raf) {
      this.tprev = undefined;
      this.raf = requestAnimationFrame(this.loop);
    }
  };

  onWheel = (ev: WheelEvent) => {
    if (this.state.lifted) {
      if (ev.target instanceof Node && this.liftStageEl?.contains(ev.target)) {
        ev.preventDefault();
        const rate = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 400 : 1;
        this.zoomPreviewAt(Math.exp(-ev.deltaY * rate * 0.0015), ev.clientX, ev.clientY);
      }
      return;
    }
    ev.preventDefault(); this.touch();
    if (this.state.board !== null) {
      this.boardFitted = false;
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
  onDown = (ev: PointerEvent) => {
    if (ev.target instanceof Element && ev.target.closest(".ns-rail__step")) return;
    if (this.state.lifted) {
      if (ev.target instanceof Node && this.liftStageEl?.contains(ev.target)) this.previewDown(ev);
      return;
    }
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
    else { this.drag = { x: ev.clientX, y: ev.clientY, px: ev.clientX, t: this.pos, mt: mt, rail: ev.target instanceof Element && !!ev.target.closest(".ns-rail") }; this.target = this.pos; this.vel = 0; this.fadeLoupe(0); }
  };
  onMove = (ev: PointerEvent) => {
    if (this.state.lifted) { this.previewMove(ev); return; }
    this.px = ev.clientX; this.py = ev.clientY; this.mouse = ev.pointerType === "mouse";
    if (this.ptrs.has(ev.pointerId)) this.ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (this.pinch && this.ptrs.size >= 2) {
      this.boardFitted = false;
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
        if (this.moved) this.boardFitted = false;
        const z = this.v.z;
        this.v = { z: z, x: this.drag.vx - dx / z, y: this.drag.vy - dy / z };
        this.vt = { z: this.vt.z, x: this.v.x, y: this.v.y };
        this.drag.mx = this.drag.mx * (1 - k) + (-inst / z / mdt) * k;
        this.drag.my = this.drag.my * (1 - k) + (-instY / z / mdt) * k;
        this.bv = { x: 0, y: 0, z: this.bv.z };
      } else {
        const unit = this.drag.rail ? (this.tickSpacing || 20) : 140;
        this.target = this.clampPos(this.drag.t - dx / unit);
        this.pos = this.target; this.vel = 0;
        this.fling = this.fling * (1 - k) + (-inst / unit / mdt * 1000) * k;
      }
      this.dirtyNow = true;
      this.touch();
    }
  };
  onUp = (ev: PointerEvent) => {
    if (this.state.lifted) { this.previewUp(ev); return; }
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
  onKey = (ev: KeyboardEvent) => {
    const L = this.state.lifted, B = this.state.board;
    if (ev.key === "Escape") { if (L) return this.setState({ lifted: null }); if (B !== null) return this.setState({ board: null }); }
    if (L) {
      if (ev.key === "Tab" && this.liftRootEl) {
        const focusable = [...this.liftRootEl.querySelectorAll<HTMLButtonElement>("button:not([disabled])")].filter(el => el.getClientRects().length);
        if (focusable.length) {
          const first = focusable[0], last = focusable[focusable.length - 1];
          if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
          else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
        }
      }
      if (ev.key === "ArrowRight") { ev.preventDefault(); return this.step(1); }
      if (ev.key === "ArrowLeft") { ev.preventDefault(); return this.step(-1); }
      if (ev.key === "+" || ev.key === "=") { ev.preventDefault(); this.zoomPreviewAt(1.25); }
      if (ev.key === "-") { ev.preventDefault(); this.zoomPreviewAt(0.8); }
      if (ev.key === "0" || ev.key.toLowerCase() === "f") { ev.preventDefault(); this.fitPreview(); }
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
    const spring = (x: number, v: number, t: number, w: number): [number, number] => { v += (w * w * (t - x) - 2 * w * v) * dt; return [x + v * dt, v]; };
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
    this.raf = document.hidden ? 0 : requestAnimationFrame(this.loop);
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
  click(roll: boolean){
    try {
      const AudioContextConstructor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextConstructor) return;
      const A = this.actx || (this.actx = new AudioContextConstructor());
      if (A.state === "suspended") A.resume();
      const len = Math.floor(A.sampleRate * (roll ? 0.012 : 0.005)), b = A.createBuffer(1, len, A.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
      const src = A.createBufferSource(), f = A.createBiquadFilter(), g = A.createGain();
      f.type = "bandpass"; f.frequency.value = roll ? 2400 : 3600; f.Q.value = 1.4; g.gain.value = roll ? 0.22 : 0.12;
      src.buffer = b; src.connect(f); f.connect(g); g.connect(A.destination); src.start();
    } catch (e) {}
  }
  zoomBy(f: number){
    this.boardFitted = false;
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
    this.boardFitted = true;
  }
  previewLimits(scale: number){
    const stage = this.liftStageEl, figure = this.liftFigureEl;
    if (!stage || !figure) return { x: 0, y: 0 };
    return {
      x: Math.max(0, (figure.offsetWidth * scale - stage.clientWidth) / 2),
      y: Math.max(0, (figure.offsetHeight * scale - stage.clientHeight) / 2)
    };
  }
  applyPreview(){
    const p = this.preview, limits = this.previewLimits(p.scale);
    p.x = Math.max(-limits.x, Math.min(limits.x, p.x));
    p.y = Math.max(-limits.y, Math.min(limits.y, p.y));
    if (this.liftFigureEl) this.liftFigureEl.style.transform = `translate3d(${p.x.toFixed(2)}px,${p.y.toFixed(2)}px,0) scale(${p.scale.toFixed(3)})`;
    if (this.previewPctEl) this.previewPctEl.textContent = `${Math.round(p.scale * 100)}%`;
    if (this.liftStageEl) this.liftStageEl.classList.toggle("is-zoomed", p.scale > 1.01);
  }
  fitPreview(){
    this.preview = { scale: 1, x: 0, y: 0 };
    this.previewPointers.clear(); this.previewGesture = null;
    this.applyPreview();
  }
  zoomPreviewAt(factor: number, clientX?: number, clientY?: number){
    if (!this.state.lifted || !this.liftStageEl) return;
    const p = this.preview, scale = previewClamp(p.scale * factor);
    if (scale === p.scale) return;
    const rect = this.liftStageEl.getBoundingClientRect();
    const ax = (clientX ?? rect.left + rect.width / 2) - rect.left - rect.width / 2;
    const ay = (clientY ?? rect.top + rect.height / 2) - rect.top - rect.height / 2;
    p.x = ax - (ax - p.x) * scale / p.scale;
    p.y = ay - (ay - p.y) * scale / p.scale;
    p.scale = scale;
    this.applyPreview();
  }
  previewDown(ev: PointerEvent){
    this.previewPointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (this.previewPointers.size === 2) {
      const [a, b] = [...this.previewPointers.values()];
      this.previewGesture = { mode: "pinch", distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), scale: this.preview.scale,
        centerX: (a.x + b.x) / 2, centerY: (a.y + b.y) / 2, x: this.preview.x, y: this.preview.y };
    } else if (this.previewPointers.size === 1) {
      this.previewGesture = { mode: "pan", startX: ev.clientX, startY: ev.clientY, x: this.preview.x, y: this.preview.y };
    }
  }
  previewMove(ev: PointerEvent){
    const stage = this.liftStageEl;
    if (!stage) return;
    if (!this.previewPointers.has(ev.pointerId)) return;
    this.previewPointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    const g = this.previewGesture;
    if (!g) return;
    if (g.mode === "pinch" && this.previewPointers.size >= 2) {
      const [a, b] = [...this.previewPointers.values()];
      const scale = previewClamp(g.scale * Math.hypot(a.x - b.x, a.y - b.y) / g.distance);
      const rect = stage.getBoundingClientRect();
      const ax = (a.x + b.x) / 2 - rect.left - rect.width / 2;
      const ay = (a.y + b.y) / 2 - rect.top - rect.height / 2;
      const gx = g.centerX - rect.left - rect.width / 2;
      const gy = g.centerY - rect.top - rect.height / 2;
      this.preview.scale = scale;
      this.preview.x = ax - (gx - g.x) * scale / g.scale;
      this.preview.y = ay - (gy - g.y) * scale / g.scale;
      this.applyPreview();
    } else if (g.mode === "pan" && this.previewPointers.size === 1 && this.preview.scale > 1) {
      this.preview.x = g.x + ev.clientX - g.startX;
      this.preview.y = g.y + ev.clientY - g.startY;
      this.applyPreview();
    }
  }
  previewUp(ev: PointerEvent){
    this.previewPointers.delete(ev.pointerId);
    if (this.previewPointers.size === 1) {
      const p = [...this.previewPointers.values()][0];
      this.previewGesture = { mode: "pan", startX: p.x, startY: p.y, x: this.preview.x, y: this.preview.y };
    } else if (!this.previewPointers.size) this.previewGesture = null;
  }
  fadeLoupe(o: number){
    const on = !!o, b = this.loupeEl?.firstElementChild as HTMLElement | null;
    if (this.loupeOn === on || !b) return;
    this.loupeOn = on; b.style.opacity = on ? "1" : "0"; b.style.transform = on ? "scale(1)" : "scale(.7)";
  }
  // The loupe follows the pointer over contact-sheet frames, magnifying the
  // mid-size image under it. Driven straight on the DOM to stay off React.
  updateLoupe(dt: number){
    const lp = this.loupeEl, st = this.stageEl, li = this.lensEl;
    if (!lp || !st || !li) return;
    if (this.state.lifted || this.state.board !== null || this.px == null || this.py == null || this.narrow || this.drag) return this.fadeLoupe(0);
    const hit = document.elementFromPoint(this.px, this.py);
    const img = hit && hit.closest ? hit.closest("img[data-frame]") : null;
    if (!(img instanceof HTMLImageElement) || !img.naturalWidth || !img.naturalHeight) return this.fadeLoupe(0);
    const s = st.getBoundingClientRect(), tx = this.px - s.left, ty = this.py - s.top;
    if (!this.loupeOn || this.lx == null || this.ly == null) { this.lx = tx; this.ly = ty; }
    else { const k = 1 - Math.exp(-(dt || 0.016) * 24); this.lx += (tx - this.lx) * k; this.ly += (ty - this.ly) * k; }
    const lx = this.lx, ly = this.ly;
    this.fadeLoupe(1);
    const z = this.props.loupeZoom, R = 86, r = img.getBoundingClientRect();
    // Reproduce object-fit: cover inside the lens. Stretching the source to
    // the frame's box changes the photograph's aspect ratio.
    const cover = Math.max(r.width / img.naturalWidth, r.height / img.naturalHeight);
    const drawnW = img.naturalWidth * cover, drawnH = img.naturalHeight * cover;
    const cropX = (r.width - drawnW) / 2, cropY = (r.height - drawnH) / 2;
    const cx = lx + s.left, cy = ly + s.top;
    lp.style.transform = "translate3d(" + lx.toFixed(2) + "px," + ly.toFixed(2) + "px,0)";
    const src = img.getAttribute("data-src");
    if (!src) return this.fadeLoupe(0);
    if (li._src !== src) { li._src = src; li.style.backgroundImage = "url(" + src + ")"; }
    li.style.backgroundSize = (drawnW * z).toFixed(1) + "px " + (drawnH * z).toFixed(1) + "px";
    li.style.backgroundPosition = (R - (cx - r.left - cropX) * z).toFixed(1) + "px " + (R - (cy - r.top - cropY) * z).toFixed(1) + "px";
  }

  // Swaps the full-screen preview image, cross-fading once the next one loads.
  syncLift(){
    const el = this.liftEl, L = this.state.lifted;
    if (!el || !L) return;
    const want = this.full(L.e, L.k);
    if (el.getAttribute("src") === want) return;
    if (el.getAttribute("src")) {
      el.style.transition = "none"; el.style.opacity = "0"; el.style.transform = "scale(.985)";
      el.onload = () => requestAnimationFrame(() => { el.style.transition = "opacity .42s cubic-bezier(.2,.8,.2,1),transform .6s cubic-bezier(.16,.84,.14,1)"; el.style.opacity = "1"; el.style.transform = "none"; });
    }
    el.src = want;
  }
  setStage = (el: HTMLDivElement | null) => {
    this.stageEl = el;
    if (el && this.ro) this.ro.observe(el);
  };
  setLoupe = (el: HTMLDivElement | null) => { this.loupeEl = el; };
  setLens = (el: LensElement | null) => { this.lensEl = el; };
  setHead = (el: HTMLDivElement | null) => { this.headEl = el; };
  setLiftImg = (el: HTMLImageElement | null) => {
    if (this.fitRo) { this.fitRo.disconnect(); this.fitRo = null; }
    this.liftEl = el;
    if (!el) return;
    el.addEventListener("load", () => this.applyPreview());
    this.syncLift();
    const row = el.parentElement && el.parentElement.parentElement;
    if (!row) return;
    const fit = () => {
      el.style.maxHeight = Math.max(90, row.clientHeight - 2) + "px";
      el.style.maxWidth = Math.max(90, row.clientWidth - 2) + "px";
      this.applyPreview();
    };
    fit();
    this.fitRo = new ResizeObserver(fit);
    this.fitRo.observe(row);
    this.fitRo.observe(el);
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
    const TICK = Math.max(narrow ? 12 : 22, Math.min(narrow ? 20 : 62, (W - (narrow ? 80 : 300)) / Math.max(1, N - 1)));
    this.tickSpacing = TICK;
    // Keep a fine, even engraved scale as the viewport changes. Each photo
    // interval contains a whole number of minor divisions, so the ruler and
    // the photograph markers always stay aligned while it moves.
    const microStep = TICK / Math.max(3, Math.round(TICK / 7.5));

    const styleName = String(this.props.tableStyle);
    const style = styleName === "Plate" ? "plate" : styleName === "Mosaic" ? "mosaic" : "sheet";
    const mobileFeature = style === "sheet" && narrow && H >= 600 && cur.count === 3;
    const tabletFeature = style === "sheet" && !narrow && W < 900 && H >= 760 && cur.count === 3;
    const portraitTablet = style === "sheet" && !narrow && W < 900 && H > W && cur.count >= 6;
    const featureSheet = style === "sheet" && !narrow && H >= 700 && cur.count === 3 && !tabletFeature;
    const tallTable = !narrow && W < 1200 && H > W * .85;
    const cols = style === "sheet" ? (cur.count <= 2 ? cur.count : narrow || tabletFeature || portraitTablet ? 2 : cur.count <= 6 ? 3 : W < 900 || tallTable ? 3 : 4) : 6;
    const maxRows = style === "sheet" ? (H < 520 ? 1 : mobileFeature || portraitTablet ? 3 : tabletFeature || featureSheet ? 2 : narrow ? H >= 760 ? 4 : 3 : 5) : 4;
    const gap = style === "sheet" ? 5 : 7, pad = narrow ? 12 : 15;
    const topPad = narrow ? 86 : 108, botPad = narrow ? 104 : 132;
    const band = Math.max(200, H - topPad - botPad);
    const chrome = (narrow ? 30 : 34) + 24 + pad * 2 + 16 + gap;
    const frameAspect = narrow && style === "sheet" ? 1.24 : 1.45;
    const rowsToShow = mobileFeature ? 3 : featureSheet || tabletFeature ? 2 : Math.min(maxRows, Math.max(1, Math.ceil(cur.count / cols)));
    const heightBudget = H < 520 && !narrow ? Math.max(165, H - 190) : band - 28;
    const sheetHeightCap = style === "sheet" && (H >= 520 || !narrow)
      ? ((heightBudget - chrome - (rowsToShow - 1) * gap) * frameAspect * cols / rowsToShow) + pad * 2 + gap * (cols - 1)
      : Infinity;
    const sheetTarget = narrow ? W - 24 : H < 520 ? W * .62 : style === "sheet" ? W - 44 : W * .78;
    const sheetW = Math.round(Math.min(sheetTarget, sheetHeightCap, style === "sheet" ? 1500 : 940));
    const CU = (sheetW - pad * 2 - gap * (cols - 1)) / cols;
    const RU = style === "sheet" ? CU / frameAspect : (2 * CU + gap) / 1.5;
    const ROWS = Math.max(H < 520 ? 1 : 2, Math.min(maxRows, Math.floor((band - chrome + gap) / (RU + gap))));
    const CELL = sheetW + (narrow ? 34 : 56);
    const plan: Span[] = mobileFeature
      ? [[1, 1, 2, 2], [3, 1, 1, 1], [3, 2, 1, 1]]
      : featureSheet
      ? [[1, 1, 2, 2], [1, 3, 1, 1], [2, 3, 1, 1]]
      : style === "sheet" && (narrow || tabletFeature) && H >= 520 && cur.count === 3
      ? [[1, 1, 1, 1], [1, 2, 1, 1], [2, 1, 1, 2]]
      : spans(style, ROWS, cols);

    // Contact sheets within reach of the current roll, fanned out either side.
    const sheets: { i: number; r: Roll; start: number; t: string; dim: string }[] = [];
    if (B === null) this.rolls.forEach((r, i) => {
      const d = i - ef, a = Math.abs(d);
      if (a > 1.6) return;
      sheets.push({ i: i, r: r, start: i === cit.e ? Math.min(Math.floor(cit.k / plan.length) * plan.length, Math.max(0, r.count - plan.length)) : 0,
        t: "translate(-50%,-50%) translateX(" + (d * CELL + (i === cit.e ? -within * 14 : 0)).toFixed(2) + "px) translateY(" + ((i % 2 ? 1 : -1) * 7) + "px) rotate(" + (d * 0.45).toFixed(2) + "deg) scale(" + (1 - Math.min(a, 2) * 0.035).toFixed(4) + ")",
        dim: (Math.min(a, 1.8) * 0.32).toFixed(3) });
    });

    // Glass graduations travel behind a stationary viewing index.
    const tickX = (d: number) => TICK * d;
    const ticks: { i: number; x: string; kind: "boundary" | "major" | "minor"; active: boolean }[] = [];
    this.items.forEach((it, i) => ticks.push({ i, x: tickX(i - pos).toFixed(2), kind: it.first ? "boundary" : it.k % 5 === 0 ? "major" : "minor", active: i === ci }));
    const firstInRoll = this.items.findIndex(it => it.e === cit.e);
    let lastInRoll = this.items.length - 1;
    while (lastInRoll > 0 && this.items[lastInRoll].e !== cit.e) lastInRoll--;
    const span = { x0: tickX(firstInRoll - pos), x1: tickX(lastInRoll - pos) };

    // Prints pinned to the board, culled to what's near the viewport.
    const pinned: { it: BoardItem; label: string }[] = [];
    let bName = "", bMeta = "";
    if (B !== null) {
      const br = this.rolls[B], its = this.boardItems(B);
      const hw = W / (2 * z) + 300, hh = H / (2 * z) + 300;
      const x0 = this.v.x - hw, x1 = this.v.x + hw, y0 = this.v.y - hh, y1 = this.v.y + hh;
      its.forEach(it => {
        if (it.x > x1 || it.x + it.w < x0 || it.y > y1 || it.y + it.h < y0) return;
        pinned.push({ it: it, label: "Open " + br.photos[it.i].alt });
      });
      bName = br.name;
      bMeta = br.date;
    }

    const ox = W / 2 - this.v.x * z, oy = H / 2 - this.v.y * z;
    const L = this.state.lifted, lr = L ? this.rolls[L.e] : null;
    const strip = [];
    if (L) {
      const n = this.boardItems(L.e).length, span = Math.min(n, narrow ? 3 : 9), first = -Math.floor(span / 2);
      for (let j = 0; j < span; j++) {
        const d = first + j;
        strip.push({ d, k: (L.k + d + n * 2) % n });
      }
    }
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
          {sheets.map(({ i, r, t, dim, start }) => (
            <div key={i} className="ns-sheet" style={{ width: sheetW + "px", transform: t }}>
              <div className="ns-sheet__shadow" />
              <div className="ns-sheet__body" style={{ padding: (pad + 16) + "px " + pad + "px " + pad + "px" }}>
                <div className="ns-sheet__sheen" />
                <div className="ns-sheet__head" style={{ marginBottom: gap + "px" }}>
                  <h2 className="ns-sheet__title">{r.name}</h2>
                  <span className="ns-sheet__date">{r.date}</span>
                </div>
                <div className="ns-sheet__grid" style={{ gap: gap + "px", gridTemplateColumns: "repeat(" + cols + ",1fr)", gridAutoRows: RU.toFixed(2) + "px" }}>
                  {plan.slice(0, Math.max(0, r.photos.length - start)).map((sp, slot) => {
                    const k = start + slot;
                    return (
                      <div key={k} className={`ns-frame${i === cit.e && k === cit.k ? " is-current" : ""}`} style={{ gridArea: sp[0] + " / " + sp[1] + " / span " + sp[2] + " / span " + sp[3] }}>
                        <button type="button" className="ns-frame__btn" data-shoot-index={i} data-photo-index={k} tabIndex={i === cit.e ? 0 : -1} aria-current={i === cit.e && k === cit.k ? "true" : undefined} aria-label={"Open " + r.photos[k].alt} onClick={() => { if (!this.moved) this.openBoard(i, k); }}>
                          <img className="ns-frame__img" src={this.thumb(i, k)} alt={r.photos[k].alt} draggable={false} loading={i === cit.e && slot === 0 ? "eager" : "lazy"} data-frame="1" data-src={this.mid(i, k)} />
                        </button>
                        <div className="ns-frame__edge" />
                      </div>
                    );
                  })}
                </div>
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
                    <img className="ns-print__img" src={this.mid(B, it.i)} alt={this.rolls[B].photos[it.i].alt} draggable={false} loading="lazy" data-frame="1" data-src={this.mid(B, it.i)} />
                    <div className="ns-print__edge" />
                    <div className="ns-print__sheen" />
                  </button>
                  {it.att === 1 && <Tape variant={it.tapeV} width={Math.round(Math.min(120, it.w * 0.4))} />}
                  {it.att === 3 && <CornerTape variant={1 + (it.tapeV % 2)} side="top-left" width={Math.round(Math.min(78, Math.max(54, it.w * .26)))} />}
                  {it.att === 3 && <CornerTape variant={1 + ((it.tapeV + 1) % 2)} side="bottom-right" width={Math.round(Math.min(78, Math.max(54, it.w * .26)))} />}
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
            <div className="ns-loupe__glass">
              <div className="ns-loupe__img" ref={this.setLens} />
              <div className="ns-loupe__falloff" />
              <div className="ns-loupe__tint" />
              <div className="ns-loupe__flare" />
              <div className="ns-loupe__flare ns-loupe__flare--low" />
            </div>
            <img className="ns-loupe__render" src={loupeArt} alt="" draggable={false} />
            <div className="ns-loupe__label">{this.props.loupeZoom.toFixed(1) + "×"}</div>
          </div>
        </div>

        <header className={`ns-bar${B !== null ? " ns-bar--board" : ""}`}>
          <div className="ns-bar__sheen" />
          <div className="ns-bar__gloss" />
          <div className="ns-bar__id">
            <div className="ns-bar__text">
              <span className="ns-bar__title">{B === null ? "Nolle Studios" : bName}</span>
              <span className="ns-bar__meta" aria-live="polite">{B === null ? "Photographic archive" : "Nolle Studios · " + bMeta}</span>
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

        {B === null && <div className="ns-rail" role="group" aria-label="Photograph navigation">
          <button type="button" className="ns-rail__step ns-rail__step--previous" aria-label="Previous photograph" disabled={B !== null || ci === 0} onClick={() => this.stepTable(-1)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 5.5-6.5 6.5 6.5 6.5" /></svg>
          </button>
          <div className="ns-rail__slider" role="slider" tabIndex={B === null ? 0 : -1} aria-label="Browse photographs" aria-valuemin={1} aria-valuemax={N} aria-valuenow={ci + 1} aria-valuetext={`${cur.name}, photograph ${ci + 1} of ${N}`} ref={el => { this.railEl = el; }} onClick={ev => {
            if (B !== null || this.moved || !this.railEl) return;
            const rect = this.railEl.getBoundingClientRect();
            this.target = this.clampPos(Math.round(this.pos + (ev.clientX - rect.left - rect.width / 2) / TICK));
            this.touch(); this.dirtyNow = true;
          }}>
            <div className="ns-rail__track" aria-hidden="true">
              <div className="ns-rail__base" />
              <div className="ns-rail__ticks" style={{ "--minor-step": microStep.toFixed(2) + "px", "--minor-offset": (-pos * TICK).toFixed(2) + "px" } as CSSProperties}>
                <div className="ns-rail__reel">
                  {ticks.map(t => (
                    <div key={t.i} className="ns-tick" style={{ transform: "translateX(" + t.x + "px)" }}>
                      <div className={`ns-tick__bar ns-tick__bar--${t.kind}${t.active ? " is-active" : ""}`} />
                    </div>
                  ))}
                </div>
              </div>
              <div className="ns-rail__span" style={{ left: "calc(50% + " + (span.x0 - TICK / 2).toFixed(2) + "px)", width: Math.max(0, span.x1 - span.x0 + TICK).toFixed(2) + "px" }} />
            </div>
            <div className="ns-playhead" ref={this.setHead} aria-hidden="true">
              <div className="ns-playhead__line" />
            </div>
            <span className="ns-rail__readout" aria-hidden="true"><strong>{cur.name}</strong><span>{cur.date}</span></span>
          </div>
          <button type="button" className="ns-rail__step ns-rail__step--next" aria-label="Next photograph" disabled={B !== null || ci === N - 1} onClick={() => this.stepTable(1)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 5.5 6.5 6.5-6.5 6.5" /></svg>
          </button>
        </div>}

        <p className="ns-hint">{B === null ? (narrow ? "Swipe photos · drag timeline to browse" : "Drag timeline or ← → to browse · hover loupe") : (narrow ? "Drag to pan · pinch to zoom" : "Drag to pan · scroll or pinch to zoom · esc to exit")}</p>

        {L && lr && (
          <div className="ns-lift" role="dialog" aria-modal="true" aria-label="Photograph preview" ref={el => { this.liftRootEl = el; }}>
            <div className="ns-lift__ambient" style={{ backgroundImage: "url(" + this.mid(L.e, L.k) + ")" }} />
            <div className="ns-lift__shade" />
            <div className="ns-lift__stage" ref={el => { this.liftStageEl = el; }} onDoubleClick={ev => this.preview.scale > 1.01 ? this.fitPreview() : this.zoomPreviewAt(2, ev.clientX, ev.clientY)} style={{ inset: (bt + lbh + 14) + "px " + (narrow ? 10 : 80) + "px " + (showStrip ? bt + 58 + 14 : bt + 14) + "px" }}>
              <figure className="ns-lift__figure" ref={el => { this.liftFigureEl = el; }} style={{ backgroundImage: `url(${this.mid(L.e, L.k)})`, backgroundSize: "cover", backgroundPosition: "center" }}>
                <img className="ns-lift__img" ref={this.setLiftImg} alt={lr.photos[L.k].alt} draggable={false} decoding="async" />
              </figure>
            </div>
            <button type="button" className="ns-glass ns-nav ns-nav--prev" aria-label="Previous photograph" onClick={() => this.step(-1)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 5.5-6.5 6.5 6.5 6.5" /></svg>
            </button>
            <button type="button" className="ns-glass ns-nav ns-nav--next" aria-label="Next photograph" onClick={() => this.step(1)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 5.5 6.5 6.5-6.5 6.5" /></svg>
            </button>
            <div className="ns-glass ns-preview-zoom" role="group" aria-label="Photo preview zoom">
              <button type="button" aria-label="Zoom photo out" onClick={() => this.zoomPreviewAt(0.8)}>−</button>
              <output ref={el => { this.previewPctEl = el; }} aria-label="Photo zoom level">100%</output>
              <button type="button" aria-label="Zoom photo in" onClick={() => this.zoomPreviewAt(1.25)}>+</button>
              <button type="button" className="ns-preview-zoom__fit" aria-label="Fit whole photo" onClick={() => this.fitPreview()}>Fit</button>
            </div>
            <div className="ns-glass ns-liftbar">
              <div className="ns-glass__sheen" />
              <div className="ns-liftbar__id">
                <div className="ns-liftbar__text">
                  <span className="ns-liftbar__title">{lr.name}</span>
                </div>
              </div>
              <div className="ns-liftbar__actions">
                <button type="button" className="ns-liftbar__btn ns-liftbar__close" aria-label="Close preview" ref={el => { this.liftCloseEl = el; }} onClick={() => this.setState({ lifted: null })}>
                  <span className="ns-wide">Close</span><span className="ns-liftbar__x">×</span>
                </button>
              </div>
            </div>
            {showStrip && (
              <div className="ns-glass ns-strip">
                <div className="ns-glass__sheen" />
                <div className="ns-strip__reel">
                  {strip.map(({ d, k }) => {
                    const on = d === 0;
                    return (
                      <button key={d} type="button" className="ns-strip__thumb" aria-label={"Show " + lr.photos[k].alt} aria-current={on ? "true" : "false"}
                        style={{ width: (on ? 54 : 46) + "px", opacity: on ? 1 : 0.48, borderColor: on ? "#F2F5F9" : "rgba(255,255,255,.16)" }}
                        onClick={() => this.setState({ lifted: { e: L.e, k: k } })}>
                        <img src={this.thumb(L.e, k)} alt="" draggable={false} loading="lazy" />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }
}
