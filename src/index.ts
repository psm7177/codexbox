import "dotenv/config";
import { Client, GatewayIntentBits, Partials, type Message } from "discord.js";
import { CodexAppServerClient, type ToolItem } from "./codex-app-server-client.js";
import { createCommandHandlers, parseCommand } from "./commands.js";
import { buildSandboxPolicy, loadConfig } from "./config.js";
import {
  getConversationKey,
  getThreadDisplayName,
  getWorkspaceKey,
  shouldHandleMessage,
  splitDiscordMessage,
  stripBotMention,
} from "./discord-context.js";
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

async function initializeCodexClient(): Promise<void> {
  try {
    await codexClient.ensureStarted();
    console.log("[startup] Codex app-server is ready.");
  } catch (error) {
    console.error(
      `[startup] Codex app-server initialization failed: ${getErrorMessage(error)}. The bot will stay online and retry when the next message needs Codex.`,
    );
  }
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

function summarizeItem(item: ToolItem): string | null {
  if (!item?.type) {
    return null;
  }
  if (item.type === "commandExecution") {
    return `command: ${item.command}`;
  }
  if (item.type === "fileChange") {
    return `file change: ${(item.changes ?? []).map((change) => change.path).join(", ")}`;
  }
  return item.type;
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

    const placeholder = await message.reply("Thinking...");
    let lastRendered = "";
    let lastUpdateAt = 0;
    const toolEvents: string[] = [];

    const result = await codexClient.startTurn({
      threadId,
      text: rawText,
      cwd,
      sandboxPolicy,
      onDelta: async (fullText) => {
        const now = Date.now();
        if (now - lastUpdateAt < 1200) {
          return;
        }
        lastUpdateAt = now;
        const preview = splitDiscordMessage(fullText)[0] ?? "Thinking...";
        if (preview && preview !== lastRendered) {
          lastRendered = preview;
          await placeholder.edit(preview);
        }
      },
      onPlan: async (planEvent) => {
        const steps = (planEvent.plan ?? []).map((step) => `${step.status}: ${step.step}`).join("\n");
        if (steps) {
          await sendToChannel(message, `Plan update:\n\`\`\`\n${steps}\n\`\`\``);
        }
      },
      onToolEvent: (eventName, item) => {
        if (eventName === "item/started") {
          const summary = summarizeItem(item);
          if (summary) {
            toolEvents.push(summary);
          }
        }
      },
    });

    const activity = toolEvents.length > 0 ? `\n\nActivity:\n- ${toolEvents.join("\n- ")}` : "";
    const finalText = result.text || `No assistant text returned.${activity}`;
    const chunks = splitDiscordMessage(finalText);

    if (chunks.length === 0) {
      await placeholder.edit("No assistant text returned.");
      return;
    }

    await placeholder.edit(chunks[0] ?? "No assistant text returned.");
    for (const chunk of chunks.slice(1)) {
      await sendToChannel(message, chunk);
    }
  });
}

discordClient.once("ready", async () => {
  try {
    await sessionStore.load();
    if (!discordClient.user) {
      throw new Error("Discord client user is unavailable after login");
    }
    console.log(`Discord bot logged in as ${discordClient.user.tag}`);
    await initializeCodexClient();
  } catch (error) {
    console.error(`[startup] Ready handler failed: ${getErrorMessage(error)}`);
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
