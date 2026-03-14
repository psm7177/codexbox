import type { Message } from "discord.js";

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

export function stripBotMention(content: string, clientUserId: string): string {
  const patterns = [new RegExp(`<@${clientUserId}>`, "g"), new RegExp(`<@!${clientUserId}>`, "g")];
  return patterns.reduce((text, pattern) => text.replace(pattern, ""), content).trim();
}

export function splitDiscordMessage(text: string, maxLength = 1900): string[] {
  if (!text) {
    return [];
  }

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxLength) {
    let splitIndex = remaining.lastIndexOf("\n", maxLength);
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
