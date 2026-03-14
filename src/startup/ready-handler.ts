import type { Client } from "discord.js";
import type { CodexAppServerClient } from "../codex-app-server-client.js";
import type { Config } from "../config.js";
import type { SessionStore } from "../session-store.js";
import {
  type AdminStartupLog,
  createAdminStartupLogs,
  formatStartupStatus,
  updateAdminStartupLogs,
} from "./admin-startup-log.js";

interface ReadyHandlerOptions {
  discordClient: Client;
  config: Config;
  sessionStore: Pick<SessionStore, "load">;
  codexClient: Pick<CodexAppServerClient, "ensureStarted">;
  log?: (line: string) => void;
  errorLog?: (line: string) => void;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function createReadyHandler(options: ReadyHandlerOptions): () => Promise<void> {
  const log = options.log ?? console.log;
  const errorLog = options.errorLog ?? console.error;
  const startupErrorLog = (line: string): void => {
    errorLog(`[startup] ${line}`);
  };

  return async (): Promise<void> => {
    let adminLogs: AdminStartupLog[] = [];
    try {
      if (!options.discordClient.user) {
        throw new Error("Discord client user is unavailable after login");
      }

      log(`Discord bot logged in as ${options.discordClient.user.tag}`);
      const botTag = options.discordClient.user.tag;

      adminLogs = await createAdminStartupLogs(
        options.discordClient,
        options.config.restartAdminUserIds,
        formatStartupStatus({
          botTag,
          phase: "discord ready",
          sessionStoreLoaded: false,
          codexReady: false,
          codexDeferred: false,
          workspace: options.config.codexWorkspace,
        }),
        startupErrorLog,
      );

      await options.sessionStore.load();
      await updateAdminStartupLogs(
        adminLogs,
        formatStartupStatus({
          botTag,
          phase: "session store loaded",
          sessionStoreLoaded: true,
          codexReady: false,
          codexDeferred: false,
          workspace: options.config.codexWorkspace,
        }),
        startupErrorLog,
      );

      try {
        await options.codexClient.ensureStarted();
        log("[startup] Codex app-server is ready.");
        await updateAdminStartupLogs(
          adminLogs,
          formatStartupStatus({
            botTag,
            phase: "startup complete",
            sessionStoreLoaded: true,
            codexReady: true,
            codexDeferred: false,
            workspace: options.config.codexWorkspace,
          }),
          startupErrorLog,
        );
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        errorLog(
          `[startup] Codex app-server initialization failed: ${errorMessage}. The bot will stay online and retry when the next message needs Codex.`,
        );
        await updateAdminStartupLogs(
          adminLogs,
          formatStartupStatus({
            botTag,
            phase: "startup complete with deferred Codex initialization",
            sessionStoreLoaded: true,
            codexReady: false,
            codexDeferred: true,
            workspace: options.config.codexWorkspace,
            error: errorMessage,
          }),
          startupErrorLog,
        );
      }
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      errorLog(`[startup] Ready handler failed: ${errorMessage}`);
      if (options.discordClient.user && adminLogs.length > 0) {
        await updateAdminStartupLogs(
          adminLogs,
          formatStartupStatus({
            botTag: options.discordClient.user.tag,
            phase: "startup failed",
            sessionStoreLoaded: false,
            codexReady: false,
            codexDeferred: false,
            workspace: options.config.codexWorkspace,
            error: errorMessage,
          }),
          startupErrorLog,
        );
      }
    }
  };
}
