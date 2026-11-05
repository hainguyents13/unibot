import type { JsonRequest } from "./mcp-servers";

type Row = Record<string, unknown>;

/** A tick, so busy states show in the demo. */
const pause = () => new Promise((resolve) => setTimeout(resolve, 400));

const CATALOG = [
  { name: "linear", description: "Issues, projects and cycles in Linear.", auth_type: "oauth", url: "https://mcp.linear.app/mcp" },
  { name: "notion", description: "Pages and databases in your Notion workspace.", auth_type: "oauth", url: "https://mcp.notion.com/mcp" },
  { name: "dropbox", description: "Files and folders in Dropbox.", auth_type: "oauth", url: "https://mcp.dropbox.com/mcp" },
  {
    name: "todoist",
    description: "Tasks and projects in Todoist.",
    auth_type: "env",
    command: "npx",
    required_env: [{ name: "TODOIST_API_TOKEN", prompt: "Todoist API token" }],
  },
];

const TOOLS = [
  { name: "search", description: "Find items by keyword" },
  { name: "create_item", description: "Make a new item" },
  { name: "update_item", description: "Change an item" },
];

/**
 * The demo's gateway for apps: MCP servers through the dashboard routes, connected apps through the
 * socket methods. It keeps what you do for the session; sign-ins finish by themselves.
 */
export function demoAppsBackend() {
  const servers = new Map<string, Row[]>();
  const signedIn = new Set<string>();
  const flows = new Map<string, { server: string; polls: number }>();
  const connected = new Set(["gmail"]);
  const operations = new Map<string, { slug: string; polls: number }>();

  const serversOf = (profile: string) => {
    if (!servers.has(profile)) {
      servers.set(profile, [
        { name: "linear", url: "https://mcp.linear.app/mcp", auth: "oauth", enabled: true },
        { name: "files", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/srv/shared"], enabled: false },
      ]);
      signedIn.add(`${profile}/linear`);
    }
    return servers.get(profile)!;
  };

  const request: JsonRequest = async (path, options = {}) => {
    await pause();
    const url = new URL(path, "http://demo");
    const profile = url.searchParams.get("profile") ?? "default";
    const method = options.method ?? "GET";
    const body = (options.body ?? {}) as Row;
    const list = serversOf(profile);
    const named = /^\/api\/mcp\/servers\/([^/]+)(?:\/(enabled|test|auth))?$/.exec(url.pathname);
    const flow = /^\/api\/mcp\/oauth\/flows\/(.+)$/.exec(url.pathname);
    if (url.pathname === "/api/mcp/servers" && method === "GET") return { servers: list };
    if (url.pathname === "/api/mcp/servers" && method === "POST") {
      list.push({ name: body.name, url: body.url, command: body.command, args: body.args, auth: body.auth, enabled: true });
      return { ok: true };
    }
    if (url.pathname === "/api/mcp/catalog") {
      return { entries: CATALOG.map((e) => ({ ...e, installed: list.some((s) => s.name === e.name) })) };
    }
    if (url.pathname === "/api/mcp/catalog/install") {
      const entry = CATALOG.find((e) => e.name === body.name)!;
      list.push({ name: entry.name, url: entry.url, command: entry.command, auth: entry.auth_type === "oauth" ? "oauth" : undefined, enabled: true });
      return { ok: true };
    }
    if (flow) {
      const state = flows.get(decodeURIComponent(flow[1]));
      if (!state || method === "DELETE") return { ok: true };
      if (++state.polls < 2) return { status: "authorization_required" };
      signedIn.add(state.server);
      return { status: "approved", tools: TOOLS };
    }
    if (named) {
      const name = decodeURIComponent(named[1]);
      const server = list.find((s) => s.name === name);
      if (named[2] === "enabled" && server) server.enabled = body.enabled;
      if (!named[2] && method === "DELETE") list.splice(list.indexOf(server!), 1);
      if (named[2] === "test") {
        return server?.auth === "oauth" && !signedIn.has(`${profile}/${name}`) ? { ok: false, error: "OAuth authentication required" } : { ok: true, tools: TOOLS };
      }
      if (named[2] === "auth") {
        const id = `demo-flow-${flows.size + 1}`;
        flows.set(id, { server: `${profile}/${name}`, polls: 0 });
        // No page to open: the demo's sign-in finishes on its own.
        return { flow_id: id, status: "pending" };
      }
      return { ok: true };
    }
    return {};
  };

  const call = async (method: string, params: Row = {}): Promise<unknown> => {
    await pause();
    switch (method) {
      case "connectors.list":
        return { available: true, connectors: [...connected].map((slug) => ({ connector: slug, connected: true, enabled: true })) };
      case "connectors.catalog":
        return {
          connectors: [
            { slug: "gmail", name: "Gmail", description: "Read, search and draft email." },
            { slug: "google_drive", name: "Google Drive", description: "Docs, Sheets, Slides and files in your Drive." },
            { slug: "google_calendar", name: "Google Calendar", description: "Events and free time." },
            { slug: "slack", name: "Slack", description: "Channels and messages." },
          ],
        };
      case "connectors.accounts":
        return { accounts: [...connected].map((slug) => ({ connector: slug, connection_id: `acct-${slug}` })) };
      case "connectors.connect": {
        const slug = (params.connectors as string[])[0];
        const id = `demo-op-${operations.size + 1}`;
        operations.set(id, { slug, polls: 0 });
        return { op_id: id, seq: 1, targets: [{ name: slug, kind: "connector", state: "initiated" }] };
      }
      case "connectors.operation.status": {
        const op = operations.get(params.op_id as string)!;
        const done = ++op.polls >= 2;
        if (done) connected.add(op.slug);
        return { op_id: params.op_id, seq: op.polls + 1, targets: [{ name: op.slug, kind: "connector", state: done ? "connected" : "initiated" }] };
      }
      case "connectors.accounts.remove":
        connected.delete(String(params.connection_id).replace(/^acct-/, ""));
        return {};
      case "reload.mcp":
        return { status: "reloaded", unavailable: [] };
      default:
        return {};
    }
  };

  return { request, channel: { call } };
}
