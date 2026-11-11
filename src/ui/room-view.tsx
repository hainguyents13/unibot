import { useEffect, useState, useSyncExternalStore } from "react";
import { Pencil, Trash2 } from "lucide-react";
import LoadingState from "@/components/primitives/LoadingState";
import PromptBar from "@/components/primitives/PromptBar";
import { Button } from "@/components/ui/button";
import { ChatContainerContent, ChatContainerRoot } from "@/components/ui/chat-container";
import { ScrollButton } from "@/components/ui/scroll-button";
import type { RoomThread } from "../hermes/room";
import type { Bot } from "../hermes/types";
import { ChatHeader, HeaderTool } from "./chat-header";
import { ComposerColumn } from "./composer";
import { CommandText, RequestCard } from "./request-cards";
import { DeleteRoomDialog, RenameRoomDialog } from "./room-edit-dialogs";
import { Note, Problem } from "./settings-parts";
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

  // A message that didn't send comes back to the box so its text isn't lost.
  useEffect(() => {
    if (view.unsent === undefined) return;
    const unsent = room.takeUnsent();
    if (unsent !== undefined) setText(unsent);
  }, [view.unsent, room]);

  function send() {
    if (!view.canSend || !text.trim()) return;
    void room.send(text);
    setText("");
  }

  const handles = view.members.map((m) => `@${m.handle}`).join(", ");
  const working = view.working.map(memberName);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <ChatHeader title={view.name} subtitle={view.members.map((m) => memberName(m.id)).join(", ")}>
        <HeaderTool icon={<Pencil />} label="Rename" onClick={() => setEditing("rename")} />
        <HeaderTool icon={<Trash2 />} label="Delete" onClick={() => setEditing("delete")} />
      </ChatHeader>
      {editing === "rename" && <RenameRoomDialog name={view.name} rename={rename} onClose={() => setEditing(undefined)} />}
      {editing === "delete" && <DeleteRoomDialog name={view.name} remove={remove} onClose={() => setEditing(undefined)} />}
      <ChatContainerRoot className="relative min-h-0 flex-1">
        <ChatContainerContent className="gap-4 px-5 py-5">
          {view.phase.kind === "loading" && (
            <div className="m-auto">
              <LoadingState label="Opening the room" />
            </div>
          )}
          {view.phase.kind === "failed" && <Problem className="mx-auto max-w-3xl">{view.phase.message}</Problem>}
          {!view.driverRunning && view.phase.kind === "ready" && (
            <Note className="mx-auto w-full max-w-3xl rounded-control bg-inset px-3 py-2 shadow-hairline">The gateway's room service isn't running, so this room can't take messages now.</Note>
          )}
          {view.phase.kind === "ready" && view.items.length === 0 && view.pending.length === 0 && (
            <Note className="m-auto text-ink-3" style={{ animation: "fade-up 400ms cubic-bezier(0.23,1,0.32,1) both" }}>No messages yet. A message goes to every Bot here; {handles} asks one.</Note>
          )}
          <TranscriptView
            items={view.items}
            draft=""
            isRunning={false}
            memberName={memberName}
            memberProfile={(id) => view.members.find((m) => m.id === id)?.profile}
          />
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
            {view.pending.length > 0 && (
              <ol className="flex flex-col items-end gap-2" aria-label="Sending">
                {view.pending.map((message, i) => (
                  <li
                    key={i}
                    className="max-w-[80%] rounded-xl bg-field px-3 py-1.5 text-(length:--chat-text) leading-[1.45] whitespace-pre-wrap text-ink opacity-60"
                    style={{ animation: "fade-up 400ms cubic-bezier(0.23,1,0.32,1) both" }}
                  >
                    {message}
                  </li>
                ))}
              </ol>
            )}
            {view.isBusy && (
              <LoadingState label={working.length ? `${working.join(", ")} ${working.length === 1 ? "is" : "are"} replying` : "Replying"} />
            )}
            {view.approvals.map((approval) => (
              <RequestCard
                key={approval.prompt.id}
                title={`${memberName(approval.memberId)} wants to run a command`}
                aria-label="Approval"
                actions={
                  <>
                    <Button type="button" size="sm" variant="ghost" onClick={() => void room.answer(approval, "deny")}>
                      Deny
                    </Button>
                    {approval.prompt.choices.includes("once") && (
                      <Button type="button" size="sm" variant="accent" onClick={() => void room.answer(approval, "once")}>
                        Allow once
                      </Button>
                    )}
                  </>
                }
              >
                <CommandText>{approval.prompt.command}</CommandText>
                {approval.prompt.description && <Note>{approval.prompt.description}</Note>}
              </RequestCard>
            ))}
            {view.retries.map((taskId) => (
              <RequestCard
                key={taskId}
                title="A reply stopped partway"
                aria-label="Reply stopped"
                actions={
                  <>
                    <Button type="button" size="sm" variant="ghost" onClick={() => void room.dismiss(taskId)}>
                      Dismiss
                    </Button>
                    <Button type="button" size="sm" variant="accent" onClick={() => void room.retry(taskId)}>
                      Try again
                    </Button>
                  </>
                }
              >
                <Note>Try it again, or dismiss it. Dismissing also stops any other reply running in this room.</Note>
              </RequestCard>
            ))}
          </div>
        </ChatContainerContent>
        <div className="absolute right-5 bottom-3">
          <ScrollButton />
        </div>
      </ChatContainerRoot>
      <ComposerColumn>
        <PromptBar
          value={text}
          onValueChange={setText}
          onSubmit={send}
          placeholder={view.canSend ? `Message everyone, or ${handles} to ask one` : "Connecting to the room…"}
          ariaLabel={`Message ${view.name}`}
          disabled={!view.canSend}
          stop={view.isBusy ? { label: "Stop every reply", text: "Stop all", onClick: () => void room.stop() } : undefined}
          canSend={view.canSend && text.trim() !== ""}
        />
      </ComposerColumn>
    </div>
  );
}
