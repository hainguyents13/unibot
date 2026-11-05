import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GatewayAddress } from "./gateway-address";
import { FakeSocket } from "./fake-socket";
import type { Loopback } from "./native-sign-in";
import { Session, withRecentGateway, type SessionDeps, type SessionState } from "./session";
import { fakeHttp, json, MemoryTokenStore, tokenResponse } from "./test-support";

const ADDRESS = "http://100.101.102.103:9119";
const gateway = GatewayAddress.parse(ADDRESS);

/** A pretend gateway: REST routes plus sockets that answer like `hermes dashboard`. */
function setUp(options: { refresh?: () => ReturnType<typeof json>; savedAddress?: string; rooms?: unknown[] } = {}) {
  const rooms = () => options.rooms ?? [];
  let refreshes = 0;
  const { http, requests } = fakeHttp({
    "GET /api/status": () => json(200, { auth_required: true, auth_flows: ["native_pkce"] }),
    "POST /auth/native/token": () => json(200, tokenResponse(100)),
    "POST /auth/native/refresh": options.refresh ?? (() => json(200, tokenResponse(++refreshes))),
    "POST /api/auth/ws-ticket": () => json(200, { ticket: "t" }),
  });
  const sockets: FakeSocket[] = [];
  const store = new MemoryTokenStore();
  let recent = options.savedAddress ? [options.savedAddress] : [];
  let opened = "";
  const loopback: Loopback = {
    start: async () => 5000,
    wait: async () => `code=c&state=${new URL(opened).searchParams.get("state")}`,
    cancel: async () => {},
  };
  const deps: SessionDeps = {
    http,
    tokenStore: store,
    loopback,
    openUrl: async (url) => {
      opened = url;
    },
    settings: {
      recentGateways: async () => recent,
      saveRecentGateways: async (addresses) => {
        recent = addresses;
      },
    },
    makeSocket: async () => {
      const socket = new FakeSocket();
      socket.reply = (frame) => {
        if (frame.method === "client.capabilities") return {};
        if (frame.method === "profiles.list") {
          return {
            profiles: [
              { name: "ops", canonical_session: { id: "stored-ops", last_active: 10 } },
              { name: "scout", canonical_session: null },
            ],
          };
        }
        if (frame.method === "session.resume") return { session_id: "live-ops", messages: [] };
        if (frame.method === "groups.list") return { rooms: rooms() };
        if (frame.method === "groups.log") return { events: [{ seq: 1, kind: "message.user", payload: { text: "Morning, team" }, created_at: 50 }] };
        if (frame.method === "groups.state") return { driver_status: { running: true } };
        if (frame.method === "prompt.submit") return {};
        return undefined;
      };
      sockets.push(socket);
      queueMicrotask(() => socket.sendReady());
      return socket;
    },
  };
  return { deps, store, sockets, requests, savedAddress: () => recent[0], recent: () => recent };
}

function signedIn(state: SessionState) {
  if (state.kind !== "signedIn") throw new Error(`expected signedIn, got ${state.kind}`);
  return state;
}

describe("Session", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("starts signed out when nothing was saved", async () => {
    const session = Session.live(setUp().deps);
    await session.restore();
    expect(session.getState()).toEqual({ kind: "signedOut", address: "" });
  });

  it("signs in through the browser, saves the sign-in and reads the roster", async () => {
    const { deps, store, savedAddress } = setUp();
    const session = Session.live(deps);
    await session.restore();
    await session.signIn("100.101.102.103:9119");
    await vi.advanceTimersByTimeAsync(0);

    const state = signedIn(session.getState());
    expect(state.link).toEqual({ kind: "online", dialect: "legacy" });
    expect(state.bots.map((b) => b.id)).toEqual(["ops", "scout"]);
    expect(store.saved.get(gateway.baseUrl)?.refreshToken).toBe("refresh-100");
    expect(savedAddress()).toBe(ADDRESS);
    await session.signOut();
  });

  it("restores a saved sign-in by refreshing it, then connects", async () => {
    const { deps, store, requests } = setUp({ savedAddress: ADDRESS });
    await store.save(gateway, { refreshToken: "refresh-0", provider: "password", userId: "u" });
    const session = Session.live(deps);
    await session.restore();
    await vi.advanceTimersByTimeAsync(0);

    expect(signedIn(session.getState()).link.kind).toBe("online");
    expect(requests.map((r) => new URL(r.url).pathname)).toEqual(["/auth/native/refresh", "/api/auth/ws-ticket"]);
    await session.signOut();
  });

  describe("recent gateways", () => {
    const OTHER = "https://hermes.example.com";

    it("lists the newest first, once each, and at most five", () => {
      expect(withRecentGateway([OTHER, ADDRESS], ADDRESS)).toEqual([ADDRESS, OTHER]);
      expect(withRecentGateway(["a", "b", "c", "d", "e"], "f")).toEqual(["f", "a", "b", "c", "d"]);
    });

    it("opens a gateway with its saved sign-in, without the browser", async () => {
      const { deps, store, requests, recent } = setUp({ savedAddress: OTHER });
      await store.save(gateway, { refreshToken: "refresh-0", provider: "password", userId: "u" });
      const openUrl = vi.spyOn(deps, "openUrl");
      const session = Session.live(deps);
      await session.restore();
      expect(session.recentGateways()).toEqual([OTHER]);

      await session.signIn(ADDRESS);
      await vi.advanceTimersByTimeAsync(0);
      expect(signedIn(session.getState()).link.kind).toBe("online");
      expect(openUrl).not.toHaveBeenCalled();
      expect(requests.map((r) => new URL(r.url).pathname)).not.toContain("/api/status");
      expect(recent()).toEqual([ADDRESS, OTHER]);
      await session.signOut();
    });

    it("switches gateways, keeping the sign-in it leaves", async () => {
      const { deps, store, recent } = setUp({ savedAddress: ADDRESS });
      const other = GatewayAddress.parse(OTHER);
      await store.save(gateway, { refreshToken: "refresh-0", provider: "password", userId: "u" });
      await store.save(other, { refreshToken: "refresh-1", provider: "password", userId: "u" });
      const openUrl = vi.spyOn(deps, "openUrl");
      const session = Session.live(deps);
      await session.restore();
      await vi.advanceTimersByTimeAsync(0);
      expect(signedIn(session.getState()).gateway.baseUrl).toBe(ADDRESS);

      await session.switchGateway(OTHER);
      await vi.advanceTimersByTimeAsync(0);
      const state = signedIn(session.getState());
      expect(state.gateway.baseUrl).toBe(OTHER);
      expect(state.link.kind).toBe("online");
      expect(store.saved.has(gateway.baseUrl)).toBe(true);
      expect(openUrl).not.toHaveBeenCalled();
      expect(recent()).toEqual([OTHER, ADDRESS]);
      await session.signOut();
    });

    it("forgets a gateway and its saved sign-in", async () => {
      const { deps, store, recent } = setUp({ savedAddress: ADDRESS });
      const session = Session.live(deps);
      await session.restore();
      await store.save(gateway, { refreshToken: "refresh-0", provider: "password", userId: "u" });
      const before = session.getState();

      await session.forgetGateway(ADDRESS);
      expect(session.recentGateways()).toEqual([]);
      expect(recent()).toEqual([]);
      expect(store.saved.size).toBe(0);
      expect(session.getState()).not.toBe(before);
    });
  });

  it("asks for a gateway that offers app sign-in", async () => {
    const { deps } = setUp();
    deps.http = fakeHttp({ "GET /api/status": () => json(200, { auth_flows: ["password"] }) }).http;
    const session = Session.live(deps);
    await session.restore();
    await session.signIn(ADDRESS);
    expect(session.getState()).toMatchObject({ kind: "signedOut", problem: expect.stringContaining("doesn't offer browser sign-in") });
  });

  it("says what's wrong with a mistyped address", async () => {
    const session = Session.live(setUp().deps);
    await session.restore();
    await session.signIn("http://hermes.example.com");
    expect(session.getState()).toMatchObject({ kind: "signedOut", problem: expect.stringContaining("use https://") });
  });

  it("goes offline when the socket drops and reconnects after the backoff", async () => {
    const { deps, store, sockets } = setUp({ savedAddress: ADDRESS });
    await store.save(gateway, { refreshToken: "refresh-0", provider: "password", userId: "u" });
    const session = Session.live(deps);
    await session.restore();
    await vi.advanceTimersByTimeAsync(0);
    expect(sockets).toHaveLength(1);

    sockets[0].drop();
    await vi.advanceTimersByTimeAsync(0);
    expect(signedIn(session.getState()).link).toEqual({ kind: "offline", message: expect.stringContaining("closed") });

    await vi.advanceTimersByTimeAsync(300);
    expect(sockets).toHaveLength(2);
    expect(signedIn(session.getState()).link.kind).toBe("online");
    await session.signOut();
  });

  it("explains a Tailscale address it can't reach", async () => {
    const { deps, store } = setUp({ savedAddress: ADDRESS });
    await store.save(gateway, { refreshToken: "refresh-0", provider: "password", userId: "u" });
    deps.http = async () => {
      throw new Error("connection timed out");
    };
    const session = Session.live(deps);
    await session.restore();
    await vi.advanceTimersByTimeAsync(0);
    expect(signedIn(session.getState()).link).toEqual({
      kind: "offline",
      message: expect.stringContaining("check that Tailscale is on"),
    });
    await session.signOut();
  });

  it("signs out with a reason when the gateway rejects the saved sign-in", async () => {
    const { deps, store } = setUp({ savedAddress: ADDRESS, refresh: () => json(401, { error: "invalid_grant" }) });
    await store.save(gateway, { refreshToken: "refresh-0", provider: "password", userId: "u" });
    const session = Session.live(deps);
    await session.restore();
    await vi.advanceTimersByTimeAsync(0);
    expect(session.getState()).toEqual({ kind: "signedOut", address: ADDRESS, problem: "Your sign-in expired. Sign in again." });
    expect(store.saved.size).toBe(0);
  });

  describe("chats", () => {
    async function online() {
      const setup = setUp({ savedAddress: ADDRESS });
      await setup.store.save(gateway, { refreshToken: "refresh-0", provider: "password", userId: "u" });
      const session = Session.live(setup.deps);
      await session.restore();
      await vi.advanceTimersByTimeAsync(0);
      return { ...setup, session, socket: setup.sockets[0] };
    }

    it("attaches the chats the gateway has a Bot Chat for, and not the others", async () => {
      const { socket, session } = await online();
      expect(socket.sent.filter((f) => f.method === "session.resume").map((f) => f.params)).toEqual([
        { profile: "ops", session_id: "stored-ops" },
      ]);
      expect(session.chat("ops").sessionId).toBe("live-ops");
      await session.signOut();
    });

    it("routes events to the chat whose session they belong to", async () => {
      const { socket, session } = await online();
      const ops = session.chat("ops");
      socket.receive({ jsonrpc: "2.0", method: "event", params: { type: "message.start", session_id: "live-ops", payload: {} } });
      socket.receive({ jsonrpc: "2.0", method: "event", params: { type: "message.delta", session_id: "live-ops", payload: { text: "On it" } } });
      socket.receive({ jsonrpc: "2.0", method: "event", params: { type: "message.delta", session_id: "elsewhere", payload: { text: "Not ours" } } });
      expect(ops.getView().draft).toBe("On it");
      expect(signedIn(session.getState()).bots.find((b) => b.id === "ops")?.status).toBe("working");
      await session.signOut();
    });

    it("shows the newest message in the sidebar straight away, without waiting for the roster", async () => {
      const { session } = await online();
      session.chat("ops").send("**Check** the backups");
      const ops = signedIn(session.getState()).bots.find((b) => b.id === "ops");
      expect(ops?.preview).toBe("Check the backups");
      expect(ops?.lastActivity).toBeGreaterThan(10_000);
      await session.signOut();
    });

    it("passes a chat's alerts on with where they lead", async () => {
      const { socket, session } = await online();
      const alerts: unknown[] = [];
      session.onAlert((a) => alerts.push(a));
      socket.receive({ jsonrpc: "2.0", id: "srq-7", method: "approval", params: { session_id: "live-ops", command: "reboot" } });
      expect(alerts).toEqual([{ kind: "needsYou", text: "Wants to run “reboot”", target: "bot:ops", title: "Ops" }]);
      await session.signOut();
    });

    it("puts an approval in its chat and marks the Bot as needing you", async () => {
      const { socket, session } = await online();
      socket.receive({ jsonrpc: "2.0", id: "srq-1", method: "approval", params: { session_id: "live-ops", command: "ls" } });
      expect(session.chat("ops").getView().requests).toMatchObject([{ id: "srq-1", kind: "approval" }]);
      expect(signedIn(session.getState()).bots.find((b) => b.id === "ops")?.status).toBe("needsYou");
      await session.signOut();
    });

    it("declines requests no chat here can show, and skips masked prompts instead", async () => {
      const { socket, session } = await online();
      socket.receive({ jsonrpc: "2.0", id: "srq-2", method: "approval", params: { session_id: "someone-else" } });
      socket.receive({ jsonrpc: "2.0", id: "srq-3", method: "secret", params: { session_id: "someone-else", env_var: "X" } });
      await vi.advanceTimersByTimeAsync(0);
      expect(socket.sent).toContainEqual({
        jsonrpc: "2.0",
        id: "srq-2",
        error: { code: 4404, message: 'Unibot can\'t answer "approval" requests.' },
      });
      expect(socket.sent).toContainEqual({ jsonrpc: "2.0", id: "srq-3", result: { value: "" } });
      await session.signOut();
    });

    it("lets go of chat sessions when the link drops, and attaches again on reconnect", async () => {
      const { sockets, session } = await online();
      const ops = session.chat("ops");
      sockets[0].drop();
      await vi.advanceTimersByTimeAsync(0);
      expect(ops.sessionId).toBeUndefined();
      await vi.advanceTimersByTimeAsync(300);
      expect(ops.sessionId).toBe("live-ops");
      await session.signOut();
    });
  });

  it("lists rooms beside the Bots, with their newest message", async () => {
    const { deps, store } = setUp({
      savedAddress: ADDRESS,
      rooms: [{ room_id: "r1", name: "Launch", members: [{ member_id: "ops", profile: "ops" }], updated_at: 40, latest_seq: 1 }],
    });
    await store.save(gateway, { refreshToken: "refresh-0", provider: "password", userId: "u" });
    const session = Session.live(deps);
    await session.restore();
    await vi.advanceTimersByTimeAsync(0);
    expect(signedIn(session.getState()).rooms).toEqual([
      { id: "r1", name: "Launch", memberCount: 1, preview: "Morning, team", lastActivity: 50_000, status: "idle" },
    ]);
    expect(session.room("r1")?.getView().items).toHaveLength(1);
    await session.signOut();
  });

  it("lists a new room at once, and a room list read before it was made doesn't drop it", async () => {
    const { deps, store, sockets } = setUp({ savedAddress: ADDRESS });
    const make = deps.makeSocket;
    let held: number | undefined;
    let lists = 0;
    deps.makeSocket = async (url) => {
      const socket = (await make(url)) as FakeSocket;
      const reply = socket.reply!;
      socket.reply = (frame) => {
        // The second room list stays out until the test answers it.
        if (frame.method === "groups.list" && ++lists === 2) return void (held = frame.id as number);
        if (frame.method === "groups.create") {
          const params = frame.params as { name: string; members: unknown[] };
          return { room: { room_id: "r-new", name: params.name, members: params.members, updated_at: 60 } };
        }
        return reply(frame);
      };
      return socket;
    };
    await store.save(gateway, { refreshToken: "refresh-0", provider: "password", userId: "u" });
    const session = Session.live(deps);
    await session.restore();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(held).toBeDefined();

    expect(await session.createRoom("Ops & Scout", ["ops", "scout"])).toBe("r-new");
    expect(signedIn(session.getState()).rooms.map((r) => [r.id, r.name, r.memberCount])).toEqual([["r-new", "Ops & Scout", 2]]);
    expect(session.room("r-new")).toBeDefined();

    // The list read before the room was made comes back without it.
    sockets[0].receive({ jsonrpc: "2.0", id: held, result: { rooms: [] } });
    await vi.advanceTimersByTimeAsync(0);
    expect(signedIn(session.getState()).rooms.map((r) => r.id)).toEqual(["r-new"]);
    await session.signOut();
  });

  describe("editing a room", () => {
    const launch = { room_id: "r1", name: "Launch room", members: [{ member_id: "ops", profile: "ops" }], updated_at: 40, latest_seq: 1 };

    /** Signed in with room r1 listed; the room list read after `holdFrom` reads stays out until answered. */
    async function withRoom(gatewayAnswers: (frame: Record<string, unknown>) => unknown = () => ({})) {
      const { deps, store, sockets } = setUp({ savedAddress: ADDRESS, rooms: [launch] });
      const make = deps.makeSocket;
      let lists = 0;
      let held: number | undefined;
      deps.makeSocket = async (url) => {
        const socket = (await make(url)) as FakeSocket;
        const reply = socket.reply!;
        socket.reply = (frame) => {
          if (frame.method === "groups.list" && ++lists === 2) return void (held = frame.id as number);
          if (frame.method === "groups.rename" || frame.method === "groups.disband") return gatewayAnswers(frame);
          return reply(frame);
        };
        return socket;
      };
      await store.save(gateway, { refreshToken: "refresh-0", provider: "password", userId: "u" });
      const session = Session.live(deps);
      await session.restore();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(held).toBeDefined();
      /** Answers the held list as it was before the edit: room r1 under its old name. */
      const answerStaleList = async () => {
        sockets[0].receive({ jsonrpc: "2.0", id: held, result: { rooms: [launch] } });
        await vi.advanceTimersByTimeAsync(0);
      };
      return { session, sockets, answerStaleList };
    }

    it("a list read before a rename can't put the old name back", async () => {
      const { session, answerStaleList } = await withRoom();
      await session.renameRoom("r1", "  Launch ");
      expect(signedIn(session.getState()).rooms[0].name).toBe("Launch");
      await answerStaleList();
      expect(signedIn(session.getState()).rooms[0].name).toBe("Launch");
      expect(session.room("r1")?.getView().name).toBe("Launch");
      await session.signOut();
    });

    it("a list read before a delete can't bring the room back", async () => {
      const { session, answerStaleList } = await withRoom();
      await session.deleteRoom("r1");
      expect(signedIn(session.getState()).rooms).toEqual([]);
      await answerStaleList();
      expect(signedIn(session.getState()).rooms).toEqual([]);
      expect(session.room("r1")).toBeUndefined();
      await session.signOut();
    });

    it("keeps the room when the gateway refuses to delete it", async () => {
      const { session, sockets } = await withRoom();
      sockets[0].reply = (frame) => {
        if (frame.method !== "groups.disband") return undefined;
        queueMicrotask(() => sockets[0].receive({ jsonrpc: "2.0", id: frame.id, error: { code: 4123, message: "worker unavailable" } }));
        return undefined;
      };
      await expect(session.deleteRoom("r1")).rejects.toThrow("worker unavailable");
      expect(signedIn(session.getState()).rooms.map((r) => r.id)).toEqual(["r1"]);
      await session.signOut();
    });
  });

  it("keeps the Bots coming when the gateway has no rooms to list", async () => {
    const { deps, store } = setUp({ savedAddress: ADDRESS });
    const make = deps.makeSocket;
    deps.makeSocket = async (url) => {
      const socket = (await make(url)) as FakeSocket;
      const reply = socket.reply!;
      socket.reply = (frame) => (frame.method === "groups.list" ? undefined : reply(frame));
      return socket;
    };
    await store.save(gateway, { refreshToken: "refresh-0", provider: "password", userId: "u" });
    const session = Session.live(deps);
    await session.restore();
    await vi.advanceTimersByTimeAsync(0);
    expect(signedIn(session.getState()).bots.map((b) => b.id)).toEqual(["ops", "scout"]);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(signedIn(session.getState()).link.kind).toBe("online");
    await session.signOut();
  });

  it("stops connecting once disposed, even mid-restore, and keeps the sign-in saved", async () => {
    const { deps, store, sockets } = setUp({ savedAddress: ADDRESS });
    await store.save(gateway, { refreshToken: "refresh-0", provider: "password", userId: "u" });
    const abandoned = Session.live(deps);
    const restoring = abandoned.restore();
    abandoned.dispose();
    await restoring;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets).toHaveLength(0);

    const kept = Session.live(deps);
    await kept.restore();
    await vi.advanceTimersByTimeAsync(0);
    kept.dispose();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets).toHaveLength(1);
    expect(sockets[0].closed).toBe(true);
    expect(store.saved.size).toBe(1);
  });

  it("forgets the sign-in and stops connecting on sign out", async () => {
    const { deps, store, sockets } = setUp({ savedAddress: ADDRESS });
    await store.save(gateway, { refreshToken: "refresh-0", provider: "password", userId: "u" });
    const session = Session.live(deps);
    await session.restore();
    await vi.advanceTimersByTimeAsync(0);

    await session.signOut();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(session.getState()).toEqual({ kind: "signedOut", address: ADDRESS, problem: undefined });
    expect(store.saved.size).toBe(0);
    expect(sockets).toHaveLength(1);
    expect(sockets[0].closed).toBe(true);
  });
});
