import { splitDiscordMessage } from "../discord-context.js";
import { requireAdmin } from "./auth.js";
import type { CommandContext, CommandHandler } from "./types.js";

export function createSessionsCommand(context: CommandContext): CommandHandler {
  return async (message) => {
    if (!(await requireAdmin(context, message, "You are not allowed to view session bindings."))) {
      return;
    }

    const sessions = context.conversationService.listSessions();
    if (sessions.length === 0) {
      await message.reply("No stored session bindings.");
      return;
    }

    const body = ["Stored session bindings:"]
      .concat(sessions.map((session) => `- ${session.conversationKey} -> ${session.threadId}`))
      .join("\n");
    const chunks = splitDiscordMessage(body, 1900);
    await message.reply(chunks[0] ?? body);
    for (const chunk of chunks.slice(1)) {
      if (!message.channel?.isSendable?.()) {
        break;
      }
      await message.channel.send(chunk);
    }
  };
}
