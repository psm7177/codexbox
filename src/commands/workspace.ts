import fs from "node:fs/promises";
import path from "node:path";
import { requireAdmin } from "./auth.js";
import type { CommandContext, CommandHandler } from "./types.js";

const DEFAULT_WORKSPACE_VALUE = ".";

function parseEnvValue(content: string, key: string): string | null {
  const match = content.match(new RegExp(`^${key}=(.*)$`, "m"));
  return match?.[1]?.trim() ?? null;
}

function upsertEnvValue(content: string, key: string, value: string): string {
  const normalized = `${key}=${value}`;
  if (new RegExp(`^${key}=`, "m").test(content)) {
    return content.replace(new RegExp(`^${key}=.*$`, "m"), normalized);
  }

  if (!content.trim()) {
    return `${normalized}\n`;
  }

  return `${content.replace(/\n?$/, "\n")}${normalized}\n`;
}

async function readEnvFile(): Promise<string> {
  return readEnvFileAt(path.resolve(process.cwd(), ".env"));
}

async function readEnvFileAt(envFilePath: string): Promise<string> {
  try {
    return await fs.readFile(envFilePath, "utf8");
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

function resolveConfiguredWorkspace(value: string | null, fallback: string): string {
  const rawValue = value && value !== "" ? value : fallback;
  return path.resolve(process.cwd(), rawValue);
}

export function createWorkspaceCommand(context: CommandContext): CommandHandler {
  return async (message, args) => {
    if (!(await requireAdmin(context, message, "You are not allowed to change the Codex workspace."))) {
      return;
    }

    const envFilePath = context.config.envFilePath;
    const envRoot = path.dirname(envFilePath);
    const envContent = await readEnvFileAt(envFilePath);
    const configuredValue = parseEnvValue(envContent, "CODEX_WORKSPACE");

    if (args.length === 0) {
      const configuredWorkspace = path.resolve(envRoot, configuredValue && configuredValue !== "" ? configuredValue : context.config.codexWorkspace);
      await message.reply(
        `runtime workspace: \`${context.config.codexWorkspace}\`\nconfigured startup workspace: \`${configuredWorkspace}\``,
      );
      return;
    }

    const requested = args.join(" ").trim();
    const nextValue = requested.toLowerCase() === "reset" ? DEFAULT_WORKSPACE_VALUE : requested;
    const resolvedWorkspace =
      requested.toLowerCase() === "reset"
        ? path.resolve(envRoot, DEFAULT_WORKSPACE_VALUE)
        : path.resolve(context.config.codexWorkspace, requested);

    let stats;
    try {
      stats = await fs.stat(resolvedWorkspace);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        await message.reply(`workspace does not exist: \`${resolvedWorkspace}\``);
        return;
      }
      throw error;
    }

    if (!stats.isDirectory()) {
      await message.reply(`workspace is not a directory: \`${resolvedWorkspace}\``);
      return;
    }

    const nextEnvContent = upsertEnvValue(envContent, "CODEX_WORKSPACE", nextValue);
    await fs.writeFile(envFilePath, nextEnvContent, "utf8");

    await message.reply(
      `Saved startup workspace as \`${resolvedWorkspace}\`.\nRestart required. Current runtime workspace remains \`${context.config.codexWorkspace}\` until the bot restarts.`,
    );
  };
}
