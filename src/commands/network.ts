import { formatNetworkAccess } from "./format.js";
import type { CommandContext, CommandHandler } from "./types.js";

export function createNetworkCommand(context: CommandContext): CommandHandler {
  return async (message, args) => {
    const workspaceKey = context.getWorkspaceKey(message);
    const current = context.workspaceService.getNetworkAccess(workspaceKey);
    if (args.length === 0) {
      await message.reply(`network: \`${formatNetworkAccess(current)}\``);
      return;
    }

    const mode = args[0]?.toLowerCase();
    if (mode === "reset") {
      await context.workspaceService.resetNetworkAccess(workspaceKey);
      await message.reply(`network reset to default: \`${formatNetworkAccess(context.config.sandboxNetworkAccess)}\``);
      return;
    }

    if (mode === "on" || mode === "off") {
      const enabled = mode === "on";
      await context.workspaceService.setNetworkAccess(workspaceKey, enabled);
      await message.reply(`network set to \`${formatNetworkAccess(enabled)}\``);
      return;
    }

    await message.reply("Usage: `!codex network`, `!codex network on`, `!codex network off`, or `!codex network reset`.");
  };
}
