import type { Config, SandboxMode } from "../config.js";
import type { SessionStore } from "../session-store.js";

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
    >,
    defaults: Pick<Config, "codexWorkspace" | "sandboxMode" | "sandboxNetworkAccess">,
  ) {
    this.store = store;
    this.defaults = defaults;
  }

  getCwd(workspaceKey: string): string {
    return this.store.getWorkspace(workspaceKey) ?? this.defaults.codexWorkspace;
  }

  async setCwd(workspaceKey: string, cwd: string): Promise<void> {
    await this.store.setWorkspace(workspaceKey, cwd);
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
}
