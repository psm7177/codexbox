import type { CommandContext, CommandHandler } from "./types.js";

export function createStopCommand(context: CommandContext): CommandHandler {
  return async (message) => {
    if (!context.activeTurnRegistry) {
      await message.reply("Stop is unavailable in the current bot configuration.");
      return;
    }

    const conversationKey = context.getConversationKey(message);
    const stopRequest = context.activeTurnRegistry.requestStop(conversationKey);

    if (!stopRequest.found || !stopRequest.state) {
      await message.reply("No active reply is running for this conversation.");
      return;
    }

    if (stopRequest.alreadyRequested) {
      await message.reply("Stop is already pending for the current reply.");
      return;
    }

    if (!stopRequest.state.turnId) {
      await message.reply("Stop requested. Interrupting as soon as the current reply starts.");
      return;
    }

    if (!context.codexClient.interruptTurn) {
      await message.reply("Stop requested, but turn interruption is unavailable in the current bot configuration.");
      return;
    }

    await context.codexClient.interruptTurn({
      threadId: stopRequest.state.threadId,
      turnId: stopRequest.state.turnId,
    });
    await message.reply("Stopping the current reply.");
  };
}
