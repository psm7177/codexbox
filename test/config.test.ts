import assert from "node:assert/strict";
import test from "node:test";
import { buildAppServerEnv, loadConfig } from "../src/config.js";

test("buildAppServerEnv excludes Discord secrets and keeps required runtime vars", () => {
  const env = buildAppServerEnv({
    PATH: "/usr/bin",
    HOME: "/home/test",
    CODEX_APP_SERVER_BIN: "codex",
    OPENAI_API_KEY: "openai-secret",
    DISCORD_TOKEN: "discord-secret",
    DISCORD_CLIENT_ID: "discord-client",
  });

  assert.equal(env.PATH, "/usr/bin");
  assert.equal(env.HOME, "/home/test");
  assert.equal(env.CODEX_APP_SERVER_BIN, "codex");
  assert.equal(env.OPENAI_API_KEY, "openai-secret");
  assert.equal(env.DISCORD_TOKEN, undefined);
  assert.equal(env.DISCORD_CLIENT_ID, undefined);
});

test("loadConfig parses workflow defaults from env", () => {
  const originalValues = {
    CODEX_WORKFLOW_POLL_INTERVAL_MS: process.env.CODEX_WORKFLOW_POLL_INTERVAL_MS,
    CODEX_WORKFLOW_RETRY_BASE_DELAY_MS: process.env.CODEX_WORKFLOW_RETRY_BASE_DELAY_MS,
    CODEX_WORKFLOW_RETRY_MAX_DELAY_MS: process.env.CODEX_WORKFLOW_RETRY_MAX_DELAY_MS,
    CODEX_WORKFLOW_MAX_FAILURES: process.env.CODEX_WORKFLOW_MAX_FAILURES,
    CODEX_WORKFLOW_REUSE_CONVERSATION_THREAD: process.env.CODEX_WORKFLOW_REUSE_CONVERSATION_THREAD,
    WORKFLOW_STORE_PATH: process.env.WORKFLOW_STORE_PATH,
    WORKFLOW_ARTIFACTS_PATH: process.env.WORKFLOW_ARTIFACTS_PATH,
  };

  process.env.CODEX_WORKFLOW_POLL_INTERVAL_MS = "20000";
  process.env.CODEX_WORKFLOW_RETRY_BASE_DELAY_MS = "30000";
  process.env.CODEX_WORKFLOW_RETRY_MAX_DELAY_MS = "90000";
  process.env.CODEX_WORKFLOW_MAX_FAILURES = "7";
  process.env.CODEX_WORKFLOW_REUSE_CONVERSATION_THREAD = "true";
  process.env.WORKFLOW_STORE_PATH = ".tmp/workflows.json";
  process.env.WORKFLOW_ARTIFACTS_PATH = ".tmp/workflows";

  try {
    const config = loadConfig();
    assert.equal(config.workflowDefaults.pollIntervalMs, 20_000);
    assert.equal(config.workflowDefaults.retryBaseDelayMs, 30_000);
    assert.equal(config.workflowDefaults.retryMaxDelayMs, 90_000);
    assert.equal(config.workflowDefaults.maxFailures, 7);
    assert.equal(config.workflowDefaults.reuseConversationThread, true);
    assert.match(config.workflowDefaults.storePath, /\.tmp\/workflows\.json$/);
    assert.match(config.workflowDefaults.artifactsPath, /\.tmp\/workflows$/);
  } finally {
    for (const [key, value] of Object.entries(originalValues)) {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});
