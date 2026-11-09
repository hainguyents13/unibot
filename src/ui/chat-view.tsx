import { useState, useSyncExternalStore, type DragEvent } from "react";
import { PanelRight, Puzzle, Upload } from "lucide-react";
import { ChatContainerContent, ChatContainerRoot } from "@/components/ui/chat-container";
import { ScrollButton } from "@/components/ui/scroll-button";
import type { Attachment } from "../hermes/attachments";
import type { ChatThread } from "../hermes/chat-thread";
import type { Bot } from "../hermes/types";
import { ChatHeader, HeaderTool } from "./chat-header";
import { Composer } from "./composer";
import { ConnectionCard } from "./connection-card";
import { RequestCards } from "./request-cards";
import { Note, Problem } from "./settings-parts";
import { TranscriptView } from "./transcript-view";

interface ChatViewProps {
  bot: Bot;
  thread: ChatThread;
  /** Opens this Bot's apps in Settings. */
  openApps: () => void;
  /** Whether the panel with its settings, routines and computer is open, and a way to flip it. */
  panelOpen: boolean;
  onTogglePanel: () => void;
}

export function ChatView({ bot, thread, openApps, panelOpen, onTogglePanel }: ChatViewProps) {
  const view = useSyncExternalStore(thread.subscribe, thread.getView);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const canAttach = view.canSend && !view.isRunning && !view.isUploading;

  async function attach(files: FileList | File[]) {
    const read = await Promise.all(
      [...files].map(async (file) => ({
        name: file.name || `pasted-${Date.now()}.png`,
        bytes: new Uint8Array(await file.arrayBuffer()),
      })),
    );
    setAttachments((current) => [...current, ...read]);
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (canAttach && event.dataTransfer.files.length) void attach(event.dataTransfer.files);
  }

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      onDragOver={(e) => {
        if (!canAttach || !e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <ChatHeader title={bot.name} subtitle={bot.about}>
        <HeaderTool icon={<Puzzle />} label="Apps" onClick={openApps} />
        <HeaderTool icon={<PanelRight />} label="Details" pressed={panelOpen} onClick={onTogglePanel} />
      </ChatHeader>
      <div className="relative flex min-h-0 flex-1 flex-col">
        {/* Follows the newest message while you're at the bottom, and leaves you be when you scrolled up. */}
        <ChatContainerRoot className={dragging ? "min-h-0 flex-1 opacity-40" : "min-h-0 flex-1"}>
          <ChatContainerContent className="gap-4 px-5 py-5">
            {view.banner && <Note className="mx-auto max-w-3xl rounded-md bg-muted px-3 py-2">{view.banner}</Note>}
            {view.phase.kind === "loading" && (
              <Note className="m-auto" role="status">
                Opening the chat…
              </Note>
            )}
            {view.phase.kind === "failed" && <Problem className="mx-auto max-w-3xl">{view.phase.message}</Problem>}
            {view.phase.kind === "ready" && view.items.length === 0 && !view.isRunning && (
              <Note className="m-auto">No messages yet. Say hello to {bot.name}.</Note>
            )}
            <TranscriptView items={view.items} draft={view.draft} isRunning={view.isRunning} profile={bot.id} />
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
              <RequestCards thread={thread} requests={view.requests} />
              {view.connection && <ConnectionCard thread={thread} card={view.connection} botName={bot.name} online={view.canSend} openApps={openApps} />}
            </div>
          </ChatContainerContent>
          <div className="absolute right-5 bottom-3">
            <ScrollButton className="shadow-sm" />
          </div>
        </ChatContainerRoot>
      </div>
      {dragging && (
        <div className="pointer-events-none absolute inset-x-5 top-20 bottom-28 grid place-items-center rounded-xl border-2 border-dashed border-ring bg-background/70 text-muted-foreground">
          <span className="flex items-center gap-2">
            <Upload className="size-4" aria-hidden />
            Drop files to send them to {bot.name}
          </span>
        </div>
      )}
      <Composer
        key={bot.id}
        thread={thread}
        view={view}
        botName={bot.name}
        attachments={attachments}
        onAttach={(files) => void attach(files)}
        onRemoveAttachment={(index) => setAttachments((current) => current.filter((_, i) => i !== index))}
        onSent={() => setAttachments([])}
      />
    </div>
  );
}
