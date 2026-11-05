import { gatewayTurnContent } from "./gateway-turn";
import type { GatewayEvent } from "./json-rpc-channel";

export interface ToolStep {
  id: string;
  name: string;
  /** A short argument preview from the gateway, e.g. a file path or command. */
  context: string;
  summary?: string;
  durationSeconds?: number;
  state: "running" | "done" | "failed";
  /** How far a long step has got, when the tool says. */
  progress?: string;
}

export type ItemContent =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  /** Consecutive tool calls, shown as one collapsible line. */
  | { kind: "activity"; steps: ToolStep[] }
  /** A centred system line, e.g. "Stopped" or an error. */
  | { kind: "notice"; text: string }
  /** Work Hermes finished on its own: a title, and what it reported for anyone who wants to look. */
  | { kind: "result"; title: string; detail: string }
  /** What a Hermes command printed, laid out for a terminal (tables, aligned columns). */
  | { kind: "output"; text: string }
  /** A reply in a room from the member with this room member ID. */
  | { kind: "member"; memberId: string; text: string };

export interface TranscriptItem {
  id: number;
  content: ItemContent;
  /** Milliseconds since the epoch; the gateway's time for history, arrival time for the rest. */
  date?: number;
}

/** A message from `session.resume`: the gateway's display projection of the stored history. */
export interface HistoryMessage {
  role: string;
  text?: string | null;
  name?: string | null;
  context?: string | null;
  tool_call_id?: string | null;
  /** Unix seconds. */
  timestamp?: number | null;
  display_kind?: string | null;
  display_metadata?: { display_text?: string | null } | null;
}

/** A turn the gateway was still running when the app attached: the prompt and the reply so far. */
export interface InflightTurn {
  user: string;
  assistant: string;
  displayKind?: string;
  displayText?: string;
}

type Payload = Record<string, unknown>;

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value : undefined;

/**
 * Everything a chat shows, built from history and then advanced by live gateway events.
 * Items are replaced rather than changed, so a view can tell which ones moved.
 */
export class Transcript {
  items: TranscriptItem[] = [];
  /** The reply streaming in right now. It becomes an assistant item when the turn moves on or ends. */
  draft = "";
  isRunning = false;
  private nextId = 0;
  /** `items.length` when the current turn started, to tell whether the turn has replied yet. */
  private turnStart = 0;
  /** Notices Hermes can replace or take back, by its key. */
  private readonly keyedNotices = new Map<string, number>();

  static fromHistory(history: HistoryMessage[], running: boolean, inflight?: InflightTurn): Transcript {
    const t = new Transcript();
    for (const message of history) {
      const date = typeof message.timestamp === "number" ? message.timestamp * 1000 : undefined;
      if (message.role === "user") {
        const body = text(message.text);
        if (body) {
          t.append(
            gatewayTurnContent(body, message.display_kind ?? undefined, message.display_metadata?.display_text ?? undefined),
            date,
          );
        }
      } else if (message.role === "assistant") {
        const body = text(message.text);
        if (body) t.append({ kind: "assistant", text: body }, date);
      } else if (message.role === "tool") {
        t.addStep(
          { id: message.tool_call_id ?? `history-${t.nextId}`, name: message.name ?? "tool", context: message.context ?? "", state: "done" },
          date,
        );
      }
    }
    t.isRunning = running;
    t.turnStart = t.items.length;
    if (running && inflight) {
      // The running turn's prompt may not be in the stored history yet.
      if (text(inflight.user)) {
        const prompt = gatewayTurnContent(inflight.user, inflight.displayKind, inflight.displayText);
        const last = t.items.at(-1)?.content;
        if (JSON.stringify(last) !== JSON.stringify(prompt)) {
          t.append(prompt);
          t.turnStart = t.items.length;
        }
      }
      t.draft = inflight.assistant;
    }
    return t;
  }

  /** Shows your message right away, before the gateway confirms the turn. */
  sendLocally(message: string): void {
    this.sealDraft();
    this.append({ kind: "user", text: message });
    this.isRunning = true;
    this.turnStart = this.items.length;
  }

  /** Shows a message sent while the agent works. The turn keeps running and reads it as guidance. */
  steerLocally(message: string): void {
    this.sealDraft();
    this.append({ kind: "user", text: message });
  }

  /** The gateway accepted a new turn without a local echo first (a steer that arrived too late). */
  beginTurn(): void {
    this.isRunning = true;
    this.turnStart = this.items.length;
  }

  addNotice(message: string): void {
    this.sealDraft();
    this.append({ kind: "notice", text: message });
  }

  /** Shows a command you ran that answers with output instead of a turn. */
  showCommand(command: string): void {
    this.sealDraft();
    this.append({ kind: "user", text: command });
  }

  addOutput(output: string): void {
    this.sealDraft();
    this.append({ kind: "output", text: output });
  }

  /** Puts a turn's message where the turn began, for one sent from another device. */
  insertPrompt(message: HistoryMessage, index: number): void {
    const body = text(message.text);
    if (!body || index > this.items.length) return;
    const date = typeof message.timestamp === "number" ? message.timestamp * 1000 : Date.now();
    this.append(gatewayTurnContent(body, message.display_kind ?? undefined, message.display_metadata?.display_text ?? undefined), date);
    this.items.splice(index, 0, this.items.pop()!);
    if (index <= this.turnStart) this.turnStart += 1;
  }

  /** The newest message either side wrote, for the sidebar's preview. */
  latestMessage(): { text: string; date: number } | undefined {
    if (this.draft.trim()) return { text: this.draft, date: Date.now() };
    for (let i = this.items.length - 1; i >= 0; i--) {
      const { content, date } = this.items[i];
      if ((content.kind === "user" || content.kind === "assistant") && date !== undefined) return { text: content.text, date };
    }
    return undefined;
  }

  endTurnLocally(): void {
    this.sealDraft();
    this.finishSteps("failed");
    this.isRunning = false;
  }

  /** Applies one gateway event for this chat's session. Unknown events are ignored. */
  apply(event: GatewayEvent): void {
    const payload = (event.payload ?? {}) as Payload;
    switch (event.type) {
      case "message.start": {
        // A turn Hermes started itself may say why, for a viewer that didn't submit it.
        const kind = text(payload.display_kind);
        const title = text(payload.display_text);
        const body = text(payload.text);
        if (kind && title && body) {
          this.sealDraft();
          this.append(gatewayTurnContent(body, kind, title));
        }
        if (!this.isRunning) this.turnStart = this.items.length;
        this.isRunning = true;
        return;
      }
      case "message.delta":
        if (typeof payload.text === "string") this.draft += payload.text;
        return;
      case "message.interim": {
        this.sealDraft();
        const body = text(payload.text);
        if (payload.already_streamed !== true && body) this.append({ kind: "assistant", text: body });
        return;
      }
      case "tool.start":
        this.sealDraft();
        this.addStep({
          id: text(payload.tool_id) ?? `tool-${this.nextId}`,
          name: text(payload.name) ?? "tool",
          context: typeof payload.context === "string" ? payload.context : "",
          state: "running",
        });
        return;
      case "tool.progress": {
        let progress = text(payload.message);
        if (!progress && typeof payload.percent === "number") progress = `${Math.round(payload.percent)}%`;
        this.withStep(payload, (step) => ({ ...step, progress }));
        return;
      }
      case "tool.complete": {
        const result = payload.result as Payload | undefined;
        const failed = result?.error !== undefined && result.error !== null;
        this.withStep(payload, (step) => ({
          ...step,
          state: failed ? "failed" : "done",
          summary: text(payload.summary),
          progress: undefined,
          durationSeconds: typeof payload.duration_s === "number" ? payload.duration_s : step.durationSeconds,
        }));
        return;
      }
      case "message.complete":
        this.complete(payload);
        return;
      case "error": {
        const message = text(payload.message);
        if (message) this.addNotice(message);
        return;
      }
      case "notification.show":
        this.showNotice(payload);
        return;
      case "notification.clear":
        this.clearNotice(payload);
        return;
    }
  }

  private complete(payload: Payload): void {
    const status = text(payload.status) ?? "complete";
    const body = text(payload.text);
    if (status === "error" || status === "failed") {
      this.draft = "";
      this.append({ kind: "notice", text: body ?? "The reply failed." });
    } else if (this.draft) {
      this.sealDraft();
    } else if (body && !this.turnHasReply()) {
      // Providers that don't stream send the whole reply here.
      this.append({ kind: "assistant", text: body });
    }
    if (status === "interrupted") this.append({ kind: "notice", text: "Stopped" });
    if (status === "partial") this.append({ kind: "notice", text: "The reply may be incomplete." });
    this.finishSteps(status === "complete" ? "done" : "failed");
    this.isRunning = false;
    this.turnStart = this.items.length;
  }

  private turnHasReply(): boolean {
    return this.items.slice(this.turnStart).some((item) => item.content.kind === "assistant");
  }

  /** Hermes's own notices sit above a streaming reply, so they don't split it in two. */
  private showNotice(payload: Payload): void {
    const body = text(payload.text);
    if (!body) return;
    const key = text(payload.key);
    const existing = key === undefined ? undefined : this.keyedNotices.get(key);
    const index = existing === undefined ? -1 : this.items.findIndex((item) => item.id === existing);
    if (index >= 0) {
      this.items[index] = { ...this.items[index], content: { kind: "notice", text: body } };
      return;
    }
    this.append({ kind: "notice", text: body });
    if (key !== undefined) this.keyedNotices.set(key, this.nextId - 1);
  }

  private clearNotice(payload: Payload): void {
    const key = text(payload.key);
    if (key === undefined) return;
    const id = this.keyedNotices.get(key);
    this.keyedNotices.delete(key);
    const index = this.items.findIndex((item) => item.id === id);
    if (index < 0) return;
    this.items.splice(index, 1);
    if (index < this.turnStart) this.turnStart -= 1;
  }

  private sealDraft(): void {
    if (this.draft.trim()) this.append({ kind: "assistant", text: this.draft });
    this.draft = "";
  }

  private append(content: ItemContent, date: number | undefined = Date.now()): void {
    this.items.push({ id: this.nextId++, content, date });
  }

  /** Consecutive tool calls join the activity item right before them. */
  private addStep(step: ToolStep, date: number | undefined = Date.now()): void {
    const last = this.items.at(-1);
    if (last?.content.kind === "activity") {
      this.items[this.items.length - 1] = { ...last, content: { kind: "activity", steps: [...last.content.steps, step] } };
    } else {
      this.append({ kind: "activity", steps: [step] }, date);
    }
  }

  private withStep(payload: Payload, change: (step: ToolStep) => ToolStep): void {
    const id = text(payload.tool_id);
    if (!id) return;
    for (let index = this.items.length - 1; index >= 0; index--) {
      const item = this.items[index];
      if (item.content.kind !== "activity") continue;
      const at = item.content.steps.findIndex((s) => s.id === id);
      if (at < 0) continue;
      const steps = item.content.steps.slice();
      steps[at] = change(steps[at]);
      this.items[index] = { ...item, content: { kind: "activity", steps } };
      return;
    }
  }

  /** When a turn ends, no step can still be running. */
  private finishSteps(state: ToolStep["state"]): void {
    this.items.forEach((item, index) => {
      if (item.content.kind !== "activity" || !item.content.steps.some((s) => s.state === "running")) return;
      const steps = item.content.steps.map((s) => (s.state === "running" ? { ...s, state, progress: undefined } : s));
      this.items[index] = { ...item, content: { kind: "activity", steps } };
    });
  }
}
