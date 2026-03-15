import type { Message } from "discord.js";
import { parseCommand } from "../commands.js";
import { downloadDiscordAttachments, formatDownloadedAttachmentContext } from "../discord-attachments.js";
import { buildSandboxPolicy, type Config } from "../config.js";
import type { CodexAppServerClient, CodexUserInput } from "../codex-app-server-client.js";
import {
  buildCodexTurnInput,
  getConversationKey,
  getThreadDisplayName,
  getWorkspaceKey,
  isAuthorizedMessage,
  shouldHandleMessage,
  splitDiscordMessage,
  stripBotMention,
} from "../discord-context.js";
import type { ErrorTracker } from "../error-tracker.js";
import { resolveLocalReferences } from "../local-references.js";
import { ActiveTurnRegistry, type ActiveTurnRegistry as ActiveTurnRegistryType } from "../lifecycle/active-turn-registry.js";
import { ConversationLockManager } from "../lifecycle/conversation-lock-manager.js";
import type { RestartCoordinator } from "../lifecycle/restart-coordinator.js";
import type { ConversationService } from "../state/conversation-service.js";
import type { WorkspaceService } from "../state/workspace-service.js";
import { getDynamicToolProfile } from "../dynamic-tools.js";
import { runCodexTurn } from "./turn-runner.js";

type CommandHandler = (message: Message, args: string[]) => Promise<void>;

interface MessageRouterOptions {
  config: Config;
  conversationService: ConversationService;
  restartCoordinator: RestartCoordinator;
  activeTurnRegistry?: ActiveTurnRegistryType;
  conversationLockManager?: ConversationLockManager;
  workspaceService: WorkspaceService;
  codexClient: Pick<CodexAppServerClient, "ensureThread" | "startTurn"> &
    Partial<Pick<CodexAppServerClient, "interruptTurn">>;
  commandHandlers: Record<string, CommandHandler>;
  errorTracker: ErrorTracker;
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

function getRateLimitHint(error: unknown, workspaceService: WorkspaceService, workspaceKey: string): string {
  const message = getErrorMessage(error);
  if (!/429 Too Many Requests/i.test(message)) {
    return "";
  }

  const provider = workspaceService.getModelProvider(workspaceKey);
  const model = workspaceService.getModel(workspaceKey);
  if (provider !== "ollama" || !model || !/cloud/i.test(model)) {
    return "";
  }

  return `\nHint: selected model \`${model}\` is cloud-backed, so it can still hit Ollama Cloud rate limits. Use \`!codex model\` to switch to a local Ollama model.`;
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

export function createMessageCreateHandler(options: MessageRouterOptions): (message: Message) => Promise<void> {
  const conversationLockManager = options.conversationLockManager ?? new ConversationLockManager();
  const runTurn = options.runTurn ?? runCodexTurn;
  const activeTurnRegistry = options.activeTurnRegistry ?? new ActiveTurnRegistry();
  const log = options.log ?? console.log;
  const errorLog = options.errorLog ?? console.error;
  const restartReply = "Restart requested. Not accepting new requests until shutdown completes.";
  const formatBridgeErrorReply = (errorId: string, summary: string, isAdmin: boolean): string => {
    const detailHint = isAdmin ? ` Use \`!codex error ${errorId}\` for details.` : "";
    return (
      splitDiscordMessage(`Codex bridge error. Reference: \`${errorId}\`\n${summary}${detailHint}`, 1900)[0] ??
      `Codex bridge error. Reference: \`${errorId}\``
    );
  };

  async function handleChatMessage(message: Message): Promise<void> {
    const botUserId = options.getBotUserId();
    if (!botUserId) {
      throw new Error("Discord client user is unavailable");
    }

    const rawText = stripBotMention(message.content, botUserId);
    const hasAttachments = message.attachments.size > 0;
    if (!rawText && !hasAttachments) {
      if (!options.config.discordMessageContentIntent && message.inGuild()) {
        await message.reply(
          "Message content is unavailable for this bot in guild channels. Mention the bot with text, use DMs, or enable the Message Content intent and set `DISCORD_MESSAGE_CONTENT_INTENT=true`.",
        );
      }
      return;
    }

    const command = parseCommand(rawText);
    if (options.restartCoordinator.isRestartPending() && command?.name !== "restart") {
      await message.reply(restartReply);
      return;
    }

    log(`[discord] ${describeMessageSource(message)} <${message.author.tag}> ${rawText}`);

    if (command) {
      const handler = options.commandHandlers[command.name];
      if (!handler) {
        await message.reply(`Unknown command: \`${command.name}\`. Try \`!codex help\`.`);
        return;
      }
      await handler(message, command.args);
      return;
    }

    const conversationKey = getConversationKey(message);
    const workspaceKey = getWorkspaceKey(message);
    await conversationLockManager.serialize(conversationKey, async () => {
      if (!options.restartCoordinator.beginTurn()) {
        await message.reply(restartReply);
        return;
      }

      const cwd = options.workspaceService.getCwd(workspaceKey);
      const model = options.workspaceService.getModel(workspaceKey);
      const modelProvider = options.workspaceService.getModelProvider(workspaceKey);
      const sandboxMode = options.workspaceService.getSandboxMode(workspaceKey);
      const networkAccess = options.workspaceService.getNetworkAccess(workspaceKey);
      const sandboxPolicy = buildSandboxPolicy(sandboxMode, networkAccess, cwd);
      const turnInput = await resolveLocalReferences(rawText, {
        cwd,
        allowedRoots: [cwd, options.config.codexWorkspace, "/tmp"],
      });
      const downloadedAttachments =
        message.attachments.size > 0
          ? await downloadDiscordAttachments(message.attachments.values())
          : [];
      const attachmentContext = formatDownloadedAttachmentContext(downloadedAttachments);
      const userSections: string[] = [];
      if (turnInput.text.trim()) {
        userSections.push(turnInput.text.trim());
      } else if (downloadedAttachments.length > 0) {
        userSections.push("The user attached files without additional text. Inspect the downloaded attachments.");
      }
      if (attachmentContext.trim()) {
        userSections.push(attachmentContext.trim());
      }
      const turnText = userSections.join("\n\n").trim() || "The user attached files without additional text.";
      const inputs: CodexUserInput[] = [
        {
          type: "text",
          text: buildCodexTurnInput(message, turnText),
        },
        ...downloadedAttachments
          .filter((attachment) => attachment.kind === "image")
          .map((attachment) => ({
            type: "localImage" as const,
            path: attachment.savedPath,
          })),
      ];

      let session = options.conversationService.getSession(conversationKey);
      try {
        const requiredThreadToolProfile = getDynamicToolProfile(modelProvider);
        const reusableThreadId =
          (session?.threadToolProfile ?? null) === requiredThreadToolProfile ? session?.threadId : undefined;
        const threadId = await options.codexClient.ensureThread({
          threadId: reusableThreadId,
          name: getThreadDisplayName(message),
          cwd,
          model,
          modelProvider,
        });

        if (
          !session ||
          session.threadId !== threadId ||
          (session.threadToolProfile ?? null) !== requiredThreadToolProfile
        ) {
          session = await options.conversationService.saveThread(conversationKey, threadId, {
            threadToolProfile: requiredThreadToolProfile,
          });
        }

        await runTurn({
          message,
          conversationKey,
          threadId,
          inputs,
          cwd,
          model,
          codexWorkspace: options.config.codexWorkspace,
          sandboxPolicy,
          codexClient: options.codexClient,
          activeTurnRegistry,
        });
      } finally {
        options.restartCoordinator.endTurn();
      }
    });
  }

  return async (message: Message): Promise<void> => {
    try {
      const botUserId = options.getBotUserId();
      if (!botUserId) {
        return;
      }

      const workspaceKey = getWorkspaceKey(message);
      const replyMode = options.workspaceService.getReplyMode(workspaceKey);
      const shouldHandle =
        shouldHandleMessage(message, botUserId) || (replyMode === "auto" && !message.author.bot);
      if (!shouldHandle) {
        return;
      }

      if (!isAuthorizedMessage(message, options.config)) {
        return;
      }

      await handleChatMessage(message);
    } catch (error) {
      const context = `source=${describeMessageSource(message)} user=${message.author.tag}`;
      const record = options.errorTracker.record(error, context);
      errorLog(`[discord][${record.id}] ${record.detail}`);
      if (message.channel?.isSendable?.()) {
        const isAdmin = options.config.restartAdminUserIds.includes(message.author.id);
        const workspaceKey = getWorkspaceKey(message);
        const summary = `${record.summary}${getRateLimitHint(error, options.workspaceService, workspaceKey)}`;
        await message.reply(formatBridgeErrorReply(record.id, summary, isAdmin));
      }
    }
  };
}
