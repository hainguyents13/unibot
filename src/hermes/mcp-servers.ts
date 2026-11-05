import { describeError, isGatewayError } from "./gateway-error";
import type { JsonRpcChannel } from "./json-rpc-channel";

type Row = Record<string, unknown>;
const str = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value.trim() : undefined);

/**
 * An MCP server in a Bot's profile, which the app calls an app. The gateway sends env values
 * masked; only the names of the set ones are kept.
 */
export interface McpServer {
  name: string;
  /** Set for a server reached over the web. */
  url?: string;
  /** Set for a server the gateway runs as a program. */
  command?: string;
  args: string[];
  envNames: string[];
  /** `oauth`, `header`, or undefined for none. */
  auth?: string;
  enabled: boolean;
  /** The plugin that provides it. Such a server can't be changed or removed here. */
  plugin?: string;
}

export function mcpServerFrom(value: unknown): McpServer | undefined {
  const row = value as Row;
  const name = str(row?.name);
  if (!name) return undefined;
  const env = row.env && typeof row.env === "object" ? (row.env as Row) : {};
  return {
    name,
    url: str(row.url),
    command: str(row.command),
    args: Array.isArray(row.args) ? row.args.filter((a): a is string => typeof a === "string") : [],
    // Values come masked, or empty when unset.
    envNames: Object.keys(env).filter((key) => typeof env[key] === "string" && env[key] !== "").sort(),
    auth: str(row.auth),
    enabled: row.enabled !== false,
    plugin: row.source === "plugin" ? (str(row.plugin) ?? "") : undefined,
  };
}

/** Where a server runs, in short: the web address's host, or the program and its first argument. */
export function serverLocation(server: McpServer): string {
  if (server.url) {
    try {
      return new URL(server.url).host || server.url;
    } catch {
      return server.url;
    }
  }
  if (!server.command) return "";
  const program = server.command.split("/").pop() ?? server.command;
  const first = server.args.find((a) => !a.startsWith("-"));
  return [program, first].filter(Boolean).join(" ");
}

/** A tool a server offers, as a connection test lists it. */
export interface McpTool {
  name: string;
  description?: string;
}

function toolsFrom(value: unknown): McpTool[] {
  return (Array.isArray(value) ? value : []).flatMap((t) => {
    const name = str((t as Row)?.name);
    return name ? [{ name, description: str((t as Row).description) }] : [];
  });
}

/** A server from Hermes's catalog of reviewed MCP servers. */
export interface McpCatalogEntry {
  name: string;
  description: string;
  /** `oauth`, `env`, `none` and so on, as the catalog says. */
  authType: string;
  /** Values the server needs before it can run, like an API key. */
  requiredEnv: Array<{ name: string; prompt?: string; required: boolean }>;
  url?: string;
  command?: string;
  /** The gateway fetches and builds it first, which takes a while. */
  needsInstall: boolean;
  installed: boolean;
}

export function catalogEntryFrom(value: unknown): McpCatalogEntry | undefined {
  const row = value as Row;
  const name = str(row?.name);
  if (!name) return undefined;
  return {
    name,
    description: str(row.description) ?? "",
    authType: str(row.auth_type) ?? "none",
    requiredEnv: (Array.isArray(row.required_env) ? row.required_env : []).flatMap((k) => {
      const key = k as Row;
      const keyName = str(key?.name);
      return keyName ? [{ name: keyName, prompt: str(key.prompt), required: key.required !== false }] : [];
    }),
    url: str(row.url),
    command: str(row.command),
    needsInstall: row.needs_install === true,
    installed: row.installed === true,
  };
}

/** A server you describe yourself: a web address, or a program the gateway runs. */
export interface McpServerDraft {
  name: string;
  kind: "web" | "program";
  url: string;
  command: string;
  /** Separated by spaces; double quotes keep spaces inside one. */
  arguments: string;
  auth: "none" | "token" | "signIn";
  token: string;
  /** Values a program reads from its environment, like an API key. */
  env: Record<string, string>;
}

export const emptyDraft: McpServerDraft = { name: "", kind: "web", url: "", command: "", arguments: "", auth: "none", token: "", env: {} };

/** What you typed that's secret: a token, and every env value. */
export function draftSecrets(draft: McpServerDraft): string[] {
  return [draft.token.trim(), ...Object.values(draft.env).map((v) => v.trim())].filter(Boolean);
}

export function isDraftComplete(draft: McpServerDraft): boolean {
  if (!draft.name.trim()) return false;
  if (draft.kind === "program") return draft.command.trim() !== "";
  try {
    const url = new URL(draft.url.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  } catch {
    return false;
  }
  return draft.auth !== "token" || draft.token.trim() !== "";
}

/** It carries a token, which mustn't cross the network unencrypted without your say-so. */
export function draftHasSecret(draft: McpServerDraft): boolean {
  if (draft.kind === "program") return Object.values(draft.env).some((v) => v.trim() !== "");
  return draft.auth === "token" && draft.token.trim() !== "";
}

/** What the gateway's add route takes. The token and env values only ever go there. */
export function draftBody(draft: McpServerDraft, profile: string): Row {
  if (draft.kind === "program") {
    const env = Object.fromEntries(Object.entries(draft.env).flatMap(([k, v]) => (k.trim() && v.trim() ? [[k.trim(), v.trim()]] : [])));
    return { name: draft.name.trim(), command: draft.command.trim(), args: splitArguments(draft.arguments), env, auth: "none", profile };
  }
  const body: Row = {
    name: draft.name.trim(),
    url: draft.url.trim(),
    args: [],
    auth: draft.auth === "token" ? "header" : draft.auth === "signIn" ? "oauth" : "none",
    profile,
  };
  if (draft.auth === "token") body.bearer_token = draft.token.trim();
  return body;
}

/** Splits on spaces, keeping what's inside double quotes together. */
export function splitArguments(text: string): string[] {
  const words: string[] = [];
  let current = "";
  let quoted = false;
  let started = false;
  for (const character of text) {
    if (character === '"') {
      quoted = !quoted;
      started = true;
    } else if (/\s/.test(character) && !quoted) {
      if (started) words.push(current);
      current = "";
      started = false;
    } else {
      current += character;
      started = true;
    }
  }
  if (started) words.push(current);
  return words;
}

/** Takes anything you typed (a token, a key) out of text that's about to be shown. */
export function scrub(text: string, secrets: string[]): string {
  return secrets.filter((s) => s.length >= 4).reduce((out, secret) => out.split(secret).join("•••"), text);
}

/** The last connection test of a server. */
export type McpCheck = { kind: "running" } | { kind: "passed"; tools: McpTool[] } | { kind: "failed"; message: string };

/** A sign-in under way, or why the last one didn't finish. */
export type McpSignIn = { kind: "starting" } | { kind: "waiting" } | { kind: "failed"; message: string };

type Phase = { kind: "loading" } | { kind: "ready" } | { kind: "failed"; message: string };

export interface McpView {
  phase: Phase;
  servers: McpServer[];
  catalogPhase: Phase;
  catalog: McpCatalogEntry[];
  checks: Record<string, McpCheck | undefined>;
  signIns: Record<string, McpSignIn | undefined>;
  /** Something changed that the open chat doesn't have yet. */
  needsApply: boolean;
  /** What just happened, when it's worth saying. */
  notice?: string;
  /** The last action that didn't go through, with anything you typed taken out. */
  problem?: string;
}

/** Sends one authenticated JSON request to the gateway's dashboard routes. */
export type JsonRequest = (path: string, options?: { method?: string; body?: unknown; timeoutMs?: number }) => Promise<unknown>;

export interface McpDeps {
  request: JsonRequest;
  channel: () => Pick<JsonRpcChannel, "call"> | undefined;
  /** The Bot's open chat, which changes can be applied to. */
  sessionId: () => string | undefined;
  /** A token or key would cross the network unencrypted, so it needs your say-so each time. */
  isUnencrypted: () => boolean;
  pollMs?: number;
}

/** The gateway forgets a sign-in after 15 minutes; stop asking a little after that. */
const SIGN_IN_LIMIT_MS = 16 * 60_000;

/**
 * One Bot's MCP servers, from the dashboard's `/api/mcp` routes: listed, switched, added, tested,
 * signed in and removed there. Every call names the profile. What you type for a server goes to the
 * gateway in the request and isn't kept here.
 */
export class McpServerList {
  private view: McpView = {
    phase: { kind: "loading" },
    servers: [],
    catalogPhase: { kind: "loading" },
    catalog: [],
    checks: {},
    signIns: {},
    needsApply: false,
  };
  private readonly listeners = new Set<() => void>();
  private refreshing = false;
  /** Sign-in flows under way, by server. */
  private readonly flows = new Map<string, string>();
  private readonly pollMs: number;

  constructor(
    readonly profile: string,
    private readonly deps: McpDeps,
  ) {
    this.pollMs = deps.pollMs ?? 2_000;
  }

  getView = (): McpView => this.view;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  get isUnencrypted(): boolean {
    return this.deps.isUnencrypted();
  }

  /** Whether the Bot has a chat open that changes can be applied to now. */
  get canApplyNow(): boolean {
    return this.deps.sessionId() !== undefined && this.deps.channel() !== undefined;
  }

  /** Reloads the list. Keeps showing the old one if the reload fails. */
  async refresh(): Promise<void> {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      const result = (await this.call("/api/mcp/servers")) as Row;
      const rows = Array.isArray(result?.servers) ? result.servers : [];
      this.set({ phase: { kind: "ready" }, servers: rows.flatMap((r) => mcpServerFrom(r) ?? []) });
    } catch (error) {
      if (this.view.phase.kind !== "ready") this.set({ phase: { kind: "failed", message: describeError(error) } });
    } finally {
      this.refreshing = false;
    }
  }

  /** Turns a server on or off. The switch moves at once and moves back if the gateway refuses. */
  async setEnabled(server: McpServer, enabled: boolean): Promise<void> {
    if (server.plugin !== undefined) return;
    this.set({ problem: undefined, notice: undefined });
    this.replace(server.name, { enabled });
    try {
      await this.call(`/api/mcp/servers/${encodeURIComponent(server.name)}/enabled`, { method: "PUT", body: { enabled, profile: this.profile } });
      this.set({ needsApply: true });
    } catch (error) {
      this.replace(server.name, { enabled: !enabled });
      this.set({ problem: `Couldn't turn ${enabled ? "on" : "off"} “${server.name}”: ${describeError(error)}` });
    }
  }

  /**
   * Adds a server you describe. Returns whether it was added; if not, `problem` says why and the
   * caller keeps the form. On an unencrypted address a token goes out only with `allowUnencrypted`.
   */
  async add(draft: McpServerDraft, allowUnencrypted = false): Promise<boolean> {
    if (!isDraftComplete(draft) || (draftHasSecret(draft) && this.isUnencrypted && !allowUnencrypted)) return false;
    this.set({ problem: undefined, notice: undefined });
    const body = draftBody(draft, this.profile);
    try {
      await this.call("/api/mcp/servers", { method: "POST", body });
      this.set({ needsApply: true });
      await this.refresh();
      return true;
    } catch (error) {
      this.set({ problem: `Couldn't add “${body.name}”: ${scrub(describeError(error), draftSecrets(draft))}` });
      return false;
    }
  }

  /** Removes a server from the profile for good. Its saved key or sign-in stays on the gateway. */
  async remove(server: McpServer): Promise<boolean> {
    if (server.plugin !== undefined) return false;
    this.set({ problem: undefined, notice: undefined });
    try {
      await this.call(`/api/mcp/servers/${encodeURIComponent(server.name)}`, { method: "DELETE" });
      this.set({
        servers: this.view.servers.filter((s) => s.name !== server.name),
        checks: { ...this.view.checks, [server.name]: undefined },
        needsApply: true,
      });
      return true;
    } catch (error) {
      this.set({ problem: `Couldn't remove “${server.name}”: ${describeError(error)}` });
      return false;
    }
  }

  /** Connects to a server on the gateway, lists its tools and disconnects. */
  async test(server: McpServer): Promise<void> {
    this.setCheck(server.name, { kind: "running" });
    try {
      // A program the gateway has to fetch first can take a while to answer.
      const result = (await this.call(`/api/mcp/servers/${encodeURIComponent(server.name)}/test`, { method: "POST", timeoutMs: 120_000 })) as Row;
      const error = str(result?.error);
      if (result?.ok === true) this.setCheck(server.name, { kind: "passed", tools: toolsFrom(result.tools) });
      else if (error?.startsWith("OAuth authentication required")) this.setCheck(server.name, { kind: "failed", message: "Sign in first, then test again." });
      else this.setCheck(server.name, { kind: "failed", message: `It didn't connect: ${error ?? "no reason given"}` });
    } catch (error) {
      this.setCheck(server.name, { kind: "failed", message: `Couldn't test it: ${describeError(error)}` });
    }
  }

  /** Loads Hermes's catalog, marking what's already added. */
  async loadCatalog(): Promise<void> {
    try {
      const result = (await this.call("/api/mcp/catalog")) as Row;
      const rows = Array.isArray(result?.entries) ? result.entries : [];
      this.set({ catalogPhase: { kind: "ready" }, catalog: rows.flatMap((r) => catalogEntryFrom(r) ?? []) });
    } catch (error) {
      if (this.view.catalogPhase.kind !== "ready") this.set({ catalogPhase: { kind: "failed", message: describeError(error) } });
    }
  }

  /**
   * Adds a catalog server with the values it asks for, switched on. Returns whether the gateway took
   * it; if not, `problem` says why. On an unencrypted address the values go out only with
   * `allowUnencrypted`.
   */
  async install(entry: McpCatalogEntry, values: Record<string, string>, allowUnencrypted = false): Promise<boolean> {
    const env = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== ""));
    if (Object.keys(env).length && this.isUnencrypted && !allowUnencrypted) return false;
    this.set({ problem: undefined, notice: undefined });
    try {
      const reply = (await this.call("/api/mcp/catalog/install", {
        method: "POST",
        body: { name: entry.name, env, enable: true, profile: this.profile },
        timeoutMs: 120_000,
      })) as Row;
      this.set({ needsApply: true });
      if (reply?.background === true) {
        this.set({ notice: `The gateway is fetching “${entry.name}”. It shows here when it's ready.` });
        void this.waitForInstall(entry.name);
      } else {
        await this.refresh();
      }
      await this.loadCatalog();
      return true;
    } catch (error) {
      this.set({ problem: `Couldn't add “${entry.name}”: ${scrub(describeError(error), Object.values(env))}` });
      return false;
    }
  }

  /**
   * Brings the Bot's running chat up to date with its servers. Hermes reloads them, and the next
   * reply costs more, since the conversation is sent again in full.
   */
  async applyNow(): Promise<void> {
    this.set({ problem: undefined, notice: undefined });
    const sessionId = this.deps.sessionId();
    const channel = this.deps.channel();
    if (!sessionId || !channel) {
      this.set({ problem: "Open a chat with this Bot first, then apply." });
      return;
    }
    try {
      // Never `always`: that would switch off Hermes's own cost warning for good.
      const result = (await channel.call("reload.mcp", { session_id: sessionId, confirm: true }, 120_000)) as Row;
      if (result?.status !== "reloaded") {
        this.set({ problem: str(result?.message) ?? "The gateway didn't apply the changes." });
        return;
      }
      const missing = Array.isArray(result.unavailable) ? result.unavailable.filter((n): n is string => typeof n === "string") : [];
      this.set({
        needsApply: false,
        notice: missing.length
          ? `Applied, but these didn't connect: ${missing.join(", ")}.`
          : "Applied. The chat uses these apps from its next message.",
      });
    } catch (error) {
      this.set({ problem: `Couldn't apply the changes: ${describeError(error)}` });
    }
  }

  // Sign-in through the provider's page (OAuth). The gateway runs the flow: it hands back the
  // provider's page, the provider sends the browser back to the gateway's own callback, and the
  // gateway keeps the token. This opens the page and asks how it's going.

  /**
   * Starts signing in to `server`, opens the provider's page with `open`, and waits until the
   * gateway has the token, the flow fails or it's cancelled. Success lists the server's tools.
   */
  async signIn(server: McpServer, open: (url: string) => void): Promise<void> {
    if (server.plugin !== undefined || this.flows.has(server.name)) return;
    this.set({ problem: undefined, notice: undefined });
    this.setSignIn(server.name, { kind: "starting" });
    let flow: Row;
    try {
      // The gateway waits up to 30 s for the provider before it answers.
      flow = (await this.call(`/api/mcp/servers/${encodeURIComponent(server.name)}/auth`, { method: "POST", timeoutMs: 60_000 })) as Row;
    } catch (error) {
      this.setSignIn(server.name, { kind: "failed", message: describeError(error) });
      return;
    }
    if (this.settle(server.name, flow)) return;
    const flowId = str(flow?.flow_id);
    // Cancelled while the gateway was starting it: let the gateway know too.
    if (this.view.signIns[server.name] === undefined) {
      if (flowId) await this.deleteFlow(flowId);
      return;
    }
    if (!flowId) {
      this.setSignIn(server.name, { kind: "failed", message: "The gateway didn't start the sign-in." });
      return;
    }
    this.flows.set(server.name, flowId);
    const page = str(flow.authorization_url);
    if (page && /^https?:\/\//i.test(page)) {
      this.setSignIn(server.name, { kind: "waiting" });
      open(page);
    }
    await this.waitForSignIn(server.name, flowId);
  }

  /** Stops a sign-in that's waiting, here and on the gateway. */
  async cancelSignIn(server: McpServer): Promise<void> {
    this.setSignIn(server.name, undefined);
    const flowId = this.flows.get(server.name);
    this.flows.delete(server.name);
    if (flowId) await this.deleteFlow(flowId);
  }

  private async waitForSignIn(name: string, flowId: string): Promise<void> {
    const deadline = Date.now() + SIGN_IN_LIMIT_MS;
    while (this.flows.get(name) === flowId && Date.now() < deadline) {
      await sleep(this.pollMs);
      if (this.flows.get(name) !== flowId) return;
      try {
        const flow = (await this.deps.request(`/api/mcp/oauth/flows/${encodeURIComponent(flowId)}`)) as Row;
        if (this.settle(name, flow)) return;
        if (flow?.status === "authorization_required" && this.view.signIns[name]?.kind === "starting") {
          this.setSignIn(name, { kind: "waiting" });
        }
      } catch (error) {
        if (isGatewayError(error, "http") && error.code === 404) {
          this.flows.delete(name);
          this.setSignIn(name, { kind: "failed", message: "The sign-in expired. Try again." });
          return;
        }
        // A dropped connection mid-wait isn't the end of the sign-in; ask again.
      }
    }
    if (this.flows.get(name) === flowId) {
      this.flows.delete(name);
      this.setSignIn(name, { kind: "failed", message: "The sign-in expired. Try again." });
    }
  }

  /** Settles a flow that's approved or failed. False while it's still going. */
  private settle(name: string, flow: Row): boolean {
    if (flow?.status === "approved") {
      this.flows.delete(name);
      this.set({
        signIns: { ...this.view.signIns, [name]: undefined },
        checks: { ...this.view.checks, [name]: { kind: "passed", tools: toolsFrom(flow.tools) } },
        notice: `Signed in to “${name}”.`,
      });
      return true;
    }
    if (flow?.status === "error") {
      this.flows.delete(name);
      this.setSignIn(name, { kind: "failed", message: str(flow.error) ?? "The sign-in didn't finish." });
      return true;
    }
    return false;
  }

  private async deleteFlow(flowId: string): Promise<void> {
    await this.deps.request(`/api/mcp/oauth/flows/${encodeURIComponent(flowId)}`, { method: "DELETE" }).catch(() => {});
  }

  /** Keeps reloading for a few minutes until a server being fetched appears. */
  private async waitForInstall(name: string): Promise<void> {
    for (let i = 0; i < 36; i++) {
      await sleep(this.pollMs * 2.5);
      await this.refresh();
      if (this.view.servers.some((s) => s.name === name)) {
        if (this.view.notice?.includes(name)) this.set({ notice: undefined });
        return;
      }
    }
    this.set({ notice: undefined, problem: `“${name}” didn't show up. The gateway may still be fetching it, or it failed there.` });
  }

  /** Clears the notice and problem, say when a form opens. */
  clearMessages(): void {
    this.set({ problem: undefined, notice: undefined });
  }

  private call(route: string, options?: { method?: string; body?: unknown; timeoutMs?: number }): Promise<unknown> {
    return this.deps.request(`${route}?profile=${encodeURIComponent(this.profile)}`, options);
  }

  private replace(name: string, change: Partial<McpServer>): void {
    this.set({ servers: this.view.servers.map((s) => (s.name === name ? { ...s, ...change } : s)) });
  }

  private setCheck(name: string, check: McpCheck | undefined): void {
    this.set({ checks: { ...this.view.checks, [name]: check } });
  }

  private setSignIn(name: string, signIn: McpSignIn | undefined): void {
    this.set({ signIns: { ...this.view.signIns, [name]: signIn } });
  }

  private set(change: Partial<McpView>): void {
    this.view = { ...this.view, ...change };
    for (const listener of this.listeners) listener();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
