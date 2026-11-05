import { AlertSource } from "./alerts";
import type { GatewayAddress } from "./gateway-address";
import { describeError, isGatewayError } from "./gateway-error";
import type { GatewayEvent, JsonRpcChannel } from "./json-rpc-channel";

/** Who drives a Bot's screen. `viewerHash` names the person in control without giving away their viewer ID. */
export interface DisplayLease {
  holder: "agent" | "human";
  viewerHash?: string;
  epoch: number;
  /** What the Bot asked for, when it asked someone to take over. */
  reason?: string;
}

/**
 * `display.status`: whether the Bot's profile has a screen (a headless Linux desktop on the gateway
 * host or in its sandbox), whether it's on, and who drives it.
 */
export interface DisplayStatus {
  supported: boolean;
  installed: boolean;
  running: boolean;
  /** Why it can't start now, in Hermes's words. */
  blocker?: string;
  lease?: DisplayLease;
  /** Names the profile in `display.*` events. */
  profileKey?: string;
}

type Row = Record<string, unknown>;
type Rpc = Pick<JsonRpcChannel, "call">;

function leaseFrom(value: unknown): DisplayLease | undefined {
  const row = value as Row;
  if (row?.holder !== "agent" && row?.holder !== "human") return undefined;
  return {
    holder: row.holder,
    viewerHash: typeof row.viewer_hash === "string" ? row.viewer_hash : undefined,
    epoch: typeof row.epoch === "number" ? row.epoch : 0,
    reason: typeof row.reason === "string" && row.reason.trim() ? row.reason : undefined,
  };
}

export function displayStatusFrom(value: unknown): DisplayStatus {
  const row = (value ?? {}) as Row;
  return {
    supported: row.supported === true,
    installed: row.installed === true,
    running: row.running === true,
    blocker: typeof row.blocker === "string" && row.blocker.trim() ? row.blocker : undefined,
    lease: leaseFrom(row.lease),
    profileKey: typeof row.profile_key === "string" ? row.profile_key : undefined,
  };
}

/** The first 12 hex digits of the viewer ID's SHA-256, as the lease names viewers. */
export async function viewerHash(viewerId: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(viewerId)));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 12);
}

/** The screen's RFB socket, authenticated by `display.observe`'s single-use ticket alone. */
export function screenSocketUrl(gateway: GatewayAddress, path: string, ticket: string): string {
  const http = gateway.url(path.startsWith("/api/") ? path : "/api/display/ws");
  return `${http.replace(/^http/, "ws")}?display_ticket=${encodeURIComponent(ticket)}`;
}

export type Control = "agent" | "you" | "someoneElse";

export interface ScreenView {
  status?: DisplayStatus;
  lease?: DisplayLease;
  control: Control;
  /** Where to open the picture, once `watch()` has a ticket. */
  socketUrl?: string;
  /** Starting, taking over or handing back. */
  isBusy: boolean;
  /** The last start, take over or hand back that failed. */
  problem?: string;
  /** The demo: a made-up desktop, no socket. */
  demo: boolean;
}

/**
 * One Bot's computer: whether it has one, a ticket to watch it, and taking over through the lease.
 * `display.*` calls ride the app's socket; the picture comes on its own WebSocket.
 */
export class BotScreen {
  private view: ScreenView;
  private readonly listeners = new Set<() => void>();
  private viewerId: string | undefined;
  private myHash: string | undefined;
  /** Requests to take over, for notifications. */
  readonly alerts = new AlertSource();

  constructor(
    readonly profile: string,
    private readonly channel: () => Rpc | undefined,
    private readonly gateway: () => GatewayAddress | undefined,
  ) {
    this.view = { control: "agent", isBusy: false, demo: false };
  }

  /** The demo's computer: on, with the Bot in control. Take over and hand back work locally. */
  static demo(profile: string): BotScreen {
    const screen = new BotScreen(profile, () => undefined, () => undefined);
    const lease: DisplayLease = { holder: "agent", epoch: 1 };
    screen.set({ demo: true, status: { supported: true, installed: true, running: true, lease }, lease });
    screen.myHash = "demo";
    return screen;
  }

  getView = (): ScreenView => this.view;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** The Bot has a screen you could watch: the chat shows its way in. */
  get hasScreen(): boolean {
    return !!this.view.status?.supported && !!this.view.status.installed;
  }

  /** Reads `display.status`. A Hermes without `display.*` has no screen to show. */
  async refresh(): Promise<void> {
    const channel = this.channel();
    if (this.view.demo || !channel) return;
    try {
      this.applyStatus(displayStatusFrom(await channel.call("display.status", { profile: this.profile })));
    } catch (error) {
      if (isGatewayError(error, "rpc") && error.code === -32601) this.set({ status: { supported: false, installed: false, running: false } });
    }
  }

  /** Turns the screen on (`display.start`). */
  start(): Promise<void> {
    return this.act(async (channel) => {
      this.applyStatus(displayStatusFrom(await channel.call("display.start", { profile: this.profile }, 90_000)));
    });
  }

  /**
   * Gets a single-use ticket and the address to watch the screen at. Call again after the app's
   * socket reconnects: a viewer ID only counts on the socket that minted it.
   */
  async watch(): Promise<void> {
    const channel = this.channel();
    const gateway = this.gateway();
    if (this.view.demo || !channel || !gateway) return;
    try {
      const previousHash = this.myHash;
      const params: Row = { profile: this.profile };
      if (this.viewerId) params.viewer_id = this.viewerId;
      const reply = (await channel.call("display.observe", params)) as Row;
      if (typeof reply?.ticket !== "string" || typeof reply.viewer_id !== "string") throw new Error("The gateway sent no ticket for the screen.");
      this.viewerId = reply.viewer_id;
      this.myHash = await viewerHash(reply.viewer_id);
      if (typeof reply.supported === "boolean") this.applyStatus(displayStatusFrom(reply));
      // A new socket mints a new viewer: carry control over if the old one had it.
      const lease = this.view.lease;
      if (previousHash && previousHash !== this.myHash && lease?.holder === "human" && lease.viewerHash === previousHash) {
        await this.acquire(channel).catch(() => {});
      }
      this.set({ socketUrl: screenSocketUrl(gateway, typeof reply.path === "string" ? reply.path : "/api/display/ws", reply.ticket), problem: undefined });
    } catch (error) {
      this.set({ problem: describeError(error) });
    }
  }

  /** Forgets the picture's address, e.g. when the view closes. */
  stopWatching(): void {
    this.set({ socketUrl: undefined });
  }

  /** Takes control from the Bot, or from whoever has it. */
  takeOver(): Promise<void> {
    if (this.view.demo) return Promise.resolve(this.take({ holder: "human", viewerHash: this.myHash, epoch: (this.view.lease?.epoch ?? 0) + 1 }));
    return this.act((channel) => this.acquire(channel));
  }

  /** Gives control back to the Bot. */
  handBack(): Promise<void> {
    if (this.view.demo) return Promise.resolve(this.take({ holder: "agent", epoch: (this.view.lease?.epoch ?? 0) + 1 }));
    return this.act(async (channel) => {
      const params: Row = { profile: this.profile };
      if (this.viewerId) params.viewer_id = this.viewerId;
      try {
        this.takeFrom(await channel.call("display.lease.release", params));
      } catch (error) {
        // Our viewer is from an earlier socket; the lease is still ours by its hash.
        if (!isGatewayError(error, "rpc") || this.view.control !== "you") throw error;
        this.takeFrom(await channel.call("display.lease.release", { ...params, force: true }));
      }
    });
  }

  /** `display.status` and `display.lease` events from the gateway, for any profile. */
  apply(event: GatewayEvent): void {
    const payload = (event.payload ?? {}) as Row;
    if (!this.view.status?.profileKey || payload.profile_key !== this.view.status.profileKey) return;
    if (event.type === "display.lease") {
      const lease = leaseFrom(payload.lease);
      if (lease) this.take(lease);
    } else if (event.type === "display.status") {
      this.applyStatus(displayStatusFrom(payload));
    }
  }

  private async acquire(channel: Rpc): Promise<void> {
    if (!this.viewerId) throw new Error("Open the screen first.");
    this.takeFrom(await channel.call("display.lease.acquire", { profile: this.profile, viewer_id: this.viewerId }));
  }

  private takeFrom(reply: unknown): void {
    const lease = leaseFrom((reply as Row)?.lease);
    if (!lease) throw new Error("The gateway didn't say who controls the screen.");
    this.take(lease);
  }

  private applyStatus(status: DisplayStatus): void {
    this.set({ status, ...(status.running ? {} : { socketUrl: undefined }) });
    if (status.lease) this.take(status.lease);
  }

  /** A lease no older than the one shown. */
  private take(lease: DisplayLease): void {
    if (lease.epoch < (this.view.lease?.epoch ?? -Infinity)) return;
    if (lease.reason && lease.reason !== this.view.lease?.reason) {
      this.alerts.announce(`take-over-${lease.epoch}`, `Asks you to take over: ${lease.reason}`);
    }
    const control: Control = lease.holder !== "human" ? "agent" : lease.viewerHash && lease.viewerHash === this.myHash ? "you" : "someoneElse";
    this.set({ lease, control });
  }

  private async act(work: (channel: Rpc) => Promise<void>): Promise<void> {
    const channel = this.channel();
    if (this.view.isBusy) return;
    if (!channel) return this.set({ problem: "The connection to the gateway closed." });
    this.set({ isBusy: true, problem: undefined });
    try {
      await work(channel);
    } catch (error) {
      this.set({ problem: describeError(error) });
    } finally {
      this.set({ isBusy: false });
    }
  }

  private set(change: Partial<ScreenView>): void {
    this.view = { ...this.view, ...change };
    for (const listener of this.listeners) listener();
  }
}
