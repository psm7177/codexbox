import { splitDiscordMessage } from "../discord-context.js";
import { getDynamicToolProfile, getDynamicToolsForProvider, getDynamicToolsForToolProfile } from "../dynamic-tools.js";
import type { CommandContext, CommandHandler } from "./types.js";

function formatToolNames(toolNames: string[]): string {
  return toolNames.length > 0 ? toolNames.join(", ") : "none";
}

export function createToolsCommand(context: CommandContext): CommandHandler {
  return async (message) => {
    const conversationKey = context.getConversationKey(message);
    const workspaceKey = context.getWorkspaceKey(message);
    const session = context.conversationService.getSession(conversationKey);
    const selectedModel = context.workspaceService.getModel(workspaceKey) ?? "default";
    const selectedProviderValue = context.workspaceService.getModelProvider(workspaceKey);
    const selectedProvider = selectedProviderValue ?? "default";
    const expectedToolProfile = getDynamicToolProfile(selectedProviderValue ?? undefined);
    const expectedTools = getDynamicToolsForProvider(selectedProviderValue ?? undefined);
    const sessionToolProfile = session?.threadToolProfile ?? null;
    const sessionTools = getDynamicToolsForToolProfile(sessionToolProfile);

    const lines = [
      "Injected tools for this workspace:",
      `selected model: \`${selectedModel}\``,
      `selected provider: \`${selectedProvider}\``,
      `expected thread tool profile: \`${expectedToolProfile ?? "none"}\``,
      `expected dynamic tools: \`${formatToolNames(expectedTools.map((tool) => tool.name))}\``,
    ];

    if (expectedTools.length > 0) {
      lines.push("expected dynamic tool details:");
      for (const tool of expectedTools) {
        lines.push(`- ${tool.name}: ${tool.description}`);
      }
    }

    if (!session) {
      lines.push("No Codex session is mapped to this conversation yet.");
    } else {
      lines.push(`session thread: \`${session.threadId}\``);
      lines.push(`session thread tool profile: \`${sessionToolProfile ?? "none"}\``);
      lines.push(`session dynamic tools: \`${formatToolNames(sessionTools.map((tool) => tool.name))}\``);
      lines.push(`tool profile matches selection: \`${sessionToolProfile === expectedToolProfile ? "yes" : "no"}\``);
    }

    lines.push("");
    lines.push("This command shows codexbox's injected tool list for the selected provider. It is authoritative for new threads.");

    const chunks = splitDiscordMessage(lines.join("\n"));
    const [first, ...rest] = chunks;
    await message.reply(first ?? "No injected tools are configured.");
    for (const chunk of rest) {
      if (!message.channel?.isSendable?.()) {
        break;
      }
      await message.channel.send(chunk);
    }
  };
}
