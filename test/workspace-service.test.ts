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
): Pick<Config, "codexWorkspace" | "envFilePath" | "sandboxMode" | "sandboxNetworkAccess" | "threadDefaults"> {
  return {
    codexWorkspace: workspace,
    envFilePath: path.join(workspace, ".env"),
    sandboxMode: "workspaceWrite",
    sandboxNetworkAccess: false,
    threadDefaults: {
      cwd: workspace,
      model: "gpt-default",
      modelProvider: "openai",
      personality: "pragmatic",
      approvalPolicy: "never",
      serviceName: "codexbox",
    },
  };
}

test("workspace service returns defaults when no overrides exist", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "codex-workspace-service-"));
  const store = new SessionStore(path.join(workspace, ".data", "sessions.json"));
  const service = new WorkspaceService(store, createConfig(workspace));

  assert.equal(service.getCwd("channel:guild:general"), workspace);
  assert.equal(service.getSandboxMode("channel:guild:general"), "workspaceWrite");
  assert.equal(service.getNetworkAccess("channel:guild:general"), false);
  assert.equal(service.getModel("channel:guild:general"), "gpt-default");
  assert.equal(service.getModelProvider("channel:guild:general"), "openai");
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
  await service.setModel(key, "gpt-oss:120b");

  assert.equal(service.getCwd(key), projectDir);
  assert.equal(service.getSandboxMode(key), "readOnly");
  assert.equal(service.getNetworkAccess(key), true);
  assert.equal(service.getModel(key), "gpt-oss:120b");
  assert.equal(service.getModelProvider(key), "openai");

  await service.resetCwd(key);
  await service.resetSandboxMode(key);
  await service.resetNetworkAccess(key);
  await service.resetModel(key);
  await service.resetModelProvider(key);

  assert.equal(service.getCwd(key), workspace);
  assert.equal(service.getSandboxMode(key), "workspaceWrite");
  assert.equal(service.getNetworkAccess(key), false);
  assert.equal(service.getModel(key), "gpt-default");
  assert.equal(service.getModelProvider(key), "openai");
});

test("workspace service clears the model override when the provider changes", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "codex-workspace-service-"));
  const store = new SessionStore(path.join(workspace, ".data", "sessions.json"));
  const service = new WorkspaceService(store, createConfig(workspace));
  const key = "channel:guild:general";

  await service.setModel(key, "gpt-oss:120b");
  await service.setModelProvider(key, "ollama");

  assert.equal(service.getModelOverride(key), null);
  assert.equal(service.getModel(key), "gpt-default");
  assert.equal(service.getModelProvider(key), "ollama");
});

test("workspace service preserves the model override when the provider stays the same", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "codex-workspace-service-"));
  const store = new SessionStore(path.join(workspace, ".data", "sessions.json"));
  const service = new WorkspaceService(store, createConfig(workspace));
  const key = "channel:guild:general";

  await service.setModel(key, "gpt-5.4");
  await service.setModelProvider(key, "openai");

  assert.equal(service.getModelOverride(key), "gpt-5.4");
  assert.equal(service.getModel(key), "gpt-5.4");
  assert.equal(service.getModelProvider(key), "openai");
});

test("workspace service treats default model/provider selections as reset", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "codex-workspace-service-"));
  const store = new SessionStore(path.join(workspace, ".data", "sessions.json"));
  const service = new WorkspaceService(store, createConfig(workspace));
  const key = "channel:guild:general";

  await service.setModel(key, "default");
  await service.setModelProvider(key, "default");

  assert.equal(service.getModelOverride(key), null);
  assert.equal(service.getModelProviderOverride(key), null);
  assert.equal(service.getModel(key), "gpt-default");
  assert.equal(service.getModelProvider(key), "openai");
});

test("workspace service clears the model override when the provider resets to default", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "codex-workspace-service-"));
  const store = new SessionStore(path.join(workspace, ".data", "sessions.json"));
  const service = new WorkspaceService(store, createConfig(workspace));
  const key = "channel:guild:general";

  await service.setModelProvider(key, "ollama");
  await service.setModel(key, "gpt-oss:120b");
  await service.resetModelProvider(key);

  assert.equal(service.getModelOverride(key), null);
  assert.equal(service.getModel(key), "gpt-default");
  assert.equal(service.getModelProvider(key), "openai");
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
