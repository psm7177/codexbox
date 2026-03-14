import assert from "node:assert/strict";
import test from "node:test";
import { buildAppServerEnv } from "../src/config.js";

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
