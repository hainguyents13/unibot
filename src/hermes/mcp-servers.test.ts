import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APP_PRESETS, presetReady } from "./app-presets";
import { GatewayError } from "./gateway-error";
import { draftBody, emptyDraft, isDraftComplete, McpServerList, mcpServerFrom, scrub, serverLocation, splitArguments, type JsonRequest } from "./mcp-servers";

type Call = { path: string; method: string; body?: Record<string, unknown>; timeoutMs?: number };

/** A pretend gateway answering the MCP routes from `answer`, recording each request. */
function setUp(answer: (call: Call) => unknown, options: { unencrypted?: boolean; sessionId?: string; rpc?: (method: string, params: unknown) => unknown } = {}) {
  const calls: Call[] = [];
  const rpcCalls: Array<[string, unknown]> = [];
  const request: JsonRequest = async (path, opts = {}) => {
    const call = { path, method: opts.method ?? "GET", body: opts.body as Record<string, unknown> | undefined, timeoutMs: opts.timeoutMs };
    calls.push(call);
    const result = answer(call);
    if (result instanceof Error) throw result;
    return result;
  };
  const channel = {
    call: async (method: string, params?: unknown) => {
      rpcCalls.push([method, params]);
      return options.rpc?.(method, params) ?? {};
    },
  };
  const list = new McpServerList("ops", {
    request,
    channel: () => channel,
    sessionId: () => options.sessionId,
    isUnencrypted: () => options.unencrypted ?? false,
    pollMs: 1_000,
  });
  return { list, calls, rpcCalls };
}

describe("reading servers", () => {
  it("keeps only the names of set env values, and marks plugin servers", () => {
    expect(mcpServerFrom({ name: "files", command: "/usr/bin/npx", args: ["-y", "server-fs"], env: { KEY: "sk-•••", EMPTY: "" } })).toEqual({
      name: "files",
      url: undefined,
      command: "/usr/bin/npx",
      args: ["-y", "server-fs"],
      envNames: ["KEY"],
      auth: undefined,
      enabled: true,
      plugin: undefined,
    });
    expect(mcpServerFrom({ name: "p", source: "plugin", enabled: false })).toMatchObject({ plugin: "", enabled: false });
  });

  it("says where a server runs", () => {
    expect(serverLocation(mcpServerFrom({ name: "a", url: "https://mcp.linear.app/mcp" })!)).toBe("mcp.linear.app");
    expect(serverLocation(mcpServerFrom({ name: "b", command: "/usr/bin/npx", args: ["-y", "server-fs", "/srv"] })!)).toBe("npx server-fs");
  });

  it("splits arguments on spaces, keeping quoted ones together", () => {
    expect(splitArguments(` -y  "my server" /srv ""`)).toEqual(["-y", "my server", "/srv", ""]);
  });

  it("takes typed secrets out of text", () => {
    expect(scrub("bad token ghp_secret123 rejected", ["ghp_secret123"])).toBe("bad token ••• rejected");
  });
});

describe("drafts", () => {
  it("sends a token only as the bearer token of a header-auth web server", () => {
    const draft = { ...emptyDraft, name: " gh ", url: "https://api.githubcopilot.com/mcp/", auth: "token" as const, token: " t0ken " };
    expect(isDraftComplete(draft)).toBe(true);
    expect(draftBody(draft, "ops")).toEqual({ name: "gh", url: "https://api.githubcopilot.com/mcp/", args: [], auth: "header", bearer_token: "t0ken", profile: "ops" });
    expect(isDraftComplete({ ...draft, token: "" })).toBe(false);
    expect(isDraftComplete({ ...draft, url: "ftp://x" })).toBe(false);
  });

  it("sends a program's env values, leaving blank ones out", () => {
    const draft = { ...emptyDraft, name: "plane", kind: "program" as const, command: "uvx", arguments: "plane-mcp-server stdio", env: { A: "1", B: " " } };
    expect(draftBody(draft, "ops")).toEqual({ name: "plane", command: "uvx", args: ["plane-mcp-server", "stdio"], env: { A: "1" }, auth: "none", profile: "ops" });
  });

  it("builds GitHub and Plane from their presets", () => {
    const [github, plane] = APP_PRESETS;
    expect(presetReady(github, {})).toBe(false);
    expect(draftBody(github.draft({ token: "t" }), "ops")).toMatchObject({ url: "https://api.githubcopilot.com/mcp/", auth: "header", bearer_token: "t" });
    expect(presetReady(plane, { PLANE_API_KEY: "k", PLANE_WORKSPACE_SLUG: "acme" })).toBe(true);
    expect(draftBody(plane.draft({ PLANE_API_KEY: "k", PLANE_WORKSPACE_SLUG: "acme" }), "ops")).toMatchObject({
      command: "uvx",
      args: ["plane-mcp-server", "stdio"],
      env: { PLANE_API_KEY: "k", PLANE_WORKSPACE_SLUG: "acme" },
    });
  });

  it("keeps Composio's key in the env, out of mcp-remote's arguments", () => {
    const composio = APP_PRESETS.find((p) => p.id === "composio")!;
    expect(presetReady(composio, { COMPOSIO_API_KEY: " " })).toBe(false);
    const body = draftBody(composio.draft({ COMPOSIO_API_KEY: "secret-key" }), "ops");
    expect(body).toMatchObject({
      name: "composio",
      command: "npx",
      args: ["-y", "mcp-remote", "https://connect.composio.dev/mcp", "--header", "x-consumer-api-key:${COMPOSIO_API_KEY}"],
      env: { COMPOSIO_API_KEY: "secret-key" },
    });
    expect(JSON.stringify(body.args)).not.toContain("secret-key");
  });
});

describe("McpServerList", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("lists the profile's servers, keeping the old list when a reload fails", async () => {
    let fail = false;
    const { list, calls } = setUp(() => (fail ? new GatewayError("unreachable") : { servers: [{ name: "linear", url: "https://mcp.linear.app/mcp", auth: "oauth" }] }));
    await list.refresh();
    expect(calls[0].path).toBe("/api/mcp/servers?profile=ops");
    expect(list.getView().servers.map((s) => s.name)).toEqual(["linear"]);
    fail = true;
    await list.refresh();
    expect(list.getView().phase.kind).toBe("ready");
    expect(list.getView().servers).toHaveLength(1);
  });

  it("switches a server back when the gateway refuses, and says so", async () => {
    const { list, calls } = setUp((c) => (c.method === "PUT" ? new GatewayError("http", "Not allowed", 403) : { servers: [{ name: "files", command: "npx" }] }));
    await list.refresh();
    await list.setEnabled(list.getView().servers[0], false);
    expect(calls[1]).toMatchObject({ path: "/api/mcp/servers/files/enabled?profile=ops", method: "PUT", body: { enabled: false, profile: "ops" } });
    expect(list.getView().servers[0].enabled).toBe(true);
    expect(list.getView().problem).toContain("Couldn't turn off “files”");
    expect(list.getView().needsApply).toBe(false);
  });

  it("won't send a token over plain http without your say-so, and keeps it out of errors", async () => {
    const { list, calls } = setUp((c) => (c.method === "POST" ? new GatewayError("http", "token sekret-123 is invalid", 400) : { servers: [] }), { unencrypted: true });
    const draft = { ...emptyDraft, name: "gh", url: "https://x.example/mcp", auth: "token" as const, token: "sekret-123" };
    expect(await list.add(draft)).toBe(false);
    expect(calls).toHaveLength(0);
    expect(await list.add(draft, true)).toBe(false);
    expect(calls[0].body).toMatchObject({ bearer_token: "sekret-123" });
    expect(list.getView().problem).toBe("Couldn't add “gh”: token ••• is invalid (HTTP 400)");
  });

  it("tests a server, telling a missing sign-in apart from a failure", async () => {
    let reply: unknown = { ok: false, error: "OAuth authentication required for linear" };
    const { list, calls } = setUp((c) => (c.path.includes("/test") ? reply : { servers: [{ name: "linear" }] }));
    await list.refresh();
    await list.test(list.getView().servers[0]);
    expect(calls[1]).toMatchObject({ method: "POST", timeoutMs: 120_000 });
    expect(list.getView().checks.linear).toEqual({ kind: "failed", message: "Sign in first, then test again." });
    reply = { ok: true, tools: [{ name: "search" }] };
    await list.test(list.getView().servers[0]);
    expect(list.getView().checks.linear).toEqual({ kind: "passed", tools: [{ name: "search", description: undefined }] });
  });

  it("installs a catalog server with its keys, then waits for one the gateway fetches in the background", async () => {
    let listed: unknown[] = [];
    const { list, calls } = setUp((c) => {
      if (c.path.startsWith("/api/mcp/catalog/install")) return { background: true };
      if (c.path.startsWith("/api/mcp/catalog")) return { entries: [{ name: "todoist", auth_type: "env", required_env: [{ name: "TODOIST_API_TOKEN" }], needs_install: true }] };
      return { servers: listed };
    });
    await list.loadCatalog();
    const entry = list.getView().catalog[0];
    expect(entry).toMatchObject({ name: "todoist", authType: "env", needsInstall: true, requiredEnv: [{ name: "TODOIST_API_TOKEN", required: true }] });
    expect(await list.install(entry, { TODOIST_API_TOKEN: "tk", OPTIONAL: "" })).toBe(true);
    expect(calls.find((c) => c.path.startsWith("/api/mcp/catalog/install"))?.body).toEqual({ name: "todoist", env: { TODOIST_API_TOKEN: "tk" }, enable: true, profile: "ops" });
    expect(list.getView().notice).toContain("fetching “todoist”");
    listed = [{ name: "todoist", command: "npx" }];
    await vi.advanceTimersByTimeAsync(2_500);
    expect(list.getView().servers.map((s) => s.name)).toEqual(["todoist"]);
    expect(list.getView().notice).toBeUndefined();
  });

  it("signs in through the provider's page and waits for the gateway to have the token", async () => {
    let polls = 0;
    const opened: string[] = [];
    const { list, calls } = setUp((c) => {
      if (c.path.includes("/auth")) return { flow_id: "f1", status: "pending", authorization_url: "https://linear.app/oauth/authorize?x=1" };
      if (c.path.startsWith("/api/mcp/oauth/flows/f1")) return ++polls < 2 ? { status: "authorization_required" } : { status: "approved", tools: [{ name: "search" }] };
      return { servers: [{ name: "linear", auth: "oauth" }] };
    });
    await list.refresh();
    const done = list.signIn(list.getView().servers[0], (url) => opened.push(url));
    await vi.advanceTimersByTimeAsync(0);
    expect(opened).toEqual(["https://linear.app/oauth/authorize?x=1"]);
    expect(list.getView().signIns.linear).toEqual({ kind: "waiting" });
    await vi.advanceTimersByTimeAsync(2_000);
    await done;
    expect(calls.filter((c) => c.path === "/api/mcp/oauth/flows/f1")).toHaveLength(2);
    expect(list.getView().signIns.linear).toBeUndefined();
    expect(list.getView().checks.linear).toMatchObject({ kind: "passed" });
    expect(list.getView().notice).toBe("Signed in to “linear”.");
  });

  it("cancels a sign-in here and on the gateway, and reports an expired one", async () => {
    const { list, calls } = setUp((c) => {
      if (c.path.includes("/auth")) return { flow_id: "f2", status: "pending", authorization_url: "https://x.example/a" };
      if (c.path.startsWith("/api/mcp/oauth/flows/f2") && c.method === "GET") return new GatewayError("http", "gone", 404);
      return { servers: [{ name: "a" }, { name: "b" }] };
    });
    await list.refresh();
    const [a] = list.getView().servers;
    const first = list.signIn(a, () => {});
    await vi.advanceTimersByTimeAsync(0);
    await list.cancelSignIn(a);
    await vi.advanceTimersByTimeAsync(1_000);
    await first;
    expect(calls.some((c) => c.path === "/api/mcp/oauth/flows/f2" && c.method === "DELETE")).toBe(true);
    expect(list.getView().signIns.a).toBeUndefined();

    const second = list.signIn(a, () => {});
    await vi.advanceTimersByTimeAsync(1_000);
    await second;
    expect(list.getView().signIns.a).toEqual({ kind: "failed", message: "The sign-in expired. Try again." });
  });

  it("applies changes to the open chat, never with `always`", async () => {
    const { list, rpcCalls } = setUp(() => ({}), { sessionId: "live-1", rpc: () => ({ status: "reloaded", unavailable: ["plane"] }) });
    await list.applyNow();
    expect(rpcCalls).toEqual([["reload.mcp", { session_id: "live-1", confirm: true }]]);
    expect(list.getView().notice).toBe("Applied, but these didn't connect: plane.");
  });

  it("asks for an open chat before applying", async () => {
    const { list, rpcCalls } = setUp(() => ({}));
    expect(list.canApplyNow).toBe(false);
    await list.applyNow();
    expect(rpcCalls).toHaveLength(0);
    expect(list.getView().problem).toBe("Open a chat with this Bot first, then apply.");
  });
});
