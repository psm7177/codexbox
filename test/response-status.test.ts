import assert from "node:assert/strict";
import test from "node:test";
import {
  formatCompletionMessage,
  formatProgressMessage,
  formatToolActivity,
  summarizeToolItem,
} from "../src/response-status.js";

test("summarizeToolItem formats command executions compactly", () => {
  const summary = summarizeToolItem({
    type: "commandExecution",
    command: "npm   run    build\n-- --watch",
  });

  assert.equal(summary, "exec: npm run build -- --watch");
});

test("summarizeToolItem ignores agent and user message items", () => {
  assert.equal(summarizeToolItem({ type: "agentMessage" }), null);
  assert.equal(summarizeToolItem({ type: "userMessage" }), null);
});

test("formatProgressMessage shows active, used, and preview sections", () => {
  const progress = formatProgressMessage({
    isWriting: false,
    activeTools: ["exec: npm test", "edit: src/index.ts"],
    usedTools: ["exec: npm test", "edit: src/index.ts"],
    previewText: "Draft answer in progress.",
  });

  assert.equal(
    progress,
    "🔄 Thinking...\n\nUsing now:\n- exec: npm test\n- edit: src/index.ts\n\nUsed tools:\n- exec: npm test\n- edit: src/index.ts\n\nPreview:\nDraft answer in progress.",
  );
});

test("formatToolActivity deduplicates tool summaries", () => {
  const activity = formatToolActivity([
    "exec: npm test",
    "edit: src/index.ts",
    "exec: npm test",
  ]);

  assert.equal(activity, "Tools used:\n- exec: npm test\n- edit: src/index.ts");
});

test("formatCompletionMessage includes full tool activity", () => {
  const completion = formatCompletionMessage([
    "exec: npm test",
    "edit: src/index.ts",
  ]);

  assert.equal(completion, "Reply complete.\n\nTools used:\n- exec: npm test\n- edit: src/index.ts");
});

test("formatCompletionMessage is capped to Discord-safe length", () => {
  const completion = formatCompletionMessage(Array.from({ length: 300 }, (_, index) => `exec: tool-${index}`));

  assert.ok(completion.length <= 1900);
  assert.match(completion, /\.\.\. \(truncated\)$/);
});
