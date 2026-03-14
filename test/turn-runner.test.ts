import assert from "node:assert/strict";
import test from "node:test";
import type { Message } from "discord.js";
import { runCodexTurn } from "../src/chat/turn-runner.js";

function createDiscordMessageStub() {
  const replies: string[] = [];
  const edits: string[] = [];
  const sent: Array<string | { files?: unknown[] }> = [];

  const message = {
    reply: async (content: string) => {
      replies.push(content);
      return {
        edit: async (nextContent: string) => {
          edits.push(nextContent);
        },
      };
    },
    channel: {
      isSendable: () => true,
      send: async (payload: string | { files?: unknown[] }) => {
        sent.push(payload);
      },
    },
  } as unknown as Message;

  return { message, replies, edits, sent };
}

test("runCodexTurn updates progress and sends the final text", async () => {
  const discord = createDiscordMessageStub();

  await runCodexTurn({
    message: discord.message,
    threadId: "thread-1",
    text: "Summarize this repository.",
    cwd: "/workspace/project",
    codexWorkspace: "/workspace/project",
    sandboxPolicy: {
      type: "workspaceWrite",
      writableRoots: ["/workspace/project"],
      networkAccess: false,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false,
    },
    codexClient: {
      async startTurn({ onDelta, onToolEvent }) {
        onToolEvent?.("item/started", {
          type: "commandExecution",
          command: "npm test",
        });
        await onDelta?.("Draft response in progress.", "Draft response in progress.");
        onToolEvent?.("item/completed", {
          type: "commandExecution",
          command: "npm test",
        });

        return {
          status: "completed",
          text: "Final answer.",
          imageArtifacts: [
            {
              source: "imageGeneration",
              value: "https://example.com/generated.png",
            },
          ],
          turn: {
            id: "turn-1",
            status: "completed",
          },
        };
      },
    },
  });

  assert.match(discord.replies[0] ?? "", /^🔄 Thinking\.\.\./);
  assert.ok(discord.edits.some((content) => content.includes("Preview:\nDraft response in progress.")));
  const completionEdit = discord.edits.find((content) => content.includes("Reply complete."));
  assert.ok(completionEdit);
  assert.ok(completionEdit?.includes("- exec: npm test"));
  assert.equal(completionEdit?.includes("Preview:"), false);
  assert.deepEqual(discord.sent, ["Final answer.", "https://example.com/generated.png"]);
});

test("runCodexTurn marks the placeholder as failed when the turn errors", async () => {
  const discord = createDiscordMessageStub();

  await assert.rejects(
    runCodexTurn({
      message: discord.message,
      threadId: "thread-1",
      text: "Summarize this repository.",
      cwd: "/workspace/project",
      codexWorkspace: "/workspace/project",
      sandboxPolicy: {
        type: "workspaceWrite",
        writableRoots: ["/workspace/project"],
        networkAccess: false,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      },
      codexClient: {
        async startTurn() {
          throw new Error("turn failed");
        },
      },
    }),
    /turn failed/,
  );

  assert.ok(discord.edits.includes("Reply failed."));
  assert.deepEqual(discord.sent, []);
});
