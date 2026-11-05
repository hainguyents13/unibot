import { GatewayError } from "./gateway-error";

/** A text WebSocket. Tauri's WebSocket plugin in the app; an in-memory pair in tests. */
export interface RpcSocket {
  send(text: string): Promise<void>;
  close(): void;
  /**
   * Every text frame. Frames that arrived before a listener was attached are delivered to it
   * first: the gateway sends `gateway.ready` as soon as the socket opens.
   */
  onMessage(listener: (text: string) => void): void;
  /** Once, when the socket closes for any reason. */
  onClose(listener: () => void): void;
}

/** A notification from the gateway: `{"method":"event","params":{"type",…,"payload"}}`. */
export interface GatewayEvent {
  type: string;
  sessionId?: string;
  seq?: number;
  payload: unknown;
}

/**
 * A question the gateway asks the app and waits on, e.g. `approval`. Answer it with
 * `respond` or refuse it with `decline`. IDs are `srq-…` strings, so they never collide with the
 * app's own numeric request IDs.
 */
export interface ServerRequest {
  id: string;
  method: string;
  params: Record<string, unknown>;
}

/**
 * The first frame on every socket. `session_authority: true` means the gateway runs the canonical
 * session protocol (`hermes gateway`); without it, the legacy one (`hermes dashboard`).
 */
export interface GatewayReady {
  dialect: "canonical" | "legacy";
  replayEpoch?: unknown;
}

interface Pending {
  resolve(value: unknown): void;
  reject(error: unknown): void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * JSON-RPC 2.0 over one WebSocket: numbered requests with replies, a stream of events, the
 * gateway's own requests to the app, and a heartbeat (`gateway.ping` every 15 s; the socket is
 * dead after 45 s of silence).
 */
export class JsonRpcChannel {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly eventListeners = new Set<(event: GatewayEvent) => void>();
  private readonly requestListeners = new Set<(request: ServerRequest) => void>();
  private readonly closeListeners = new Set<(error: GatewayError) => void>();
  private ready: { value?: GatewayReady; error?: unknown } | undefined;
  private readonly readyWaiters: Array<Pick<Pending, "resolve" | "reject">> = [];
  private lastInbound = Date.now();
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private closedError: GatewayError | undefined;

  constructor(
    private readonly socket: RpcSocket,
    private readonly heartbeatMs = 15_000,
    private readonly silenceLimitMs = 45_000,
  ) {}

  /** Starts reading frames and sending heartbeats. Add listeners first. */
  start(): void {
    this.lastInbound = Date.now();
    this.socket.onMessage((text) => this.handle(text));
    this.socket.onClose(() => this.shutDown(new GatewayError("disconnected")));
    this.heartbeat = setInterval(() => this.beat(), this.heartbeatMs);
  }

  get isClosed(): boolean {
    return this.closedError !== undefined;
  }

  onEvent(listener: (event: GatewayEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onRequest(listener: (request: ServerRequest) => void): () => void {
    this.requestListeners.add(listener);
    return () => this.requestListeners.delete(listener);
  }

  /** Called once with why the channel closed. */
  onClose(listener: (error: GatewayError) => void): () => void {
    if (this.closedError) listener(this.closedError);
    else this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  /** Waits for `gateway.ready`. */
  waitUntilReady(timeoutMs = 15_000): Promise<GatewayReady> {
    if (this.ready) {
      return this.ready.error === undefined ? Promise.resolve(this.ready.value!) : Promise.reject(this.ready.error);
    }
    setTimeout(() => this.resolveReady({ error: new GatewayError("timedOut") }), timeoutMs);
    return new Promise((resolve, reject) => this.readyWaiters.push({ resolve: resolve as (v: unknown) => void, reject }));
  }

  /** Sends a request and waits for its result. JSON-RPC errors reject with `rpc`. */
  call(method: string, params: Record<string, unknown> = {}, timeoutMs = 30_000): Promise<unknown> {
    if (this.closedError) return Promise.reject(this.closedError);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.settle(id, { error: new GatewayError("timedOut") }), timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  /** Answers the server request with ID `requestId`. */
  respond(requestId: string, result: unknown): void {
    this.write({ jsonrpc: "2.0", id: requestId, result });
  }

  /** Refuses a server request, so the agent doesn't wait out its deadline for an answer. */
  decline(requestId: string, code: number, message: string): void {
    this.write({ jsonrpc: "2.0", id: requestId, error: { code, message } });
  }

  /** Closes the socket and fails everything still waiting. */
  close(): void {
    this.shutDown(new GatewayError("disconnected"));
  }

  private write(frame: unknown): void {
    if (this.closedError) return;
    this.socket.send(JSON.stringify(frame)).catch(() => this.shutDown(new GatewayError("disconnected")));
  }

  private handle(text: string): void {
    this.lastInbound = Date.now();
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(text);
    } catch {
      console.error("Dropped a frame that isn't JSON");
      return;
    }
    if (!frame || typeof frame !== "object") return;
    const { id, method } = frame;

    if (typeof id === "number" && method === undefined) {
      const error = frame.error as { code?: number; message?: string } | undefined;
      if (error) {
        this.settle(id, { error: new GatewayError("rpc", error.message ?? "The gateway refused the request.", error.code ?? 0) });
      } else {
        this.settle(id, { value: frame.result ?? null });
      }
      return;
    }
    if (typeof method === "string" && method !== "event" && typeof id === "string") {
      const request = { id, method, params: (frame.params ?? {}) as Record<string, unknown> };
      for (const listener of this.requestListeners) listener(request);
      return;
    }
    const params = frame.params as Record<string, unknown> | undefined;
    if (method !== "event" || !params || typeof params.type !== "string") return;
    const payload = (params.payload ?? null) as Record<string, unknown> | null;
    if (params.type === "gateway.ready") {
      const dialect = payload?.session_authority === true ? "canonical" : "legacy";
      this.resolveReady({ value: { dialect, replayEpoch: payload?.replay_epoch } });
      return;
    }
    const event: GatewayEvent = {
      type: params.type,
      sessionId: typeof params.session_id === "string" ? params.session_id : undefined,
      seq: typeof params.seq === "number" ? params.seq : undefined,
      payload,
    };
    for (const listener of this.eventListeners) listener(event);
  }

  private settle(id: number, outcome: { value?: unknown; error?: unknown }): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    if (outcome.error === undefined) pending.resolve(outcome.value);
    else pending.reject(outcome.error);
  }

  private resolveReady(outcome: { value?: GatewayReady; error?: unknown }): void {
    if (this.ready) return;
    this.ready = outcome;
    for (const waiter of this.readyWaiters.splice(0)) {
      if (outcome.error === undefined) waiter.resolve(outcome.value);
      else waiter.reject(outcome.error);
    }
  }

  private beat(): void {
    if (this.closedError) return;
    if (Date.now() - this.lastInbound > this.silenceLimitMs) {
      console.error(`No frame from the gateway for ${this.silenceLimitMs / 1000} s, closing`);
      this.shutDown(new GatewayError("timedOut"));
      return;
    }
    this.call("gateway.ping", {}, 10_000).catch(() => {});
  }

  private shutDown(error: GatewayError): void {
    if (this.closedError) return;
    this.closedError = error;
    clearInterval(this.heartbeat);
    this.socket.close();
    for (const [id] of this.pending) this.settle(id, { error });
    this.resolveReady({ error });
    for (const listener of this.closeListeners) listener(error);
    this.closeListeners.clear();
  }
}
