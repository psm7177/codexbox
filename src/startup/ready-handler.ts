import type { Client } from "discord.js";
import type { BackgroundWorkflowRunner } from "../background/background-workflow-runner.js";
import type { CodexAppServerClient } from "../codex-app-server-client.js";
import type { Config } from "../config.js";
import type { SessionStore } from "../session-store.js";
import type {
  WorkflowActivityDashboard,
  WorkflowActivitySummary,
  WorkflowOperationalDashboard,
  WorkflowService,
} from "../state/workflow-service.js";
import type { WorkflowStore } from "../workflow-store.js";
import {
  type AdminStartupLog,
  createAdminStartupLogs,
  formatStartupStatus,
  updateAdminStartupLogs,
} from "./admin-startup-log.js";

interface ReadyHandlerOptions {
  discordClient: Client;
  config: Config;
  sessionStore: Pick<SessionStore, "load">;
  workflowStore?: Pick<WorkflowStore, "load">;
  workflowService?: Pick<
    WorkflowService,
    "listWorkflows" | "listDueWorkflows" | "getActivitySummary" | "getActivityDashboard" | "getOperationalDashboard"
  >;
  codexClient: Pick<CodexAppServerClient, "ensureStarted">;
  workflowRunner?: Pick<BackgroundWorkflowRunner, "start" | "getStats">;
  log?: (line: string) => void;
  errorLog?: (line: string) => void;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function formatWindowSummary(label: string, summary: WorkflowActivitySummary): string {
  const failed = (summary.counts.failed ?? 0) + (summary.counts.terminal_failed ?? 0);
  return `${label}: ${summary.eventCount} events, completed=${summary.counts.completed ?? 0}, failed=${failed}, retried=${summary.counts.retried ?? 0}`;
}

function formatWorkflowActivitySummary(summary: WorkflowActivityDashboard | null | undefined): string[] {
  if (!summary || summary.windows.every((window) => window.summary.eventCount === 0)) {
    return ["1h: none", "24h: none", "7d: none"];
  }

  const lines = summary.windows.map((window) => formatWindowSummary(window.label, window.summary));
  if (summary.recentFailures.length > 0) {
    const latestFailure = summary.recentFailures[0];
    lines.push(`latest failure: ${latestFailure.workflowId} at ${latestFailure.at}`);
  }
  return lines;
}

function formatWorkflowOperationalSummary(summary: WorkflowOperationalDashboard | null | undefined): string {
  if (!summary) {
    return "unknown";
  }
  return `overdue=${summary.overdueWaiting.length}, stalled=${summary.stalledRunning.length}, paused=${summary.paused.length}, failed=${summary.failed.length}, high_failure=${summary.highFailure.length}, recent_active=${summary.recentActive.length}`;
}

function formatWorkflowProviderSummary(summary: WorkflowOperationalDashboard | null | undefined): string {
  if (!summary || summary.providerCounts.length === 0) {
    return "none";
  }
  return summary.providerCounts.map((entry) => `${entry.provider}=${entry.count}`).join(", ");
}

function formatWorkflowHotspotSummary(summary: WorkflowOperationalDashboard | null | undefined): string {
  if (!summary) {
    return "unknown";
  }

  const workspaceLabel =
    summary.workspaceHotspots.length > 0
      ? summary.workspaceHotspots.map((entry) => `${entry.workspaceKey}:${entry.activeCount}`).join(", ")
      : "none";
  const conversationLabel =
    summary.conversationHotspots.length > 0
      ? summary.conversationHotspots.map((entry) => `${entry.conversationKey}:${entry.activeCount}`).join(", ")
      : "none";
  return `workspaces=${workspaceLabel}; conversations=${conversationLabel}`;
}

export function createReadyHandler(options: ReadyHandlerOptions): () => Promise<void> {
  const log = options.log ?? console.log;
  const errorLog = options.errorLog ?? console.error;
  const startupErrorLog = (line: string): void => {
    errorLog(`[startup] ${line}`);
  };

  return async (): Promise<void> => {
    let adminLogs: AdminStartupLog[] = [];
    try {
      if (!options.discordClient.user) {
        throw new Error("Discord client user is unavailable after login");
      }

      log(`Discord bot logged in as ${options.discordClient.user.tag}`);
      const botTag = options.discordClient.user.tag;

      adminLogs = await createAdminStartupLogs(
        options.discordClient,
        options.config.restartAdminUserIds,
        formatStartupStatus({
          botTag,
          phase: "discord ready",
          sessionStoreLoaded: false,
          codexReady: false,
          codexDeferred: false,
          workspace: options.config.codexWorkspace,
          workflowCount: 0,
          dueWorkflowCount: 0,
          workflowRunnerState: "pending",
          workflowThreadPolicy: options.config.workflowDefaults.reuseConversationThread
            ? "reuse-conversation-thread"
            : "dedicated-workflow-thread",
        }),
        startupErrorLog,
      );

      await options.sessionStore.load();
      await options.workflowStore?.load?.();
      const loadedWorkflowCount = options.workflowService?.listWorkflows().length ?? 0;
      const dueWorkflowCount = options.workflowService?.listDueWorkflows().length ?? 0;
      const loadedActivitySummary = await options.workflowService?.getActivityDashboard?.();
      const loadedOperationalSummary = options.workflowService?.getOperationalDashboard?.();
      await updateAdminStartupLogs(
        adminLogs,
        formatStartupStatus({
          botTag,
          phase: "session store loaded",
          sessionStoreLoaded: true,
          codexReady: false,
          codexDeferred: false,
          workspace: options.config.codexWorkspace,
          workflowCount: loadedWorkflowCount,
          dueWorkflowCount,
          workflowRunnerState: "pending",
          workflowThreadPolicy: options.config.workflowDefaults.reuseConversationThread
            ? "reuse-conversation-thread"
            : "dedicated-workflow-thread",
          workflowProviderSummary: formatWorkflowProviderSummary(loadedOperationalSummary),
          workflowHotspotSummary: formatWorkflowHotspotSummary(loadedOperationalSummary),
          workflowActivitySummary: formatWorkflowActivitySummary(loadedActivitySummary),
          workflowOperationalSummary: formatWorkflowOperationalSummary(loadedOperationalSummary),
        }),
        startupErrorLog,
      );

      try {
        await options.codexClient.ensureStarted();
        log("[startup] Codex app-server is ready.");
        options.workflowRunner?.start?.();
        const runnerStats = options.workflowRunner?.getStats?.();
        const activitySummary = await options.workflowService?.getActivityDashboard?.();
        const operationalSummary = options.workflowService?.getOperationalDashboard?.();
        await updateAdminStartupLogs(
          adminLogs,
          formatStartupStatus({
            botTag,
            phase: "startup complete",
            sessionStoreLoaded: true,
            codexReady: true,
            codexDeferred: false,
            workspace: options.config.codexWorkspace,
            workflowCount: options.workflowService?.listWorkflows().length ?? 0,
            dueWorkflowCount: options.workflowService?.listDueWorkflows().length ?? 0,
            workflowRunnerState: runnerStats?.running ? "running" : "stopped",
            workflowThreadPolicy: options.config.workflowDefaults.reuseConversationThread
              ? "reuse-conversation-thread"
              : "dedicated-workflow-thread",
            workflowProviderSummary: formatWorkflowProviderSummary(operationalSummary),
            workflowHotspotSummary: formatWorkflowHotspotSummary(operationalSummary),
            workflowActivitySummary: formatWorkflowActivitySummary(activitySummary),
            workflowOperationalSummary: formatWorkflowOperationalSummary(operationalSummary),
          }),
          startupErrorLog,
        );
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        errorLog(
          `[startup] Codex app-server initialization failed: ${errorMessage}. The bot will stay online and retry when the next message needs Codex.`,
        );
        options.workflowRunner?.start?.();
        const runnerStats = options.workflowRunner?.getStats?.();
        const activitySummary = await options.workflowService?.getActivityDashboard?.();
        const operationalSummary = options.workflowService?.getOperationalDashboard?.();
        await updateAdminStartupLogs(
          adminLogs,
          formatStartupStatus({
            botTag,
            phase: "startup complete with deferred Codex initialization",
            sessionStoreLoaded: true,
            codexReady: false,
            codexDeferred: true,
            workspace: options.config.codexWorkspace,
            workflowCount: options.workflowService?.listWorkflows().length ?? 0,
            dueWorkflowCount: options.workflowService?.listDueWorkflows().length ?? 0,
            workflowRunnerState: runnerStats?.running ? "running" : "stopped",
            workflowThreadPolicy: options.config.workflowDefaults.reuseConversationThread
              ? "reuse-conversation-thread"
              : "dedicated-workflow-thread",
            workflowProviderSummary: formatWorkflowProviderSummary(operationalSummary),
            workflowHotspotSummary: formatWorkflowHotspotSummary(operationalSummary),
            workflowActivitySummary: formatWorkflowActivitySummary(activitySummary),
            workflowOperationalSummary: formatWorkflowOperationalSummary(operationalSummary),
            error: errorMessage,
          }),
          startupErrorLog,
        );
      }
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      errorLog(`[startup] Ready handler failed: ${errorMessage}`);
      if (options.discordClient.user && adminLogs.length > 0) {
        const activitySummary = await options.workflowService?.getActivityDashboard?.();
        const operationalSummary = options.workflowService?.getOperationalDashboard?.();
        await updateAdminStartupLogs(
          adminLogs,
          formatStartupStatus({
            botTag: options.discordClient.user.tag,
            phase: "startup failed",
            sessionStoreLoaded: false,
            codexReady: false,
            codexDeferred: false,
            workspace: options.config.codexWorkspace,
            workflowCount: options.workflowService?.listWorkflows().length ?? 0,
            dueWorkflowCount: options.workflowService?.listDueWorkflows().length ?? 0,
            workflowRunnerState: options.workflowRunner?.getStats?.().running ? "running" : "stopped",
            workflowThreadPolicy: options.config.workflowDefaults.reuseConversationThread
              ? "reuse-conversation-thread"
              : "dedicated-workflow-thread",
            workflowProviderSummary: formatWorkflowProviderSummary(operationalSummary),
            workflowHotspotSummary: formatWorkflowHotspotSummary(operationalSummary),
            workflowActivitySummary: formatWorkflowActivitySummary(activitySummary),
            workflowOperationalSummary: formatWorkflowOperationalSummary(operationalSummary),
            error: errorMessage,
          }),
          startupErrorLog,
        );
      }
    }
  };
}
