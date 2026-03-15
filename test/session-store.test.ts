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
  await store.set("channel:1", { threadId: "thr_123", threadToolProfile: "ollama-research-tools-v2" });

  const reloaded = new SessionStore(storePath);
  await reloaded.load();

  assert.deepEqual(reloaded.get("channel:1"), { threadId: "thr_123", threadToolProfile: "ollama-research-tools-v2" });
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

test("session store persists workspace reply mode", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codexbox-"));
  const storePath = path.join(tempDir, "sessions.json");
  const store = new SessionStore(storePath);

  await store.load();
  await store.setWorkspaceReplyMode("channel:guild:parent", "auto");

  const reloaded = new SessionStore(storePath);
  await reloaded.load();

  assert.equal(reloaded.getWorkspaceReplyMode("channel:guild:parent"), "auto");
});

test("session store persists workspace model selection", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codexbox-"));
  const storePath = path.join(tempDir, "sessions.json");
  const store = new SessionStore(storePath);

  await store.load();
  await store.setWorkspaceModel("channel:guild:parent", "gpt-oss:120b");
  await store.setWorkspaceModelProvider("channel:guild:parent", "ollama");

  const reloaded = new SessionStore(storePath);
  await reloaded.load();

  assert.equal(reloaded.getWorkspaceModel("channel:guild:parent"), "gpt-oss:120b");
  assert.equal(reloaded.getWorkspaceModelProvider("channel:guild:parent"), "ollama");
});

test("session store treats default model and provider sentinels as unset", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codexbox-"));
  const storePath = path.join(tempDir, "sessions.json");
  await fs.writeFile(
    storePath,
    JSON.stringify({
      workspaceModels: {
        "channel:guild:parent": "default",
      },
      workspaceModelProviders: {
        "channel:guild:parent": "default",
      },
    }),
    "utf8",
  );

  const reloaded = new SessionStore(storePath);
  await reloaded.load();

  assert.equal(reloaded.getWorkspaceModel("channel:guild:parent"), null);
  assert.equal(reloaded.getWorkspaceModelProvider("channel:guild:parent"), null);
});
