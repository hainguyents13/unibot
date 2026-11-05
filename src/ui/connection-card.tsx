import type { ChatThread, ConnectionCard as Card } from "../hermes/chat-thread";
import { offerFor, openTargets, type ConnectionTarget } from "../hermes/connection-request";
import { openExternal } from "./open-external";

/**
 * The Bot asked to connect apps and waits. Each app says what can be done about it here; whether it
 * connected is Hermes's to say, so a row you signed in to waits until Hermes reports back.
 */
export function ConnectionCard({ thread, card, botName, online, openApps }: { thread: ChatThread; card: Card; botName: string; online: boolean; openApps: () => void }) {
  const { request } = card;
  if (request.suggested) {
    return (
      <section className="card" aria-label="Connect apps">
        <h3>{botName} wants you to connect apps</h3>
        {request.suggested.length > 0 && <p className="card-note">It suggests {request.suggested.join(", ")}.</p>}
        <p className="card-note">Connect them under Apps, then press Done so {botName} goes on.</p>
        {card.problem && <p className="problem">{card.problem}</p>}
        <div className="card-actions">
          <button type="button" onClick={openApps}>
            Open Apps
          </button>
          <button type="button" className="primary" disabled={!online} onClick={() => thread.finishConnecting()}>
            Done
          </button>
        </div>
      </section>
    );
  }
  const waiting = openTargets(request);
  return (
    <section className="card" aria-label="Connect apps">
      <h3>{botName} wants to connect {request.targets.length === 1 ? request.targets[0].title : "apps"}</h3>
      <ul className="connect-rows">
        {request.targets.map((target) => (
          <TargetRow key={target.name} thread={thread} target={target} card={card} online={online} />
        ))}
      </ul>
      {card.problem && <p className="problem">{card.problem}</p>}
      <p className="card-note">{botName} waits up to 5 minutes. Not now lets it go on without them.</p>
      {waiting.length > 0 && (
        <div className="card-actions">
          <button type="button" disabled={!online || card.busy.length > 0} onClick={() => thread.skipConnection()}>
            Not now
          </button>
        </div>
      )}
    </section>
  );
}

function TargetRow({ thread, target, card, online }: { thread: ChatThread; target: ConnectionTarget; card: Card; online: boolean }) {
  const offer = offerFor(target);
  const busy = card.busy.includes(target.name);
  const opened = card.opened.includes(target.name);
  const status =
    target.state === "connected"
      ? "Connected"
      : target.state === "skipped"
        ? "Not now"
        : target.state === "failed"
          ? `Didn't connect${target.detail ? `: ${target.detail}` : ""}`
          : target.state === "expired"
            ? "The link expired"
            : opened
              ? "Finish signing in in your browser. This updates when Hermes sees it."
              : offer.kind === "elsewhere"
                ? "It needs a key or a review: finish it in the Hermes app."
                : offer.kind === "preparing"
                  ? "Getting the sign-in page…"
                  : undefined;
  return (
    <li className="connect-row">
      <div className="connect-row-text">
        <span className="connect-row-name">{target.title}</span>
        {status && <span className={target.state === "failed" ? "routine-failed" : "card-note"}>{status}</span>}
        {target.instructions && <span className="card-note">{target.instructions}</span>}
      </div>
      {offer.kind === "signIn" && (
        <button
          type="button"
          className="primary"
          disabled={!online}
          onClick={() => {
            const url = thread.connectApp(target);
            if (url) void openExternal(url);
          }}
        >
          {opened ? "Open again" : "Connect"}
        </button>
      )}
      {offer.kind === "approve" && (
        <button type="button" className="primary" disabled={!online || busy} onClick={() => thread.connectApp(target)}>
          {busy ? "Adding…" : target.action === "enable" ? "Turn on" : "Add"}
        </button>
      )}
      {offer.kind === "retry" && (
        <button type="button" disabled={!online || busy} onClick={() => thread.retryApp(target)}>
          {busy ? "Trying…" : "Try again"}
        </button>
      )}
    </li>
  );
}
