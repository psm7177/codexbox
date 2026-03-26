import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { SandboxMode } from "../config.js";
import type {
  WorkflowConversationKind,
  WorkflowRecord,
  WorkflowStatus,
  WorkflowStore,
  WorkflowThreadPolicy,
} from "../workflow-store.js";

const DEFAULT_RETRY_BASE_DELAY_MS = 60_000;
const DEFAULT_RETRY_MAX_DELAY_MS = 60 * 60 * 1000;
const DEFAULT_MAX_FAILURES = 5;
const MAX_PENDING_PROMPTS = 8;
const FORBIDDEN_PENDING_PROMPT_PATTERNS = [
  /<\/?workflow_(?:plan|state|outputs)>/i,
  /ignore\s+(?:all\s+)?(?:previous|above)\s+instructions/i,
  /override\b.*\b(?:protocol|instructions|rules|preset)\b/i,
  /\bsystem\s+prompt\b/i,
  /\bmachine-readable\s+blocks?\b/i,
  /do\s+not\s+follow\b.*\b(?:protocol|instructions|rules)\b/i,
];

export interface WorkflowEventRecord {
  at: string;
  type: string;
  status: WorkflowStatus;
  stepCount: number;
  failureCount: number;
  message: string;
  nextRunAt?: string | null;
}

export interface WorkflowPlanRecord {
  currentStep: string | null;
  nextStep: string | null;
  checklist: string[];
}

export interface WorkflowActivitySummary {
  windowStartedAt: string;
  eventCount: number;
  counts: Record<string, number>;
  recentFailures: Array<{
    workflowId: string;
    at: string;
    type: string;
    message: string;
  }>;
}

export interface WorkflowActivityWindow {
  label: string;
  summary: WorkflowActivitySummary;
}

export interface WorkflowActivityDashboard {
  windows: WorkflowActivityWindow[];
  recentFailures: WorkflowActivitySummary["recentFailures"];
}

export interface WorkflowOperationalDashboard {
  overdueWaiting: WorkflowRecord[];
  stalledRunning: WorkflowRecord[];
  paused: WorkflowRecord[];
  failed: WorkflowRecord[];
  highFailure: WorkflowRecord[];
  recentActive: WorkflowRecord[];
  statusCounts: Record<WorkflowStatus, number>;
  providerCounts: Array<{
    provider: string;
    count: number;
  }>;
  workspaceHotspots: Array<{
    workspaceKey: string;
    activeCount: number;
    totalCount: number;
  }>;
  conversationHotspots: Array<{
    conversationKey: string;
    activeCount: number;
    totalCount: number;
  }>;
}

function normalizeThreadPolicy(policy: WorkflowThreadPolicy | null | undefined): WorkflowThreadPolicy {
  return policy === "reuse-conversation-thread" ? "reuse-conversation-thread" : "dedicated-workflow-thread";
}

function nowIso(): string {
  return new Date().toISOString();
}

function sortCountEntries<T extends { count: number }>(left: T, right: T): number {
  return right.count - left.count;
}

function clampSummary(summary: string | null | undefined, maxLength = 2_000): string | null {
  const trimmed = summary?.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 3).trimEnd()}...` : trimmed;
}

function clampMessage(message: string | null | undefined, maxLength = 8_000): string | null {
  const trimmed = message?.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 3).trimEnd()}...` : trimmed;
}

function clampChecklist(checklist: string[] | null | undefined): string[] | null {
  if (!checklist || checklist.length === 0) {
    return null;
  }

  return checklist
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 12)
    .map((entry) => (entry.length > 200 ? `${entry.slice(0, 197).trimEnd()}...` : entry));
}

function clampPendingPrompts(prompts: string[] | null | undefined): string[] | null {
  if (!prompts || prompts.length === 0) {
    return null;
  }

  return prompts
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(-MAX_PENDING_PROMPTS)
    .map((entry) => (entry.length > 1_000 ? `${entry.slice(0, 997).trimEnd()}...` : entry));
}

function clampPlanWarnings(warnings: string[] | null | undefined): string[] | null {
  if (!warnings || warnings.length === 0) {
    return null;
  }

  return warnings
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 12)
    .map((entry) => (entry.length > 300 ? `${entry.slice(0, 297).trimEnd()}...` : entry));
}

function sanitizePendingPrompt(prompt: string): string | null {
  const sanitized = prompt
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !FORBIDDEN_PENDING_PROMPT_PATTERNS.some((pattern) => pattern.test(line)))
    .join("\n")
    .trim();

  return sanitized || null;
}

export class WorkflowService {
  private readonly store: Pick<WorkflowStore, "get" | "list" | "set">;
  private readonly artifactsRoot: string;
  private readonly retryBaseDelayMs: number;
  private readonly retryMaxDelayMs: number;
  private readonly maxFailures: number;

  constructor(
    store: Pick<WorkflowStore, "get" | "list" | "set">,
    options?: {
      artifactsRoot?: string;
      retryBaseDelayMs?: number;
      retryMaxDelayMs?: number;
      maxFailures?: number;
    },
  ) {
    this.store = store;
    this.artifactsRoot = options?.artifactsRoot ?? path.resolve(".data", "workflows");
    this.retryBaseDelayMs = options?.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
    this.retryMaxDelayMs = options?.retryMaxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS;
    this.maxFailures = options?.maxFailures ?? DEFAULT_MAX_FAILURES;
  }

  getWorkflow(id: string): WorkflowRecord | null {
    return this.store.get(id);
  }

  listWorkflows(): WorkflowRecord[] {
    return this.store.list();
  }

  listConversationWorkflows(conversationKey: string): WorkflowRecord[] {
    return this.store.list().filter((workflow) => workflow.conversationKey === conversationKey);
  }

  findDuplicateActiveWorkflow(conversationKey: string, goal: string): WorkflowRecord | null {
    const normalizedGoal = goal.trim().toLowerCase().replace(/\s+/g, " ");
    return (
      this.store
        .list()
        .find(
          (workflow) =>
            workflow.conversationKey === conversationKey &&
            ["queued", "running", "waiting", "paused"].includes(workflow.status) &&
            workflow.goal.trim().toLowerCase().replace(/\s+/g, " ") === normalizedGoal,
        ) ?? null
    );
  }

  listDueWorkflows(at = new Date()): WorkflowRecord[] {
    return this.store
      .list()
      .filter((workflow) => {
        if (workflow.status !== "queued" && workflow.status !== "waiting") {
          return false;
        }
        if (!workflow.nextRunAt) {
          return true;
        }
        return new Date(workflow.nextRunAt).getTime() <= at.getTime();
      })
      .sort((a, b) => {
        const aTime = a.nextRunAt ? new Date(a.nextRunAt).getTime() : 0;
        const bTime = b.nextRunAt ? new Date(b.nextRunAt).getTime() : 0;
        return aTime - bTime || a.createdAt.localeCompare(b.createdAt);
      });
  }

  getWorkflowArtifactPaths(id: string): {
    directory: string;
    status: string;
    handoff: string;
    plan: string;
    planWarnings: string;
    pendingPrompts: string;
    lastAssistantMessage: string;
    events: string;
  } {
    const directory = path.join(this.artifactsRoot, id);
    return {
      directory,
      status: path.join(directory, "status.md"),
      handoff: path.join(directory, "handoff.md"),
      plan: path.join(directory, "plan.md"),
      planWarnings: path.join(directory, "plan-warnings.md"),
      pendingPrompts: path.join(directory, "pending-prompts.md"),
      lastAssistantMessage: path.join(directory, "last-assistant-message.md"),
      events: path.join(directory, "events.jsonl"),
    };
  }

  async readRecentEvents(id: string, limit = 10): Promise<WorkflowEventRecord[]> {
    const paths = this.getWorkflowArtifactPaths(id);
    try {
      return (await this.readAllEventsForWorkflow(id)).slice(-limit);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  async getActivitySummary(windowMs = 24 * 60 * 60 * 1000, recentFailureLimit = 5): Promise<WorkflowActivitySummary> {
    const cutoff = Date.now() - windowMs;
    const counts: Record<string, number> = {};
    const recentFailures: Array<{
      workflowId: string;
      at: string;
      type: string;
      message: string;
    }> = [];
    let eventCount = 0;

    for (const workflow of this.store.list()) {
      const events = await this.readAllEventsForWorkflow(workflow.id);
      for (const event of events) {
        const eventTime = new Date(event.at).getTime();
        if (!Number.isFinite(eventTime) || eventTime < cutoff) {
          continue;
        }

        eventCount += 1;
        counts[event.type] = (counts[event.type] ?? 0) + 1;

        if (event.type === "failed" || event.type === "terminal_failed") {
          recentFailures.push({
            workflowId: workflow.id,
            at: event.at,
            type: event.type,
            message: event.message,
          });
        }
      }
    }

    recentFailures.sort((a, b) => b.at.localeCompare(a.at));

    return {
      windowStartedAt: new Date(cutoff).toISOString(),
      eventCount,
      counts,
      recentFailures: recentFailures.slice(0, recentFailureLimit),
    };
  }

  async getActivityDashboard(): Promise<WorkflowActivityDashboard> {
    const [hour, day, week] = await Promise.all([
      this.getActivitySummary(60 * 60 * 1000, 5),
      this.getActivitySummary(24 * 60 * 60 * 1000, 5),
      this.getActivitySummary(7 * 24 * 60 * 60 * 1000, 5),
    ]);

    return {
      windows: [
        { label: "1h", summary: hour },
        { label: "24h", summary: day },
        { label: "7d", summary: week },
      ],
      recentFailures: day.recentFailures,
    };
  }

  getOperationalDashboard(now = new Date()): WorkflowOperationalDashboard {
    const nowMs = now.getTime();
    const stalledRunningThresholdMs = 30 * 60 * 1000;
    const workflows = this.store.list();
    const statusCounts: Record<WorkflowStatus, number> = {
      queued: 0,
      running: 0,
      waiting: 0,
      paused: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    };
    const providerCounts = new Map<string, number>();
    const workspaceCounts = new Map<string, { totalCount: number; activeCount: number }>();
    const conversationCounts = new Map<string, { totalCount: number; activeCount: number }>();

    for (const workflow of workflows) {
      statusCounts[workflow.status] += 1;

      const providerKey = workflow.modelProvider?.trim() || "default";
      providerCounts.set(providerKey, (providerCounts.get(providerKey) ?? 0) + 1);

      const workspaceEntry = workspaceCounts.get(workflow.workspaceKey) ?? { totalCount: 0, activeCount: 0 };
      workspaceEntry.totalCount += 1;
      if (["queued", "running", "waiting", "paused"].includes(workflow.status)) {
        workspaceEntry.activeCount += 1;
      }
      workspaceCounts.set(workflow.workspaceKey, workspaceEntry);

      const conversationEntry = conversationCounts.get(workflow.conversationKey) ?? { totalCount: 0, activeCount: 0 };
      conversationEntry.totalCount += 1;
      if (["queued", "running", "waiting", "paused"].includes(workflow.status)) {
        conversationEntry.activeCount += 1;
      }
      conversationCounts.set(workflow.conversationKey, conversationEntry);
    }

    const overdueWaiting = workflows
      .filter((workflow) => {
        if (workflow.status !== "waiting" && workflow.status !== "queued") {
          return false;
        }
        if (!workflow.nextRunAt) {
          return workflow.status === "queued";
        }
        return new Date(workflow.nextRunAt).getTime() <= nowMs;
      })
      .sort((a, b) => (a.nextRunAt ?? "").localeCompare(b.nextRunAt ?? ""))
      .slice(0, 5);

    const stalledRunning = workflows
      .filter((workflow) => {
        if (workflow.status !== "running" || !workflow.lastRunAt) {
          return false;
        }
        return nowMs - new Date(workflow.lastRunAt).getTime() >= stalledRunningThresholdMs;
      })
      .sort((a, b) => a.lastRunAt!.localeCompare(b.lastRunAt!))
      .slice(0, 5);

    const failed = workflows
      .filter((workflow) => workflow.status === "failed")
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 5);

    const paused = workflows
      .filter((workflow) => workflow.status === "paused")
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 5);

    const highFailure = workflows
      .filter((workflow) => workflow.failureCount > 0)
      .sort((a, b) => b.failureCount - a.failureCount || b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 5);

    const recentActive = workflows
      .filter((workflow) => ["queued", "running", "waiting", "paused"].includes(workflow.status))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 5);

    return {
      overdueWaiting,
      stalledRunning,
      paused,
      failed,
      highFailure,
      recentActive,
      statusCounts,
      providerCounts: Array.from(providerCounts.entries())
        .map(([provider, count]) => ({ provider, count }))
        .sort(sortCountEntries)
        .slice(0, 5),
      workspaceHotspots: Array.from(workspaceCounts.entries())
        .map(([workspaceKey, counts]) => ({ workspaceKey, ...counts }))
        .sort((a, b) => b.activeCount - a.activeCount || b.totalCount - a.totalCount || a.workspaceKey.localeCompare(b.workspaceKey))
        .slice(0, 5),
      conversationHotspots: Array.from(conversationCounts.entries())
        .map(([conversationKey, counts]) => ({ conversationKey, ...counts }))
        .sort(
          (a, b) =>
            b.activeCount - a.activeCount || b.totalCount - a.totalCount || a.conversationKey.localeCompare(b.conversationKey),
        )
        .slice(0, 5),
    };
  }

  async createWorkflow(input: {
    conversationKey: string;
    workspaceKey: string;
    conversationKind: WorkflowConversationKind;
    channelId: string;
    guildId?: string | null;
    goal: string;
    cwd: string;
    sandboxMode?: SandboxMode | null;
    networkAccess?: boolean | null;
    model?: string | null;
    modelProvider?: string | null;
    threadId?: string | null;
    threadToolProfile?: string | null;
    threadPolicy?: WorkflowThreadPolicy | null;
  }): Promise<WorkflowRecord> {
    const timestamp = nowIso();
    const record: WorkflowRecord = {
      id: `wf_${randomUUID().slice(0, 8)}`,
      conversationKey: input.conversationKey,
      workspaceKey: input.workspaceKey,
      conversationKind: input.conversationKind,
      channelId: input.channelId,
      guildId: input.guildId ?? null,
      goal: input.goal.trim(),
      cwd: input.cwd,
      sandboxMode: input.sandboxMode ?? null,
      networkAccess: input.networkAccess ?? null,
      model: input.model ?? null,
      modelProvider: input.modelProvider ?? null,
      threadId: input.threadId ?? null,
      threadToolProfile: input.threadToolProfile ?? null,
      threadPolicy: normalizeThreadPolicy(input.threadPolicy),
      status: "queued",
      createdAt: timestamp,
      updatedAt: timestamp,
      nextRunAt: timestamp,
      lastRunAt: null,
      stepCount: 0,
      failureCount: 0,
      handoffSummary: null,
      currentStep: null,
      nextStep: null,
      planChecklist: null,
      planWarnings: null,
      pendingPrompts: null,
      lastAssistantMessage: null,
      lastError: null,
    };
    await this.saveRecord(record, {
      type: "created",
      message: "Workflow queued.",
    });
    return record;
  }

  async cancelWorkflow(id: string): Promise<WorkflowRecord | null> {
    const workflow = this.store.get(id);
    if (!workflow || workflow.status === "completed" || workflow.status === "cancelled") {
      return null;
    }

    const updated: WorkflowRecord = {
      ...workflow,
      status: "cancelled",
      nextRunAt: null,
      updatedAt: nowIso(),
    };
    await this.saveRecord(updated, {
      type: "cancelled",
      message: "Workflow cancelled.",
    });
    return updated;
  }

  async pauseWorkflow(id: string): Promise<WorkflowRecord | null> {
    const workflow = this.store.get(id);
    if (!workflow || workflow.status === "running" || workflow.status === "completed" || workflow.status === "cancelled") {
      return null;
    }

    const updated: WorkflowRecord = {
      ...workflow,
      status: "paused",
      updatedAt: nowIso(),
      nextRunAt: null,
    };
    await this.saveRecord(updated, {
      type: "paused",
      message: "Workflow paused.",
    });
    return updated;
  }

  async resumeWorkflow(id: string, nextRunAt = new Date()): Promise<WorkflowRecord | null> {
    const workflow = this.store.get(id);
    if (!workflow || (workflow.status !== "paused" && workflow.status !== "failed")) {
      return null;
    }

    const updated: WorkflowRecord = {
      ...workflow,
      status: "waiting",
      updatedAt: nowIso(),
      nextRunAt: nextRunAt.toISOString(),
      failureCount: workflow.status === "failed" ? 0 : workflow.failureCount,
      lastError: null,
    };
    await this.saveRecord(updated, {
      type: "resumed",
      message: "Workflow resumed.",
    });
    return updated;
  }

  async retryWorkflow(
    id: string,
    input?: {
      nextRunAt?: Date;
      threadPolicy?: WorkflowThreadPolicy | null;
      threadId?: string | null;
      threadToolProfile?: string | null;
    },
  ): Promise<WorkflowRecord | null> {
    const workflow = this.store.get(id);
    if (!workflow || workflow.status !== "failed") {
      return null;
    }

    const nextRunAt = input?.nextRunAt ?? new Date();
    const hasThreadIdOverride = Boolean(input && Object.prototype.hasOwnProperty.call(input, "threadId"));
    const hasThreadToolProfileOverride = Boolean(input && Object.prototype.hasOwnProperty.call(input, "threadToolProfile"));
    const updated: WorkflowRecord = {
      ...workflow,
      status: "waiting",
      updatedAt: nowIso(),
      nextRunAt: nextRunAt.toISOString(),
      failureCount: 0,
      lastError: null,
      threadPolicy: normalizeThreadPolicy(input?.threadPolicy ?? workflow.threadPolicy),
      threadId: hasThreadIdOverride ? (input?.threadId ?? null) : (workflow.threadId ?? null),
      threadToolProfile: hasThreadToolProfileOverride ? (input?.threadToolProfile ?? null) : (workflow.threadToolProfile ?? null),
    };
    await this.saveRecord(updated, {
      type: "retried",
      message: "Workflow retried with overridden parameters.",
    });
    return updated;
  }

  async appendPendingPrompt(id: string, prompt: string): Promise<WorkflowRecord | null> {
    const workflow = this.store.get(id);
    if (!workflow || workflow.status === "completed" || workflow.status === "cancelled") {
      return null;
    }

    const sanitizedPrompt = sanitizePendingPrompt(prompt);
    if (!sanitizedPrompt) {
      return null;
    }

    const updated: WorkflowRecord = {
      ...workflow,
      updatedAt: nowIso(),
      pendingPrompts: clampPendingPrompts([...(workflow.pendingPrompts ?? []), sanitizedPrompt]),
      nextRunAt:
        workflow.status === "waiting" || workflow.status === "queued" || workflow.status === "failed"
          ? new Date().toISOString()
          : workflow.nextRunAt ?? null,
      status: workflow.status === "failed" ? "waiting" : workflow.status,
      lastError: workflow.status === "failed" ? null : workflow.lastError ?? null,
      failureCount: workflow.status === "failed" ? 0 : workflow.failureCount,
    };
    await this.saveRecord(updated, {
      type: "prompt_appended",
      message: "Operator prompt queued for the next workflow step.",
    });
    return updated;
  }

  async markRunning(id: string, updates?: { threadId?: string | null; threadToolProfile?: string | null }): Promise<WorkflowRecord | null> {
    const workflow = this.store.get(id);
    if (!workflow) {
      return null;
    }

    const currentTime = nowIso();
    const updated: WorkflowRecord = {
      ...workflow,
      status: "running",
      updatedAt: currentTime,
      lastRunAt: currentTime,
      threadId: updates?.threadId ?? workflow.threadId ?? null,
      threadToolProfile: updates?.threadToolProfile ?? workflow.threadToolProfile ?? null,
      threadPolicy: normalizeThreadPolicy(workflow.threadPolicy),
    };
    await this.saveRecord(updated, {
      type: "running",
      message: "Workflow step started.",
    });
    return updated;
  }

  async markWaiting(
    id: string,
    input: {
      nextRunAt: Date;
      handoffSummary?: string | null;
      plan?: WorkflowPlanRecord | null;
      planWarnings?: string[] | null;
      lastAssistantMessage?: string | null;
      threadId?: string | null;
      threadToolProfile?: string | null;
      clearError?: boolean;
      clearPendingPrompts?: boolean;
    },
  ): Promise<WorkflowRecord | null> {
    const workflow = this.store.get(id);
    if (!workflow) {
      return null;
    }

    const updated: WorkflowRecord = {
      ...workflow,
      status: workflow.status === "cancelled" ? "cancelled" : workflow.status === "paused" ? "paused" : "waiting",
      updatedAt: nowIso(),
      nextRunAt: workflow.status === "cancelled" || workflow.status === "paused" ? null : input.nextRunAt.toISOString(),
      stepCount: workflow.stepCount + 1,
      failureCount: input.clearError ? 0 : workflow.failureCount,
      handoffSummary: clampSummary(input.handoffSummary ?? workflow.handoffSummary),
      currentStep: clampSummary(input.plan?.currentStep ?? workflow.currentStep, 400),
      nextStep: clampSummary(input.plan?.nextStep ?? workflow.nextStep, 400),
      planChecklist: clampChecklist(input.plan?.checklist ?? workflow.planChecklist),
      planWarnings: clampPlanWarnings(input.planWarnings ?? workflow.planWarnings),
      pendingPrompts: input.clearPendingPrompts ? null : clampPendingPrompts(workflow.pendingPrompts),
      lastAssistantMessage: clampMessage(input.lastAssistantMessage ?? workflow.lastAssistantMessage),
      lastError: input.clearError ? null : workflow.lastError ?? null,
      threadId: input.threadId ?? workflow.threadId ?? null,
      threadToolProfile: input.threadToolProfile ?? workflow.threadToolProfile ?? null,
      threadPolicy: normalizeThreadPolicy(workflow.threadPolicy),
    };
    await this.saveRecord(updated, {
      type: "waiting",
      message:
        updated.status === "cancelled"
          ? "Workflow step finished after a cancellation request; it will not be scheduled again."
          : updated.status === "paused"
          ? "Workflow step finished while paused; waiting for manual resume."
          : "Workflow step finished and scheduled another run.",
    });
    return updated;
  }

  async markCompleted(
    id: string,
    input: {
      handoffSummary?: string | null;
      plan?: WorkflowPlanRecord | null;
      planWarnings?: string[] | null;
      lastAssistantMessage?: string | null;
      threadId?: string | null;
      threadToolProfile?: string | null;
      clearPendingPrompts?: boolean;
    },
  ): Promise<WorkflowRecord | null> {
    const workflow = this.store.get(id);
    if (!workflow) {
      return null;
    }

    const updated: WorkflowRecord = {
      ...workflow,
      status: workflow.status === "cancelled" ? "cancelled" : "completed",
      updatedAt: nowIso(),
      nextRunAt: null,
      stepCount: workflow.stepCount + 1,
      failureCount: 0,
      handoffSummary: clampSummary(input.handoffSummary ?? workflow.handoffSummary),
      currentStep: clampSummary(input.plan?.currentStep ?? workflow.currentStep, 400),
      nextStep: clampSummary(input.plan?.nextStep ?? workflow.nextStep, 400),
      planChecklist: clampChecklist(input.plan?.checklist ?? workflow.planChecklist),
      planWarnings: clampPlanWarnings(input.planWarnings ?? workflow.planWarnings),
      pendingPrompts: input.clearPendingPrompts ? null : clampPendingPrompts(workflow.pendingPrompts),
      lastAssistantMessage: clampMessage(input.lastAssistantMessage ?? workflow.lastAssistantMessage),
      lastError: null,
      threadId: input.threadId ?? workflow.threadId ?? null,
      threadToolProfile: input.threadToolProfile ?? workflow.threadToolProfile ?? null,
      threadPolicy: normalizeThreadPolicy(workflow.threadPolicy),
    };
    await this.saveRecord(updated, {
      type: updated.status === "cancelled" ? "cancelled" : "completed",
      message:
        updated.status === "cancelled"
          ? "Workflow step finished after a cancellation request; workflow remains cancelled."
          : "Workflow completed.",
    });
    return updated;
  }

  async markFailed(
    id: string,
    input: {
      error: string;
      retryAt?: Date;
      threadId?: string | null;
      threadToolProfile?: string | null;
      clearPendingPrompts?: boolean;
      clearPlanWarnings?: boolean;
    },
  ): Promise<WorkflowRecord | null> {
    const workflow = this.store.get(id);
    if (!workflow) {
      return null;
    }

    const failureCount = workflow.failureCount + 1;
    const retryAt = input.retryAt ?? new Date(Date.now() + this.getRetryDelayMs(workflow.failureCount));
    const nextStatus: WorkflowStatus =
      workflow.status === "cancelled"
        ? "cancelled"
        : workflow.status === "paused"
          ? "paused"
          : failureCount >= this.maxFailures
            ? "failed"
            : "waiting";

    const updated: WorkflowRecord = {
      ...workflow,
      status: nextStatus,
      updatedAt: nowIso(),
      nextRunAt: nextStatus === "waiting" ? retryAt.toISOString() : null,
      failureCount,
      lastError: clampMessage(input.error, 2_000),
      planWarnings: input.clearPlanWarnings ? null : clampPlanWarnings(workflow.planWarnings),
      pendingPrompts: input.clearPendingPrompts ? null : clampPendingPrompts(workflow.pendingPrompts),
      threadId: input.threadId ?? workflow.threadId ?? null,
      threadToolProfile: input.threadToolProfile ?? workflow.threadToolProfile ?? null,
      threadPolicy: normalizeThreadPolicy(workflow.threadPolicy),
    };
    await this.saveRecord(updated, {
      type: "failed",
      message:
        nextStatus === "cancelled"
          ? `Workflow step failed after a cancellation request: ${input.error}`
          : nextStatus === "waiting"
          ? `Workflow step failed and will retry: ${input.error}`
          : `Workflow failed: ${input.error}`,
    });
    return updated;
  }

  async markTerminalFailed(
    id: string,
    input: {
      error: string;
      threadId?: string | null;
      threadToolProfile?: string | null;
      clearPendingPrompts?: boolean;
      clearPlanWarnings?: boolean;
    },
  ): Promise<WorkflowRecord | null> {
    const workflow = this.store.get(id);
    if (!workflow) {
      return null;
    }

    const updated: WorkflowRecord = {
      ...workflow,
      status: workflow.status === "cancelled" ? "cancelled" : "failed",
      updatedAt: nowIso(),
      nextRunAt: null,
      stepCount: workflow.stepCount + 1,
      lastError: clampMessage(input.error, 2_000),
      planWarnings: input.clearPlanWarnings ? null : clampPlanWarnings(workflow.planWarnings),
      pendingPrompts: input.clearPendingPrompts ? null : clampPendingPrompts(workflow.pendingPrompts),
      threadId: input.threadId ?? workflow.threadId ?? null,
      threadToolProfile: input.threadToolProfile ?? workflow.threadToolProfile ?? null,
      threadPolicy: normalizeThreadPolicy(workflow.threadPolicy),
    };
    await this.saveRecord(updated, {
      type: updated.status === "cancelled" ? "cancelled" : "terminal_failed",
      message:
        updated.status === "cancelled"
          ? `Workflow step failed after a cancellation request: ${input.error}`
          : `Workflow failed without retry: ${input.error}`,
    });
    return updated;
  }

  private getRetryDelayMs(failureCount: number): number {
    return Math.min(this.retryMaxDelayMs, this.retryBaseDelayMs * 2 ** Math.max(0, failureCount));
  }

  private async saveRecord(
    record: WorkflowRecord,
    event?: {
      type: string;
      message: string;
    },
  ): Promise<void> {
    await this.store.set(record);
    await this.writeArtifacts(record);
    if (event) {
      await this.appendEvent(record, event.type, event.message);
    }
  }

  private async writeArtifacts(record: WorkflowRecord): Promise<void> {
    const paths = this.getWorkflowArtifactPaths(record.id);
    await fs.mkdir(paths.directory, { recursive: true });

    const statusLines = [
      `# Workflow ${record.id}`,
      "",
      `- status: \`${record.status}\``,
      `- goal: ${record.goal}`,
      `- conversation: \`${record.conversationKey}\``,
      `- workspace: \`${record.workspaceKey}\``,
      `- cwd: \`${record.cwd}\``,
      `- channel_id: \`${record.channelId}\``,
      `- guild_id: \`${record.guildId ?? "dm"}\``,
      `- model: \`${record.model ?? "default"}\``,
      `- provider: \`${record.modelProvider ?? "default"}\``,
      `- sandbox_mode: \`${record.sandboxMode ?? "default"}\``,
      `- network_access: \`${record.networkAccess == null ? "default" : record.networkAccess ? "on" : "off"}\``,
      `- thread_id: \`${record.threadId ?? "none"}\``,
      `- thread_tool_profile: \`${record.threadToolProfile ?? "none"}\``,
      `- thread_policy: \`${normalizeThreadPolicy(record.threadPolicy)}\``,
      `- step_count: \`${record.stepCount}\``,
      `- failure_count: \`${record.failureCount}\``,
      `- current_step: \`${record.currentStep ?? "none"}\``,
      `- next_step: \`${record.nextStep ?? "none"}\``,
      `- plan_warnings: \`${record.planWarnings?.length ?? 0}\``,
      `- pending_prompts: \`${record.pendingPrompts?.length ?? 0}\``,
      `- created_at: \`${record.createdAt}\``,
      `- updated_at: \`${record.updatedAt}\``,
      `- last_run_at: \`${record.lastRunAt ?? "never"}\``,
      `- next_run_at: \`${record.nextRunAt ?? "none"}\``,
      `- last_error: ${record.lastError ? `\`${record.lastError}\`` : "`none`"}`,
    ];
    await fs.writeFile(paths.status, `${statusLines.join("\n")}\n`, "utf8");

    const handoffContent = record.handoffSummary ? `${record.handoffSummary}\n` : "No handoff summary recorded.\n";
    await fs.writeFile(paths.handoff, handoffContent, "utf8");

    const assistantMessageContent = record.lastAssistantMessage
      ? `${record.lastAssistantMessage}\n`
      : "No assistant message recorded.\n";
    await fs.writeFile(paths.lastAssistantMessage, assistantMessageContent, "utf8");

    const planLines = [
      `Current step: ${record.currentStep ?? "none"}`,
      `Next step: ${record.nextStep ?? "none"}`,
      "",
      "Checklist:",
      ...(record.planChecklist && record.planChecklist.length > 0
        ? record.planChecklist.map((entry) => `- ${entry}`)
        : ["- No checklist recorded."]),
    ];
    await fs.writeFile(paths.plan, `${planLines.join("\n")}\n`, "utf8");

    const planWarningLines = [
      "Plan warnings:",
      ...(record.planWarnings && record.planWarnings.length > 0
        ? record.planWarnings.map((entry) => `- ${entry}`)
        : ["- No plan warnings."]),
    ];
    await fs.writeFile(paths.planWarnings, `${planWarningLines.join("\n")}\n`, "utf8");

    const pendingPromptLines = [
      "Pending prompts:",
      ...(record.pendingPrompts && record.pendingPrompts.length > 0
        ? record.pendingPrompts.map((entry, index) => `${index + 1}. ${entry}`)
        : ["- No pending prompts."]),
    ];
    await fs.writeFile(paths.pendingPrompts, `${pendingPromptLines.join("\n")}\n`, "utf8");
  }

  private async readAllEventsForWorkflow(id: string): Promise<WorkflowEventRecord[]> {
    const paths = this.getWorkflowArtifactPaths(id);
    const raw = await fs.readFile(paths.events, "utf8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as WorkflowEventRecord);
  }

  private async appendEvent(record: WorkflowRecord, type: string, message: string): Promise<void> {
    const paths = this.getWorkflowArtifactPaths(record.id);
    await fs.mkdir(paths.directory, { recursive: true });
    const event: WorkflowEventRecord = {
      at: nowIso(),
      type,
      status: record.status,
      stepCount: record.stepCount,
      failureCount: record.failureCount,
      nextRunAt: record.nextRunAt ?? null,
      message,
    };
    await fs.appendFile(paths.events, `${JSON.stringify(event)}\n`, "utf8");
  }
}
