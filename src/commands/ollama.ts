import { resolveBuiltInOssBaseUrl } from "../config.js";
import type { CommandContext } from "./types.js";

interface ConfigReadResponse {
  config?: {
    model_providers?: Record<
      string,
      {
        base_url?: string | null;
      }
    > | null;
  };
}

interface OllamaTagsResponse {
  models?: Array<{
    name?: string | null;
  }>;
}

function baseUrlToHostRoot(baseUrl: string): string {
  const url = new URL(baseUrl);
  const normalizedPath = url.pathname.replace(/\/+$/, "");
  if (normalizedPath.endsWith("/v1")) {
    url.pathname = normalizedPath.slice(0, -3) || "/";
  } else {
    url.pathname = normalizedPath || "/";
  }
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export async function fetchOllamaModels(context: CommandContext, workspaceKey: string): Promise<string[]> {
  const response = (await context.codexClient.request("config/read", {
    cwd: context.workspaceService.getCwd(workspaceKey),
    includeLayers: false,
  })) as ConfigReadResponse;

  const envConfiguredBaseUrl = resolveBuiltInOssBaseUrl(11434);
  const configuredBaseUrl = response.config?.model_providers?.ollama?.base_url?.trim();
  const hostRoot = baseUrlToHostRoot(
    process.env.CODEX_OSS_BASE_URL?.trim() || process.env.CODEX_OSS_PORT?.trim() ? envConfiguredBaseUrl : configuredBaseUrl || envConfiguredBaseUrl,
  );
  const ollamaResponse = await fetch(`${hostRoot}/api/tags`);
  if (!ollamaResponse.ok) {
    throw new Error(`Ollama returned HTTP ${ollamaResponse.status} for /api/tags`);
  }

  const payload = (await ollamaResponse.json()) as OllamaTagsResponse;
  return (
    payload.models
      ?.map((model) => model.name?.trim())
      .filter((name): name is string => Boolean(name)) ?? []
  );
}
