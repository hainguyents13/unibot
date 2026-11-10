/** A reply's text to show, and the files on the gateway it hands you. */
export interface ReplyFiles {
  /** The reply without its `MEDIA:` lines, which Hermes means as files, not words. */
  text: string;
  /** Absolute paths on the gateway, in the order the reply names them, each once. */
  files: string[];
}

/**
 * An absolute path ending in a file name with an extension, standing alone: after a space, a
 * quote, a backtick or a bracket, so the path part of a URL (`https://host/a.png`) doesn't count.
 */
const PATH = /(?:^|[\s`'"(\[])(\/(?:[\w.@+-]+\/)*[\w.@+-]*[\w-]\.[A-Za-z0-9]{1,8})(?=$|[\s`'")\],;:!?]|\.(?:\s|$))/g;

/** The path of a `MEDIA:` line, unquoted. */
function mediaPath(line: string): string {
  return line
    .slice("MEDIA:".length)
    .trim()
    .replace(/^[`"']+|[`"']+$/g, "");
}

/**
 * The files a Bot's reply delivers. Hermes's `MEDIA:/path` lines come out of the text; an absolute
 * path written in the reply stays in it and is offered too, since a Bot told it's in a terminal
 * (as Unibot's chats are) gives a path instead. Code blocks are left alone: paths there are usually
 * commands, not deliveries.
 */
export function replyFiles(reply: string): ReplyFiles {
  const files: string[] = [];
  const add = (path: string) => {
    if (path.startsWith("/") && !files.includes(path)) files.push(path);
  };
  const kept: string[] = [];
  let inFence = false;
  for (const line of reply.split("\n")) {
    const trimmed = line.trim();
    if (/^(```|~~~)/.test(trimmed)) {
      inFence = !inFence;
      kept.push(line);
      continue;
    }
    if (!inFence && trimmed.startsWith("MEDIA:")) {
      add(mediaPath(trimmed));
      continue;
    }
    if (!inFence) for (const match of line.matchAll(PATH)) add(match[1]);
    kept.push(line);
  }
  return { text: kept.join("\n").replace(/\n{3,}/g, "\n\n").trim(), files };
}

const MEDIA: Record<string, { kind: "image" | "video" | "audio"; type: string }> = {
  png: { kind: "image", type: "image/png" },
  jpg: { kind: "image", type: "image/jpeg" },
  jpeg: { kind: "image", type: "image/jpeg" },
  gif: { kind: "image", type: "image/gif" },
  webp: { kind: "image", type: "image/webp" },
  bmp: { kind: "image", type: "image/bmp" },
  svg: { kind: "image", type: "image/svg+xml" },
  avif: { kind: "image", type: "image/avif" },
  mp4: { kind: "video", type: "video/mp4" },
  m4v: { kind: "video", type: "video/mp4" },
  mov: { kind: "video", type: "video/quicktime" },
  webm: { kind: "video", type: "video/webm" },
  mp3: { kind: "audio", type: "audio/mpeg" },
  m4a: { kind: "audio", type: "audio/mp4" },
  aac: { kind: "audio", type: "audio/aac" },
  wav: { kind: "audio", type: "audio/wav" },
  ogg: { kind: "audio", type: "audio/ogg" },
  oga: { kind: "audio", type: "audio/ogg" },
  opus: { kind: "audio", type: "audio/ogg" },
  flac: { kind: "audio", type: "audio/flac" },
};

/**
 * Whether the file shows in the chat (an image) or plays there (video, audio), and the type to
 * give its bytes so the webview can. Only formats the webview plays; others stay download-only.
 */
export function mediaOf(path: string): { kind: "image" | "video" | "audio"; type: string } | undefined {
  const extension = /\.([A-Za-z0-9]+)$/.exec(path)?.[1]?.toLowerCase();
  return extension ? MEDIA[extension] : undefined;
}

/** The file's own name, from its path. */
export function fileName(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}
