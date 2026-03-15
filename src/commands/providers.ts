import { splitDiscordMessage } from "../discord-context.js";
import type { CommandContext, CommandHandler } from "./types.js";

interface ConfigReadResponse {
  config?: {
    model_providers?: Record<
      string,
      {
        name?: string | null;
        base_url?: string | null;
      }
    > | null;
  };
}

const BUILT_IN_PROVIDERS = [
  { id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1" },
  { id: "ollama", name: "gpt-oss (Ollama)", baseUrl: "http://localhost:11434/v1" },
  { id: "lmstudio", name: "gpt-oss (LM Studio)", baseUrl: "http://localhost:1234/v1" },
];

export function createProvidersCommand(context: CommandContext): CommandHandler {
  return async (message) => {
    const workspaceKey = context.getWorkspaceKey(message);
    const selectedProvider = context.workspaceService.getModelProvider(workspaceKey) ?? "default";
    const response = (await context.codexClient.request("config/read", {
      cwd: context.workspaceService.getCwd(workspaceKey),
      includeLayers: false,
    })) as ConfigReadResponse;

    const configuredProviders = response.config?.model_providers ?? {};
    const lines = ["Available providers:"];

    for (const provider of BUILT_IN_PROVIDERS) {
      const override = configuredProviders[provider.id];
      const displayName = override?.name?.trim() || provider.name;
      const baseUrl = override?.base_url?.trim() || provider.baseUrl;
      const selectedSuffix = selectedProvider === provider.id ? " [selected]" : "";
      const overrideSuffix = override ? " [config override]" : " [built-in]";
      lines.push(`- ${provider.id}${selectedSuffix}${overrideSuffix}`);
      lines.push(`  name: ${displayName}`);
      lines.push(`  base_url: ${baseUrl}`);
    }

    for (const [providerId, provider] of Object.entries(configuredProviders)) {
      if (BUILT_IN_PROVIDERS.some((entry) => entry.id === providerId)) {
        continue;
      }

      const selectedSuffix = selectedProvider === providerId ? " [selected]" : "";
      lines.push(`- ${providerId}${selectedSuffix} [custom]`);
      lines.push(`  name: ${provider.name?.trim() || providerId}`);
      lines.push(`  base_url: ${provider.base_url?.trim() || "unknown"}`);
    }

    lines.push("");
    lines.push("Custom providers come from Codex config. Secrets and env_key values are intentionally hidden.");

    const chunks = splitDiscordMessage(lines.join("\n"));
    const [first, ...rest] = chunks;
    await message.reply(first ?? "No providers were returned by Codex.");
    for (const chunk of rest) {
      if (!message.channel?.isSendable?.()) {
        break;
      }
      await message.channel.send(chunk);
    }
  };
}
