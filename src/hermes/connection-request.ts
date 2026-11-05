type Row = Record<string, unknown>;
const str = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value.trim() : undefined);

/**
 * One app in a connection request: a hosted connector (`connector`, signed in to on the vendor's
 * page through the Nous Portal), an MCP server on the gateway (`mcp`), or a catalog plugin or skill
 * and anything newer (`other`), which is answered in the Hermes app.
 */
export interface ConnectionTarget {
  /** Hermes's slug for the app, e.g. `gmail`, or the MCP server's name. */
  name: string;
  kind: "connector" | "mcp" | "other";
  /** `connect`, `reconnect`, `authorize`, `install` or `enable`. */
  action: string;
  state: "pending" | "initiated" | "connected" | "skipped" | "failed" | "expired" | "not_connected";
  /** The vendor's or the gateway's words about the last attempt. */
  detail?: string;
  /** Setup notes from the catalog, for an MCP server. */
  instructions?: string;
  connectUrl?: string;
  /** An MCP install that still needs credentials typed in. */
  needsCredentials: boolean;
  title: string;
}

const STATES: ConnectionTarget["state"][] = ["pending", "initiated", "connected", "skipped", "failed", "expired", "not_connected"];

/** `google_drive` → "Google Drive". Hermes's catalog names are slugs. */
export function appTitle(name: string): string {
  return name
    .split(/[_-]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function targetFrom(value: unknown): ConnectionTarget | undefined {
  const row = value as Row;
  const name = str(row?.name);
  if (!name) return undefined;
  const kind = row.kind === "connector" || row.kind === "mcp" ? row.kind : "other";
  const state = STATES.find((s) => s === row.state) ?? "pending";
  const url = str(row.connect_url);
  return {
    name,
    kind,
    action: str(row.action) ?? "connect",
    state,
    detail: str(row.detail),
    instructions: str(row.instructions),
    connectUrl: url && /^https?:\/\//i.test(url) ? url : undefined,
    needsCredentials: Array.isArray(row.required_env) && row.required_env.length > 0,
    title: str(row.display) ?? appTitle(name),
  };
}

/** Connected or skipped: nothing more to do. */
export const isResolved = (t: ConnectionTarget) => t.state === "connected" || t.state === "skipped";

/** What you can do about an app here. */
export type Offer =
  /** Open its sign-in page. */
  | { kind: "signIn"; url: string }
  /** Tell Hermes to go ahead (an MCP install or switch-on that needs nothing typed). */
  | { kind: "approve" }
  /** Start again after a failure or an expired link. */
  | { kind: "retry" }
  /** Hermes is still getting the sign-in page. */
  | { kind: "preparing" }
  /** It needs something this app doesn't ask for, such as an API key or a plugin review. */
  | { kind: "elsewhere" }
  /** Connected, skipped or over. */
  | { kind: "none" };

export function offerFor(t: ConnectionTarget): Offer {
  switch (t.state) {
    case "connected":
    case "skipped":
    case "not_connected":
      return { kind: "none" };
    case "failed":
    case "expired":
      return t.kind === "other" || t.needsCredentials ? { kind: "elsewhere" } : { kind: "retry" };
    default:
      if (t.kind === "other" || t.needsCredentials) return { kind: "elsewhere" };
      if (t.connectUrl) return { kind: "signIn", url: t.connectUrl };
      if (t.kind === "mcp" && t.state === "pending" && (t.action === "install" || t.action === "enable")) return { kind: "approve" };
      return { kind: "preparing" };
  }
}

/** Why the request ended (`settled_by`). */
export type Ending = "all_resolved" | "continue" | "deadline" | "interrupt";

/**
 * The Bot asked to connect apps (Hermes's `manage_connections`). Hermes keeps one of these open per
 * chat and holds the Bot's turn until every app is connected or skipped, you go on without the rest,
 * the reply is stopped, or five minutes pass. Whether an app connected is Hermes's to report.
 */
export interface ConnectionRequest {
  /** Hermes's operation ID (`op_id`). */
  id: string;
  sessionId: string;
  /** The newest frame applied. Frames can arrive out of order; an older one changes nothing. */
  seq: number;
  targets: ConnectionTarget[];
  /**
   * A list of apps to pick from (`display`), with these suggested. It has no rows of its own: apps
   * are connected from the Bot's Apps panel, and Done tells the Bot you've finished.
   */
  suggested?: string[];
  ending?: Ending;
}

/** Reads a `connection.request` payload, or the `pending_connection` a chat brings back on attach. */
export function connectionRequestFrom(payload: unknown, sessionId: string): ConnectionRequest | undefined {
  const row = payload as Row;
  const id = str(row?.op_id);
  if (!id) return undefined;
  const targets = (Array.isArray(row.targets) ? row.targets : []).flatMap((t) => targetFrom(t) ?? []);
  const display = row.display as Row | undefined;
  const suggested =
    display && typeof display === "object"
      ? (Array.isArray(display.suggested) ? display.suggested : []).filter((n): n is string => typeof n === "string").map(appTitle)
      : undefined;
  // A request for nothing would have nothing to answer.
  if (!targets.length && !suggested) return undefined;
  return { id, sessionId, seq: typeof row.seq === "number" ? row.seq : 0, targets, suggested, ending: endingFrom(row) };
}

function endingFrom(row: Row): Ending | undefined {
  const settled = row.settled === true || (row.settled_at !== undefined && row.settled_at !== null);
  if (!settled) return undefined;
  const by = row.settled_by;
  return by === "continue" || by === "deadline" || by === "interrupt" || by === "all_resolved" ? by : "all_resolved";
}

/**
 * Applies a `connection.update` frame, or the snapshot `connectors.connect` answers with. Every frame
 * carries all the apps; one for another request, or older than what's shown, changes nothing.
 */
export function applyFrame(request: ConnectionRequest, payload: unknown): ConnectionRequest | undefined {
  const row = payload as Row;
  if (row?.op_id !== request.id || typeof row.seq !== "number" || row.seq <= request.seq) return undefined;
  let targets = request.targets;
  if (Array.isArray(row.targets)) {
    // An account request's frames leave the link out; keep the one already held.
    targets = row.targets.flatMap((t) => {
      const target = targetFrom(t);
      if (!target) return [];
      if (!target.connectUrl && target.state === "initiated") {
        target.connectUrl = request.targets.find((old) => old.name === target.name)?.connectUrl;
      }
      return [target];
    });
  }
  return { ...request, seq: row.seq, targets, ending: endingFrom(row) ?? request.ending };
}

/** The apps still waiting for you. */
export function openTargets(request: ConnectionRequest): ConnectionTarget[] {
  return request.targets.filter((t) => !isResolved(t) && t.state !== "not_connected");
}

// Answers

const sessionOwner = (request: ConnectionRequest) => ({ type: "session", session_id: request.sessionId });

/** `connection.respond`'s parameters: the request it answers, and `result`. */
export function respondParams(request: ConnectionRequest, result: unknown): Row {
  return { owner: sessionOwner(request), op_id: request.id, result };
}

/** Not now for every app still open. */
export function skipAnswer(request: ConnectionRequest): Row {
  return { targets: openTargets(request).map((t) => ({ name: t.name, status: "skipped" })) };
}

/** Go ahead with one app: an MCP install or switch-on, or running a failed one again. */
export function approveAnswer(name: string): Row {
  return { targets: [{ name, status: "approved" }] };
}

/** Done, on a list of apps. */
export const continueAnswer = { settled_by: "continue" };

/** `connectors.connect` asking Hermes for a fresh link for a hosted app that failed or expired. */
export function retryParams(request: ConnectionRequest, name: string): Row {
  return { owner: sessionOwner(request), connectors: [name], reconnect: true };
}

// Words

const list = (names: string[]) => new Intl.ListFormat("en", { type: "conjunction" }).format(names);

/** What the chat says once the request is over: one line per outcome. */
export function endNotices(request: ConnectionRequest): string[] {
  if (request.suggested) return request.ending === "deadline" ? ["The list of apps closed after 5 minutes."] : [];
  const names = (states: ConnectionTarget["state"][]) => list(request.targets.filter((t) => states.includes(t.state)).map((t) => t.title));
  const lines: string[] = [];
  const connected = names(["connected"]);
  if (connected) lines.push(`You connected ${connected}`);
  const skipped = names(["skipped"]);
  if (skipped) lines.push(`You chose Not now for ${skipped}`);
  const left = names(["not_connected", "pending", "initiated", "failed", "expired"]);
  if (left) {
    if (request.ending === "deadline") lines.push(`Nobody finished connecting ${left} in time.`);
    else if (request.ending === "interrupt") lines.push(`${left} didn't connect: the reply was stopped.`);
    else lines.push(`You went on without ${left}.`);
  }
  return lines;
}

/** What a notification says while the request waits. */
export function connectionAlertText(request: ConnectionRequest): string {
  if (request.suggested) return "Wants you to connect apps";
  return `Wants to connect ${list(request.targets.map((t) => t.title))}`;
}
