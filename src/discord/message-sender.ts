import { AttachmentBuilder, type Message } from "discord.js";

export interface EditableMessage {
  edit: (content: string) => Promise<unknown>;
}

export interface LocalImageAttachment {
  resolvedPath: string;
  filename: string;
}

export async function sendToChannel(message: Message, content: string): Promise<void> {
  if (!message.channel?.isSendable?.()) {
    throw new Error("Message channel is not sendable");
  }
  await message.channel.send(content);
}

export async function sendImagesToChannel(message: Message, imagePaths: LocalImageAttachment[]): Promise<void> {
  if (!message.channel?.isSendable?.()) {
    throw new Error("Message channel is not sendable");
  }

  for (const image of imagePaths) {
    const attachment = new AttachmentBuilder(image.resolvedPath, { name: image.filename });
    await message.channel.send({ files: [attachment] });
  }
}

export async function editMessageIfChanged(
  message: EditableMessage,
  content: string,
  lastContent: { value: string },
): Promise<void> {
  if (content === lastContent.value) {
    return;
  }

  await message.edit(content);
  lastContent.value = content;
}
