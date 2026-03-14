import assert from "node:assert/strict";
import test from "node:test";
import {
  getConversationKey,
  getWorkspaceKey,
  splitDiscordMessage,
  stripBotMention,
} from "../src/discord-context.js";

test("stripBotMention removes both mention forms", () => {
  const text = "<@123> hello <@!123>";
  assert.equal(stripBotMention(text, "123"), "hello");
});

test("splitDiscordMessage preserves all content", () => {
  const text = "a".repeat(2100);
  const chunks = splitDiscordMessage(text, 1000);
  assert.equal(chunks.join(""), text);
  assert.equal(chunks.length, 3);
});

test("thread conversation key uses thread id and workspace key uses parent channel id", () => {
  const message = {
    guildId: "guild-1",
    channelId: "thread-1",
    channel: {
      id: "thread-1",
      parentId: "channel-1",
      isThread: () => true,
    },
  };

  assert.equal(getConversationKey(message as never), "thread:thread-1");
  assert.equal(getWorkspaceKey(message as never), "channel:guild-1:channel-1");
});
