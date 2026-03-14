import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { extractImageMarkers, resolveLocalImages } from "../src/discord-images.js";

test("extractImageMarkers removes markers and keeps image references", () => {
  const extracted = extractImageMarkers("before [[image:./chart.png]] after [[image:/tmp/out.webp]]");

  assert.equal(extracted.cleanText, "before  after");
  assert.deepEqual(extracted.imageReferences, ["./chart.png", "/tmp/out.webp"]);
});

test("resolveLocalImages resolves relative paths within allowed roots", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-discord-images-"));
  const imagePath = path.join(tempDir, "chart.png");
  await fs.writeFile(imagePath, "png");

  const result = await resolveLocalImages(["./chart.png"], {
    cwd: tempDir,
    allowedRoots: [tempDir, "/tmp"],
  });

  assert.equal(result.errors.length, 0);
  assert.equal(result.images.length, 1);
  assert.equal(result.images[0]?.resolvedPath, imagePath);
});

test("resolveLocalImages rejects unsupported extensions and disallowed roots", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-discord-images-"));
  const textPath = path.join(tempDir, "note.txt");
  await fs.writeFile(textPath, "hello");

  const result = await resolveLocalImages([textPath, "/etc/passwd"], {
    cwd: tempDir,
    allowedRoots: [tempDir],
  });

  assert.equal(result.images.length, 0);
  assert.deepEqual(result.errors, [
    `unsupported image type: ${textPath}`,
    "unsupported image type: /etc/passwd",
  ]);
});
