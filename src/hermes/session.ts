import type { TargetedAlert } from "./alerts";
import { AuthSession, restoredTokens, savedSignIn, type TokenStore } from "./auth-session";
import { ChatThread } from "./chat-thread";
import { GatewayAddress } from "./gateway-address";
import { connectGateway, backoffMs, type SocketFactory } from "./gateway-connection";
import { describeError, GatewayError, isGatewayError } from "./gateway-error";
import type { HttpTransport } from "./http";
import type { GatewayEvent, GatewayReady, JsonRpcChannel, ServerRequest } from "./json-rpc-channel";
import { fetchStatus, signInWithBrowser, supportsNativeSignIn, type Loopback } from "./native-sign-in";
import { chatRequestFrom } from "./requests";
import { refName, splitAttachments } from "./attachments";
import { createRoom, RoomThread, roomSummaryFrom, type RoomSummary } from "./room";
import { botsFromProfiles, plainPreview } from "./roster";
import { RoutineList } from "./routines";
import { BotScreen } from "./screen";
import type { Bot, RoomEntry } from "./types";
import { ConnectorList } from "./connectors";
import { demoAppsBackend } from "./demo-apps";
import { McpServerList, type JsonRequest } from "./mcp-servers";

/** A Bot's apps: MCP servers on the gateway, and apps connected through the Nous Portal. */
export interface BotApps {
  servers: McpServerList;
  connectors: ConnectorList;
}

export type Link =
  | { kind: "connecting" }
  | { kind: "online"; dialect: GatewayReady["dialect"] }
  | { kind: "offline"; message: string };

export type SessionState =
  | { kind: "restoring" }
  /** `address` is the last gateway, to fill in the address field. */
  | { kind: "signedOut"; address: string; problem?: string }
  | { kind: "signingIn"; gateway: GatewayAddress }
  | { kind: "signedIn"; gateway: GatewayAddress; link: Link; bots: Bot[]; rooms: RoomEntry[]; demo: boolean };

export interface SessionDeps {
  http: HttpTransport;
  makeSocket: SocketFactory;
  tokenStore: TokenStore;
  loopback: Loopback;
  openUrl(url: string): Promise<void>;
  /**
   * The gateways signed in to from this computer, newest first, kept between launches. Addresses
   * aren't secret; each one's sign-in is in `tokenStore`.
   */
  settings: { recentGateways(): Promise<string[]>; saveRecentGateways(addresses: string[]): Promise<void> };
}

/** How many gateways the sign-in screen lists. */
export const RECENT_GATEWAYS = 5;

/** `recent` with `address` moved to the front, without duplicates, at most `RECENT_GATEWAYS` long. */
export function withRecentGateway(recent: string[], address: string): string[] {
  return [address, ...recent.filter((a) => a !== address)].slice(0, RECENT_GATEWAYS);
}

/** How often the roster is read while connected. */
const ROSTER_INTERVAL_MS = 5_000;

/**
 * The app's sign-in and connection: restores a saved sign-in, runs browser sign-in, keeps the
 * socket open (reconnecting with backoff when it drops), and reads the roster while connected.
 */
export class Session {
  private state: SessionState;
  private readonly listeners = new Set<() => void>();
  private auth: AuthSession | undefined;
  private link: AbortController | undefined;
  private channel: JsonRpcChannel | undefined;
  private disposed = false;
  /** Each Bot's chat, made when first shown or when the gateway reports a Bot Chat. */
  private readonly threads = new Map<string, ChatThread>();
  /** The roster as the gateway last sent it; the state's Bots add each chat's status. */
  private roster: Bot[] = [];
  private dialect: GatewayReady["dialect"] | undefined;
  /** Rooms as the gateway last listed them, kept across reads so their transcripts stay loaded. */
  private readonly rooms = new Map<string, RoomThread>();
  private roomUpdated = new Map<string, number>();
  /** Counts rooms made here, so a room list read before one was made doesn't drop it. */
  private roomEdits = 0;
  private readonly routineLists = new Map<string, RoutineList>();
  private readonly alertListeners = new Set<(alert: TargetedAlert) => void>();
  /** Each Bot's computer, made when its chat is first shown. */
  private readonly screens = new Map<string, BotScreen>();
  private readonly botApps = new Map<string, BotApps>();
  /** The demo's pretend gateway for apps. */
  private demoApps: ReturnType<typeof demoAppsBackend> | undefined;
  private recent: string[] = [];

  private constructor(
    private readonly deps: SessionDeps | undefined,
    initial: SessionState,
  ) {
    this.state = initial;
  }

  static live(deps: SessionDeps): Session {
    return new Session(deps, { kind: "restoring" });
  }

  /** Shows Bots, chats, rooms and routines as signed in and online, without a gateway. Nothing connects. */
  static demo(
    address: string,
    bots: Bot[],
    chats: ChatThread[],
    rooms: RoomThread[] = [],
    routines: Record<string, RoutineList> = {},
    screens: BotScreen[] = [],
  ): Session {
    const gateway = GatewayAddress.parse(address);
    const session = new Session(undefined, {
      kind: "signedIn",
      gateway,
      link: { kind: "online", dialect: "legacy" },
      bots,
      rooms: [],
      demo: true,
    });
    session.roster = bots;
    for (const chat of chats) session.adopt(chat);
    for (const room of rooms) session.adoptRoom(room, Date.now() - 30 * 60_000);
    for (const [botId, list] of Object.entries(routines)) session.routineLists.set(botId, list);
    for (const screen of screens) session.adoptScreen(screen);
    session.publishBots();
    return session;
  }

  getState = (): SessionState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Picks up the sign-in saved on this computer, if there is one. */
  async restore(): Promise<void> {
    const deps = this.deps;
    if (!deps || this.state.kind !== "restoring") return;
    this.recent = await deps.settings.recentGateways().catch(() => []);
    const address = this.recent[0] ?? "";
    let gateway: GatewayAddress;
    try {
      gateway = GatewayAddress.parse(address);
    } catch {
      return this.set({ kind: "signedOut", address });
    }
    try {
      const saved = await deps.tokenStore.load(gateway);
      if (!saved) return this.set({ kind: "signedOut", address });
      this.begin(new AuthSession(gateway, restoredTokens(saved), deps.tokenStore, deps.http));
    } catch (error) {
      this.set({ kind: "signedOut", address, problem: `Couldn't read the saved sign-in: ${describeError(error)}` });
    }
  }

  /** The gateways signed in to from this computer, newest first. */
  recentGateways = (): string[] => this.recent;

  /**
   * Signs in to the gateway at `address`: with the sign-in saved for it on this computer, or else
   * through the browser.
   */
  async signIn(address: string): Promise<void> {
    const deps = this.deps;
    if (!deps || this.state.kind === "signingIn" || this.state.kind === "signedIn") return;
    let gateway: GatewayAddress;
    try {
      gateway = GatewayAddress.parse(address);
    } catch (error) {
      return this.set({ kind: "signedOut", address, problem: describeError(error) });
    }
    this.set({ kind: "signingIn", gateway });
    try {
      // A saved sign-in that has expired signs out with a reason, and the next try uses the browser.
      const saved = await deps.tokenStore.load(gateway).catch(() => undefined);
      if (this.getState().kind !== "signingIn") return;
      if (saved) {
        void this.rememberGateway(gateway.baseUrl);
        return this.begin(new AuthSession(gateway, restoredTokens(saved), deps.tokenStore, deps.http));
      }
      const status = await fetchStatus(gateway, deps.http);
      if (!supportsNativeSignIn(status)) throw new GatewayError("signInUnsupported");
      const tokens = await signInWithBrowser(gateway, deps);
      await deps.tokenStore.save(gateway, savedSignIn(tokens));
      void this.rememberGateway(gateway.baseUrl);
      this.begin(new AuthSession(gateway, tokens, deps.tokenStore, deps.http));
    } catch (error) {
      // Read again: sign-out or a cancelled sign-in may have changed it while this waited.
      if (this.getState().kind !== "signingIn") return;
      const problem = isGatewayError(error, "cancelled") ? undefined : describeError(error, gateway);
      this.set({ kind: "signedOut", address, problem });
    }
  }

  /** The chat with `botId`, opened on the gateway when it's online. */
  chat(botId: string): ChatThread {
    let thread = this.threads.get(botId);
    if (!thread) {
      thread = new ChatThread(botId, () => this.channel);
      this.adopt(thread);
    }
    if (this.dialect) void thread.open(this.roster.find((b) => b.id === botId)?.chatId, this.dialect);
    return thread;
  }

  /** The room with `roomId`, as last listed. */
  room(roomId: string): RoomThread | undefined {
    return this.rooms.get(roomId);
  }

  /**
   * Makes a room seating `botIds`, two to six of this gateway's Bots, and lists it at once. Returns
   * the room's ID, to open it. In the demo the room starts empty and nobody answers.
   */
  async createRoom(name: string, botIds: string[]): Promise<string> {
    let summary: RoomSummary;
    if (this.state.kind === "signedIn" && this.state.demo) {
      const members = botIds.map((id) => ({ id, profile: id, handle: id }));
      summary = { id: `demo-${crypto.randomUUID().slice(0, 8)}`, name: name.trim(), members, updatedAt: Date.now(), latestSeq: 0 };
      this.adoptRoom(RoomThread.withEvents(summary, []), summary.updatedAt);
    } else {
      const channel = this.channel;
      if (!channel) throw new GatewayError("disconnected");
      summary = await createRoom(channel, name, botIds);
      this.roomEdits++;
      this.showRoom(summary);
    }
    this.publishBots();
    return summary.id;
  }

  /** Renames a room for everyone in it. A blank or unchanged name does nothing. */
  async renameRoom(roomId: string, name: string): Promise<void> {
    const room = this.rooms.get(roomId);
    const trimmed = name.trim();
    if (!room || !trimmed || trimmed === room.getView().name) return;
    await room.rename(trimmed);
    // Counted after the gateway agrees: a list read before then may still carry the old name.
    this.roomEdits++;
  }

  /** Stops a room and deletes it and its messages for good. Its Bots and their chats stay. */
  async deleteRoom(roomId: string): Promise<void> {
    const room = this.rooms.get(roomId);
    if (!room) return;
    await room.disband();
    this.roomEdits++;
    this.rooms.delete(roomId);
    this.roomUpdated.delete(roomId);
    this.publishBots();
  }

  /** The routines of `botId`'s profile. Call `refresh()` to load them. */
  routines(botId: string): RoutineList {
    let list = this.routineLists.get(botId);
    if (!list) {
      const auth = this.auth;
      list = new RoutineList(
        botId,
        auth ? (path, options) => auth.json(path, { method: options?.method, timeoutMs: options?.timeoutMs }) : undefined,
      );
      this.routineLists.set(botId, list);
    }
    return list;
  }

  /** `botId`'s apps: its MCP servers and its Nous Portal connected apps. Call `refresh()` on each to load. */
  apps(botId: string): BotApps {
    let apps = this.botApps.get(botId);
    if (apps) return apps;
    const demo = this.state.kind === "signedIn" && this.state.demo ? (this.demoApps ??= demoAppsBackend()) : undefined;
    const channel = () => demo?.channel ?? this.channel;
    const request: JsonRequest =
      demo?.request ?? ((path, options) => (this.auth ? this.auth.json(path, options) : Promise.reject(new GatewayError("disconnected"))));
    apps = {
      servers: new McpServerList(botId, {
        request,
        channel,
        sessionId: () => this.threads.get(botId)?.sessionId,
        isUnencrypted: () => (this.state.kind === "signedIn" ? this.state.gateway.isUnencrypted : false),
      }),
      connectors: new ConnectorList(botId, channel),
    };
    this.botApps.set(botId, apps);
    return apps;
  }

  /** `botId`'s computer. Call `refresh()` to learn whether it has one. */
  screen(botId: string): BotScreen {
    let screen = this.screens.get(botId);
    if (!screen) {
      screen = new BotScreen(botId, () => this.channel, () => (this.state.kind === "signedIn" ? this.state.gateway : undefined));
      this.adoptScreen(screen);
    }
    return screen;
  }

  private adoptScreen(screen: BotScreen): void {
    this.screens.set(screen.profile, screen);
    screen.alerts.onAlert(this.forward(`bot:${screen.profile}`, () => this.roster.find((b) => b.id === screen.profile)?.name ?? screen.profile));
  }

  /** Replies and requests from every chat and room, for notifications. */
  onAlert(listener: (alert: TargetedAlert) => void): () => void {
    this.alertListeners.add(listener);
    return () => this.alertListeners.delete(listener);
  }

  private forward(target: string, title: () => string) {
    return (alert: { kind: TargetedAlert["kind"]; text: string }) => {
      for (const listener of this.alertListeners) listener({ ...alert, target, title: title() });
    };
  }

  cancelSignIn(): void {
    this.deps?.loopback.cancel().catch(() => {});
  }

  /** Forgets the sign-in on this computer and closes the connection. */
  async signOut(problem?: string): Promise<void> {
    const auth = this.disconnect();
    const address = auth?.gateway.baseUrl ?? this.recent[0] ?? "";
    this.set({ kind: "signedOut", address, problem });
    await auth?.signOut().catch(() => {});
  }

  /**
   * Leaves this gateway, keeping its sign-in saved for next time, and signs in to the one at
   * `address`: with its saved sign-in, or else through the browser.
   */
  async switchGateway(address: string): Promise<void> {
    if (!this.deps || this.state.kind === "signingIn") return;
    const current = this.disconnect();
    this.set({ kind: "signedOut", address: current?.gateway.baseUrl ?? address });
    await this.signIn(address);
  }

  /** Closes the connection and forgets this gateway's Bots, chats and rooms. */
  private disconnect(): AuthSession | undefined {
    const auth = this.auth;
    this.auth = undefined;
    this.link?.abort();
    this.link = undefined;
    this.channel?.close();
    this.channel = undefined;
    this.dialect = undefined;
    this.threads.clear();
    this.rooms.clear();
    this.roomUpdated.clear();
    this.screens.clear();
    this.botApps.clear();
    this.routineLists.clear();
    this.roster = [];
    return auth;
  }

  /** Takes `address` off the recent list and removes the sign-in saved for it. */
  async forgetGateway(address: string): Promise<void> {
    const deps = this.deps;
    if (!deps) return;
    this.recent = this.recent.filter((a) => a !== address);
    // A new state object, so the sign-in screen reads the shorter list.
    this.set({ ...this.state });
    await deps.settings.saveRecentGateways(this.recent).catch(() => {});
    try {
      await deps.tokenStore.delete(GatewayAddress.parse(address));
    } catch {
      // An address saved by an older version that no longer parses has no sign-in to remove.
    }
  }

  private async rememberGateway(address: string): Promise<void> {
    this.recent = withRecentGateway(this.recent, address);
    // Without the list, the address is typed again next launch; the sign-in itself is still saved.
    await this.deps?.settings.saveRecentGateways(this.recent).catch(() => {});
  }

  /**
   * Stops connecting for good but keeps the sign-in saved, for when the UI lets go of this
   * session (React runs effects twice in development, so an abandoned one would connect forever).
   */
  dispose(): void {
    this.disposed = true;
    this.link?.abort();
    this.link = undefined;
    this.channel?.close();
    this.channel = undefined;
    this.cancelSignIn();
  }

  private begin(auth: AuthSession): void {
    if (this.disposed) return;
    this.auth = auth;
    this.set({ kind: "signedIn", gateway: auth.gateway, link: { kind: "connecting" }, bots: [], rooms: [], demo: false });
    this.link = new AbortController();
    void this.stayConnected(auth, this.link.signal);
  }

  /**
   * Connects, reads the roster every few seconds, and reconnects with backoff when the socket
   * drops. Ends when signed out or when the gateway rejects the sign-in.
   */
  private async stayConnected(auth: AuthSession, signal: AbortSignal): Promise<void> {
    const deps = this.deps!;
    let attempt = 0;
    while (!signal.aborted) {
      try {
        const { channel, ready } = await connectGateway(auth, deps.makeSocket);
        if (signal.aborted) return channel.close();
        attempt = 0;
        this.channel = channel;
        this.dialect = ready.dialect;
        channel.onEvent((event) => this.route(event));
        channel.onRequest((request) => this.handle(request, channel));
        this.updateSignedIn({ link: { kind: "online", dialect: ready.dialect } });
        // A viewer ID only counts on the socket that minted it, so screens being watched ask again.
        for (const screen of this.screens.values()) {
          void screen.refresh();
          if (screen.getView().socketUrl) void screen.watch();
        }
        const closed = new Promise<GatewayError>((resolve) => channel.onClose(resolve));
        try {
          while (!signal.aborted) {
            const profiles = await channel.call("profiles.list", { include_sessions: true });
            this.roster = botsFromProfiles(profiles);
            this.publishBots();
            this.attachChats(ready.dialect);
            // After the Bots, so a slow room list never holds up the roster.
            await this.refreshRooms(channel);
            this.publishBots();
            const dropped = await Promise.race([sleep(ROSTER_INTERVAL_MS, signal).then(() => undefined), closed]);
            if (dropped) throw dropped;
          }
        } finally {
          channel.close();
          if (this.channel === channel) {
            this.channel = undefined;
            this.dialect = undefined;
            for (const thread of this.threads.values()) thread.detach();
          }
        }
      } catch (error) {
        if (signal.aborted) return;
        if (isGatewayError(error, "signInRequired")) {
          await this.signOut(describeError(error));
          return;
        }
        console.error(`Gateway link dropped: ${describeError(error)}`);
        this.updateSignedIn({ link: { kind: "offline", message: describeError(error, auth.gateway) } });
        await sleep(backoffMs(attempt++), signal);
        if (!signal.aborted) this.updateSignedIn({ link: { kind: "connecting" } });
      }
    }
  }

  /**
   * Attaches every chat the gateway has a Bot Chat for, and every chat already shown, so their
   * replies and requests reach this app.
   */
  private attachChats(dialect: GatewayReady["dialect"]): void {
    for (const bot of this.roster) {
      const thread = this.threads.get(bot.id);
      if (thread) void thread.open(bot.chatId, dialect);
      else if (bot.chatId) this.chat(bot.id);
    }
  }

  /**
   * Lists the gateway's rooms and catches up any with new events. A room asking for approval writes
   * no event, so one at work is read until it's done. Keeps the rooms it has when listing fails.
   */
  private async refreshRooms(channel: JsonRpcChannel): Promise<void> {
    const edits = this.roomEdits;
    let result: unknown;
    try {
      result = await channel.call("groups.list", { limit: 200 }, 15_000);
    } catch {
      // A gateway without rooms, a room service that's off, or a slow answer: the rooms shown stay.
      // A dropped socket is noticed by the connection itself.
      return;
    }
    // A room made while this read was out may be missing from it; the next read lists it.
    if (edits !== this.roomEdits) return;
    const rows = (result as { rooms?: unknown })?.rooms;
    const summaries = (Array.isArray(rows) ? rows : []).flatMap((r) => roomSummaryFrom(r) ?? []);
    const listed = new Set(summaries.map((s) => s.id));
    for (const id of [...this.rooms.keys()]) if (!listed.has(id)) this.rooms.delete(id);
    for (const summary of summaries) this.showRoom(summary);
  }

  /** Keeps the room behind `summary` and catches it up when it has news or is at work. */
  private showRoom(summary: RoomSummary): void {
    let room = this.rooms.get(summary.id);
    if (!room) {
      room = new RoomThread(summary.id, summary.name, summary.members, () => this.channel);
      this.adoptRoom(room, summary.updatedAt);
    }
    room.adoptName(summary.name);
    this.roomUpdated.set(summary.id, summary.updatedAt);
    const view = room.getView();
    if (summary.latestSeq > room.cursor || view.phase.kind !== "ready" || room.status !== "idle") void room.sync();
  }

  private adoptRoom(room: RoomThread, updatedAt: number): void {
    this.rooms.set(room.id, room);
    this.roomUpdated.set(room.id, updatedAt);
    room.subscribe(() => this.publishBots());
    room.alerts.onAlert(this.forward(`room:${room.id}`, () => room.getView().name));
  }

  private route(event: GatewayEvent): void {
    if (event.type.startsWith("display.")) {
      for (const screen of this.screens.values()) screen.apply(event);
      return;
    }
    if (!event.sessionId) return;
    for (const thread of this.threads.values()) {
      if (thread.sessionId === event.sessionId) return thread.apply(event);
    }
  }

  /**
   * Hands the gateway's questions to their chat. Masked prompts with no chat to show them are
   * answered empty (a skip), never declined: the gateway would save a decline's error text as the
   * secret. Anything else is declined as "not shown here" (4404), so the gateway lets another app
   * answer, or gives up at once, and the Bot never waits on Unibot.
   */
  private handle(request: ServerRequest, channel: JsonRpcChannel): void {
    const prompt = chatRequestFrom(request);
    const thread = prompt && [...this.threads.values()].find((t) => t.sessionId === prompt.sessionId);
    if (prompt && thread) return thread.receive(prompt);
    if (request.method === "secret" || request.method === "sudo") return channel.respond(request.id, { value: "" });
    channel.decline(request.id, 4404, `Unibot can't answer "${request.method}" requests.`);
  }

  private adopt(thread: ChatThread): void {
    this.threads.set(thread.botId, thread);
    // A chat's status shows in the sidebar.
    thread.subscribe(() => this.publishBots());
    thread.alerts.onAlert(this.forward(`bot:${thread.botId}`, () => this.roster.find((b) => b.id === thread.botId)?.name ?? thread.botId));
  }

  /**
   * The roster with each chat's status, and its newest message when that's newer than the roster's
   * (the roster is read every few seconds), most recent first. Published only when something changed.
   */
  private publishBots(): void {
    if (this.state.kind !== "signedIn") return;
    const bots = this.roster
      .map((bot) => {
        const thread = this.threads.get(bot.id);
        const latest = thread?.latestMessage();
        const next: Bot = { ...bot, status: thread?.status ?? "idle" };
        if (latest && latest.date > bot.lastActivity) {
          const { text, attachments } = splitAttachments(latest.text);
          next.preview = text ? plainPreview(text) : attachments.length === 1 ? refName(attachments[0]) : `${attachments.length} attachments`;
          next.lastActivity = latest.date;
        }
        return shallowEqual(next, bot) ? bot : next;
      })
      .sort((a, b) => b.lastActivity - a.lastActivity);
    const rooms: RoomEntry[] = [...this.rooms.values()]
      .map((room) => {
        const latest = room.latestMessage();
        const updated = this.roomUpdated.get(room.id) ?? 0;
        const view = room.getView();
        return {
          id: room.id,
          name: view.name,
          memberCount: view.members.length,
          preview: latest ? plainPreview(splitAttachments(latest.text).text || "Sent a file") : `${view.members.length} Bots`,
          lastActivity: Math.max(latest?.date ?? 0, updated),
          status: room.status,
        };
      })
      .sort((a, b) => b.lastActivity - a.lastActivity);
    const current = this.state;
    const sameBots = bots.length === current.bots.length && bots.every((bot, i) => shallowEqual(bot, current.bots[i]));
    const sameRooms = JSON.stringify(rooms) === JSON.stringify(current.rooms);
    if (sameBots && sameRooms) return;
    this.set({ ...current, bots: sameBots ? current.bots : bots, rooms: sameRooms ? current.rooms : rooms });
  }

  private updateSignedIn(change: { link?: Link; bots?: Bot[] }): void {
    if (this.state.kind !== "signedIn") return;
    this.set({ ...this.state, ...change });
  }

  private set(state: SessionState): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}

function shallowEqual<T extends object>(a: T, b: T): boolean {
  const keys = Object.keys(a) as Array<keyof T>;
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

/** Waits `ms`, or less when `signal` aborts. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}
