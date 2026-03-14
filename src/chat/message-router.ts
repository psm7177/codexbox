import type { Message } from "discord.js";
import { parseCommand } from "../commands.js";
import { buildSandboxPolicy, type Config } from "../config.js";
import type { CodexAppServerClient } from "../codex-app-server-client.js";
import {
  getConversationKey,
  getThreadDisplayName,
  getWorkspaceKey,
  shouldHandleMessage,
  stripBotMention,
} from "../discord-context.js";
import type { ConversationService } from "../state/conversation-service.js";
import type { WorkspaceService } from "../state/workspace-service.js";
import { runCodexTurn } from "./turn-runner.js";

type CommandHandler = (message: Message, args: string[]) => Promise<void>;

interface MessageRouterOptions {
  config: Config;
  conversationService: ConversationService;
  workspaceService: WorkspaceService;
  codexClient: Pick<CodexAppServerClient, "ensureThread" | "startTurn">;
  commandHandlers: Record<string, CommandHandler>;
  getBotUserId: () => string | undefined;
  runTurn?: typeof runCodexTurn;
  log?: (line: string) => void;
  errorLog?: (line: string) => void;
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

function describeMessageSource(message: Message): string {
  if (!message.inGuild()) {
    return `dm:${message.author.username}`;
  }
  if (message.channel?.isThread?.()) {
    return `thread:${message.guild?.name ?? "unknown"}/${message.channel.name ?? message.channelId}`;
  }
  return `channel:${message.guild?.name ?? "unknown"}/#${getChannelName(message) ?? message.channelId}`;
}

function createConversationSerializer(): <T>(key: string, task: () => Promise<T>) => Promise<T> {
  const conversationLocks = new Map<string, Promise<unknown>>();

  return async function serializeConversation<T>(key: string, task: () => Promise<T>): Promise<T> {
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
  };
}

export function createMessageCreateHandler(options: MessageRouterOptions): (message: Message) => Promise<void> {
  const serializeConversation = createConversationSerializer();
  const runTurn = options.runTurn ?? runCodexTurn;
  const log = options.log ?? console.log;
  const errorLog = options.errorLog ?? console.error;

  async function handleChatMessage(message: Message): Promise<void> {
    const conversationKey = getConversationKey(message);
    const workspaceKey = getWorkspaceKey(message);
    const cwd = options.workspaceService.getCwd(workspaceKey);
    const sandboxMode = options.workspaceService.getSandboxMode(workspaceKey);
    const networkAccess = options.workspaceService.getNetworkAccess(workspaceKey);
    const sandboxPolicy = buildSandboxPolicy(sandboxMode, networkAccess, cwd);
    const botUserId = options.getBotUserId();
    if (!botUserId) {
      throw new Error("Discord client user is unavailable");
    }

    const rawText = stripBotMention(message.content, botUserId);
    if (!rawText) {
      if (!options.config.discordMessageContentIntent && message.inGuild()) {
        await message.reply(
          "Message content is unavailable for this bot in guild channels. Mention the bot with text, use DMs, or enable the Message Content intent and set `DISCORD_MESSAGE_CONTENT_INTENT=true`.",
        );
      }
      return;
    }

    log(`[discord] ${describeMessageSource(message)} <${message.author.tag}> ${rawText}`);

    const command = parseCommand(rawText);
    if (command) {
      const handler = options.commandHandlers[command.name];
      if (!handler) {
        await message.reply(`Unknown command: \`${command.name}\`. Try \`!codex help\`.`);
        return;
      }
      await handler(message, command.args);
      return;
    }

    await serializeConversation(conversationKey, async () => {
      let session = options.conversationService.getSession(conversationKey);
      const threadId = await options.codexClient.ensureThread({
        threadId: session?.threadId,
        name: getThreadDisplayName(message),
        cwd,
      });

      if (!session || session.threadId !== threadId) {
        session = await options.conversationService.saveThread(conversationKey, threadId);
      }

      await runTurn({
        message,
        threadId,
        text: rawText,
        cwd,
        codexWorkspace: options.config.codexWorkspace,
        sandboxPolicy,
        codexClient: options.codexClient,
      });
    });
  }

  return async (message: Message): Promise<void> => {
    try {
      const botUserId = options.getBotUserId();
      if (!botUserId || !shouldHandleMessage(message, botUserId)) {
        return;
      }

      await handleChatMessage(message);
    } catch (error) {
      errorLog(`[discord] ${getErrorMessage(error)}`);
      if (message.channel?.isSendable?.()) {
        await message.reply(`Codex bridge error: ${getErrorMessage(error)}`);
      }
    }
  };
}
