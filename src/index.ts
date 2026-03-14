import "dotenv/config";
import { AttachmentBuilder, Client, GatewayIntentBits, Partials, type Message } from "discord.js";
import { CodexAppServerClient, type ToolItem } from "./codex-app-server-client.js";
import { createCommandHandlers, parseCommand } from "./commands.js";
import { buildSandboxPolicy, loadConfig } from "./config.js";
import { extractImageMarkers, resolveLocalImages } from "./discord-images.js";
import {
  getConversationKey,
  getThreadDisplayName,
  getWorkspaceKey,
  shouldHandleMessage,
  splitDiscordMessage,
  stripBotMention,
} from "./discord-context.js";
import { formatProgressMessage, summarizeToolItem } from "./response-status.js";
import { SessionStore } from "./session-store.js";

const config = loadConfig();

if (!config.discordToken) {
  throw new Error("DISCORD_TOKEN is required");
}

const intents = [
  GatewayIntentBits.DirectMessages,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.Guilds,
];

if (config.discordMessageContentIntent) {
  intents.push(GatewayIntentBits.MessageContent);
}

const discordClient = new Client({
  intents,
  partials: [Partials.Channel],
});

const codexClient = new CodexAppServerClient(config);
const sessionStore = new SessionStore(config.sessionStorePath);
const conversationLocks = new Map<string, Promise<unknown>>();
const commandHandlers = createCommandHandlers({
  config,
  sessionStore,
  getConversationKey,
  getWorkspaceKey,
});

interface AdminStartupLog {
  adminId: string;
  message: { edit: (content: string) => Promise<unknown> };
}

function getChannelName(message: Message): string | undefined {
  const channel = message.channel;
  return "name" in channel && typeof channel.name === "string" ? channel.name : undefined;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function formatStartupStatus(options: {
  botTag: string;
  phase: string;
  sessionStoreLoaded: boolean;
  codexReady: boolean;
  codexDeferred: boolean;
  error?: string;
}): string {
  const lines = [
    "Startup status",
    `- bot: ${options.botTag}`,
    `- phase: ${options.phase}`,
    `- session store: ${options.sessionStoreLoaded ? "ready" : "pending"}`,
    `- codex app-server: ${options.codexReady ? "ready" : options.codexDeferred ? "deferred" : "pending"}`,
    `- workspace: ${config.codexWorkspace}`,
  ];

  if (options.error) {
    lines.push(`- error: ${options.error}`);
  }

  return lines.join("\n");
}

async function createAdminStartupLogs(initialContent: string): Promise<AdminStartupLog[]> {
  const adminIds = config.restartAdminUserIds;
  if (adminIds.length === 0) {
    return [];
  }

  const logs = await Promise.all(
    adminIds.map(async (adminId) => {
      try {
        const user = await discordClient.users.fetch(adminId);
        const dm = await user.createDM();
        const message = await dm.send(initialContent);
        return { adminId, message };
      } catch (error) {
        console.error(`[startup] Failed to send startup log to admin ${adminId}: ${getErrorMessage(error)}`);
        return null;
      }
    }),
  );

  return logs.flatMap((entry) => (entry ? [entry] : []));
}

async function updateAdminStartupLogs(logs: AdminStartupLog[], content: string): Promise<void> {
  await Promise.all(
    logs.map(async ({ adminId, message }) => {
      try {
        await message.edit(content);
      } catch (error) {
        console.error(`[startup] Failed to edit startup log for admin ${adminId}: ${getErrorMessage(error)}`);
      }
    }),
  );
}

function serializeConversation<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = conversationLocks.get(key) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(task);
  conversationLocks.set(
    key,
    current.finally(() => {
      if (conversationLocks.get(key) === current) {
        conversationLocks.delete(key);
      }
    }),
  );
  return current;
}

function describeMessageSource(message: Message): string {
  if (!message.inGuild()) {
    return `dm:${message.author.username}`;
  }
  if (message.channel?.isThread?.()) {
    return `thread:${message.guild?.name ?? "unknown"}/${message.channel.name ?? message.channelId}`;
  }
  return `channel:${message.guild?.name ?? "unknown"}/#${getChannelName(message) ?? message.channelId}`;
}

async function sendToChannel(message: Message, content: string): Promise<void> {
  if (!message.channel?.isSendable?.()) {
    throw new Error("Message channel is not sendable");
  }
  await message.channel.send(content);
}

async function sendImagesToChannel(message: Message, imagePaths: Array<{ resolvedPath: string; filename: string }>): Promise<void> {
  if (!message.channel?.isSendable?.()) {
    throw new Error("Message channel is not sendable");
  }

  for (const image of imagePaths) {
    const attachment = new AttachmentBuilder(image.resolvedPath, { name: image.filename });
    await message.channel.send({ files: [attachment] });
  }
}

async function editMessageIfChanged(
  message: { edit: (content: string) => Promise<unknown> },
  content: string,
  lastContent: { value: string },
): Promise<void> {
  if (content === lastContent.value) {
    return;
  }

  await message.edit(content);
  lastContent.value = content;
}

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

async function handleChatMessage(message: Message): Promise<void> {
  const conversationKey = getConversationKey(message);
  const workspaceKey = getWorkspaceKey(message);
  const cwd = sessionStore.getWorkspace(workspaceKey) ?? config.codexWorkspace;
  const sandboxMode = sessionStore.getWorkspaceSandboxMode(workspaceKey) ?? config.sandboxMode;
  const networkAccess = sessionStore.getWorkspaceNetworkAccess(workspaceKey) ?? config.sandboxNetworkAccess;
  const sandboxPolicy = buildSandboxPolicy(sandboxMode, networkAccess, cwd);
  const botUserId = discordClient.user?.id;
  if (!botUserId) {
    throw new Error("Discord client user is unavailable");
  }

  const rawText = stripBotMention(message.content, botUserId);
  if (!rawText) {
    if (!config.discordMessageContentIntent && message.inGuild()) {
      await message.reply(
        "Message content is unavailable for this bot in guild channels. Mention the bot with text, use DMs, or enable the Message Content intent and set `DISCORD_MESSAGE_CONTENT_INTENT=true`.",
      );
    }
    return;
  }

  console.log(`[discord] ${describeMessageSource(message)} <${message.author.tag}> ${rawText}`);

  const command = parseCommand(rawText);
  if (command) {
    const handler = commandHandlers[command.name];
    if (!handler) {
      await message.reply(`Unknown command: \`${command.name}\`. Try \`!codex help\`.`);
      return;
    }
    await handler(message, command.args);
    return;
  }

  await serializeConversation(conversationKey, async () => {
    let session = sessionStore.get(conversationKey);
    const threadId = await codexClient.ensureThread({
      threadId: session?.threadId,
      name: getThreadDisplayName(message),
      cwd,
    });

    if (!session || session.threadId !== threadId) {
      session = { threadId };
      await sessionStore.set(conversationKey, session);
    }

    const placeholder = await message.reply(
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
      const result = await codexClient.startTurn({
        threadId,
        text: rawText,
        cwd,
        sandboxPolicy,
        onDelta: async (fullText) => {
          previewText = fullText.trim();
          if (!isWriting && fullText.trim()) {
            isWriting = true;
            await updatePlaceholder(true);
            return;
          }

          await updatePlaceholder();
        },
        onPlan: async (planEvent) => {
          if ((planEvent.plan ?? []).length > 0) {
            await updatePlaceholder(true);
          }
        },
        onToolEvent: (eventName, item) => {
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
        formatProgressMessage({
          headline: "Reply complete.",
          isWriting: false,
          activeTools: formatActiveToolList(activeToolCounts),
          usedTools: toolEvents,
          previewText,
        }),
        lastRendered,
      );

      const finalText = result.text || "";
      const { cleanText, imageReferences } = extractImageMarkers(finalText);
      const { images, errors } = await resolveLocalImages(imageReferences, {
        cwd,
        allowedRoots: [cwd, config.codexWorkspace, "/tmp"],
      });
      const chunks = splitDiscordMessage(cleanText);

      if (chunks.length === 0 && images.length === 0) {
        await sendToChannel(message, "No assistant text returned.");
        return;
      }

      for (const chunk of chunks) {
        await sendToChannel(message, chunk);
      }

      if (images.length > 0) {
        await sendImagesToChannel(message, images);
      }

      for (const error of errors) {
        await sendToChannel(message, `image send skipped: ${error}`);
      }
    } catch (error) {
      await editMessageIfChanged(placeholder, "Reply failed.", lastRendered);
      throw error;
    }
  });
}

discordClient.once("ready", async () => {
  let adminLogs: AdminStartupLog[] = [];
  try {
    if (!discordClient.user) {
      throw new Error("Discord client user is unavailable after login");
    }
    console.log(`Discord bot logged in as ${discordClient.user.tag}`);

    const botTag = discordClient.user.tag;
    adminLogs = await createAdminStartupLogs(
      formatStartupStatus({
        botTag,
        phase: "discord ready",
        sessionStoreLoaded: false,
        codexReady: false,
        codexDeferred: false,
      }),
    );

    await sessionStore.load();
    await updateAdminStartupLogs(
      adminLogs,
      formatStartupStatus({
        botTag,
        phase: "session store loaded",
        sessionStoreLoaded: true,
        codexReady: false,
        codexDeferred: false,
      }),
    );

    try {
      await codexClient.ensureStarted();
      console.log("[startup] Codex app-server is ready.");
      await updateAdminStartupLogs(
        adminLogs,
        formatStartupStatus({
          botTag,
          phase: "startup complete",
          sessionStoreLoaded: true,
          codexReady: true,
          codexDeferred: false,
        }),
      );
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      console.error(
        `[startup] Codex app-server initialization failed: ${errorMessage}. The bot will stay online and retry when the next message needs Codex.`,
      );
      await updateAdminStartupLogs(
        adminLogs,
        formatStartupStatus({
          botTag,
          phase: "startup complete with deferred Codex initialization",
          sessionStoreLoaded: true,
          codexReady: false,
          codexDeferred: true,
          error: errorMessage,
        }),
      );
    }
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    console.error(`[startup] Ready handler failed: ${errorMessage}`);
    if (discordClient.user && adminLogs.length > 0) {
      await updateAdminStartupLogs(
        adminLogs,
        formatStartupStatus({
          botTag: discordClient.user.tag,
          phase: "startup failed",
          sessionStoreLoaded: false,
          codexReady: false,
          codexDeferred: false,
          error: errorMessage,
        }),
      );
    }
  }
});

discordClient.on("messageCreate", async (message) => {
  try {
    const botUserId = discordClient.user?.id;
    if (!botUserId || !shouldHandleMessage(message, botUserId)) {
      return;
    }
    await handleChatMessage(message);
  } catch (error) {
    console.error(error);
    if (message.channel?.isSendable?.()) {
      await message.reply(`Codex bridge error: ${getErrorMessage(error)}`);
    }
  }
});

codexClient.on("log", (line: string) => {
  console.error(`[codex] ${line}`);
});

codexClient.on("exit", (error: Error) => {
  console.error(`[codex] app-server exited: ${error.message}`);
});

process.on("unhandledRejection", (reason) => {
  console.error(`[process] Unhandled rejection: ${getErrorMessage(reason)}`);
});

process.on("uncaughtException", (error) => {
  console.error(`[process] Uncaught exception: ${getErrorMessage(error)}`);
});

try {
  await discordClient.login(config.discordToken);
} catch (error) {
  if (getErrorMessage(error).includes("Used disallowed intents")) {
    console.error(
      "Discord rejected the configured gateway intents. Either enable Message Content Intent in the Discord developer portal or remove `DISCORD_MESSAGE_CONTENT_INTENT=true` from .env.",
    );
  }
  throw error;
}
