import type { CommandContext, CommandHandler } from "./types.js";

function formatValue(value: string | undefined): string {
  return value ? `\`${value}\`` : "`default`";
}

export function createProviderCommand(context: CommandContext): CommandHandler {
  return async (message, args) => {
    const conversationKey = context.getConversationKey(message);
    const workspaceKey = context.getWorkspaceKey(message);

    if (args.length === 0) {
      await message.reply(
        `selected provider: ${formatValue(context.workspaceService.getModelProvider(workspaceKey))}\nselected model: ${formatValue(
          context.workspaceService.getModel(workspaceKey),
        )}`,
      );
      return;
    }

    const provider = args[0]?.trim();
    if (!provider) {
      await message.reply("Usage: `!codex provider`, `!codex provider <name> [model]`, or `!codex provider reset`.");
      return;
    }

    if (["reset", "default"].includes(provider.toLowerCase())) {
      const previousProvider = context.workspaceService.getModelProvider(workspaceKey);
      await context.workspaceService.resetModelProvider(workspaceKey);
      const nextProvider = context.workspaceService.getModelProvider(workspaceKey);
      if (previousProvider !== nextProvider) {
        await context.conversationService.reset(conversationKey);
        await message.reply(
          `provider reset to default: ${formatValue(nextProvider)}\nSession reset. The next message starts a new Codex thread.`,
        );
        return;
      }

      await message.reply(`provider reset to default: ${formatValue(nextProvider)}`);
      return;
    }

    const previousProvider = context.workspaceService.getModelProvider(workspaceKey);
    await context.workspaceService.setModelProvider(workspaceKey, provider);
    const model = args.slice(1).join(" ").trim();
    if (model) {
      await context.workspaceService.setModel(workspaceKey, model);
      const providerChanged = previousProvider !== context.workspaceService.getModelProvider(workspaceKey);
      if (providerChanged) {
        await context.conversationService.reset(conversationKey);
        await message.reply(
          `selected provider set to \`${provider}\`.\nselected model set to \`${model}\`.\nSession reset. The next message starts a new Codex thread.`,
        );
        return;
      }

      await message.reply(`selected provider set to \`${provider}\`.\nselected model set to \`${model}\`.`);
      return;
    }

    const providerChanged = previousProvider !== context.workspaceService.getModelProvider(workspaceKey);
    if (providerChanged) {
      await context.conversationService.reset(conversationKey);
      await message.reply(
        `selected provider set to \`${provider}\`.\nselected model: ${formatValue(context.workspaceService.getModel(workspaceKey))}\nSession reset. The next message starts a new Codex thread.`,
      );
      return;
    }

    await message.reply(
      `selected provider set to \`${provider}\`.\nselected model: ${formatValue(context.workspaceService.getModel(workspaceKey))}`,
    );
  };
}
