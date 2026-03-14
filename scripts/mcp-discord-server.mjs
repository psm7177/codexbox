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

const SERVER_NAME = "codexbox-tools";
const SERVER_VERSION = "0.1.0";
const DISCORD_CONTENT_LIMIT = 2000;
const DEFAULT_DISCORD_UPLOAD_LIMIT_BYTES = 10 * 1024 * 1024;
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

function getDiscordUploadLimitBytes() {
  const value = Number.parseInt(process.env.DISCORD_UPLOAD_MAX_BYTES ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_DISCORD_UPLOAD_LIMIT_BYTES;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KiB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
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
  const match = dataUrl.match(/^data:([a-zA-Z0-9.+/-]+);base64,(.+)$/);
  if (!match) {
    throw new Error("unsupported data URL file format");
  }

  const mimeType = match[1] ?? "";
  const encoded = match[2] ?? "";
  const extension = mimeType.startsWith("image/") ? getExtensionForMimeType(mimeType) : null;

  const suffix = extension ?? ".bin";
  const bytes = Buffer.from(encoded, "base64");
  const filePath = path.join(os.tmpdir(), `codexbox-mcp-${Date.now()}-${Math.random().toString(36).slice(2)}${suffix}`);
  await fs.writeFile(filePath, bytes);
  return {
    kind: "attachment",
    resolvedPath: filePath,
    filename: path.basename(filePath),
    size: bytes.byteLength,
    contentType: mimeType,
  };
}

async function resolveLocalFile(reference, options = {}) {
  const allowedRoots = await resolveAllowedRoots(getAllowedRoots());
  const workspaceRoot = process.env.CODEX_WORKSPACE ? path.resolve(ROOT_DIR, process.env.CODEX_WORKSPACE) : ROOT_DIR;
  const candidatePath = path.isAbsolute(reference) ? reference : path.resolve(workspaceRoot, reference);
  const normalizedPath = path.resolve(candidatePath);
  const realPath = await fs.realpath(normalizedPath);
  const stats = await fs.stat(realPath);
  if (!stats.isFile()) {
    throw new Error(`file is not a file: ${reference}`);
  }

  const extension = path.extname(realPath).toLowerCase();
  if (options.imageOnly && !SUPPORTED_IMAGE_EXTENSIONS.has(extension)) {
    throw new Error(`unsupported image type: ${reference}`);
  }

  if (!allowedRoots.some((root) => isPathWithinRoot(realPath, root))) {
    throw new Error(`file is outside allowed roots: ${reference}`);
  }

  return {
    kind: "attachment",
    resolvedPath: realPath,
    filename: path.basename(realPath),
    size: stats.size,
  };
}

function getRemoteFilename(url) {
  try {
    const parsed = new URL(url);
    const name = path.basename(parsed.pathname);
    return name && name !== "/" ? name : "downloaded-file";
  } catch {
    return "downloaded-file";
  }
}

async function resolveRemoteFile(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`failed to download remote file (${response.status})`);
  }

  const contentLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  const contentType = response.headers.get("content-type") ?? undefined;
  const extension = contentType?.startsWith("image/") ? getExtensionForMimeType(contentType) : null;
  const filename = getRemoteFilename(url);
  const candidateName = extension && !path.extname(filename) ? `${filename}${extension}` : filename;
  const filePath = path.join(os.tmpdir(), `codexbox-mcp-${Date.now()}-${Math.random().toString(36).slice(2)}-${candidateName}`);

  if (Number.isFinite(contentLength) && contentLength > getDiscordUploadLimitBytes()) {
    return {
      kind: "attachment",
      resolvedPath: filePath,
      filename: candidateName,
      size: contentLength,
      contentType,
      tooLarge: true,
    };
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(filePath, bytes);
  return {
    kind: "attachment",
    resolvedPath: filePath,
    filename: candidateName,
    size: bytes.byteLength,
    contentType,
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

  return resolveLocalFile(image, { imageOnly: true });
}

async function resolveFileInput(file) {
  if (isRemoteUrl(file)) {
    return resolveRemoteFile(file);
  }

  if (file.startsWith("data:")) {
    return resolveDataUrl(file);
  }

  return resolveLocalFile(file);
}

async function sendDiscordMessage(channelId, payload) {
  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    throw new Error("DISCORD_TOKEN is required for Discord upload tools");
  }

  const headers = {
    Authorization: `Bot ${token}`,
  };
  if (typeof payload === "string") {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: "POST",
    headers,
    body: payload,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Discord API request failed (${response.status}): ${body}`);
  }

  return response.json();
}

function buildUploadLimitMessage(filename, size, limit) {
  return truncateDiscordContent(
    `Could not upload \`${filename}\` because it exceeds the Discord upload limit. File size: ${formatBytes(size)}. Configured limit: ${formatBytes(limit)}.`,
  );
}

function isDiscordUploadTooLargeError(error) {
  const message = getErrorMessage(error).toLowerCase();
  return message.includes("413") || message.includes("request entity too large") || message.includes("file") && message.includes("size");
}

async function uploadAttachmentToDiscord(channelId, resolved, caption = "") {
  const limit = getDiscordUploadLimitBytes();
  const size = resolved.size ?? 0;
  if (size > limit || resolved.tooLarge) {
    const response = await sendDiscordMessage(
      channelId,
      JSON.stringify({
        content: buildUploadLimitMessage(resolved.filename, size, limit),
      }),
    );
    return {
      mode: "limit-message",
      response,
      detail: `Upload skipped because ${resolved.filename} is ${formatBytes(size)}, above the configured limit ${formatBytes(limit)}.`,
    };
  }

  try {
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
    const response = await sendDiscordMessage(channelId, form);
    return {
      mode: "uploaded",
      response,
      detail: `Uploaded ${resolved.filename} to Discord channel ${channelId}. Message id: ${response.id}`,
    };
  } catch (error) {
    if (!isDiscordUploadTooLargeError(error)) {
      throw error;
    }

    const response = await sendDiscordMessage(
      channelId,
      JSON.stringify({
        content: buildUploadLimitMessage(resolved.filename, size, limit),
      }),
    );
    return {
      mode: "limit-message",
      response,
      detail: `Discord rejected ${resolved.filename} because of upload size limits.`,
    };
  }
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
    const upload = await uploadAttachmentToDiscord(channelId, resolved, caption);
    response = upload.response;
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

async function handleSendDiscordFile(args) {
  const channelId = String(args.channel_id ?? "").trim();
  const file = String(args.file ?? "").trim();
  const caption = typeof args.caption === "string" ? args.caption.trim() : "";

  if (!/^\d+$/.test(channelId)) {
    throw new Error("channel_id must be a Discord snowflake string");
  }

  if (!file) {
    throw new Error("file is required");
  }

  const resolved = await resolveFileInput(file);
  const upload = await uploadAttachmentToDiscord(channelId, resolved, caption);

  return {
    content: [
      {
        type: "text",
        text:
          upload.mode === "uploaded"
            ? `Sent file to Discord channel ${channelId}. Message id: ${upload.response.id}`
            : `Could not upload file to Discord channel ${channelId} because of the file size limit. A fallback message was sent instead. Message id: ${upload.response.id}`,
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
    {
      name: "send_discord_file",
      description:
        "Send a file into a Discord channel. Use this when the user explicitly wants a non-image file uploaded to Discord. If the file exceeds Discord upload limits, the tool posts a fallback message instead.",
      inputSchema: {
        type: "object",
        properties: {
          channel_id: {
            type: "string",
            description: "Discord channel id where the file should be sent.",
          },
          file: {
            type: "string",
            description:
              "Local file path, remote https URL, or data:... URL. Local files must be under CODEX_WORKSPACE, HOME, /tmp, or DISCORD_MCP_ALLOWED_ROOTS.",
          },
          caption: {
            type: "string",
            description: "Optional message content to send with the file.",
          },
        },
        required: ["channel_id", "file"],
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

      if (name === "send_discord_file") {
        writeResult(id, await handleSendDiscordFile(args));
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
