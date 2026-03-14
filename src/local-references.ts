import fs from "node:fs/promises";
import path from "node:path";
import { isPathWithinRoot } from "./state/workspace-service.js";

const LOCAL_REFERENCE_PATTERN = /\[\[local:(.+?)\]\]/g;
const MAX_LOCAL_FILE_BYTES = 64 * 1024;

export interface ResolveLocalReferencesOptions {
  cwd: string;
  allowedRoots: string[];
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

async function readLocalFile(reference: string, options: ResolveLocalReferencesOptions): Promise<string> {
  const candidatePath = path.isAbsolute(reference) ? reference : path.resolve(options.cwd, reference);
  const normalizedPath = path.resolve(candidatePath);
  const realPath = await fs.realpath(normalizedPath);
  const allowedRoots = await resolveAllowedRoots(options.allowedRoots);

  if (!allowedRoots.some((root) => isPathWithinRoot(realPath, root))) {
    throw new Error(`local file is outside allowed roots: ${reference}`);
  }

  const stats = await fs.stat(realPath);
  if (!stats.isFile()) {
    throw new Error(`local path is not a file: ${reference}`);
  }

  const bytes = await fs.readFile(realPath);
  const truncated = bytes.byteLength > MAX_LOCAL_FILE_BYTES;
  const safeBytes = truncated ? bytes.subarray(0, MAX_LOCAL_FILE_BYTES) : bytes;
  const text = safeBytes.toString("utf8");

  if (text.includes("\u0000")) {
    throw new Error(`local file is not a UTF-8 text file: ${reference}`);
  }

  const body = truncated ? `${text}\n... (truncated)` : text;
  const extension = path.extname(realPath).replace(/^\./, "") || "text";
  return [
    `[Local file: ${realPath}]`,
    `\`\`\`${extension}`,
    body.trimEnd(),
    "```",
  ].join("\n");
}

export async function resolveLocalReferences(
  text: string,
  options: ResolveLocalReferencesOptions,
): Promise<{ text: string; references: string[] }> {
  const matches = Array.from(text.matchAll(LOCAL_REFERENCE_PATTERN));
  if (matches.length === 0) {
    return { text, references: [] };
  }

  let nextText = text;
  const references: string[] = [];

  for (const match of matches) {
    const rawReference = match[1]?.trim();
    if (!rawReference) {
      continue;
    }

    const replacement = await readLocalFile(rawReference, options);
    references.push(rawReference);
    nextText = nextText.replace(match[0], replacement);
  }

  return { text: nextText, references };
}
