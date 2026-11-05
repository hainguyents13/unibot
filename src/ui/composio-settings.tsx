import { useCallback, useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { ExternalLink } from "lucide-react";
import { applyComposio, COMPOSIO, composioServer, type ComposioOutcome } from "../hermes/composio";
import type { McpServerList } from "../hermes/mcp-servers";
import type { Session } from "../hermes/session";
import type { Bot } from "../hermes/types";
import { openExternal } from "./open-external";

/**
 * One Composio key for the Bots you pick. Hermes keeps apps per Bot, so this adds Composio's server
 * to each picked Bot and removes it from the rest; the key goes to the gateway, not into Unibot.
 */
export function ComposioSettings({ session, bots }: { session: Session; bots: Bot[] }) {
  const lists = bots.map((bot) => session.apps(bot.id).servers);
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const [apiKey, setApiKey] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ComposioOutcome>();

  // The lists are cached per Bot, so the Bots' IDs say when they change.
  const ids = bots.map((b) => b.id).join();
  useEffect(() => {
    for (const list of lists) void list.refresh();
  }, [ids]);

  // Read again whenever any Bot's list changes, as which Bots have Composio decides what Save does.
  const subscribe = useCallback(
    (listener: () => void) => {
      const stops = lists.map((list) => list.subscribe(listener));
      return () => stops.forEach((stop) => stop());
    },
    [ids],
  );
  useSyncExternalStore(subscribe, () => lists.map((list) => `${list.getView().phase.kind}:${composioServer(list) ? 1 : 0}`).join());

  const rows = bots.map((bot, i) => ({ bot, list: lists[i] }));
  const has = (list: McpServerList) => composioServer(list) !== undefined;
  const isChosen = (bot: Bot, list: McpServerList) => chosen[bot.id] ?? has(list);
  const adding = rows.filter(({ bot, list }) => isChosen(bot, list) && !has(list));
  const changing = rows.some(({ bot, list }) => isChosen(bot, list) !== has(list));
  const needsConsent = adding.length > 0 && lists.some((list) => list.isUnencrypted);
  const ready = changing && (adding.length === 0 || apiKey.trim() !== "") && (!needsConsent || consent);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setOutcome(undefined);
    const result = await applyComposio(
      rows.map(({ bot, list }) => ({ name: bot.name, list, chosen: isChosen(bot, list) })),
      apiKey,
      consent,
    );
    setBusy(false);
    setOutcome(result);
    setChosen({});
    if (result.failed.length === 0) setApiKey("");
  }

  return (
    <form className="apps-settings" onSubmit={save}>
      <h3 className="settings-title">Composio</h3>
      <p className="card-note">{COMPOSIO.description}</p>
      <p className="card-note">{COMPOSIO.needs}</p>
      <p>
        <button type="button" className="link-button with-icon" onClick={() => void openExternal(COMPOSIO.link.url)}>
          {COMPOSIO.link.label}
          <ExternalLink size={13} aria-hidden />
        </button>
      </p>
      <h4 className="panel-section">Bots that use it</h4>
      {bots.length === 0 && <p className="card-note">No Bots on this gateway yet.</p>}
      <ul className="pick-list" inert={busy}>
        {rows.map(({ bot, list }) => (
          <ComposioRow key={bot.id} bot={bot} list={list} checked={isChosen(bot, list)} onChange={(value) => setChosen({ ...chosen, [bot.id]: value })} />
        ))}
      </ul>
      <label className="dialog-field">
        <span>API key</span>
        <input type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} disabled={busy} />
        <span className="hint">Needed only to add Composio to a Bot that doesn't have it. The gateway keeps it; Unibot keeps no copy.</span>
      </label>
      {needsConsent && (
        <label className="consent">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>This gateway uses plain http outside Tailscale, so others on the network could read the key. Send it anyway.</span>
        </label>
      )}
      {outcome && <OutcomeNote outcome={outcome} />}
      <div className="card-actions">
        <button type="submit" className="primary" disabled={!ready || busy}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
      <p className="hint">A Bot's open chat gets Composio when you Apply on that Bot's apps page; new chats get it anyway.</p>
    </form>
  );
}

function ComposioRow({ bot, list, checked, onChange }: { bot: Bot; list: McpServerList; checked: boolean; onChange: (value: boolean) => void }) {
  const view = useSyncExternalStore(list.subscribe, list.getView);
  const loading = view.phase.kind === "loading";
  const has = composioServer(list) !== undefined;
  return (
    <li>
      <label className="pick-row">
        <input type="checkbox" checked={checked} disabled={loading || view.phase.kind === "failed"} onChange={(e) => onChange(e.target.checked)} />
        <span className="pick-row-name">{bot.name}</span>
        <span className="hint">{loading ? "Checking…" : view.phase.kind === "failed" ? "Couldn't read its apps" : has ? "Has Composio" : ""}</span>
      </label>
    </li>
  );
}

function OutcomeNote({ outcome }: { outcome: ComposioOutcome }) {
  const parts = [
    outcome.added.length ? `Added to ${outcome.added.join(", ")}.` : "",
    outcome.removed.length ? `Removed from ${outcome.removed.join(", ")}.` : "",
  ].filter(Boolean);
  return (
    <>
      {parts.length > 0 && (
        <p className="card-note" role="status">
          {parts.join(" ")}
        </p>
      )}
      {outcome.failed.map((f) => (
        <p key={f.name} className="problem" role="alert">
          {f.name}: {f.problem}
        </p>
      ))}
    </>
  );
}
