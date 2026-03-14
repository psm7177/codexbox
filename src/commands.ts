import { createAccessCommand } from "./commands/access.js";
import { createCwdCommand } from "./commands/cwd.js";
import { createErrorCommand } from "./commands/error.js";
import { createHelpCommand } from "./commands/help.js";
import { createNetworkCommand } from "./commands/network.js";
import { createResetCommand } from "./commands/reset.js";
import { createRestartCommand } from "./commands/restart.js";
import { createStatusCommand } from "./commands/status.js";
import { createWorkspaceCommand } from "./commands/workspace.js";
import type { CommandContext, CommandHandler, ParsedCommand } from "./commands/types.js";

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
    help: createHelpCommand(),
    status: createStatusCommand(context),
    workspace: createWorkspaceCommand(context),
    cwd: createCwdCommand(context),
    access: createAccessCommand(context),
    network: createNetworkCommand(context),
    reset: createResetCommand(context),
    restart: createRestartCommand(context),
    error: createErrorCommand(context),
  };
}
