import type { CommandContext, CommandHandler } from "./types.js";
import { formatNetworkAccess, formatSandboxMode } from "./format.js";

interface AccountReadResponse {
  account?: {
    type?: string | null;
    email?: string | null;
    planType?: string | null;
  } | null;
  requiresOpenaiAuth?: boolean;
}

interface RateLimitBucket {
  limitId?: string | null;
  limitName?: string | null;
  primary?: {
    usedPercent?: number | null;
    windowDurationMins?: number | null;
    resetsAt?: number | null;
  } | null;
}

interface RateLimitsReadResponse {
  rateLimits?: RateLimitBucket | null;
  rateLimitsByLimitId?: Record<string, RateLimitBucket> | null;
}

function formatResetTime(unixSeconds: number | null | undefined): string {
  if (!unixSeconds) {
    return "unknown";
  }
  return new Date(unixSeconds * 1000).toISOString();
}

function formatUsageLines(rateLimits: RateLimitsReadResponse | null): string[] {
  if (!rateLimits) {
    return ["usage: `unavailable`"];
  }

  const buckets = rateLimits.rateLimitsByLimitId
    ? Object.values(rateLimits.rateLimitsByLimitId)
    : rateLimits.rateLimits
      ? [rateLimits.rateLimits]
      : [];

  if (buckets.length === 0) {
    return ["usage: `unavailable`"];
  }

  const lines = ["usage:"];
  for (const bucket of buckets) {
    const usedPercent = Math.max(0, Math.min(100, bucket.primary?.usedPercent ?? 0));
    const remainingPercent = Math.max(0, 100 - usedPercent);
    const bucketName = bucket.limitName ?? bucket.limitId ?? "default";
    const windowDuration = bucket.primary?.windowDurationMins;
    const windowLabel = typeof windowDuration === "number" ? `${windowDuration}m` : "unknown window";
    const resetTime = formatResetTime(bucket.primary?.resetsAt);
    lines.push(
      `- ${bucketName}: \`${remainingPercent}% remaining\` (${usedPercent}% used, ${windowLabel}, resets ${resetTime})`,
    );
  }
  return lines;
}

export function createStatusCommand(context: CommandContext): CommandHandler {
  return async (message) => {
    const conversationKey = context.getConversationKey(message);
    const workspaceKey = context.getWorkspaceKey(message);
    const session = context.conversationService.getSession(conversationKey);
    const workspaceRoot = context.config.codexWorkspace;
    const cwd = context.workspaceService.getCwd(workspaceKey);
    const modelOverride = context.workspaceService.getModelOverride(workspaceKey);
    const providerOverride = context.workspaceService.getModelProviderOverride(workspaceKey);
    const sandboxMode = context.workspaceService.getSandboxMode(workspaceKey);
    const networkAccess = context.workspaceService.getNetworkAccess(workspaceKey);
    const replyMode = context.workspaceService.getReplyMode(workspaceKey) === "auto" ? "auto" : "mention";

    const selectedModel = context.workspaceService.getModel(workspaceKey) ?? "default";
    const selectedProvider = context.workspaceService.getModelProvider(workspaceKey) ?? "default";
    let threadModel = selectedModel;
    let threadProvider = selectedProvider;
    let threadStatus = "not bound";
    let authMode = "unknown";
    let accountLabel = "not signed in";
    let planLabel = "n/a";
    let openaiAuthRequired = "unknown";
    let rateLimits: RateLimitsReadResponse | null = null;

    try {
      const configResponse = (await context.codexClient.request("config/read", {
        cwd,
        includeLayers: false,
      })) as {
        config?: {
          model?: string | null;
          model_provider?: string | null;
        };
      };
      threadModel = configResponse.config?.model ?? threadModel;
      threadProvider = configResponse.config?.model_provider ?? threadProvider;
    } catch {
      // Keep configured defaults when app-server status cannot be read.
    }

    try {
      const accountResponse = (await context.codexClient.request("account/read", {
        refreshToken: false,
      })) as AccountReadResponse;
      authMode = accountResponse.account?.type ?? "none";
      if (accountResponse.account?.email) {
        accountLabel = accountResponse.account.email;
      } else if (accountResponse.account?.type === "apiKey") {
        accountLabel = "api key";
      }
      if (accountResponse.account?.planType) {
        planLabel = accountResponse.account.planType;
      }
      if (typeof accountResponse.requiresOpenaiAuth === "boolean") {
        openaiAuthRequired = accountResponse.requiresOpenaiAuth ? "yes" : "no";
      }
    } catch {
      authMode = "unavailable";
      accountLabel = "unavailable";
      planLabel = "unavailable";
      openaiAuthRequired = "unavailable";
    }

    try {
      rateLimits = (await context.codexClient.request("account/rateLimits/read", {})) as RateLimitsReadResponse;
    } catch {
      rateLimits = null;
    }

    if (session) {
      try {
        const threadResponse = (await context.codexClient.request("thread/read", {
          threadId: session.threadId,
          includeTurns: false,
        })) as {
          thread?: {
            status?: { type?: string };
            model?: string | null;
            modelProvider?: string | null;
          };
        };
        threadStatus = threadResponse.thread?.status?.type ?? "unknown";
        threadModel = threadResponse.thread?.model ?? threadModel;
        threadProvider = threadResponse.thread?.modelProvider ?? threadProvider;
      } catch {
        threadStatus = "unavailable";
      }
    }

    const lines = [
      `workspace: \`${workspaceRoot}\``,
      `cwd: \`${cwd}\``,
      `reply mode: \`${replyMode}\``,
      `access: \`${formatSandboxMode(sandboxMode)}\``,
      `network: \`${formatNetworkAccess(networkAccess)}\``,
      `selected model: \`${selectedModel}\``,
      `selected provider: \`${selectedProvider}\``,
      `model override: \`${modelOverride ?? "none"}\``,
      `provider override: \`${providerOverride ?? "none"}\``,
      `auth mode: \`${authMode}\``,
      `account: \`${accountLabel}\``,
      `plan: \`${planLabel}\``,
      `openai auth required: \`${openaiAuthRequired}\``,
      ...formatUsageLines(rateLimits),
    ];

    if (!session) {
      lines.push("No Codex session is mapped to this conversation yet.");
      await message.reply(lines.join("\n"));
      return;
    }

    lines.push(`thread: \`${session.threadId}\``);
    lines.push(`thread status: \`${threadStatus}\``);
    lines.push(`thread model: \`${threadModel}\``);
    lines.push(`thread provider: \`${threadProvider}\``);
    await message.reply(lines.join("\n"));
  };
}
