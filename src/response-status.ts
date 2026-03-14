import type { ToolItem } from "./codex-app-server-client.js";

const MAX_VISIBLE_TOOLS = 5;
const MAX_SUMMARY_LENGTH = 80;

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1).trimEnd()}...`;
}

function formatTypeLabel(type: string): string {
  return normalizeWhitespace(type.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_/:.-]+/g, " "));
}

function formatVisibleTools(tools: string[]): string[] {
  const visible = tools.slice(0, MAX_VISIBLE_TOOLS);
  const remaining = tools.length - visible.length;
  if (remaining > 0) {
    return [...visible, `+${remaining} more`];
  }
  return visible;
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
    return command ? `exec: ${truncate(command, MAX_SUMMARY_LENGTH)}` : "exec";
  }

  if (item.type === "fileChange") {
    const paths = uniqueStrings((item.changes ?? []).map((change) => change.path).filter(Boolean));
    if (paths.length === 0) {
      return "edit files";
    }

    const visiblePaths = paths.slice(0, 2).join(", ");
    const extra = paths.length - Math.min(paths.length, 2);
    const suffix = extra > 0 ? ` (+${extra})` : "";
    return `edit: ${truncate(`${visiblePaths}${suffix}`, MAX_SUMMARY_LENGTH)}`;
  }

  return `tool: ${formatTypeLabel(item.type)}`;
}

export function formatProgressMessage(options: {
  isWriting: boolean;
  activeTools: string[];
}): string {
  const lines = [options.isWriting ? "🔄 Drafting reply..." : "🔄 Thinking..."];
  const activeTools = formatVisibleTools(options.activeTools);

  if (activeTools.length > 0) {
    lines.push("", "Current tools:");
    for (const tool of activeTools) {
      lines.push(`- ${tool}`);
    }
  }

  return lines.join("\n");
}

export function formatToolActivity(tools: string[]): string {
  const uniqueTools = uniqueStrings(tools);
  if (uniqueTools.length === 0) {
    return "";
  }

  const lines = ["Tools used:"];
  for (const tool of formatVisibleTools(uniqueTools)) {
    lines.push(`- ${tool}`);
  }
  return lines.join("\n");
}
