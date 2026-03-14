import type { Message } from "discord.js";
import type { CodexAppServerClient, ToolItem } from "../codex-app-server-client.js";
import type { Config } from "../config.js";
import { editMessageIfChanged, sendImagesToChannel, sendToChannel } from "../discord/message-sender.js";
import { extractImageMarkers, resolveLocalImages } from "../discord-images.js";
import { splitDiscordMessage } from "../discord-context.js";
import { formatCompletionMessage, formatProgressMessage, summarizeToolItem } from "../response-status.js";

function formatActiveToolList(activeToolCounts: Map<string, number>): string[] {
  const activeTools: string[] = [];

  for (const [tool, count] of activeToolCounts.entries()) {
    if (count <= 0) {
      continue;
    }
    activeTools.push(count > 1 ? `${tool} (${count})` : tool);
  }

  return activeTools;
}

export async function runCodexTurn(options: {
  message: Message;
  threadId: string;
  text: string;
  cwd: string;
  codexWorkspace: string;
  sandboxPolicy: Config["turnDefaults"]["sandboxPolicy"];
  codexClient: Pick<CodexAppServerClient, "startTurn">;
}): Promise<void> {
  const placeholder = await options.message.reply(
    formatProgressMessage({
      isWriting: false,
      activeTools: [],
      usedTools: [],
      previewText: "",
    }),
  );
  const lastRendered = { value: "" };
  let lastUpdateAt = 0;
  const toolEvents: string[] = [];
  let previewText = "";
  let isWriting = false;
  const activeToolCounts = new Map<string, number>();

  const updatePlaceholder = async (force = false): Promise<void> => {
    const now = Date.now();
    if (!force && now - lastUpdateAt < 1200) {
      return;
    }

    lastUpdateAt = now;
    await editMessageIfChanged(
      placeholder,
      formatProgressMessage({
        isWriting,
        activeTools: formatActiveToolList(activeToolCounts),
        usedTools: toolEvents,
        previewText,
      }),
      lastRendered,
    );
  };

  try {
    const result = await options.codexClient.startTurn({
      threadId: options.threadId,
      text: options.text,
      cwd: options.cwd,
      sandboxPolicy: options.sandboxPolicy,
      onDelta: async (fullText) => {
        previewText = fullText.trim();
        if (!isWriting && fullText.trim()) {
          isWriting = true;
          await updatePlaceholder(true);
          return;
        }

        await updatePlaceholder();
      },
      onToolEvent: (eventName: string, item: ToolItem) => {
        const summary = summarizeToolItem(item);
        if (!summary) {
          return;
        }

        if (eventName === "item/started") {
          toolEvents.push(summary);
          activeToolCounts.set(summary, (activeToolCounts.get(summary) ?? 0) + 1);
        } else if (eventName === "item/completed") {
          const count = activeToolCounts.get(summary) ?? 0;
          if (count <= 1) {
            activeToolCounts.delete(summary);
          } else {
            activeToolCounts.set(summary, count - 1);
          }
        }

        void updatePlaceholder(true);
      },
    });

    await editMessageIfChanged(
      placeholder,
      formatCompletionMessage(toolEvents),
      lastRendered,
    );

    const finalText = result.text || "";
    const { cleanText, imageReferences } = extractImageMarkers(finalText);
    const { images, errors } = await resolveLocalImages(imageReferences, {
      cwd: options.cwd,
      allowedRoots: [options.cwd, options.codexWorkspace, "/tmp"],
    });
    const chunks = splitDiscordMessage(cleanText);

    if (chunks.length === 0 && images.length === 0) {
      await sendToChannel(options.message, "No assistant text returned.");
      return;
    }

    for (const chunk of chunks) {
      await sendToChannel(options.message, chunk);
    }

    if (images.length > 0) {
      await sendImagesToChannel(options.message, images);
    }

    for (const error of errors) {
      await sendToChannel(options.message, `image send skipped: ${error}`);
    }
  } catch (error) {
    await editMessageIfChanged(placeholder, "Reply failed.", lastRendered);
    throw error;
  }
}
