import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ModalDialog } from "./modal-dialog";

/** As long a name as the gateway takes. */
const LONGEST_NAME = 200;

export function RenameRoomDialog({ name, rename, onClose }: { name: string; rename: (name: string) => Promise<void>; onClose: () => void }) {
  const [draft, setDraft] = useState(name);
  const trimmed = draft.trim();
  return (
    <ModalDialog
      title="Rename room"
      action={{ label: "Rename", busyLabel: "Renaming…", enabled: trimmed.length > 0 && trimmed.length <= LONGEST_NAME && trimmed !== name }}
      perform={() => rename(trimmed)}
      failure={`“${name}” wasn't renamed.`}
      onClose={onClose}
    >
      <div className="grid gap-2">
        <Label htmlFor="room-name">Name</Label>
        <Input id="room-name" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={LONGEST_NAME} autoFocus />
      </div>
      <p className="text-xs text-muted-foreground">The new name shows for everyone, in every app.</p>
    </ModalDialog>
  );
}

export function DeleteRoomDialog({ name, remove, onClose }: { name: string; remove: () => Promise<void>; onClose: () => void }) {
  return (
    <ModalDialog
      title={`Delete “${name}”?`}
      action={{ label: "Delete room", busyLabel: "Deleting…", enabled: true, danger: true }}
      perform={remove}
      failure={`“${name}” wasn't deleted.`}
      onClose={onClose}
    >
      <p className="text-sm text-muted-foreground">
        The room and its messages will be gone for good, and any Bot still answering stops. The Bots themselves aren't affected.
      </p>
    </ModalDialog>
  );
}
