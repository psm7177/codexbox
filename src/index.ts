import "dotenv/config";
import { Client, GatewayIntentBits, Partials } from "discord.js";
import { BackgroundWorkflowRunner } from "./background/background-workflow-runner.js";
import { createMessageCreateHandler } from "./chat/message-router.js";
import { CodexAppServerClient } from "./codex-app-server-client.js";
import { createCommandHandlers } from "./commands.js";
import { loadConfig } from "./config.js";
import { getConversationKey, getWorkspaceKey } from "./discord-context.js";
import { ErrorTracker } from "./error-tracker.js";
import { ActiveTurnRegistry } from "./lifecycle/active-turn-registry.js";
import { ConversationLockManager } from "./lifecycle/conversation-lock-manager.js";
import { RestartCoordinator } from "./lifecycle/restart-coordinator.js";
import { SessionStore } from "./session-store.js";
import { ConversationService } from "./state/conversation-service.js";
import { WorkflowService } from "./state/workflow-service.js";
import { WorkspaceService } from "./state/workspace-service.js";
import { createReadyHandler } from "./startup/ready-handler.js";
import { WorkflowStore } from "./workflow-store.js";

const config = loadConfig();
const restartCoordinator = new RestartCoordinator();
const activeTurnRegistry = new ActiveTurnRegistry();
const conversationLockManager = new ConversationLockManager();
const errorTracker = new ErrorTracker();

if (!config.discordToken) {
  throw new Error("DISCORD_TOKEN is required");
}

const intents = [
  GatewayIntentBits.DirectMessages,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.Guilds,
];

if (config.discordMessageContentIntent) {
  intents.push(GatewayIntentBits.MessageContent);
}

const discordClient = new Client({
  intents,
  partials: [Partials.Channel],
});

const codexClient = new CodexAppServerClient(config);
const sessionStore = new SessionStore(config.sessionStorePath);
const workflowStore = new WorkflowStore(config.workflowDefaults.storePath);
const conversationService = new ConversationService(sessionStore);
const workflowService = new WorkflowService(workflowStore, {
  artifactsRoot: config.workflowDefaults.artifactsPath,
  retryBaseDelayMs: config.workflowDefaults.retryBaseDelayMs,
  retryMaxDelayMs: config.workflowDefaults.retryMaxDelayMs,
  maxFailures: config.workflowDefaults.maxFailures,
});
const workspaceService = new WorkspaceService(sessionStore, config);
const workflowRunner = new BackgroundWorkflowRunner({
  discordClient,
  workflowService,
  conversationService,
  codexClient,
  conversationLockManager,
  activeTurnRegistry,
  intervalMs: config.workflowDefaults.pollIntervalMs,
  reuseConversationThread: config.workflowDefaults.reuseConversationThread,
  defaultSandboxMode: config.sandboxMode,
  defaultNetworkAccess: config.sandboxNetworkAccess,
});
const commandHandlers = createCommandHandlers({
  config,
  conversationService,
  restartCoordinator,
  activeTurnRegistry,
  workspaceService,
  workflowService,
  workflowRunner,
  codexClient,
  errorTracker,
  getConversationKey,
  getWorkspaceKey,
});

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

const handleMessageCreate = createMessageCreateHandler({
  config,
  conversationService,
  restartCoordinator,
  activeTurnRegistry,
  conversationLockManager,
  workspaceService,
  codexClient,
  commandHandlers,
  errorTracker,
  getBotUserId: () => discordClient.user?.id,
});

discordClient.once(
  "ready",
  createReadyHandler({
    discordClient,
    config,
    sessionStore,
    workflowStore,
    workflowService,
    codexClient,
    workflowRunner,
  }),
);

discordClient.on("messageCreate", async (message) => {
  await handleMessageCreate(message);
});

codexClient.on("log", (line: string) => {
  console.error(`[codex] ${line}`);
});

codexClient.on("exit", (error: Error) => {
  console.error(`[codex] app-server exited: ${error.message}`);
});

process.on("unhandledRejection", (reason) => {
  console.error(`[process] Unhandled rejection: ${getErrorMessage(reason)}`);
});

process.on("uncaughtException", (error) => {
  console.error(`[process] Uncaught exception: ${getErrorMessage(error)}`);
});

try {
  await discordClient.login(config.discordToken);
} catch (error) {
  if (getErrorMessage(error).includes("Used disallowed intents")) {
    console.error(
      "Discord rejected the configured gateway intents. Either enable Message Content Intent in the Discord developer portal or remove `DISCORD_MESSAGE_CONTENT_INTENT=true` from .env.",
    );
  }
  throw error;
}
