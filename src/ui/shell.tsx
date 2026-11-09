import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, MessagesSquare, Plus, Settings, SlidersHorizontal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { notify, onOpenTarget, setAttention } from "../platform/desktop";
import type { MadeBot } from "../hermes/bot-profiles";
import type { ChatThread } from "../hermes/chat-thread";
import type { Link, Session, SessionState } from "../hermes/session";
import type { Bot } from "../hermes/types";
import { DeleteBotDialog, DuplicateBotDialog, NewBotDialog } from "./bot-dialogs";
import { ContactList } from "./bot-list";
import { BotPanel, type BotPanelTab } from "./bot-panel";
import { NewRoomDialog } from "./new-room-dialog";
import { GatewayFilesContext, type GatewayFiles } from "./reply-file-cards";
import { ChatView } from "./chat-view";
import { RoomView } from "./room-view";
import { SettingsDialog, type SettingsPage } from "./settings-dialog";

interface ShellProps {
  session: Session;
  state: Extract<SessionState, { kind: "signedIn" }>;
}

type Selection = { kind: "bot" | "room"; id: string };

type Dialog =
  | { kind: "newBot" }
  | { kind: "newRoom"; picked?: string[] }
  | { kind: "duplicate"; bot: Bot }
  | { kind: "delete"; bot: Bot };

export function Shell({ session, state }: ShellProps) {
  const [selection, setSelection] = useState<Selection>();
  const [thread, setThread] = useState<ChatThread>();
  const [dialog, setDialog] = useState<Dialog>();
  const [settings, setSettings] = useState<SettingsPage>();
  /** The right panel's tab while it's open. It stays open as you move between Bots. */
  const [panel, setPanel] = useState<BotPanelTab>();
  /** A Bot just made that has no model it can reply with, so its panel says so. */
  const [cantReply, setCantReply] = useState<string>();
  const bot = selection?.kind === "bot" ? state.bots.find((b) => b.id === selection.id) : undefined;
  const room = selection?.kind === "room" ? session.room(selection.id) : undefined;
  const botIds = state.bots.map((b) => b.id);
  const now = Date.now();
  const gatewayFiles = useMemo<GatewayFiles>(
    () => ({ download: (profile, path) => session.downloadFile(profile, path), reveal: (local) => session.revealFile(local) }),
    [session],
  );

  // Opening a chat talks to the gateway, so it happens after render, not during it.
  useEffect(() => {
    setThread(selection?.kind === "bot" ? session.chat(selection.id) : undefined);
  }, [session, selection]);

  // Notifications, except for the chat you're looking at; clicking one opens its chat.
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  useEffect(() => {
    const stopAlerts = session.onAlert((alert) => {
      const open = selectionRef.current;
      const looking = document.hasFocus() && open !== undefined && `${open.kind}:${open.id}` === alert.target;
      if (!looking) notify(alert.title, alert.text, alert.target);
    });
    const stopOpening = onOpenTarget((target) => {
      const [kind, ...rest] = target.split(":");
      if (kind === "bot" || kind === "room") setSelection({ kind, id: rest.join(":") });
    });
    return () => {
      stopAlerts();
      stopOpening();
    };
  }, [session]);

  // The tray icon shows a dot while anything waits on you.
  const needsYou = [...state.bots, ...state.rooms].some((row) => row.status === "needsYou");
  useEffect(() => setAttention(needsYou), [needsYou]);

  /** A Bot just made or copied opens with its settings beside it. */
  function openMade(made: MadeBot) {
    setSelection({ kind: "bot", id: made.id });
    setPanel("settings");
    setCantReply(made.canReply === false ? made.id : undefined);
  }

  function botMenu(row: { id: string }) {
    const target = state.bots.find((b) => b.id === row.id);
    if (!target) return null;
    return (
      <>
        <DropdownMenuItem
          onSelect={() => {
            setSelection({ kind: "bot", id: target.id });
            setPanel("settings");
          }}
        >
          <SlidersHorizontal />
          Settings
        </DropdownMenuItem>
        <DropdownMenuItem disabled={state.bots.length < 2} onSelect={() => setDialog({ kind: "newRoom", picked: [target.id] })}>
          <MessagesSquare />
          New room with {target.name}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setDialog({ kind: "duplicate", bot: target })}>
          <Copy />
          Duplicate…
        </DropdownMenuItem>
        {/* The gateway's main profile can't be deleted. */}
        {target.id !== "default" && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => setDialog({ kind: "delete", bot: target })}>
              <Trash2 />
              Delete…
            </DropdownMenuItem>
          </>
        )}
      </>
    );
  }

  return (
    <GatewayFilesContext.Provider value={gatewayFiles}>
      <div className="relative grid h-screen grid-cols-[minmax(240px,300px)_minmax(0,1fr)_auto]">
        <aside className="flex min-h-0 flex-col border-r bg-sidebar text-sidebar-foreground">
          <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pt-2 pb-2">
            <LinkNotice link={state.link} />
            <SectionHeader title="Bots" add="New Bot" onAdd={() => setDialog({ kind: "newBot" })} />
            <ContactList
              label="Bots"
              rows={state.bots}
              selectedId={selection?.kind === "bot" ? selection.id : undefined}
              now={now}
              onSelect={(id) => setSelection({ kind: "bot", id })}
              menu={botMenu}
            />
            {state.link.kind === "online" && state.bots.length === 0 && (
              <p className="px-4 text-[13px] text-muted-foreground">No Bots on this gateway yet. Make one with +.</p>
            )}
            <SectionHeader title="Rooms" add="New room" onAdd={() => setDialog({ kind: "newRoom" })} className="mt-3" />
            <ContactList
              label="Rooms"
              rows={state.rooms}
              selectedId={selection?.kind === "room" ? selection.id : undefined}
              now={now}
              avatar={() => "#"}
              onSelect={(id) => setSelection({ kind: "room", id })}
            />
          </div>
          <footer className="border-t p-2">
            <Button type="button" variant="ghost" className="w-full justify-start text-muted-foreground" onClick={() => setSettings({ kind: "gateway" })}>
              <Settings aria-hidden />
              Settings
            </Button>
          </footer>
          {settings && <SettingsDialog session={session} state={state} page={settings} onPage={setSettings} onClose={() => setSettings(undefined)} />}
        </aside>
        <main className="relative flex min-h-0 min-w-0 flex-col">
          {bot && thread?.botId === bot.id ? (
            <ChatView
              key={bot.id}
              bot={bot}
              thread={thread}
              openApps={() => setSettings({ kind: "apps", botId: bot.id })}
              panelOpen={panel !== undefined}
              onTogglePanel={() => setPanel(panel ? undefined : "settings")}
            />
          ) : room ? (
            <RoomView
              key={room.id}
              room={room}
              bots={state.bots}
              rename={(name) => session.renameRoom(room.id, name)}
              remove={() => session.deleteRoom(room.id)}
            />
          ) : (
            <p className="m-auto text-muted-foreground">Pick a Bot or a room to chat with.</p>
          )}
        </main>
        {bot && panel && (
          <BotPanel
            session={session}
            bot={bot}
            tab={panel}
            onTab={setPanel}
            onClose={() => setPanel(undefined)}
            isUnencrypted={state.gateway.isUnencrypted}
            notice={cantReply === bot.id ? `${bot.name} can't reply yet: it has no model it can use. Pick a provider and model below.` : undefined}
          />
        )}

        {dialog?.kind === "newBot" && (
          <NewBotDialog taken={botIds} create={(title, about) => session.createBot(title, about)} onCreated={openMade} onClose={() => setDialog(undefined)} />
        )}
        {dialog?.kind === "newRoom" && (
          <NewRoomDialog
            bots={state.bots}
            picked={dialog.picked}
            create={(name, ids) => session.createRoom(name, ids)}
            onCreated={(id) => setSelection({ kind: "room", id })}
            onClose={() => setDialog(undefined)}
          />
        )}
        {dialog?.kind === "duplicate" && (
          <DuplicateBotDialog
            bot={dialog.bot}
            taken={botIds}
            duplicate={(title) => session.duplicateBot(dialog.bot.id, title)}
            onCreated={openMade}
            onClose={() => setDialog(undefined)}
          />
        )}
        {dialog?.kind === "delete" && (
          <DeleteBotDialog
            bot={dialog.bot}
            remove={async () => {
              await session.deleteBot(dialog.bot.id);
              if (selection?.kind === "bot" && selection.id === dialog.bot.id) setSelection(undefined);
            }}
            onClose={() => setDialog(undefined)}
          />
        )}
      </div>
    </GatewayFilesContext.Provider>
  );
}

/** "BOTS" or "ROOMS" over its list, with + to make one. */
function SectionHeader({ title, add, onAdd, className }: { title: string; add: string; onAdd: () => void; className?: string }) {
  return (
    <div className={`flex items-center justify-between pr-2 pl-4 ${className ?? ""}`}>
      <h2 className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{title}</h2>
      <Button type="button" variant="ghost" size="icon" className="size-7 text-muted-foreground" aria-label={add} title={add} onClick={onAdd}>
        <Plus aria-hidden />
      </Button>
    </div>
  );
}

function LinkNotice({ link }: { link: Link }) {
  const box = "mx-3 mb-1 rounded-md px-3 py-2 text-[13px]";
  switch (link.kind) {
    case "connecting":
      return (
        <p className={`${box} bg-muted text-muted-foreground`} role="status">
          Connecting…
        </p>
      );
    case "offline":
      return (
        <p className={`${box} bg-attention-soft text-attention`} role="status">
          {link.message} Trying again…
        </p>
      );
    case "online":
      return link.dialect === "canonical" ? (
        <p className={`${box} bg-muted text-muted-foreground`} role="status">
          This gateway runs <code>hermes gateway</code>. Chats there aren't supported yet; use <code>hermes dashboard</code>.
        </p>
      ) : null;
  }
}
