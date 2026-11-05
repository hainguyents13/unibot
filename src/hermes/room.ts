import { AlertSource, alertPreview } from "./alerts";
import { describeError, GatewayError } from "./gateway-error";
import type { JsonRpcChannel } from "./json-rpc-channel";
import { approvalNotice, shortCommand, type ApprovalPrompt } from "./requests";
import { friendlyName } from "./roster";
import type { ItemContent, TranscriptItem } from "./transcript";
import type { BotStatus } from "./types";

type Row = Record<string, unknown>;
type Rpc = Pick<JsonRpcChannel, "call">;

const str = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value.trim() : undefined);

/** A Bot seated in a room. */
export interface RoomMember {
  /** The room's own ID for this member; room events name members by it. */
  id: string;
  /** The Hermes profile behind the member, when it lives on this gateway. */
  profile?: string;
  /** What you @mention it as. */
  handle: string;
  displayName?: string;
}

/** One row of `groups.list`: a room hosted on this gateway. */
export interface RoomSummary {
  id: string;
  name: string;
  members: RoomMember[];
  /** Milliseconds since the epoch. */
  updatedAt: number;
  /** Sequence number of the newest event; `0` for an empty log. */
  latestSeq: number;
}

export function memberFrom(value: unknown): RoomMember | undefined {
  const row = value as Row;
  const profile = str(row?.profile);
  const id = str(row?.member_id) ?? profile;
  if (!id) return undefined;
  return { id, profile, handle: str(row.handle) ?? profile ?? id, displayName: str(row.display_name) };
}

export function roomSummaryFrom(value: unknown): RoomSummary | undefined {
  const row = value as Row;
  const id = str(row?.room_id);
  if (!id || (row.disbanded_at !== undefined && row.disbanded_at !== null)) return undefined;
  return {
    id,
    name: str(row.name) ?? "Room",
    members: (Array.isArray(row.members) ? row.members : []).flatMap((m) => memberFrom(m) ?? []),
    updatedAt: typeof row.updated_at === "number" ? row.updated_at * 1000 : 0,
    latestSeq: typeof row.latest_seq === "number" ? row.latest_seq : 0,
  };
}

/** The gateway seats two to six Bots in a room. */
export const ROOM_SEATS = { min: 2, max: 6 } as const;

/**
 * Creates a room seating `profiles` (Bots on this gateway) and returns it as `groups.list` would.
 * Each is seated as the official app seats them: you @mention it by its profile name.
 */
export async function createRoom(channel: Rpc, name: string, profiles: string[]): Promise<RoomSummary> {
  // The gateway checks these exact member fields.
  const members = profiles.map((profile) => ({ member_id: profile, profile, handle: profile, target: { kind: "local", profile } }));
  const result = (await channel.call("groups.create", { room_id: crypto.randomUUID(), name: name.trim(), members })) as Row;
  const summary = roomSummaryFrom(result?.room);
  if (!summary) throw new Error("The gateway didn't send the new room back.");
  return summary;
}

/** A room name made from its Bots, as "Forge, Atlas & Scribe". */
export function suggestedRoomName(names: string[]): string {
  if (names.length < 2) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

/** Why a room can't be made yet with `picked` of `available` Bots, or undefined when it can. */
export function seatsNote(picked: number, available: number): string | undefined {
  if (available === 0) return "A room needs at least two Bots, and this gateway has none yet.";
  if (available < ROOM_SEATS.min) return "A room needs at least two Bots, and this gateway has one. Make another in the Hermes app first.";
  if (picked === 0) return "Pick two to six Bots.";
  if (picked === 1) return "Pick one more Bot.";
  return undefined;
}

/** One event from a room's log (`groups.log`). */
interface RoomEvent {
  seq: number;
  id: string;
  kind: string;
  actorId?: string;
  payload: Row;
  /** Milliseconds since the epoch, or undefined when the gateway didn't say. */
  createdAt?: number;
}

function eventFrom(value: unknown): RoomEvent | undefined {
  const row = value as Row;
  if (typeof row?.seq !== "number" || typeof row.kind !== "string") return undefined;
  const actor = row.actor as Row | undefined;
  return {
    seq: row.seq,
    id: str(row.event_id) ?? `seq-${row.seq}`,
    kind: row.kind,
    actorId: str(actor?.id),
    payload: (row.payload ?? {}) as Row,
    createdAt: typeof row.created_at === "number" ? row.created_at * 1000 : undefined,
  };
}

/** `@handle` words, matching the gateway's own mention rule. */
export function mentions(text: string): string[] {
  return [...text.matchAll(/@([A-Za-z0-9][A-Za-z0-9._:-]*)/g)].map((m) => m[1]);
}

/** Everything a room shows, built from its event log in sequence order. */
export class RoomState {
  items: TranscriptItem[] = [];
  /** The last applied sequence number; the next `groups.log` reads after it. */
  cursor = 0;
  /** Event IDs seen, to recognise your messages when they come back in the log. */
  readonly seenEventIds = new Set<string>();
  private nextId = 0;

  constructor(public members: RoomMember[]) {}

  /** The name a member shows. */
  name(memberId: string): string {
    const member = this.members.find((m) => m.id === memberId);
    if (!member) return memberId;
    return member.displayName ?? friendlyName(member.profile ?? member.handle);
  }

  /** Applies events after `cursor`, in order; anything at or before it was applied already. */
  apply(events: RoomEvent[]): void {
    for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
      if (event.seq <= this.cursor) continue;
      this.applyOne(event);
      this.cursor = event.seq;
    }
  }

  addNotice(text: string): void {
    this.append({ kind: "notice", text });
  }

  private applyOne(event: RoomEvent): void {
    this.seenEventIds.add(event.id);
    const p = event.payload;
    const date = event.createdAt ?? Date.now();
    const notice = (text: string) => this.append({ kind: "notice", text }, date);
    const who = () => this.name(str(p.member_id) ?? event.actorId ?? "") || "A Bot";
    switch (event.kind) {
      case "message.user": {
        const text = str(p.text);
        if (text) this.append({ kind: "user", text }, date);
        return;
      }
      case "message.member": {
        const text = str(p.text);
        if (!text) return;
        const author = str(p.member_id) ?? event.actorId ?? "";
        this.append({ kind: "member", memberId: author, text }, date);
        const handedTo = this.mentioned(text, author);
        if (handedTo.length) notice(`${this.name(author)} handed off to ${handedTo.map((id) => this.name(id)).join(", ")}`);
        return;
      }
      case "turn.failed": {
        const error = str(p.error);
        notice(error ? `${who()} couldn't answer: ${error}` : `${who()} couldn't answer`);
        return;
      }
      case "turn.cancelled": {
        if (!str(p.member_id)) return;
        const reason = str(p.reason);
        notice(reason ? `${who()} stopped: ${reason}` : `${who()} stopped`);
        return;
      }
      case "turn.deferred": {
        const reason = str(p.reason);
        notice(reason ? `${who()}’s turn was put off: ${reason}` : `${who()}’s turn was put off`);
        return;
      }
      case "room.activity":
        if (p.status !== "bounded") return;
        if (p.reason_code === "max_rounds") notice("The discussion reached its round limit");
        else if (p.reason_code === "max_messages") notice("The discussion reached its message limit");
        else notice("The room reached its work limit");
        return;
      case "room.stop_requested":
        return notice("Everyone was stopped");
      case "authority.lost":
        return notice("Another gateway now hosts this room");
      case "member.unavailable":
        return notice(`${who()} is unavailable`);
      case "room.renamed": {
        const name = str(p.name);
        if (name) notice(`Room renamed to “${name}”`);
        return;
      }
      case "room.members_changed":
        if (Array.isArray(p.members)) this.members = p.members.flatMap((m) => memberFrom(m) ?? []);
        return notice("Members changed");
      case "room.disbanded":
        return notice("This room was closed");
      // turn.started/settled/reassigned and the like only move what the room's status reports.
    }
  }

  /** Members @mentioned in a reply, in room order: the gateway routes the next round to them. */
  private mentioned(text: string, author: string): string[] {
    const handles = new Set(mentions(text).map((h) => h.toLowerCase()));
    if (handles.has("all") || handles.has("everyone")) return this.members.map((m) => m.id).filter((id) => id !== author);
    return this.members.filter((m) => handles.has(m.handle.toLowerCase()) && m.id !== author).map((m) => m.id);
  }

  private append(content: ItemContent, date = Date.now()): void {
    this.items.push({ id: this.nextId++, content, date });
  }
}

/** A room Bot waiting for your OK on a command (`groups.state` → `pending_actions`). */
export interface RoomApproval {
  memberId: string;
  taskId: string;
  executionGeneration: number;
  prompt: ApprovalPrompt;
}

function roomApprovalFrom(value: unknown): RoomApproval | undefined {
  const action = value as Row;
  const approval = (action?.approval ?? {}) as Row;
  const memberId = str(action?.member_id);
  const taskId = str(action?.task_id);
  const requestId = str(action?.request_id) ?? str(approval.request_id);
  if (action?.kind !== "approval" || !memberId || !taskId || typeof action.execution_generation !== "number" || !requestId) {
    return undefined;
  }
  // The room service only accepts "once" and "deny".
  const offered = Array.isArray(approval.choices) ? approval.choices.filter((c) => c === "once" || c === "deny") : [];
  return {
    memberId,
    taskId,
    executionGeneration: action.execution_generation,
    prompt: {
      kind: "approval",
      id: requestId,
      sessionId: str(action.session_id) ?? "",
      command: str(approval.command) ?? "",
      description: str(approval.description) ?? "",
      choices: offered.length ? (offered as ApprovalPrompt["choices"]) : ["once", "deny"],
    },
  };
}

/** What a room view shows. A new object after every change. */
export interface RoomView {
  phase: { kind: "loading" } | { kind: "ready" } | { kind: "failed"; message: string };
  name: string;
  members: RoomMember[];
  items: TranscriptItem[];
  /** Members answering right now. */
  working: string[];
  isBusy: boolean;
  approvals: RoomApproval[];
  /** Turns that stopped partway and can be run again, by task ID. */
  retries: string[];
  /** Your messages sent but not back in the log yet. */
  pending: string[];
  /** A message that didn't send, for the message box to take back. */
  unsent?: string;
  /** Whether the gateway's room service runs; rooms can't be used without it. */
  driverRunning: boolean;
  canSend: boolean;
}

/**
 * One room: its transcript, who is answering, the approvals its Bots wait on, and sending. Rooms
 * push nothing, so `sync()` reads the log after the last event it has, then the room's status. The
 * room view calls it every 2 s while it's on screen; the app calls it when the list shows new events.
 */
export class RoomThread {
  private state: RoomState;
  private phase: RoomView["phase"] = { kind: "loading" };
  private working: string[] = [];
  private isBusy = false;
  private approvals: RoomApproval[] = [];
  private retries: string[] = [];
  private pending: Array<{ clientId: string; text: string; eventId: string }> = [];
  private unsent: string | undefined;
  private driverRunning = true;
  private syncing = false;
  /** The demo has no gateway: what you send shows at once, and nobody answers. */
  private demo = false;
  /** Replies and requests, for notifications. */
  readonly alerts = new AlertSource();
  private view: RoomView;
  private readonly listeners = new Set<() => void>();

  constructor(
    readonly id: string,
    private name: string,
    members: RoomMember[],
    private readonly channel: () => Rpc | undefined,
  ) {
    this.state = new RoomState(members);
    this.view = this.snapshot();
  }

  /** A room already showing `events`, for the demo and tests. */
  static withEvents(summary: RoomSummary, events: unknown[], status?: Row): RoomThread {
    const room = new RoomThread(summary.id, summary.name, summary.members, () => undefined);
    room.demo = true;
    room.state.apply(events.flatMap((e) => eventFrom(e) ?? []));
    if (status) room.readStatus({ driver_status: status });
    room.phase = { kind: "ready" };
    room.changed();
    return room;
  }

  getView = (): RoomView => this.view;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  get cursor(): number {
    return this.state.cursor;
  }

  get status(): BotStatus {
    if (this.approvals.length || this.retries.length) return "needsYou";
    return this.isBusy || this.pending.length ? "working" : "idle";
  }

  /** The newest message, for the sidebar. */
  latestMessage(): { text: string; date: number } | undefined {
    for (let i = this.state.items.length - 1; i >= 0; i--) {
      const { content, date } = this.state.items[i];
      if (content.kind === "user") return { text: content.text, date: date ?? 0 };
      if (content.kind === "member") return { text: `${this.state.name(content.memberId)}: ${content.text}`, date: date ?? 0 };
    }
    return undefined;
  }

  memberName = (memberId: string): string => this.state.name(memberId);

  /** Reads new events and the room's status. Safe to call often; overlapping calls are skipped. */
  async sync(): Promise<void> {
    const channel = this.channel();
    if (this.syncing || !channel) return;
    this.syncing = true;
    try {
      // The first read sets the baseline: replies from before this app saw the room aren't news.
      const firstRead = this.phase.kind !== "ready";
      const itemsBefore = this.state.items.length;
      let more = true;
      while (more) {
        const page = (await channel.call("groups.log", { room_id: this.id, since_seq: this.cursor, limit: 200 })) as Row;
        const events = (Array.isArray(page?.events) ? page.events : []).flatMap((e) => eventFrom(e) ?? []);
        this.state.apply(events);
        more = page?.has_more === true && events.length > 0;
      }
      this.pending = this.pending.filter((p) => !this.state.seenEventIds.has(p.eventId));
      this.readStatus((await channel.call("groups.state", { room_id: this.id })) as Row);
      this.phase = { kind: "ready" };
      const reply = firstRead ? undefined : this.state.items.slice(itemsBefore).findLast((i) => i.content.kind === "member");
      if (reply?.content.kind === "member") {
        this.alerts.emit({ kind: "reply", text: `${this.state.name(reply.content.memberId)}: ${alertPreview(reply.content.text)}` });
      }
      for (const approval of this.approvals) {
        this.alerts.announce(approval.prompt.id, `${this.state.name(approval.memberId)} wants to run “${shortCommand(approval.prompt.command)}”`);
      }
      for (const taskId of this.retries) this.alerts.announce(taskId, "A reply stopped partway. Open the room to try again.");
    } catch (error) {
      if (this.phase.kind !== "ready") this.phase = { kind: "failed", message: describeError(error) };
    } finally {
      this.syncing = false;
      this.changed();
    }
  }

  private readStatus(result: Row): void {
    const room = result?.room as Row | undefined;
    if (Array.isArray(room?.members)) {
      const members = room.members.flatMap((m) => memberFrom(m) ?? []);
      if (members.length) this.state.members = members;
    }
    // The gateway leaves the status out when its room service isn't running.
    const status = result?.driver_status as Row | undefined;
    if (!status) {
      this.driverRunning = false;
      this.working = [];
      this.isBusy = false;
      this.approvals = [];
      this.retries = [];
      return;
    }
    this.driverRunning = status.running !== false;
    // Queued turns wait behind another; only running ones are replying.
    const activity = Array.isArray(status.member_activity) ? (status.member_activity as Row[]) : [];
    this.working = activity.filter((a) => a?.status !== "queued").flatMap((a) => str(a?.member_id) ?? []);
    this.isBusy = this.working.length > 0 || status.working === true;
    const actions = Array.isArray(status.pending_actions) ? (status.pending_actions as Row[]) : [];
    this.approvals = actions.flatMap((a) => roomApprovalFrom(a) ?? []);
    this.retries = actions.filter((a) => a?.kind === "retry").flatMap((a) => str(a?.task_id) ?? []);
  }

  get canSend(): boolean {
    return this.phase.kind === "ready" && this.driverRunning && (this.demo || this.channel() !== undefined);
  }

  /** Sends a message to the room. Without @mentions every member answers; with them, only those named. */
  async send(input: string): Promise<void> {
    const text = input.trim();
    if (this.demo && text) {
      this.state.apply([{ seq: this.cursor + 1, id: `demo-${this.cursor + 1}`, kind: "message.user", payload: { text } }]);
      return this.changed();
    }
    const channel = this.channel();
    if (!this.canSend || !text || !channel) return;
    const clientId = crypto.randomUUID();
    // Shown at once; the ID it comes back under is filled in when the hash is ready.
    const entry = { clientId, text, eventId: "" };
    this.pending = [...this.pending, entry];
    this.unsent = undefined;
    this.changed();
    entry.eventId = await userEventId(clientId);
    try {
      await channel.call("groups.send", { room_id: this.id, event_id: clientId, payload: { text, thread_id: clientId } });
      await this.sync();
    } catch (error) {
      this.pending = this.pending.filter((p) => p.clientId !== clientId);
      this.unsent = text;
      this.state.addNotice(`Your message didn't send, so it's back in the message box: ${describeError(error)}`);
      this.changed();
    }
  }

  /** Hands over a message that didn't send, once. */
  takeUnsent(): string | undefined {
    const text = this.unsent;
    this.unsent = undefined;
    if (text !== undefined) this.changed();
    return text;
  }

  /** Asks every Bot in the room to stop. */
  stop(): Promise<void> {
    return this.act("groups.stop", { room_id: this.id, cancel_id: `unibot-${crypto.randomUUID()}` });
  }

  /** Answers a Bot's approval request. Rooms offer only "once" and "deny". */
  answer(approval: RoomApproval, choice: "once" | "deny"): Promise<void> {
    this.approvals = this.approvals.filter((a) => a.prompt.id !== approval.prompt.id);
    this.state.addNotice(approvalNotice(choice, shortCommand(approval.prompt.command)));
    this.changed();
    return this.act("groups.approve", {
      room_id: this.id,
      member_id: approval.memberId,
      task_id: approval.taskId,
      execution_generation: approval.executionGeneration,
      choice,
      request_id: approval.prompt.id,
    });
  }

  /** Runs a turn that stopped partway again. */
  retry(taskId: string): Promise<void> {
    this.retries = this.retries.filter((t) => t !== taskId);
    this.changed();
    return this.act("groups.retry", { room_id: this.id, task_id: taskId }, "The reply wasn't tried again");
  }

  /**
   * Gives up on a turn that stopped partway. The dashboard socket has no `groups.discard`, so this
   * is `groups.stop`, which also stops any other turn running or waiting in the room.
   */
  dismiss(taskId: string): Promise<void> {
    this.retries = this.retries.filter((t) => t !== taskId);
    this.changed();
    return this.act("groups.stop", { room_id: this.id, cancel_id: `unibot-${crypto.randomUUID()}` }, "The reply wasn't dismissed");
  }

  /** Renames the room for everyone in it. Throws, keeping the old name, when the gateway refuses. */
  async rename(name: string): Promise<void> {
    if (!this.demo) {
      const channel = this.channel();
      if (!channel) throw new GatewayError("disconnected");
      // A fresh event ID makes a repeated request harmless.
      await channel.call("groups.rename", { room_id: this.id, event_id: crypto.randomUUID(), name });
    }
    this.adoptName(name);
  }

  /** Takes the name the gateway lists. */
  adoptName(name: string): void {
    if (name === this.name) return;
    this.name = name;
    this.changed();
  }

  /** Stops the room and deletes it and its messages for good. Its Bots and their chats stay. */
  async disband(): Promise<void> {
    if (this.demo) return;
    const channel = this.channel();
    if (!channel) throw new GatewayError("disconnected");
    await channel.call("groups.disband", { room_id: this.id, cancel_id: `unibot-${crypto.randomUUID()}` });
  }

  private async act(method: string, params: Row, failure?: string): Promise<void> {
    const channel = this.channel();
    if (!channel) return;
    try {
      await channel.call(method, params);
    } catch (error) {
      this.state.addNotice(failure ? `${failure}: ${describeError(error)}` : describeError(error));
      this.changed();
    }
    await this.sync();
  }

  private snapshot(): RoomView {
    return {
      phase: this.phase,
      name: this.name,
      members: this.state.members,
      items: [...this.state.items],
      working: this.working,
      isBusy: this.isBusy,
      approvals: this.approvals,
      retries: this.retries,
      pending: this.pending.map((p) => p.text),
      unsent: this.unsent,
      driverRunning: this.driverRunning,
      canSend: this.canSend,
    };
  }

  private changed(): void {
    this.view = this.snapshot();
    for (const listener of this.listeners) listener();
  }
}

/** The gateway files a user message under `user:` + SHA-256 of the client's event ID. */
export async function userEventId(clientId: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(clientId)));
  return `user:${[...digest].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}
