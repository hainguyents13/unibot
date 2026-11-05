import { appTitle, targetFrom, type ConnectionTarget } from "./connection-request";
import { describeError, GatewayError, isGatewayError } from "./gateway-error";
import type { JsonRpcChannel } from "./json-rpc-channel";

type Row = Record<string, unknown>;
type Rpc = Pick<JsonRpcChannel, "call">;
const str = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value.trim() : undefined);

/** Plain words for what the connector methods refuse with. */
export function connectorErrorText(error: unknown): string {
  if (!isGatewayError(error, "rpc")) return describeError(error);
  switch (error.code) {
    case 4031:
      return "This gateway doesn't offer connected apps. They come with a Nous Portal account in Hermes.";
    case 4032:
      return "Sign in to the Nous Portal in the Hermes app first, then try again.";
    case 4030:
      return "Your Nous Portal account isn't allowed to manage connected apps.";
    case 4002:
      return "Hermes can't do that for this app right now.";
    case 5033:
      return "This chat runs on another computer, so its apps are managed there.";
    default:
      return describeError(error);
  }
}

export interface Connector {
  slug: string;
  name: string;
  summary?: string;
  isConnected: boolean;
  /** The vendor's words when the account needs attention. */
  statusReason?: string;
  /** Its accounts' IDs, which Disconnect removes. Retired ones are left alone. */
  accountIds: string[];
}

/** A connect under way, or why the last one didn't finish. */
export type Connecting = { kind: "starting" } | { kind: "waiting" } | { kind: "failed"; message: string };

export interface ConnectorsView {
  /** `unavailable`: this gateway or profile has no hosted connectors (no Nous Portal account). */
  phase: { kind: "loading" } | { kind: "ready" } | { kind: "unavailable" } | { kind: "failed"; message: string };
  connectors: Connector[];
  connecting: Record<string, Connecting | undefined>;
  disconnecting: string[];
  notice?: string;
  problem?: string;
}

/** The catalog names every app on offer; the list says which are connected. Connected first. */
export function mergeConnectors(listed: unknown, catalog: unknown, accounts: unknown): Connector[] {
  const rows = new Map<string, { connected: boolean; reason?: string }>();
  for (const item of arrayOf((listed as Row)?.connectors)) {
    const slug = str(item.connector)?.toLowerCase();
    if (!slug || item.enabled === false) continue;
    rows.set(slug, { connected: item.connected === true, reason: str(item.status_reason) });
  }
  const ids = new Map<string, string[]>();
  for (const item of arrayOf((accounts as Row)?.accounts)) {
    if (item.disabled === true) continue;
    const slug = str(item.connector)?.toLowerCase();
    const id = str(item.connection_id);
    if (slug && id) ids.set(slug, [...(ids.get(slug) ?? []), id]);
  }
  const entries: Array<{ slug: string; name: string; summary?: string }> = arrayOf((catalog as Row)?.connectors).flatMap((item) => {
    const slug = str(item.slug)?.toLowerCase();
    return slug ? [{ slug, name: str(item.name) ?? appTitle(slug), summary: str(item.description) }] : [];
  });
  for (const slug of rows.keys()) if (!entries.some((e) => e.slug === slug)) entries.push({ slug, name: appTitle(slug) });
  return entries
    .map((e) => ({
      ...e,
      isConnected: rows.get(e.slug)?.connected ?? false,
      statusReason: rows.get(e.slug)?.reason,
      accountIds: ids.get(e.slug) ?? [],
    }))
    .sort((a, b) => Number(b.isConnected) - Number(a.isConnected) || a.name.localeCompare(b.name));
}

function arrayOf(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter((v): v is Row => !!v && typeof v === "object") : [];
}

const OWNER = { type: "account" };
/** Hermes waits five minutes on a connect; give it a little longer. */
const CONNECT_LIMIT_MS = 6 * 60_000;

/**
 * The apps a Bot can connect through the Nous Portal (Hermes's hosted connectors, such as Gmail or
 * Slack), apart from its MCP servers. The accounts belong to the Nous Portal sign-in of the Bot's
 * profile; everything goes through the socket's `connectors.*` methods with an account owner.
 */
export class ConnectorList {
  private view: ConnectorsView = { phase: { kind: "loading" }, connectors: [], connecting: {}, disconnecting: [] };
  private readonly listeners = new Set<() => void>();
  /** Connects under way, by app: Hermes's operation for each. */
  private readonly operations = new Map<string, string>();
  private refreshing = false;

  constructor(
    readonly profile: string,
    private readonly channel: () => Rpc | undefined,
    private readonly pollMs = 2_000,
  ) {}

  getView = (): ConnectorsView => this.view;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Reloads the apps and which are connected. Keeps the old list if the reload fails. */
  async refresh(): Promise<void> {
    const channel = this.channel();
    if (this.refreshing || !channel) return;
    this.refreshing = true;
    try {
      const listed = (await channel.call("connectors.list", { owner: OWNER, profile: this.profile }, 45_000)) as Row;
      if (listed?.available !== true) {
        this.set({ connectors: [], phase: { kind: "unavailable" } });
        return;
      }
      const [catalog, accounts] = await Promise.all([
        channel.call("connectors.catalog", { profile: this.profile }).catch(() => undefined),
        channel.call("connectors.accounts", { profile: this.profile }).catch(() => undefined),
      ]);
      this.set({ connectors: mergeConnectors(listed, catalog, accounts), phase: { kind: "ready" } });
    } catch (error) {
      if (isGatewayError(error, "rpc") && error.code === 4031) this.set({ connectors: [], phase: { kind: "unavailable" } });
      else if (this.view.phase.kind !== "ready") this.set({ phase: { kind: "failed", message: connectorErrorText(error) } });
    } finally {
      this.refreshing = false;
    }
  }

  /**
   * Starts connecting `connector`, opens the vendor's page with `open`, and waits until Hermes says
   * it's connected, the attempt fails or six minutes pass.
   */
  async connect(connector: Connector, open: (url: string) => void): Promise<void> {
    const now = this.view.connecting[connector.slug];
    if (now?.kind === "starting" || now?.kind === "waiting") return;
    const channel = this.channel();
    if (!channel) return;
    this.set({ notice: undefined, problem: undefined });
    this.setConnecting(connector.slug, { kind: "starting" });
    try {
      const started = (await channel.call(
        "connectors.connect",
        { owner: OWNER, profile: this.profile, connectors: [connector.slug] },
        45_000,
      )) as Row;
      const id = str(started?.op_id);
      if (!id) throw new GatewayError("invalidResponse");
      this.operations.set(connector.slug, id);
      if (this.settle(connector, started, open)) return;
      await this.wait(connector, id, channel, open);
    } catch (error) {
      this.setConnecting(connector.slug, { kind: "failed", message: connectorErrorText(error) });
    }
  }

  /** Reads the app's row in an operation snapshot. Returns whether the connect is over. */
  private settle(connector: Connector, snapshot: Row, open: (url: string) => void): boolean {
    const target = arrayOf(snapshot?.targets)
      .flatMap((t) => targetFrom(t) ?? [])
      .find((t) => t.name === connector.slug);
    if (!target) throw new GatewayError("invalidResponse");
    switch (target.state) {
      case "connected":
      case "failed":
      case "expired":
      case "skipped":
      case "not_connected":
        this.finish(connector, target.state, target.detail);
        return true;
      default:
        if (snapshot.settled === true) {
          this.finish(connector, "not_connected");
          return true;
        }
        if (target.connectUrl && this.view.connecting[connector.slug]?.kind === "starting") {
          this.setConnecting(connector.slug, { kind: "waiting" });
          open(target.connectUrl);
        }
        return false;
    }
  }

  private async wait(connector: Connector, operation: string, channel: Rpc, open: (url: string) => void): Promise<void> {
    const params = { owner: OWNER, profile: this.profile, op_id: operation };
    const deadline = Date.now() + CONNECT_LIMIT_MS;
    let first = true;
    while (this.operations.get(connector.slug) === operation && Date.now() < deadline) {
      if (!first) await sleep(this.pollMs);
      first = false;
      if (this.operations.get(connector.slug) !== operation) return;
      try {
        if (this.settle(connector, (await channel.call("connectors.operation.status", params)) as Row, open)) return;
      } catch (error) {
        if (isGatewayError(error, "rpc") && error.code === 4004) {
          // Hermes let go of it; the list says how it ended.
          this.operations.delete(connector.slug);
          this.setConnecting(connector.slug, undefined);
          await this.refresh();
          return;
        }
      }
    }
    if (this.operations.get(connector.slug) === operation) this.finish(connector, "expired");
  }

  private finish(connector: Connector, state: ConnectionTarget["state"], detail?: string): void {
    this.operations.delete(connector.slug);
    if (state === "connected") {
      this.setConnecting(connector.slug, undefined);
      this.set({
        connectors: this.view.connectors.map((c) => (c.slug === connector.slug ? { ...c, isConnected: true, statusReason: undefined } : c)),
        notice: `Connected ${connector.name}.`,
      });
      void this.refresh();
    } else if (state === "skipped") {
      this.setConnecting(connector.slug, undefined);
    } else if (state === "expired" || state === "not_connected") {
      this.setConnecting(connector.slug, { kind: "failed", message: "The sign-in wasn't finished in time. Try again." });
    } else {
      this.setConnecting(connector.slug, { kind: "failed", message: detail ?? "The sign-in didn't finish. Try again." });
    }
  }

  /** Stops waiting for a connect here and on the gateway. */
  async cancelConnecting(connector: Connector): Promise<void> {
    this.setConnecting(connector.slug, undefined);
    const operation = this.operations.get(connector.slug);
    this.operations.delete(connector.slug);
    const channel = this.channel();
    if (!operation || !channel) return;
    const result = { targets: [{ name: connector.slug, status: "skipped" }] };
    await channel.call("connection.respond", { owner: OWNER, profile: this.profile, op_id: operation, result }).catch(() => {});
  }

  /** Removes every account of `connector` from the Nous Portal. The Bot loses it everywhere. */
  async disconnect(connector: Connector): Promise<void> {
    const channel = this.channel();
    if (!channel) return;
    this.set({ notice: undefined, problem: undefined, disconnecting: [...this.view.disconnecting, connector.slug] });
    try {
      if (!connector.accountIds.length) {
        this.set({ problem: `Couldn't find the ${connector.name} account to remove. Try again.` });
        return;
      }
      for (const id of connector.accountIds) {
        await channel.call("connectors.accounts.remove", { profile: this.profile, connection_id: id });
      }
      this.set({
        connectors: this.view.connectors.map((c) => (c.slug === connector.slug ? { ...c, isConnected: false, accountIds: [] } : c)),
        notice: `Disconnected ${connector.name}.`,
      });
    } catch (error) {
      this.set({ problem: `Couldn't disconnect ${connector.name}: ${connectorErrorText(error)}` });
    } finally {
      this.set({ disconnecting: this.view.disconnecting.filter((s) => s !== connector.slug) });
      await this.refresh();
    }
  }

  private setConnecting(slug: string, connecting: Connecting | undefined): void {
    this.set({ connecting: { ...this.view.connecting, [slug]: connecting } });
  }

  private set(change: Partial<ConnectorsView>): void {
    this.view = { ...this.view, ...change };
    for (const listener of this.listeners) listener();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
