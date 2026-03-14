import type { CommandContext, CommandHandler } from "./types.js";

export function createRestartCommand(context: CommandContext): CommandHandler {
  return async (message) => {
    if (!context.config.restartAdminUserIds.includes(message.author.id)) {
      await message.reply("You are not allowed to restart this bot.");
      return;
    }

    const result = context.restartCoordinator.requestRestart();
    if (result.alreadyPending) {
      await message.reply("Restart is already scheduled. New requests are paused until shutdown.");
      return;
    }

    if (result.activeTurns === 0) {
      await message.reply("Restart scheduled. No active replies remain, shutting down now.");
      context.restartCoordinator.maybeExit();
      return;
    }

    await message.reply(
      `Restart scheduled. Waiting for ${result.activeTurns} active repl${result.activeTurns === 1 ? "y" : "ies"} to finish.`,
    );
    context.restartCoordinator.maybeExit();
  };
}
