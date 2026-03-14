import type { Client } from "discord.js";

export interface AdminStartupLog {
  adminId: string;
  message: { edit: (content: string) => Promise<unknown> };
}

export interface StartupStatus {
  botTag: string;
  phase: string;
  sessionStoreLoaded: boolean;
  codexReady: boolean;
  codexDeferred: boolean;
  workspace: string;
  error?: string;
}

export function formatStartupStatus(options: StartupStatus): string {
  const lines = [
    "Startup status",
    `- bot: ${options.botTag}`,
    `- phase: ${options.phase}`,
    `- session store: ${options.sessionStoreLoaded ? "ready" : "pending"}`,
    `- codex app-server: ${options.codexReady ? "ready" : options.codexDeferred ? "deferred" : "pending"}`,
    `- workspace: ${options.workspace}`,
  ];

  if (options.error) {
    lines.push(`- error: ${options.error}`);
  }

  return lines.join("\n");
}

export async function createAdminStartupLogs(
  client: Client,
  adminIds: string[],
  initialContent: string,
  onError: (message: string) => void,
): Promise<AdminStartupLog[]> {
  if (adminIds.length === 0) {
    return [];
  }

  const logs = await Promise.all(
    adminIds.map(async (adminId) => {
      try {
        const user = await client.users.fetch(adminId);
        const dm = await user.createDM();
        const message = await dm.send(initialContent);
        return { adminId, message };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        onError(`Failed to send startup log to admin ${adminId}: ${errorMessage}`);
        return null;
      }
    }),
  );

  return logs.flatMap((entry) => (entry ? [entry] : []));
}

export async function updateAdminStartupLogs(
  logs: AdminStartupLog[],
  content: string,
  onError: (message: string) => void,
): Promise<void> {
  await Promise.all(
    logs.map(async ({ adminId, message }) => {
      try {
        await message.edit(content);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        onError(`Failed to edit startup log for admin ${adminId}: ${errorMessage}`);
      }
    }),
  );
}
