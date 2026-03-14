import path from "node:path";
import type { Message } from "discord.js";
import type { Config, SandboxMode } from "./config.js";
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

function formatNetworkAccess(enabled: boolean): string {
  return enabled ? "on" : "off";
}

function formatSandboxMode(mode: SandboxMode): string {
  if (mode === "dangerFullAccess") {
    return "full-access";
  }
  if (mode === "readOnly") {
    return "read-only";
  }
  return "workspace-write";
}

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
          "`!codex access`",
          "`!codex access workspace-write|read-only|full-access|reset`",
          "`!codex network`",
          "`!codex network on|off|reset`",
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
      const sandboxMode = context.sessionStore.getWorkspaceSandboxMode(workspaceKey) ?? context.config.sandboxMode;
      const networkAccess =
        context.sessionStore.getWorkspaceNetworkAccess(workspaceKey) ?? context.config.sandboxNetworkAccess;
      if (!session) {
        await message.reply(
          `cwd: \`${cwd}\`\naccess: \`${formatSandboxMode(sandboxMode)}\`\nnetwork: \`${formatNetworkAccess(networkAccess)}\`\nNo Codex session is mapped to this conversation yet.`,
        );
        return;
      }

      await message.reply(
        `cwd: \`${cwd}\`\naccess: \`${formatSandboxMode(sandboxMode)}\`\nnetwork: \`${formatNetworkAccess(networkAccess)}\`\nMapped to Codex thread \`${session.threadId}\`.`,
      );
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

    async access(message, args) {
      const workspaceKey = context.getWorkspaceKey(message);
      const current = context.sessionStore.getWorkspaceSandboxMode(workspaceKey) ?? context.config.sandboxMode;
      if (args.length === 0) {
        await message.reply(`access: \`${formatSandboxMode(current)}\``);
        return;
      }

      const mode = args[0]?.toLowerCase();
      if (mode === "reset") {
        await context.sessionStore.deleteWorkspaceSandboxMode(workspaceKey);
        await message.reply(`access reset to default: \`${formatSandboxMode(context.config.sandboxMode)}\``);
        return;
      }

      const mappedMode: Record<string, SandboxMode> = {
        "workspace-write": "workspaceWrite",
        "read-only": "readOnly",
        "full-access": "dangerFullAccess",
      };
      const nextMode = mode ? mappedMode[mode] : undefined;
      if (nextMode) {
        await context.sessionStore.setWorkspaceSandboxMode(workspaceKey, nextMode);
        await message.reply(`access set to \`${formatSandboxMode(nextMode)}\``);
        return;
      }

      await message.reply(
        "Usage: `!codex access`, `!codex access workspace-write`, `!codex access read-only`, `!codex access full-access`, or `!codex access reset`.",
      );
    },

    async network(message, args) {
      const workspaceKey = context.getWorkspaceKey(message);
      const current =
        context.sessionStore.getWorkspaceNetworkAccess(workspaceKey) ?? context.config.sandboxNetworkAccess;
      if (args.length === 0) {
        await message.reply(`network: \`${formatNetworkAccess(current)}\``);
        return;
      }

      const mode = args[0]?.toLowerCase();
      if (mode === "reset") {
        await context.sessionStore.deleteWorkspaceNetworkAccess(workspaceKey);
        await message.reply(`network reset to default: \`${formatNetworkAccess(context.config.sandboxNetworkAccess)}\``);
        return;
      }

      if (mode === "on" || mode === "off") {
        const enabled = mode === "on";
        await context.sessionStore.setWorkspaceNetworkAccess(workspaceKey, enabled);
        await message.reply(`network set to \`${formatNetworkAccess(enabled)}\``);
        return;
      }

      await message.reply("Usage: `!codex network`, `!codex network on`, `!codex network off`, or `!codex network reset`.");
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
