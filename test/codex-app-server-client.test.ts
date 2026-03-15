import assert from "node:assert/strict";
import test from "node:test";
import { createInitializeParams, createThreadStartParams } from "../src/codex-app-server-client.js";
import type { Config } from "../src/config.js";

function createConfig(workspace: string): Config {
  return {
    discordToken: "token",
    discordClientId: "client-id",
    discordMessageContentIntent: false,
    discordAllowedUserIds: [],
    discordAllowedGuildIds: [],
    discordAllowedChannelIds: [],
    restartAdminUserIds: [],
    codexWorkspace: workspace,
    envFilePath: `${workspace}/.env`,
    sandboxMode: "workspaceWrite",
    sandboxNetworkAccess: false,
    sessionStorePath: `${workspace}/.data/sessions.json`,
    appServerCommand: {
      bin: "codex",
      args: ["app-server", "--listen", "stdio://"],
    },
    clientInfo: {
      name: "codexbox",
      title: "Codexbox",
      version: "0.1.0",
    },
    threadDefaults: {
      cwd: workspace,
      model: "gpt-test",
      modelProvider: "openai",
      personality: "pragmatic",
      approvalPolicy: "never",
      serviceName: "codexbox",
    },
    turnDefaults: {
      cwd: workspace,
      model: "gpt-test",
      personality: "pragmatic",
      approvalPolicy: "never",
      summary: "concise",
      sandboxPolicy: {
        type: "workspaceWrite",
        writableRoots: [workspace],
        networkAccess: false,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      },
    },
  };
}

test("createInitializeParams opts into the experimental app-server api", () => {
  const config = createConfig("/workspace/project");

  assert.deepEqual(createInitializeParams(config), {
    clientInfo: config.clientInfo,
    capabilities: {
      experimentalApi: true,
    },
  });
});

test("createThreadStartParams injects web_search only for ollama threads", () => {
  const config = createConfig("/workspace/project");

  assert.deepEqual(createThreadStartParams(config, { modelProvider: "openai" }), {
    cwd: "/workspace/project",
    model: "gpt-test",
    modelProvider: "openai",
    approvalPolicy: "never",
    personality: "pragmatic",
    serviceName: "codexbox",
  });

  const ollamaParams = createThreadStartParams(config, { modelProvider: "ollama" });
  assert.equal(ollamaParams.dynamicTools?.[0]?.name, "web_search");
});
