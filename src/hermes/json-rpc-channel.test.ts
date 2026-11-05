import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSocket } from "./fake-socket";
import { JsonRpcChannel, type GatewayEvent, type ServerRequest } from "./json-rpc-channel";

describe("JsonRpcChannel", () => {
  let socket: FakeSocket;
  let channel: JsonRpcChannel;

  beforeEach(() => {
    vi.useFakeTimers();
    socket = new FakeSocket();
    channel = new JsonRpcChannel(socket);
    channel.start();
  });

  afterEach(() => {
    channel.close();
    vi.useRealTimers();
  });

  it("matches replies to requests by id", async () => {
    const first = channel.call("profiles.list");
    const second = channel.call("groups.list");
    const [a, b] = socket.sent;
    socket.receive({ jsonrpc: "2.0", id: b.id, result: { groups: [] } });
    socket.receive({ jsonrpc: "2.0", id: a.id, result: { profiles: [] } });
    await expect(first).resolves.toEqual({ profiles: [] });
    await expect(second).resolves.toEqual({ groups: [] });
  });

  it("turns a JSON-RPC error into an rpc error with the gateway's message", async () => {
    const call = channel.call("session.resume");
    socket.receive({ jsonrpc: "2.0", id: socket.sent[0].id, error: { code: -32000, message: "No such session" } });
    await expect(call).rejects.toMatchObject({ kind: "rpc", code: -32000, detail: "No such session" });
  });

  it("times a call out", async () => {
    const call = channel.call("slow", {}, 1_000);
    vi.advanceTimersByTime(1_001);
    await expect(call).rejects.toMatchObject({ kind: "timedOut" });
  });

  it("reads gateway.ready and its dialect", async () => {
    const ready = channel.waitUntilReady();
    socket.sendReady({ replay_epoch: "e1" });
    await expect(ready).resolves.toEqual({ dialect: "legacy", replayEpoch: "e1" });

    const canonicalSocket = new FakeSocket();
    const canonical = new JsonRpcChannel(canonicalSocket);
    canonical.start();
    const canonicalReady = canonical.waitUntilReady();
    canonicalSocket.sendReady({ session_authority: true });
    await expect(canonicalReady).resolves.toMatchObject({ dialect: "canonical" });
    canonical.close();
  });

  it("splits events from the gateway's own requests", () => {
    const events: GatewayEvent[] = [];
    const requests: ServerRequest[] = [];
    channel.onEvent((e) => events.push(e));
    channel.onRequest((r) => requests.push(r));

    socket.receive({
      jsonrpc: "2.0",
      method: "event",
      params: { type: "message.delta", session_id: "s1", seq: 4, payload: { text: "Hi" } },
    });
    socket.receive({ jsonrpc: "2.0", id: "srq-1", method: "approval", params: { session_id: "s1" } });

    expect(events).toEqual([{ type: "message.delta", sessionId: "s1", seq: 4, payload: { text: "Hi" } }]);
    expect(requests).toEqual([{ id: "srq-1", method: "approval", params: { session_id: "s1" } }]);
  });

  it("answers and declines server requests with their string ids", () => {
    channel.respond("srq-1", { choice: "once" });
    channel.decline("srq-2", -32001, "Not supported");
    expect(socket.sent).toEqual([
      { jsonrpc: "2.0", id: "srq-1", result: { choice: "once" } },
      { jsonrpc: "2.0", id: "srq-2", error: { code: -32001, message: "Not supported" } },
    ]);
  });

  it("pings every 15 s while frames keep coming", () => {
    vi.advanceTimersByTime(15_000);
    expect(socket.sentMethods()).toEqual(["gateway.ping"]);
    socket.receive({ jsonrpc: "2.0", id: socket.sent[0].id, result: {} });
    vi.advanceTimersByTime(15_000);
    expect(socket.sentMethods()).toEqual(["gateway.ping", "gateway.ping"]);
  });

  it("closes a socket that stays silent past the limit, failing what's waiting", async () => {
    const closed = vi.fn();
    channel.onClose(closed);
    const call = channel.call("profiles.list", {}, 120_000);
    vi.advanceTimersByTime(60_000);
    await expect(call).rejects.toMatchObject({ kind: "timedOut" });
    expect(socket.closed).toBe(true);
    expect(closed).toHaveBeenCalledWith(expect.objectContaining({ kind: "timedOut" }));
  });

  it("fails waiting calls when the gateway hangs up", async () => {
    const call = channel.call("profiles.list");
    socket.drop();
    await expect(call).rejects.toMatchObject({ kind: "disconnected" });
    await expect(channel.call("again")).rejects.toMatchObject({ kind: "disconnected" });
  });
});
