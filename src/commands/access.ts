import { requireAdmin } from "./auth.js";
import type { SandboxMode } from "../config.js";
import { formatSandboxMode } from "./format.js";
import type { CommandContext, CommandHandler } from "./types.js";

export function createAccessCommand(context: CommandContext): CommandHandler {
  return async (message, args) => {
    if (!(await requireAdmin(context, message, "You are not allowed to change Codex access settings."))) {
      return;
    }

    const workspaceKey = context.getWorkspaceKey(message);
    const current = context.workspaceService.getSandboxMode(workspaceKey);
    if (args.length === 0) {
      await message.reply(`access: \`${formatSandboxMode(current)}\``);
      return;
    }

    const mode = args[0]?.toLowerCase();
    if (mode === "reset") {
      await context.workspaceService.resetSandboxMode(workspaceKey);
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
      await context.workspaceService.setSandboxMode(workspaceKey, nextMode);
      await message.reply(`access set to \`${formatSandboxMode(nextMode)}\``);
      return;
    }

    await message.reply(
      "Usage: `!codex access`, `!codex access workspace-write`, `!codex access read-only`, `!codex access full-access`, or `!codex access reset`.",
    );
  };
}
