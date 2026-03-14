import type { CommandContext, CommandHandler } from "./types.js";

export function createResetCommand(context: CommandContext): CommandHandler {
  return async (message) => {
    await context.conversationService.reset(context.getConversationKey(message));
    await message.reply("Session reset. The next message starts a new Codex thread.");
  };
}
