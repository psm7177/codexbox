import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SessionStore } from "../src/session-store.js";

test("session store persists sessions", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codexbox-"));
  const storePath = path.join(tempDir, "sessions.json");
  const store = new SessionStore(storePath);

  await store.load();
  await store.set("channel:1", { threadId: "thr_123" });

  const reloaded = new SessionStore(storePath);
  await reloaded.load();

  assert.deepEqual(reloaded.get("channel:1"), { threadId: "thr_123" });
});

test("session store persists workspace mappings", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codexbox-"));
  const storePath = path.join(tempDir, "sessions.json");
  const store = new SessionStore(storePath);

  await store.load();
  await store.setWorkspace("channel:guild:parent", "/tmp/project");

  const reloaded = new SessionStore(storePath);
  await reloaded.load();

  assert.equal(reloaded.getWorkspace("channel:guild:parent"), "/tmp/project");
});

test("session store persists workspace network access", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codexbox-"));
  const storePath = path.join(tempDir, "sessions.json");
  const store = new SessionStore(storePath);

  await store.load();
  await store.setWorkspaceNetworkAccess("channel:guild:parent", true);

  const reloaded = new SessionStore(storePath);
  await reloaded.load();

  assert.equal(reloaded.getWorkspaceNetworkAccess("channel:guild:parent"), true);
});

test("session store persists workspace sandbox mode", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codexbox-"));
  const storePath = path.join(tempDir, "sessions.json");
  const store = new SessionStore(storePath);

  await store.load();
  await store.setWorkspaceSandboxMode("channel:guild:parent", "dangerFullAccess");

  const reloaded = new SessionStore(storePath);
  await reloaded.load();

  assert.equal(reloaded.getWorkspaceSandboxMode("channel:guild:parent"), "dangerFullAccess");
});
