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
  discordAllowedUserIds: string[];
  discordAllowedGuildIds: string[];
  discordAllowedChannelIds: string[];
  restartAdminUserIds: string[];
  codexWorkspace: string;
  envFilePath: string;
  sandboxMode: SandboxMode;
  sandboxNetworkAccess: boolean;
  sessionStorePath: string;
  appServerCommand: AppServerCommand;
  clientInfo: ClientInfo;
  threadDefaults: ThreadDefaults;
  turnDefaults: TurnDefaults;
}

const APP_SERVER_ENV_KEYS = new Set([
  "HOME",
  "PATH",
  "SHELL",
  "USER",
  "LOGNAME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "COLORTERM",
  "TMPDIR",
  "TMP",
  "TEMP",
  "SSH_AUTH_SOCK",
  "GIT_SSH_COMMAND",
  "DISPLAY",
  "EDITOR",
  "VISUAL",
  "CI",
  "NVM_DIR",
  "NPM_CONFIG_PREFIX",
  "npm_config_cache",
]);

const APP_SERVER_ENV_PREFIXES = ["CODEX_", "OPENAI_", "ANTHROPIC_", "AZURE_", "AWS_", "GOOGLE_", "GEMINI_", "OLLAMA_", "XDG_"];

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

function splitCsv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
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

export function buildAppServerEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};

  for (const [key, value] of Object.entries(env)) {
    if (value == null || value === "") {
      continue;
    }

    if (APP_SERVER_ENV_KEYS.has(key) || APP_SERVER_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      result[key] = value;
    }
  }

  return result;
}

export function loadConfig(): Config {
  const rootDir = process.cwd();
  const codexWorkspace = path.resolve(process.env.CODEX_WORKSPACE ?? rootDir);
  const envFilePath = path.resolve(rootDir, ".env");
  const sandboxMode = (process.env.CODEX_SANDBOX_MODE ?? "workspaceWrite") as SandboxMode;
  const sandboxNetworkAccess = parseBoolean(process.env.CODEX_SANDBOX_NETWORK, false);
  const sessionStorePath = path.resolve(process.env.SESSION_STORE_PATH ?? ".data/sessions.json");
  const appServerBin = process.env.CODEX_APP_SERVER_BIN || "codex";
  const appServerArgs =
    process.env.CODEX_APP_SERVER_ARGS && process.env.CODEX_APP_SERVER_ARGS.trim() !== ""
      ? splitArgs(process.env.CODEX_APP_SERVER_ARGS)
      : ["app-server", "--listen", "stdio://"];
  const restartAdminUserIds = splitCsv(process.env.DISCORD_RESTART_ADMIN_USER_IDS);
  const discordAllowedUserIds = splitCsv(process.env.DISCORD_ALLOWED_USER_IDS);
  const discordAllowedGuildIds = splitCsv(process.env.DISCORD_ALLOWED_GUILD_IDS);
  const discordAllowedChannelIds = splitCsv(process.env.DISCORD_ALLOWED_CHANNEL_IDS);

  return {
    discordToken: process.env.DISCORD_TOKEN ?? "",
    discordClientId: process.env.DISCORD_CLIENT_ID ?? "",
    discordMessageContentIntent: parseBoolean(process.env.DISCORD_MESSAGE_CONTENT_INTENT, false),
    discordAllowedUserIds,
    discordAllowedGuildIds,
    discordAllowedChannelIds,
    restartAdminUserIds,
    codexWorkspace,
    envFilePath,
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
