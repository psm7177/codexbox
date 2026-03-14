import type { ToolItem } from "./codex-app-server-client.js";

const DISCORD_STATUS_LIMIT = 1900;

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function formatTypeLabel(type: string): string {
  return normalizeWhitespace(type.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_/:.-]+/g, " "));
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }

  return result;
}

export function summarizeToolItem(item: ToolItem): string | null {
  if (!item?.type) {
    return null;
  }

  if (item.type === "commandExecution") {
    const command = normalizeWhitespace(item.command ?? "");
    return command ? `exec: ${command}` : "exec";
  }

  if (item.type === "fileChange") {
    const paths = uniqueStrings((item.changes ?? []).map((change) => change.path).filter(Boolean));
    if (paths.length === 0) {
      return "edit files";
    }

    return `edit: ${paths.join(", ")}`;
  }

  return `tool: ${formatTypeLabel(item.type)}`;
}

function renderListSection(title: string, items: string[]): string[] {
  const lines = ["", `${title}:`];
  if (items.length === 0) {
    lines.push("- none");
    return lines;
  }

  for (const item of items) {
    lines.push(`- ${item}`);
  }
  return lines;
}

function renderTextSection(title: string, text: string): string[] {
  const lines = ["", `${title}:`];
  if (!text.trim()) {
    lines.push("- none");
    return lines;
  }

  lines.push(text.trim());
  return lines;
}

export function formatToolActivity(tools: string[]): string {
  const uniqueTools = uniqueStrings(tools);
  if (uniqueTools.length === 0) {
    return "";
  }

  const lines = ["Tools used:"];
  for (const tool of uniqueTools) {
    lines.push(`- ${tool}`);
  }
  return lines.join("\n");
}

function fitDiscordMessage(text: string): string {
  if (text.length <= DISCORD_STATUS_LIMIT) {
    return text;
  }

  return `${text.slice(0, DISCORD_STATUS_LIMIT - 16).trimEnd()}\n... (truncated)`;
}

export function formatProgressMessage(options: {
  headline?: string;
  isWriting: boolean;
  activeTools: string[];
  usedTools: string[];
  previewText: string;
}): string {
  const lines = [options.headline ?? (options.isWriting ? "🔄 Drafting reply..." : "🔄 Thinking...")];
  lines.push(...renderListSection("Using now", options.activeTools));
  lines.push(...renderListSection("Used tools", options.usedTools));
  lines.push(...renderTextSection("Preview", options.previewText));
  return fitDiscordMessage(lines.join("\n"));
}

export function formatCompletionMessage(tools: string[]): string {
  const activity = formatToolActivity(tools);
  return activity ? `Reply complete.\n\n${activity}` : "Reply complete.";
}
