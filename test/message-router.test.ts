import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { Message } from "discord.js";
import { createCommandHandlers } from "../src/commands.js";
import type { Config } from "../src/config.js";
import { getConversationKey, getWorkspaceKey } from "../src/discord-context.js";
import { ErrorTracker } from "../src/error-tracker.js";
import { RestartCoordinator } from "../src/lifecycle/restart-coordinator.js";
import { SessionStore } from "../src/session-store.js";
import { ConversationService } from "../src/state/conversation-service.js";
import { WorkspaceService } from "../src/state/workspace-service.js";
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
      personality: "pragmatic",
      approvalPolicy: "never",
      serviceName: "codexbox",
    },
    turnDefaults: {
      cwd: workspace,
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
  content?: string;
  reply?: (content: string) => Promise<unknown>;
  channel?: {
    id?: string;
    name?: string;
    parentId?: string | null;
    isThread?: () => boolean;
    isSendable?: () => boolean;
  };
  channelId?: string;
  guildId?: string | null;
  guild?: { name: string } | null;
  inGuild?: () => boolean;
}

function createMessage(options: TestMessageOptions = {}): Message {
  const reply = options?.reply ?? (async () => undefined);
  const channel = {
    id: "channel-1",
    name: "general",
    parentId: null,
    isThread: () => false,
    isSendable: () => true,
    ...options.channel,
  };
  const mentionsUsers = { has: () => true };
  const message = {
    content: "<@bot-1> hello",
    channelId: "channel-1",
    guildId: "guild-1",
    guild: { name: "Guild" },
    channel,
    author: {
      id: "user-1",
      bot: false,
      username: "alice",
      tag: "alice#0001",
    },
    mentions: {
      users: mentionsUsers,
      repliedUser: null,
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
  assert.equal(
    replies[0],
    "workspace: `" +
      config.codexWorkspace +
      "`\ncwd: `" +
      config.codexWorkspace +
      "`\naccess: `workspace-write`\nnetwork: `off`\nNo Codex session is mapped to this conversation yet.",
  );
});

test("message router resolves workspace and runs a Codex turn for chat messages", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "codex-router-"));
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
    errorTracker,
    getConversationKey,
    getWorkspaceKey,
  });
  const calls: Array<{ threadId: string; text: string; cwd: string }> = [];
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
        text: options.text,
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
      text:
        "[Discord runtime context]\n" +
        "channel_id: channel-1\n" +
        "guild_id: guild-1\n" +
        "conversation_kind: channel\n" +
        "If the MCP tool `send_discord_image` is available and the user asks you to send an image or file into Discord, use that tool with the current channel_id instead of only mentioning the file path in text.\n" +
        "[/Discord runtime context]\n\n" +
        "summarize this repo",
      cwd: path.join(workspace, "project"),
    },
  ]);
  assert.equal(sessionStore.get(getConversationKey(message))?.threadId, "thread-123");
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
