import { useState } from "react";
import { ROOM_SEATS, seatsNote, suggestedRoomName } from "../hermes/room";
import type { Bot } from "../hermes/types";
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
      <label className="dialog-field">
        <span>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={suggestion || "Room name"} />
      </label>
      <span id="pick-bots-label" className="pick-bots-label">
        Bots
      </span>
      {/* Not a fieldset: a fieldset won't shrink and scroll inside the dialog. */}
      <div className="pick-bots" role="group" aria-labelledby="pick-bots-label">
        {bots.map((bot) => {
          const isPicked = picked.includes(bot.id);
          return (
            <label key={bot.id} className="pick-bot">
              <span className="avatar" aria-hidden="true">
                {bot.name.slice(0, 1)}
              </span>
              <span className="pick-bot-name">{bot.name}</span>
              <input
                type="checkbox"
                checked={isPicked}
                disabled={!isPicked && picked.length >= ROOM_SEATS.max}
                onChange={() => toggle(bot.id)}
              />
            </label>
          );
        })}
      </div>
      <p className="hint">
        {note && (
          <>
            <strong>{note}</strong>{" "}
          </>
        )}
        A message without an @mention goes to all of them.
      </p>
    </ModalDialog>
  );
}
