import { splitDiscordMessage } from "../discord-context.js";
import { fetchOllamaModels } from "./ollama.js";
import type { CommandContext, CommandHandler } from "./types.js";

interface ModelListResponse {
  data?: Array<{
    displayName?: string | null;
    model?: string | null;
    id?: string | null;
    hidden?: boolean;
  }>;
  nextCursor?: string | null;
}

export function createModelsCommand(context: CommandContext): CommandHandler {
  return async (message) => {
    const workspaceKey = context.getWorkspaceKey(message);
    const selectedProvider = context.workspaceService.getModelProvider(workspaceKey);
    const response = (await context.codexClient.request("model/list", {
      includeHidden: false,
      limit: 100,
    })) as ModelListResponse;

    const models = response.data ?? [];
    if (models.length === 0) {
      await message.reply("No models were returned by Codex app-server.");
      return;
    }

    const lines = ["Available models:"];
    for (const entry of models) {
      const label = entry.displayName?.trim() || entry.model?.trim() || entry.id?.trim();
      const model = entry.model?.trim();
      if (!label) {
        continue;
      }

      lines.push(model && model !== label ? `- ${label} \`${model}\`` : `- ${label}`);
    }

    if (response.nextCursor) {
      lines.push("", "More models are available from the app-server, but only the first page is shown.");
    }

    if (selectedProvider === "ollama") {
      lines.push("");
      try {
        const models = await fetchOllamaModels(context, workspaceKey);
        if (models.length === 0) {
          lines.push("Ollama models: `none returned`");
        } else {
          lines.push("Ollama models:");
          for (const model of models) {
            lines.push(`- ${model}`);
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        lines.push(`Ollama models: \`unavailable\` (${errorMessage})`);
      }
    }

    const chunks = splitDiscordMessage(lines.join("\n"));
    const [first, ...rest] = chunks;
    await message.reply(first ?? "No models were returned by Codex app-server.");
    for (const chunk of rest) {
      if (!message.channel?.isSendable?.()) {
        break;
      }
      await message.channel.send(chunk);
    }
  };
}
