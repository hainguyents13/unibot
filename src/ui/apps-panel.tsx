import { useEffect, useState, useSyncExternalStore } from "react";
import { APP_PRESETS, type AppPreset } from "../hermes/app-presets";
import type { Connector, ConnectorList } from "../hermes/connectors";
import { serverLocation, type McpCatalogEntry, type McpServer, type McpServerList } from "../hermes/mcp-servers";
import type { BotApps } from "../hermes/session";
import { CatalogForm, CustomForm, PresetForm } from "./app-forms";
import { openExternal } from "./open-external";

type Screen = { kind: "list" } | { kind: "add" } | { kind: "preset"; preset: AppPreset } | { kind: "catalog"; entry: McpCatalogEntry } | { kind: "custom" };

/**
 * A Bot's apps: the MCP servers its profile has on the gateway, and the apps connected through the
 * Nous Portal. Hermes holds every sign-in and key; this shows them and changes them.
 */
export function AppsPanel({ apps, botName, onClose }: { apps: BotApps; botName: string; onClose(): void }) {
  const servers = useSyncExternalStore(apps.servers.subscribe, apps.servers.getView);
  const [screen, setScreen] = useState<Screen>({ kind: "list" });

  useEffect(() => {
    void apps.servers.refresh();
    void apps.connectors.refresh();
  }, [apps]);

  const back = () => {
    apps.servers.clearMessages();
    setScreen({ kind: "list" });
  };

  return (
    <aside className="side-panel apps-panel" aria-label={`${botName}'s apps`}>
      <header className="side-panel-header">
        {screen.kind === "list" ? (
          <h2>Apps</h2>
        ) : (
          <button type="button" className="link-button" onClick={screen.kind === "add" ? back : () => setScreen({ kind: "add" })}>
            ← {screen.kind === "add" ? "Apps" : "Add an app"}
          </button>
        )}
        <button type="button" aria-label="Close apps" onClick={onClose}>
          ×
        </button>
      </header>
      {servers.notice && (
        <p className="card-note" role="status">
          {servers.notice}
        </p>
      )}
      {servers.problem && (
        <p className="problem" role="alert">
          {servers.problem}
        </p>
      )}
      {screen.kind === "list" && <AppsList apps={apps} botName={botName} onAdd={() => setScreen({ kind: "add" })} />}
      {screen.kind === "add" && <AddApp list={apps.servers} onPick={setScreen} />}
      {screen.kind === "preset" && <PresetForm preset={screen.preset} list={apps.servers} onDone={() => setScreen({ kind: "list" })} />}
      {screen.kind === "catalog" && <CatalogForm entry={screen.entry} list={apps.servers} onDone={() => setScreen({ kind: "list" })} />}
      {screen.kind === "custom" && <CustomForm list={apps.servers} onDone={() => setScreen({ kind: "list" })} />}
    </aside>
  );
}

function AppsList({ apps, botName, onAdd }: { apps: BotApps; botName: string; onAdd: () => void }) {
  const view = useSyncExternalStore(apps.servers.subscribe, apps.servers.getView);
  const [applying, setApplying] = useState(false);
  return (
    <>
      {view.needsApply && (
        <div className="apply-note">
          <p className="card-note">
            {botName}'s open chat still has the apps it started with. Applying reloads them now; the next reply costs more, since the whole conversation is sent
            again. Otherwise new chats get them.
          </p>
          <button
            type="button"
            disabled={applying || !apps.servers.canApplyNow}
            onClick={async () => {
              setApplying(true);
              await apps.servers.applyNow();
              setApplying(false);
            }}
          >
            {applying ? "Applying…" : "Apply to the open chat"}
          </button>
        </div>
      )}
      <div className="panel-section-row">
        <h3 className="panel-section">On the gateway</h3>
        <button type="button" className="primary" onClick={onAdd}>
          Add an app
        </button>
      </div>
      {view.phase.kind === "loading" && <p className="card-note">Loading…</p>}
      {view.phase.kind === "failed" && (
        <p className="problem" role="alert">
          {view.phase.message}
        </p>
      )}
      {view.phase.kind === "ready" && view.servers.length === 0 && <p className="card-note">{botName} has no apps yet. Add GitHub, Plane, Linear and more.</p>}
      <ul className="routines">
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
    <li className="routine">
      <div className="routine-top">
        <span className="routine-name">{server.name}</span>
        <label className="switch">
          <input
            type="checkbox"
            checked={server.enabled}
            disabled={fromPlugin}
            onChange={(e) => void list.setEnabled(server, e.target.checked)}
            aria-label={`${server.enabled ? "Turn off" : "Turn on"} ${server.name}`}
          />
          <span aria-hidden="true" />
        </label>
      </div>
      <p className="card-note">
        {serverLocation(server)}
        {server.auth === "oauth" ? " · signs in" : server.auth === "header" ? " · token" : ""}
        {fromPlugin ? ` · from ${server.plugin || "a plugin"}` : ""}
        {!server.enabled ? " · off" : ""}
      </p>
      {status && <p className={status.failed ? "routine-failed" : "card-note"}>{status.text}</p>}
      {check?.kind === "passed" && check.tools.length > 0 && (
        <details className="tool-list">
          <summary>Tools</summary>
          <ul>
            {check.tools.map((tool) => (
              <li key={tool.name}>
                <code>{tool.name}</code>
                {tool.description ? ` · ${tool.description}` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
      {confirming ? (
        <div className="card-actions">
          <span className="card-note">Remove “{server.name}”? A key or sign-in it saved stays on the gateway.</span>
          <button type="button" className="danger" onClick={() => void list.remove(server).then(() => setConfirming(false))}>
            Remove
          </button>
          <button type="button" onClick={() => setConfirming(false)}>
            Keep
          </button>
        </div>
      ) : (
        <div className="card-actions">
          {server.auth === "oauth" &&
            !fromPlugin &&
            (signingIn ? (
              <button type="button" onClick={() => void list.cancelSignIn(server)}>
                Cancel sign-in
              </button>
            ) : (
              <button
                type="button"
                className={check?.kind === "passed" ? undefined : "primary"}
                onClick={() => void list.signIn(server, (url) => void openExternal(url))}
              >
                {check?.kind === "passed" ? "Sign in again" : "Sign in"}
              </button>
            ))}
          <button type="button" disabled={check?.kind === "running"} onClick={() => void list.test(server)}>
            Test
          </button>
          {!fromPlugin && (
            <button type="button" onClick={() => setConfirming(true)}>
              Remove
            </button>
          )}
        </div>
      )}
    </li>
  );
}

/** Apps the Nous Portal connects, such as Gmail or Google Drive. Only with a Portal account. */
function ConnectedApps({ list }: { list: ConnectorList }) {
  const view = useSyncExternalStore(list.subscribe, list.getView);
  return (
    <>
      <h3 className="panel-section">Connected apps</h3>
      {view.phase.kind === "loading" && <p className="card-note">Loading…</p>}
      {view.phase.kind === "unavailable" && (
        <p className="card-note">
          Gmail, Google Drive, Slack and more connect through a Nous Portal account in Hermes. This gateway doesn't have one, so add apps above instead.
        </p>
      )}
      {view.phase.kind === "failed" && <p className="problem">{view.phase.message}</p>}
      {view.notice && (
        <p className="card-note" role="status">
          {view.notice}
        </p>
      )}
      {view.problem && (
        <p className="problem" role="alert">
          {view.problem}
        </p>
      )}
      {view.phase.kind === "ready" && (
        <>
          <p className="card-note">Connected through the Nous Portal. Disconnecting an app takes it from every Bot on this account.</p>
          <ul className="routines">
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
    <li className="routine">
      <div className="routine-top">
        <span className="routine-name">{connector.name}</span>
        {connector.isConnected && <span className="badge badge-connected">Connected</span>}
      </div>
      {connector.summary && <p className="card-note">{connector.summary}</p>}
      {connector.statusReason && <p className="routine-failed">{connector.statusReason}</p>}
      {connecting?.kind === "waiting" && <p className="card-note">Finish signing in in your browser. This updates when Hermes sees it.</p>}
      {connecting?.kind === "failed" && <p className="routine-failed">{connecting.message}</p>}
      <div className="card-actions">
        {connector.isConnected ? (
          <button type="button" disabled={disconnecting} onClick={() => void list.disconnect(connector)}>
            {disconnecting ? "Disconnecting…" : "Disconnect"}
          </button>
        ) : waiting ? (
          <button type="button" onClick={() => void list.cancelConnecting(connector)}>
            Cancel
          </button>
        ) : (
          <button type="button" className="primary" onClick={() => void list.connect(connector, (url) => void openExternal(url))}>
            Connect
          </button>
        )}
      </div>
    </li>
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
      <h3 className="panel-section">Quick setup</h3>
      <ul className="app-picks">
        {APP_PRESETS.map((preset) => (
          <li key={preset.id}>
            <button type="button" className="app-pick" onClick={() => onPick({ kind: "preset", preset })}>
              <span className="routine-name">{preset.title}</span>
              <span className="card-note">{preset.description}</span>
            </button>
          </li>
        ))}
      </ul>
      <details className="google-note">
        <summary>Google Drive, Docs, Sheets, Slides and Calendar</summary>
        <p className="card-note">
          The simplest way is Composio above, or Connected apps if this gateway has a Nous Portal account; either keeps your Google sign-in for you. To keep
          it on your gateway instead, run a Google Workspace MCP server there with your own Google Cloud OAuth client and an https address, then add it
          under Your own with Sign in.
        </p>
        <button type="button" className="link-button" onClick={() => void openExternal("https://github.com/taylorwilsdon/google_workspace_mcp")}>
          About the Google Workspace MCP server
        </button>
      </details>
      <h3 className="panel-section">From Hermes's catalog</h3>
      {view.catalogPhase.kind === "loading" && <p className="card-note">Loading…</p>}
      {view.catalogPhase.kind === "failed" && <p className="problem">{view.catalogPhase.message}</p>}
      <ul className="app-picks">
        {view.catalog.map((entry) => (
          <li key={entry.name}>
            <button type="button" className="app-pick" disabled={entry.installed || adding !== undefined} onClick={() => void pickCatalog(entry)}>
              <span className="routine-name">
                {entry.name}
                <span className="card-note">
                  {entry.installed
                    ? " · added"
                    : adding === entry.name
                      ? " · adding…"
                      : entry.authType === "oauth"
                        ? " · signs in"
                        : entry.requiredEnv.length
                          ? " · needs a key"
                          : ""}
                </span>
              </span>
              {entry.description && <span className="card-note">{entry.description}</span>}
            </button>
          </li>
        ))}
      </ul>
      <h3 className="panel-section">Your own</h3>
      <button type="button" className="app-pick" onClick={() => onPick({ kind: "custom" })}>
        <span className="routine-name">Another MCP server</span>
        <span className="card-note">A web address, or a program the gateway runs.</span>
      </button>
    </>
  );
}
