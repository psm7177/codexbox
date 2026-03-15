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
    workflowCount: 2,
    dueWorkflowCount: 1,
    workflowRunnerState: "running",
    workflowThreadPolicy: "dedicated-workflow-thread",
    workflowActivitySummary: ["1h: 1 events, completed=1, failed=0, retried=0", "24h: 8 events, completed=3, failed=1, retried=1"],
    workflowOperationalSummary: "overdue=1, stalled=0, paused=1, failed=1, high_failure=1, recent_active=2",
    workflowProviderSummary: "ollama=2, openai=1",
    workflowHotspotSummary: "workspaces=dm:channel-1:2; conversations=dm:channel-1:2",
  });

  assert.equal(
    text,
    "Startup status\n- bot: codexbox#1234\n- phase: startup complete\n- session store: ready\n- codex app-server: ready\n- workspace: /workspace/project\n- workflows: 2 total, 1 due\n- workflow runner: running\n- workflow thread policy: dedicated-workflow-thread\n- workflow activity:\n  1h: 1 events, completed=1, failed=0, retried=0\n  24h: 8 events, completed=3, failed=1, retried=1\n- workflow ops: overdue=1, stalled=0, paused=1, failed=1, high_failure=1, recent_active=2\n- workflow providers: ollama=2, openai=1\n- workflow hotspots: workspaces=dm:channel-1:2; conversations=dm:channel-1:2",
  );
});
