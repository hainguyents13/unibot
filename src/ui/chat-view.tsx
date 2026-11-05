import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type DragEvent } from "react";
import type { Attachment } from "../hermes/attachments";
import type { ChatThread } from "../hermes/chat-thread";
import type { RoutineList } from "../hermes/routines";
import type { BotScreen } from "../hermes/screen";
import { CalendarClock, Monitor, Puzzle } from "lucide-react";
import { ConnectionCard } from "./connection-card";
import { RoutinesPanel } from "./routines-panel";
import { ScreenView } from "./screen-view";
import type { Bot } from "../hermes/types";
import { Composer } from "./composer";
import { RequestCards } from "./request-cards";
import { TranscriptView } from "./transcript-view";

interface ChatViewProps {
  bot: Bot;
  thread: ChatThread;
  routines: RoutineList;
  screen: BotScreen;
  /** Opens this Bot's apps in Settings. */
  openApps: () => void;
}

type Panel = "routines" | "computer";

export function ChatView({ bot, thread, routines, screen, openApps }: ChatViewProps) {
  const view = useSyncExternalStore(thread.subscribe, thread.getView);
  const screenView = useSyncExternalStore(screen.subscribe, screen.getView);
  const hasScreen = !!screenView.status?.supported && !!screenView.status.installed;
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [panel, setPanel] = useState<Panel>();
  const toggle = (next: Panel) => setPanel(panel === next ? undefined : next);

  // Whether the Bot has a computer to show; asked again when the chat reconnects.
  useEffect(() => {
    void screen.refresh();
  }, [screen, view.canSend]);
  const [dragging, setDragging] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const canAttach = view.canSend && !view.isRunning && !view.isUploading;

  // Follows the newest message while you're at the bottom, and leaves you be when you scrolled up.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [view]);

  function onScroll() {
    const el = scroller.current;
    if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }

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
      className={`chat-body${dragging ? " dragging" : ""}`}
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
      <header className="chat-header chat-header-row">
        <div>
          <h2>{bot.name}</h2>
          {bot.about && <p>{bot.about}</p>}
        </div>
        <div className="header-tools">
          {hasScreen && (
            <button type="button" className="tool-button" aria-pressed={panel === "computer"} onClick={() => toggle("computer")}>
              <Monitor size={15} aria-hidden />
              Computer
            </button>
          )}
          <button type="button" className="tool-button" onClick={openApps}>
            <Puzzle size={15} aria-hidden />
            Apps
          </button>
          <button type="button" className="tool-button" aria-pressed={panel === "routines"} onClick={() => toggle("routines")}>
            <CalendarClock size={15} aria-hidden />
            Routines
          </button>
        </div>
      </header>
      <div className="chat-main">
      {panel === "routines" && <RoutinesPanel list={routines} botName={bot.name} onClose={() => setPanel(undefined)} />}
      {panel === "computer" && <ScreenView screen={screen} botName={bot.name} onClose={() => setPanel(undefined)} />}
      <div className="chat-scroll" ref={scroller} onScroll={onScroll}>
        {view.banner && <p className="notice">{view.banner}</p>}
        {view.phase.kind === "loading" && (
          <p className="empty" role="status">
            Opening the chat…
          </p>
        )}
        {view.phase.kind === "failed" && (
          <p className="problem chat-problem" role="alert">
            {view.phase.message}
          </p>
        )}
        {view.phase.kind === "ready" && view.items.length === 0 && !view.isRunning && (
          <p className="empty">No messages yet. Say hello to {bot.name}.</p>
        )}
        <TranscriptView items={view.items} draft={view.draft} isRunning={view.isRunning} />
        <RequestCards thread={thread} requests={view.requests} />
        {view.connection && (
          <div className="requests">
            <ConnectionCard thread={thread} card={view.connection} botName={bot.name} online={view.canSend} openApps={openApps} />
          </div>
        )}
      </div>
      </div>
      {dragging && <div className="drop-hint">Drop files to send them to {bot.name}</div>}
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
