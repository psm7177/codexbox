import { requireAdmin } from "./auth.js";
import type { CommandContext, CommandHandler } from "./types.js";

export function createResetCommand(context: CommandContext): CommandHandler {
  return async (message) => {
    if (!(await requireAdmin(context, message, "You are not allowed to reset this conversation."))) {
      return;
    }

    await context.conversationService.reset(context.getConversationKey(message));
    await message.reply("Session reset. The next message starts a new Codex thread.");
  };
}
