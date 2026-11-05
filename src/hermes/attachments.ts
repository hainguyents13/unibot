/** A file picked, dropped or pasted, waiting to go with the next message. */
export interface Attachment {
  name: string;
  bytes: Uint8Array;
}

/**
 * An attachment as a sent message names it: an `@image:` or `@file:` line after the text, which is
 * also how the gateway's history shows them.
 */
export interface AttachmentRef {
  kind: "image" | "file";
  /** The file's path on the gateway, absolute or relative to the chat's workspace. */
  path: string;
}

/** Image types the gateway accepts as images. Others go as files. */
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp"]);

export function attachmentKind(name: string): AttachmentRef["kind"] {
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  return IMAGE_EXTENSIONS.has(ext) ? "image" : "file";
}

/** The gateway's cap for images; files get the same room as its largest upload (PDFs). */
export function sizeLimit(name: string): number {
  return (attachmentKind(name) === "image" ? 25 : 50) * 1024 * 1024;
}

export function refName(ref: AttachmentRef): string {
  return ref.path.split(/[\\/]/).pop() ?? ref.path;
}

/** The line naming it, quoted the way Hermes reads references back (`format_reference_value`). */
export function refLine(ref: AttachmentRef): string {
  const prefix = ref.kind === "image" ? "@image:" : "@file:";
  if (!/[\s()[\]{}<>"'`]/.test(ref.path)) return prefix + ref.path;
  const quote = ["`", '"', "'"].find((q) => !ref.path.includes(q));
  return quote ? prefix + quote + ref.path + quote : prefix + ref.path;
}

/** Reads one `@image:` or `@file:` line; `undefined` for anything else. */
export function parseRefLine(input: string): AttachmentRef | undefined {
  const line = input.trim();
  let kind: AttachmentRef["kind"];
  let value: string;
  if (line.startsWith("@image:")) [kind, value] = ["image", line.slice(7)];
  else if (line.startsWith("@file:")) [kind, value] = ["file", line.slice(6)];
  else return undefined;
  const first = value[0];
  if (first && "`\"'".includes(first) && value.length > 1 && value.endsWith(first)) value = value.slice(1, -1);
  else if (/\s/.test(value)) return undefined;
  return value ? { kind, path: value } : undefined;
}

/** Splits the attachment lines off the end of a message: what you wrote, and what you sent with it. */
export function splitAttachments(message: string): { text: string; attachments: AttachmentRef[] } {
  const lines = message.split("\n");
  const attachments: AttachmentRef[] = [];
  while (lines.length) {
    const last = lines[lines.length - 1];
    const ref = parseRefLine(last);
    if (ref) attachments.unshift(ref);
    else if (last.trim() || attachments.length === 0) break;
    lines.pop();
  }
  if (attachments.length === 0) return { text: message, attachments: [] };
  return { text: lines.join("\n").trim(), attachments };
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}
