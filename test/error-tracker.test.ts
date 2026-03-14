import assert from "node:assert/strict";
import test from "node:test";
import { ErrorTracker } from "../src/error-tracker.js";

test("error tracker records retrievable error reports", () => {
  const tracker = new ErrorTracker();
  const record = tracker.record(new Error("boom"), "source=dm:alice");

  assert.match(record.id, /^err-/);
  assert.equal(record.summary, "boom");
  assert.match(record.detail, /source=dm:alice/);
  assert.match(record.detail, /Error: boom/);
  assert.deepEqual(tracker.get(record.id), record);
});
