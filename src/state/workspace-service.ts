import fs from "node:fs/promises";
import path from "node:path";
import type { Config, SandboxMode } from "../config.js";
import type { ReplyMode, SessionStore } from "../session-store.js";

export function isPathWithinRoot(targetPath: string, rootPath: string): boolean {
  const relative = path.relative(rootPath, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function normalizeCwd(baseWorkspace: string, cwd: string): string {
  const workspaceRoot = path.resolve(baseWorkspace);
  const resolvedPath = path.resolve(cwd);
  return isPathWithinRoot(resolvedPath, workspaceRoot) ? resolvedPath : workspaceRoot;
}

export class WorkspaceService {
  private readonly store: Pick<
    SessionStore,
    | "getWorkspace"
    | "setWorkspace"
    | "deleteWorkspace"
    | "getWorkspaceNetworkAccess"
    | "setWorkspaceNetworkAccess"
    | "deleteWorkspaceNetworkAccess"
    | "getWorkspaceSandboxMode"
    | "setWorkspaceSandboxMode"
    | "deleteWorkspaceSandboxMode"
    | "getWorkspaceReplyMode"
    | "setWorkspaceReplyMode"
    | "deleteWorkspaceReplyMode"
  >;
  private readonly defaults: Pick<Config, "codexWorkspace" | "sandboxMode" | "sandboxNetworkAccess">;

  constructor(
    store: Pick<
      SessionStore,
      | "getWorkspace"
      | "setWorkspace"
      | "deleteWorkspace"
      | "getWorkspaceNetworkAccess"
      | "setWorkspaceNetworkAccess"
      | "deleteWorkspaceNetworkAccess"
      | "getWorkspaceSandboxMode"
      | "setWorkspaceSandboxMode"
      | "deleteWorkspaceSandboxMode"
      | "getWorkspaceReplyMode"
      | "setWorkspaceReplyMode"
      | "deleteWorkspaceReplyMode"
    >,
    defaults: Pick<Config, "codexWorkspace" | "sandboxMode" | "sandboxNetworkAccess">,
  ) {
    this.store = store;
    this.defaults = defaults;
  }

  getCwd(workspaceKey: string): string {
    const stored = this.store.getWorkspace(workspaceKey);
    return normalizeCwd(this.defaults.codexWorkspace, stored ?? this.defaults.codexWorkspace);
  }

  async setCwd(workspaceKey: string, cwd: string): Promise<void> {
    const normalized = normalizeCwd(this.defaults.codexWorkspace, cwd);
    if (normalized !== path.resolve(cwd)) {
      throw new Error(`cwd must stay within \`${this.defaults.codexWorkspace}\``);
    }

    const stats = await fs.stat(normalized);
    if (!stats.isDirectory()) {
      throw new Error(`cwd is not a directory: \`${normalized}\``);
    }

    await this.store.setWorkspace(workspaceKey, normalized);
  }

  async resetCwd(workspaceKey: string): Promise<void> {
    await this.store.deleteWorkspace(workspaceKey);
  }

  getSandboxMode(workspaceKey: string): SandboxMode {
    return this.store.getWorkspaceSandboxMode(workspaceKey) ?? this.defaults.sandboxMode;
  }

  async setSandboxMode(workspaceKey: string, mode: SandboxMode): Promise<void> {
    await this.store.setWorkspaceSandboxMode(workspaceKey, mode);
  }

  async resetSandboxMode(workspaceKey: string): Promise<void> {
    await this.store.deleteWorkspaceSandboxMode(workspaceKey);
  }

  getNetworkAccess(workspaceKey: string): boolean {
    return this.store.getWorkspaceNetworkAccess(workspaceKey) ?? this.defaults.sandboxNetworkAccess;
  }

  async setNetworkAccess(workspaceKey: string, enabled: boolean): Promise<void> {
    await this.store.setWorkspaceNetworkAccess(workspaceKey, enabled);
  }

  async resetNetworkAccess(workspaceKey: string): Promise<void> {
    await this.store.deleteWorkspaceNetworkAccess(workspaceKey);
  }

  getReplyMode(workspaceKey: string): ReplyMode {
    return this.store.getWorkspaceReplyMode(workspaceKey) ?? "mentionOnly";
  }

  async setReplyMode(workspaceKey: string, mode: ReplyMode): Promise<void> {
    await this.store.setWorkspaceReplyMode(workspaceKey, mode);
  }

  async resetReplyMode(workspaceKey: string): Promise<void> {
    await this.store.deleteWorkspaceReplyMode(workspaceKey);
  }
}
