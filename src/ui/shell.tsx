import { useEffect, useRef, useState } from "react";
import { Plus, Settings } from "lucide-react";
import { notify, onOpenTarget, setAttention } from "../platform/desktop";
import type { ChatThread } from "../hermes/chat-thread";
import type { Link, Session, SessionState } from "../hermes/session";
import { ContactList } from "./bot-list";
import { NewRoomDialog } from "./new-room-dialog";
import { ChatView } from "./chat-view";
import { RoomView } from "./room-view";
import { SettingsDialog, type SettingsPage } from "./settings-dialog";

interface ShellProps {
  session: Session;
  state: Extract<SessionState, { kind: "signedIn" }>;
}

type Selection = { kind: "bot" | "room"; id: string };

export function Shell({ session, state }: ShellProps) {
  const [selection, setSelection] = useState<Selection>();
  const [thread, setThread] = useState<ChatThread>();
  const [makingRoom, setMakingRoom] = useState(false);
  const [settings, setSettings] = useState<SettingsPage>();
  const bot = selection?.kind === "bot" ? state.bots.find((b) => b.id === selection.id) : undefined;
  const room = selection?.kind === "room" ? session.room(selection.id) : undefined;
  const now = Date.now();

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

  return (
    <div className="shell">
      <aside className="sidebar">
        <header className="sidebar-header">
          <h1>Bots</h1>
          <span className="gateway">{state.gateway.displayName}</span>
        </header>
        <LinkNotice link={state.link} />
        <ContactList
          label="Bots"
          rows={state.bots}
          selectedId={selection?.kind === "bot" ? selection.id : undefined}
          now={now}
          onSelect={(id) => setSelection({ kind: "bot", id })}
        />
        {state.link.kind === "online" && state.bots.length === 0 && (
          <p className="sidebar-note">No Bots on this gateway yet. Make one in the Hermes app.</p>
        )}
        <div className="sidebar-section-row">
          <h2 className="sidebar-section">Rooms</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="New room"
            title="New room"
            onClick={() => setMakingRoom(true)}
          >
            <Plus size={16} aria-hidden />
          </button>
        </div>
        <ContactList
          label="Rooms"
          rows={state.rooms}
          selectedId={selection?.kind === "room" ? selection.id : undefined}
          now={now}
          avatar={() => "#"}
          onSelect={(id) => setSelection({ kind: "room", id })}
        />
        {makingRoom && (
          <NewRoomDialog
            bots={state.bots}
            create={(name, botIds) => session.createRoom(name, botIds)}
            onCreated={(id) => setSelection({ kind: "room", id })}
            onClose={() => setMakingRoom(false)}
          />
        )}
        <footer className="sidebar-footer">
          <button type="button" className="tool-button" onClick={() => setSettings({ kind: "gateway" })}>
            <Settings size={16} aria-hidden />
            Settings
          </button>
        </footer>
        {settings && <SettingsDialog session={session} state={state} page={settings} onPage={setSettings} onClose={() => setSettings(undefined)} />}
      </aside>
      <main className="chat">
        {bot && thread?.botId === bot.id ? (
          <ChatView
            key={bot.id}
            bot={bot}
            thread={thread}
            routines={session.routines(bot.id)}
            screen={session.screen(bot.id)}
            openApps={() => setSettings({ kind: "apps", botId: bot.id })}
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
          <p className="empty">Pick a Bot or a room to chat with.</p>
        )}
      </main>
    </div>
  );
}

function LinkNotice({ link }: { link: Link }) {
  switch (link.kind) {
    case "connecting":
      return (
        <p className="link-notice" role="status">
          Connecting…
        </p>
      );
    case "offline":
      return (
        <p className="link-notice link-offline" role="status">
          {link.message} Trying again…
        </p>
      );
    case "online":
      return link.dialect === "canonical" ? (
        <p className="link-notice" role="status">
          This gateway runs <code>hermes gateway</code>. Chats there aren't supported yet; use{" "}
          <code>hermes dashboard</code>.
        </p>
      ) : null;
  }
}
