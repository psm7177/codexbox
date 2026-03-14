import fs from "node:fs/promises";
import path from "node:path";
import type { SandboxMode } from "./config.js";

export interface SessionRecord {
  threadId: string;
}

export type ReplyMode = "mentionOnly" | "auto";

interface SessionStoreFile {
  sessions?: Record<string, SessionRecord>;
  workspaces?: Record<string, string>;
  workspaceNetworkAccess?: Record<string, boolean>;
  workspaceSandboxModes?: Record<string, SandboxMode>;
  workspaceReplyModes?: Record<string, ReplyMode>;
}

export class SessionStore {
  private readonly filePath: string;
  private sessions: Record<string, SessionRecord>;
  private workspaces: Record<string, string>;
  private workspaceNetworkAccess: Record<string, boolean>;
  private workspaceSandboxModes: Record<string, SandboxMode>;
  private workspaceReplyModes: Record<string, ReplyMode>;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.sessions = {};
    this.workspaces = {};
    this.workspaceNetworkAccess = {};
    this.workspaceSandboxModes = {};
    this.workspaceReplyModes = {};
  }

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as SessionStoreFile;
      this.sessions = parsed.sessions ?? {};
      this.workspaces = parsed.workspaces ?? {};
      this.workspaceNetworkAccess = parsed.workspaceNetworkAccess ?? {};
      this.workspaceSandboxModes = parsed.workspaceSandboxModes ?? {};
      this.workspaceReplyModes = parsed.workspaceReplyModes ?? {};
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== "ENOENT") {
        throw error;
      }
      this.sessions = {};
      this.workspaces = {};
      this.workspaceNetworkAccess = {};
      this.workspaceSandboxModes = {};
      this.workspaceReplyModes = {};
    }
  }

  get(conversationKey: string): SessionRecord | null {
    return this.sessions[conversationKey] ?? null;
  }

  async set(conversationKey: string, value: SessionRecord): Promise<void> {
    this.sessions[conversationKey] = value;
    await this.save();
  }

  async delete(conversationKey: string): Promise<void> {
    delete this.sessions[conversationKey];
    await this.save();
  }

  entries(): Array<[string, SessionRecord]> {
    return Object.entries(this.sessions);
  }

  getWorkspace(workspaceKey: string): string | null {
    return this.workspaces[workspaceKey] ?? null;
  }

  async setWorkspace(workspaceKey: string, cwd: string): Promise<void> {
    this.workspaces[workspaceKey] = cwd;
    await this.save();
  }

  async deleteWorkspace(workspaceKey: string): Promise<void> {
    delete this.workspaces[workspaceKey];
    await this.save();
  }

  getWorkspaceNetworkAccess(workspaceKey: string): boolean | null {
    return this.workspaceNetworkAccess[workspaceKey] ?? null;
  }

  async setWorkspaceNetworkAccess(workspaceKey: string, enabled: boolean): Promise<void> {
    this.workspaceNetworkAccess[workspaceKey] = enabled;
    await this.save();
  }

  async deleteWorkspaceNetworkAccess(workspaceKey: string): Promise<void> {
    delete this.workspaceNetworkAccess[workspaceKey];
    await this.save();
  }

  getWorkspaceSandboxMode(workspaceKey: string): SandboxMode | null {
    return this.workspaceSandboxModes[workspaceKey] ?? null;
  }

  async setWorkspaceSandboxMode(workspaceKey: string, mode: SandboxMode): Promise<void> {
    this.workspaceSandboxModes[workspaceKey] = mode;
    await this.save();
  }

  async deleteWorkspaceSandboxMode(workspaceKey: string): Promise<void> {
    delete this.workspaceSandboxModes[workspaceKey];
    await this.save();
  }

  getWorkspaceReplyMode(workspaceKey: string): ReplyMode | null {
    return this.workspaceReplyModes[workspaceKey] ?? null;
  }

  async setWorkspaceReplyMode(workspaceKey: string, mode: ReplyMode): Promise<void> {
    this.workspaceReplyModes[workspaceKey] = mode;
    await this.save();
  }

  async deleteWorkspaceReplyMode(workspaceKey: string): Promise<void> {
    delete this.workspaceReplyModes[workspaceKey];
    await this.save();
  }

  private async save(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(
      this.filePath,
      JSON.stringify(
        {
          sessions: this.sessions,
          workspaces: this.workspaces,
          workspaceNetworkAccess: this.workspaceNetworkAccess,
          workspaceSandboxModes: this.workspaceSandboxModes,
          workspaceReplyModes: this.workspaceReplyModes,
        },
        null,
        2,
      ),
      "utf8",
    );
  }
}
