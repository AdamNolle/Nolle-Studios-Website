import assert from "node:assert/strict";
import { test } from "node:test";
import { canRefract } from "./glass-support.ts";

test("SVG glass refraction is restricted to supported macOS Chromium", () => {
  assert.equal(canRefract("macOS", ["Chromium", "Google Chrome"]), true);
  assert.equal(canRefract("MacIntel", ["Chromium"]), true);
  assert.equal(canRefract("Windows", ["Chromium", "Google Chrome"]), false);
  assert.equal(canRefract("Linux", ["Chromium"]), false);
  assert.equal(canRefract("macOS", ["Safari"]), false);
});
