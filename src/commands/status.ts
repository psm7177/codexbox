import type { CommandContext, CommandHandler } from "./types.js";
import { formatNetworkAccess, formatSandboxMode } from "./format.js";

export function createStatusCommand(context: CommandContext): CommandHandler {
  return async (message) => {
    const conversationKey = context.getConversationKey(message);
    const workspaceKey = context.getWorkspaceKey(message);
    const session = context.conversationService.getSession(conversationKey);
    const workspaceRoot = context.config.codexWorkspace;
    const cwd = context.workspaceService.getCwd(workspaceKey);
    const sandboxMode = context.workspaceService.getSandboxMode(workspaceKey);
    const networkAccess = context.workspaceService.getNetworkAccess(workspaceKey);
    if (!session) {
      await message.reply(
        `workspace: \`${workspaceRoot}\`\ncwd: \`${cwd}\`\naccess: \`${formatSandboxMode(sandboxMode)}\`\nnetwork: \`${formatNetworkAccess(networkAccess)}\`\nNo Codex session is mapped to this conversation yet.`,
      );
      return;
    }

    await message.reply(
      `workspace: \`${workspaceRoot}\`\ncwd: \`${cwd}\`\naccess: \`${formatSandboxMode(sandboxMode)}\`\nnetwork: \`${formatNetworkAccess(networkAccess)}\`\nMapped to Codex thread \`${session.threadId}\`.`,
    );
  };
}
