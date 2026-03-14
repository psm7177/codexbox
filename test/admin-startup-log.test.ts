import assert from "node:assert/strict";
import test from "node:test";
import { formatStartupStatus } from "../src/startup/admin-startup-log.js";

test("formatStartupStatus renders current startup snapshot", () => {
  const text = formatStartupStatus({
    botTag: "codexbox#1234",
    phase: "startup complete",
    sessionStoreLoaded: true,
    codexReady: true,
    codexDeferred: false,
    workspace: "/workspace/project",
  });

  assert.equal(
    text,
    "Startup status\n- bot: codexbox#1234\n- phase: startup complete\n- session store: ready\n- codex app-server: ready\n- workspace: /workspace/project",
  );
});
