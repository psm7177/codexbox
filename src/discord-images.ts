import fs from "node:fs/promises";
import path from "node:path";

const IMAGE_MARKER_PATTERN = /\[\[image:(.+?)\]\]/g;
const SUPPORTED_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

export interface ExtractedImageMarkers {
  cleanText: string;
  imageReferences: string[];
}

export interface ResolvedLocalImage {
  originalPath: string;
  resolvedPath: string;
  filename: string;
}

export function extractImageMarkers(text: string): ExtractedImageMarkers {
  const imageReferences: string[] = [];
  const cleanText = text
    .replace(IMAGE_MARKER_PATTERN, (_, rawPath: string) => {
      const imagePath = rawPath.trim();
      if (imagePath) {
        imageReferences.push(imagePath);
      }
      return "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { cleanText, imageReferences };
}

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

export async function resolveLocalImages(
  imageReferences: string[],
  options: { cwd: string; allowedRoots: string[] },
): Promise<{ images: ResolvedLocalImage[]; errors: string[] }> {
  const allowedRoots = await resolveAllowedRoots(options.allowedRoots);
  const images: ResolvedLocalImage[] = [];
  const errors: string[] = [];

  for (const reference of imageReferences) {
    const candidatePath = path.isAbsolute(reference) ? reference : path.resolve(options.cwd, reference);
    const normalizedPath = path.resolve(candidatePath);

    try {
      const realPath = await fs.realpath(normalizedPath);
      const stats = await fs.stat(realPath);
      if (!stats.isFile()) {
        errors.push(`image is not a file: ${reference}`);
        continue;
      }

      const extension = path.extname(realPath).toLowerCase();
      if (!SUPPORTED_IMAGE_EXTENSIONS.has(extension)) {
        errors.push(`unsupported image type: ${reference}`);
        continue;
      }

      if (!allowedRoots.some((root) => isPathWithinRoot(realPath, root))) {
        errors.push(`image is outside allowed roots: ${reference}`);
        continue;
      }

      images.push({
        originalPath: reference,
        resolvedPath: realPath,
        filename: path.basename(realPath),
      });
    } catch {
      errors.push(`image not found: ${reference}`);
    }
  }

  return { images, errors };
}
