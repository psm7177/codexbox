import { splitDiscordMessage } from "../discord-context.js";
import { fetchOllamaModels } from "./ollama.js";
import type { CommandContext, CommandHandler } from "./types.js";

function formatValue(value: string | undefined): string {
  return value ? `\`${value}\`` : "`default`";
}

export function createModelCommand(context: CommandContext): CommandHandler {
  return async (message, args) => {
    const workspaceKey = context.getWorkspaceKey(message);
    const selectedModel = context.workspaceService.getModel(workspaceKey);
    const selectedProvider = context.workspaceService.getModelProvider(workspaceKey);

    if (args.length === 0) {
      const lines = [`selected model: ${formatValue(selectedModel)}`, `selected provider: ${formatValue(selectedProvider)}`];
      if (selectedProvider === "ollama") {
        try {
          const models = await fetchOllamaModels(context, workspaceKey);
          if (models.length === 0) {
            lines.push("ollama models: `none returned`");
          } else {
            lines.push("ollama models:");
            for (const model of models) {
              lines.push(`- ${model}`);
            }
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          lines.push(`ollama models: \`unavailable\` (${message})`);
        }
      }

      const chunks = splitDiscordMessage(lines.join("\n"));
      const [first, ...rest] = chunks;
      await message.reply(first ?? `selected model: ${formatValue(selectedModel)}\nselected provider: ${formatValue(selectedProvider)}`);
      for (const chunk of rest) {
        if (!message.channel?.isSendable?.()) {
          break;
        }
        await message.channel.send(chunk);
      }
      return;
    }

    const value = args.join(" ").trim();
    if (!value) {
      await message.reply("Usage: `!codex model`, `!codex model <name>`, or `!codex model reset`.");
      return;
    }

    if (["reset", "default"].includes(value.toLowerCase())) {
      await context.workspaceService.resetModel(workspaceKey);
      const nextModel = context.workspaceService.getModel(workspaceKey);
      await message.reply(`model reset to default: ${formatValue(nextModel)}`);
      return;
    }

    if (selectedModel === value) {
      await message.reply(
        `selected model set to \`${value}\`.\nselected provider: ${formatValue(context.workspaceService.getModelProvider(workspaceKey))}`,
      );
      return;
    }

    await context.workspaceService.setModel(workspaceKey, value);
    await message.reply(
      `selected model set to \`${value}\`.\nselected provider: ${formatValue(context.workspaceService.getModelProvider(workspaceKey))}`,
    );
  };
}
