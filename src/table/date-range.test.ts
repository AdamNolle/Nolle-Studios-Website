import assert from "node:assert/strict";
import test from "node:test";
import { displayDate } from "../archive.ts";

test("shoot display dates preserve single days and show both ends of a range", () => {
  assert.equal(displayDate("2026-09-20"), "20 SEP 2026");
  assert.equal(displayDate("2026-09-20", "2026-09-22"), "20 SEP 2026 – 22 SEP 2026");
  assert.equal(displayDate("", ""), "DATE UNKNOWN");
});
