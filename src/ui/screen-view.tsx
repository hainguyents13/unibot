import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { BotScreen } from "../hermes/screen";

/**
 * A Bot's computer: its screen live, Take over and Hand back. It fills the box it's put in. Leaving
 * the view closes the picture cleanly, which hands control back to the Bot if you had it.
 */
export function ScreenView({ screen, botName }: { screen: BotScreen; botName: string }) {
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

  // The computer always shows dark, whatever Windows's setting, like the screen it frames: Beautiful UI's
  // dark surfaces, written out so the light theme doesn't flip them.
  const barButton = "bg-[oklch(0.26_0.006_271.191)] text-[oklch(0.964_0.002_247.839)] shadow-[0_0_0_1px_oklch(1_0_0/0.1)] hover:bg-[oklch(0.318_0.007_274.747)]";
  const barPrimary = "bg-[oklch(0.964_0.002_247.839)] text-[oklch(0.247_0.006_258.361)] hover:opacity-90";

  return (
    <section
      className={cn("absolute inset-0 z-20 flex flex-col bg-[oklch(0.182_0.004_264.459)] text-[oklch(0.964_0.002_247.839)] animate-[fade-in_200ms_ease-out_both]", view.control === "you" && "shadow-[inset_0_0_0_3px_#dc2626]")}
      aria-label={`${botName}'s computer`}
    >
      <header className="flex flex-wrap items-center justify-between gap-2 bg-[oklch(0.209_0.004_264.477)] px-3 py-2 shadow-[0_1px_0_oklch(1_0_0/0.08)]">
        <span className="text-[13px] font-medium" role="status">
          {!running ? `${botName}'s computer is off.` : link === "lost" ? "Lost the connection to the computer." : who}
        </span>
        <div className="flex items-center gap-2">
          {!running && (
            <Button type="button" size="sm" className={barPrimary} disabled={view.isBusy || !!view.status?.blocker} onClick={() => void screen.start()}>
              {view.isBusy ? "Starting…" : "Start"}
            </Button>
          )}
          {running && link === "lost" && (
            <Button type="button" size="sm" variant="outline" className={barButton} onClick={() => void screen.watch()}>
              Reconnect
            </Button>
          )}
          {running && view.control !== "you" && (
            <Button type="button" size="sm" className={barPrimary} disabled={view.isBusy} onClick={() => void screen.takeOver()}>
              Take over
            </Button>
          )}
          {running && view.control === "you" && (
            <Button type="button" size="sm" className={barPrimary} disabled={view.isBusy} onClick={() => void screen.handBack()}>
              Hand back
            </Button>
          )}
        </div>
      </header>
      {view.lease?.reason && view.control === "agent" && (
        <p className="bg-orange-950 px-3 py-1.5 text-[13px] text-orange-300">
          {botName} asks you to take over: {view.lease.reason}
        </p>
      )}
      {view.status?.blocker && !running && <p className="px-3 py-1.5 text-[13px] text-orange-300">{view.status.blocker}</p>}
      {view.problem && (
        <p className="px-3 py-1.5 text-[13px] text-orange-300" role="alert">
          {view.problem}
        </p>
      )}
      <div className="relative min-h-0 flex-1 overflow-hidden" ref={canvas}>
        {view.demo && <DemoDesktop botName={botName} />}
      </div>
    </section>
  );
}

/** The demo's made-up desktop: a browser with a page the Bot is filling in. */
function DemoDesktop({ botName }: { botName: string }) {
  return (
    <svg className="size-full" viewBox="0 0 1440 900" role="img" aria-label={`${botName}'s demo desktop`}>
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
