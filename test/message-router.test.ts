import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { Message } from "discord.js";
import { createCommandHandlers } from "../src/commands.js";
import type { CodexUserInput } from "../src/codex-app-server-client.js";
import type { Config } from "../src/config.js";
import { getConversationKey, getWorkspaceKey } from "../src/discord-context.js";
import { ErrorTracker } from "../src/error-tracker.js";
import { RestartCoordinator } from "../src/lifecycle/restart-coordinator.js";
import { SessionStore } from "../src/session-store.js";
import { ConversationService } from "../src/state/conversation-service.js";
import { WorkflowService } from "../src/state/workflow-service.js";
import { WorkspaceService } from "../src/state/workspace-service.js";
import { WorkflowStore } from "../src/workflow-store.js";
import { createMessageCreateHandler } from "../src/chat/message-router.js";

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
    envFilePath: path.join(workspace, ".env"),
    sandboxMode: "workspaceWrite",
    sandboxNetworkAccess: false,
    sessionStorePath: path.join(workspace, ".data", "sessions.json"),
    workflowDefaults: {
      storePath: path.join(workspace, ".data", "workflows.json"),
      artifactsPath: path.join(workspace, ".data", "workflows"),
      pollIntervalMs: 15_000,
      retryBaseDelayMs: 60_000,
      retryMaxDelayMs: 3_600_000,
      maxFailures: 5,
      reuseConversationThread: false,
    },
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

interface TestMessageOptions {
  authorBot?: boolean;
  authorId?: string;
  authorTag?: string;
  authorUsername?: string;
  attachments?: Array<{
    name: string | null;
    url: string;
    contentType?: string | null;
    size?: number;
  }>;
  content?: string;
  reply?: (content: string) => Promise<unknown>;
  mentioned?: boolean;
  channel?: {
    id?: string;
    name?: string;
    parentId?: string | null;
    isThread?: () => boolean;
    isSendable?: () => boolean;
    send?: (content: string) => Promise<unknown>;
  };
  channelId?: string;
  guildId?: string | null;
  guild?: { name: string } | null;
  inGuild?: () => boolean;
}

function createMessage(options: TestMessageOptions = {}): Message {
  const reply = options?.reply ?? (async () => undefined);
  const attachmentItems = options.attachments ?? [];
  const channel = {
    id: "channel-1",
    name: "general",
    parentId: null,
    isThread: () => false,
    isSendable: () => true,
    send: async () => undefined,
    ...options.channel,
  };
  const mentionsUsers = { has: () => options.mentioned ?? true };
  const message = {
    content: "<@bot-1> hello",
    channelId: "channel-1",
    guildId: "guild-1",
    guild: { name: "Guild" },
    channel,
    author: {
      id: options.authorId ?? "user-1",
      bot: options.authorBot ?? false,
      username: options.authorUsername ?? "alice",
      tag: options.authorTag ?? "alice#0001",
    },
    mentions: {
      users: mentionsUsers,
      repliedUser: null,
    },
    attachments: {
      size: attachmentItems.length,
      values: () => attachmentItems.values(),
      [Symbol.iterator]: () => attachmentItems.values(),
    },
    reference: null,
    inGuild: () => true,
    reply,
    ...(options.content ? { content: options.content } : {}),
    ...(options.channelId ? { channelId: options.channelId } : {}),
    ...(options.guildId !== undefined ? { guildId: options.guildId } : {}),
    ...(options.guild !== undefined ? { guild: options.guild } : {}),
    ...(options.inGuild ? { inGuild: options.inGuild } : {}),
  };
  return message as unknown as Message;
}

function createCodexRequestStub() {
  return async (method: string) => {
    if (method === "config/read") {
      return {
        config: {
          model: "gpt-test",
          model_provider: "openai",
          model_providers: {
            ollama: {
              name: "Ollama Cloud",
              base_url: "https://ollama.com/v1",
            },
            custom_provider: {
              name: "Custom Provider",
              base_url: "https://custom.example/v1",
            },
          },
        },
      };
    }

    if (method === "thread/read") {
      return {
        thread: {
          status: { type: "idle" },
          model: "gpt-test",
          modelProvider: "openai",
        },
      };
    }

    if (method === "account/read") {
      return {
        account: {
          type: "chatgpt",
          email: "user@example.com",
          planType: "pro",
        },
        requiresOpenaiAuth: true,
      };
    }

    if (method === "account/rateLimits/read") {
      return {
        rateLimits: {
          limitId: "codex",
          limitName: null,
          primary: {
            usedPercent: 25,
            windowDurationMins: 15,
            resetsAt: 1730947200,
          },
        },
        rateLimitsByLimitId: {
          codex: {
            limitId: "codex",
            limitName: null,
            primary: {
              usedPercent: 25,
              windowDurationMins: 15,
              resetsAt: 1730947200,
            },
          },
        },
      };
    }

    if (method === "model/list") {
      return {
        data: [
          { displayName: "GPT OSS 120B", model: "gpt-oss:120b", id: "gpt-oss:120b", hidden: false },
          { displayName: "GPT-5.4", model: "gpt-5.4", id: "gpt-5.4", hidden: false },
        ],
      };
    }

    throw new Error(`Unexpected request: ${method}`);
  };
}

test("message router routes commands to command handlers", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "codex-router-"));
  const config = createConfig(workspace);
  const sessionStore = new SessionStore(config.sessionStorePath);
  const conversationService = new ConversationService(sessionStore);
  const workspaceService = new WorkspaceService(sessionStore, config);
  const restartCoordinator = new RestartCoordinator({ exitProcess: () => {} });
  const errorTracker = new ErrorTracker();
  const commandHandlers = createCommandHandlers({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    codexClient: {
      request: createCodexRequestStub(),
    },
    errorTracker,
    getConversationKey,
    getWorkspaceKey,
  });
  let ensureThreadCalled = false;
  let runTurnCalled = false;
  const replies: string[] = [];
  const handler = createMessageCreateHandler({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    codexClient: {
      async ensureThread() {
        ensureThreadCalled = true;
        return "thread-1";
      },
      async startTurn() {
        throw new Error("startTurn should not be called for commands");
      },
    },
    commandHandlers,
    errorTracker,
    getBotUserId: () => "bot-1",
    runTurn: async () => {
      runTurnCalled = true;
    },
    log: () => {},
    errorLog: () => {},
  });

  await handler(
    createMessage({
      content: "<@bot-1> !codex status",
      reply: async (content: string) => {
        replies.push(content);
        return undefined;
      },
    }),
  );

  assert.equal(ensureThreadCalled, false);
  assert.equal(runTurnCalled, false);
  assert.match(replies[0] ?? "", new RegExp(`workspace: \`${config.codexWorkspace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\``));
  assert.match(replies[0] ?? "", /cwd: `.*`/);
  assert.match(replies[0] ?? "", /selected model: `gpt-test`/);
  assert.match(replies[0] ?? "", /selected provider: `openai`/);
  assert.match(replies[0] ?? "", /model override: `none`/);
  assert.match(replies[0] ?? "", /provider override: `none`/);
  assert.match(replies[0] ?? "", /expected thread tool profile: `none`/);
  assert.match(replies[0] ?? "", /expected dynamic tools: `none`/);
  assert.match(replies[0] ?? "", /background workflows: `0`/);
  assert.match(replies[0] ?? "", /auth mode: `chatgpt`/);
  assert.match(replies[0] ?? "", /account: `user@example\.com`/);
  assert.match(replies[0] ?? "", /plan: `pro`/);
  assert.match(replies[0] ?? "", /openai auth required: `yes`/);
  assert.match(replies[0] ?? "", /usage:/);
  assert.match(replies[0] ?? "", /codex: `75% remaining`/);
  assert.match(replies[0] ?? "", /No Codex session is mapped to this conversation yet\./);
});

test("message router shows categorized help output", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "codex-router-"));
  const config = createConfig(workspace);
  const sessionStore = new SessionStore(config.sessionStorePath);
  const conversationService = new ConversationService(sessionStore);
  const workspaceService = new WorkspaceService(sessionStore, config);
  const restartCoordinator = new RestartCoordinator({ exitProcess: () => {} });
  const errorTracker = new ErrorTracker();
  const commandHandlers = createCommandHandlers({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    codexClient: {
      request: createCodexRequestStub(),
    },
    errorTracker,
    getConversationKey,
    getWorkspaceKey,
  });
  const replies: string[] = [];
  const handler = createMessageCreateHandler({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    codexClient: {
      async ensureThread() {
        throw new Error("ensureThread should not be called for help");
      },
      async startTurn() {
        throw new Error("startTurn should not be called for help");
      },
    },
    commandHandlers,
    errorTracker,
    getBotUserId: () => "bot-1",
    log: () => {},
    errorLog: () => {},
  });

  await handler(
    createMessage({
      content: "<@bot-1> !codex help",
      channel: {
        send: async (content: string) => {
          replies.push(content);
          return undefined;
        },
      },
      reply: async (content: string) => {
        replies.push(content);
        return undefined;
      },
    }),
  );

  const helpText = replies.join("\n");
  assert.match(helpText, /Available commands:/);
  assert.match(helpText, /Core:/);
  assert.match(helpText, /Models:/);
  assert.match(helpText, /Background Work:/);
  assert.match(helpText, /Workspace:/);
  assert.match(helpText, /Admin:/);
  assert.match(helpText, /!codex tools/);
  assert.match(helpText, /!codex work dashboard/);
});

test("message router shows workflow breakdowns in the status command", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "codex-router-"));
  const config = createConfig(workspace);
  const sessionStore = new SessionStore(config.sessionStorePath);
  const workflowStore = new WorkflowStore(path.join(workspace, ".data", "workflows.json"));
  await workflowStore.load();
  const conversationService = new ConversationService(sessionStore);
  const workflowService = new WorkflowService(workflowStore, {
    artifactsRoot: path.join(workspace, ".data", "workflows"),
  });
  const workspaceService = new WorkspaceService(sessionStore, config);
  const restartCoordinator = new RestartCoordinator({ exitProcess: () => {} });
  const errorTracker = new ErrorTracker();
  await workflowService.createWorkflow({
    conversationKey: "dm:channel-1",
    workspaceKey: "dm:channel-1",
    conversationKind: "dm",
    channelId: "channel-1",
    guildId: null,
    goal: "summarize recent workflow outputs",
    cwd: workspace,
    model: "gpt-test",
    modelProvider: "ollama",
    threadPolicy: "dedicated-workflow-thread",
  });

  const replies: string[] = [];
  const commandHandlers = createCommandHandlers({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    workflowService,
    workflowRunner: {
      wake() {},
      getStats() {
        return {
          running: true,
          tickInFlight: false,
          startedAt: null,
          lastWakeAt: null,
          lastRunStartedAt: null,
          lastRunCompletedAt: null,
          lastError: null,
          intervalMs: 15_000,
          reuseConversationThread: false,
          workflowCounts: {
            total: 1,
            queued: 1,
            running: 0,
            waiting: 0,
            paused: 0,
            completed: 0,
            failed: 0,
            cancelled: 0,
            due: 1,
          },
          counters: {
            wakeRequests: 0,
            stepsStarted: 0,
            stepsCompleted: 0,
            stepsFailed: 0,
            updatesSent: 0,
            filesSent: 0,
            imagesSent: 0,
          },
        };
      },
    },
    codexClient: {
      request: createCodexRequestStub(),
    },
    errorTracker,
    getConversationKey,
    getWorkspaceKey,
  });
  const handler = createMessageCreateHandler({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    codexClient: {
      async ensureThread() {
        throw new Error("ensureThread should not be called for status");
      },
      async startTurn() {
        throw new Error("startTurn should not be called for status");
      },
    },
    commandHandlers,
    errorTracker,
    getBotUserId: () => "bot-1",
    log: () => {},
    errorLog: () => {},
  });

  await handler(
    createMessage({
      content: "<@bot-1> !codex status",
      guildId: null,
      guild: null,
      inGuild: () => false,
      reply: async (content: string) => {
        replies.push(content);
        return undefined;
      },
    }),
  );

  assert.match(replies[0] ?? "", /workflow status counts: `queued=1, running=0, waiting=0, paused=0, completed=0, failed=0, cancelled=0`/);
  assert.match(replies[0] ?? "", /workflow providers: `ollama=1`/);
  assert.match(replies[0] ?? "", /workflow hotspots: `workspaces=dm:channel-1=1; conversations=dm:channel-1=1`/);
});

test("message router shows injected tools for ollama through the tools command", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "codex-router-"));
  const config = createConfig(workspace);
  const sessionStore = new SessionStore(config.sessionStorePath);
  const conversationService = new ConversationService(sessionStore);
  const workspaceService = new WorkspaceService(sessionStore, config);
  const restartCoordinator = new RestartCoordinator({ exitProcess: () => {} });
  const errorTracker = new ErrorTracker();
  await workspaceService.setModelProvider("dm:channel-1", "ollama");
  await workspaceService.setModel("dm:channel-1", "gpt-oss:20b");
  await conversationService.saveThread("dm:channel-1", "thread-ollama", {
    threadToolProfile: "ollama-research-tools-v2",
  });

  const commandHandlers = createCommandHandlers({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    codexClient: {
      request: createCodexRequestStub(),
    },
    errorTracker,
    getConversationKey,
    getWorkspaceKey,
  });
  let ensureThreadCalled = false;
  let runTurnCalled = false;
  const replies: string[] = [];
  const handler = createMessageCreateHandler({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    codexClient: {
      async ensureThread() {
        ensureThreadCalled = true;
        return "thread-1";
      },
      async startTurn() {
        throw new Error("startTurn should not be called for tools command");
      },
    },
    commandHandlers,
    errorTracker,
    getBotUserId: () => "bot-1",
    runTurn: async () => {
      runTurnCalled = true;
    },
    log: () => {},
    errorLog: () => {},
  });

  await handler(
    createMessage({
      content: "<@bot-1> !codex tools",
      guildId: null,
      guild: null,
      inGuild: () => false,
      reply: async (content: string) => {
        replies.push(content);
        return undefined;
      },
    }),
  );

  assert.equal(ensureThreadCalled, false);
  assert.equal(runTurnCalled, false);
  assert.match(replies[0] ?? "", /Injected tools for this workspace:/);
  assert.match(replies[0] ?? "", /selected model: `gpt-oss:20b`/);
  assert.match(replies[0] ?? "", /selected provider: `ollama`/);
  assert.match(replies[0] ?? "", /expected thread tool profile: `ollama-research-tools-v2`/);
  assert.match(replies[0] ?? "", /expected dynamic tools: `web_search, download_open_access_pdf`/);
  assert.match(replies[0] ?? "", /- web_search:/);
  assert.match(replies[0] ?? "", /- download_open_access_pdf:/);
  assert.match(replies[0] ?? "", /session thread: `thread-ollama`/);
  assert.match(replies[0] ?? "", /session thread tool profile: `ollama-research-tools-v2`/);
  assert.match(replies[0] ?? "", /session dynamic tools: `web_search, download_open_access_pdf`/);
  assert.match(replies[0] ?? "", /tool profile matches selection: `yes`/);
});

test("message router queues background workflows through the work command", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "codex-router-"));
  const config = createConfig(workspace);
  const sessionStore = new SessionStore(config.sessionStorePath);
  const workflowStore = new WorkflowStore(path.join(workspace, ".data", "workflows.json"));
  await workflowStore.load();
  const conversationService = new ConversationService(sessionStore);
  const workflowService = new WorkflowService(workflowStore, {
    artifactsRoot: path.join(workspace, ".data", "workflows"),
  });
  const workspaceService = new WorkspaceService(sessionStore, config);
  const restartCoordinator = new RestartCoordinator({ exitProcess: () => {} });
  const errorTracker = new ErrorTracker();
  const commandHandlers = createCommandHandlers({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    workflowService,
    workflowRunner: {
      wake() {},
      getStats() {
        return undefined as never;
      },
    },
    codexClient: {
      request: createCodexRequestStub(),
    },
    errorTracker,
    getConversationKey,
    getWorkspaceKey,
  });
  const replies: string[] = [];
  const handler = createMessageCreateHandler({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    codexClient: {
      async ensureThread() {
        throw new Error("ensureThread should not be called for work command");
      },
      async startTurn() {
        throw new Error("startTurn should not be called for work command");
      },
    },
    commandHandlers,
    errorTracker,
    getBotUserId: () => "bot-1",
    log: () => {},
    errorLog: () => {},
  });

  await handler(
    createMessage({
      content: "<@bot-1> !codex work keep triaging new DOI arrivals",
      guildId: null,
      guild: null,
      inGuild: () => false,
      reply: async (content: string) => {
        replies.push(content);
        return undefined;
      },
    }),
  );

  assert.match(replies[0] ?? "", /Queued workflow `wf_/);
  assert.equal(workflowService.listConversationWorkflows("dm:channel-1").length, 1);
});

test("message router rejects duplicate active workflow goals in the same conversation", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "codex-router-"));
  const config = createConfig(workspace);
  const sessionStore = new SessionStore(config.sessionStorePath);
  const workflowStore = new WorkflowStore(path.join(workspace, ".data", "workflows.json"));
  await workflowStore.load();
  const conversationService = new ConversationService(sessionStore);
  const workflowService = new WorkflowService(workflowStore, {
    artifactsRoot: path.join(workspace, ".data", "workflows"),
  });
  const workspaceService = new WorkspaceService(sessionStore, config);
  const restartCoordinator = new RestartCoordinator({ exitProcess: () => {} });
  const errorTracker = new ErrorTracker();
  await workflowService.createWorkflow({
    conversationKey: "dm:channel-1",
    workspaceKey: "dm:channel-1",
    conversationKind: "dm",
    channelId: "channel-1",
    guildId: null,
    goal: "keep triaging new DOI arrivals",
    cwd: workspace,
    model: "gpt-test",
    modelProvider: "openai",
    threadId: null,
    threadToolProfile: null,
  });
  const commandHandlers = createCommandHandlers({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    workflowService,
    workflowRunner: {
      wake() {},
      getStats() {
        return undefined as never;
      },
    },
    codexClient: {
      request: createCodexRequestStub(),
    },
    errorTracker,
    getConversationKey,
    getWorkspaceKey,
  });
  const replies: string[] = [];
  const handler = createMessageCreateHandler({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    codexClient: {
      async ensureThread() {
        throw new Error("ensureThread should not be called for work command");
      },
      async startTurn() {
        throw new Error("startTurn should not be called for work command");
      },
    },
    commandHandlers,
    errorTracker,
    getBotUserId: () => "bot-1",
    log: () => {},
    errorLog: () => {},
  });

  await handler(
    createMessage({
      content: "<@bot-1> !codex work keep triaging new DOI arrivals",
      guildId: null,
      guild: null,
      inGuild: () => false,
      reply: async (content: string) => {
        replies.push(content);
        return undefined;
      },
    }),
  );

  assert.match(replies[0] ?? "", /similar active workflow already exists/);
  assert.equal(workflowService.listConversationWorkflows("dm:channel-1").length, 1);
});

test("message router creates a workflow with an explicit dedicated thread policy flag", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "codex-router-"));
  const config = createConfig(workspace);
  config.workflowDefaults.reuseConversationThread = true;
  const sessionStore = new SessionStore(config.sessionStorePath);
  await sessionStore.set("dm:channel-1", { threadId: "thread-foreground" });
  const workflowStore = new WorkflowStore(path.join(workspace, ".data", "workflows.json"));
  await workflowStore.load();
  const conversationService = new ConversationService(sessionStore);
  const workflowService = new WorkflowService(workflowStore, {
    artifactsRoot: path.join(workspace, ".data", "workflows"),
  });
  const workspaceService = new WorkspaceService(sessionStore, config);
  const restartCoordinator = new RestartCoordinator({ exitProcess: () => {} });
  const errorTracker = new ErrorTracker();
  const commandHandlers = createCommandHandlers({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    workflowService,
    workflowRunner: {
      wake() {},
      getStats() {
        return undefined as never;
      },
    },
    codexClient: {
      request: createCodexRequestStub(),
    },
    errorTracker,
    getConversationKey,
    getWorkspaceKey,
  });
  const replies: string[] = [];
  const handler = createMessageCreateHandler({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    codexClient: {
      async ensureThread() {
        throw new Error("ensureThread should not be called for work command");
      },
      async startTurn() {
        throw new Error("startTurn should not be called for work command");
      },
    },
    commandHandlers,
    errorTracker,
    getBotUserId: () => "bot-1",
    log: () => {},
    errorLog: () => {},
  });

  await handler(
    createMessage({
      content: "<@bot-1> !codex work --dedicated-thread keep triaging new DOI arrivals",
      guildId: null,
      guild: null,
      inGuild: () => false,
      reply: async (content: string) => {
        replies.push(content);
        return undefined;
      },
    }),
  );

  const workflow = workflowService.listConversationWorkflows("dm:channel-1")[0];
  assert.equal(workflow?.threadPolicy, "dedicated-workflow-thread");
  assert.equal(workflow?.threadId, null);
  assert.match(replies[0] ?? "", /thread policy: `dedicated-workflow-thread`/);
});

test("message router shows and pauses background workflows through the work command", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "codex-router-"));
  const config = createConfig(workspace);
  const sessionStore = new SessionStore(config.sessionStorePath);
  const workflowStore = new WorkflowStore(path.join(workspace, ".data", "workflows.json"));
  await workflowStore.load();
  const conversationService = new ConversationService(sessionStore);
  const workflowService = new WorkflowService(workflowStore, {
    artifactsRoot: path.join(workspace, ".data", "workflows"),
  });
  const workspaceService = new WorkspaceService(sessionStore, config);
  const restartCoordinator = new RestartCoordinator({ exitProcess: () => {} });
  const errorTracker = new ErrorTracker();
  const workflow = await workflowService.createWorkflow({
    conversationKey: "dm:channel-1",
    workspaceKey: "dm:channel-1",
    conversationKind: "dm",
    channelId: "channel-1",
    guildId: null,
    goal: "keep triaging new DOI arrivals",
    cwd: workspace,
    model: "gpt-test",
    modelProvider: "openai",
    threadId: null,
    threadToolProfile: null,
  });
  const commandHandlers = createCommandHandlers({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    workflowService,
    workflowRunner: {
      wake() {},
      getStats() {
        return undefined as never;
      },
    },
    codexClient: {
      request: createCodexRequestStub(),
    },
    errorTracker,
    getConversationKey,
    getWorkspaceKey,
  });
  const replies: string[] = [];
  const handler = createMessageCreateHandler({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    codexClient: {
      async ensureThread() {
        throw new Error("ensureThread should not be called for work command");
      },
      async startTurn() {
        throw new Error("startTurn should not be called for work command");
      },
    },
    commandHandlers,
    errorTracker,
    getBotUserId: () => "bot-1",
    log: () => {},
    errorLog: () => {},
  });

  await handler(
    createMessage({
      content: `<@bot-1> !codex work show ${workflow.id}`,
      guildId: null,
      guild: null,
      inGuild: () => false,
      reply: async (content: string) => {
        replies.push(content);
        return undefined;
      },
    }),
  );
  await handler(
    createMessage({
      content: `<@bot-1> !codex work pause ${workflow.id}`,
      guildId: null,
      guild: null,
      inGuild: () => false,
      reply: async (content: string) => {
        replies.push(content);
        return undefined;
      },
    }),
  );
  await handler(
    createMessage({
      content: `<@bot-1> !codex work resume ${workflow.id}`,
      guildId: null,
      guild: null,
      inGuild: () => false,
      reply: async (content: string) => {
        replies.push(content);
        return undefined;
      },
    }),
  );

  assert.match(replies[0] ?? "", new RegExp(`Workflow \`${workflow.id}\``));
  assert.match(replies[0] ?? "", /artifacts:/);
  assert.match(replies[1] ?? "", /Paused workflow/);
  assert.match(replies[2] ?? "", /Resumed workflow/);
});

test("message router treats work stop as a workflow cancellation command", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "codex-router-"));
  const config = createConfig(workspace);
  const sessionStore = new SessionStore(config.sessionStorePath);
  const workflowStore = new WorkflowStore(path.join(workspace, ".data", "workflows.json"));
  await workflowStore.load();
  const conversationService = new ConversationService(sessionStore);
  const workflowService = new WorkflowService(workflowStore, {
    artifactsRoot: path.join(workspace, ".data", "workflows"),
  });
  const workspaceService = new WorkspaceService(sessionStore, config);
  const restartCoordinator = new RestartCoordinator({ exitProcess: () => {} });
  const errorTracker = new ErrorTracker();
  const workflow = await workflowService.createWorkflow({
    conversationKey: "dm:channel-1",
    workspaceKey: "dm:channel-1",
    conversationKind: "dm",
    channelId: "channel-1",
    guildId: null,
    goal: "keep triaging new DOI arrivals",
    cwd: workspace,
    model: "gpt-test",
    modelProvider: "openai",
    threadId: null,
    threadToolProfile: null,
  });
  const commandHandlers = createCommandHandlers({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    workflowService,
    workflowRunner: {
      wake() {},
      getStats() {
        return undefined as never;
      },
    },
    codexClient: {
      request: createCodexRequestStub(),
    },
    errorTracker,
    getConversationKey,
    getWorkspaceKey,
  });
  const replies: string[] = [];
  const handler = createMessageCreateHandler({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    codexClient: {
      async ensureThread() {
        throw new Error("ensureThread should not be called for work stop");
      },
      async startTurn() {
        throw new Error("startTurn should not be called for work stop");
      },
    },
    commandHandlers,
    errorTracker,
    getBotUserId: () => "bot-1",
    log: () => {},
    errorLog: () => {},
  });

  await handler(
    createMessage({
      content: `<@bot-1> !codex work stop ${workflow.id}`,
      guildId: null,
      guild: null,
      inGuild: () => false,
      reply: async (content: string) => {
        replies.push(content);
        return undefined;
      },
    }),
  );

  assert.equal(workflowService.listConversationWorkflows("dm:channel-1").length, 1);
  assert.equal(workflowService.getWorkflow(workflow.id)?.status, "cancelled");
  assert.match(replies[0] ?? "", /Cancelled workflow/);
});

test("message router queues a mid-work note for the next workflow step", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "codex-router-"));
  const config = createConfig(workspace);
  const sessionStore = new SessionStore(config.sessionStorePath);
  const workflowStore = new WorkflowStore(path.join(workspace, ".data", "workflows.json"));
  await workflowStore.load();
  const conversationService = new ConversationService(sessionStore);
  const workflowService = new WorkflowService(workflowStore, {
    artifactsRoot: path.join(workspace, ".data", "workflows"),
  });
  const workspaceService = new WorkspaceService(sessionStore, config);
  const restartCoordinator = new RestartCoordinator({ exitProcess: () => {} });
  const errorTracker = new ErrorTracker();
  const workflow = await workflowService.createWorkflow({
    conversationKey: "dm:channel-1",
    workspaceKey: "dm:channel-1",
    conversationKind: "dm",
    channelId: "channel-1",
    guildId: null,
    goal: "accept a note",
    cwd: workspace,
    model: "gpt-test",
    modelProvider: "openai",
    threadId: null,
    threadToolProfile: null,
    threadPolicy: "dedicated-workflow-thread",
  });

  let wakeCount = 0;
  const commandHandlers = createCommandHandlers({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    workflowService,
    workflowRunner: {
      wake() {
        wakeCount += 1;
      },
      getStats() {
        return undefined as never;
      },
    },
    codexClient: {
      request: createCodexRequestStub(),
    },
    errorTracker,
    getConversationKey,
    getWorkspaceKey,
  });
  const replies: string[] = [];
  const handler = createMessageCreateHandler({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    codexClient: {
      async ensureThread() {
        throw new Error("ensureThread should not be called for work note");
      },
      async startTurn() {
        throw new Error("startTurn should not be called for work note");
      },
    },
    commandHandlers,
    errorTracker,
    getBotUserId: () => "bot-1",
    log: () => {},
    errorLog: () => {},
  });

  await handler(
    createMessage({
      content: `<@bot-1> !codex work note ${workflow.id} Prioritize the supplementary appendix.`,
      guildId: null,
      guild: null,
      inGuild: () => false,
      reply: async (content: string) => {
        replies.push(content);
        return undefined;
      },
    }),
  );

  const updated = workflowService.getWorkflow(workflow.id);
  assert.deepEqual(updated?.pendingPrompts, ["Prioritize the supplementary appendix."]);
  assert.equal(wakeCount, 1);
  assert.match(replies[0] ?? "", /Queued a workflow note/);
});

test("message router lets admins retry a failed workflow with thread policy overrides", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "codex-router-"));
  const config = createConfig(workspace);
  config.restartAdminUserIds = ["admin-1"];
  const sessionStore = new SessionStore(config.sessionStorePath);
  await sessionStore.set("dm:channel-1", { threadId: "thread-foreground" });
  const workflowStore = new WorkflowStore(path.join(workspace, ".data", "workflows.json"));
  await workflowStore.load();
  const conversationService = new ConversationService(sessionStore);
  const workflowService = new WorkflowService(workflowStore, {
    artifactsRoot: path.join(workspace, ".data", "workflows"),
    maxFailures: 1,
  });
  const workspaceService = new WorkspaceService(sessionStore, config);
  const restartCoordinator = new RestartCoordinator({ exitProcess: () => {} });
  const errorTracker = new ErrorTracker();
  const workflow = await workflowService.createWorkflow({
    conversationKey: "dm:channel-1",
    workspaceKey: "dm:channel-1",
    conversationKind: "dm",
    channelId: "channel-1",
    guildId: null,
    goal: "retry a failed workflow",
    cwd: workspace,
    model: "gpt-test",
    modelProvider: "ollama",
    threadId: "thread-old",
    threadToolProfile: "ollama-research-tools-v2",
    threadPolicy: "dedicated-workflow-thread",
  });
  await workflowService.markFailed(workflow.id, { error: "boom" });

  let wakeCount = 0;
  const commandHandlers = createCommandHandlers({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    workflowService,
    workflowRunner: {
      wake() {
        wakeCount += 1;
      },
      getStats() {
        return undefined as never;
      },
    },
    codexClient: {
      request: createCodexRequestStub(),
    },
    errorTracker,
    getConversationKey,
    getWorkspaceKey,
  });
  const replies: string[] = [];
  const handler = createMessageCreateHandler({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    codexClient: {
      async ensureThread() {
        throw new Error("ensureThread should not be called for work command");
      },
      async startTurn() {
        throw new Error("startTurn should not be called for work command");
      },
    },
    commandHandlers,
    errorTracker,
    getBotUserId: () => "bot-1",
    log: () => {},
    errorLog: () => {},
  });

  await handler(
    createMessage({
      authorId: "admin-1",
      content: `<@bot-1> !codex work retry ${workflow.id} 15 reuse-thread`,
      guildId: null,
      guild: null,
      inGuild: () => false,
      reply: async (content: string) => {
        replies.push(content);
        return undefined;
      },
    }),
  );

  const retried = workflowService.getWorkflow(workflow.id);
  assert.equal(retried?.status, "waiting");
  assert.equal(retried?.failureCount, 0);
  assert.equal(retried?.threadPolicy, "reuse-conversation-thread");
  assert.equal(retried?.threadId, "thread-foreground");
  assert.equal(wakeCount, 1);
  assert.match(replies[0] ?? "", /Retried workflow/);
});

test("message router shows the workflow dashboard for admins", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "codex-router-"));
  const config = createConfig(workspace);
  config.restartAdminUserIds = ["admin-1"];
  const sessionStore = new SessionStore(config.sessionStorePath);
  const workflowStore = new WorkflowStore(path.join(workspace, ".data", "workflows.json"));
  await workflowStore.load();
  const conversationService = new ConversationService(sessionStore);
  const workflowService = new WorkflowService(workflowStore, {
    artifactsRoot: path.join(workspace, ".data", "workflows"),
    maxFailures: 1,
  });
  const workspaceService = new WorkspaceService(sessionStore, config);
  const restartCoordinator = new RestartCoordinator({ exitProcess: () => {} });
  const errorTracker = new ErrorTracker();
  const overdueWorkflow = await workflowService.createWorkflow({
    conversationKey: "dm:channel-1",
    workspaceKey: "dm:channel-1",
    conversationKind: "dm",
    channelId: "channel-1",
    guildId: null,
    goal: "overdue workflow",
    cwd: workspace,
    model: "gpt-test",
    modelProvider: "ollama",
    threadId: null,
    threadToolProfile: null,
    threadPolicy: "dedicated-workflow-thread",
  });
  await workflowService.markWaiting(overdueWorkflow.id, {
    nextRunAt: new Date(Date.now() - 30_000),
    handoffSummary: "still waiting",
    clearError: true,
  });
  const failedWorkflow = await workflowService.createWorkflow({
    conversationKey: "dm:channel-1",
    workspaceKey: "dm:channel-1",
    conversationKind: "dm",
    channelId: "channel-1",
    guildId: null,
    goal: "failed workflow",
    cwd: workspace,
    model: "gpt-test",
    modelProvider: "ollama",
    threadId: null,
    threadToolProfile: null,
    threadPolicy: "dedicated-workflow-thread",
  });
  await workflowService.markFailed(failedWorkflow.id, { error: "broken" });

  const commandHandlers = createCommandHandlers({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    workflowService,
    workflowRunner: {
      wake() {},
      getStats() {
        return undefined as never;
      },
    },
    codexClient: {
      request: createCodexRequestStub(),
    },
    errorTracker,
    getConversationKey,
    getWorkspaceKey,
  });
  const replies: string[] = [];
  const handler = createMessageCreateHandler({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    codexClient: {
      async ensureThread() {
        throw new Error("ensureThread should not be called for work dashboard");
      },
      async startTurn() {
        throw new Error("startTurn should not be called for work dashboard");
      },
    },
    commandHandlers,
    errorTracker,
    getBotUserId: () => "bot-1",
    log: () => {},
    errorLog: () => {},
  });

  await handler(
    createMessage({
      authorId: "admin-1",
      content: "<@bot-1> !codex work dashboard",
      guildId: null,
      guild: null,
      inGuild: () => false,
      reply: async (content: string) => {
        replies.push(content);
        return undefined;
      },
    }),
  );

  assert.match(replies[0] ?? "", /activity trends:/);
  assert.match(replies[0] ?? "", /operational snapshot: overdue=/);
  assert.match(replies[0] ?? "", /status counts: queued=/);
  assert.match(replies[0] ?? "", /top providers:/);
  assert.match(replies[0] ?? "", /workspace hotspots:/);
  assert.match(replies[0] ?? "", /conversation hotspots:/);
  assert.match(replies[0] ?? "", /overdue waiting:/);
});

test("message router lists models through the models command", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "codex-router-"));
  const config = createConfig(workspace);
  const sessionStore = new SessionStore(config.sessionStorePath);
  const conversationService = new ConversationService(sessionStore);
  const workspaceService = new WorkspaceService(sessionStore, config);
  const restartCoordinator = new RestartCoordinator({ exitProcess: () => {} });
  const errorTracker = new ErrorTracker();
  const replies: string[] = [];
  const commandHandlers = createCommandHandlers({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    codexClient: {
      request: createCodexRequestStub(),
    },
    errorTracker,
    getConversationKey,
    getWorkspaceKey,
  });
  const handler = createMessageCreateHandler({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    codexClient: {
      async ensureThread() {
        throw new Error("ensureThread should not be called for model listing");
      },
      async startTurn() {
        throw new Error("startTurn should not be called for model listing");
      },
    },
    commandHandlers,
    errorTracker,
    getBotUserId: () => "bot-1",
    log: () => {},
    errorLog: () => {},
  });

  await handler(
    createMessage({
      content: "<@bot-1> !codex models",
      reply: async (content: string) => {
        replies.push(content);
        return undefined;
      },
    }),
  );

  assert.equal(replies.length, 1);
  assert.match(replies[0] ?? "", /Available models:/);
  assert.match(replies[0] ?? "", /GPT OSS 120B `gpt-oss:120b`/);
});

test("message router lists providers through the providers command", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "codex-router-"));
  const config = createConfig(workspace);
  const sessionStore = new SessionStore(config.sessionStorePath);
  await sessionStore.setWorkspaceModelProvider("channel:guild-1:channel-1", "custom_provider");
  const conversationService = new ConversationService(sessionStore);
  const workspaceService = new WorkspaceService(sessionStore, config);
  const restartCoordinator = new RestartCoordinator({ exitProcess: () => {} });
  const errorTracker = new ErrorTracker();
  const replies: string[] = [];
  const commandHandlers = createCommandHandlers({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    codexClient: {
      request: createCodexRequestStub(),
    },
    errorTracker,
    getConversationKey,
    getWorkspaceKey,
  });
  const handler = createMessageCreateHandler({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    codexClient: {
      async ensureThread() {
        throw new Error("ensureThread should not be called for provider listing");
      },
      async startTurn() {
        throw new Error("startTurn should not be called for provider listing");
      },
    },
    commandHandlers,
    errorTracker,
    getBotUserId: () => "bot-1",
    log: () => {},
    errorLog: () => {},
  });

  await handler(
    createMessage({
      content: "<@bot-1> !codex providers",
      reply: async (content: string) => {
        replies.push(content);
        return undefined;
      },
    }),
  );

  assert.equal(replies.length, 1);
  assert.match(replies[0] ?? "", /Available providers:/);
  assert.match(replies[0] ?? "", /openai \[built-in\]/);
  assert.match(replies[0] ?? "", /ollama \[config override\]/);
  assert.match(replies[0] ?? "", /lmstudio \[built-in\]/);
  assert.match(replies[0] ?? "", /custom_provider \[selected\] \[custom\]/);
  assert.doesNotMatch(replies[0] ?? "", /7697a44cee054c0eb8f7094ac46da884/);
});

test("message router loads Ollama model tags for !codex model when provider is ollama", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "codex-router-"));
  const config = createConfig(workspace);
  const sessionStore = new SessionStore(config.sessionStorePath);
  await sessionStore.setWorkspaceModelProvider("channel:guild-1:channel-1", "ollama");
  const conversationService = new ConversationService(sessionStore);
  const workspaceService = new WorkspaceService(sessionStore, config);
  const restartCoordinator = new RestartCoordinator({ exitProcess: () => {} });
  const errorTracker = new ErrorTracker();
  const replies: string[] = [];
  const commandHandlers = createCommandHandlers({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    codexClient: {
      request: createCodexRequestStub(),
    },
    errorTracker,
    getConversationKey,
    getWorkspaceKey,
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    ({
      ok: true,
      json: async () => ({
        models: [{ name: "gpt-oss:20b" }, { name: "gpt-oss:120b-cloud" }],
      }),
    }) as Response) as typeof fetch;

  try {
    const handler = createMessageCreateHandler({
      config,
      conversationService,
      restartCoordinator,
      workspaceService,
      codexClient: {
        async ensureThread() {
          throw new Error("ensureThread should not be called for model status");
        },
        async startTurn() {
          throw new Error("startTurn should not be called for model status");
        },
      },
      commandHandlers,
      errorTracker,
      getBotUserId: () => "bot-1",
      log: () => {},
      errorLog: () => {},
    });

    await handler(
      createMessage({
        content: "<@bot-1> !codex model",
        reply: async (content: string) => {
          replies.push(content);
          return undefined;
        },
      }),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(replies.length, 1);
  assert.match(replies[0] ?? "", /selected provider: `ollama`/);
  assert.match(replies[0] ?? "", /ollama models:/);
  assert.match(replies[0] ?? "", /gpt-oss:20b/);
  assert.match(replies[0] ?? "", /gpt-oss:120b-cloud/);
});

test("message router keeps the bound session when only the model changes", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "codex-router-"));
  const config = createConfig(workspace);
  const sessionStore = new SessionStore(config.sessionStorePath);
  const conversationService = new ConversationService(sessionStore);
  await conversationService.saveThread("dm:user-1", "thread-123");
  const workspaceService = new WorkspaceService(sessionStore, config);
  const restartCoordinator = new RestartCoordinator({ exitProcess: () => {} });
  const errorTracker = new ErrorTracker();
  const replies: string[] = [];
  const commandHandlers = createCommandHandlers({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    codexClient: {
      request: createCodexRequestStub(),
    },
    errorTracker,
    getConversationKey,
    getWorkspaceKey,
  });
  const handler = createMessageCreateHandler({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    codexClient: {
      async ensureThread() {
        throw new Error("ensureThread should not be called for model selection");
      },
      async startTurn() {
        throw new Error("startTurn should not be called for model selection");
      },
    },
    commandHandlers,
    errorTracker,
    getBotUserId: () => "bot-1",
    log: () => {},
    errorLog: () => {},
  });

  await handler(
    createMessage({
      content: "<@bot-1> !codex model qwen3.5:397b-cloud",
      channelId: "user-1",
      guildId: null,
      guild: null,
      inGuild: () => false,
      reply: async (content: string) => {
        replies.push(content);
        return undefined;
      },
    }),
  );

  assert.deepEqual(conversationService.getSession("dm:user-1"), { threadId: "thread-123" });
  assert.doesNotMatch(replies[0] ?? "", /Session reset\. The next message starts a new Codex thread\./);
});

test("message router resets the bound session when the provider changes", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "codex-router-"));
  const config = createConfig(workspace);
  const sessionStore = new SessionStore(config.sessionStorePath);
  const conversationService = new ConversationService(sessionStore);
  await conversationService.saveThread("dm:user-1", "thread-123");
  const workspaceService = new WorkspaceService(sessionStore, config);
  const restartCoordinator = new RestartCoordinator({ exitProcess: () => {} });
  const errorTracker = new ErrorTracker();
  const replies: string[] = [];
  const commandHandlers = createCommandHandlers({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    codexClient: {
      request: createCodexRequestStub(),
    },
    errorTracker,
    getConversationKey,
    getWorkspaceKey,
  });
  const handler = createMessageCreateHandler({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    codexClient: {
      async ensureThread() {
        throw new Error("ensureThread should not be called for provider selection");
      },
      async startTurn() {
        throw new Error("startTurn should not be called for provider selection");
      },
    },
    commandHandlers,
    errorTracker,
    getBotUserId: () => "bot-1",
    log: () => {},
    errorLog: () => {},
  });

  await handler(
    createMessage({
      content: "<@bot-1> !codex provider ollama gpt-oss:120b-cloud",
      channelId: "user-1",
      guildId: null,
      guild: null,
      inGuild: () => false,
      reply: async (content: string) => {
        replies.push(content);
        return undefined;
      },
    }),
  );

  assert.equal(conversationService.getSession("dm:user-1"), null);
  assert.match(replies[0] ?? "", /Session reset\. The next message starts a new Codex thread\./);
});

test("message router clears the selected model when the provider changes without an explicit model", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "codex-router-"));
  const config = createConfig(workspace);
  const sessionStore = new SessionStore(config.sessionStorePath);
  await sessionStore.setWorkspaceModel("dm:user-1", "qwen3.5:397b-cloud");
  const conversationService = new ConversationService(sessionStore);
  await conversationService.saveThread("dm:user-1", "thread-123");
  const workspaceService = new WorkspaceService(sessionStore, config);
  const restartCoordinator = new RestartCoordinator({ exitProcess: () => {} });
  const errorTracker = new ErrorTracker();
  const replies: string[] = [];
  const commandHandlers = createCommandHandlers({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    codexClient: {
      request: createCodexRequestStub(),
    },
    errorTracker,
    getConversationKey,
    getWorkspaceKey,
  });
  const handler = createMessageCreateHandler({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    codexClient: {
      async ensureThread() {
        throw new Error("ensureThread should not be called for provider selection");
      },
      async startTurn() {
        throw new Error("startTurn should not be called for provider selection");
      },
    },
    commandHandlers,
    errorTracker,
    getBotUserId: () => "bot-1",
    log: () => {},
    errorLog: () => {},
  });

  await handler(
    createMessage({
      content: "<@bot-1> !codex provider ollama",
      channelId: "user-1",
      guildId: null,
      guild: null,
      inGuild: () => false,
      reply: async (content: string) => {
        replies.push(content);
        return undefined;
      },
    }),
  );

  assert.equal(workspaceService.getModelOverride("dm:user-1"), null);
  assert.equal(workspaceService.getModel("dm:user-1"), "gpt-test");
  assert.equal(workspaceService.getModelProvider("dm:user-1"), "ollama");
  assert.match(replies[0] ?? "", /selected model: `gpt-test`/);
  assert.match(replies[0] ?? "", /Session reset\. The next message starts a new Codex thread\./);
});

test("message router loads Ollama model tags for !codex models when provider is ollama", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "codex-router-"));
  const config = createConfig(workspace);
  const sessionStore = new SessionStore(config.sessionStorePath);
  await sessionStore.setWorkspaceModelProvider("channel:guild-1:channel-1", "ollama");
  const conversationService = new ConversationService(sessionStore);
  const workspaceService = new WorkspaceService(sessionStore, config);
  const restartCoordinator = new RestartCoordinator({ exitProcess: () => {} });
  const errorTracker = new ErrorTracker();
  const replies: string[] = [];
  const commandHandlers = createCommandHandlers({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    codexClient: {
      request: createCodexRequestStub(),
    },
    errorTracker,
    getConversationKey,
    getWorkspaceKey,
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    ({
      ok: true,
      json: async () => ({
        models: [{ name: "gpt-oss:20b" }, { name: "gpt-oss:120b-cloud" }],
      }),
    }) as Response) as typeof fetch;

  try {
    const handler = createMessageCreateHandler({
      config,
      conversationService,
      restartCoordinator,
      workspaceService,
      codexClient: {
        async ensureThread() {
          throw new Error("ensureThread should not be called for models listing");
        },
        async startTurn() {
          throw new Error("startTurn should not be called for models listing");
        },
      },
      commandHandlers,
      errorTracker,
      getBotUserId: () => "bot-1",
      log: () => {},
      errorLog: () => {},
    });

    await handler(
      createMessage({
        content: "<@bot-1> !codex models",
        reply: async (content: string) => {
          replies.push(content);
          return undefined;
        },
      }),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(replies.length, 1);
  assert.match(replies[0] ?? "", /Available models:/);
  assert.match(replies[0] ?? "", /GPT OSS 120B `gpt-oss:120b`/);
  assert.match(replies[0] ?? "", /Ollama models:/);
  assert.match(replies[0] ?? "", /gpt-oss:20b/);
  assert.match(replies[0] ?? "", /gpt-oss:120b-cloud/);
});

test("message router resolves workspace and runs a Codex turn for chat messages", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "codex-router-"));
  await fs.mkdir(path.join(workspace, "project"));
  const config = createConfig(workspace);
  const sessionStore = new SessionStore(config.sessionStorePath);
  await sessionStore.setWorkspace("channel:guild-1:channel-1", path.join(workspace, "project"));
  const conversationService = new ConversationService(sessionStore);
  const workspaceService = new WorkspaceService(sessionStore, config);
  const restartCoordinator = new RestartCoordinator({ exitProcess: () => {} });
  const errorTracker = new ErrorTracker();
  const commandHandlers = createCommandHandlers({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    codexClient: {
      request: createCodexRequestStub(),
    },
    errorTracker,
    getConversationKey,
    getWorkspaceKey,
  });
  const calls: Array<{ threadId: string; inputs: CodexUserInput[]; cwd: string }> = [];
  const handler = createMessageCreateHandler({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    codexClient: {
      async ensureThread() {
        return "thread-123";
      },
      async startTurn() {
        throw new Error("startTurn should be stubbed by runTurn");
      },
    },
    commandHandlers,
    errorTracker,
    getBotUserId: () => "bot-1",
    runTurn: async (options) => {
      calls.push({
        threadId: options.threadId,
        inputs: options.inputs,
        cwd: options.cwd,
      });
    },
    log: () => {},
    errorLog: () => {},
  });

  const message = createMessage({
    content: "<@bot-1> summarize this repo",
  });

  await handler(message);

  assert.deepEqual(calls, [
    {
      threadId: "thread-123",
      inputs: [
        {
          type: "text",
          text:
            "[Discord runtime context]\n" +
            "channel_id: channel-1\n" +
            "guild_id: guild-1\n" +
            "conversation_kind: channel\n" +
            "If the MCP tools `send_discord_image` or `send_discord_file` are available and the user asks you to send an image or file into Discord, use them with the current channel_id instead of only mentioning the file path in text.\n" +
            "[/Discord runtime context]\n\n" +
            "summarize this repo",
        },
      ],
      cwd: path.join(workspace, "project"),
    },
  ]);
  assert.equal(sessionStore.get(getConversationKey(message))?.threadId, "thread-123");
});

test("message router expands local file references before starting a turn", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "codex-router-"));
  const projectDir = path.join(workspace, "project");
  const notePath = path.join(projectDir, "auth-example.txt");
  await fs.mkdir(projectDir);
  await fs.writeFile(notePath, "token auth example\n", "utf8");
  const config = createConfig(workspace);
  const sessionStore = new SessionStore(config.sessionStorePath);
  await sessionStore.setWorkspace("channel:guild-1:channel-1", projectDir);
  const conversationService = new ConversationService(sessionStore);
  const workspaceService = new WorkspaceService(sessionStore, config);
  const restartCoordinator = new RestartCoordinator({ exitProcess: () => {} });
  const errorTracker = new ErrorTracker();
  const commandHandlers = createCommandHandlers({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    codexClient: {
      request: createCodexRequestStub(),
    },
    errorTracker,
    getConversationKey,
    getWorkspaceKey,
  });
  const calls: Array<{ inputs: CodexUserInput[] }> = [];
  const handler = createMessageCreateHandler({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    codexClient: {
      async ensureThread() {
        return "thread-123";
      },
      async startTurn() {
        throw new Error("startTurn should be stubbed by runTurn");
      },
    },
    commandHandlers,
    errorTracker,
    getBotUserId: () => "bot-1",
    runTurn: async (options) => {
      calls.push({ inputs: options.inputs });
    },
    log: () => {},
    errorLog: () => {},
  });

  await handler(
    createMessage({
      content: "<@bot-1> inspect [[local:auth-example.txt]]",
    }),
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.inputs[0]?.type, "text");
  assert.match(calls[0]?.inputs[0]?.text ?? "", /\[Local file: .*auth-example\.txt\]/);
  assert.match(calls[0]?.inputs[0]?.text ?? "", /token auth example/);
});

test("message router passes selected model and provider overrides to Codex thread and turn startup", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "codex-router-"));
  const config = createConfig(workspace);
  const sessionStore = new SessionStore(config.sessionStorePath);
  await sessionStore.setWorkspaceModel("channel:guild-1:channel-1", "gpt-oss:120b");
  await sessionStore.setWorkspaceModelProvider("channel:guild-1:channel-1", "ollama");
  const conversationService = new ConversationService(sessionStore);
  const workspaceService = new WorkspaceService(sessionStore, config);
  const restartCoordinator = new RestartCoordinator({ exitProcess: () => {} });
  const errorTracker = new ErrorTracker();
  const commandHandlers = createCommandHandlers({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    codexClient: {
      request: createCodexRequestStub(),
    },
    errorTracker,
    getConversationKey,
    getWorkspaceKey,
  });
  const ensureThreadCalls: Array<{ model?: string; modelProvider?: string }> = [];
  const runTurnCalls: Array<{ model?: string }> = [];
  const handler = createMessageCreateHandler({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    codexClient: {
      async ensureThread(metadata) {
        ensureThreadCalls.push({
          model: metadata?.model,
          modelProvider: metadata?.modelProvider,
        });
        return "thread-123";
      },
      async startTurn() {
        throw new Error("startTurn should be stubbed by runTurn");
      },
    },
    commandHandlers,
    errorTracker,
    getBotUserId: () => "bot-1",
    runTurn: async (options) => {
      runTurnCalls.push({ model: options.model });
    },
    log: () => {},
    errorLog: () => {},
  });

  await handler(
    createMessage({
      content: "<@bot-1> use the selected model",
    }),
  );

  assert.deepEqual(ensureThreadCalls, [{ model: "gpt-oss:120b", modelProvider: "ollama" }]);
  assert.deepEqual(runTurnCalls, [{ model: "gpt-oss:120b" }]);
});

test("message router downloads Discord attachments into /tmp and injects text attachments", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "codex-router-"));
  const config = createConfig(workspace);
  const sessionStore = new SessionStore(config.sessionStorePath);
  const conversationService = new ConversationService(sessionStore);
  const workspaceService = new WorkspaceService(sessionStore, config);
  const restartCoordinator = new RestartCoordinator({ exitProcess: () => {} });
  const errorTracker = new ErrorTracker();
  const commandHandlers = createCommandHandlers({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    codexClient: {
      request: createCodexRequestStub(),
    },
    errorTracker,
    getConversationKey,
    getWorkspaceKey,
  });
  const calls: Array<{ inputs: CodexUserInput[] }> = [];
  const handler = createMessageCreateHandler({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    codexClient: {
      async ensureThread() {
        return "thread-123";
      },
      async startTurn() {
        throw new Error("startTurn should be stubbed by runTurn");
      },
    },
    commandHandlers,
    errorTracker,
    getBotUserId: () => "bot-1",
    runTurn: async (options) => {
      calls.push({ inputs: options.inputs });
    },
    log: () => {},
    errorLog: () => {},
  });
  const attachmentBody = "token auth example\n";
  const attachmentUrl = `data:text/plain;base64,${Buffer.from(attachmentBody).toString("base64")}`;

  await handler(
    createMessage({
      content: "<@bot-1> analyze this file",
      attachments: [
        {
          name: "auth-example.txt",
          url: attachmentUrl,
          contentType: "text/plain",
          size: attachmentBody.length,
        },
      ],
    }),
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.inputs.length, 1);
  assert.equal(calls[0]?.inputs[0]?.type, "text");
  assert.match(calls[0]?.inputs[0]?.text ?? "", /\[Downloaded Discord attachments\]/);
  assert.match(calls[0]?.inputs[0]?.text ?? "", /auth-example\.txt -> \/tmp\/codexbox-discord-/);
  assert.match(calls[0]?.inputs[0]?.text ?? "", /token auth example/);
});

test("message router accepts attachment-only messages and passes image attachments as localImage inputs", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "codex-router-"));
  const config = createConfig(workspace);
  const sessionStore = new SessionStore(config.sessionStorePath);
  const conversationService = new ConversationService(sessionStore);
  const workspaceService = new WorkspaceService(sessionStore, config);
  const restartCoordinator = new RestartCoordinator({ exitProcess: () => {} });
  const errorTracker = new ErrorTracker();
  const commandHandlers = createCommandHandlers({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    codexClient: {
      request: createCodexRequestStub(),
    },
    errorTracker,
    getConversationKey,
    getWorkspaceKey,
  });
  const calls: Array<{ inputs: CodexUserInput[] }> = [];
  const handler = createMessageCreateHandler({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    codexClient: {
      async ensureThread() {
        return "thread-123";
      },
      async startTurn() {
        throw new Error("startTurn should be stubbed by runTurn");
      },
    },
    commandHandlers,
    errorTracker,
    getBotUserId: () => "bot-1",
    runTurn: async (options) => {
      calls.push({ inputs: options.inputs });
    },
    log: () => {},
    errorLog: () => {},
  });
  const tinyPngBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5W6iUAAAAASUVORK5CYII=";

  await handler(
    createMessage({
      content: "<@bot-1>",
      attachments: [
        {
          name: "pixel.png",
          url: `data:image/png;base64,${tinyPngBase64}`,
          contentType: "image/png",
        },
      ],
    }),
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.inputs[0]?.type, "text");
  assert.match(
    calls[0]?.inputs[0]?.text ?? "",
    /The user attached files without additional text\. Inspect the downloaded attachments\./,
  );
  assert.equal(calls[0]?.inputs[1]?.type, "localImage");
  assert.match((calls[0]?.inputs[1] as { path?: string })?.path ?? "", /^\/tmp\/codexbox-discord-/);
});

test("message router rejects new work while restart is pending", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "codex-router-"));
  const config = createConfig(workspace);
  const sessionStore = new SessionStore(config.sessionStorePath);
  const conversationService = new ConversationService(sessionStore);
  const workspaceService = new WorkspaceService(sessionStore, config);
  const restartCoordinator = new RestartCoordinator({ exitProcess: () => {} });
  const errorTracker = new ErrorTracker();
  restartCoordinator.requestRestart();
  const commandHandlers = createCommandHandlers({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    codexClient: {
      request: createCodexRequestStub(),
    },
    errorTracker,
    getConversationKey,
    getWorkspaceKey,
  });
  const replies: string[] = [];
  const handler = createMessageCreateHandler({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    codexClient: {
      async ensureThread() {
        throw new Error("ensureThread should not be called while restart is pending");
      },
      async startTurn() {
        throw new Error("startTurn should not be called while restart is pending");
      },
    },
    commandHandlers,
    errorTracker,
    getBotUserId: () => "bot-1",
    log: () => {},
    errorLog: () => {},
  });

  await handler(
    createMessage({
      content: "<@bot-1> summarize this repo",
      reply: async (content: string) => {
        replies.push(content);
        return undefined;
      },
    }),
  );

  assert.deepEqual(replies, ["Restart requested. Not accepting new requests until shutdown completes."]);
});

test("message router ignores unauthorized users when allowlists are configured", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "codex-router-"));
  const config = createConfig(workspace);
  config.discordAllowedUserIds = ["trusted-user"];
  const sessionStore = new SessionStore(config.sessionStorePath);
  const conversationService = new ConversationService(sessionStore);
  const workspaceService = new WorkspaceService(sessionStore, config);
  const restartCoordinator = new RestartCoordinator({ exitProcess: () => {} });
  const errorTracker = new ErrorTracker();
  const commandHandlers = createCommandHandlers({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    codexClient: {
      request: createCodexRequestStub(),
    },
    errorTracker,
    getConversationKey,
    getWorkspaceKey,
  });
  let runTurnCalled = false;
  const replies: string[] = [];
  const handler = createMessageCreateHandler({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    codexClient: {
      async ensureThread() {
        throw new Error("ensureThread should not be called");
      },
      async startTurn() {
        throw new Error("startTurn should not be called");
      },
    },
    commandHandlers,
    errorTracker,
    getBotUserId: () => "bot-1",
    runTurn: async () => {
      runTurnCalled = true;
    },
    log: () => {},
    errorLog: () => {},
  });

  await handler(
    createMessage({
      content: "<@bot-1> summarize this repo",
      reply: async (content: string) => {
        replies.push(content);
        return undefined;
      },
    }),
  );

  assert.equal(runTurnCalled, false);
  assert.deepEqual(replies, []);
});

test("message router returns an error reference and logs detail", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "codex-router-"));
  const config = createConfig(workspace);
  const sessionStore = new SessionStore(config.sessionStorePath);
  const conversationService = new ConversationService(sessionStore);
  const workspaceService = new WorkspaceService(sessionStore, config);
  const restartCoordinator = new RestartCoordinator({ exitProcess: () => {} });
  const errorTracker = new ErrorTracker();
  const commandHandlers = createCommandHandlers({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    codexClient: {
      request: createCodexRequestStub(),
    },
    errorTracker,
    getConversationKey,
    getWorkspaceKey,
  });
  const replies: string[] = [];
  const errorLogs: string[] = [];
  const handler = createMessageCreateHandler({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    codexClient: {
      async ensureThread() {
        throw new Error("x".repeat(5000));
      },
      async startTurn() {
        throw new Error("startTurn should not be called");
      },
    },
    commandHandlers,
    errorTracker,
    getBotUserId: () => "bot-1",
    log: () => {},
    errorLog: (line: string) => {
      errorLogs.push(line);
    },
  });

  await handler(
    createMessage({
      content: "<@bot-1> summarize this repo",
      reply: async (content: string) => {
        replies.push(content);
        return undefined;
      },
    }),
  );

  assert.equal(replies.length, 1);
  assert.match(replies[0] ?? "", /^Codex bridge error\. Reference: `err-[^`]+`/);
  assert.ok((replies[0]?.length ?? 0) <= 1900);
  assert.equal(errorLogs.length, 1);
  assert.match(errorLogs[0] ?? "", /\[discord\]\[err-/);
  assert.match(errorLogs[0] ?? "", /x{50}/);
});

test("message router adds an Ollama cloud hint for 429 errors", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "codex-router-"));
  const config = createConfig(workspace);
  const sessionStore = new SessionStore(config.sessionStorePath);
  await sessionStore.setWorkspaceModelProvider("channel:guild-1:channel-1", "ollama");
  await sessionStore.setWorkspaceModel("channel:guild-1:channel-1", "qwen3.5:397b-cloud");
  const conversationService = new ConversationService(sessionStore);
  const workspaceService = new WorkspaceService(sessionStore, config);
  const restartCoordinator = new RestartCoordinator({ exitProcess: () => {} });
  const errorTracker = new ErrorTracker();
  const commandHandlers = createCommandHandlers({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    codexClient: {
      request: createCodexRequestStub(),
    },
    errorTracker,
    getConversationKey,
    getWorkspaceKey,
  });
  const replies: string[] = [];
  const handler = createMessageCreateHandler({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    codexClient: {
      async ensureThread() {
        throw new Error("exceeded retry limit, last status: 429 Too Many Requests");
      },
      async startTurn() {
        throw new Error("startTurn should not be called");
      },
    },
    commandHandlers,
    errorTracker,
    getBotUserId: () => "bot-1",
    log: () => {},
    errorLog: () => {},
  });

  await handler(
    createMessage({
      content: "<@bot-1> hi",
      reply: async (content: string) => {
        replies.push(content);
        return undefined;
      },
    }),
  );

  assert.equal(replies.length, 1);
  assert.match(replies[0] ?? "", /429 Too Many Requests/);
  assert.match(replies[0] ?? "", /selected model `qwen3\.5:397b-cloud` is cloud-backed/);
  assert.match(replies[0] ?? "", /Use `!codex model` to switch to a local Ollama model/);
});

test("workspace command updates CODEX_WORKSPACE in the env file for admins", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "codex-router-"));
  const nextWorkspace = path.join(workspace, "next");
  await fs.mkdir(nextWorkspace);
  const config = createConfig(workspace);
  config.restartAdminUserIds = ["user-1"];
  await fs.writeFile(config.envFilePath, "DISCORD_TOKEN=test\nCODEX_WORKSPACE=.\n", "utf8");
  const sessionStore = new SessionStore(config.sessionStorePath);
  const conversationService = new ConversationService(sessionStore);
  const workspaceService = new WorkspaceService(sessionStore, config);
  const restartCoordinator = new RestartCoordinator({ exitProcess: () => {} });
  const errorTracker = new ErrorTracker();
  const commandHandlers = createCommandHandlers({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    codexClient: {
      request: createCodexRequestStub(),
    },
    errorTracker,
    getConversationKey,
    getWorkspaceKey,
  });
  const replies: string[] = [];
  const handler = createMessageCreateHandler({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    codexClient: {
      async ensureThread() {
        throw new Error("ensureThread should not be called for commands");
      },
      async startTurn() {
        throw new Error("startTurn should not be called for commands");
      },
    },
    commandHandlers,
    errorTracker,
    getBotUserId: () => "bot-1",
    log: () => {},
    errorLog: () => {},
  });

  await handler(
    createMessage({
      content: `<@bot-1> !codex workspace ${path.basename(nextWorkspace)}`,
      reply: async (content: string) => {
        replies.push(content);
        return undefined;
      },
    }),
  );

  const envContent = await fs.readFile(config.envFilePath, "utf8");
  assert.match(envContent, new RegExp(`^CODEX_WORKSPACE=${path.basename(nextWorkspace)}$`, "m"));
  assert.equal(
    replies[0],
    `Saved startup workspace as \`${nextWorkspace}\`.\nRestart required. Current runtime workspace remains \`${workspace}\` until the bot restarts.`,
  );
});

test("message router auto reply mode handles plain channel messages without mention", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "codex-router-"));
  const config = createConfig(workspace);
  const sessionStore = new SessionStore(config.sessionStorePath);
  await sessionStore.setWorkspaceReplyMode("channel:guild-1:channel-1", "auto");
  const conversationService = new ConversationService(sessionStore);
  const workspaceService = new WorkspaceService(sessionStore, config);
  const restartCoordinator = new RestartCoordinator({ exitProcess: () => {} });
  const errorTracker = new ErrorTracker();
  const commandHandlers = createCommandHandlers({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    codexClient: {
      request: createCodexRequestStub(),
    },
    errorTracker,
    getConversationKey,
    getWorkspaceKey,
  });
  const calls: Array<{ threadId: string; inputs: CodexUserInput[] }> = [];
  const handler = createMessageCreateHandler({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    codexClient: {
      async ensureThread() {
        return "thread-123";
      },
      async startTurn() {
        throw new Error("startTurn should be stubbed by runTurn");
      },
    },
    commandHandlers,
    errorTracker,
    getBotUserId: () => "bot-1",
    runTurn: async (options) => {
      calls.push({
        threadId: options.threadId,
        inputs: options.inputs,
      });
    },
    log: () => {},
    errorLog: () => {},
  });

  await handler(
    createMessage({
      content: "plain message without mention",
      mentioned: false,
    }),
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.inputs[0]?.type, "text");
  assert.match(calls[0]?.inputs[0]?.text ?? "", /plain message without mention$/);
});

test("message router ignores bot-authored messages even in auto reply mode", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "codex-router-"));
  const config = createConfig(workspace);
  const sessionStore = new SessionStore(config.sessionStorePath);
  await sessionStore.setWorkspaceReplyMode("channel:guild-1:channel-1", "auto");
  const conversationService = new ConversationService(sessionStore);
  const workspaceService = new WorkspaceService(sessionStore, config);
  const restartCoordinator = new RestartCoordinator({ exitProcess: () => {} });
  const errorTracker = new ErrorTracker();
  const commandHandlers = createCommandHandlers({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    codexClient: {
      request: createCodexRequestStub(),
    },
    errorTracker,
    getConversationKey,
    getWorkspaceKey,
  });
  let runTurnCalled = false;
  const handler = createMessageCreateHandler({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    codexClient: {
      async ensureThread() {
        throw new Error("ensureThread should not be called for bot-authored messages");
      },
      async startTurn() {
        throw new Error("startTurn should not be called for bot-authored messages");
      },
    },
    commandHandlers,
    errorTracker,
    getBotUserId: () => "bot-1",
    runTurn: async () => {
      runTurnCalled = true;
    },
    log: () => {},
    errorLog: () => {},
  });

  await handler(
    createMessage({
      content: "plain message from another bot",
      mentioned: false,
      authorBot: true,
      authorId: "other-bot",
      authorUsername: "helperbot",
      authorTag: "helperbot#0001",
    }),
  );

  assert.equal(runTurnCalled, false);
});

test("message router starts a new thread when ollama needs a web-search-capable session", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "codex-router-"));
  const config = createConfig(workspace);
  const sessionStore = new SessionStore(config.sessionStorePath);
  await sessionStore.setWorkspaceModelProvider("channel:guild-1:channel-1", "ollama");
  await sessionStore.set("channel:guild-1:channel-1", { threadId: "thread-legacy" });
  const conversationService = new ConversationService(sessionStore);
  const workspaceService = new WorkspaceService(sessionStore, config);
  const restartCoordinator = new RestartCoordinator({ exitProcess: () => {} });
  const errorTracker = new ErrorTracker();
  const commandHandlers = createCommandHandlers({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    codexClient: {
      request: createCodexRequestStub(),
    },
    errorTracker,
    getConversationKey,
    getWorkspaceKey,
  });
  const ensureThreadMetadata: Array<Record<string, unknown> | undefined> = [];
  const handler = createMessageCreateHandler({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    codexClient: {
      async ensureThread(metadata) {
        ensureThreadMetadata.push(metadata as Record<string, unknown> | undefined);
        return "thread-ollama";
      },
      async startTurn() {
        throw new Error("startTurn should be stubbed by runTurn");
      },
    },
    commandHandlers,
    errorTracker,
    getBotUserId: () => "bot-1",
    runTurn: async () => {},
    log: () => {},
    errorLog: () => {},
  });

  await handler(createMessage());

  assert.equal(ensureThreadMetadata[0]?.threadId, undefined);
  assert.deepEqual(conversationService.getSession("channel:guild-1:channel-1"), {
    threadId: "thread-ollama",
    threadToolProfile: "ollama-research-tools-v2",
  });
});

test("message router reuses an ollama thread when the tool profile already matches", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "codex-router-"));
  const config = createConfig(workspace);
  const sessionStore = new SessionStore(config.sessionStorePath);
  await sessionStore.setWorkspaceModelProvider("channel:guild-1:channel-1", "ollama");
  await sessionStore.set("channel:guild-1:channel-1", {
    threadId: "thread-ollama",
    threadToolProfile: "ollama-research-tools-v2",
  });
  const conversationService = new ConversationService(sessionStore);
  const workspaceService = new WorkspaceService(sessionStore, config);
  const restartCoordinator = new RestartCoordinator({ exitProcess: () => {} });
  const errorTracker = new ErrorTracker();
  const commandHandlers = createCommandHandlers({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    codexClient: {
      request: createCodexRequestStub(),
    },
    errorTracker,
    getConversationKey,
    getWorkspaceKey,
  });
  const ensureThreadMetadata: Array<Record<string, unknown> | undefined> = [];
  const handler = createMessageCreateHandler({
    config,
    conversationService,
    restartCoordinator,
    workspaceService,
    codexClient: {
      async ensureThread(metadata) {
        ensureThreadMetadata.push(metadata as Record<string, unknown> | undefined);
        return "thread-ollama";
      },
      async startTurn() {
        throw new Error("startTurn should be stubbed by runTurn");
      },
    },
    commandHandlers,
    errorTracker,
    getBotUserId: () => "bot-1",
    runTurn: async () => {},
    log: () => {},
    errorLog: () => {},
  });

  await handler(createMessage());

  assert.equal(ensureThreadMetadata[0]?.threadId, "thread-ollama");
  assert.deepEqual(conversationService.getSession("channel:guild-1:channel-1"), {
    threadId: "thread-ollama",
    threadToolProfile: "ollama-research-tools-v2",
  });
});
