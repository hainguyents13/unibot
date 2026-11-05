// A pretend `hermes dashboard` on 127.0.0.1 for checking Unibot end to end without a real gateway.
// Logs each request and whether it carried an Origin header.
import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";

const PORT = Number(process.argv[2] ?? 19119);
let rotation = 0;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

function tokens() {
  rotation += 1;
  return {
    access_token: `fake-access-${rotation}`,
    refresh_token: `fake-refresh-${rotation}`,
    expires_at: Date.now() / 1000 + 900,
    provider: "password",
    user_id: "fake-user",
  };
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  log(req.method, url.pathname, `origin=${JSON.stringify(req.headers.origin ?? null)}`, `auth=${req.headers.authorization ? "bearer" : "none"}`);
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (req.method === "GET" && url.pathname === "/api/status") {
      return send(res, 200, { version: "fake", auth_required: true, auth_flows: ["password", "native_pkce"] });
    }
    if (req.method === "GET" && url.pathname === "/auth/native/authorize") {
      const redirect = new URL(url.searchParams.get("redirect_uri"));
      redirect.searchParams.set("code", "fake-code");
      redirect.searchParams.set("state", url.searchParams.get("state"));
      res.writeHead(302, { Location: redirect.toString() });
      return res.end();
    }
    if (req.method === "POST" && url.pathname === "/auth/native/token") {
      const parsed = JSON.parse(body || "{}");
      log("  token exchange", { code: parsed.code, verifierLength: parsed.code_verifier?.length });
      return send(res, 200, tokens());
    }
    if (req.method === "POST" && url.pathname === "/auth/native/refresh") return send(res, 200, tokens());
    const job = url.pathname.match(/^\/api\/cron\/jobs\/([^/]+)\/(pause|resume|trigger)$/);
    if (url.pathname === "/api/cron/jobs" && req.method === "GET") {
      if (!req.headers.authorization) return send(res, 401, { detail: "Not signed in" });
      return send(res, 200, url.searchParams.get("profile") === "default" ? jobs : []);
    }
    if (job && req.method === "POST") {
      const found = jobs.find((j) => j.id === decodeURIComponent(job[1]));
      if (!found) return send(res, 404, { detail: "No such job" });
      if (job[2] === "pause") Object.assign(found, { enabled: false, state: "paused" });
      if (job[2] === "resume") Object.assign(found, { enabled: true, state: "scheduled" });
      if (job[2] === "trigger") {
        return setTimeout(() => send(res, 200, Object.assign(found, { last_status: "ok", last_error: null, last_run_at: new Date().toISOString() })), 1200);
      }
      return send(res, 200, found);
    }
    if (url.pathname.startsWith("/api/mcp/")) {
      if (!req.headers.authorization) return send(res, 401, { detail: "Not signed in" });
      return mcpRoute(req.method, url, body ? JSON.parse(body) : {}, res);
    }
    if (req.method === "GET" && url.pathname === "/fake-oauth") {
      // The provider's page: opening it signs in, as if you'd approved there.
      const flow = mcpFlows.get(url.searchParams.get("flow"));
      if (flow) flow.status = "approved";
      res.writeHead(200, { "Content-Type": "text/html" });
      return res.end("<p>Authorization received. You can close this page.</p>");
    }
    if (req.method === "POST" && url.pathname === "/api/auth/ws-ticket") {
      if (!req.headers.authorization) return send(res, 401, { detail: "Not signed in" });
      return send(res, 200, { ticket: `ticket-${randomBytes(4).toString("hex")}` });
    }
    send(res, 404, { detail: "Not Found" });
  });
});

// MCP servers, as `hermes_cli/web_routers/mcp.py` serves them. Tokens and env values are logged
// only by length.
const mcpServers = new Map([["default", [{ name: "linear", url: "https://mcp.linear.app/mcp", auth: "oauth", enabled: true }]]]);
const mcpFlows = new Map();
const MCP_CATALOG = [
  { name: "notion", description: "Pages and databases in Notion.", auth_type: "oauth", url: "https://mcp.notion.com/mcp" },
  { name: "todoist", description: "Tasks in Todoist.", auth_type: "env", command: "npx", required_env: [{ name: "TODOIST_API_TOKEN", prompt: "Todoist API token" }] },
];

function mcpRoute(method, url, body, res) {
  const profile = url.searchParams.get("profile") ?? "default";
  const list = mcpServers.get(profile) ?? mcpServers.set(profile, []).get(profile);
  const named = /^\/api\/mcp\/servers\/([^/]+)(?:\/(enabled|test|auth))?$/.exec(url.pathname);
  const flow = /^\/api\/mcp\/oauth\/flows\/(.+)$/.exec(url.pathname);
  if (url.pathname === "/api/mcp/servers" && method === "GET") return send(res, 200, { servers: list });
  if (url.pathname === "/api/mcp/servers" && method === "POST") {
    log("  add", body.name, { auth: body.auth, tokenLength: body.bearer_token?.length, env: Object.keys(body.env ?? {}) });
    if (list.some((s) => s.name === body.name)) return send(res, 409, { detail: `${body.name} already exists` });
    const env = Object.fromEntries(Object.keys(body.env ?? {}).map((k) => [k, "•••"]));
    list.push({ name: body.name, url: body.url, command: body.command, args: body.args, env, auth: body.auth === "none" ? undefined : body.auth, enabled: true });
    return send(res, 200, { ok: true });
  }
  if (url.pathname === "/api/mcp/catalog") return send(res, 200, { entries: MCP_CATALOG.map((e) => ({ ...e, installed: list.some((s) => s.name === e.name) })) });
  if (url.pathname === "/api/mcp/catalog/install") {
    const entry = MCP_CATALOG.find((e) => e.name === body.name);
    if (!entry) return send(res, 404, { detail: "Not in the catalog" });
    list.push({ name: entry.name, url: entry.url, command: entry.command, auth: entry.auth_type === "oauth" ? "oauth" : undefined, enabled: true });
    return send(res, 200, { ok: true });
  }
  if (flow) {
    const id = decodeURIComponent(flow[1]);
    if (method === "DELETE") return mcpFlows.delete(id), send(res, 200, { ok: true });
    const state = mcpFlows.get(id);
    if (!state) return send(res, 404, { detail: "No such flow" });
    return send(res, 200, state.status === "approved" ? { status: "approved", tools: [{ name: "search" }, { name: "create_issue" }] } : { status: "authorization_required" });
  }
  if (named) {
    const name = decodeURIComponent(named[1]);
    const server = list.find((s) => s.name === name);
    if (!server) return send(res, 404, { detail: `No server named ${name}` });
    if (named[2] === "enabled") return (server.enabled = body.enabled), send(res, 200, { ok: true });
    if (!named[2] && method === "DELETE") return list.splice(list.indexOf(server), 1), send(res, 200, { ok: true });
    if (named[2] === "test") return setTimeout(() => send(res, 200, { ok: true, tools: [{ name: "search", description: "Find things" }] }), 800);
    if (named[2] === "auth") {
      const id = `flow-${randomBytes(3).toString("hex")}`;
      mcpFlows.set(id, { status: "authorization_required" });
      return send(res, 200, { flow_id: id, status: "authorization_required", authorization_url: `http://127.0.0.1:${PORT}/fake-oauth?flow=${id}` });
    }
  }
  send(res, 404, { detail: "Not Found" });
}

const PROFILES = {
  profiles: [
    { name: "default", description: "General help", canonical_session: { id: "stored-default", preview: "**Morning** summary is ready", last_active: Date.now() / 1000 - 120 } },
    { name: "job-scout", ui_meta: { "hermes-bots": { title: "Job Scout" } }, canonical_session: { id: "s2", preview: "Found 3 new roles", last_active: Date.now() / 1000 - 3600 } },
    { name: "hidden-one", ui_meta: { "hermes-bots": { hidden: true } } },
  ],
};

server.on("upgrade", (req, socket) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  log("WS", url.pathname, `ticket=${url.searchParams.get("ticket")}`, `origin=${JSON.stringify(req.headers.origin ?? null)}`);
  const accept = createHash("sha1").update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const sendText = (obj) => {
    const payload = Buffer.from(JSON.stringify(obj));
    const head = payload.length < 126 ? Buffer.from([0x81, payload.length]) : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 255]);
    socket.write(Buffer.concat([head, payload]));
  };
  // Sent at once, as the real gateway does, before the client may be listening.
  sendText({ jsonrpc: "2.0", method: "event", params: { type: "gateway.ready", payload: { replay_epoch: "fake-epoch" } } });

  let buffer = Buffer.alloc(0);
  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 2) {
      const opcode = buffer[0] & 15;
      let len = buffer[1] & 127;
      let offset = 2;
      if (len === 126) { len = buffer.readUInt16BE(2); offset = 4; }
      else if (len === 127) { len = Number(buffer.readBigUInt64BE(2)); offset = 10; }
      if (buffer.length < offset + 4 + len) return;
      const mask = buffer.subarray(offset, offset + 4);
      const data = Buffer.from(buffer.subarray(offset + 4, offset + 4 + len)).map((b, i) => b ^ mask[i % 4]);
      buffer = buffer.subarray(offset + 4 + len);
      if (opcode === 8) { log("WS close from client"); socket.end(); return; }
      if (opcode !== 1) continue;
      const frame = JSON.parse(data.toString());
      if (typeof frame.id === "string" && !frame.method) {
        log("  answer to", frame.id, JSON.stringify(frame.result ?? frame.error));
        const waiting = approvals.get(frame.id);
        approvals.delete(frame.id);
        waiting?.(frame.result?.choice);
        continue;
      }
      // File contents would flood the log; their size is logged where they're read.
      log("  rpc", frame.method, JSON.stringify(frame.params ?? {}, (key, value) => (key === "content_base64" || key === "data_url" ? "…" : value)));
      const reply = (result) => sendText({ jsonrpc: "2.0", id: frame.id, result });
      const event = (type, payload) => sendText({ jsonrpc: "2.0", method: "event", params: { type, session_id: LIVE, payload } });
      switch (frame.method) {
        case "profiles.list":
          reply(PROFILES);
          break;
        case "session.list":
          reply({ sessions: chats.has(frame.params.profile) ? [{ id: `stored-${frame.params.profile}` }] : [] });
          break;
        case "session.create":
          chats.set(frame.params.profile, []);
          reply({ session_id: LIVE });
          break;
        case "session.resume":
          reply({ session_id: LIVE, messages: chats.get(frame.params.profile) ?? HISTORY, running: false });
          break;
        case "prompt.submit":
          reply({ status: "streaming" });
          playTurn(frame.params.text, event, sendText);
          break;
        case "session.interrupt":
          reply({});
          interrupted = true;
          break;
        case "commands.catalog":
          reply({
            pairs: [["/summarize", "Summarize a page"], ["/status", "Show session status"], ["/new", "Start a new session"], ["/btw", "Ask on the side"]],
            skills: { "/summarize": {} },
            commands: { "/status": {}, "/new": {}, "/btw": {} },
          });
          break;
        case "command.dispatch":
          if (frame.params.name === "summarize") reply({ type: "skill", message: `[Summarize skill] ${frame.params.arg}` });
          else sendText({ jsonrpc: "2.0", id: frame.id, error: { code: 4018, message: `not a quick/plugin/skill command: ${frame.params.name}` } });
          break;
        case "slash.exec":
          reply({ output: "Model     deepseek-chat (fake)\nContext   1,204 / 64,000 tokens\nSession   live-1" });
          break;
        case "groups.list":
          reply({
            rooms: [
              ...(launchGone ? [] : [{ room_id: "room-1", name: launchName, members: ROOM_MEMBERS, updated_at: Date.now() / 1000 - 600, latest_seq: roomLog.length }]),
              ...madeRooms.map(({ log, ...room }) => ({ ...room, latest_seq: log.length })),
            ],
          });
          break;
        case "groups.create": {
          const { room_id, name, members } = frame.params;
          if (!Array.isArray(members) || members.length < 2 || members.length > 6) {
            sendText({ jsonrpc: "2.0", id: frame.id, error: { code: 5111, message: "members must contain between 2 and 6 entries" } });
            break;
          }
          const room = { room_id, name, members, updated_at: Date.now() / 1000, log: [] };
          madeRooms.push(room);
          reply({ room: { room_id, name, members, updated_at: room.updated_at, latest_seq: 0 } });
          break;
        }
        case "groups.rename": {
          const made = madeRoom(frame.params.room_id);
          if (made) made.name = frame.params.name;
          else launchName = frame.params.name;
          reply({ room: { room_id: frame.params.room_id, name: frame.params.name } });
          break;
        }
        case "groups.disband": {
          const index = madeRooms.findIndex((r) => r.room_id === frame.params.room_id);
          if (index >= 0) madeRooms.splice(index, 1);
          else launchGone = true;
          reply({ tombstone: {} });
          break;
        }
        case "groups.log":
          reply({ events: (madeRoom(frame.params.room_id)?.log ?? roomLog).filter((e) => e.seq > frame.params.since_seq), has_more: false });
          break;
        case "groups.state":
          if (madeRoom(frame.params.room_id)) {
            reply({ room: { members: madeRoom(frame.params.room_id).members }, driver_status: { running: true, member_activity: [], pending_actions: [] } });
            break;
          }
          reply({ room: { members: ROOM_MEMBERS }, driver_status: { running: true, member_activity: roomWorking ? [{ member_id: "default", status: "running" }] : [], pending_actions: roomApproval ? [roomApproval] : [] } });
          break;
        case "groups.send": {
          const made = madeRoom(frame.params.room_id);
          if (made) {
            reply({});
            const eventId = `user:${createHash("sha256").update(frame.params.event_id).digest("hex")}`;
            made.log.push({ seq: made.log.length + 1, kind: "message.user", event_id: eventId, payload: frame.params.payload, created_at: Date.now() / 1000 });
            break;
          }
          reply({});
          const clientId = frame.params.event_id;
          roomLog.push({ seq: roomLog.length + 1, kind: "message.user", event_id: `user:${createHash("sha256").update(clientId).digest("hex")}`, payload: frame.params.payload, created_at: Date.now() / 1000 });
          roomWorking = true;
          setTimeout(() => {
            // Each request has its own ID, as on a real gateway; the app announces each one once.
            roomApproval = { kind: "approval", member_id: "default", task_id: "task-1", execution_generation: 1, request_id: `room-req-${Date.now()}`, approval: { command: "git push --tags", description: "Publishes the release tag." } };
          }, 600);
          break;
        }
        case "groups.approve":
          reply({});
          roomApproval = null;
          setTimeout(() => {
            roomWorking = false;
            roomLog.push({ seq: roomLog.length + 1, kind: "message.member", event_id: `m-${roomLog.length + 1}`, payload: { member_id: "default", text: "Tag pushed. @job-scout, your turn." }, created_at: Date.now() / 1000 });
          }, 500);
          break;
        case "connectors.list":
          // No Nous Portal account here, as on most self-hosted gateways.
          reply({ available: false });
          break;
        case "reload.mcp":
          reply({ status: "reloaded", unavailable: [] });
          break;
        case "display.status":
          reply({ supported: false, installed: false, running: false });
          break;
        case "image.attach_bytes":
          log("  image bytes", Buffer.from(frame.params.content_base64, "base64").length);
          reply({ attached: true, path: `/tmp/hermes/${frame.params.filename}` });
          break;
        case "file.attach": {
          const bytes = Buffer.from(frame.params.data_url.split(",")[1], "base64").length;
          log("  file bytes", bytes);
          reply({ ref_text: `@file:\`uploads/${frame.params.name}\`` });
          break;
        }
        default:
          reply({});
      }
    }
  });
  socket.on("error", () => {});
});

// One chat's live session, as the dashboard names it on resume.
const LIVE = "live-1";
const chats = new Map([["default", null]]);
const HISTORY = [
  { role: "user", text: "What's on my calendar tomorrow?", timestamp: Date.now() / 1000 - 3600 },
  { role: "tool", name: "calendar_list", context: "tomorrow", tool_call_id: "h1" },
  { role: "assistant", text: "Two things: **standup** at 9:00 and a dentist visit at 15:30.", timestamp: Date.now() / 1000 - 3590 },
];
const approvals = new Map();
const ROOM_MEMBERS = [
  { member_id: "default", profile: "default", handle: "default" },
  { member_id: "job-scout", profile: "job-scout", handle: "job-scout" },
];
const roomLog = [{ seq: 1, kind: "message.member", event_id: "m-1", payload: { member_id: "job-scout", text: "Three new roles came in overnight." }, created_at: Date.now() / 1000 - 600 }];
let roomWorking = false;
let roomApproval = null;
/** Rooms made with `groups.create`: they take messages, and nobody in them answers. */
const madeRooms = [];
/** The ready-made room, which can be renamed or deleted like the others. */
let launchName = "Launch week";
let launchGone = false;
const madeRoom = (id) => madeRooms.find((r) => r.room_id === id);
const jobs = [
  { id: "job-1", name: "Morning brief", schedule_display: "0 9 * * 1-5", enabled: true, state: "scheduled", next_run_at: new Date(Date.now() + 3 * 3600_000).toISOString() },
  { id: "job-2", name: "Price watch", schedule_display: "every 120m", enabled: false, state: "paused", last_status: "error", last_error: "The shop's site timed out" },
];
let interrupted = false;
let requestNumber = 0;

/** A turn like Hermes plays one: a tool call, and an approval first when the prompt says "approve". */
async function playTurn(text, event, sendText) {
  interrupted = false;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  event("message.start", {});
  await wait(300);
  event("tool.start", { tool_id: "t1", name: "terminal", context: "ls ~/notes" });
  if (/approve/i.test(text)) {
    const id = `srq-${++requestNumber}`;
    const choice = await new Promise((resolve) => {
      approvals.set(id, resolve);
      sendText({ jsonrpc: "2.0", id, method: "approval", params: { session_id: LIVE, command: "rm -rf ~/notes/old", description: "Deletes old notes.", choices: ["once", "session", "always", "deny"] } });
    });
    if (choice === "deny") {
      event("tool.complete", { tool_id: "t1", result: { error: "denied" } });
      event("message.complete", { status: "complete", text: "Okay, I left the old notes alone." });
      return;
    }
  }
  await wait(600);
  event("tool.complete", { tool_id: "t1", summary: "3 files", duration_s: 0.6 });
  for (const part of ["You said: ", `"${text}". `, "This reply comes from the ", "**fake gateway**, word by word."]) {
    if (interrupted) return event("message.complete", { status: "interrupted" });
    await wait(250);
    event("message.delta", { text: part });
  }
  event("message.complete", { status: "complete" });
}

server.listen(PORT, "127.0.0.1", () => log(`fake hermes on http://127.0.0.1:${PORT}`));
