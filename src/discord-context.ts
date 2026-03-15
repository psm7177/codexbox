import type { Message } from "discord.js";
import type { Config } from "./config.js";

function getChannelName(message: Message): string | undefined {
  const channel = message.channel;
  return "name" in channel && typeof channel.name === "string" ? channel.name : undefined;
}

export function getConversationKey(message: Message): string {
  if (message.channel?.isThread?.()) {
    return `thread:${message.channel.id}`;
  }
  if (message.guildId) {
    return `channel:${message.guildId}:${message.channelId}`;
  }
  return `dm:${message.channelId}`;
}

export function getWorkspaceKey(message: Message): string {
  if (message.channel?.isThread?.()) {
    if (message.guildId && message.channel.parentId) {
      return `channel:${message.guildId}:${message.channel.parentId}`;
    }
    return `thread:${message.channel.id}`;
  }
  if (message.guildId) {
    return `channel:${message.guildId}:${message.channelId}`;
  }
  return `dm:${message.channelId}`;
}

export function getThreadDisplayName(message: Message): string {
  if (message.channel?.isThread?.()) {
    return message.channel.name ?? `discord-thread-${message.channel.id}`;
  }
  if (message.guild) {
    return `${message.guild.name} / #${getChannelName(message) ?? message.channelId}`;
  }
  return `DM ${message.author.username}`;
}

export function shouldHandleMessage(message: Message, clientUserId: string): boolean {
  if (message.author.bot) {
    return false;
  }

  if (!message.inGuild()) {
    return true;
  }

  if (message.channel?.isThread?.()) {
    return true;
  }

  if (message.mentions.users.has(clientUserId)) {
    return true;
  }

  if (message.reference?.messageId && message.mentions.repliedUser?.id === clientUserId) {
    return true;
  }

  return false;
}

export function isAdminUser(config: Pick<Config, "restartAdminUserIds">, userId: string): boolean {
  return config.restartAdminUserIds.includes(userId);
}

export function isAuthorizedMessage(
  message: Message,
  config: Pick<Config, "discordAllowedUserIds" | "discordAllowedGuildIds" | "discordAllowedChannelIds" | "restartAdminUserIds">,
): boolean {
  if (isAdminUser(config, message.author.id)) {
    return true;
  }

  const hasAllowlist =
    config.discordAllowedUserIds.length > 0 ||
    config.discordAllowedGuildIds.length > 0 ||
    config.discordAllowedChannelIds.length > 0;

  if (!hasAllowlist) {
    return true;
  }

  if (config.discordAllowedUserIds.includes(message.author.id)) {
    return true;
  }

  if (config.discordAllowedChannelIds.includes(message.channelId)) {
    return true;
  }

  if (message.guildId && config.discordAllowedGuildIds.includes(message.guildId)) {
    return true;
  }

  return false;
}

export function stripBotMention(content: string, clientUserId: string): string {
  const patterns = [new RegExp(`<@${clientUserId}>`, "g"), new RegExp(`<@!${clientUserId}>`, "g")];
  return patterns.reduce((text, pattern) => text.replace(pattern, ""), content).trim();
}

export function buildCodexTurnInput(message: Message, userText: string): string {
  const conversationKind = !message.inGuild()
    ? "dm"
    : message.channel?.isThread?.()
      ? "thread"
      : "channel";

  return [
    "[Discord runtime context]",
    `channel_id: ${message.channelId}`,
    `guild_id: ${message.guildId ?? "dm"}`,
    `conversation_kind: ${conversationKind}`,
    "If the MCP tools `send_discord_image` or `send_discord_file` are available and the user asks you to send an image or file into Discord, use them with the current channel_id instead of only mentioning the file path in text.",
    "[/Discord runtime context]",
    "",
    userText,
  ].join("\n");
}

export function splitDiscordMessage(text: string, maxLength = 1900): string[] {
  if (!text) {
    return [];
  }

  const findSentenceBoundary = (value: string, limit: number): number => {
    const punctuation = new Set([".", "!", "?", "。", "！", "？"]);
    for (let index = Math.min(limit - 1, value.length - 1); index >= Math.floor(limit / 2); index -= 1) {
      if (!punctuation.has(value[index] ?? "")) {
        continue;
      }

      const nextChar = value[index + 1] ?? "";
      if (!nextChar || /\s|["')\]]/.test(nextChar)) {
        return index + 1;
      }
    }

    return -1;
  };

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxLength) {
    let splitIndex = findSentenceBoundary(remaining, maxLength);
    if (splitIndex < Math.floor(maxLength / 2)) {
      splitIndex = remaining.lastIndexOf("\n", maxLength);
    }
    if (splitIndex < Math.floor(maxLength / 2)) {
      splitIndex = remaining.lastIndexOf(" ", maxLength);
    }
    if (splitIndex < Math.floor(maxLength / 2)) {
      splitIndex = maxLength;
    }
    chunks.push(remaining.slice(0, splitIndex).trim());
    remaining = remaining.slice(splitIndex).trim();
  }

  if (remaining) {
    chunks.push(remaining);
  }
  return chunks;
}
