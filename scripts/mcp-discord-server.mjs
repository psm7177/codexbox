#!/usr/bin/env node

import dotenv from "dotenv";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");
dotenv.config({ path: path.join(ROOT_DIR, ".env") });

const SERVER_NAME = "codex-discord-tools";
const SERVER_VERSION = "0.1.0";
const DISCORD_CONTENT_LIMIT = 2000;
const SUPPORTED_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

function getErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function writeResult(id, result) {
  writeMessage({
    jsonrpc: "2.0",
    id,
    result,
  });
}

function writeError(id, code, message) {
  writeMessage({
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
    },
  });
}

function log(line) {
  process.stderr.write(`[mcp-discord] ${line}\n`);
}

function truncateDiscordContent(text, maxLength = DISCORD_CONTENT_LIMIT) {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 16).trimEnd()}\n... (truncated)`;
}

function buildDiscordContent(caption, trailingText = "") {
  const normalizedCaption = caption.trim();
  const normalizedTrailingText = trailingText.trim();

  if (!normalizedCaption) {
    if (!normalizedTrailingText) {
      return "";
    }
    if (normalizedTrailingText.length > DISCORD_CONTENT_LIMIT) {
      throw new Error("image URL is too long to send as a Discord message");
    }
    return normalizedTrailingText;
  }

  if (!normalizedTrailingText) {
    return truncateDiscordContent(normalizedCaption);
  }

  const separator = "\n";
  const trailingLength = normalizedTrailingText.length + separator.length;
  if (trailingLength >= DISCORD_CONTENT_LIMIT) {
    throw new Error("image URL is too long to send as a Discord message");
  }

  const captionBudget = DISCORD_CONTENT_LIMIT - trailingLength;
  const safeCaption = truncateDiscordContent(normalizedCaption, captionBudget);
  return `${safeCaption}${separator}${normalizedTrailingText}`;
}

function getAllowedRoots() {
  const roots = new Set(["/tmp"]);
  roots.add(ROOT_DIR);

  if (process.env.CODEX_WORKSPACE) {
    roots.add(path.resolve(ROOT_DIR, process.env.CODEX_WORKSPACE));
  }

  if (process.env.HOME) {
    roots.add(path.resolve(process.env.HOME));
  }

  const extraRoots = (process.env.DISCORD_MCP_ALLOWED_ROOTS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  for (const root of extraRoots) {
    roots.add(path.resolve(root));
  }

  return Array.from(roots);
}

function isPathWithinRoot(targetPath, rootPath) {
  const relative = path.relative(rootPath, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function resolveAllowedRoots(roots) {
  const resolvedRoots = await Promise.all(
    roots.map(async (root) => {
      try {
        return await fs.realpath(root);
      } catch {
        return path.resolve(root);
      }
    }),
  );

  return Array.from(new Set(resolvedRoots));
}

function isRemoteUrl(value) {
  return /^https?:\/\//i.test(value);
}

function getExtensionForMimeType(mimeType) {
  const normalized = mimeType.toLowerCase();
  if (normalized === "image/png") {
    return ".png";
  }
  if (normalized === "image/jpeg") {
    return ".jpg";
  }
  if (normalized === "image/gif") {
    return ".gif";
  }
  if (normalized === "image/webp") {
    return ".webp";
  }
  return null;
}

async function resolveDataUrl(dataUrl) {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    throw new Error("unsupported data URL image format");
  }

  const mimeType = match[1] ?? "";
  const encoded = match[2] ?? "";
  const extension = getExtensionForMimeType(mimeType);
  if (!extension) {
    throw new Error(`unsupported image type: ${mimeType}`);
  }

  const filePath = path.join(os.tmpdir(), `codex-discord-mcp-${Date.now()}-${Math.random().toString(36).slice(2)}${extension}`);
  await fs.writeFile(filePath, Buffer.from(encoded, "base64"));
  return {
    kind: "attachment",
    resolvedPath: filePath,
    filename: path.basename(filePath),
  };
}

async function resolveLocalImage(reference) {
  const allowedRoots = await resolveAllowedRoots(getAllowedRoots());
  const workspaceRoot = process.env.CODEX_WORKSPACE ? path.resolve(ROOT_DIR, process.env.CODEX_WORKSPACE) : ROOT_DIR;
  const candidatePath = path.isAbsolute(reference) ? reference : path.resolve(workspaceRoot, reference);
  const normalizedPath = path.resolve(candidatePath);
  const realPath = await fs.realpath(normalizedPath);
  const stats = await fs.stat(realPath);
  if (!stats.isFile()) {
    throw new Error(`image is not a file: ${reference}`);
  }

  const extension = path.extname(realPath).toLowerCase();
  if (!SUPPORTED_IMAGE_EXTENSIONS.has(extension)) {
    throw new Error(`unsupported image type: ${reference}`);
  }

  if (!allowedRoots.some((root) => isPathWithinRoot(realPath, root))) {
    throw new Error(`image is outside allowed roots: ${reference}`);
  }

  return {
    kind: "attachment",
    resolvedPath: realPath,
    filename: path.basename(realPath),
  };
}

async function resolveImageInput(image) {
  if (isRemoteUrl(image)) {
    return {
      kind: "url",
      url: image,
    };
  }

  if (image.startsWith("data:image/")) {
    return resolveDataUrl(image);
  }

  return resolveLocalImage(image);
}

async function sendDiscordMessage(channelId, payload) {
  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    throw new Error("DISCORD_TOKEN is required for send_discord_image");
  }

  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${token}`,
    },
    body: payload,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Discord API request failed (${response.status}): ${body}`);
  }

  return response.json();
}

async function handleSendDiscordImage(args) {
  const channelId = String(args.channel_id ?? "").trim();
  const image = String(args.image ?? "").trim();
  const caption = typeof args.caption === "string" ? args.caption.trim() : "";

  if (!/^\d+$/.test(channelId)) {
    throw new Error("channel_id must be a Discord snowflake string");
  }

  if (!image) {
    throw new Error("image is required");
  }

  const resolved = await resolveImageInput(image);
  let response;

  if (resolved.kind === "url") {
    const content = buildDiscordContent(caption, resolved.url);
    response = await sendDiscordMessage(channelId, JSON.stringify({ content }));
  } else {
    const bytes = await fs.readFile(resolved.resolvedPath);
    const form = new FormData();
    form.set(
      "payload_json",
      JSON.stringify({
        content: caption ? truncateDiscordContent(caption) : undefined,
        attachments: [{ id: 0, filename: resolved.filename }],
      }),
    );
    form.set("files[0]", new Blob([bytes]), resolved.filename);
    response = await sendDiscordMessage(channelId, form);
  }

  return {
    content: [
      {
        type: "text",
        text: `Sent image to Discord channel ${channelId}. Message id: ${response.id}`,
      },
    ],
  };
}

function getTools() {
  return [
    {
      name: "send_discord_image",
      description:
        "Send an image into a Discord channel. Use this when the user explicitly wants the image posted to Discord rather than only described in text.",
      inputSchema: {
        type: "object",
        properties: {
          channel_id: {
            type: "string",
            description: "Discord channel id where the image should be sent.",
          },
          image: {
            type: "string",
            description:
              "Local image path, remote https URL, or data:image/... URL. Local files must be under CODEX_WORKSPACE, HOME, /tmp, or DISCORD_MCP_ALLOWED_ROOTS.",
          },
          caption: {
            type: "string",
            description: "Optional message content to send with the image.",
          },
        },
        required: ["channel_id", "image"],
        additionalProperties: false,
      },
    },
  ];
}

async function handleRequest(message) {
  const { id, method, params } = message;

  if (id == null || !method) {
    return;
  }

  try {
    if (method === "initialize") {
      writeResult(id, {
        protocolVersion: params?.protocolVersion ?? "2024-11-05",
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: SERVER_NAME,
          version: SERVER_VERSION,
        },
      });
      return;
    }

    if (method === "ping") {
      writeResult(id, {});
      return;
    }

    if (method === "tools/list") {
      writeResult(id, { tools: getTools() });
      return;
    }

    if (method === "tools/call") {
      const name = params?.name;
      const args = params?.arguments ?? {};
      if (name === "send_discord_image") {
        writeResult(id, await handleSendDiscordImage(args));
        return;
      }

      writeError(id, -32601, `Unsupported tool: ${name}`);
      return;
    }

    if (method === "notifications/initialized") {
      return;
    }

    writeError(id, -32601, `Unsupported method: ${method}`);
  } catch (error) {
    log(`request failed for ${method}: ${getErrorMessage(error)}`);
    writeError(id, -32603, getErrorMessage(error));
  }
}

const reader = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

reader.on("line", async (line) => {
  if (!line.trim()) {
    return;
  }

  try {
    const message = JSON.parse(line);
    if (message.method) {
      await handleRequest(message);
    }
  } catch (error) {
    log(`failed to parse message: ${getErrorMessage(error)}`);
  }
});
