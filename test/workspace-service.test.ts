import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { Config } from "../src/config.js";
import { SessionStore } from "../src/session-store.js";
import { normalizeCwd, WorkspaceService } from "../src/state/workspace-service.js";

function createConfig(
  workspace: string,
): Pick<Config, "codexWorkspace" | "envFilePath" | "sandboxMode" | "sandboxNetworkAccess"> {
  return {
    codexWorkspace: workspace,
    envFilePath: path.join(workspace, ".env"),
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
  const projectDir = path.join(workspace, "project");

  await fs.mkdir(projectDir);

  await service.setCwd(key, projectDir);
  await service.setSandboxMode(key, "readOnly");
  await service.setNetworkAccess(key, true);

  assert.equal(service.getCwd(key), projectDir);
  assert.equal(service.getSandboxMode(key), "readOnly");
  assert.equal(service.getNetworkAccess(key), true);

  await service.resetCwd(key);
  await service.resetSandboxMode(key);
  await service.resetNetworkAccess(key);

  assert.equal(service.getCwd(key), workspace);
  assert.equal(service.getSandboxMode(key), "workspaceWrite");
  assert.equal(service.getNetworkAccess(key), false);
});

test("workspace service rejects cwd outside the configured workspace root", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "codex-workspace-service-"));
  const store = new SessionStore(path.join(workspace, ".data", "sessions.json"));
  const service = new WorkspaceService(store, createConfig(workspace));

  await assert.rejects(() => service.setCwd("channel:guild:general", path.resolve("/tmp")));
});

test("normalizeCwd falls back to workspace root for out-of-bounds paths", () => {
  const workspace = path.resolve("/home/test/workspace");

  assert.equal(normalizeCwd(workspace, path.join(workspace, "project")), path.join(workspace, "project"));
  assert.equal(normalizeCwd(workspace, "/etc"), workspace);
});
