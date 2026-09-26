// Pure geometry for the light table: contact-sheet grids, where the sheets
// sit on the table, and how prints hang on a shoot's board. No DOM here, so
// the rules can be unit-tested (layout.test.ts).

/** [row, column, rowSpan, columnSpan], 1-based grid lines. */
export type Span = [number, number, number, number];

export interface SheetLayout {
  /** Sheet width in CSS pixels. */
  w: number;
  pad: number;
  gap: number;
  /** Grid tracks: 12 for balanced rows, or the column count for feature layouts. */
  tracks: number;
  rowH: number;
  plan: Span[];
  /** Frames shown; the last one carries a "+N" when more wait on the board. */
  visible: number;
  more: number;
}

export interface TableFrame { topPad: number; band: number; centerY: number }

export const tableFrame = (narrow: boolean, H: number): TableFrame => {
  const topPad = narrow ? 86 : 108, botPad = narrow ? 100 : 128;
  const band = Math.max(160, H - topPad - botPad);
  return { topPad, band, centerY: Math.round(topPad + band / 2) };
};

/** Frames per row, filling the last row instead of leaving an empty cell. */
export function balancedRows(count: number, cols: number): number[] {
  const rows: number[] = [];
  for (let left = count; left > 0;) {
    const inRow = left === cols + 1 && cols > 1 ? Math.ceil(left / 2) : Math.min(cols, left);
    rows.push(inRow);
    left -= inRow;
  }
  return rows;
}

export function sheetLayout(count: number, narrow: boolean, W: number, H: number): SheetLayout {
  const gap = 5, pad = narrow ? 12 : 15, aspect = narrow ? 1.24 : 1.45;
  const { band } = tableFrame(narrow, H);
  let cols: number, maxW: number, plan: Span[], tracks: number;
  let visible = count;

  if (count === 3 && (narrow ? H >= 600 : H >= 620)) {
    // Three frames make a feature: one large print and two small ones.
    cols = narrow ? 2 : 3;
    tracks = cols;
    maxW = narrow ? W - 24 : Math.min(W - 44, 960);
    plan = narrow ? [[1, 1, 2, 2], [3, 1, 1, 1], [3, 2, 1, 1]] : [[1, 1, 2, 2], [1, 3, 1, 1], [2, 3, 1, 1]];
  } else {
    cols = narrow ? Math.min(2, count) : count <= 2 ? count : count <= 6 ? 3 : 4;
    maxW = narrow ? W - 24 : Math.min(W - 44, count === 1 ? 860 : count <= 6 ? 1000 : 1160);
    const maxRows = H < 560 ? 1 : narrow ? (H >= 760 ? 4 : 3) : H >= 860 ? 3 : 2;
    visible = Math.min(count, cols * maxRows);
    tracks = 12;
    plan = [];
    balancedRows(visible, cols).forEach((inRow, r) => {
      const span = 12 / inRow;
      for (let c = 0; c < inRow; c++) plan.push([r + 1, 1 + c * span, 1, span]);
    });
  }

  const rows = Math.max(...plan.map(([row, , rowSpan]) => row + rowSpan - 1));
  const chrome = (narrow ? 30 : 34) + 16 + pad * 2 + 16;
  let CU = (maxW - pad * 2 - gap * (cols - 1)) / cols;
  let RU = CU / aspect;
  const allowed = (band - 20 - chrome - (rows - 1) * gap) / rows;
  if (RU > allowed) { RU = Math.max(40, allowed); CU = RU * aspect; }
  return {
    w: Math.round(CU * cols + gap * (cols - 1) + pad * 2), pad, gap, tracks,
    rowH: Math.round(RU * 10) / 10, plan, visible, more: count - visible,
  };
}

/**
 * Horizontal centre of each sheet relative to the current one. Sheets sit
 * edge to edge with a fixed gutter, whatever their individual widths.
 */
export function sheetOffsets(widths: number[], current: number, gutter: number): number[] {
  const out = widths.map(() => 0);
  for (let i = current + 1; i < widths.length; i++) out[i] = out[i - 1] + widths[i - 1] / 2 + gutter + widths[i] / 2;
  for (let i = current - 1; i >= 0; i--) out[i] = out[i + 1] - widths[i + 1] / 2 - gutter - widths[i] / 2;
  return out;
}

// ---- The shoot board ------------------------------------------------------

// How each print hangs. Prints alternate between clear tape and push pins;
// within each, the placement and the number of pieces step through every
// arrangement, so neighbouring prints never hang the same way.
const TAPE_LAYOUTS = ["corners", "top-corners", "diagonal", "top-strip"] as const;
const PIN_COLOURS = ["red", "blue", "green", "yellow", "white"] as const;
const PIN_COUNTS = [2, 1, 4] as const;
export type TapeLayout = typeof TAPE_LAYOUTS[number];
export type PinColour = typeof PIN_COLOURS[number];
export type Hold =
  | { kind: "tape"; layout: TapeLayout; variant: 1 | 2 }
  | { kind: "pins"; colour: PinColour; count: 1 | 2 | 4 };

export interface Print { i: number; x: number; y: number; w: number; h: number; rot: number; hold: Hold }

function holdFor(i: number, seed: number): Hold {
  const k = i >> 1;
  if (i % 2 === 0) return { kind: "tape", layout: TAPE_LAYOUTS[(k + seed) % 4], variant: rnd(seed * 97 + i * 7 + 41) < 0.5 ? 1 : 2 };
  // 5 colours and 3 counts share no factor, so both change from print to print.
  return { kind: "pins", colour: PIN_COLOURS[(k * 2 + seed) % 5], count: PIN_COUNTS[(k + seed) % 3] };
}

export interface BoardView { w: number; h: number; cy: number }
export interface Camera { x: number; y: number; z: number }

/** A repeatable pseudo-random value in [0, 1) for a seed. */
const rnd = (seed: number) => { const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

export function boardView(narrow: boolean, W: number, H: number): BoardView {
  const top = narrow ? 10 + 58 + 22 : 16 + 66 + 30, side = narrow ? 16 : 44, bottom = narrow ? 24 : 40;
  return { w: Math.max(200, W - side * 2), h: Math.max(200, H - top - bottom), cy: (top - bottom) / 2 };
}

/**
 * Justified rows of prints. The row width is chosen so the finished board,
 * fitted to the viewport, is as large as possible: few prints make one wide
 * row, many prints make a grid that matches the screen's shape.
 */
export function boardPrints(aspectsIn: number[], seed: number, narrow: boolean, view: BoardView): Print[] {
  const G = narrow ? 18 : 26, RG = G + 10;
  const aspects = aspectsIn.map(a => Math.max(0.6, Math.min(2.2, a || 1.5)));
  const layout = (rowWidth: number) => {
    const rows: { cells: number[]; sum: number }[] = [];
    let cells: number[] = [], sum = 0;
    aspects.forEach((a, i) => {
      cells.push(i); sum += a;
      if (sum >= rowWidth / 330) { rows.push({ cells, sum }); cells = []; sum = 0; }
    });
    if (cells.length) rows.push({ cells, sum });
    const out: Print[] = [];
    let y = 0, prevH = 0, width = 0;
    rows.forEach((row, index) => {
      const avail = rowWidth - G * (row.cells.length - 1);
      const last = index === rows.length - 1 && rows.length > 1;
      const h = last ? Math.min(prevH || Infinity, Math.round(avail / row.sum)) : Math.round(avail / row.sum);
      prevH = h;
      const rowW = row.cells.reduce((t, i) => t + Math.round(h * aspects[i]), 0) + G * (row.cells.length - 1);
      width = Math.max(width, rowW);
      let x = -Math.round(rowW / 2);
      for (const i of row.cells) {
        const s = seed * 97 + i * 7, w = Math.round(h * aspects[i]);
        out.push({
          i, x, y, w, h, rot: (rnd(s + 6) * 2 - 1) * 0.5, hold: holdFor(i, seed),
        });
        x += w + G;
      }
      y += h + RG;
    });
    const height = y - RG;
    for (const print of out) print.y -= height / 2;
    return { out, zoom: Math.min(view.w / Math.max(1, width), view.h / Math.max(1, height)) };
  };
  let best = layout(1200);
  for (let rowWidth = 480; rowWidth <= 3600; rowWidth += 60) {
    const next = layout(rowWidth);
    if (next.zoom > best.zoom * 1.001) best = next;
  }
  return best.out;
}

/** The rectangle around every print, in board units. */
export function printBounds(prints: Print[]) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of prints) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x + p.w); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y + p.h); }
  return prints.length ? { x0, x1, y0, y1 } : { x0: 0, x1: 0, y0: 0, y1: 0 };
}

/** The camera that fits every print under the header. */
export function fittedCamera(prints: Print[], view: BoardView): Camera {
  if (!prints.length) return { x: 0, y: 0, z: 1 };
  const { x0, x1, y0, y1 } = printBounds(prints);
  const z = Math.max(0.05, Math.min(2.4, Math.min(view.w / (x1 - x0), view.h / (y1 - y0))));
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 - view.cy / z, z };
}

const MAX_ZOOM = 3.2;

/** Zoom out no further than the view that shows every print. */
export const clampZoom = (z: number, fit: number) => Math.max(fit, Math.min(Math.max(fit, MAX_ZOOM), z));

/**
 * Keep the prints on screen. A board smaller than the view can move around
 * inside it but not leave it; a larger one pans until its edge meets the
 * view's edge. With `elastic`, a drag pulls past the edge like a rubber band
 * that never gives more than an eighth of the view.
 */
export function clampCamera(camera: Camera, bounds: ReturnType<typeof printBounds>, view: BoardView, elastic = false): Camera {
  const hw = view.w / 2 / camera.z, hh = view.h / 2 / camera.z;
  const limit = (value: number, a: number, b: number, reach: number) => {
    const lo = Math.min(a, b), hi = Math.max(a, b), inside = Math.max(lo, Math.min(hi, value)), over = value - inside;
    return elastic && over ? inside + Math.sign(over) * reach * (1 - 1 / (Math.abs(over) / reach + 1)) : inside;
  };
  // The camera's y sits above the middle of the area under the header.
  const cy = view.cy / camera.z;
  return {
    z: camera.z,
    x: limit(camera.x, bounds.x0 + hw, bounds.x1 - hw, hw / 4),
    y: limit(camera.y + cy, bounds.y0 + hh, bounds.y1 - hh, hh / 4) - cy,
  };
}

/** m:ss for a clip's running time. */
export const runtime = (seconds = 0) => {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};
