import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ImageArtifact } from "./codex-app-server-client.js";

const SUPPORTED_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

export interface LocalImageAttachment {
  kind: "attachment";
  resolvedPath: string;
  filename: string;
}

export interface RemoteImageReference {
  kind: "url";
  url: string;
}

export type ResolvedDiscordImage = LocalImageAttachment | RemoteImageReference;

function isPathWithinRoot(targetPath: string, rootPath: string): boolean {
  const relative = path.relative(rootPath, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function resolveAllowedRoots(roots: string[]): Promise<string[]> {
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

function isRemoteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function getExtensionForMimeType(mimeType: string): string | null {
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

async function resolveLocalImage(
  reference: string,
  options: { cwd: string; allowedRoots: string[] },
): Promise<{ image?: LocalImageAttachment; error?: string }> {
  const allowedRoots = await resolveAllowedRoots(options.allowedRoots);
  const candidatePath = path.isAbsolute(reference) ? reference : path.resolve(options.cwd, reference);
  const normalizedPath = path.resolve(candidatePath);

  try {
    const realPath = await fs.realpath(normalizedPath);
    const stats = await fs.stat(realPath);
    if (!stats.isFile()) {
      return { error: `image is not a file: ${reference}` };
    }

    const extension = path.extname(realPath).toLowerCase();
    if (!SUPPORTED_IMAGE_EXTENSIONS.has(extension)) {
      return { error: `unsupported image type: ${reference}` };
    }

    if (!allowedRoots.some((root) => isPathWithinRoot(realPath, root))) {
      return { error: `image is outside allowed roots: ${reference}` };
    }

    return {
      image: {
        kind: "attachment",
        resolvedPath: realPath,
        filename: path.basename(realPath),
      },
    };
  } catch {
    return { error: `image not found: ${reference}` };
  }
}

async function resolveDataUrl(dataUrl: string): Promise<{ image?: LocalImageAttachment; error?: string }> {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    return { error: "unsupported data URL image format" };
  }

  const mimeType = match[1] ?? "";
  const encoded = match[2] ?? "";
  const extension = getExtensionForMimeType(mimeType);
  if (!extension) {
    return { error: `unsupported image type: ${mimeType}` };
  }

  const filePath = path.join(os.tmpdir(), `codex-discord-image-${Date.now()}-${Math.random().toString(36).slice(2)}${extension}`);
  await fs.writeFile(filePath, Buffer.from(encoded, "base64"));
  return {
    image: {
      kind: "attachment",
      resolvedPath: filePath,
      filename: path.basename(filePath),
    },
  };
}

export async function resolveImageArtifacts(
  artifacts: ImageArtifact[],
  options: { cwd: string; allowedRoots: string[] },
): Promise<{ images: ResolvedDiscordImage[]; errors: string[] }> {
  const images: ResolvedDiscordImage[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const artifact of artifacts) {
    const value = artifact.value.trim();
    if (!value) {
      continue;
    }

    const dedupeKey = `${artifact.source}:${value}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);

    if (isRemoteUrl(value)) {
      images.push({
        kind: "url",
        url: value,
      });
      continue;
    }

    if (value.startsWith("data:image/")) {
      const { image, error } = await resolveDataUrl(value);
      if (image) {
        images.push(image);
      } else if (error) {
        errors.push(error);
      }
      continue;
    }

    const { image, error } = await resolveLocalImage(value, options);
    if (image) {
      images.push(image);
    } else if (error) {
      errors.push(error);
    }
  }

  return { images, errors };
}
