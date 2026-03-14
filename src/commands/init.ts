import path from "node:path";
import { requireAdmin } from "./auth.js";
import type { CommandContext, CommandHandler } from "./types.js";

export function createInitCommand(context: CommandContext): CommandHandler {
  return async (message, args) => {
    if (!(await requireAdmin(context, message, "You are not allowed to initialize this channel."))) {
      return;
    }

    const workspaceKey = context.getWorkspaceKey(message);
    const cwdArg = args[0];
    const modeArg = args[1]?.toLowerCase();

    if (!cwdArg) {
      await message.reply("Usage: `!codex init <cwd> <mention|auto>`.");
      return;
    }

    if (modeArg !== "mention" && modeArg !== "auto") {
      await message.reply("Usage: `!codex init <cwd> <mention|auto>`.");
      return;
    }

    const cwd = path.resolve(context.config.codexWorkspace, cwdArg);
    await context.workspaceService.setCwd(workspaceKey, cwd);
    await context.workspaceService.setReplyMode(workspaceKey, modeArg === "auto" ? "auto" : "mentionOnly");

    await message.reply(
      `Initialized this conversation.\nworkspace: \`${context.config.codexWorkspace}\`\ncwd: \`${context.workspaceService.getCwd(
        workspaceKey,
      )}\`\nreply mode: \`${modeArg}\``,
    );
  };
}
