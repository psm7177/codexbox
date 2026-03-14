import { splitDiscordMessage } from "../discord-context.js";
import { requireAdmin } from "./auth.js";
import type { CommandContext, CommandHandler } from "./types.js";

export function createErrorCommand(context: CommandContext): CommandHandler {
  return async (message, args) => {
    if (!(await requireAdmin(context, message, "You are not allowed to view bot error logs."))) {
      return;
    }

    const id = args[0]?.trim();
    if (!id) {
      await message.reply("Usage: `!codex error <error-id>`.");
      return;
    }

    const record = context.errorTracker.get(id);
    if (!record) {
      await message.reply(`No error log found for \`${id}\`.`);
      return;
    }

    const chunks = splitDiscordMessage(`Error ${record.id}\n\n${record.detail}`, 1900);
    if (chunks.length === 0) {
      await message.reply(`Error ${record.id} has no stored detail.`);
      return;
    }

    await message.reply(chunks[0] ?? `Error ${record.id}`);
    for (const chunk of chunks.slice(1)) {
      if (!message.channel?.isSendable?.()) {
        break;
      }
      await message.channel.send(chunk);
    }
  };
}
