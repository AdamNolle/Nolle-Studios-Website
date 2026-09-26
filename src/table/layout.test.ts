import assert from "node:assert/strict";
import { test } from "node:test";
import { balancedRows, boardPrints, boardView, clampCamera, clampZoom, fittedCamera, printBounds, runtime, sheetLayout, sheetOffsets } from "./layout.ts";

test("contact sheets fill their last row instead of leaving an empty cell", () => {
  assert.deepEqual(balancedRows(8, 4), [4, 4]);
  assert.deepEqual(balancedRows(5, 4), [3, 2]);
  assert.deepEqual(balancedRows(7, 3), [3, 2, 2]);
  assert.deepEqual(balancedRows(3, 2), [2, 1]);
  // Every row spans all twelve tracks.
  for (const count of [1, 2, 4, 5, 6, 7, 8, 11, 12]) {
    const { plan, tracks } = sheetLayout(count, false, 1440, 900);
    const rows = new Map<number, number>();
    for (const [row, , , span] of plan) rows.set(row, (rows.get(row) ?? 0) + span);
    for (const total of rows.values()) assert.equal(total, tracks, `${count} frames`);
  }
});

test("three frames make a feature sheet, and large shoots show a +N frame", () => {
  const feature = sheetLayout(3, false, 1440, 900);
  assert.equal(feature.tracks, 3);
  assert.deepEqual(feature.plan[0], [1, 1, 2, 2]);
  const big = sheetLayout(58, false, 1440, 900);
  assert.equal(big.visible, 12);
  assert.equal(big.more, 46);
  const phone = sheetLayout(58, true, 390, 844);
  assert.equal(phone.visible, 8);
});

test("sheets fit between the header and the transport at every size", () => {
  for (const [W, H, narrow] of [[1440, 900, false], [1920, 1080, false], [1024, 768, false], [390, 844, true], [320, 568, true], [844, 390, false]] as const) {
    for (const count of [1, 3, 6, 8, 20]) {
      const sheet = sheetLayout(count, narrow, W, H);
      const rows = Math.max(...sheet.plan.map(([row, , span]) => row + span - 1));
      const height = rows * sheet.rowH + (rows - 1) * sheet.gap + sheet.pad * 2 + 16 + 40;
      assert.ok(sheet.w <= W, `${count} at ${W}x${H} is ${sheet.w} wide`);
      assert.ok(height <= H - (narrow ? 186 : 236) + 20, `${count} at ${W}x${H} is ${height} tall`);
    }
  }
});

test("neighbouring sheets sit edge to edge with a fixed gutter", () => {
  assert.deepEqual(sheetOffsets([100, 200, 100], 1, 10), [-160, 0, 160]);
  assert.deepEqual(sheetOffsets([100, 100, 100], 0, 20), [0, 120, 240]);
});

test("a board of prints fits the viewport under the header", () => {
  const view = boardView(false, 1440, 900);
  const prints = boardPrints([1.5, 1.5, 0.67, 1.5, 1.5, 1.33, 1.5, 1.5], 1, false, view);
  assert.equal(prints.length, 8);
  const camera = fittedCamera(prints, view);
  for (const p of prints) {
    const left = (p.x - camera.x) * camera.z + 720, right = (p.x + p.w - camera.x) * camera.z + 720;
    assert.ok(left >= 0 && right <= 1440, "print stays on screen");
  }
  // Prints alternate between tape and pins, and are stable for a shoot.
  assert.deepEqual(prints.map(p => p.hold.kind).slice(0, 4), ["tape", "pins", "tape", "pins"]);
  assert.deepEqual(boardPrints([1.5, 1.5], 1, false, view), boardPrints([1.5, 1.5], 1, false, view));
});

test("clip lengths read as minutes and seconds", () => {
  assert.equal(runtime(14), "0:14");
  assert.equal(runtime(62.4), "1:02");
});

test("the board zooms out only as far as the view that shows every print", () => {
  const view = boardView(false, 2000, 980);
  const prints = boardPrints([0.67, 1.5, 1.5, 1.5, 1.5, 1.5], 3, false, view);
  const fit = fittedCamera(prints, view);
  assert.equal(clampZoom(0.3, fit.z), fit.z);
  assert.equal(clampZoom(fit.z * 1.5, fit.z), fit.z * 1.5);
  assert.equal(clampZoom(9, fit.z), 3.2);
  // A board too big for 30% still fits: the floor follows the prints, not a constant.
  const many = boardPrints(Array.from({ length: 60 }, () => 1.5), 3, true, boardView(true, 390, 844));
  assert.ok(fittedCamera(many, boardView(true, 390, 844)).z < 0.3);
});

test("the prints can't be dragged off screen", () => {
  const view = boardView(false, 1440, 900);
  const prints = boardPrints([1.5, 1.5, 1.5, 1.5], 1, false, view);
  const bounds = printBounds(prints), fit = fittedCamera(prints, view);
  // The fitted camera is already inside the limits.
  const kept = clampCamera(fit, bounds, view);
  assert.ok(Math.abs(kept.x - fit.x) < 1e-9 && Math.abs(kept.y - fit.y) < 1e-9);
  // Zoomed in and flung far away, the camera stops with the board's edge at the view's edge.
  const zoomed = { z: fit.z * 2, x: 1e5, y: -1e5 };
  const stopped = clampCamera(zoomed, bounds, view);
  const right = (bounds.x1 - stopped.x) * zoomed.z + 720, top = (bounds.y0 - stopped.y) * zoomed.z + 450;
  assert.ok(Math.abs(right - (720 + view.w / 2)) < 1e-6, "right edge meets the view");
  assert.ok(Math.abs(top - (450 + view.cy - view.h / 2)) < 1e-6, "top edge meets the area under the header");
  // A drag pulls past the edge, but never more than an eighth of the view.
  const pulled = clampCamera(zoomed, bounds, view, true);
  assert.ok(pulled.x > stopped.x && (pulled.x - stopped.x) * zoomed.z < view.w / 8);
});

test("neighbouring prints never hang the same way", () => {
  const view = boardView(false, 1440, 900);
  const prints = boardPrints(Array.from({ length: 12 }, () => 1.5), 2, false, view);
  const taped = prints.filter(p => p.hold.kind === "tape").map(p => p.hold);
  const pinned = prints.filter(p => p.hold.kind === "pins").map(p => p.hold);
  for (const list of [taped, pinned]) {
    for (let i = 1; i < list.length; i++) assert.notDeepEqual(list[i], list[i - 1]);
  }
  // Every tape placement, pin colour and pin count appears across a dozen prints.
  assert.equal(new Set(taped.map(h => h.kind === "tape" && h.layout)).size, 4);
  assert.equal(new Set(pinned.map(h => h.kind === "pins" && h.colour)).size, 4);
  assert.equal(new Set(pinned.map(h => h.kind === "pins" && h.count)).size, 3);
});
