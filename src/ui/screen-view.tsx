import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { X } from "lucide-react";
import type { BotScreen } from "../hermes/screen";

/**
 * A Bot's computer over the chat: its screen live, Take over and Hand back. Closing the view closes
 * the picture cleanly, which hands control back to the Bot if you had it.
 */
export function ScreenView({ screen, botName, onClose }: { screen: BotScreen; botName: string; onClose(): void }) {
  const view = useSyncExternalStore(screen.subscribe, screen.getView);
  const canvas = useRef<HTMLDivElement>(null);
  const rfb = useRef<{ viewOnly: boolean; disconnect(): void; focus(): void } | null>(null);
  const [link, setLink] = useState<"connecting" | "live" | "lost">("connecting");
  const running = view.status?.running ?? false;

  // Asks for a ticket once the screen is on.
  useEffect(() => {
    if (running && !view.socketUrl) void screen.watch();
  }, [screen, running, view.socketUrl]);

  // Opens the picture; a new ticket means a new socket.
  useEffect(() => {
    const target = canvas.current;
    const url = view.socketUrl;
    if (!target || !url || view.demo) return;
    let cancelled = false;
    setLink("connecting");
    void import("@novnc/novnc").then(({ default: RFB }) => {
      if (cancelled) return;
      const client = new RFB(target, url, { shared: true });
      client.scaleViewport = true;
      client.viewOnly = screen.getView().control !== "you";
      client.addEventListener("connect", () => setLink("live"));
      client.addEventListener("disconnect", () => {
        if (rfb.current !== client) return;
        rfb.current = null;
        setLink("lost");
        screen.stopWatching();
      });
      rfb.current = client;
    });
    return () => {
      cancelled = true;
      const client = rfb.current;
      rfb.current = null;
      client?.disconnect();
    };
  }, [screen, view.socketUrl, view.demo]);

  // Only you, in control, send the mouse and keyboard.
  useEffect(() => {
    if (!rfb.current) return;
    rfb.current.viewOnly = view.control !== "you";
    if (view.control === "you") rfb.current.focus();
  }, [view.control]);

  const who =
    view.control === "you"
      ? "You're in control. Hand back when you're done."
      : view.control === "someoneElse"
        ? "Someone else is in control. You're watching."
        : `${botName} is in control. You're watching.`;

  return (
    <section className={`screen-view${view.control === "you" ? " in-control" : ""}`} aria-label={`${botName}'s computer`}>
      <header className="screen-bar">
        <span className="screen-status" role="status">
          {!running ? `${botName}'s computer is off.` : link === "lost" ? "Lost the connection to the computer." : who}
        </span>
        <div className="card-actions">
          {!running && (
            <button type="button" className="primary" disabled={view.isBusy || !!view.status?.blocker} onClick={() => void screen.start()}>
              {view.isBusy ? "Starting…" : "Start"}
            </button>
          )}
          {running && link === "lost" && (
            <button type="button" onClick={() => void screen.watch()}>
              Reconnect
            </button>
          )}
          {running && view.control !== "you" && (
            <button type="button" className="primary" disabled={view.isBusy} onClick={() => void screen.takeOver()}>
              Take over
            </button>
          )}
          {running && view.control === "you" && (
            <button type="button" className="primary" disabled={view.isBusy} onClick={() => void screen.handBack()}>
              Hand back
            </button>
          )}
          <button type="button" className="icon-button" aria-label="Close the computer" onClick={onClose}>
            <X size={18} aria-hidden />
          </button>
        </div>
      </header>
      {view.lease?.reason && view.control === "agent" && <p className="screen-ask">{botName} asks you to take over: {view.lease.reason}</p>}
      {view.status?.blocker && !running && <p className="problem">{view.status.blocker}</p>}
      {view.problem && (
        <p className="problem" role="alert">
          {view.problem}
        </p>
      )}
      <div className="screen-canvas" ref={canvas}>
        {view.demo && <DemoDesktop botName={botName} />}
      </div>
    </section>
  );
}

/** The demo's made-up desktop: a browser with a page the Bot is filling in. */
function DemoDesktop({ botName }: { botName: string }) {
  return (
    <svg className="demo-desktop" viewBox="0 0 1440 900" role="img" aria-label={`${botName}'s demo desktop`}>
      <rect width="1440" height="900" fill="#2f3b52" />
      <rect x="0" y="864" width="1440" height="36" fill="#1f2738" />
      <rect x="120" y="80" width="1200" height="740" rx="10" fill="#f8fafc" />
      <rect x="120" y="80" width="1200" height="48" rx="10" fill="#e2e8f0" />
      <rect x="260" y="92" width="760" height="24" rx="12" fill="#ffffff" />
      <text x="280" y="109" fontSize="14" fill="#475569" fontFamily="Segoe UI">dashboard.example.com/releases/new</text>
      <text x="200" y="200" fontSize="30" fontWeight="600" fill="#0f172a" fontFamily="Segoe UI">New release</text>
      <text x="200" y="250" fontSize="16" fill="#475569" fontFamily="Segoe UI">Tag</text>
      <rect x="200" y="262" width="420" height="40" rx="6" fill="#fff" stroke="#cbd5e1" />
      <text x="214" y="288" fontSize="16" fill="#0f172a" fontFamily="Segoe UI">v0.1.0</text>
      <text x="200" y="340" fontSize="16" fill="#475569" fontFamily="Segoe UI">Notes</text>
      <rect x="200" y="352" width="1040" height="260" rx="6" fill="#fff" stroke="#cbd5e1" />
      <text x="214" y="384" fontSize="16" fill="#0f172a" fontFamily="Segoe UI">Your Bots, on Windows. Chat, rooms and routines in one small app.</text>
      <rect x="200" y="650" width="160" height="44" rx="8" fill="#1d4ed8" />
      <text x="240" y="678" fontSize="16" fill="#fff" fontFamily="Segoe UI">Publish</text>
      <path d="M 300 690 l 0 26 l 7 -7 l 6 13 l 5 -2 l -6 -13 l 10 0 z" fill="#111" stroke="#fff" strokeWidth="1.5" />
    </svg>
  );
}
