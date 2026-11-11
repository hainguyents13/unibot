import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Download, File, FileArchive, FileAudio, FileImage, FileText, FileVideo, FolderOpen, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { describeError } from "../hermes/gateway-error";
import { fileName, mediaOf } from "../hermes/reply-files";

/** Reading and saving the files Bots hand over, given by the shell so every transcript can. */
export interface GatewayFiles {
  /** The file at `path` on the gateway, as `profile` sees it, whole. */
  read(profile: string, path: string): Promise<Uint8Array>;
  /** Saves `bytes` in Downloads as `name`; returns where they went. */
  save(bytes: Uint8Array, name: string): Promise<string>;
  reveal(localPath: string): Promise<void>;
}

export const GatewayFilesContext = createContext<GatewayFiles | undefined>(undefined);

const ICONS: Array<{ pattern: RegExp; icon: typeof File }> = [
  { pattern: /\.(png|jpe?g|gif|webp|bmp|svg|heic|avif)$/i, icon: FileImage },
  { pattern: /\.(mp4|mov|webm|mkv|avi|m4v)$/i, icon: FileVideo },
  { pattern: /\.(mp3|wav|ogg|oga|m4a|flac|aac|opus)$/i, icon: FileAudio },
  { pattern: /\.(zip|tar|gz|tgz|7z|rar|xz)$/i, icon: FileArchive },
  { pattern: /\.(pdf|txt|md|csv|json|docx?|xlsx?|pptx?|html?)$/i, icon: FileText },
];

/** The files a reply hands over: images shown, video and audio playable, and each with Download. */
export function ReplyFileCards({ profile, files }: { profile: string | undefined; files: string[] }) {
  if (!profile || files.length === 0) return null;
  return (
    // `not-prose`: replies are typeset as prose, which would give this list bullets and spacing.
    <ul className="not-prose mt-2 flex flex-col gap-2" aria-label="Files">
      {files.map((path) => (
        <li key={path}>
          <FileCard profile={profile} path={path} />
        </li>
      ))}
    </ul>
  );
}

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "saving" }
  | { kind: "saved"; localPath: string }
  | { kind: "failed"; message: string };

function FileCard({ profile, path }: { profile: string; path: string }) {
  const files = useContext(GatewayFilesContext);
  const media = mediaOf(path);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  /** Where the loaded file plays or shows from; set once its bytes are here. */
  const [url, setUrl] = useState<string>();
  /** Kept so Download after Play saves what's already here instead of fetching it again. */
  const bytes = useRef<Uint8Array>(undefined);
  const Icon = ICONS.find((kind) => kind.pattern.test(path))?.icon ?? File;

  async function load(): Promise<Uint8Array> {
    if (!files) throw new Error("Files aren't available here.");
    bytes.current ??= await files.read(profile, path);
    return bytes.current;
  }

  async function play() {
    setStatus({ kind: "loading" });
    try {
      const loaded = await load();
      setUrl(URL.createObjectURL(new Blob([loaded as BlobPart], { type: media?.type })));
      setStatus({ kind: "idle" });
    } catch (error) {
      setStatus({ kind: "failed", message: describeError(error) });
    }
  }

  async function download() {
    if (!files) return;
    setStatus({ kind: "saving" });
    try {
      setStatus({ kind: "saved", localPath: await files.save(await load(), fileName(path)) });
    } catch (error) {
      setStatus({ kind: "failed", message: describeError(error) });
    }
  }

  // Images are small and are the point of the reply, so they show without a click.
  useEffect(() => {
    if (media?.kind === "image") void play();
    // Once per card: a card is one file, and `play` reads what it needs itself.
  }, []);

  // The bytes stay in memory while the URL lives, so it goes with the card.
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);

  const busy = status.kind === "loading" || status.kind === "saving";
  const line =
    status.kind === "saved"
      ? `Saved to ${status.localPath}`
      : status.kind === "failed"
        ? status.message
        : status.kind === "loading"
          ? "Loading…"
          : status.kind === "saving"
            ? "Downloading…"
            : "On the gateway";

  return (
    <div className="flex max-w-xl flex-col gap-2 rounded-card bg-surface p-2 shadow-card" style={{ animation: "fade-up 400ms cubic-bezier(0.23,1,0.32,1) both" }}>
      {url && media?.kind === "image" && <img src={url} alt={fileName(path)} className="max-h-80 w-fit max-w-full rounded-control object-contain" style={{ animation: "fade-in 300ms ease-out both" }} />}
      {url && media?.kind === "video" && <video src={url} controls autoPlay className="max-h-[420px] w-full rounded-control bg-black" style={{ animation: "pop-in 240ms cubic-bezier(0.23,1,0.32,1) both" }} aria-label={fileName(path)} />}
      {url && media?.kind === "audio" && <audio src={url} controls autoPlay className="w-full" style={{ animation: "fade-in 300ms ease-out both" }} aria-label={fileName(path)} />}
      <div className="flex items-center gap-2.5 px-1">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-control bg-field text-ink-2 shadow-hairline">
          <Icon className="size-4" strokeWidth={1.8} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-ink" title={path}>
            {fileName(path)}
          </p>
          <p className={`truncate text-[12px] ${status.kind === "failed" ? "text-red" : "text-ink-3"}`} role={status.kind === "failed" ? "alert" : "status"}>
            {line}
          </p>
        </div>
        {(media?.kind === "video" || media?.kind === "audio") && !url && (
          <Button type="button" variant="outline" size="sm" disabled={!files || busy} onClick={() => void play()}>
            {status.kind === "loading" ? <Spinner /> : <Play aria-hidden />}
            Play
          </Button>
        )}
        {status.kind === "saved" ? (
          <Button type="button" variant="outline" size="sm" onClick={() => void files?.reveal(status.localPath)}>
            <FolderOpen aria-hidden />
            Show
          </Button>
        ) : (
          <Button type="button" variant="outline" size="sm" disabled={!files || busy} onClick={() => void download()}>
            {status.kind === "saving" ? <Spinner /> : <Download aria-hidden />}
            Download
          </Button>
        )}
      </div>
    </div>
  );
}

/** Beautiful UI's small ring spinner (ThinkingState), in a button while a file comes or saves. */
function Spinner() {
  return <span className="size-3 shrink-0 rounded-full border-[1.5px] border-line-strong border-t-ink-2" style={{ animation: "spin 700ms linear infinite" }} aria-hidden />;
}