import { useEffect, useRef, useState, type FormEvent } from "react";
import { GatewayAddress } from "../hermes/gateway-address";
import { describeError } from "../hermes/gateway-error";
import type { Link, Session, SessionState } from "../hermes/session";
import { AppsSettings } from "./apps-settings";
import { RecentGateways } from "./connect-view";

export type SettingsPage = { kind: "gateway" } | { kind: "apps"; botId: string };

interface SettingsDialogProps {
  session: Session;
  state: Extract<SessionState, { kind: "signedIn" }>;
  page: SettingsPage;
  onPage: (page: SettingsPage) => void;
  onClose: () => void;
}

/** Settings: the gateway you're signed in to, and each Bot's apps, with a page list on the left. */
export function SettingsDialog({ session, state, page, onPage, onClose }: SettingsDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const bot = page.kind === "apps" ? state.bots.find((b) => b.id === page.botId) : undefined;

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  return (
    <dialog ref={dialog} className="dialog settings" aria-label="Settings" onClose={onClose}>
      <header className="settings-header">
        <h2>Settings</h2>
        <button type="button" className="icon-button" aria-label="Close settings" onClick={() => dialog.current?.close()}>
          ×
        </button>
      </header>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings pages">
          <button type="button" aria-current={page.kind === "gateway" ? "page" : undefined} onClick={() => onPage({ kind: "gateway" })}>
            Gateway
          </button>
          <h3 className="settings-nav-section">Apps</h3>
          {state.bots.map((b) => (
            <button
              key={b.id}
              type="button"
              aria-current={page.kind === "apps" && page.botId === b.id ? "page" : undefined}
              onClick={() => onPage({ kind: "apps", botId: b.id })}
            >
              {b.name}
            </button>
          ))}
          {state.bots.length === 0 && <p className="hint settings-nav-note">No Bots yet.</p>}
        </nav>
        <section className="settings-page">
          {page.kind === "gateway" && <GatewaySettings session={session} state={state} />}
          {page.kind === "apps" &&
            (bot ? (
              <>
                <h3 className="settings-title">{bot.name}'s apps</h3>
                <p className="card-note">Each Bot has its own apps, kept on the gateway with their keys and sign-ins.</p>
                <AppsSettings key={bot.id} apps={session.apps(bot.id)} botName={bot.name} />
              </>
            ) : (
              <p className="card-note">That Bot isn't on this gateway any more.</p>
            ))}
        </section>
      </div>
    </dialog>
  );
}

function GatewaySettings({ session, state }: { session: Session; state: SettingsDialogProps["state"] }) {
  const current = state.gateway.baseUrl;
  const others = session.recentGateways().filter((gateway) => gateway !== current);
  const [address, setAddress] = useState("");
  const [problem, setProblem] = useState<string>();

  function switchTo(event: FormEvent) {
    event.preventDefault();
    try {
      GatewayAddress.parse(address);
    } catch (error) {
      return setProblem(describeError(error));
    }
    void session.switchGateway(address.trim());
  }

  return (
    <>
      <h3 className="settings-title">Gateway</h3>
      <div className="routine">
        <div className="routine-top">
          <span className="routine-name settings-address">{current}</span>
          {!state.demo && (
            <button type="button" onClick={() => void session.signOut()}>
              Sign out
            </button>
          )}
        </div>
        <p className="card-note">{state.demo ? "The demo: a made-up gateway, and nothing connects." : linkText(state.link)}</p>
      </div>
      {!state.demo && (
        <>
          <p className="hint">Signing out removes this gateway's saved sign-in from this computer. Switching to another gateway keeps it.</p>
          <RecentGateways
            title="Switch to"
            gateways={others}
            onOpen={(gateway) => void session.switchGateway(gateway)}
            onForget={(gateway) => void session.forgetGateway(gateway)}
          />
          <form className="settings-gateway-form" onSubmit={switchTo}>
            <label htmlFor="other-gateway">Another gateway</label>
            <div className="settings-gateway-row">
              <input
                id="other-gateway"
                value={address}
                onChange={(e) => {
                  setAddress(e.target.value);
                  setProblem(undefined);
                }}
                placeholder="100.101.102.103:9119"
                autoComplete="off"
                spellCheck={false}
              />
              <button type="submit" disabled={!address.trim()}>
                Switch
              </button>
            </div>
            {problem && (
              <p className="problem" role="alert">
                {problem}
              </p>
            )}
            <p className="hint">A gateway you haven't used here signs in on its page in your browser.</p>
          </form>
        </>
      )}
    </>
  );
}

function linkText(link: Link): string {
  switch (link.kind) {
    case "online":
      return "Connected.";
    case "connecting":
      return "Connecting…";
    case "offline":
      return `${link.message} Trying again…`;
  }
}
