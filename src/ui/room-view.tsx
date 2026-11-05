import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent } from "react";
import type { RoomThread } from "../hermes/room";
import type { Bot } from "../hermes/types";
import { Pencil, Trash2 } from "lucide-react";
import { DeleteRoomDialog, RenameRoomDialog } from "./room-edit-dialogs";
import { TranscriptView } from "./transcript-view";

/** How often a room on screen is read: rooms push nothing. */
const POLL_MS = 2_000;

interface RoomViewProps {
  room: RoomThread;
  bots: Bot[];
  rename: (name: string) => Promise<void>;
  /** Deletes the room for good. */
  remove: () => Promise<void>;
}

export function RoomView({ room, bots, rename, remove }: RoomViewProps) {
  const view = useSyncExternalStore(room.subscribe, room.getView);
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<"rename" | "delete">();
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  // Members show by their sidebar name when they're this gateway's Bots.
  const memberName = (id: string) => {
    const member = view.members.find((m) => m.id === id);
    return bots.find((b) => b.id === member?.profile)?.name ?? room.memberName(id);
  };

  useEffect(() => {
    void room.sync();
    const timer = setInterval(() => void room.sync(), POLL_MS);
    return () => clearInterval(timer);
  }, [room]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [view]);

  // A message that didn't send comes back to the box so its text isn't lost.
  useEffect(() => {
    if (view.unsent === undefined) return;
    const unsent = room.takeUnsent();
    if (unsent !== undefined) setText(unsent);
  }, [view.unsent, room]);

  function send(event?: FormEvent) {
    event?.preventDefault();
    if (!view.canSend || !text.trim()) return;
    void room.send(text);
    setText("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) send(event);
  }

  const handles = view.members.map((m) => `@${m.handle}`).join(", ");
  const working = view.working.map(memberName);

  return (
    <div className="chat-body">
      <header className="chat-header chat-header-row">
        <div>
          <h2>{view.name}</h2>
          <p>{view.members.map((m) => memberName(m.id)).join(", ")}</p>
        </div>
        <div className="header-tools">
          <button type="button" className="tool-button" onClick={() => setEditing("rename")}>
            <Pencil size={15} aria-hidden />
            Rename
          </button>
          <button type="button" className="tool-button" onClick={() => setEditing("delete")}>
            <Trash2 size={15} aria-hidden />
            Delete
          </button>
        </div>
      </header>
      {editing === "rename" && <RenameRoomDialog name={view.name} rename={rename} onClose={() => setEditing(undefined)} />}
      {editing === "delete" && <DeleteRoomDialog name={view.name} remove={remove} onClose={() => setEditing(undefined)} />}
      <div
        className="chat-scroll"
        ref={scroller}
        onScroll={() => {
          const el = scroller.current;
          if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {view.phase.kind === "loading" && (
          <p className="empty" role="status">
            Opening the room…
          </p>
        )}
        {view.phase.kind === "failed" && (
          <p className="problem chat-problem" role="alert">
            {view.phase.message}
          </p>
        )}
        {!view.driverRunning && view.phase.kind === "ready" && (
          <p className="notice">The gateway's room service isn't running, so this room can't take messages now.</p>
        )}
        {view.phase.kind === "ready" && view.items.length === 0 && view.pending.length === 0 && (
          <p className="empty">No messages yet. A message goes to every Bot here; {handles} asks one.</p>
        )}
        <TranscriptView items={view.items} draft="" isRunning={false} memberName={memberName} />
        {view.pending.length > 0 && (
          <ol className="transcript pending-messages" aria-label="Sending">
            {view.pending.map((message, i) => (
              <li key={i} className="message user sending">
                {message}
              </li>
            ))}
          </ol>
        )}
        {view.isBusy && (
          <p className="working" role="status">
            {working.length ? `${working.join(", ")} ${working.length === 1 ? "is" : "are"} replying…` : "Replying…"}
          </p>
        )}
        <div className="requests">
          {view.approvals.map((approval) => (
            <section key={approval.prompt.id} className="card" aria-label="Approval">
              <h3>{memberName(approval.memberId)} wants to run a command</h3>
              <pre className="command">{approval.prompt.command}</pre>
              {approval.prompt.description && <p className="card-note">{approval.prompt.description}</p>}
              <div className="card-actions">
                {approval.prompt.choices.includes("once") && (
                  <button type="button" className="primary" onClick={() => void room.answer(approval, "once")}>
                    Allow once
                  </button>
                )}
                <button type="button" onClick={() => void room.answer(approval, "deny")}>
                  Deny
                </button>
              </div>
            </section>
          ))}
          {view.retries.map((taskId) => (
            <section key={taskId} className="card" aria-label="Reply stopped">
              <h3>A reply stopped partway</h3>
              <p className="card-note">Try it again, or dismiss it. Dismissing also stops any other reply running in this room.</p>
              <div className="card-actions">
                <button type="button" className="primary" onClick={() => void room.retry(taskId)}>
                  Try again
                </button>
                <button type="button" onClick={() => void room.dismiss(taskId)}>
                  Dismiss
                </button>
              </div>
            </section>
          ))}
        </div>
      </div>
      <form className="composer" onSubmit={send}>
        <div className="composer-row">
          <textarea
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={view.canSend ? `Message everyone, or ${handles} to ask one` : "Connecting to the room…"}
            aria-label={`Message ${view.name}`}
            disabled={!view.canSend}
          />
          {view.isBusy && (
            <button type="button" onClick={() => void room.stop()}>
              Stop all
            </button>
          )}
          <button type="submit" className="primary" disabled={!view.canSend || !text.trim()}>
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
