import { describe, expect, it } from "vitest";
import { GatewayError } from "./gateway-error";
import { createRoom, mentions, roomSummaryFrom, RoomThread, seatsNote, suggestedRoomName, userEventId, type RoomSummary } from "./room";

const summary: RoomSummary = {
  id: "r1",
  name: "Launch",
  members: [
    { id: "forge", profile: "forge", handle: "forge" },
    { id: "scribe", profile: "scribe", handle: "scribe", displayName: "Scribe Bot" },
  ],
  updatedAt: 0,
  latestSeq: 0,
};

const ev = (seq: number, kind: string, payload: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  seq,
  kind,
  event_id: `e${seq}`,
  payload,
  created_at: 1_800_000_000 + seq,
  ...extra,
});

/** A pretend room service answering `groups.*` calls from an event log and a status. */
function service(log: unknown[], status: Record<string, unknown> = { running: true }) {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const channel = {
    call: async (method: string, params: Record<string, unknown> = {}) => {
      calls.push([method, params]);
      if (method === "groups.log") {
        return { events: log.filter((e) => (e as { seq: number }).seq > (params.since_seq as number)), has_more: false };
      }
      if (method === "groups.state") return { driver_status: status };
      if (method === "groups.send") {
        log.push(ev(log.length + 1, "message.user", { text: (params.payload as { text: string }).text }, { event_id: await userEventId(params.event_id as string) }));
        return {};
      }
      return {};
    },
  };
  return { channel, calls };
}

describe("roomSummaryFrom", () => {
  it("reads a room and its members, and skips disbanded ones", () => {
    expect(
      roomSummaryFrom({ room_id: "r", name: "Ops", members: [{ member_id: "m1", profile: "ops" }], updated_at: 10, latest_seq: 4 }),
    ).toEqual({ id: "r", name: "Ops", members: [{ id: "m1", profile: "ops", handle: "ops", displayName: undefined }], updatedAt: 10_000, latestSeq: 4 });
    expect(roomSummaryFrom({ room_id: "r", disbanded_at: 5 })).toBeUndefined();
  });
});

describe("createRoom", () => {
  it("seats each Bot by its profile and returns the room", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const channel = {
      call: async (method: string, params: Record<string, unknown> = {}) => {
        calls.push([method, params]);
        return { room: { room_id: "r9", name: params.name, members: params.members, updated_at: 20 } };
      },
    };
    const room = await createRoom(channel, "  Launch room ", ["writer", "scout"]);
    const [method, params] = calls[0];
    expect(method).toBe("groups.create");
    expect(params.room_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(params).toEqual({
      room_id: params.room_id,
      name: "Launch room",
      members: [
        { member_id: "writer", profile: "writer", handle: "writer", target: { kind: "local", profile: "writer" } },
        { member_id: "scout", profile: "scout", handle: "scout", target: { kind: "local", profile: "scout" } },
      ],
    });
    expect(room).toMatchObject({ id: "r9", name: "Launch room", updatedAt: 20_000 });
    expect(room.members.map((m) => m.handle)).toEqual(["writer", "scout"]);
  });

  it("passes on the gateway's reason", async () => {
    const channel = {
      call: async () => {
        throw new GatewayError("rpc", "members must contain between 2 and 6 entries", 5111);
      },
    };
    await expect(createRoom(channel, "Solo", ["writer"])).rejects.toThrow("members must contain between 2 and 6 entries");
  });
});

describe("editing a room", () => {
  it("renames with an event ID that makes a repeat harmless", async () => {
    const { channel, calls } = service([]);
    const room = new RoomThread("r1", "Launch room", summary.members, () => channel);
    await room.rename("Launch");
    expect(calls[0][0]).toBe("groups.rename");
    expect(calls[0][1]).toMatchObject({ room_id: "r1", name: "Launch" });
    expect(calls[0][1].event_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(room.getView().name).toBe("Launch");
  });

  it("keeps the old name when the gateway refuses a rename", async () => {
    const channel = {
      call: async () => {
        throw new GatewayError("rpc", "worker unavailable", 4123);
      },
    };
    const room = new RoomThread("r1", "Launch room", summary.members, () => channel);
    await expect(room.rename("Launch")).rejects.toThrow("worker unavailable");
    expect(room.getView().name).toBe("Launch room");
  });

  it("deletes by disbanding the room", async () => {
    const { channel, calls } = service([]);
    await new RoomThread("r1", "Launch room", summary.members, () => channel).disband();
    expect(calls[0][0]).toBe("groups.disband");
    expect(calls[0][1]).toMatchObject({ room_id: "r1", cancel_id: expect.stringMatching(/^unibot-/) });
  });

  it("can't be renamed or deleted while offline", async () => {
    const room = new RoomThread("r1", "Launch room", summary.members, () => undefined);
    await expect(room.rename("Launch")).rejects.toMatchObject({ kind: "disconnected" });
    await expect(room.disband()).rejects.toMatchObject({ kind: "disconnected" });
  });
});

describe("new room helpers", () => {
  it("names a room after its Bots", () => {
    expect(suggestedRoomName([])).toBe("");
    expect(suggestedRoomName(["Forge"])).toBe("Forge");
    expect(suggestedRoomName(["Forge", "Atlas", "Scribe"])).toBe("Forge, Atlas & Scribe");
  });

  it("says why a room can't be made yet", () => {
    expect(seatsNote(0, 0)).toContain("has none yet");
    expect(seatsNote(0, 1)).toContain("has one");
    expect(seatsNote(0, 3)).toBe("Pick two to six Bots.");
    expect(seatsNote(1, 3)).toBe("Pick one more Bot.");
    expect(seatsNote(2, 3)).toBeUndefined();
  });
});

describe("RoomThread", () => {
  it("reads the log into a transcript, naming members and noting hand-offs", async () => {
    const { channel } = service([
      ev(1, "message.user", { text: "Plan the launch" }),
      ev(2, "message.member", { member_id: "forge", text: "Code is ready. @scribe, the post?" }),
      ev(3, "turn.failed", { member_id: "scribe", error: "Rate limited" }),
      ev(4, "turn.started", { member_id: "forge" }),
    ]);
    const room = new RoomThread(summary.id, summary.name, summary.members, () => channel);
    await room.sync();
    expect(room.getView().items.map((i) => i.content)).toEqual([
      { kind: "user", text: "Plan the launch" },
      { kind: "member", memberId: "forge", text: "Code is ready. @scribe, the post?" },
      { kind: "notice", text: "Forge handed off to Scribe Bot" },
      { kind: "notice", text: "Scribe Bot couldn't answer: Rate limited" },
    ]);
    expect(room.cursor).toBe(4);
    expect(room.latestMessage()?.text).toBe("Forge: Code is ready. @scribe, the post?");
  });

  it("reads only what's new on the next sync", async () => {
    const log = [ev(1, "message.user", { text: "One" })];
    const { channel, calls } = service(log);
    const room = new RoomThread("r1", "Launch", summary.members, () => channel);
    await room.sync();
    log.push(ev(2, "message.member", { member_id: "forge", text: "Two" }));
    await room.sync();
    expect(room.getView().items).toHaveLength(2);
    expect(calls.filter((c) => c[0] === "groups.log").map((c) => c[1].since_seq)).toEqual([0, 1]);
  });

  it("shows your message as working until it comes back in the log", async () => {
    const { channel, calls } = service([]);
    const room = new RoomThread("r1", "Launch", summary.members, () => channel);
    await room.sync();
    const sending = room.send("@forge ship it");
    await Promise.resolve();
    expect(room.status).toBe("working");
    await sending;
    expect(calls.find((c) => c[0] === "groups.send")?.[1]).toMatchObject({ room_id: "r1", payload: { text: "@forge ship it" } });
    expect(room.getView().pending).toEqual([]);
    expect(room.getView().items.at(-1)?.content).toEqual({ kind: "user", text: "@forge ship it" });
  });

  it("puts a message that didn't send back for the box", async () => {
    const { channel } = service([]);
    const failing = {
      call: async (method: string, params?: Record<string, unknown>) => {
        if (method === "groups.send") throw new GatewayError("rpc", "Room service is not running", 1);
        return channel.call(method, params);
      },
    };
    const room = new RoomThread("r1", "Launch", summary.members, () => failing);
    await room.sync();
    await room.send("Hello");
    expect(room.takeUnsent()).toBe("Hello");
    expect(room.getView().items.at(-1)?.content).toMatchObject({ kind: "notice" });
  });

  it("lists approvals and retries from the room's status, and says who is replying", async () => {
    const { channel } = service([], {
      running: true,
      member_activity: [
        { member_id: "forge", status: "running" },
        { member_id: "scribe", status: "queued" },
      ],
      pending_actions: [
        {
          kind: "approval",
          member_id: "forge",
          task_id: "t1",
          execution_generation: 2,
          request_id: "req-1",
          approval: { command: "rm -rf dist", choices: ["once", "session", "deny"] },
        },
        { kind: "retry", task_id: "t2" },
      ],
    });
    const room = new RoomThread("r1", "Launch", summary.members, () => channel);
    await room.sync();
    const view = room.getView();
    expect(view.working).toEqual(["forge"]);
    expect(view.approvals[0]).toMatchObject({ memberId: "forge", taskId: "t1", prompt: { id: "req-1", choices: ["once", "deny"] } });
    expect(view.retries).toEqual(["t2"]);
    expect(room.status).toBe("needsYou");
  });

  it("answers an approval with what the room service needs", async () => {
    const { channel, calls } = service([], {
      running: true,
      pending_actions: [{ kind: "approval", member_id: "forge", task_id: "t1", execution_generation: 2, request_id: "req-1", approval: { command: "ls" } }],
    });
    const room = new RoomThread("r1", "Launch", summary.members, () => channel);
    await room.sync();
    await room.answer(room.getView().approvals[0], "once");
    expect(calls).toContainEqual([
      "groups.approve",
      { room_id: "r1", member_id: "forge", task_id: "t1", execution_generation: 2, choice: "once", request_id: "req-1" },
    ]);
  });

  it("alerts about new replies after the first read, and about approvals once", async () => {
    const log: unknown[] = [ev(1, "message.member", { member_id: "forge", text: "Old news" })];
    const { channel } = service(log, {
      running: true,
      pending_actions: [{ kind: "approval", member_id: "forge", task_id: "t1", execution_generation: 1, request_id: "req-1", approval: { command: "ls -la" } }],
    });
    const room = new RoomThread("r1", "Launch", summary.members, () => channel);
    const alerts: unknown[] = [];
    room.alerts.onAlert((a) => alerts.push(a));
    await room.sync();
    log.push(ev(2, "message.member", { member_id: "scribe", text: "Post is *ready*" }));
    await room.sync();
    expect(alerts).toEqual([
      { kind: "needsYou", text: "Forge wants to run “ls -la”" },
      { kind: "reply", text: "Scribe Bot: Post is ready" },
    ]);
  });

  it("can't send while the gateway's room service is off", async () => {
    const channel = { call: async (method: string) => (method === "groups.log" ? { events: [] } : {}) };
    const room = new RoomThread("r1", "Launch", summary.members, () => channel);
    await room.sync();
    expect(room.getView()).toMatchObject({ driverRunning: false, canSend: false });
  });
});

describe("mentions", () => {
  it("finds @handles the way the gateway does", () => {
    expect(mentions("@forge and @scribe.bot, not email@x")).toEqual(["forge", "scribe.bot", "x"]);
  });
});
