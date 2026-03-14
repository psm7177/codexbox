import assert from "node:assert/strict";
import test from "node:test";
import { downloadDiscordAttachments, formatDownloadedAttachmentContext } from "../src/discord-attachments.js";

test("downloadDiscordAttachments saves text attachments and formats context", async () => {
  const body = "api token example\n";
  const attachments = await downloadDiscordAttachments([
    {
      name: "auth-example.txt",
      url: `data:text/plain;base64,${Buffer.from(body).toString("base64")}`,
      contentType: "text/plain",
    },
  ]);

  assert.equal(attachments.length, 1);
  assert.equal(attachments[0]?.kind, "text");
  assert.match(attachments[0]?.savedPath ?? "", /^\/tmp\/codexbox-discord-/);
  assert.match(attachments[0]?.textContent ?? "", /api token example/);

  const context = formatDownloadedAttachmentContext(attachments);
  assert.match(context, /\[Downloaded Discord attachments\]/);
  assert.match(context, /Do not move them into the workspace unless the user explicitly asks/);
  assert.match(context, /api token example/);
});

test("downloadDiscordAttachments classifies image attachments", async () => {
  const tinyPngBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5W6iUAAAAASUVORK5CYII=";
  const attachments = await downloadDiscordAttachments([
    {
      name: "pixel.png",
      url: `data:image/png;base64,${tinyPngBase64}`,
      contentType: "image/png",
    },
  ]);

  assert.equal(attachments.length, 1);
  assert.equal(attachments[0]?.kind, "image");
  assert.equal(attachments[0]?.textContent, undefined);
});
