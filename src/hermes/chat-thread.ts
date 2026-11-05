import { AlertSource, alertPreview, requestAlertText } from "./alerts";
import { attachmentKind, parseRefLine, refLine, sizeLimit, toBase64, type Attachment, type AttachmentRef } from "./attachments";
import { openBotChat } from "./bot-chat";
import { commandIn, commandsFromCatalog, type SlashCommand } from "./commands";
import {
  applyFrame,
  approveAnswer,
  connectionAlertText,
  connectionRequestFrom,
  continueAnswer,
  endNotices,
  isResolved,
  offerFor,
  openTargets,
  respondParams,
  retryParams,
  skipAnswer,
  type ConnectionRequest,
  type ConnectionTarget,
} from "./connection-request";
import { connectorErrorText } from "./connectors";
import { describeError, GatewayError, isGatewayError } from "./gateway-error";
import type { GatewayEvent, GatewayReady, JsonRpcChannel } from "./json-rpc-channel";
import {
  approvalNotice,
  chatRequestFrom,
  encodeClarifyAnswer,
  shortCommand,
  type ApprovalChoice,
  type ApprovalPrompt,
  type ChatRequest,
  type ClarifyPrompt,
  type SecretPrompt,
} from "./requests";
import { Transcript, type HistoryMessage, type TranscriptItem } from "./transcript";
import type { BotStatus } from "./types";

export type ChatPhase = { kind: "loading" } | { kind: "ready" } | { kind: "failed"; message: string };

/** What a chat view shows. A new object after every change. */
export interface ChatView {
  phase: ChatPhase;
  items: TranscriptItem[];
  draft: string;
  isRunning: boolean;
  /** Approvals, questions and masked prompts waiting for you, oldest first. */
  requests: ChatRequest[];
  /** Shown above the transcript, e.g. when older history couldn't be loaded. */
  banner?: string;
  canSend: boolean;
  /** Skills and commands the `/` menu offers. */
  commands: SlashCommand[];
  /** Attachments are on their way to the gateway; the message goes out once they're there. */
  isUploading: boolean;
  /** Text a command put back for you to edit and send (`/retry`); the message box takes it. */
  prefill?: string;
  /** Apps the Bot asked you to connect, while it waits. */
  connection?: ConnectionCard;
}

/** A connection request on screen, and what this device is doing about it. */
export interface ConnectionCard {
  request: ConnectionRequest;
  /** Apps whose sign-in page was opened here: their row waits for you to finish there. */
  opened: string[];
  /** Apps with an answer on its way to the gateway. */
  busy: string[];
  /** Why the last answer didn't go through. */
  problem?: string;
}

type Rpc = Pick<JsonRpcChannel, "call" | "respond">;

/** One Bot's chat: its transcript, whether a turn is running, what it needs from you. */
export class ChatThread {
  private transcript = new Transcript();
  private phase: ChatPhase = { kind: "loading" };
  private requests: ChatRequest[] = [];
  private banner: string | undefined;
  private opening = false;
  private view: ChatView;
  private readonly listeners = new Set<() => void>();
  /** The live session the gateway routes this chat's events to; `undefined` while offline. */
  sessionId: string | undefined;
  /** The demo answers what you send with a scripted reply, as there's no gateway. */
  private demoReply: ((thread: ChatThread) => void) | undefined;
  private commands: SlashCommand[] = [];
  private isUploading = false;
  private prefill: string | undefined;
  /**
   * Where the running turn began, when another device started it: `message.start` doesn't carry the
   * prompt, so it's looked up once the turn is stored.
   */
  private elsewhereTurnStart: number | undefined;
  /** Goes up each time the gateway's copy of the transcript replaces the one on screen. */
  private transcriptLoad = 0;
  /** Hermes keeps one connection request open per chat. */
  private connection: ConnectionCard | undefined;
  /** Replies and requests, for notifications. */
  readonly alerts = new AlertSource();

  constructor(
    readonly botId: string,
    private readonly channel: () => Rpc | undefined,
  ) {
    this.view = this.snapshot();
  }

  /** A chat already open and showing `transcript`, for the demo. */
  static demo(
    botId: string,
    transcript: Transcript,
    requests: ChatRequest[],
    reply: (thread: ChatThread) => void,
    commands: SlashCommand[] = [],
  ): ChatThread {
    const thread = new ChatThread(botId, () => undefined);
    thread.transcript = transcript;
    thread.requests = requests;
    thread.commands = commands;
    thread.phase = { kind: "ready" };
    thread.sessionId = `demo-${botId}`;
    thread.demoReply = reply;
    thread.changed();
    return thread;
  }

  getView = (): ChatView => this.view;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** What the sidebar shows for this Bot. */
  get status(): BotStatus {
    if (this.requests.length > 0 || this.connection) return "needsYou";
    return this.transcript.isRunning ? "working" : "idle";
  }

  /** The newest message either side wrote, for the sidebar's preview. */
  latestMessage(): { text: string; date: number } | undefined {
    return this.transcript.latestMessage();
  }

  /** Hands over text a command put back for editing, once. */
  takePrefill(): string | undefined {
    const text = this.prefill;
    if (text === undefined) return undefined;
    this.prefill = undefined;
    this.changed();
    return text;
  }

  // Attaching

  /**
   * Finds or creates the Bot Chat, loads its history and attaches to its events. Safe to call
   * repeatedly; does nothing while attached or already opening.
   */
  async open(knownId: string | undefined, dialect: GatewayReady["dialect"]): Promise<void> {
    if (this.sessionId || this.opening) return;
    if (dialect !== "legacy") {
      this.phase = { kind: "failed", message: "Chat on this gateway's newer protocol isn't supported yet." };
      return this.changed();
    }
    const channel = this.channel();
    if (!channel) return;
    this.opening = true;
    if (this.phase.kind === "failed") {
      this.phase = { kind: "loading" };
      this.changed();
    }
    try {
      const opened = await openBotChat(this.botId, knownId, channel);
      if (this.channel() !== channel) return; // The socket dropped while this waited.
      this.sessionId = opened.sessionId;
      this.transcript = Transcript.fromHistory(opened.history, opened.running, opened.inflight);
      this.transcriptLoad += 1;
      this.elsewhereTurnStart = undefined;
      this.banner = opened.historyOmitted ? "Earlier messages are too long to load here." : undefined;
      // The gateway re-sends any question still waiting, so the list starts from its answer.
      this.requests = opened.openRequests.flatMap((r) => {
        const prompt = chatRequestFor(r, opened.sessionId);
        return prompt ? [prompt] : [];
      });
      for (const request of this.requests) this.alerts.announce(request.id, requestAlertText(request));
      this.adoptConnection(opened.pendingConnection);
      this.phase = { kind: "ready" };
      void this.loadCommands();
    } catch (error) {
      this.phase = { kind: "failed", message: describeError(error) };
    } finally {
      this.opening = false;
      this.changed();
    }
  }

  /**
   * Forgets the live session after the socket drops; the transcript stays on screen. The next
   * `open` attaches again and reloads it, so nothing missed while offline is lost.
   */
  detach(): void {
    if (!this.sessionId && this.requests.length === 0) return;
    this.sessionId = undefined;
    this.requests = [];
    this.changed();
  }

  // Gateway traffic

  apply(event: GatewayEvent): void {
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    if (event.type === "connection.request" || event.type === "connection.update") {
      this.applyConnection(event.type, payload, event.sessionId);
    } else if (event.type === "request.cancel") {
      this.withdraw(payload);
    } else {
      // Sending from here marks the turn running before the gateway says it started. A turn Hermes
      // began itself brings its own line.
      if (event.type === "message.start" && !this.transcript.isRunning && payload.display_kind === undefined) {
        this.elsewhereTurnStart = this.transcript.items.length;
      }
      const wasRunning = this.transcript.isRunning;
      const itemsBefore = this.transcript.items.length;
      this.transcript.apply(event);
      if (event.type === "message.complete") {
        this.finishTurnElsewhere(payload);
        const reply = this.transcript.items.slice(itemsBefore).findLast((i) => i.content.kind === "assistant");
        if (wasRunning && reply?.content.kind === "assistant") this.alerts.emit({ kind: "reply", text: alertPreview(reply.content.text) });
      }
    }
    this.changed();
  }

  /**
   * Another device's message reaches this one only as a turn starting, without its words, so they're
   * looked up once the turn is stored, as Hermes's own app does. Only they are put in: reloading would
   * take you from what you're reading.
   */
  private finishTurnElsewhere(payload: Record<string, unknown>): void {
    const index = this.elsewhereTurnStart;
    this.elsewhereTurnStart = undefined;
    const channel = this.channel();
    if (index === undefined || (payload.status ?? "complete") !== "complete" || !channel || !this.sessionId) return;
    const load = this.transcriptLoad;
    void channel
      .call("session.history", { session_id: this.sessionId })
      .then((result) => {
        const history = (result as { messages?: HistoryMessage[] })?.messages;
        if (this.transcriptLoad !== load || !Array.isArray(history)) return;
        // Before the reply: you may already have sent the next message from here.
        const reply = history.map((m) => m.role).lastIndexOf("assistant");
        const prompt = history.slice(0, Math.max(reply, 0)).reverse().find((m) => m.role === "user");
        if (reply < 0 || !prompt) return;
        this.transcript.insertPrompt(prompt, index);
        this.changed();
      })
      .catch(() => {});
  }

  /** Loads the `/` menu. Keeps the old list if the gateway can't answer. */
  private async loadCommands(): Promise<void> {
    const channel = this.channel();
    if (!channel || !this.sessionId) return;
    try {
      this.commands = commandsFromCatalog(await channel.call("commands.catalog", { session_id: this.sessionId }));
      this.changed();
    } catch {
      // The menu just stays as it was.
    }
  }

  receive(request: ChatRequest): void {
    if (this.requests.some((r) => r.id === request.id)) return;
    this.requests = [...this.requests, request];
    this.alerts.announce(request.id, requestAlertText(request));
    this.changed();
  }

  /** The gateway withdrew a request: answered elsewhere, timed out, or the turn ended. */
  private withdraw(payload: Record<string, unknown>): void {
    const request = this.requests.find((r) => r.id === payload?.id);
    if (!request) return;
    this.requests = this.requests.filter((r) => r !== request);
    if (payload.reason !== "timeout") return;
    if (request.kind === "approval") {
      this.transcript.addNotice(`Nobody answered in time, so “${shortCommand(request.command)}” didn't run.`);
    } else if (request.kind === "clarify") {
      this.transcript.addNotice("The question timed out.");
    } else {
      this.transcript.addNotice(
        request.kind === "sudo" ? "Nobody answered in time, so the sudo password wasn't sent." : `Nobody answered in time, so ${request.name} wasn't set.`,
      );
    }
  }

  // Your actions

  get canSend(): boolean {
    return this.phase.kind === "ready" && this.sessionId !== undefined;
  }

  /** Sends a message. While the Bot works, the message steers the running turn instead. */
  send(input: string): void {
    const text = input.trim();
    if (!this.canSend || !text) return;
    if (this.demoReply) {
      if (this.transcript.isRunning) return;
      this.transcript.sendLocally(text);
      this.changed();
      this.demoReply(this);
      return;
    }
    const channel = this.channel();
    const sessionId = this.sessionId!;
    if (!channel) return;
    const command = this.transcript.isRunning ? undefined : commandIn(text, this.commands);
    if (command) {
      void this.runCommand(command, text, sessionId, channel);
      return;
    }
    if (this.transcript.isRunning) {
      this.transcript.steerLocally(text);
      this.changed();
      void this.steer(text, sessionId, channel);
      return;
    }
    this.transcript.sendLocally(text);
    this.changed();
    void this.submit(text, sessionId, channel);
  }

  /** Attachments go out only between turns, one message at a time. */
  get canSendAttachments(): boolean {
    return this.canSend && !this.transcript.isRunning && !this.isUploading && !this.demoReply;
  }

  /**
   * Uploads `attachments`, then sends them with `text`. Returns whether the message went out. On a
   * failed upload nothing is sent, a notice says which file and why, and the caller keeps the draft.
   */
  async sendWithAttachments(input: string, attachments: Attachment[]): Promise<boolean> {
    const text = input.trim();
    if (attachments.length === 0) {
      if (!this.canSend || !text) return false;
      this.send(text);
      return true;
    }
    const channel = this.channel();
    const sessionId = this.sessionId;
    if (!this.canSendAttachments || !channel || !sessionId) return false;
    this.isUploading = true;
    this.changed();
    const sent: AttachmentRef[] = [];
    try {
      for (const attachment of attachments) {
        try {
          sent.push(await upload(attachment, sessionId, channel));
        } catch (error) {
          // Images already queued would ride along with the next message: take them back.
          for (const ref of sent.filter((r) => r.kind === "image")) {
            await channel.call("image.detach", { session_id: sessionId, path: ref.path }).catch(() => {});
          }
          this.transcript.addNotice(`Couldn't attach ${attachment.name}: ${describeError(error)}`);
          return false;
        }
      }
    } finally {
      this.isUploading = false;
      this.changed();
    }
    // Queued images reach the Bot with the turn; files only through their references.
    const files = sent.filter((r) => r.kind === "file").map(refLine);
    this.transcript.sendLocally([text, sent.map(refLine).join("\n")].filter(Boolean).join("\n\n"));
    this.changed();
    await this.submit([text, ...files].filter(Boolean).join("\n\n"), sessionId, channel);
    return true;
  }

  /**
   * Runs a command through `command.dispatch` and does what it answers: send a message (a skill),
   * show output, put text back in the message box, or run the command it aliases. Hermes built-ins
   * the dispatcher refuses run as Hermes's own slash command.
   */
  private async runCommand(command: SlashCommand, text: string, sessionId: string, channel: Rpc, depth = 0): Promise<void> {
    const argument = text.slice(command.name.length).trim();
    try {
      const result = (await channel.call("command.dispatch", {
        session_id: sessionId,
        name: command.name.slice(1),
        arg: argument,
      })) as Record<string, unknown>;
      const str = (key: string) => (typeof result?.[key] === "string" && (result[key] as string).trim() ? (result[key] as string) : undefined);
      switch (result?.type) {
        case "skill":
        case "send": {
          const message = str("message");
          if (!message) break;
          // The bubble shows what you typed (or the gateway's short form), not the skill's text.
          this.transcript.sendLocally(str("display") ?? text);
          const notice = str("notice");
          if (notice) this.transcript.addNotice(notice);
          this.changed();
          await this.submit(message, sessionId, channel);
          return;
        }
        case "prefill":
          this.prefill = typeof result.message === "string" ? result.message : "";
          if (str("notice")) this.transcript.addNotice(str("notice")!);
          break;
        case "alias": {
          const target = str("target");
          if (depth >= 3 || !target) break;
          const name = `/${target.replace(/^\//, "")}`;
          await this.runCommand({ name, description: "", kind: "command" }, argument ? `${name} ${argument}` : name, sessionId, channel, depth + 1);
          return;
        }
        default:
          // `exec` and `plugin`: output to read, no turn.
          this.transcript.showCommand(text);
          if (str("output")) this.transcript.addOutput(str("output")!);
          else if (str("notice")) this.transcript.addNotice(str("notice")!);
      }
    } catch (error) {
      if (isGatewayError(error, "rpc") && error.code === 4018 && (error.detail ?? "").startsWith("not a quick/plugin")) {
        await this.runBuiltin(command, text, sessionId, channel);
        return;
      }
      this.transcript.addNotice(`${command.name} didn't run: ${describeError(error)}`);
    }
    this.changed();
  }

  private async runBuiltin(command: SlashCommand, text: string, sessionId: string, channel: Rpc): Promise<void> {
    try {
      const result = (await channel.call("slash.exec", { session_id: sessionId, command: text }, 120_000)) as Record<string, unknown>;
      const message = typeof result?.message === "string" ? result.message.trim() : "";
      if (result?.type === "send" && message) {
        // A command that composed the next message (/prompt): send it as yours.
        this.transcript.sendLocally(message);
        this.changed();
        await this.submit(message, sessionId, channel);
        return;
      }
      this.transcript.showCommand(text);
      this.transcript.addOutput(typeof result?.output === "string" && result.output.trim() ? result.output : "(no output)");
      if (typeof result?.warning === "string" && result.warning.trim()) this.transcript.addNotice(result.warning);
    } catch (error) {
      this.transcript.addNotice(`${command.name} didn't run: ${describeError(error)}`);
    }
    this.changed();
  }

  private async submit(text: string, sessionId: string, channel: Rpc): Promise<void> {
    try {
      await channel.call("prompt.submit", { session_id: sessionId, text });
    } catch (error) {
      this.transcript.addNotice(describeError(error));
      this.transcript.endTurnLocally();
      this.changed();
    }
  }

  private async steer(text: string, sessionId: string, channel: Rpc): Promise<void> {
    try {
      const result = (await channel.call("session.steer", { session_id: sessionId, text })) as { status?: string };
      if (result?.status === "rejected") {
        // The turn ended before the message arrived: send it as the next turn.
        this.transcript.beginTurn();
        this.changed();
        await this.submit(text, sessionId, channel);
      }
    } catch (error) {
      this.transcript.addNotice(describeError(error));
      this.changed();
    }
  }

  /** Asks the Bot to stop the running turn. The gateway confirms with an "interrupted" reply. */
  stop(): void {
    if (!this.transcript.isRunning) return;
    if (this.demoReply) {
      this.apply({ type: "message.complete", payload: { status: "interrupted" } });
      return;
    }
    const channel = this.channel();
    if (!channel || !this.sessionId) return;
    channel.call("session.interrupt", { session_id: this.sessionId }).catch((error: unknown) => {
      this.transcript.addNotice(describeError(error));
      this.changed();
    });
  }

  answerApproval(prompt: ApprovalPrompt, choice: ApprovalChoice): void {
    if (!this.take(prompt)) return;
    this.transcript.addNotice(approvalNotice(choice, shortCommand(prompt.command)));
    this.channel()?.respond(prompt.id, { choice });
    this.changed();
  }

  /** Answers the Bot's questions. `picked` maps each question ID to the chosen or typed answers. */
  answerClarify(prompt: ClarifyPrompt, picked: Record<string, string[]>): void {
    if (!this.take(prompt)) return;
    const answers: Record<string, string | null> = {};
    for (const question of prompt.questions) {
      const values = picked[question.id] ?? [];
      answers[question.id] = values.length ? encodeClarifyAnswer(values, question) : null;
    }
    // Your answers read like your side of the conversation.
    const summary = prompt.questions.map((q) => (picked[q.id] ?? []).join(", ")).filter(Boolean);
    if (summary.length) this.transcript.steerLocally(summary.join("\n"));
    this.channel()?.respond(prompt.id, { answers, outcome: "submitted" });
    this.changed();
  }

  /** Declines to answer; the Bot carries on without the answers. */
  skipClarify(prompt: ClarifyPrompt): void {
    if (!this.take(prompt)) return;
    this.transcript.addNotice("You skipped the question");
    this.channel()?.respond(prompt.id, { outcome: "cancelled" });
    this.changed();
  }

  /**
   * Sends the value to the gateway. It goes nowhere else: notices name what was asked for, never
   * the answer. An empty value means "skipped" to the gateway, so that's `skipSecret`'s job.
   */
  answerSecret(prompt: SecretPrompt, value: string): void {
    if (!value || !this.take(prompt)) return;
    this.transcript.addNotice(prompt.kind === "sudo" ? "You sent the sudo password" : `You sent ${prompt.name}`);
    this.channel()?.respond(prompt.id, { value });
    this.changed();
  }

  skipSecret(prompt: SecretPrompt): void {
    if (!this.take(prompt)) return;
    this.transcript.addNotice(prompt.kind === "sudo" ? "You skipped the sudo password" : `You skipped ${prompt.name}`);
    this.channel()?.respond(prompt.id, { value: "" });
    this.changed();
  }

  // Connecting apps the Bot asked for. `connection.request` opens a card and every
  // `connection.update` moves it; both carry every app. The card moves when Hermes says so.

  private applyConnection(type: string, payload: Record<string, unknown>, eventSession: string | undefined): void {
    const sessionId = eventSession ?? this.sessionId;
    if (!sessionId) return;
    if (type === "connection.request" && this.connection?.request.id !== payload.op_id) {
      const request = connectionRequestFrom(payload, sessionId);
      if (request) this.showConnection(request);
      return;
    }
    const card = this.connection;
    const moved = card && applyFrame(card.request, payload);
    if (!card || !moved) return;
    this.connection = { ...card, request: moved };
    if (moved.ending) this.endConnection();
  }

  /**
   * Takes the request Hermes still waits on when the chat attaches. One shown here that Hermes no
   * longer has ended while this device was away, and how it ended isn't known.
   */
  private adoptConnection(pending: unknown): void {
    const request = pending && typeof pending === "object" && this.sessionId ? connectionRequestFrom(pending, this.sessionId) : undefined;
    if (request && !request.ending) return this.showConnection(request);
    const card = this.connection;
    if (!card) return;
    this.connection = undefined;
    const names = openTargets(card.request).map((t) => t.title);
    if (names.length) this.transcript.addNotice(`The request to connect ${names.join(", ")} ended while this device was away.`);
  }

  private showConnection(request: ConnectionRequest): void {
    const shown = this.connection;
    // The same request again (a reattach): keep what this device knows about it.
    const same = shown?.request.id === request.id;
    this.connection = {
      request: same && shown.request.seq > request.seq ? shown.request : request,
      opened: same ? shown.opened : [],
      busy: [],
    };
    if (this.connection.request.ending) return this.endConnection();
    this.alerts.announce(`connection:${request.id}`, connectionAlertText(request));
  }

  /** The request is over: the card goes, and the chat says how it ended. */
  private endConnection(): void {
    const card = this.connection;
    if (!card) return;
    this.connection = undefined;
    for (const line of endNotices(card.request)) this.transcript.addNotice(line);
  }

  /**
   * Connect: returns the sign-in page to open, or tells Hermes to go ahead with an MCP install or
   * switch-on and returns undefined.
   */
  connectApp(target: ConnectionTarget): string | undefined {
    const card = this.connection;
    if (!card?.request.targets.some((t) => t.name === target.name)) return undefined;
    const offer = offerFor(target);
    if (offer.kind === "signIn") {
      this.connection = { ...card, opened: [...card.opened, target.name], problem: undefined };
      this.changed();
      if (this.demoReply) {
        // The demo has no gateway to report the sign-in: it "finishes" a moment later.
        setTimeout(() => this.demoSettle((t) => (t.name === target.name ? { ...t, state: "connected" } : t)), 2_000);
        return undefined;
      }
      return offer.url;
    }
    if (offer.kind === "approve") this.sendConnectionAnswer(target.name, approveAnswer(target.name));
    return undefined;
  }

  /**
   * Try Again after a failure or an expired link. A hosted app gets a fresh link from
   * `connectors.connect`; an MCP server runs again through `connection.respond`.
   */
  retryApp(target: ConnectionTarget): void {
    const card = this.connection;
    if (!card || offerFor(target).kind !== "retry") return;
    this.connection = { ...card, opened: card.opened.filter((n) => n !== target.name) };
    if (target.kind !== "connector") return this.sendConnectionAnswer(target.name, approveAnswer(target.name));
    const channel = this.channel();
    if (!channel) return this.changed();
    const request = card.request;
    this.setConnectionBusy([target.name], true);
    void channel
      .call("connectors.connect", retryParams(request, target.name), 45_000)
      .then((snapshot) => {
        const now = this.connection;
        if (now?.request.id !== request.id) return;
        this.connection = { ...now, request: applyFrame(now.request, snapshot) ?? now.request, problem: undefined };
      })
      .catch((error: unknown) => this.connectionFailed(error, request))
      .finally(() => this.setConnectionBusy([target.name], false));
  }

  /** Not now, for every app still waiting. Hermes tells the Bot you skipped them. */
  skipConnection(): void {
    const card = this.connection;
    if (!card || !openTargets(card.request).length) return;
    if (this.demoReply) return this.demoSettle((t) => (isResolved(t) ? t : { ...t, state: "skipped" }));
    this.sendConnectionAnswer(undefined, skipAnswer(card.request));
  }

  /** Done, on a list of apps: the Bot goes on with whatever you connected. */
  finishConnecting(): void {
    if (!this.connection) return;
    if (this.demoReply) {
      this.connection = undefined;
      return this.changed();
    }
    this.sendConnectionAnswer(undefined, continueAnswer);
  }

  private sendConnectionAnswer(name: string | undefined, result: Record<string, unknown>): void {
    const card = this.connection;
    const channel = this.channel();
    if (!card || !channel) return;
    const request = card.request;
    const names = name ? [name] : openTargets(request).map((t) => t.name);
    this.setConnectionBusy(names, true);
    void channel
      .call("connection.respond", respondParams(request, result))
      .then((reply) => {
        const now = this.connection;
        if ((reply as { settled?: boolean })?.settled !== true || now?.request.id !== request.id || now.request.ending) return;
        // The frame saying so may come after the answer.
        const skipped = result.targets !== undefined && name === undefined;
        this.connection = {
          ...now,
          request: {
            ...now.request,
            ending: result === continueAnswer ? "continue" : "all_resolved",
            targets: skipped ? now.request.targets.map((t) => (isResolved(t) ? t : { ...t, state: "skipped" })) : now.request.targets,
          },
        };
        this.endConnection();
      })
      .catch((error: unknown) => this.connectionFailed(error, request))
      .finally(() => this.setConnectionBusy(names, false));
  }

  private setConnectionBusy(names: string[], busy: boolean): void {
    const card = this.connection;
    if (!card) return;
    const rest = card.busy.filter((n) => !names.includes(n));
    this.connection = { ...card, busy: busy ? [...rest, ...names] : rest };
    this.changed();
  }

  private connectionFailed(error: unknown, request: ConnectionRequest): void {
    const card = this.connection;
    if (card?.request.id !== request.id) return;
    if (isGatewayError(error, "rpc") && error.code === 4004) {
      // Hermes already let go of it: answered on another device, or over.
      this.connection = undefined;
      const names = openTargets(request).map((t) => t.title);
      if (names.length) this.transcript.addNotice(`The request to connect ${names.join(", ")} had already ended.`);
    } else {
      this.connection = { ...card, problem: connectorErrorText(error) };
    }
    this.changed();
  }

  /** The demo moves the card itself, as there's no gateway to report back. */
  private demoSettle(change: (t: ConnectionTarget) => ConnectionTarget): void {
    const card = this.connection;
    if (!card) return;
    const targets = card.request.targets.map(change);
    this.connection = { ...card, request: { ...card.request, seq: card.request.seq + 1, targets, ending: targets.every(isResolved) ? "all_resolved" : undefined } };
    if (this.connection.request.ending) this.endConnection();
    this.changed();
  }

  /** For the demo: a request waiting in this chat. */
  showDemoConnection(request: ConnectionRequest): void {
    this.connection = { request, opened: [], busy: [] };
    this.changed();
  }

  /** Removes `prompt` from the waiting list; false when it's already gone. */
  private take(prompt: ChatRequest): boolean {
    if (!this.requests.some((r) => r.id === prompt.id)) return false;
    this.requests = this.requests.filter((r) => r.id !== prompt.id);
    return true;
  }

  private snapshot(): ChatView {
    return {
      phase: this.phase,
      items: [...this.transcript.items],
      draft: this.transcript.draft,
      isRunning: this.transcript.isRunning,
      requests: this.requests,
      banner: this.banner,
      canSend: this.canSend,
      commands: this.commands,
      isUploading: this.isUploading,
      prefill: this.prefill,
      connection: this.connection,
    };
  }

  private changed(): void {
    this.view = this.snapshot();
    for (const listener of this.listeners) listener();
  }
}

/**
 * Sends one file to the gateway: an image into the next turn's queue, anything else into the chat's
 * workspace. Larger files get longer, at roughly 100 KB/s at worst.
 */
async function upload(attachment: Attachment, sessionId: string, channel: Rpc): Promise<AttachmentRef> {
  const limit = sizeLimit(attachment.name);
  if (attachment.bytes.length > limit) throw new Error(`It's over the ${limit / 1024 / 1024} MB limit.`);
  const timeout = 30_000 + Math.round(attachment.bytes.length / 100);
  const base64 = toBase64(attachment.bytes);
  if (attachmentKind(attachment.name) === "image") {
    const result = (await channel.call(
      "image.attach_bytes",
      { session_id: sessionId, content_base64: base64, filename: attachment.name },
      timeout,
    )) as { attached?: boolean; path?: string };
    if (result?.attached !== true || typeof result.path !== "string") throw new GatewayError("invalidResponse");
    return { kind: "image", path: result.path };
  }
  const result = (await channel.call(
    "file.attach",
    { session_id: sessionId, name: attachment.name, data_url: `data:application/octet-stream;base64,${base64}` },
    timeout,
  )) as { ref_text?: string };
  const ref = typeof result?.ref_text === "string" ? parseRefLine(result.ref_text) : undefined;
  if (!ref) throw new GatewayError("invalidResponse");
  return ref;
}

function chatRequestFor(request: { id: string; method: string; params: Record<string, unknown> }, sessionId: string) {
  // Waiting requests from `session.resume` may leave out the session they belong to.
  return chatRequestFrom({ ...request, params: { session_id: sessionId, ...request.params } });
}
