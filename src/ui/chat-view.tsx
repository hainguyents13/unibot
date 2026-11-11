import { useState, useSyncExternalStore, type DragEvent } from "react";
import { PanelRight, Puzzle, Upload } from "lucide-react";
import { ChatContainerContent, ChatContainerRoot } from "@/components/ui/chat-container";
import { ScrollButton } from "@/components/ui/scroll-button";
import LoadingState from "@/components/primitives/LoadingState";
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
        <ChatContainerRoot className={`min-h-0 flex-1 transition-opacity duration-200 ${dragging ? "opacity-40" : ""}`}>
          <ChatContainerContent className="gap-4 px-5 py-5">
            {view.banner && <Note className="mx-auto w-full max-w-3xl rounded-control bg-inset px-3 py-2 shadow-hairline">{view.banner}</Note>}
            {view.phase.kind === "loading" && (
              <div className="m-auto">
                <LoadingState label="Opening the chat" />
              </div>
            )}
            {view.phase.kind === "failed" && <Problem className="mx-auto max-w-3xl">{view.phase.message}</Problem>}
            {view.phase.kind === "ready" && view.items.length === 0 && !view.isRunning && (
              <Note className="m-auto text-ink-3" style={{ animation: "fade-up 400ms cubic-bezier(0.23,1,0.32,1) both" }}>No messages yet. Say hello to {bot.name}.</Note>
            )}
            <TranscriptView items={view.items} draft={view.draft} isRunning={view.isRunning} profile={bot.id} />
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
              <RequestCards thread={thread} requests={view.requests} />
              {view.connection && <ConnectionCard thread={thread} card={view.connection} botName={bot.name} online={view.canSend} openApps={openApps} />}
            </div>
          </ChatContainerContent>
          <div className="absolute right-5 bottom-3">
            <ScrollButton />
          </div>
        </ChatContainerRoot>
      </div>
      {dragging && (
        <div
          className="pointer-events-none absolute inset-x-5 top-20 bottom-28 grid place-items-center rounded-window border-2 border-dashed border-line-strong bg-surface/80 text-ink-2"
          style={{ animation: "fade-in 150ms ease-out both" }}
        >
          <span className="flex items-center gap-2 text-[13px] font-medium" style={{ animation: "pop-in 200ms cubic-bezier(0.23,1,0.32,1) both" }}>
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
