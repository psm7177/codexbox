import { createAccessCommand } from "./commands/access.js";
import { createBindCommand } from "./commands/bind.js";
import { createCwdCommand } from "./commands/cwd.js";
import { createErrorCommand } from "./commands/error.js";
import { createHelpCommand } from "./commands/help.js";
import { createInitCommand } from "./commands/init.js";
import { createModelCommand } from "./commands/model.js";
import { createModelsCommand } from "./commands/models.js";
import { createModeCommand } from "./commands/mode.js";
import { createNetworkCommand } from "./commands/network.js";
import { createProviderCommand } from "./commands/provider.js";
import { createProvidersCommand } from "./commands/providers.js";
import { createResetCommand } from "./commands/reset.js";
import { createRestartCommand } from "./commands/restart.js";
import { createSessionsCommand } from "./commands/sessions.js";
import { createStatusCommand } from "./commands/status.js";
import { createStopCommand } from "./commands/stop.js";
import { createToolsCommand } from "./commands/tools.js";
import { createWorkCommand } from "./commands/work.js";
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
    tools: createToolsCommand(context),
    work: createWorkCommand(context),
    models: createModelsCommand(context),
    providers: createProvidersCommand(context),
    model: createModelCommand(context),
    provider: createProviderCommand(context),
    stop: createStopCommand(context),
    sessions: createSessionsCommand(context),
    bind: createBindCommand(context),
    workspace: createWorkspaceCommand(context),
    mode: createModeCommand(context),
    init: createInitCommand(context),
    cwd: createCwdCommand(context),
    access: createAccessCommand(context),
    network: createNetworkCommand(context),
    reset: createResetCommand(context),
    restart: createRestartCommand(context),
    error: createErrorCommand(context),
  };
}
