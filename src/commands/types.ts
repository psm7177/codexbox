import type { Message } from "discord.js";
import type { CodexAppServerClient } from "../codex-app-server-client.js";
import type { Config } from "../config.js";
import type { ErrorTracker } from "../error-tracker.js";
import type { ActiveTurnRegistry } from "../lifecycle/active-turn-registry.js";
import type { RestartCoordinator } from "../lifecycle/restart-coordinator.js";
import type { ConversationService } from "../state/conversation-service.js";
import type { WorkspaceService } from "../state/workspace-service.js";

export interface ParsedCommand {
  name: string;
  args: string[];
}

export interface CommandContext {
  config: Config;
  conversationService: ConversationService;
  restartCoordinator: RestartCoordinator;
  activeTurnRegistry?: ActiveTurnRegistry;
  workspaceService: WorkspaceService;
  codexClient: Pick<CodexAppServerClient, "request"> & Partial<Pick<CodexAppServerClient, "interruptTurn">>;
  errorTracker: ErrorTracker;
  getConversationKey: (message: Message) => string;
  getWorkspaceKey: (message: Message) => string;
}

export type CommandHandler = (message: Message, args: string[]) => Promise<void>;
