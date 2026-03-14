import fs from "node:fs/promises";
import path from "node:path";

export interface SessionRecord {
  threadId: string;
}

interface SessionStoreFile {
  sessions?: Record<string, SessionRecord>;
  workspaces?: Record<string, string>;
}

export class SessionStore {
  private readonly filePath: string;
  private sessions: Record<string, SessionRecord>;
  private workspaces: Record<string, string>;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.sessions = {};
    this.workspaces = {};
  }

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as SessionStoreFile;
      this.sessions = parsed.sessions ?? {};
      this.workspaces = parsed.workspaces ?? {};
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== "ENOENT") {
        throw error;
      }
      this.sessions = {};
      this.workspaces = {};
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

  private async save(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(
      this.filePath,
      JSON.stringify({ sessions: this.sessions, workspaces: this.workspaces }, null, 2),
      "utf8",
    );
  }
}
