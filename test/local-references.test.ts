import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveLocalReferences } from "../src/local-references.js";

test("resolveLocalReferences injects local file content into the prompt", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codexbox-local-ref-"));
  const filePath = path.join(tempDir, "example.txt");
  await fs.writeFile(filePath, "hello from file\n", "utf8");

  const result = await resolveLocalReferences("read this [[local:example.txt]]", {
    cwd: tempDir,
    allowedRoots: [tempDir],
  });

  assert.match(result.text, /read this \[Local file:/);
  assert.match(result.text, /hello from file/);
  assert.deepEqual(result.references, ["example.txt"]);
});

test("resolveLocalReferences rejects out-of-bounds files", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codexbox-local-ref-"));
  const outsidePath = path.join(os.tmpdir(), "codexbox-local-ref-outside.txt");
  await fs.writeFile(outsidePath, "secret\n", "utf8");

  await assert.rejects(() =>
    resolveLocalReferences(`read this [[local:${outsidePath}]]`, {
      cwd: tempDir,
      allowedRoots: [tempDir],
    }),
  );
});
