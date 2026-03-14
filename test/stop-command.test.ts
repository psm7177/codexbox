import assert from "node:assert/strict";
import test from "node:test";
import type { Message } from "discord.js";
import { createStopCommand } from "../src/commands/stop.js";
import { ActiveTurnRegistry } from "../src/lifecycle/active-turn-registry.js";

function createMessage(replyLog: string[]): Message {
  return {
    author: {
      id: "user-1",
    },
    channelId: "channel-1",
    guildId: null,
    channel: {
      isThread: () => false,
    },
    inGuild: () => false,
    reply: async (content: string) => {
      replyLog.push(content);
      return undefined;
    },
  } as unknown as Message;
}

test("stop command interrupts the active turn for the current conversation", async () => {
  const replies: string[] = [];
  const interruptCalls: Array<{ threadId: string; turnId: string }> = [];
  const activeTurnRegistry = new ActiveTurnRegistry();
  activeTurnRegistry.begin("dm:channel-1", "thread-1");
  activeTurnRegistry.attachTurnId("dm:channel-1", "turn-1");

  const stop = createStopCommand({
    config: {
      restartAdminUserIds: [],
    },
    conversationService: {} as never,
    restartCoordinator: {} as never,
    activeTurnRegistry,
    workspaceService: {} as never,
    codexClient: {
      request: async () => undefined,
      interruptTurn: async (params: { threadId: string; turnId: string }) => {
        interruptCalls.push(params);
      },
    },
    errorTracker: {} as never,
    getConversationKey: () => "dm:channel-1",
    getWorkspaceKey: () => "dm:channel-1",
  } as any);

  await stop(createMessage(replies), []);

  assert.deepEqual(interruptCalls, [{ threadId: "thread-1", turnId: "turn-1" }]);
  assert.deepEqual(replies, ["Stopping the current reply."]);
});

test("stop command reports when no active turn exists", async () => {
  const replies: string[] = [];
  const stop = createStopCommand({
    config: {
      restartAdminUserIds: [],
    },
    conversationService: {} as never,
    restartCoordinator: {} as never,
    activeTurnRegistry: new ActiveTurnRegistry(),
    workspaceService: {} as never,
    codexClient: {
      request: async () => undefined,
      interruptTurn: async () => undefined,
    },
    errorTracker: {} as never,
    getConversationKey: () => "dm:channel-1",
    getWorkspaceKey: () => "dm:channel-1",
  } as any);

  await stop(createMessage(replies), []);

  assert.deepEqual(replies, ["No active reply is running for this conversation."]);
});
