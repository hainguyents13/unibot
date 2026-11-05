import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { isDemo } from "../app-mode";
import { demoChats, demoRooms, demoRoutines } from "../hermes/demo-chats";
import { BotScreen } from "../hermes/screen";
import { FakeGateway } from "../hermes/fake-gateway";
import { Session } from "../hermes/session";
import { ConnectView } from "./connect-view";
import { Shell } from "./shell";

export function App() {
  const [session, setSession] = useState<Session>();

  useEffect(() => {
    let cancelled = false;
    let created: Session | undefined;
    (async () => {
      if (await isDemo()) {
        const fake = new FakeGateway();
        created = Session.demo(fake.address, await fake.listBots(), demoChats(), demoRooms(), demoRoutines(), [BotScreen.demo("forge")]);
      } else {
        // Loaded only in the app: it imports Tauri plugins the browser preview doesn't have.
        const { tauriSessionDeps } = await import("../platform/tauri-platform");
        if (cancelled) return;
        created = Session.live(tauriSessionDeps);
        void created.restore();
      }
      if (!cancelled) setSession(created);
    })();
    return () => {
      cancelled = true;
      created?.dispose();
    };
  }, []);

  return session ? <SessionView session={session} /> : null;
}

function SessionView({ session }: { session: Session }) {
  const state = useSyncExternalStore(session.subscribe, session.getState);
  useBringToFrontAfterSignIn(state.kind);

  switch (state.kind) {
    case "restoring":
      return null;
    case "signedOut":
    case "signingIn":
      return <ConnectView session={session} state={state} />;
    case "signedIn":
      return <Shell session={session} state={state} />;
  }
}

/** Sign-in finishes in the browser, so the app comes back to the front when it's done. */
function useBringToFrontAfterSignIn(kind: string) {
  const previous = useRef(kind);
  useEffect(() => {
    if (previous.current === "signingIn" && kind === "signedIn") {
      void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().setFocus());
    }
    previous.current = kind;
  }, [kind]);
}
