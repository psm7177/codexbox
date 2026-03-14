import type { Message } from "discord.js";
import type { Config } from "../config.js";
import type { ConversationService } from "../state/conversation-service.js";
import type { WorkspaceService } from "../state/workspace-service.js";

export interface ParsedCommand {
  name: string;
  args: string[];
}

export interface CommandContext {
  config: Config;
  conversationService: ConversationService;
  workspaceService: WorkspaceService;
  getConversationKey: (message: Message) => string;
  getWorkspaceKey: (message: Message) => string;
}

export type CommandHandler = (message: Message, args: string[]) => Promise<void>;
