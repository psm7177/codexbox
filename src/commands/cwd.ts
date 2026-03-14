import path from "node:path";
import { requireAdmin } from "./auth.js";
import type { CommandContext, CommandHandler } from "./types.js";

export function createCwdCommand(context: CommandContext): CommandHandler {
  return async (message, args) => {
    if (!(await requireAdmin(context, message, "You are not allowed to change the working directory."))) {
      return;
    }

    const workspaceKey = context.getWorkspaceKey(message);
    const currentCwd = context.workspaceService.getCwd(workspaceKey);
    if (args.length === 0) {
      await message.reply(`cwd: \`${currentCwd}\``);
      return;
    }

    if (args.length === 1 && args[0]?.toLowerCase() === "reset") {
      await context.workspaceService.resetCwd(workspaceKey);
      await message.reply(`cwd reset to default: \`${context.config.codexWorkspace}\``);
      return;
    }

    const cwd = path.resolve(currentCwd, args.join(" "));
    await context.workspaceService.setCwd(workspaceKey, cwd);
    await message.reply(`cwd set to \`${context.workspaceService.getCwd(workspaceKey)}\``);
  };
}
