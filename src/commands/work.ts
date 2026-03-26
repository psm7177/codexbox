import type { Message } from "discord.js";
import { isAdminUser, splitDiscordMessage } from "../discord-context.js";
import { getDynamicToolProfile } from "../dynamic-tools.js";
import { formatNetworkAccess, formatSandboxMode } from "./format.js";
import type { WorkflowConversationKind, WorkflowRecord, WorkflowThreadPolicy } from "../workflow-store.js";
import type { CommandContext, CommandHandler } from "./types.js";

function getConversationKind(message: Message): WorkflowConversationKind {
  if (!message.inGuild()) {
    return "dm";
  }
  return message.channel?.isThread?.() ? "thread" : "channel";
}

function formatWorkflowListLine(goal: string): string {
  const trimmed = goal.trim();
  if (trimmed.length <= 80) {
    return trimmed;
  }
  return `${trimmed.slice(0, 77).trimEnd()}...`;
}

function canManageWorkflow(context: CommandContext, message: Message, workflow: WorkflowRecord): boolean {
  return workflow.conversationKey === context.getConversationKey(message) || isAdminUser(context.config, message.author.id);
}

function normalizeThreadPolicy(policy: WorkflowThreadPolicy | null | undefined): WorkflowThreadPolicy {
  return policy === "reuse-conversation-thread" ? "reuse-conversation-thread" : "dedicated-workflow-thread";
}

function formatTopEntries(entries: Array<{ label: string; value: string }>, emptyLabel = "none"): string[] {
  if (entries.length === 0) {
    return [`- ${emptyLabel}`];
  }
  return entries.map((entry) => `- ${entry.label}: ${entry.value}`);
}

function getDefaultThreadPolicy(context: CommandContext): WorkflowThreadPolicy {
  return context.config.workflowDefaults.reuseConversationThread
    ? "reuse-conversation-thread"
    : "dedicated-workflow-thread";
}

function parseThreadPolicyFlag(flag: string | undefined): WorkflowThreadPolicy | null {
  const normalized = flag?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized === "--reuse-thread" || normalized === "reuse-thread") {
    return "reuse-conversation-thread";
  }
  if (normalized === "--dedicated-thread" || normalized === "dedicated-thread") {
    return "dedicated-workflow-thread";
  }
  return null;
}

function parseRetryThreadPolicy(flag: string | undefined, currentPolicy: WorkflowThreadPolicy): WorkflowThreadPolicy | null {
  const normalized = flag?.trim().toLowerCase();
  if (!normalized || normalized === "keep-thread") {
    return null;
  }
  if (normalized === "reuse-thread") {
    return "reuse-conversation-thread";
  }
  if (normalized === "dedicated-thread") {
    return "dedicated-workflow-thread";
  }
  if (normalized === "keep-policy") {
    return currentPolicy;
  }
  return null;
}

async function sendLongReply(message: Message, content: string): Promise<void> {
  const chunks = splitDiscordMessage(content);
  const [first, ...rest] = chunks;
  await message.reply(first ?? "No content.");
  for (const chunk of rest) {
    if (!message.channel?.isSendable?.()) {
      break;
    }
    await message.channel.send(chunk);
  }
}

async function showWorkflow(context: CommandContext, message: Message, workflowId: string): Promise<void> {
  if (!context.workflowService) {
    await message.reply("Workflow service is not configured.");
    return;
  }

  const workflow = context.workflowService.getWorkflow(workflowId);
  if (!workflow) {
    await message.reply(`Workflow \`${workflowId}\` was not found.`);
    return;
  }
  if (!canManageWorkflow(context, message, workflow)) {
    await message.reply("You are not allowed to inspect that workflow.");
    return;
  }

  const paths = context.workflowService.getWorkflowArtifactPaths(workflowId);
  const recentEvents = await context.workflowService.readRecentEvents(workflowId, 8);
  const lines = [
    `Workflow \`${workflow.id}\``,
    `status: \`${workflow.status}\``,
    `goal: ${workflow.goal}`,
    `conversation: \`${workflow.conversationKey}\``,
    `workspace: \`${workflow.workspaceKey}\``,
    `cwd: \`${workflow.cwd}\``,
    `access: \`${formatSandboxMode(workflow.sandboxMode ?? context.config.sandboxMode)}\``,
    `network: \`${formatNetworkAccess(workflow.networkAccess ?? context.config.sandboxNetworkAccess)}\``,
    `model: \`${workflow.model ?? "default"}\``,
    `provider: \`${workflow.modelProvider ?? "default"}\``,
    `thread: \`${workflow.threadId ?? "none"}\``,
    `tool profile: \`${workflow.threadToolProfile ?? "none"}\``,
    `thread policy: \`${normalizeThreadPolicy(workflow.threadPolicy)}\``,
    `current step: \`${workflow.currentStep ?? "none"}\``,
    `next step: \`${workflow.nextStep ?? "none"}\``,
    `plan warnings: \`${workflow.planWarnings?.length ?? 0}\``,
    `pending prompts: \`${workflow.pendingPrompts?.length ?? 0}\``,
    `step count: \`${workflow.stepCount}\``,
    `failure count: \`${workflow.failureCount}\``,
    `next run: \`${workflow.nextRunAt ?? "none"}\``,
    `last error: \`${workflow.lastError ?? "none"}\``,
    `artifacts: \`${paths.directory}\``,
    `status file: \`${paths.status}\``,
    `handoff file: \`${paths.handoff}\``,
    `plan file: \`${paths.plan}\``,
    `plan warnings file: \`${paths.planWarnings}\``,
    `pending prompts file: \`${paths.pendingPrompts}\``,
    `assistant file: \`${paths.lastAssistantMessage}\``,
    `events file: \`${paths.events}\``,
  ];

  if (recentEvents.length > 0) {
    lines.push("", "recent events:");
    for (const event of recentEvents) {
      lines.push(`- ${event.at} [${event.type}/${event.status}] ${event.message}`);
    }
  }

  await sendLongReply(message, lines.join("\n"));
}

async function listAllWorkflows(context: CommandContext, message: Message): Promise<void> {
  if (!context.workflowService) {
    await message.reply("Workflow service is not configured.");
    return;
  }

  if (!isAdminUser(context.config, message.author.id)) {
    await message.reply("You are not allowed to list all workflows.");
    return;
  }

  const workflows = context.workflowService.listWorkflows();
  const activityDashboard = await context.workflowService.getActivityDashboard();
  const operationalDashboard = context.workflowService.getOperationalDashboard();
  if (workflows.length === 0) {
    await message.reply("No workflows are registered.");
    return;
  }

  const lines = ["All workflows:", "activity trends:"];
  for (const window of activityDashboard.windows) {
    lines.push(
      `- ${window.label}: events=${window.summary.eventCount}, completed=${window.summary.counts.completed ?? 0}, failed=${(window.summary.counts.failed ?? 0) + (window.summary.counts.terminal_failed ?? 0)}, retried=${window.summary.counts.retried ?? 0}`,
    );
  }
  if (activityDashboard.recentFailures.length > 0) {
    lines.push("recent failures:");
    for (const failure of activityDashboard.recentFailures) {
      lines.push(`- ${failure.at} ${failure.workflowId}: ${failure.message}`);
    }
  }
  lines.push(
    `operational snapshot: overdue=${operationalDashboard.overdueWaiting.length}, stalled=${operationalDashboard.stalledRunning.length}, paused=${operationalDashboard.paused.length}, failed=${operationalDashboard.failed.length}, high_failure=${operationalDashboard.highFailure.length}, recent_active=${operationalDashboard.recentActive.length}`,
  );
  lines.push(
    `status counts: queued=${operationalDashboard.statusCounts.queued}, running=${operationalDashboard.statusCounts.running}, waiting=${operationalDashboard.statusCounts.waiting}, paused=${operationalDashboard.statusCounts.paused}, completed=${operationalDashboard.statusCounts.completed}, failed=${operationalDashboard.statusCounts.failed}, cancelled=${operationalDashboard.statusCounts.cancelled}`,
  );
  lines.push("top providers:");
  lines.push(
    ...formatTopEntries(
      operationalDashboard.providerCounts.map((entry) => ({
        label: entry.provider,
        value: `${entry.count} workflows`,
      })),
    ),
  );
  lines.push("workspace hotspots:");
  lines.push(
    ...formatTopEntries(
      operationalDashboard.workspaceHotspots.map((entry) => ({
        label: entry.workspaceKey,
        value: `active=${entry.activeCount}, total=${entry.totalCount}`,
      })),
    ),
  );
  lines.push("conversation hotspots:");
  lines.push(
    ...formatTopEntries(
      operationalDashboard.conversationHotspots.map((entry) => ({
        label: entry.conversationKey,
        value: `active=${entry.activeCount}, total=${entry.totalCount}`,
      })),
    ),
  );
  if (operationalDashboard.overdueWaiting.length > 0) {
    lines.push("overdue waiting:");
    for (const workflow of operationalDashboard.overdueWaiting) {
      lines.push(`- ${workflow.id} next=${workflow.nextRunAt ?? "none"} goal=${formatWorkflowListLine(workflow.goal)}`);
    }
  }
  if (operationalDashboard.stalledRunning.length > 0) {
    lines.push("stalled running:");
    for (const workflow of operationalDashboard.stalledRunning) {
      lines.push(`- ${workflow.id} last_run=${workflow.lastRunAt ?? "none"} goal=${formatWorkflowListLine(workflow.goal)}`);
    }
  }
  if (operationalDashboard.paused.length > 0) {
    lines.push("paused:");
    for (const workflow of operationalDashboard.paused) {
      lines.push(`- ${workflow.id} updated=${workflow.updatedAt} goal=${formatWorkflowListLine(workflow.goal)}`);
    }
  }
  if (operationalDashboard.recentActive.length > 0) {
    lines.push("recent active:");
    for (const workflow of operationalDashboard.recentActive) {
      lines.push(`- ${workflow.id} [${workflow.status}] updated=${workflow.updatedAt} goal=${formatWorkflowListLine(workflow.goal)}`);
    }
  }
  lines.push("workflow list:");
  for (const workflow of workflows) {
    lines.push(
      `- ${workflow.id} [${workflow.status}] conversation=${workflow.conversationKey} step=${workflow.stepCount} next=${workflow.nextRunAt ?? "none"} goal=${formatWorkflowListLine(workflow.goal)}`,
    );
  }
  await sendLongReply(message, lines.join("\n"));
}

export function createWorkCommand(context: CommandContext): CommandHandler {
  return async (message, args) => {
    if (!context.workflowService) {
      await message.reply("Workflow service is not configured.");
      return;
    }

    const subcommand = args[0]?.toLowerCase();
    const conversationKey = context.getConversationKey(message);

    if (!subcommand) {
      const workflows = context.workflowService.listConversationWorkflows(conversationKey);
      if (workflows.length === 0) {
        await message.reply("No background workflows are registered for this conversation.");
        return;
      }

      const lines = ["Background workflows for this conversation:"];
      for (const workflow of workflows) {
        lines.push(
          `- ${workflow.id} [${workflow.status}] step=${workflow.stepCount} next=${workflow.nextRunAt ?? "now"} goal=${formatWorkflowListLine(workflow.goal)}`,
        );
      }
      await sendLongReply(message, lines.join("\n"));
      return;
    }

    if (subcommand === "all" || subcommand === "dashboard") {
      await listAllWorkflows(context, message);
      return;
    }

    if (subcommand === "show") {
      const workflowId = args[1]?.trim();
      if (!workflowId) {
        await message.reply("Usage: `!codex work show <workflow-id>`");
        return;
      }
      await showWorkflow(context, message, workflowId);
      return;
    }

    if (subcommand === "pause") {
      const workflowId = args[1]?.trim();
      if (!workflowId) {
        await message.reply("Usage: `!codex work pause <workflow-id>`");
        return;
      }
      const workflow = context.workflowService.getWorkflow(workflowId);
      if (!workflow) {
        await message.reply(`Workflow \`${workflowId}\` was not found.`);
        return;
      }
      if (!canManageWorkflow(context, message, workflow)) {
        await message.reply("You are not allowed to pause that workflow.");
        return;
      }
      const paused = await context.workflowService.pauseWorkflow(workflowId);
      if (!paused) {
        await message.reply(`Workflow \`${workflowId}\` could not be paused.`);
        return;
      }
      await message.reply(`Paused workflow \`${paused.id}\`.`);
      return;
    }

    if (subcommand === "resume") {
      const workflowId = args[1]?.trim();
      if (!workflowId) {
        await message.reply("Usage: `!codex work resume <workflow-id>`");
        return;
      }
      const workflow = context.workflowService.getWorkflow(workflowId);
      if (!workflow) {
        await message.reply(`Workflow \`${workflowId}\` was not found.`);
        return;
      }
      if (!canManageWorkflow(context, message, workflow)) {
        await message.reply("You are not allowed to resume that workflow.");
        return;
      }
      const resumed = await context.workflowService.resumeWorkflow(workflowId);
      if (!resumed) {
        await message.reply(`Workflow \`${workflowId}\` could not be resumed.`);
        return;
      }
      context.workflowRunner?.wake();
      await message.reply(`Resumed workflow \`${resumed.id}\`. Next run: \`${resumed.nextRunAt ?? "now"}\``);
      return;
    }

    if (subcommand === "note") {
      const workflowId = args[1]?.trim();
      const prompt = args.slice(2).join(" ").trim();
      if (!workflowId || !prompt) {
        await message.reply("Usage: `!codex work note <workflow-id> <prompt>`");
        return;
      }

      const workflow = context.workflowService.getWorkflow(workflowId);
      if (!workflow) {
        await message.reply(`Workflow \`${workflowId}\` was not found.`);
        return;
      }
      if (!canManageWorkflow(context, message, workflow)) {
        await message.reply("You are not allowed to modify that workflow.");
        return;
      }

      const updated = await context.workflowService.appendPendingPrompt(workflowId, prompt);
      if (!updated) {
        await message.reply(`Workflow \`${workflowId}\` could not accept a new prompt.`);
        return;
      }

      if (updated.status === "waiting" || updated.status === "queued") {
        context.workflowRunner?.wake();
      }
      await message.reply(
        `Queued a workflow note for \`${updated.id}\`.\npending prompts: \`${updated.pendingPrompts?.length ?? 0}\`\nstatus: \`${updated.status}\`\nnext run: \`${updated.nextRunAt ?? "manual"}\``,
      );
      return;
    }

    if (subcommand === "retry") {
      if (!isAdminUser(context.config, message.author.id)) {
        await message.reply("You are not allowed to retry workflows.");
        return;
      }

      const workflowId = args[1]?.trim();
      if (!workflowId) {
        await message.reply("Usage: `!codex work retry <workflow-id> [delay-seconds] [keep-thread|reuse-thread|dedicated-thread]`");
        return;
      }

      const workflow = context.workflowService.getWorkflow(workflowId);
      if (!workflow) {
        await message.reply(`Workflow \`${workflowId}\` was not found.`);
        return;
      }
      if (workflow.status !== "failed") {
        await message.reply(`Workflow \`${workflowId}\` is not failed. Current status: \`${workflow.status}\`.`);
        return;
      }

      const delaySecondsRaw = args[2]?.trim();
      let delaySeconds = 0;
      if (delaySecondsRaw) {
        const parsed = Number.parseInt(delaySecondsRaw, 10);
        if (!Number.isFinite(parsed) || parsed < 0) {
          await message.reply("`delay-seconds` must be a non-negative integer.");
          return;
        }
        delaySeconds = parsed;
      }

      const currentPolicy = normalizeThreadPolicy(workflow.threadPolicy);
      const rawThreadPolicyArg = args[3]?.trim().toLowerCase();
      const threadPolicyOverride = parseRetryThreadPolicy(rawThreadPolicyArg, currentPolicy);
      if (rawThreadPolicyArg && !threadPolicyOverride && rawThreadPolicyArg !== "keep-thread") {
        await message.reply("Thread policy must be one of `keep-thread`, `reuse-thread`, or `dedicated-thread`.");
        return;
      }

      const nextRunAt = new Date(Date.now() + delaySeconds * 1000);
      const targetPolicy = threadPolicyOverride ?? currentPolicy;
      const session = context.conversationService.getSession(workflow.conversationKey);
      const threadId =
        targetPolicy === "reuse-conversation-thread"
          ? (session?.threadId ?? workflow.threadId ?? null)
          : threadPolicyOverride
            ? null
            : workflow.threadId ?? null;
      const threadToolProfile =
        targetPolicy === "reuse-conversation-thread"
          ? getDynamicToolProfile(workflow.modelProvider ?? undefined)
          : threadPolicyOverride
            ? null
            : workflow.threadToolProfile ?? null;

      const retried = await context.workflowService.retryWorkflow(workflowId, {
        nextRunAt,
        threadPolicy: targetPolicy,
        threadId,
        threadToolProfile,
      });
      if (!retried) {
        await message.reply(`Workflow \`${workflowId}\` could not be retried.`);
        return;
      }
      context.workflowRunner?.wake();
      await message.reply(
        `Retried workflow \`${retried.id}\`.\nnext run: \`${retried.nextRunAt ?? "now"}\`\nthread policy: \`${normalizeThreadPolicy(retried.threadPolicy)}\`\nthread: \`${retried.threadId ?? "none"}\``,
      );
      return;
    }

    if (subcommand === "cancel" || subcommand === "stop") {
      const workflowId = args[1]?.trim();
      if (!workflowId) {
        await message.reply("Usage: `!codex work cancel <workflow-id>` or `!codex work stop <workflow-id>`");
        return;
      }

      const workflow = context.workflowService.getWorkflow(workflowId);
      if (!workflow) {
        await message.reply(`Workflow \`${workflowId}\` was not found.`);
        return;
      }
      if (!canManageWorkflow(context, message, workflow)) {
        await message.reply("You are not allowed to cancel that workflow.");
        return;
      }

      const cancelled = await context.workflowService.cancelWorkflow(workflowId);
      if (!cancelled) {
        await message.reply(`Workflow \`${workflowId}\` could not be cancelled.`);
        return;
      }

      if (workflow.status === "running") {
        await message.reply(
          `Stop requested for workflow \`${cancelled.id}\`. The current step may finish, but it will not be scheduled again.`,
        );
        return;
      }

      await message.reply(`Cancelled workflow \`${cancelled.id}\`.`);
      return;
    }

    const threadPolicyFlag = parseThreadPolicyFlag(args[0]);
    const goalArgs = threadPolicyFlag ? args.slice(1) : args;
    const goal = goalArgs.join(" ").trim();
    if (!goal) {
      await message.reply("Usage: `!codex work [--reuse-thread|--dedicated-thread] <goal>`");
      return;
    }

    const duplicate = context.workflowService.findDuplicateActiveWorkflow(conversationKey, goal);
    if (duplicate) {
      await message.reply(
        `A similar active workflow already exists: \`${duplicate.id}\` [${duplicate.status}]. Use \`!codex work show ${duplicate.id}\` or pause/cancel it before queueing the same goal again.`,
      );
      return;
    }

    const workspaceKey = context.getWorkspaceKey(message);
    const modelProvider = context.workspaceService.getModelProvider(workspaceKey);
    const threadToolProfile = getDynamicToolProfile(modelProvider ?? undefined);
    const session = context.conversationService.getSession(conversationKey);
    const threadPolicy = threadPolicyFlag ?? getDefaultThreadPolicy(context);
    const reuseConversationThread = threadPolicy === "reuse-conversation-thread";
    const workflow = await context.workflowService.createWorkflow({
      conversationKey,
      workspaceKey,
      conversationKind: getConversationKind(message),
      channelId: message.channelId,
      guildId: message.guildId,
      goal,
      cwd: context.workspaceService.getCwd(workspaceKey),
      sandboxMode: context.workspaceService.getSandboxMode(workspaceKey),
      networkAccess: context.workspaceService.getNetworkAccess(workspaceKey),
      model: context.workspaceService.getModel(workspaceKey),
      modelProvider,
      threadId: reuseConversationThread ? session?.threadId ?? null : null,
      threadToolProfile: reuseConversationThread ? threadToolProfile : null,
      threadPolicy,
    });

    context.workflowRunner?.wake();
    await message.reply(
      `Queued workflow \`${workflow.id}\`.\nstatus: \`${workflow.status}\`\nnext run: \`${workflow.nextRunAt ?? "now"}\`\nthread policy: \`${normalizeThreadPolicy(workflow.threadPolicy)}\`\ngoal: ${workflow.goal}`,
    );
  };
}
