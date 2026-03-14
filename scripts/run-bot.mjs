import { spawn } from "node:child_process";

const RESTART_EXIT_CODE = 75;

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      resolve({ code, signal });
    });
  });
}

async function main() {
  while (true) {
    const build = await runCommand("npm", ["run", "build"]);
    if (build.signal) {
      process.kill(process.pid, build.signal);
      return;
    }
    if (build.code !== 0) {
      process.exit(build.code ?? 1);
    }

    const bot = await runCommand("npm", ["run", "start:bot"]);
    if (bot.signal) {
      process.kill(process.pid, bot.signal);
      return;
    }

    if (bot.code === RESTART_EXIT_CODE) {
      console.log("[runner] Restart requested. Rebuilding and restarting bot.");
      continue;
    }

    process.exit(bot.code ?? 0);
  }
}

await main();
