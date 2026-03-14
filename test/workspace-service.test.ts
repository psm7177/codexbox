import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { Config } from "../src/config.js";
import { SessionStore } from "../src/session-store.js";
import { WorkspaceService } from "../src/state/workspace-service.js";

function createConfig(workspace: string): Pick<Config, "codexWorkspace" | "sandboxMode" | "sandboxNetworkAccess"> {
  return {
    codexWorkspace: workspace,
    sandboxMode: "workspaceWrite",
    sandboxNetworkAccess: false,
  };
}

test("workspace service returns defaults when no overrides exist", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "codex-workspace-service-"));
  const store = new SessionStore(path.join(workspace, ".data", "sessions.json"));
  const service = new WorkspaceService(store, createConfig(workspace));

  assert.equal(service.getCwd("channel:guild:general"), workspace);
  assert.equal(service.getSandboxMode("channel:guild:general"), "workspaceWrite");
  assert.equal(service.getNetworkAccess("channel:guild:general"), false);
});

test("workspace service persists overrides through the underlying store", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "codex-workspace-service-"));
  const store = new SessionStore(path.join(workspace, ".data", "sessions.json"));
  const service = new WorkspaceService(store, createConfig(workspace));
  const key = "channel:guild:general";

  await service.setCwd(key, path.join(workspace, "project"));
  await service.setSandboxMode(key, "readOnly");
  await service.setNetworkAccess(key, true);

  assert.equal(service.getCwd(key), path.join(workspace, "project"));
  assert.equal(service.getSandboxMode(key), "readOnly");
  assert.equal(service.getNetworkAccess(key), true);

  await service.resetCwd(key);
  await service.resetSandboxMode(key);
  await service.resetNetworkAccess(key);

  assert.equal(service.getCwd(key), workspace);
  assert.equal(service.getSandboxMode(key), "workspaceWrite");
  assert.equal(service.getNetworkAccess(key), false);
});
