import type { CommandContext, CommandHandler } from "./types.js";

export function createRestartCommand(context: CommandContext): CommandHandler {
  return async (message) => {
    if (!context.config.restartAdminUserIds.includes(message.author.id)) {
      await message.reply("You are not allowed to restart this bot.");
      return;
    }

    await message.reply("Restarting...");
    setTimeout(() => process.exit(75), 500);
  };
}
