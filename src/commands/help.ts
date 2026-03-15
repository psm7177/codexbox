import type { CommandHandler } from "./types.js";

export function createHelpCommand(): CommandHandler {
  return async (message) => {
    await message.reply(
      [
        "Available commands:",
        "`!codex help`",
        "`!codex status`",
        "`!codex models`",
        "`!codex providers`",
        "`!codex model`",
        "`!codex model <name|reset>`",
        "`!codex provider`",
        "`!codex provider <name> [model]`",
        "`!codex provider reset`",
        "`!codex stop`",
        "`!codex sessions` (admin)",
        "`!codex bind <thread-id>` (admin)",
        "`!codex workspace` (admin)",
        "`!codex workspace <path|reset>` (admin)",
        "`!codex mode` (admin)",
        "`!codex mode <mention|auto|reset>` (admin)",
        "`!codex init <cwd> <mention|auto>` (admin)",
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
