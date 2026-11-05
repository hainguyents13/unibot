import { describe, expect, it } from "vitest";
import { GatewayAddress } from "./gateway-address";
import { GatewayError } from "./gateway-error";
import { BotScreen, screenSocketUrl, viewerHash } from "./screen";

const gateway = GatewayAddress.parse("https://hermes.example.com");

function display(answers: Record<string, (params: Record<string, unknown>) => unknown>) {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const channel = {
    call: async (method: string, params: Record<string, unknown> = {}) => {
      calls.push([method, params]);
      const answer = answers[method];
      if (!answer) throw new GatewayError("rpc", "Method not found", -32601);
      return answer(params);
    },
  };
  return { channel, calls };
}

const running = { supported: true, installed: true, running: true, profile_key: "pk-ops", lease: { holder: "agent", epoch: 1 } };

describe("BotScreen", () => {
  it("knows a gateway without display.* has no screen", async () => {
    const { channel } = display({});
    const screen = new BotScreen("ops", () => channel, () => gateway);
    await screen.refresh();
    expect(screen.hasScreen).toBe(false);
  });

  it("watches with a single-use ticket on the screen's own socket", async () => {
    const { channel } = display({
      "display.status": () => running,
      "display.observe": () => ({ ticket: "t 1", viewer_id: "viewer-1", path: "/api/display/ws", ...running }),
    });
    const screen = new BotScreen("ops", () => channel, () => gateway);
    await screen.refresh();
    expect(screen.hasScreen).toBe(true);
    await screen.watch();
    expect(screen.getView().socketUrl).toBe("wss://hermes.example.com/api/display/ws?display_ticket=t%201");
  });

  it("takes over and hands back, knowing it's you by the viewer's hash", async () => {
    const hash = await viewerHash("viewer-1");
    const { channel, calls } = display({
      "display.status": () => running,
      "display.observe": () => ({ ticket: "t", viewer_id: "viewer-1" }),
      "display.lease.acquire": () => ({ lease: { holder: "human", viewer_hash: hash, epoch: 2 } }),
      "display.lease.release": () => ({ lease: { holder: "agent", epoch: 3 } }),
    });
    const screen = new BotScreen("ops", () => channel, () => gateway);
    await screen.refresh();
    await screen.watch();
    await screen.takeOver();
    expect(screen.getView().control).toBe("you");
    expect(calls.find((c) => c[0] === "display.lease.acquire")?.[1]).toEqual({ profile: "ops", viewer_id: "viewer-1" });
    await screen.handBack();
    expect(screen.getView().control).toBe("agent");
  });

  it("shows someone else in control from a lease event for its profile, ignoring older ones", async () => {
    const { channel } = display({ "display.status": () => running });
    const screen = new BotScreen("ops", () => channel, () => gateway);
    await screen.refresh();
    screen.apply({ type: "display.lease", payload: { profile_key: "pk-ops", lease: { holder: "human", viewer_hash: "someone", epoch: 5 } } });
    expect(screen.getView().control).toBe("someoneElse");
    screen.apply({ type: "display.lease", payload: { profile_key: "pk-ops", lease: { holder: "agent", epoch: 4 } } });
    expect(screen.getView().control).toBe("someoneElse");
    screen.apply({ type: "display.lease", payload: { profile_key: "pk-other", lease: { holder: "agent", epoch: 9 } } });
    expect(screen.getView().control).toBe("someoneElse");
  });

  it("alerts when the Bot asks you to take over", async () => {
    const { channel } = display({ "display.status": () => running });
    const screen = new BotScreen("ops", () => channel, () => gateway);
    const alerts: unknown[] = [];
    screen.alerts.onAlert((a) => alerts.push(a));
    await screen.refresh();
    screen.apply({ type: "display.lease", payload: { profile_key: "pk-ops", lease: { holder: "agent", epoch: 2, reason: "Solve the CAPTCHA" } } });
    expect(alerts).toEqual([{ kind: "needsYou", text: "Asks you to take over: Solve the CAPTCHA" }]);
  });

  it("says why starting failed", async () => {
    const { channel } = display({
      "display.status": () => ({ ...running, running: false }),
      "display.start": () => {
        throw new GatewayError("rpc", "TigerVNC isn't installed", 1);
      },
    });
    const screen = new BotScreen("ops", () => channel, () => gateway);
    await screen.refresh();
    await screen.start();
    expect(screen.getView()).toMatchObject({ problem: "TigerVNC isn't installed", isBusy: false });
  });
});

describe("screenSocketUrl", () => {
  it("uses ws for a plain-http tailnet gateway and keeps a path prefix", () => {
    expect(screenSocketUrl(GatewayAddress.parse("100.101.102.103:9119"), "/api/display/ws", "x")).toBe(
      "ws://100.101.102.103:9119/api/display/ws?display_ticket=x",
    );
    expect(screenSocketUrl(GatewayAddress.parse("https://h.example.com/hermes"), "/elsewhere", "x")).toBe(
      "wss://h.example.com/hermes/api/display/ws?display_ticket=x",
    );
  });
});
