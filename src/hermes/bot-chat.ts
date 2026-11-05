import { GatewayError, isGatewayError } from "./gateway-error";
import type { JsonRpcChannel, ServerRequest } from "./json-rpc-channel";
import type { HistoryMessage, InflightTurn } from "./transcript";

export const BOT_CHAT_TITLE = "Bot Chat";

export interface OpenedChat {
  /** The live session ID: what `prompt.submit` takes and gateway events carry. */
  sessionId: string;
  history: HistoryMessage[];
  running: boolean;
  /** The history was too long for the gateway to send, so only new messages show. */
  historyOmitted: boolean;
  inflight?: InflightTurn;
  /** Questions the gateway asked earlier and still waits on. */
  openRequests: ServerRequest[];
  /** Apps the Bot is waiting for you to connect (a `connection.request` payload), while it waits. */
  pendingConnection?: unknown;
}

type Rpc = Pick<JsonRpcChannel, "call">;
type Row = Record<string, unknown>;

/**
 * Opens a profile's one long-lived conversation, the hidden session titled exactly "Bot Chat".
 * Mirrors the official app: the chat is found by its exact title, a failed lookup is an error rather
 * than a reason to create one, and a chat is only created when the gateway says none exists.
 * Creating a second Bot Chat would split the agent's conversation in two.
 *
 * `knownId` is the Bot Chat ID from the roster, when the gateway reported one.
 */
export async function openBotChat(profile: string, knownId: string | undefined, channel: Rpc): Promise<OpenedChat> {
  const target = knownId ?? (await findBotChat(profile, channel));
  if (target) return resumeBotChat(profile, target, channel);
  return createBotChat(profile, channel);
}

async function findBotChat(profile: string, channel: Rpc): Promise<string | undefined> {
  const result = (await channel.call("session.list", { profile, title: BOT_CHAT_TITLE, include_hidden: true })) as Row;
  const rows = result?.sessions;
  if (!Array.isArray(rows) || rows.length === 0) return undefined;
  const row = rows[0] as Row;
  return (typeof row.resolved_id === "string" && row.resolved_id) || (typeof row.id === "string" ? row.id : undefined);
}

async function resumeBotChat(profile: string, sessionId: string, channel: Rpc): Promise<OpenedChat> {
  let omitted = false;
  let result: Row;
  try {
    result = (await channel.call("session.resume", { profile, session_id: sessionId })) as Row;
  } catch (error) {
    // The gateway refuses to send a transcript over its size limit; attach without it.
    if (!isGatewayError(error, "rpc") || error.code !== 4130) throw error;
    result = (await channel.call("session.resume", { profile, session_id: sessionId, omit_messages: true })) as Row;
    omitted = true;
  }
  if (typeof result?.session_id !== "string") throw new GatewayError("invalidResponse");

  const openRequests = (Array.isArray(result.open_requests) ? (result.open_requests as Row[]) : []).flatMap(
    (entry): ServerRequest[] =>
      typeof entry?.id === "string" && typeof entry.method === "string"
        ? [{ id: entry.id, method: entry.method, params: (entry.params ?? {}) as Record<string, unknown> }]
        : [],
  );
  const turn = result.inflight as Row | undefined;
  const inflight =
    turn && typeof turn === "object"
      ? {
          user: typeof turn.user === "string" ? turn.user : "",
          assistant: typeof turn.assistant === "string" ? turn.assistant : "",
          displayKind: typeof turn.display_kind === "string" ? turn.display_kind : undefined,
          displayText: (turn.display_metadata as Row | undefined)?.display_text as string | undefined,
        }
      : undefined;
  return {
    sessionId: result.session_id,
    history: Array.isArray(result.messages) ? (result.messages as HistoryMessage[]) : [],
    running: result.running === true,
    historyOmitted: omitted || result.messages_omitted === true,
    inflight,
    openRequests,
    pendingConnection: result.pending_connection ?? undefined,
  };
}

async function createBotChat(profile: string, channel: Rpc): Promise<OpenedChat> {
  const created = (await channel.call("session.create", {
    profile,
    title: BOT_CHAT_TITLE,
    hidden: true,
    follow_profile_config: true,
  })) as Row;
  if (typeof created?.session_id !== "string") throw new GatewayError("invalidResponse");
  try {
    // Title it now so the row exists and the next lookup finds it.
    await channel.call("session.title", { session_id: created.session_id, title: BOT_CHAT_TITLE });
  } catch (error) {
    if (!isGatewayError(error, "rpc") || error.code !== 4022) throw error;
    // Another client created the Bot Chat meanwhile: adopt that one.
    const existing = await findBotChat(profile, channel);
    if (!existing) throw new GatewayError("invalidResponse");
    return resumeBotChat(profile, existing, channel);
  }
  return { sessionId: created.session_id, history: [], running: false, historyOmitted: false, openRequests: [] };
}
