import fs from "node:fs/promises";
import path from "node:path";

export type WorkflowStatus = "queued" | "running" | "waiting" | "paused" | "completed" | "failed" | "cancelled";
export type WorkflowConversationKind = "dm" | "channel" | "thread";
export type WorkflowThreadPolicy = "reuse-conversation-thread" | "dedicated-workflow-thread";

export interface WorkflowRecord {
  id: string;
  conversationKey: string;
  workspaceKey: string;
  conversationKind: WorkflowConversationKind;
  channelId: string;
  guildId?: string | null;
  goal: string;
  cwd: string;
  model?: string | null;
  modelProvider?: string | null;
  threadId?: string | null;
  threadToolProfile?: string | null;
  threadPolicy?: WorkflowThreadPolicy | null;
  status: WorkflowStatus;
  createdAt: string;
  updatedAt: string;
  nextRunAt?: string | null;
  lastRunAt?: string | null;
  stepCount: number;
  failureCount: number;
  handoffSummary?: string | null;
  currentStep?: string | null;
  nextStep?: string | null;
  planChecklist?: string[] | null;
  planWarnings?: string[] | null;
  pendingPrompts?: string[] | null;
  lastAssistantMessage?: string | null;
  lastError?: string | null;
}

interface WorkflowStoreFile {
  workflows?: Record<string, WorkflowRecord>;
}

export class WorkflowStore {
  private readonly filePath: string;
  private workflows: Record<string, WorkflowRecord>;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.workflows = {};
  }

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as WorkflowStoreFile;
      this.workflows = parsed.workflows ?? {};
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== "ENOENT") {
        throw error;
      }
      this.workflows = {};
    }
  }

  get(id: string): WorkflowRecord | null {
    return this.workflows[id] ?? null;
  }

  list(): WorkflowRecord[] {
    return Object.values(this.workflows).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async set(record: WorkflowRecord): Promise<void> {
    this.workflows[record.id] = record;
    await this.save();
  }

  async delete(id: string): Promise<void> {
    delete this.workflows[id];
    await this.save();
  }

  private async save(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(
      this.filePath,
      JSON.stringify(
        {
          workflows: this.workflows,
        },
        null,
        2,
      ),
      "utf8",
    );
  }
}
