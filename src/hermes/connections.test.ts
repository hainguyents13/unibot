import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatThread } from "./chat-thread";
import { appTitle, applyFrame, connectionRequestFrom, endNotices, offerFor, targetFrom } from "./connection-request";
import { ConnectorList, mergeConnectors } from "./connectors";
import { GatewayError } from "./gateway-error";

const target = (name: string, extra: Record<string, unknown> = {}) => ({ name, kind: "connector", action: "connect", state: "pending", ...extra });

describe("connection requests", () => {
  it("names apps from their slugs", () => {
    expect(appTitle("google_drive")).toBe("Google Drive");
    expect(targetFrom({ name: "gmail", display: "Gmail (work)" })?.title).toBe("Gmail (work)");
  });

  it("offers what can be done here for each app", () => {
    expect(offerFor(targetFrom(target("gmail", { state: "initiated", connect_url: "https://portal.example/c" }))!)).toEqual({ kind: "signIn", url: "https://portal.example/c" });
    expect(offerFor(targetFrom(target("gmail", { connect_url: "javascript:alert(1)" }))!)).toEqual({ kind: "preparing" });
    expect(offerFor(targetFrom(target("linear", { kind: "mcp", action: "install" }))!)).toEqual({ kind: "approve" });
    expect(offerFor(targetFrom(target("todoist", { kind: "mcp", action: "install", required_env: [{ name: "K" }] }))!)).toEqual({ kind: "elsewhere" });
    expect(offerFor(targetFrom(target("gmail", { state: "expired" }))!)).toEqual({ kind: "retry" });
    expect(offerFor(targetFrom(target("gmail", { state: "connected" }))!)).toEqual({ kind: "none" });
  });

  it("applies only newer frames of the same request, keeping a link the frame left out", () => {
    const request = connectionRequestFrom({ op_id: "op1", seq: 2, targets: [target("gmail", { state: "initiated", connect_url: "https://p.example/x" })] }, "live")!;
    expect(applyFrame(request, { op_id: "op1", seq: 2, targets: [] })).toBeUndefined();
    expect(applyFrame(request, { op_id: "op2", seq: 9, targets: [] })).toBeUndefined();
    const moved = applyFrame(request, { op_id: "op1", seq: 3, targets: [target("gmail", { state: "initiated" })] })!;
    expect(moved.targets[0].connectUrl).toBe("https://p.example/x");
    expect(applyFrame(moved, { op_id: "op1", seq: 4, settled: true, settled_by: "deadline", targets: [] })?.ending).toBe("deadline");
  });

  it("says how a request ended", () => {
    const request = connectionRequestFrom(
      { op_id: "op1", targets: [target("gmail", { state: "connected" }), target("slack", { state: "skipped" }), target("google_drive", { state: "not_connected" })], settled: true, settled_by: "deadline" },
      "live",
    )!;
    expect(endNotices(request)).toEqual(["You connected Gmail", "You chose Not now for Slack", "Nobody finished connecting Google Drive in time."]);
  });
});

/** A chat attached to a pretend gateway that records calls and answers from `answers`. */
async function openChat(answers: Record<string, (params: Record<string, unknown>) => unknown> = {}) {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const channel = {
    call: async (method: string, params: Record<string, unknown> = {}) => {
      calls.push([method, params]);
      const answer = answers[method];
      if (answer) return answer(params);
      if (method === "session.resume") return { session_id: "live", messages: [] };
      return {};
    },
    respond: () => {},
  };
  const thread = new ChatThread("ops", () => channel);
  await thread.open("stored", "legacy");
  return { thread, calls };
}

const ask = (thread: ChatThread, payload: Record<string, unknown>, type = "connection.request") => thread.apply({ type, sessionId: "live", payload });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("a chat's connection card", () => {
  it("shows the Bot's request, marks it as needing you and announces it once", async () => {
    const { thread } = await openChat();
    const alerts: string[] = [];
    thread.alerts.onAlert((a) => alerts.push(a.text));
    ask(thread, { op_id: "op1", seq: 1, targets: [target("gmail", { state: "initiated", connect_url: "https://p.example/x" })] });
    ask(thread, { op_id: "op1", seq: 1, targets: [] });
    expect(thread.getView().connection?.request.targets.map((t) => t.title)).toEqual(["Gmail"]);
    expect(thread.status).toBe("needsYou");
    expect(alerts).toEqual(["Wants to connect Gmail"]);
  });

  it("hands over the sign-in page and ends with what happened once Hermes says so", async () => {
    const { thread } = await openChat();
    ask(thread, { op_id: "op1", seq: 1, targets: [target("gmail", { state: "initiated", connect_url: "https://p.example/x" })] });
    expect(thread.connectApp(thread.getView().connection!.request.targets[0])).toBe("https://p.example/x");
    expect(thread.getView().connection?.opened).toEqual(["gmail"]);
    ask(thread, { op_id: "op1", seq: 2, settled: true, targets: [target("gmail", { state: "connected" })] }, "connection.update");
    expect(thread.getView().connection).toBeUndefined();
    expect(thread.getView().items.at(-1)?.content).toEqual({ kind: "notice", text: "You connected Gmail" });
  });

  it("approves an MCP install and skips the rest as the session's owner", async () => {
    const { thread, calls } = await openChat({ "connection.respond": () => ({ settled: false }) });
    ask(thread, { op_id: "op1", seq: 1, targets: [target("linear", { kind: "mcp", action: "install" }), target("gmail")] });
    const [linear] = thread.getView().connection!.request.targets;
    expect(thread.connectApp(linear)).toBeUndefined();
    thread.skipConnection();
    await flush();
    const answers = calls.filter((c) => c[0] === "connection.respond").map((c) => c[1]);
    expect(answers[0]).toEqual({ owner: { type: "session", session_id: "live" }, op_id: "op1", result: { targets: [{ name: "linear", status: "approved" }] } });
    expect(answers[1].result).toEqual({ targets: [{ name: "linear", status: "skipped" }, { name: "gmail", status: "skipped" }] });
  });

  it("asks for a fresh link when a hosted app's sign-in expired", async () => {
    const { thread, calls } = await openChat({
      "connectors.connect": () => ({ op_id: "op1", seq: 3, targets: [target("gmail", { state: "initiated", connect_url: "https://p.example/new" })] }),
    });
    ask(thread, { op_id: "op1", seq: 2, targets: [target("gmail", { state: "expired" })] });
    thread.retryApp(thread.getView().connection!.request.targets[0]);
    await flush();
    expect(calls.find((c) => c[0] === "connectors.connect")?.[1]).toEqual({ owner: { type: "session", session_id: "live" }, connectors: ["gmail"], reconnect: true });
    expect(thread.getView().connection?.request.targets[0].connectUrl).toBe("https://p.example/new");
  });

  it("drops a card Hermes already let go of", async () => {
    const { thread } = await openChat({
      "connection.respond": () => {
        throw new GatewayError("rpc", "no such operation", 4004);
      },
    });
    ask(thread, { op_id: "op1", seq: 1, targets: [target("gmail")] });
    thread.skipConnection();
    await flush();
    expect(thread.getView().connection).toBeUndefined();
    expect(thread.getView().items.at(-1)?.content).toEqual({ kind: "notice", text: "The request to connect Gmail had already ended." });
  });

  it("brings a waiting request back when the chat attaches again", async () => {
    const { thread } = await openChat({
      "session.resume": () => ({ session_id: "live", messages: [], pending_connection: { op_id: "op7", seq: 4, targets: [target("slack")] } }),
    });
    expect(thread.getView().connection?.request).toMatchObject({ id: "op7", seq: 4 });
  });
});

describe("connected apps", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("merges the catalog, what's connected and the accounts, connected first", () => {
    const merged = mergeConnectors(
      { connectors: [{ connector: "Slack", connected: true }, { connector: "notion", enabled: false }] },
      { connectors: [{ slug: "gmail", name: "Gmail" }, { slug: "slack", name: "Slack" }] },
      { accounts: [{ connector: "slack", connection_id: "c1" }, { connector: "slack", connection_id: "c0", disabled: true }] },
    );
    expect(merged.map((c) => [c.slug, c.isConnected, c.accountIds])).toEqual([
      ["slack", true, ["c1"]],
      ["gmail", false, []],
    ]);
  });

  it("is unavailable without a Nous Portal account", async () => {
    const list = new ConnectorList("ops", () => ({ call: async () => ({ available: false }) }));
    await list.refresh();
    expect(list.getView().phase).toEqual({ kind: "unavailable" });
  });

  it("connects an app: opens the vendor's page, then waits for Hermes to say it's connected", async () => {
    const calls: Array<[string, unknown]> = [];
    let polls = 0;
    const channel = {
      call: async (method: string, params?: unknown) => {
        calls.push([method, params]);
        if (method === "connectors.list") return { available: true, connectors: [{ connector: "gmail", connected: polls >= 2 }] };
        if (method === "connectors.catalog") return { connectors: [{ slug: "gmail", name: "Gmail" }] };
        if (method === "connectors.connect") return { op_id: "op1", targets: [target("gmail", { state: "initiated", connect_url: "https://p.example/g" })] };
        if (method === "connectors.operation.status") return { op_id: "op1", targets: [target("gmail", { state: ++polls < 2 ? "initiated" : "connected" })] };
        return {};
      },
    };
    const list = new ConnectorList("ops", () => channel, 1_000);
    await list.refresh();
    const opened: string[] = [];
    const done = list.connect(list.getView().connectors[0], (url) => opened.push(url));
    await vi.advanceTimersByTimeAsync(1_000);
    await done;
    expect(opened).toEqual(["https://p.example/g"]);
    expect(calls.find((c) => c[0] === "connectors.connect")?.[1]).toEqual({ owner: { type: "account" }, profile: "ops", connectors: ["gmail"] });
    expect(list.getView().connectors[0].isConnected).toBe(true);
    expect(list.getView().notice).toBe("Connected Gmail.");
  });

  it("explains the Nous Portal's refusals in plain words", async () => {
    const channel = {
      call: async (method: string) => {
        if (method === "connectors.list") return { available: true, connectors: [] };
        if (method === "connectors.catalog") return { connectors: [{ slug: "gmail" }] };
        if (method === "connectors.connect") throw new GatewayError("rpc", "portal login required", 4032);
        return {};
      },
    };
    const list = new ConnectorList("ops", () => channel);
    await list.refresh();
    await list.connect(list.getView().connectors[0], () => {});
    expect(list.getView().connecting.gmail).toEqual({ kind: "failed", message: "Sign in to the Nous Portal in the Hermes app first, then try again." });
  });
});
