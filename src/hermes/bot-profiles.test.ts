import { describe, expect, it } from "vitest";
import { botNameProblem, botSlug, createBot, duplicateBot, starterSoul } from "./bot-profiles";

type Row = Record<string, unknown>;

function fakeGateway(runtimeOk: boolean | "unknown" = true) {
  const calls: Array<{ method: string; params: Row }> = [];
  const titles = new Map<string, unknown>();
  const rpc = {
    call: async (method: string, params: Row = {}): Promise<unknown> => {
      calls.push({ method, params });
      switch (method) {
        case "profiles.create":
          return { ok: true, name: params.name };
        case "profiles.list":
          return { profiles: [...titles.keys(), "scout", "throwaway-test", "scout-copy"].map((name) => ({ name, ui_meta: { "hermes-bots": {} } })) };
        case "profiles.configure":
          titles.set(params.name as string, params.ui_meta);
          return { applied: { ui_meta: true } };
        case "setup.runtime_check":
          if (runtimeOk === "unknown") throw new Error("unknown method");
          return { ok: runtimeOk };
        default:
          return {};
      }
    },
  };
  return { rpc, calls };
}

describe("Bot names", () => {
  it("makes the official app's profile name", () => {
    expect(botSlug("  Throwaway Test ")).toBe("throwaway-test");
    expect(botSlug("Résumé Bot!")).toBe("resume-bot");
    expect(botSlug("job_scout 2")).toBe("job_scout-2");
    expect(botSlug("小助手")).toBe("u5c0f-u52a9-u624b");
    expect(botSlug("-Ops-")).toBe("ops");
    expect(botSlug("Trợ lý Nghiên cứu")).toBe("tro-ly-nghien-cuu");
  });

  it("cuts a long name without splitting a word", () => {
    const profile = botSlug("word ".repeat(20));
    expect(profile.length).toBeLessThanOrEqual(64);
    expect(profile.endsWith("word")).toBe(true);
    expect(profile).toMatch(/^[a-z0-9][a-z0-9_-]{0,63}$/);
  });

  it("says why Hermes would refuse a name", () => {
    expect(botNameProblem("   ", [])).toBe("Give your Bot a name.");
    expect(botNameProblem("!!!", [])).toBe("Use at least one letter or number in the name.");
    expect(botNameProblem("Hermes", [])).toContain("keeps the name");
    expect(botNameProblem("Default", [])).toContain("keeps the name");
    expect(botNameProblem("Scout", ["scout"])).toContain("already a Bot");
    expect(botNameProblem("Scout", ["ops"])).toBeUndefined();
  });
});

describe("Making Bots", () => {
  it("creates a fresh profile with shared sign-ins and a starting SOUL.md, then names it", async () => {
    const gateway = fakeGateway();
    const made = await createBot(gateway.rpc, " Throwaway Test ", " Tries things ");
    expect(made).toEqual({ id: "throwaway-test", canReply: true });
    expect(gateway.calls[0]).toEqual({
      method: "profiles.create",
      params: { name: "throwaway-test", share_auth: true, soul: starterSoul("Throwaway Test", "throwaway-test", "Tries things"), description: "Tries things" },
    });
    expect(starterSoul("Throwaway Test", "throwaway-test", "Tries things")).toContain("**Mission:** Tries things");
    const named = gateway.calls.find((c) => c.method === "profiles.configure")!;
    expect(named.params).toMatchObject({ name: "throwaway-test", ui_meta: { "hermes-bots": { title: "Throwaway Test" } } });
  });

  it("copies a Bot from the original, under its own name", async () => {
    const gateway = fakeGateway(false);
    const made = await duplicateBot(gateway.rpc, "scout", "Scout copy", "Finds jobs");
    expect(made).toEqual({ id: "scout-copy", canReply: false });
    expect(gateway.calls[0].params).toEqual({ name: "scout-copy", clone_from: "scout", share_auth: true, description: "Finds jobs" });
  });

  it("still makes the Bot when the gateway can't say whether it can reply", async () => {
    const made = await createBot(fakeGateway("unknown").rpc, "Scout", "");
    expect(made).toEqual({ id: "scout", canReply: undefined });
  });
});
