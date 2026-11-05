import { describe, expect, it } from "vitest";
import { openBotChat } from "./bot-chat";
import { GatewayError } from "./gateway-error";

/** A channel that answers each method from `answers`, recording the calls. */
function rpc(answers: Record<string, (params: Record<string, unknown>) => unknown>) {
  const calls: Array<[string, Record<string, unknown>]> = [];
  return {
    calls,
    call: async (method: string, params: Record<string, unknown> = {}) => {
      calls.push([method, params]);
      const answer = answers[method];
      if (!answer) throw new GatewayError("rpc", `unexpected ${method}`, -1);
      return answer(params);
    },
  };
}

describe("openBotChat", () => {
  it("resumes the Bot Chat the roster named, without looking it up", async () => {
    const channel = rpc({
      "session.resume": () => ({
        session_id: "live-1",
        messages: [{ role: "user", text: "hi" }],
        running: true,
        inflight: { user: "hi", assistant: "Hel" },
        open_requests: [{ id: "srq-1", method: "approval", params: { session_id: "live-1" } }],
      }),
    });
    const opened = await openBotChat("default", "stored-1", channel);
    expect(channel.calls).toEqual([["session.resume", { profile: "default", session_id: "stored-1" }]]);
    expect(opened).toMatchObject({
      sessionId: "live-1",
      running: true,
      inflight: { user: "hi", assistant: "Hel" },
      openRequests: [{ id: "srq-1", method: "approval" }],
    });
  });

  it("finds the Bot Chat by its exact title when the roster didn't say", async () => {
    const channel = rpc({
      "session.list": () => ({ sessions: [{ id: "old", resolved_id: "resolved" }] }),
      "session.resume": () => ({ session_id: "live" }),
    });
    await openBotChat("ops", undefined, channel);
    expect(channel.calls[0]).toEqual(["session.list", { profile: "ops", title: "Bot Chat", include_hidden: true }]);
    expect(channel.calls[1][1].session_id).toBe("resolved");
  });

  it("creates and titles a hidden Bot Chat only when none exists", async () => {
    const channel = rpc({
      "session.list": () => ({ sessions: [] }),
      "session.create": () => ({ session_id: "new" }),
      "session.title": () => ({}),
    });
    const opened = await openBotChat("ops", undefined, channel);
    expect(opened.sessionId).toBe("new");
    expect(channel.calls.map((c) => c[0])).toEqual(["session.list", "session.create", "session.title"]);
    expect(channel.calls[1][1]).toEqual({ profile: "ops", title: "Bot Chat", hidden: true, follow_profile_config: true });
  });

  it("adopts the Bot Chat another app created at the same moment", async () => {
    let lists = 0;
    const channel = rpc({
      "session.list": () => ({ sessions: lists++ === 0 ? [] : [{ id: "theirs" }] }),
      "session.create": () => ({ session_id: "mine" }),
      "session.title": () => {
        throw new GatewayError("rpc", "title taken", 4022);
      },
      "session.resume": (p) => ({ session_id: `live-${p.session_id}` }),
    });
    expect((await openBotChat("ops", undefined, channel)).sessionId).toBe("live-theirs");
  });

  it("stops rather than creating a second chat when the lookup fails", async () => {
    const channel = rpc({
      "session.list": () => {
        throw new GatewayError("disconnected");
      },
    });
    await expect(openBotChat("ops", undefined, channel)).rejects.toMatchObject({ kind: "disconnected" });
    expect(channel.calls.map((c) => c[0])).toEqual(["session.list"]);
  });

  it("attaches without the history when it's over the gateway's size limit", async () => {
    const channel = rpc({
      "session.resume": (p) => {
        if (!p.omit_messages) throw new GatewayError("rpc", "too large", 4130);
        return { session_id: "live" };
      },
    });
    expect(await openBotChat("ops", "s", channel)).toMatchObject({ sessionId: "live", historyOmitted: true });
  });
});
