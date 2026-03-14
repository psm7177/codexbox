import path from "node:path";

export type SandboxMode = "dangerFullAccess" | "readOnly" | "workspaceWrite";

type SandboxPolicy =
  | { type: "dangerFullAccess" }
  | { type: "readOnly"; networkAccess: boolean }
  | {
      type: "workspaceWrite";
      writableRoots: string[];
      networkAccess: boolean;
      excludeTmpdirEnvVar: boolean;
      excludeSlashTmp: boolean;
    };

interface AppServerCommand {
  bin: string;
  args: string[];
}

interface ClientInfo {
  name: string;
  title: string;
  version: string;
}

interface ThreadDefaults {
  cwd: string;
  model?: string;
  modelProvider?: string;
  personality: string;
  approvalPolicy: string;
  serviceName: string;
}

interface TurnDefaults {
  cwd: string;
  model?: string;
  personality: string;
  approvalPolicy: string;
  summary: string;
  sandboxPolicy: SandboxPolicy;
}

export interface Config {
  discordToken: string;
  discordClientId: string;
  discordMessageContentIntent: boolean;
  restartAdminUserIds: string[];
  codexWorkspace: string;
  sandboxMode: SandboxMode;
  sandboxNetworkAccess: boolean;
  sessionStorePath: string;
  appServerCommand: AppServerCommand;
  clientInfo: ClientInfo;
  threadDefaults: ThreadDefaults;
  turnDefaults: TurnDefaults;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value === "") {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function splitArgs(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((part) => part.replace(/^"|"$/g, "")) ?? [];
}

export function buildSandboxPolicy(mode: SandboxMode, networkAccess: boolean, workspace: string): SandboxPolicy {
  if (mode === "dangerFullAccess") {
    return { type: "dangerFullAccess" };
  }

  if (mode === "readOnly") {
    return {
      type: "readOnly",
      networkAccess,
    };
  }

  return {
    type: "workspaceWrite",
    writableRoots: [workspace],
    networkAccess,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  };
}

export function loadConfig(): Config {
  const rootDir = process.cwd();
  const codexWorkspace = path.resolve(process.env.CODEX_WORKSPACE ?? rootDir);
  const sandboxMode = (process.env.CODEX_SANDBOX_MODE ?? "workspaceWrite") as SandboxMode;
  const sandboxNetworkAccess = parseBoolean(process.env.CODEX_SANDBOX_NETWORK, false);
  const sessionStorePath = path.resolve(process.env.SESSION_STORE_PATH ?? ".data/sessions.json");
  const appServerBin = process.env.CODEX_APP_SERVER_BIN || "codex";
  const appServerArgs =
    process.env.CODEX_APP_SERVER_ARGS && process.env.CODEX_APP_SERVER_ARGS.trim() !== ""
      ? splitArgs(process.env.CODEX_APP_SERVER_ARGS)
      : ["app-server", "--listen", "stdio://"];
  const restartAdminUserIds = (process.env.DISCORD_RESTART_ADMIN_USER_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    discordToken: process.env.DISCORD_TOKEN ?? "",
    discordClientId: process.env.DISCORD_CLIENT_ID ?? "",
    discordMessageContentIntent: parseBoolean(process.env.DISCORD_MESSAGE_CONTENT_INTENT, false),
    restartAdminUserIds,
    codexWorkspace,
    sandboxMode,
    sandboxNetworkAccess,
    sessionStorePath,
    appServerCommand: {
      bin: appServerBin,
      args: appServerArgs,
    },
    clientInfo: {
      name: "codexbox",
      title: "Codexbox",
      version: "0.1.0",
    },
    threadDefaults: {
      cwd: codexWorkspace,
      model: process.env.CODEX_MODEL || undefined,
      modelProvider: process.env.CODEX_MODEL_PROVIDER || undefined,
      personality: process.env.CODEX_PERSONALITY || "pragmatic",
      approvalPolicy: process.env.CODEX_APPROVAL_POLICY || "never",
      serviceName: process.env.CODEX_SERVICE_NAME || "codexbox",
    },
    turnDefaults: {
      cwd: codexWorkspace,
      model: process.env.CODEX_MODEL || undefined,
      personality: process.env.CODEX_PERSONALITY || "pragmatic",
      approvalPolicy: process.env.CODEX_APPROVAL_POLICY || "never",
      summary: "concise",
      sandboxPolicy: buildSandboxPolicy(sandboxMode, sandboxNetworkAccess, codexWorkspace),
    },
  };
}
