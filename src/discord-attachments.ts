import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const MAX_ATTACHMENT_TEXT_BYTES = 64 * 1024;
const TEXT_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cs",
  ".css",
  ".csv",
  ".go",
  ".h",
  ".hpp",
  ".html",
  ".java",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".py",
  ".rb",
  ".rs",
  ".sh",
  ".sql",
  ".svg",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);

export interface DiscordAttachmentLike {
  name: string | null;
  url: string;
  contentType?: string | null;
  size?: number;
}

export interface DownloadedAttachment {
  originalName: string;
  savedPath: string;
  contentType?: string;
  size: number;
  kind: "image" | "text" | "file";
  textContent?: string;
  truncated?: boolean;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "attachment";
}

function inferKind(contentType: string | undefined, filename: string, bytes: Buffer): DownloadedAttachment["kind"] {
  if (contentType?.startsWith("image/")) {
    return "image";
  }

  const extension = path.extname(filename).toLowerCase();
  if (TEXT_EXTENSIONS.has(extension)) {
    return "text";
  }

  const probe = bytes.subarray(0, Math.min(bytes.byteLength, 4096)).toString("utf8");
  if (!probe.includes("\u0000")) {
    return "text";
  }

  return "file";
}

async function readAttachmentBytes(attachment: DiscordAttachmentLike, fetchImpl: typeof fetch): Promise<Buffer> {
  const response = await fetchImpl(attachment.url);
  if (!response.ok) {
    throw new Error(`failed to download attachment: ${attachment.name ?? attachment.url} (${response.status})`);
  }

  return Buffer.from(await response.arrayBuffer());
}

function formatTextContent(bytes: Buffer): { text: string; truncated: boolean } {
  const truncated = bytes.byteLength > MAX_ATTACHMENT_TEXT_BYTES;
  const safeBytes = truncated ? bytes.subarray(0, MAX_ATTACHMENT_TEXT_BYTES) : bytes;
  const text = safeBytes.toString("utf8");
  return {
    text: truncated ? `${text}\n... (truncated)` : text,
    truncated,
  };
}

export function formatDownloadedAttachmentContext(attachments: DownloadedAttachment[]): string {
  if (attachments.length === 0) {
    return "";
  }

  const lines = [
    "[Downloaded Discord attachments]",
    "These files were downloaded to /tmp. Do not move them into the workspace unless the user explicitly asks.",
  ];

  for (const attachment of attachments) {
    const details = [`${attachment.originalName} -> ${attachment.savedPath}`, attachment.kind];
    if (attachment.truncated) {
      details.push("truncated");
    }
    lines.push(`- ${details.join(" | ")}`);
  }

  for (const attachment of attachments) {
    if (attachment.kind !== "text" || !attachment.textContent) {
      continue;
    }

    const extension = path.extname(attachment.originalName).replace(/^\./, "") || "text";
    lines.push("");
    lines.push(`[Attachment file: ${attachment.savedPath}]`);
    lines.push(`\`\`\`${extension}`);
    lines.push(attachment.textContent.trimEnd());
    lines.push("```");
  }

  return lines.join("\n");
}

export async function downloadDiscordAttachments(
  attachments: Iterable<DiscordAttachmentLike>,
  options?: { fetchImpl?: typeof fetch },
): Promise<DownloadedAttachment[]> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codexbox-discord-"));
  const fetchImpl = options?.fetchImpl ?? fetch;
  const downloaded: DownloadedAttachment[] = [];
  const usedNames = new Set<string>();

  for (const attachment of attachments) {
    const originalName = attachment.name?.trim() || "attachment";
    const baseName = sanitizeFilename(originalName);
    let candidateName = baseName;
    let suffix = 1;
    while (usedNames.has(candidateName)) {
      const extension = path.extname(baseName);
      const stem = extension ? baseName.slice(0, -extension.length) : baseName;
      candidateName = `${stem}-${suffix}${extension}`;
      suffix += 1;
    }
    usedNames.add(candidateName);

    const bytes = await readAttachmentBytes(attachment, fetchImpl);
    const savedPath = path.join(directory, candidateName);
    await fs.writeFile(savedPath, bytes);

    const kind = inferKind(attachment.contentType ?? undefined, candidateName, bytes);
    const textPayload = kind === "text" ? formatTextContent(bytes) : undefined;
    downloaded.push({
      originalName,
      savedPath,
      contentType: attachment.contentType ?? undefined,
      size: bytes.byteLength,
      kind,
      textContent: textPayload?.text,
      truncated: textPayload?.truncated,
    });
  }

  return downloaded;
}
