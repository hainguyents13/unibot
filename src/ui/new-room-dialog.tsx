import { useState } from "react";
import { ROOM_SEATS, seatsNote, suggestedRoomName } from "../hermes/room";
import type { Bot } from "../hermes/types";
import GlideMenu from "@/components/primitives/GlideMenu";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar } from "./avatar";
import { ModalDialog } from "./modal-dialog";

interface NewRoomDialogProps {
  /** The gateway's Bots, in sidebar order. */
  bots: Bot[];
  /** Makes the room and returns its ID. */
  create: (name: string, botIds: string[]) => Promise<string>;
  /** Told the new room's ID, to open it. */
  onCreated: (roomId: string) => void;
  onClose: () => void;
  /** Bots already ticked, such as the one whose menu started the room. */
  picked?: string[];
}

/** Starts a room: the Bots in it and a name, which defaults to theirs. */
export function NewRoomDialog({ bots, create, onCreated, onClose, picked: initiallyPicked = [] }: NewRoomDialogProps) {
  const [name, setName] = useState("");
  /** Picked Bots, in the order you picked them; the room lists them that way. */
  const [picked, setPicked] = useState<string[]>(initiallyPicked);

  const pickedBots = picked.flatMap((id) => bots.find((b) => b.id === id) ?? []);
  const suggestion = suggestedRoomName(pickedBots.map((b) => b.name));
  const note = seatsNote(picked.length, bots.length);

  function toggle(id: string) {
    setPicked((now) => (now.includes(id) ? now.filter((p) => p !== id) : [...now, id]));
  }

  return (
    <ModalDialog
      title="New room"
      action={{ label: "Create", busyLabel: "Creating…", enabled: picked.length >= ROOM_SEATS.min && picked.length <= ROOM_SEATS.max }}
      perform={async () => onCreated(await create(name.trim() || suggestion, picked))}
      failure="The room wasn't made."
      onClose={onClose}
    >
      <div className="grid gap-1.5">
        <Label htmlFor="new-room-name">Name</Label>
        <Input id="new-room-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={suggestion || "Room name"} />
      </div>
      <Label id="pick-bots-label">Bots</Label>
      {/* Not a fieldset: a fieldset won't shrink and scroll inside the dialog. */}
      <div className="min-h-18 shrink overflow-y-auto rounded-card bg-surface p-1 shadow-hairline" role="group" aria-labelledby="pick-bots-label">
        <GlideMenu rowSelector="[data-menu-row]:not(:has(:disabled))" highlightClassName="inset-x-0 rounded-control bg-hover" className="flex flex-col gap-px">
          {bots.map((bot) => {
            const isPicked = picked.includes(bot.id);
            return (
              <label
                key={bot.id}
                data-menu-row
                className="relative z-10 flex cursor-pointer items-center gap-3 rounded-control px-2 py-1.5 has-disabled:cursor-default has-disabled:opacity-50"
              >
                <Avatar name={bot.name} className="size-7 text-[12px]" />
                <span className="flex-1 text-[13.5px] font-medium text-ink">{bot.name}</span>
                <Checkbox checked={isPicked} disabled={!isPicked && picked.length >= ROOM_SEATS.max} onCheckedChange={() => toggle(bot.id)} />
              </label>
            );
          })}
        </GlideMenu>
      </div>
      <p className="text-[12px] text-ink-3">
        {note && (
          <>
            <strong className="text-ink">{note}</strong>{" "}
          </>
        )}
        A message without an @mention goes to all of them.
      </p>
    </ModalDialog>
  );
}
