import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount } from "solid-js";
import type { ArchiveShoot } from "../archive";
import { boardPrints, boardView, clampCamera, clampZoom, fittedCamera, printBounds, runtime } from "./layout";
import type { Camera, Print } from "./layout";
import { aspect } from "./media";
import { pinArt, tapeArt } from "./art";
import Picture from "./Picture";

export interface BoardApi {
  zoomBy(factor: number): void;
  fit(): void;
  pan(dx: number, dy: number): void;
}

interface BoardProps {
  shoot: ArchiveShoot;
  seed: number;
  focus: number;
  narrow: boolean;
  width: number;
  height: number;
  reduce: boolean;
  onOpen(index: number): void;
  /** The camera's zoom, and whether it is as far out as it goes. */
  onZoom(zoom: number, atFit: boolean): void;
  api(api: BoardApi): void;
}

type Piece = { src: string; x: string; y: string; w: number; rot: number; pin?: boolean };
type Corner = "tl" | "tr" | "br" | "bl";
const TAPE_CORNERS: Record<string, Corner[]> = { corners: ["tl", "tr", "br", "bl"], "top-corners": ["tl", "tr"], diagonal: ["tl", "br"] };
const PIN_SPOTS: Record<number, Corner[]> = { 2: ["tl", "tr"], 4: ["tl", "tr", "br", "bl"] };
const PIN_SIZE = 56, PIN_INSET = "16px";

/** Where each piece of tape or each pin sits on a print, as sprites. */
function holdPieces(print: Print): Piece[] {
  const hold = print.hold;
  if (hold.kind === "pins") {
    const lean = (n: number) => 1 + ((print.i + n) % 2);
    const at = (corner: Corner, n: number): Piece => ({
      src: pinArt(hold.colour, lean(n)), w: PIN_SIZE, rot: 0, pin: true,
      x: corner[1] === "l" ? PIN_INSET : `calc(100% - ${PIN_INSET})`, y: corner[0] === "t" ? PIN_INSET : `calc(100% - ${PIN_INSET})`,
    });
    return hold.count === 1
      ? [{ src: pinArt(hold.colour, lean(0)), w: PIN_SIZE, rot: 0, pin: true, x: "50%", y: PIN_INSET }]
      : PIN_SPOTS[hold.count].map(at);
  }
  const short = Math.min(print.w, print.h);
  if (hold.layout === "top-strip") {
    const w = Math.round(Math.min(200, Math.max(110, print.w * 0.42)));
    return [{ src: tapeArt("strip", hold.variant), x: "50%", y: "0px", w, rot: (print.rot * 4 + (hold.variant === 1 ? -2.5 : 2)) }];
  }
  const w = Math.round(Math.min(92, Math.max(54, short * 0.3)));
  const angle: Record<Corner, number> = { tl: -44, tr: 47, br: -46, bl: 43 };
  return TAPE_CORNERS[hold.layout].map((corner, n) => ({
    src: tapeArt("corner", 1 + ((hold.variant + n) % 2)), w, rot: angle[corner],
    x: corner[1] === "l" ? "5%" : "95%", y: corner[0] === "t" ? "6%" : "94%",
  }));
}
type Point = { x: number; y: number };

export default function Board(props: BoardProps) {
  let stage!: HTMLDivElement, world!: HTMLDivElement;
  const view = createMemo(() => boardView(props.narrow, props.width, props.height));
  const prints = createMemo(() => boardPrints(props.shoot.photos.map(aspect), props.seed, props.narrow, view()));
  const bounds = createMemo(() => printBounds(prints()));
  // The furthest the board zooms out is the view that fits every print.
  const floor = createMemo(() => fittedCamera(prints(), view()).z);
  // Zoom used to pick image sizes; updated when the camera comes to rest.
  const [restZoom, setRestZoom] = createSignal(1);

  // Camera physics: v eases toward the target vt with velocity bv.
  const fit = fittedCamera(prints(), view());
  let v: Camera = props.reduce ? { ...fit } : { ...fit, z: fit.z * 0.86 };
  let vt: Camera = { ...fit };
  let bv: Camera = { x: 0, y: 0, z: 0 };
  let fitted = true;
  let anchor: { sx: number; sy: number; wx: number; wy: number } | null = null;
  let drag: { x: number; y: number; vx: number; vy: number; px: number; py: number; t: number; mx: number; my: number } | null = null;
  let pinch: { d: number; z: number; mx: number; my: number; vx: number; vy: number } | null = null;
  const pointers = new Map<number, Point>();
  let moved = false, raf = 0, last = 0, shownZoom = -1;

  function apply() {
    const ox = props.width / 2 - v.x * v.z, oy = props.height / 2 - v.y * v.z;
    world.style.transform = `translate3d(${ox.toFixed(2)}px,${oy.toFixed(2)}px,0) scale(${v.z.toFixed(4)})`;
    const pct = Math.round(v.z * 100);
    if (pct !== shownZoom) { shownZoom = pct; props.onZoom(v.z, v.z <= floor() * 1.005); }
  }

  const spring = (x: number, velocity: number, target: number, w: number, dt: number): [number, number] => {
    const next = velocity + (w * w * (target - x) - 2 * w * velocity) * dt;
    return [x + next * dt, next];
  };

  function frame(time: number) {
    raf = 0;
    const dt = Math.min(0.034, Math.max(0.001, (time - (last || time - 16)) / 1000));
    last = time;
    if (!drag && !pinch) vt = clampCamera(vt, bounds(), view());
    if (props.reduce) { v = { ...vt }; bv = { x: 0, y: 0, z: 0 }; }
    else {
      const [z, bz] = spring(v.z, bv.z, vt.z, 14, dt);
      let x = v.x, y = v.y, bx = bv.x, by = bv.y;
      if (anchor) {
        x = anchor.wx - anchor.sx / z; y = anchor.wy - anchor.sy / z; bx = 0; by = 0;
        if (Math.abs(vt.z - z) < 0.0003 && Math.abs(bz) < 0.002) anchor = null;
      } else if (!drag) {
        [x, bx] = spring(v.x, bv.x, vt.x, 7.5, dt);
        [y, by] = spring(v.y, bv.y, vt.y, 7.5, dt);
      }
      v = { x, y, z }; bv = { x: bx, y: by, z: bz };
    }
    const settled = !drag && !pinch && !anchor && Math.abs(vt.x - v.x) < 0.2 && Math.abs(vt.y - v.y) < 0.2 &&
      Math.abs(vt.z - v.z) < 0.0003 && Math.abs(bv.x) < 0.8 && Math.abs(bv.y) < 0.8 && Math.abs(bv.z) < 0.002;
    if (settled) { v = { ...vt }; bv = { x: 0, y: 0, z: 0 }; }
    apply();
    if (settled) { last = 0; setRestZoom(v.z); }
    else raf = requestAnimationFrame(frame);
  }
  /** Run the loop until the camera settles; nothing runs while it rests. */
  const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };

  function zoomAround(factor: number, clientX?: number, clientY?: number) {
    fitted = false;
    const rect = stage.getBoundingClientRect();
    const sx = (clientX ?? rect.left + rect.width / 2) - rect.left - rect.width / 2;
    const sy = (clientY ?? rect.top + rect.height / 2) - rect.top - rect.height / 2;
    const z = clampZoom(vt.z * factor, floor());
    const wx = v.x + sx / v.z, wy = v.y + sy / v.z;
    const target = { z, x: wx - sx / z, y: wy - sy / z };
    vt = clampCamera(target, bounds(), view());
    // Zoom around the pointer unless that would carry the prints off screen.
    const kept = Math.abs(vt.x - target.x) < 1e-6 && Math.abs(vt.y - target.y) < 1e-6;
    anchor = clientX !== undefined && kept ? { sx, sy, wx, wy } : null;
    kick();
  }

  props.api({
    zoomBy: factor => zoomAround(factor),
    fit: () => { anchor = null; fitted = true; vt = fittedCamera(prints(), view()); kick(); },
    pan: (dx, dy) => { anchor = null; fitted = false; vt = clampCamera({ ...vt, x: vt.x + dx, y: vt.y + dy }, bounds(), view()); kick(); },
  });

  // Keep the board fitted as the window changes size, until the visitor moves it.
  createEffect(on(prints, () => {
    vt = fitted ? fittedCamera(prints(), view()) : clampCamera({ ...vt, z: clampZoom(vt.z, floor()) }, bounds(), view());
    shownZoom = -1;
    kick();
  }, { defer: true }));

  function onDown(event: PointerEvent) {
    if (event.button > 0) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    moved = false; anchor = null;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()], rect = stage.getBoundingClientRect();
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z: vt.z, mx: (a.x + b.x) / 2 - rect.left, my: (a.y + b.y) / 2 - rect.top, vx: vt.x, vy: vt.y };
      drag = null; moved = true;
      return;
    }
    vt = { ...vt, x: v.x, y: v.y };
    drag = { x: event.clientX, y: event.clientY, vx: v.x, vy: v.y, px: event.clientX, py: event.clientY, t: performance.now(), mx: 0, my: 0 };
  }

  function onMove(event: PointerEvent) {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch && pointers.size >= 2) {
      fitted = false;
      const [a, b] = [...pointers.values()], rect = stage.getBoundingClientRect(), p = pinch;
      const z = clampZoom(p.z * Math.hypot(a.x - b.x, a.y - b.y) / p.d, floor());
      const wx = p.vx + (p.mx - rect.width / 2) / p.z, wy = p.vy + (p.my - rect.height / 2) / p.z;
      const mx = (a.x + b.x) / 2 - rect.left, my = (a.y + b.y) / 2 - rect.top;
      vt = clampCamera({ z, x: wx - (mx - rect.width / 2) / z, y: wy - (my - rect.height / 2) / z }, bounds(), view(), true);
      v = { ...vt }; bv = { x: 0, y: 0, z: 0 };
      apply();
      return;
    }
    if (!drag) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!moved && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
      moved = true; fitted = false;
      // Capture only once dragging starts, so a plain tap still clicks the print.
      try { stage.setPointerCapture(event.pointerId); } catch { /* Pointer already gone. */ }
    }
    const time = performance.now(), dt = Math.max(1, time - drag.t), k = Math.min(1, dt / 40);
    // Smoothed pointer velocity, in world units per millisecond, for the fling.
    drag.mx = drag.mx * (1 - k) + (-(event.clientX - drag.px) / v.z / dt) * k;
    drag.my = drag.my * (1 - k) + (-(event.clientY - drag.py) / v.z / dt) * k;
    drag.px = event.clientX; drag.py = event.clientY; drag.t = time;
    // Past the edge the board follows the pointer with resistance, then springs back.
    v = clampCamera({ z: v.z, x: drag.vx - dx / v.z, y: drag.vy - dy / v.z }, bounds(), view(), true);
    vt = { z: vt.z, x: v.x, y: v.y };
    bv = { x: 0, y: 0, z: bv.z };
    apply();
  }

  function onUp(event: PointerEvent) {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = null;
    const d = drag;
    drag = null;
    if (d && performance.now() - d.t < 90) {
      // A quick release flings the board and lets it glide to rest.
      bv = { x: d.mx * 1000, y: d.my * 1000, z: bv.z };
      vt = { z: vt.z, x: v.x + bv.x * 0.32, y: v.y + bv.y * 0.32 };
    }
    vt = clampCamera(vt, bounds(), view());
    kick();
  }

  function onWheel(event: WheelEvent) {
    event.preventDefault();
    const scale = event.deltaMode === 1 ? 16 : 1;
    // Trackpad pinches arrive as ctrl+wheel with small deltas.
    zoomAround(Math.exp(-event.deltaY * scale * (event.ctrlKey ? 0.01 : 0.0019)), event.clientX, event.clientY);
  }

  onMount(() => {
    stage.addEventListener("wheel", onWheel, { passive: false });
    apply();
    kick();
    stage.querySelector<HTMLButtonElement>(`[data-print="${props.focus}"]`)?.focus({ preventScroll: true });
  });
  onCleanup(() => {
    cancelAnimationFrame(raf);
    stage.removeEventListener("wheel", onWheel);
  });

  const PrintView = (p: { print: Print }) => {
    const photo = () => props.shoot.photos[p.print.i];
    return <div class="ns-print" style={{ left: `${p.print.x}px`, top: `${p.print.y}px`, width: `${p.print.w}px`, height: `${p.print.h}px`, transform: `rotate(${p.print.rot.toFixed(2)}deg)` }}>
      <div class="ns-print__shadow" />
      <button type="button" class="ns-print__btn" data-print={p.print.i} aria-label={`Open ${photo().alt}`} onClick={() => { if (!moved) props.onOpen(p.print.i); }}>
        <Picture photo={photo()} class="ns-print__img" alt={photo().alt} eager sizes={`${Math.ceil(p.print.w * restZoom())}px`} />
        <Show when={photo().kind === "video"}>
          <span class="ns-video-badge" aria-hidden="true"><svg viewBox="0 0 10 10" width="8" height="8"><path d="M2 1l7 4-7 4z" fill="currentColor" /></svg>{runtime(photo().duration)}</span>
        </Show>
        <div class="ns-print__edge" />
        <div class="ns-print__sheen" />
      </button>
      <For each={holdPieces(p.print)}>{piece =>
        <img class={piece.pin ? "ns-pin" : "ns-tape"} src={piece.src} alt="" draggable={false} aria-hidden="true"
          style={{ left: piece.x, top: piece.y, width: `${piece.w}px`, transform: `translate(-50%,-50%) rotate(${piece.rot}deg)` }} />}</For>
    </div>;
  };

  return <div class="ns-board" ref={stage} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
    <div class="ns-board__base" />
    <div class="ns-board__world" ref={world}>
      <div class="ns-board__cork" />
      <div class="ns-board__cork ns-board__cork--soft" />
      <div class="ns-board__tone" />
      <For each={prints()}>{print => <PrintView print={print} />}</For>
    </div>
    <div class="ns-board__vignette" />
  </div>;
}
