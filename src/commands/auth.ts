import type { Message } from "discord.js";
import { isAdminUser } from "../discord-context.js";
import type { CommandContext } from "./types.js";

export async function requireAdmin(context: CommandContext, message: Message, deniedMessage: string): Promise<boolean> {
  if (isAdminUser(context.config, message.author.id)) {
    return true;
  }

  await message.reply(deniedMessage);
  return false;
}
