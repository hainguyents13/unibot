import { useState } from "react";
import { ROOM_SEATS, seatsNote, suggestedRoomName } from "../hermes/room";
import type { Bot } from "../hermes/types";
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
}

/** Starts a room: the Bots in it and a name, which defaults to theirs. */
export function NewRoomDialog({ bots, create, onCreated, onClose }: NewRoomDialogProps) {
  const [name, setName] = useState("");
  /** Picked Bots, in the order you picked them; the room lists them that way. */
  const [picked, setPicked] = useState<string[]>([]);

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
      <div className="grid gap-2">
        <Label htmlFor="new-room-name">Name</Label>
        <Input id="new-room-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={suggestion || "Room name"} />
      </div>
      <Label id="pick-bots-label">Bots</Label>
      {/* Not a fieldset: a fieldset won't shrink and scroll inside the dialog. */}
      <div className="min-h-18 shrink overflow-y-auto rounded-md border" role="group" aria-labelledby="pick-bots-label">
        {bots.map((bot) => {
          const isPicked = picked.includes(bot.id);
          return (
            <label key={bot.id} className="flex cursor-pointer items-center gap-3 border-b px-3 py-2 last:border-b-0 hover:bg-accent has-disabled:cursor-default has-disabled:opacity-50">
              <Avatar name={bot.name} />
              <span className="flex-1 font-medium">{bot.name}</span>
              <Checkbox checked={isPicked} disabled={!isPicked && picked.length >= ROOM_SEATS.max} onCheckedChange={() => toggle(bot.id)} />
            </label>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        {note && (
          <>
            <strong className="text-foreground">{note}</strong>{" "}
          </>
        )}
        A message without an @mention goes to all of them.
      </p>
    </ModalDialog>
  );
}
