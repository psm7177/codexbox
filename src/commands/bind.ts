import { requireAdmin } from "./auth.js";
import type { CommandContext, CommandHandler } from "./types.js";

export function createBindCommand(context: CommandContext): CommandHandler {
  return async (message, args) => {
    if (!(await requireAdmin(context, message, "You are not allowed to bind sessions."))) {
      return;
    }

    const threadId = args[0]?.trim();
    if (!threadId) {
      await message.reply("Usage: `!codex bind <thread-id>`.");
      return;
    }

    const conversationKey = context.getConversationKey(message);
    await context.conversationService.saveThread(conversationKey, threadId);
    await message.reply(`Bound this conversation to Codex thread \`${threadId}\`.`);
  };
}
