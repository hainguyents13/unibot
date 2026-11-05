import { useEffect, useState, useSyncExternalStore } from "react";
import { ArrowUp, Pencil, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChatContainerContent, ChatContainerRoot } from "@/components/ui/chat-container";
import { DotsLoader } from "@/components/ui/loader";
import { PromptInput, PromptInputAction, PromptInputActions, PromptInputTextarea } from "@/components/ui/prompt-input";
import { ScrollButton } from "@/components/ui/scroll-button";
import type { RoomThread } from "../hermes/room";
import type { Bot } from "../hermes/types";
import { ChatHeader, HeaderTool } from "./chat-header";
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
            <Note className="m-auto" role="status">
              Opening the room…
            </Note>
          )}
          {view.phase.kind === "failed" && <Problem className="mx-auto max-w-3xl">{view.phase.message}</Problem>}
          {!view.driverRunning && view.phase.kind === "ready" && (
            <Note className="mx-auto max-w-3xl rounded-md bg-muted px-3 py-2">The gateway's room service isn't running, so this room can't take messages now.</Note>
          )}
          {view.phase.kind === "ready" && view.items.length === 0 && view.pending.length === 0 && (
            <Note className="m-auto">No messages yet. A message goes to every Bot here; {handles} asks one.</Note>
          )}
          <TranscriptView items={view.items} draft="" isRunning={false} memberName={memberName} />
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
            {view.pending.length > 0 && (
              <ol className="flex flex-col items-end gap-2" aria-label="Sending">
                {view.pending.map((message, i) => (
                  <li key={i} className="max-w-[80%] rounded-2xl rounded-br-md bg-secondary px-3.5 py-2 text-sm whitespace-pre-wrap opacity-60">
                    {message}
                  </li>
                ))}
              </ol>
            )}
            {view.isBusy && (
              <p className="flex items-center gap-2.5 text-[13px] text-muted-foreground" role="status">
                <DotsLoader size="sm" />
                {working.length ? `${working.join(", ")} ${working.length === 1 ? "is" : "are"} replying…` : "Replying…"}
              </p>
            )}
            {view.approvals.map((approval) => (
              <RequestCard key={approval.prompt.id} title={`${memberName(approval.memberId)} wants to run a command`} aria-label="Approval">
                <CommandText>{approval.prompt.command}</CommandText>
                {approval.prompt.description && <Note>{approval.prompt.description}</Note>}
                <div className="flex gap-2">
                  {approval.prompt.choices.includes("once") && (
                    <Button type="button" size="sm" onClick={() => void room.answer(approval, "once")}>
                      Allow once
                    </Button>
                  )}
                  <Button type="button" size="sm" variant="ghost" onClick={() => void room.answer(approval, "deny")}>
                    Deny
                  </Button>
                </div>
              </RequestCard>
            ))}
            {view.retries.map((taskId) => (
              <RequestCard key={taskId} title="A reply stopped partway" aria-label="Reply stopped">
                <Note>Try it again, or dismiss it. Dismissing also stops any other reply running in this room.</Note>
                <div className="flex gap-2">
                  <Button type="button" size="sm" onClick={() => void room.retry(taskId)}>
                    Try again
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => void room.dismiss(taskId)}>
                    Dismiss
                  </Button>
                </div>
              </RequestCard>
            ))}
          </div>
        </ChatContainerContent>
        <div className="absolute right-5 bottom-3">
          <ScrollButton className="shadow-sm" />
        </div>
      </ChatContainerRoot>
      <div className="mx-auto w-full max-w-3xl px-4 pb-4">
        <PromptInput value={text} onValueChange={setText} onSubmit={send} maxHeight={200} disabled={!view.canSend} className="rounded-2xl bg-card shadow-sm">
          <PromptInputTextarea
            className="min-h-10 px-2 text-sm"
            placeholder={view.canSend ? `Message everyone, or ${handles} to ask one` : "Connecting to the room…"}
            aria-label={`Message ${view.name}`}
          />
          <PromptInputActions className="justify-end gap-1.5 px-1 pt-1">
            {view.isBusy && (
              <PromptInputAction tooltip="Stop every reply">
                <Button type="button" variant="outline" size="sm" className="h-8 rounded-full" onClick={() => void room.stop()}>
                  <Square className="size-3 fill-current" aria-hidden />
                  Stop all
                </Button>
              </PromptInputAction>
            )}
            <PromptInputAction tooltip="Send">
              <Button type="button" size="icon" className="size-8 rounded-full" aria-label="Send" disabled={!view.canSend || !text.trim()} onClick={send}>
                <ArrowUp aria-hidden />
              </Button>
            </PromptInputAction>
          </PromptInputActions>
        </PromptInput>
      </div>
    </div>
  );
}
