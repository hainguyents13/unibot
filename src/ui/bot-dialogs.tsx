import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { botNameProblem, botSlug, type MadeBot } from "../hermes/bot-profiles";
import type { Bot } from "../hermes/types";
import { ModalDialog } from "./modal-dialog";

/** Below the name: the ID it makes, or why Hermes would refuse it. Nothing until you type. */
function NameHelp({ name, taken }: { name: string; taken: string[] }) {
  if (!name.trim()) return null;
  const problem = botNameProblem(name, taken);
  return problem ? (
    <p className="text-xs text-destructive" role="alert">
      {problem}
    </p>
  ) : (
    <p className="text-xs text-muted-foreground">
      Its ID on the gateway will be <code>{botSlug(name)}</code>, which never changes.
    </p>
  );
}

interface NewBotDialogProps {
  /** The gateway's Bot IDs, which a new one can't take. */
  taken: string[];
  create: (title: string, description: string) => Promise<MadeBot>;
  onCreated: (made: MadeBot) => void;
  onClose: () => void;
}

/** Makes a Bot from a name and what it's for; the rest is set in its panel afterwards. */
export function NewBotDialog({ taken, create, onCreated, onClose }: NewBotDialogProps) {
  const [name, setName] = useState("");
  const [about, setAbout] = useState("");
  return (
    <ModalDialog
      title="New Bot"
      action={{ label: "Create", busyLabel: "Creating…", enabled: !botNameProblem(name, taken) }}
      perform={async () => onCreated(await create(name.trim(), about.trim()))}
      failure="The Bot wasn't made."
      onClose={onClose}
    >
      <div className="grid gap-2">
        <Label htmlFor="new-bot-name">Name</Label>
        <Input id="new-bot-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Job Scout" autoFocus autoComplete="off" />
        <NameHelp name={name} taken={taken} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="new-bot-about">What it's for</Label>
        <Input id="new-bot-about" value={about} onChange={(e) => setAbout(e.target.value)} placeholder="Finds and summarises job posts" autoComplete="off" />
      </div>
      <p className="text-xs text-muted-foreground">
        It starts with Hermes's skills and the gateway's model. Its rules, model and thinking are in its panel once it's made.
      </p>
    </ModalDialog>
  );
}

interface DuplicateBotDialogProps {
  bot: Bot;
  taken: string[];
  duplicate: (title: string) => Promise<MadeBot>;
  onCreated: (made: MadeBot) => void;
  onClose: () => void;
}

/** A copy of a Bot under a new name: its settings, keys, rules and skills, but none of its chats. */
export function DuplicateBotDialog({ bot, taken, duplicate, onCreated, onClose }: DuplicateBotDialogProps) {
  const [name, setName] = useState(`${bot.name} copy`);
  return (
    <ModalDialog
      title={`Duplicate ${bot.name}`}
      action={{ label: "Duplicate", busyLabel: "Duplicating…", enabled: !botNameProblem(name, taken) }}
      perform={async () => onCreated(await duplicate(name.trim()))}
      failure={`${bot.name} wasn't copied.`}
      onClose={onClose}
    >
      <div className="grid gap-2">
        <Label htmlFor="copy-bot-name">Name of the copy</Label>
        <Input id="copy-bot-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus autoComplete="off" />
        <NameHelp name={name} taken={taken} />
      </div>
      <p className="text-xs text-muted-foreground">
        The copy gets {bot.name}'s model, keys, rules and skills. Its chats, memory and routines stay with {bot.name}, and so do its
        Telegram, Discord and other channels.
      </p>
    </ModalDialog>
  );
}

/** Deleting a Bot can't be undone, so its ID has to be typed, as `hermes profile delete` asks. */
export function DeleteBotDialog({ bot, remove, onClose }: { bot: Bot; remove: () => Promise<void>; onClose: () => void }) {
  const [typed, setTyped] = useState("");
  return (
    <ModalDialog
      title={`Delete ${bot.name}?`}
      action={{ label: "Delete Bot", busyLabel: "Deleting…", enabled: typed.trim() === bot.id, danger: true }}
      perform={remove}
      failure={`${bot.name} wasn't deleted.`}
      onClose={onClose}
    >
      <p className="text-sm text-muted-foreground">
        This removes {bot.name} from the gateway for good: its chats, memory, skills, routines, apps and keys. Rooms it's in keep it listed,
        but it won't answer there.
      </p>
      <div className="grid gap-2">
        <Label htmlFor="delete-bot-id">
          Type <code className="rounded bg-muted px-1">{bot.id}</code> to delete it
        </Label>
        <Input id="delete-bot-id" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus autoComplete="off" spellCheck={false} />
      </div>
    </ModalDialog>
  );
}
