import { Button } from "@/components/ui/button";
import type { ChatThread, ConnectionCard as Card } from "../hermes/chat-thread";
import { offerFor, openTargets, type ConnectionTarget } from "../hermes/connection-request";
import { openExternal } from "./open-external";
import { RequestCard } from "./request-cards";
import { Note, Problem } from "./settings-parts";

/**
 * The Bot asked to connect apps and waits. Each app says what can be done about it here; whether it
 * connected is Hermes's to say, so a row you signed in to waits until Hermes reports back.
 */
export function ConnectionCard({ thread, card, botName, online, openApps }: { thread: ChatThread; card: Card; botName: string; online: boolean; openApps: () => void }) {
  const { request } = card;
  if (request.suggested) {
    return (
      <RequestCard title={`${botName} wants you to connect apps`} aria-label="Connect apps">
        {request.suggested.length > 0 && <Note>It suggests {request.suggested.join(", ")}.</Note>}
        <Note>Connect them under Apps, then press Done so {botName} goes on.</Note>
        {card.problem && <Problem>{card.problem}</Problem>}
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" onClick={openApps}>
            Open Apps
          </Button>
          <Button type="button" size="sm" disabled={!online} onClick={() => thread.finishConnecting()}>
            Done
          </Button>
        </div>
      </RequestCard>
    );
  }
  const waiting = openTargets(request);
  return (
    <RequestCard title={`${botName} wants to connect ${request.targets.length === 1 ? request.targets[0].title : "apps"}`} aria-label="Connect apps">
      <ul className="flex flex-col divide-y rounded-lg border">
        {request.targets.map((target) => (
          <TargetRow key={target.name} thread={thread} target={target} card={card} online={online} />
        ))}
      </ul>
      {card.problem && <Problem>{card.problem}</Problem>}
      <Note className="text-xs">{botName} waits up to 5 minutes. Not now lets it go on without them.</Note>
      {waiting.length > 0 && (
        <Button type="button" size="sm" variant="ghost" className="self-start" disabled={!online || card.busy.length > 0} onClick={() => thread.skipConnection()}>
          Not now
        </Button>
      )}
    </RequestCard>
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
    <li className="flex items-center justify-between gap-3 px-3 py-2.5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="font-semibold">{target.title}</span>
        {status && (target.state === "failed" ? <Problem>{status}</Problem> : <Note>{status}</Note>)}
        {target.instructions && <Note>{target.instructions}</Note>}
      </div>
      {offer.kind === "signIn" && (
        <Button
          type="button"
          size="sm"
          disabled={!online}
          onClick={() => {
            const url = thread.connectApp(target);
            if (url) void openExternal(url);
          }}
        >
          {opened ? "Open again" : "Connect"}
        </Button>
      )}
      {offer.kind === "approve" && (
        <Button type="button" size="sm" disabled={!online || busy} onClick={() => thread.connectApp(target)}>
          {busy ? "Adding…" : target.action === "enable" ? "Turn on" : "Add"}
        </Button>
      )}
      {offer.kind === "retry" && (
        <Button type="button" size="sm" variant="outline" disabled={!online || busy} onClick={() => thread.retryApp(target)}>
          {busy ? "Trying…" : "Try again"}
        </Button>
      )}
    </li>
  );
}
