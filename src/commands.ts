import path from "node:path";
import type { Message } from "discord.js";
import type { Config } from "./config.js";
import type { SessionStore } from "./session-store.js";

export interface ParsedCommand {
  name: string;
  args: string[];
}

interface CommandContext {
  config: Config;
  sessionStore: SessionStore;
  getConversationKey: (message: Message) => string;
  getWorkspaceKey: (message: Message) => string;
}

type CommandHandler = (message: Message, args: string[]) => Promise<void>;

export function parseCommand(text: string): ParsedCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("!codex")) {
    return null;
  }

  const parts = trimmed.split(/\s+/);
  return {
    name: (parts[1] ?? "help").toLowerCase(),
    args: parts.slice(2),
  };
}

export function createCommandHandlers(context: CommandContext): Record<string, CommandHandler> {
  return {
    async help(message) {
      await message.reply(
        [
          "Available commands:",
          "`!codex help`",
          "`!codex status`",
          "`!codex cwd`",
          "`!codex cwd <path>`",
          "`!codex cwd reset`",
          "`!codex reset`",
          "`!codex restart`",
        ].join("\n"),
      );
    },

    async status(message) {
      const conversationKey = context.getConversationKey(message);
      const workspaceKey = context.getWorkspaceKey(message);
      const session = context.sessionStore.get(conversationKey);
      const cwd = context.sessionStore.getWorkspace(workspaceKey) ?? context.config.codexWorkspace;
      if (!session) {
        await message.reply(`cwd: \`${cwd}\`\nNo Codex session is mapped to this conversation yet.`);
        return;
      }

      await message.reply(`cwd: \`${cwd}\`\nMapped to Codex thread \`${session.threadId}\`.`);
    },

    async cwd(message, args) {
      const workspaceKey = context.getWorkspaceKey(message);
      const currentCwd = context.sessionStore.getWorkspace(workspaceKey) ?? context.config.codexWorkspace;
      if (args.length === 0) {
        await message.reply(`cwd: \`${currentCwd}\``);
        return;
      }

      if (args.length === 1 && args[0]?.toLowerCase() === "reset") {
        await context.sessionStore.deleteWorkspace(workspaceKey);
        await message.reply(`cwd reset to default: \`${context.config.codexWorkspace}\``);
        return;
      }

      const cwd = path.resolve(currentCwd, args.join(" "));
      await context.sessionStore.setWorkspace(workspaceKey, cwd);
      await message.reply(`cwd set to \`${cwd}\``);
    },

    async reset(message) {
      await context.sessionStore.delete(context.getConversationKey(message));
      await message.reply("Session reset. The next message starts a new Codex thread.");
    },

    async restart(message) {
      if (!context.config.restartAdminUserIds.includes(message.author.id)) {
        await message.reply("You are not allowed to restart this bot.");
        return;
      }

      await message.reply("Restarting...");
      setTimeout(() => process.exit(75), 500);
    },
  };
}
