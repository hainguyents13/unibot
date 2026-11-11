import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, Plus } from "lucide-react";
import GlideMenu from "@/components/primitives/GlideMenu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { APP_PRESETS, type AppPreset } from "../hermes/app-presets";
import type { Connector, ConnectorList } from "../hermes/connectors";
import { serverLocation, type McpCatalogEntry, type McpServer, type McpServerList } from "../hermes/mcp-servers";
import type { BotApps } from "../hermes/session";
import { CatalogForm, CustomForm, PresetForm } from "./app-forms";
import { openExternal } from "./open-external";
import { Note, Panel, Problem, SectionTitle } from "./settings-parts";

type Screen = { kind: "list" } | { kind: "add" } | { kind: "preset"; preset: AppPreset } | { kind: "catalog"; entry: McpCatalogEntry } | { kind: "custom" };

/**
 * A Bot's apps, in Settings: the MCP servers its profile has on the gateway, and the apps connected
 * through the Nous Portal. Hermes holds every sign-in and key; this shows them and changes them.
 */
export function AppsSettings({ apps, botName }: { apps: BotApps; botName: string }) {
  const servers = useSyncExternalStore(apps.servers.subscribe, apps.servers.getView);
  const [screen, setScreen] = useState<Screen>({ kind: "list" });

  useEffect(() => {
    setScreen({ kind: "list" });
    void apps.servers.refresh();
    void apps.connectors.refresh();
  }, [apps]);

  const back = () => {
    apps.servers.clearMessages();
    setScreen({ kind: "list" });
  };

  return (
    <div className="flex flex-col gap-3">
      {screen.kind !== "list" && (
        <Button type="button" variant="ghost" size="sm" className="-ml-2 self-start text-ink-2" onClick={screen.kind === "add" ? back : () => setScreen({ kind: "add" })}>
          <ChevronLeft aria-hidden />
          {screen.kind === "add" ? `${botName}'s apps` : "Add an app"}
        </Button>
      )}
      {servers.notice && <Note role="status">{servers.notice}</Note>}
      {servers.problem && <Problem>{servers.problem}</Problem>}
      {screen.kind === "list" && <AppsList apps={apps} botName={botName} onAdd={() => setScreen({ kind: "add" })} />}
      {screen.kind === "add" && <AddApp list={apps.servers} onPick={setScreen} />}
      {screen.kind === "preset" && <PresetForm preset={screen.preset} list={apps.servers} onDone={() => setScreen({ kind: "list" })} />}
      {screen.kind === "catalog" && <CatalogForm entry={screen.entry} list={apps.servers} onDone={() => setScreen({ kind: "list" })} />}
      {screen.kind === "custom" && <CustomForm list={apps.servers} onDone={() => setScreen({ kind: "list" })} />}
    </div>
  );
}

function AppsList({ apps, botName, onAdd }: { apps: BotApps; botName: string; onAdd: () => void }) {
  const view = useSyncExternalStore(apps.servers.subscribe, apps.servers.getView);
  const [applying, setApplying] = useState(false);
  return (
    <>
      {view.needsApply && (
        <Panel className="bg-accent-tint shadow-none animate-[fade-up_300ms_cubic-bezier(0.23,1,0.32,1)_both]">
          <Note>
            {botName}'s open chat still has the apps it started with. Applying reloads them now; the next reply costs more, since the whole conversation is sent
            again. Otherwise new chats get them.
          </Note>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            disabled={applying || !apps.servers.canApplyNow}
            onClick={async () => {
              setApplying(true);
              await apps.servers.applyNow();
              setApplying(false);
            }}
          >
            {applying ? "Applying…" : "Apply to the open chat"}
          </Button>
        </Panel>
      )}
      <div className="flex items-center justify-between gap-2">
        <SectionTitle className="mt-0">On the gateway</SectionTitle>
        <Button type="button" size="sm" onClick={onAdd}>
          <Plus aria-hidden />
          Add an app
        </Button>
      </div>
      {view.phase.kind === "loading" && <Note>Loading…</Note>}
      {view.phase.kind === "failed" && <Problem>{view.phase.message}</Problem>}
      {view.phase.kind === "ready" && view.servers.length === 0 && <Note>{botName} has no apps yet. Add GitHub, Plane, Linear and more.</Note>}
      <ul className="flex flex-col gap-2">
        {view.servers.map((server) => (
          <ServerRow key={server.name} list={apps.servers} server={server} />
        ))}
      </ul>
      <ConnectedApps list={apps.connectors} />
    </>
  );
}

function ServerRow({ list, server }: { list: McpServerList; server: McpServer }) {
  const view = useSyncExternalStore(list.subscribe, list.getView);
  const [confirming, setConfirming] = useState(false);
  const check = view.checks[server.name];
  const signIn = view.signIns[server.name];
  const fromPlugin = server.plugin !== undefined;
  const signingIn = signIn?.kind === "starting" || signIn?.kind === "waiting";
  let status: { text: string; failed?: boolean } | undefined;
  if (signIn?.kind === "starting") status = { text: "Starting the sign-in…" };
  else if (signIn?.kind === "waiting") status = { text: "Finish signing in in your browser. This updates when the gateway has it." };
  else if (signIn?.kind === "failed") status = { text: `The sign-in didn't finish: ${signIn.message}`, failed: true };
  else if (check?.kind === "running") status = { text: "Testing…" };
  else if (check?.kind === "passed") status = { text: check.tools.length === 1 ? "Works: 1 tool" : `Works: ${check.tools.length} tools` };
  else if (check?.kind === "failed") status = { text: check.message, failed: true };

  return (
    <li>
      <Panel>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13.5px] font-medium text-ink">{server.name}</span>
          <Switch
            checked={server.enabled}
            disabled={fromPlugin}
            onCheckedChange={(checked) => void list.setEnabled(server, checked)}
            aria-label={`${server.enabled ? "Turn off" : "Turn on"} ${server.name}`}
          />
        </div>
        <Note className="break-all">
          {serverLocation(server)}
          {server.auth === "oauth" ? " · signs in" : server.auth === "header" ? " · token" : ""}
          {fromPlugin ? ` · from ${server.plugin || "a plugin"}` : ""}
          {!server.enabled ? " · off" : ""}
        </Note>
        {status && (status.failed ? <Problem>{status.text}</Problem> : <Note>{status.text}</Note>)}
        {check?.kind === "passed" && check.tools.length > 0 && (
          <details className="text-[13px]">
            <summary className="cursor-pointer text-ink-2 transition-colors duration-100 hover:text-ink">Tools</summary>
            <ul className="mt-1 flex max-h-48 flex-col gap-1 overflow-y-auto pl-4">
              {check.tools.map((tool) => (
                <li key={tool.name}>
                  <code className="rounded-chip bg-field px-1 py-0.5 font-mono text-[11.5px] text-ink shadow-hairline">{tool.name}</code>
                  {tool.description ? <span className="text-ink-3"> · {tool.description}</span> : ""}
                </li>
              ))}
            </ul>
          </details>
        )}
        {confirming ? (
          <div className="flex flex-wrap items-center gap-2">
            <Note className="w-full">Remove “{server.name}”? A key or sign-in it saved stays on the gateway.</Note>
            <Button type="button" variant="destructive" size="sm" onClick={() => void list.remove(server).then(() => setConfirming(false))}>
              Remove
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(false)}>
              Keep
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {server.auth === "oauth" &&
              !fromPlugin &&
              (signingIn ? (
                <Button type="button" variant="outline" size="sm" onClick={() => void list.cancelSignIn(server)}>
                  Cancel sign-in
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant={check?.kind === "passed" ? "outline" : "default"}
                  onClick={() => void list.signIn(server, (url) => void openExternal(url))}
                >
                  {check?.kind === "passed" ? "Sign in again" : "Sign in"}
                </Button>
              ))}
            <Button type="button" variant="outline" size="sm" disabled={check?.kind === "running"} onClick={() => void list.test(server)}>
              Test
            </Button>
            {!fromPlugin && (
              <Button type="button" variant="ghost" size="sm" className="text-ink-2" onClick={() => setConfirming(true)}>
                Remove
              </Button>
            )}
          </div>
        )}
      </Panel>
    </li>
  );
}

/** Apps the Nous Portal connects, such as Gmail or Google Drive. Only with a Portal account. */
function ConnectedApps({ list }: { list: ConnectorList }) {
  const view = useSyncExternalStore(list.subscribe, list.getView);
  return (
    <>
      <SectionTitle className="mt-4">Connected apps</SectionTitle>
      {view.phase.kind === "loading" && <Note>Loading…</Note>}
      {view.phase.kind === "unavailable" && (
        <Note>Gmail, Google Drive, Slack and more connect through a Nous Portal account in Hermes. This gateway doesn't have one, so add apps above instead.</Note>
      )}
      {view.phase.kind === "failed" && <Problem>{view.phase.message}</Problem>}
      {view.notice && <Note role="status">{view.notice}</Note>}
      {view.problem && <Problem>{view.problem}</Problem>}
      {view.phase.kind === "ready" && (
        <>
          <Note>Connected through the Nous Portal. Disconnecting an app takes it from every Bot on this account.</Note>
          <ul className="flex flex-col gap-2">
            {view.connectors.map((connector) => (
              <ConnectorRow key={connector.slug} list={list} connector={connector} />
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function ConnectorRow({ list, connector }: { list: ConnectorList; connector: Connector }) {
  const view = useSyncExternalStore(list.subscribe, list.getView);
  const connecting = view.connecting[connector.slug];
  const waiting = connecting?.kind === "starting" || connecting?.kind === "waiting";
  const disconnecting = view.disconnecting.includes(connector.slug);
  return (
    <li>
      <Panel>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13.5px] font-medium text-ink">{connector.name}</span>
          {connector.isConnected && <Badge className="bg-green-tint text-green">Connected</Badge>}
        </div>
        {connector.summary && <Note>{connector.summary}</Note>}
        {connector.statusReason && <Problem>{connector.statusReason}</Problem>}
        {connecting?.kind === "waiting" && <Note>Finish signing in in your browser. This updates when Hermes sees it.</Note>}
        {connecting?.kind === "failed" && <Problem>{connecting.message}</Problem>}
        <div className="flex gap-2">
          {connector.isConnected ? (
            <Button type="button" variant="outline" size="sm" disabled={disconnecting} onClick={() => void list.disconnect(connector)}>
              {disconnecting ? "Disconnecting…" : "Disconnect"}
            </Button>
          ) : waiting ? (
            <Button type="button" variant="outline" size="sm" onClick={() => void list.cancelConnecting(connector)}>
              Cancel
            </Button>
          ) : (
            <Button type="button" size="sm" onClick={() => void list.connect(connector, (url) => void openExternal(url))}>
              Connect
            </Button>
          )}
        </div>
      </Panel>
    </li>
  );
}

/** Choices in a card, with Beautiful UI's one highlight gliding to the one you point at. */
function PickList({ children }: { children: ReactNode }) {
  return (
    <GlideMenu rowSelector="[data-menu-row]:not(:disabled)" highlightClassName="inset-x-0 rounded-control bg-hover" className="rounded-card bg-surface p-1 shadow-card">
      <ul className="flex flex-col gap-px">{children}</ul>
    </GlideMenu>
  );
}

/** A choice in Add an app: a quick setup, a catalog entry, or your own. */
function Pick({ title, tag, description, disabled, onClick }: { title: string; tag?: string; description?: ReactNode; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      data-menu-row
      className="group relative z-10 flex w-full items-center gap-3 rounded-control px-2.5 py-2 text-left transition-transform duration-150 active:scale-[0.99] disabled:cursor-default disabled:opacity-50"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[13.5px] font-medium text-ink">
          {title}
          {tag && <span className="font-normal text-ink-3"> · {tag}</span>}
        </span>
        {description && <span className="text-[12.5px] text-ink-2">{description}</span>}
      </span>
      <ChevronRight className="size-4 shrink-0 text-ink-3 transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden />
    </button>
  );
}

/** Where a new app comes from: a quick setup, Hermes's catalog, or your own. */
function AddApp({ list, onPick }: { list: McpServerList; onPick: (screen: Screen) => void }) {
  const view = useSyncExternalStore(list.subscribe, list.getView);
  const [adding, setAdding] = useState<string>();
  useEffect(() => {
    void list.loadCatalog();
  }, [list]);

  async function pickCatalog(entry: McpCatalogEntry) {
    if (entry.requiredEnv.length) return onPick({ kind: "catalog", entry });
    setAdding(entry.name);
    const added = await list.install(entry, {});
    setAdding(undefined);
    if (added) onPick({ kind: "list" });
  }

  return (
    <>
      <SectionTitle className="mt-0">Quick setup</SectionTitle>
      <PickList>
        {APP_PRESETS.map((preset) => (
          <li key={preset.id}>
            <Pick title={preset.title} description={preset.description} onClick={() => onPick({ kind: "preset", preset })} />
          </li>
        ))}
      </PickList>
      <details className="rounded-card bg-surface px-3 py-2.5 text-[13px] shadow-card">
        <summary className="cursor-pointer font-medium text-ink">Google Drive, Docs, Sheets, Slides and Calendar</summary>
        <Note className="mt-2">
          The simplest way is Composio above, or Connected apps if this gateway has a Nous Portal account; either keeps your Google sign-in for you. To keep it
          on your gateway instead, run a Google Workspace MCP server there with your own Google Cloud OAuth client and an https address, then add it under Your
          own with Sign in.
        </Note>
        <Button
          type="button"
          variant="link"
          className="mt-1 inline-flex h-auto items-center gap-1 p-0 text-[13px] font-medium"
          onClick={() => void openExternal("https://github.com/taylorwilsdon/google_workspace_mcp")}
        >
          About the Google Workspace MCP server
          <ExternalLink aria-hidden />
        </Button>
      </details>
      <SectionTitle>From Hermes's catalog</SectionTitle>
      {view.catalogPhase.kind === "loading" && <Note>Loading…</Note>}
      {view.catalogPhase.kind === "failed" && <Problem>{view.catalogPhase.message}</Problem>}
      <PickList>
        {view.catalog.map((entry) => (
          <li key={entry.name}>
            <Pick
              title={entry.name}
              tag={
                entry.installed
                  ? "added"
                  : adding === entry.name
                    ? "adding…"
                    : entry.authType === "oauth"
                      ? "signs in"
                      : entry.requiredEnv.length
                        ? "needs a key"
                        : undefined
              }
              description={entry.description}
              disabled={entry.installed || adding !== undefined}
              onClick={() => void pickCatalog(entry)}
            />
          </li>
        ))}
      </PickList>
      <SectionTitle>Your own</SectionTitle>
      <PickList>
        <li>
          <Pick title="Another MCP server" description="A web address, or a program the gateway runs." onClick={() => onPick({ kind: "custom" })} />
        </li>
      </PickList>
    </>
  );
}
