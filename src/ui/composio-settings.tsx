import { useCallback, useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { ExternalLink } from "lucide-react";
import GlideMenu from "@/components/primitives/GlideMenu";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { applyComposio, COMPOSIO, composioServer, type ComposioOutcome } from "../hermes/composio";
import type { McpServerList } from "../hermes/mcp-servers";
import type { Session } from "../hermes/session";
import type { Bot } from "../hermes/types";
import { Avatar } from "./avatar";
import { openExternal } from "./open-external";
import { Consent, Field, Note, PageTitle, Problem, SectionTitle } from "./settings-parts";

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
    <form className="flex flex-col gap-3" onSubmit={save}>
      <PageTitle>Composio</PageTitle>
      <Note>{COMPOSIO.description}</Note>
      <Note>{COMPOSIO.needs}</Note>
      <Button type="button" variant="link" className="inline-flex h-auto items-center gap-1 self-start p-0 text-[13px] font-medium" onClick={() => void openExternal(COMPOSIO.link.url)}>
        {COMPOSIO.link.label}
        <ExternalLink aria-hidden />
      </Button>
      <SectionTitle>Bots that use it</SectionTitle>
      {bots.length === 0 && <Note>No Bots on this gateway yet.</Note>}
      {bots.length > 0 && (
        <GlideMenu rowSelector="[data-menu-row]" highlightClassName="inset-x-0 rounded-control bg-hover" className="rounded-card bg-surface p-1 shadow-card">
          <ul className="flex flex-col gap-px" inert={busy}>
            {rows.map(({ bot, list }) => (
              <ComposioRow key={bot.id} bot={bot} list={list} checked={isChosen(bot, list)} onChange={(value) => setChosen({ ...chosen, [bot.id]: value })} />
            ))}
          </ul>
        </GlideMenu>
      )}
      <Field htmlFor="composio-key" label="API key" help="Needed only to add Composio to a Bot that doesn't have it. The gateway keeps it; Unibot keeps no copy.">
        <Input id="composio-key" type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} disabled={busy} />
      </Field>
      {needsConsent && <Consent checked={consent} onChange={setConsent} what="the key" />}
      {outcome && <OutcomeNote outcome={outcome} />}
      <Button type="submit" className="self-start" disabled={!ready || busy}>
        {busy ? "Saving…" : "Save"}
      </Button>
      <Note className="text-[12px] text-ink-3">A Bot's open chat gets Composio when you Apply on that Bot's apps page; new chats get it anyway.</Note>
    </form>
  );
}

function ComposioRow({ bot, list, checked, onChange }: { bot: Bot; list: McpServerList; checked: boolean; onChange: (value: boolean) => void }) {
  const view = useSyncExternalStore(list.subscribe, list.getView);
  const loading = view.phase.kind === "loading";
  const has = composioServer(list) !== undefined;
  return (
    <li>
      <label data-menu-row className="relative z-10 flex cursor-pointer items-center gap-3 rounded-control px-2.5 py-1.5 has-disabled:cursor-default">
        <Checkbox checked={checked} disabled={loading || view.phase.kind === "failed"} onCheckedChange={(value) => onChange(value === true)} />
        <Avatar name={bot.name} className="size-7 text-[12px]" />
        <span className="flex-1 text-[13.5px] font-medium text-ink">{bot.name}</span>
        <span className="text-[12px] text-ink-3">
          {loading ? "Checking…" : view.phase.kind === "failed" ? "Couldn't read its apps" : has ? "Has Composio" : ""}
        </span>
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
      {parts.length > 0 && <Note role="status">{parts.join(" ")}</Note>}
      {outcome.failed.map((f) => (
        <Problem key={f.name}>
          {f.name}: {f.problem}
        </Problem>
      ))}
    </>
  );
}
