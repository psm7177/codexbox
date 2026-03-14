import { requireAdmin } from "./auth.js";
import type { ReplyMode } from "../session-store.js";
import type { CommandContext, CommandHandler } from "./types.js";

function formatReplyMode(mode: ReplyMode): string {
  return mode === "auto" ? "auto" : "mention";
}

export function createModeCommand(context: CommandContext): CommandHandler {
  return async (message, args) => {
    if (!(await requireAdmin(context, message, "You are not allowed to change reply mode."))) {
      return;
    }

    const workspaceKey = context.getWorkspaceKey(message);
    const current = context.workspaceService.getReplyMode(workspaceKey);
    if (args.length === 0) {
      await message.reply(`reply mode: \`${formatReplyMode(current)}\``);
      return;
    }

    const mode = args[0]?.toLowerCase();
    if (mode === "reset") {
      await context.workspaceService.resetReplyMode(workspaceKey);
      await message.reply("reply mode reset to `mention`.");
      return;
    }

    if (mode === "mention" || mode === "auto") {
      await context.workspaceService.setReplyMode(workspaceKey, mode === "auto" ? "auto" : "mentionOnly");
      await message.reply(`reply mode set to \`${mode}\``);
      return;
    }

    await message.reply("Usage: `!codex mode`, `!codex mode mention`, `!codex mode auto`, or `!codex mode reset`.");
  };
}
