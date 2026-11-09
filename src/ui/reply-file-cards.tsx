import { createContext, useContext, useState } from "react";
import { Download, File, FileArchive, FileAudio, FileImage, FileText, FileVideo, FolderOpen, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { describeError } from "../hermes/gateway-error";
import { fileName } from "../hermes/reply-files";

/** Saving the files Bots hand over, given by the shell so every transcript can. */
export interface GatewayFiles {
  /** Saves `path` on the gateway, as `profile` sees it, in Downloads; returns where it went. */
  download(profile: string, path: string): Promise<string>;
  reveal(localPath: string): Promise<void>;
}

export const GatewayFilesContext = createContext<GatewayFiles | undefined>(undefined);

const KINDS: Array<{ pattern: RegExp; icon: typeof File }> = [
  { pattern: /\.(png|jpe?g|gif|webp|bmp|svg|heic|avif)$/i, icon: FileImage },
  { pattern: /\.(mp4|mov|webm|mkv|avi|m4v)$/i, icon: FileVideo },
  { pattern: /\.(mp3|wav|ogg|m4a|flac|aac|opus)$/i, icon: FileAudio },
  { pattern: /\.(zip|tar|gz|tgz|7z|rar|xz)$/i, icon: FileArchive },
  { pattern: /\.(pdf|txt|md|csv|json|docx?|xlsx?|pptx?|html?)$/i, icon: FileText },
];

/** The files a reply hands over, each with Download. */
export function ReplyFileCards({ profile, files }: { profile: string | undefined; files: string[] }) {
  if (!profile || files.length === 0) return null;
  return (
    // `not-prose`: replies are typeset as prose, which would give this list bullets and spacing.
    <ul className="not-prose mt-2 flex flex-col gap-1.5" aria-label="Files">
      {files.map((path) => (
        <li key={path}>
          <FileCard profile={profile} path={path} />
        </li>
      ))}
    </ul>
  );
}

type Saving = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; localPath: string } | { kind: "failed"; message: string };

function FileCard({ profile, path }: { profile: string; path: string }) {
  const files = useContext(GatewayFilesContext);
  const [saving, setSaving] = useState<Saving>({ kind: "idle" });
  const Icon = KINDS.find((kind) => kind.pattern.test(path))?.icon ?? File;

  async function download() {
    if (!files) return;
    setSaving({ kind: "saving" });
    try {
      setSaving({ kind: "saved", localPath: await files.download(profile, path) });
    } catch (error) {
      setSaving({ kind: "failed", message: describeError(error) });
    }
  }

  return (
    <div className="flex max-w-md items-center gap-3 rounded-lg border bg-card px-3 py-2 text-sm">
      <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium" title={path}>
          {fileName(path)}
        </p>
        <p className="truncate text-xs text-muted-foreground" role={saving.kind === "failed" ? "alert" : "status"}>
          {saving.kind === "saved"
            ? `Saved to ${saving.localPath}`
            : saving.kind === "failed"
              ? saving.message
              : saving.kind === "saving"
                ? "Downloading…"
                : "On the gateway"}
        </p>
      </div>
      {saving.kind === "saved" ? (
        <Button type="button" variant="outline" size="sm" onClick={() => void files?.reveal(saving.localPath)}>
          <FolderOpen aria-hidden />
          Show
        </Button>
      ) : (
        <Button type="button" variant="outline" size="sm" disabled={!files || saving.kind === "saving"} onClick={() => void download()}>
          {saving.kind === "saving" ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}
          {saving.kind === "failed" ? "Try again" : "Download"}
        </Button>
      )}
    </div>
  );
}
