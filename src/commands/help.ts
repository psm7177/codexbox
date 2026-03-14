import type { CommandHandler } from "./types.js";

export function createHelpCommand(): CommandHandler {
  return async (message) => {
    await message.reply(
      [
        "Available commands:",
        "`!codex help`",
        "`!codex status`",
        "`!codex workspace` (admin)",
        "`!codex workspace <path|reset>` (admin)",
        "`!codex cwd`",
        "`!codex cwd <path>`",
        "`!codex cwd reset`",
        "`!codex access`",
        "`!codex access workspace-write|read-only|full-access|reset`",
        "`!codex network`",
        "`!codex network on|off|reset`",
        "`!codex reset`",
        "`!codex restart`",
        "`!codex error <error-id>` (admin)",
      ].join("\n"),
    );
  };
}
