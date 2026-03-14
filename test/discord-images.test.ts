import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveImageArtifacts } from "../src/discord-images.js";

test("resolveImageArtifacts resolves local imageView artifacts within allowed roots", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codexbox-images-"));
  const imagePath = path.join(tempDir, "chart.png");
  await fs.writeFile(imagePath, "png");

  const result = await resolveImageArtifacts(
    [
      {
        source: "imageView",
        value: "./chart.png",
      },
    ],
    {
      cwd: tempDir,
      allowedRoots: [tempDir, "/tmp"],
    },
  );

  assert.equal(result.errors.length, 0);
  assert.deepEqual(result.images, [
    {
      kind: "attachment",
      resolvedPath: imagePath,
      filename: "chart.png",
    },
  ]);
});

test("resolveImageArtifacts preserves remote image URLs", async () => {
  const result = await resolveImageArtifacts(
    [
      {
        source: "imageGeneration",
        value: "https://example.com/generated.png",
      },
    ],
    {
      cwd: "/tmp",
      allowedRoots: ["/tmp"],
    },
  );

  assert.equal(result.errors.length, 0);
  assert.deepEqual(result.images, [
    {
      kind: "url",
      url: "https://example.com/generated.png",
    },
  ]);
});

test("resolveImageArtifacts rejects unsupported extensions and disallowed roots", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codexbox-images-"));
  const textPath = path.join(tempDir, "note.txt");
  await fs.writeFile(textPath, "hello");

  const result = await resolveImageArtifacts(
    [
      {
        source: "imageView",
        value: textPath,
      },
      {
        source: "imageView",
        value: "/etc/passwd",
      },
    ],
    {
      cwd: tempDir,
      allowedRoots: [tempDir],
    },
  );

  assert.equal(result.images.length, 0);
  assert.deepEqual(result.errors, [
    `unsupported image type: ${textPath}`,
    "unsupported image type: /etc/passwd",
  ]);
});

test("resolveImageArtifacts deduplicates repeated artifacts", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codexbox-images-"));
  const imagePath = path.join(tempDir, "chart.png");
  await fs.writeFile(imagePath, "png");

  const result = await resolveImageArtifacts(
    [
      {
        source: "imageView",
        value: imagePath,
      },
      {
        source: "imageView",
        value: imagePath,
      },
    ],
    {
      cwd: tempDir,
      allowedRoots: [tempDir],
    },
  );

  assert.equal(result.errors.length, 0);
  assert.equal(result.images.length, 1);
});
