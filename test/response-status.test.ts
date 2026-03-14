import assert from "node:assert/strict";
import test from "node:test";
import { formatProgressMessage, formatToolActivity, summarizeToolItem } from "../src/response-status.js";

test("summarizeToolItem formats command executions compactly", () => {
  const summary = summarizeToolItem({
    type: "commandExecution",
    command: "npm   run    build\n-- --watch",
  });

  assert.equal(summary, "exec: npm run build -- --watch");
});

test("formatProgressMessage shows spinner only while working and lists active tools", () => {
  const progress = formatProgressMessage({
    isWriting: false,
    activeTools: ["exec: npm test", "edit: src/index.ts"],
  });

  assert.equal(progress, "🔄 Thinking...\n\nCurrent tools:\n- exec: npm test\n- edit: src/index.ts");
});

test("formatToolActivity deduplicates tool summaries", () => {
  const activity = formatToolActivity([
    "exec: npm test",
    "edit: src/index.ts",
    "exec: npm test",
  ]);

  assert.equal(activity, "Tools used:\n- exec: npm test\n- edit: src/index.ts");
});
