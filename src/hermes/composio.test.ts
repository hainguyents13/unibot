import { describe, expect, it } from "vitest";
import { applyComposio, composioServer } from "./composio";
import { GatewayError } from "./gateway-error";
import { McpServerList, type JsonRequest } from "./mcp-servers";

interface Call {
  path: string;
  method: string;
  body?: Record<string, unknown>;
}

/** A Bot's server list on a pretend gateway that starts with `servers` and can refuse a write. */
async function bot(profile: string, servers: string[], refuse = false) {
  const calls: Call[] = [];
  let names = [...servers];
  const request: JsonRequest = async (path, opts = {}) => {
    const call = { path, method: opts.method ?? "GET", body: opts.body as Record<string, unknown> | undefined };
    calls.push(call);
    if (call.method !== "GET" && refuse) throw new GatewayError("http", "Not allowed", 403);
    if (call.method === "POST") names.push(String(call.body?.name));
    if (call.method === "DELETE") names = names.filter((n) => !path.includes(`/${n}?`));
    return { servers: names.map((name) => ({ name, command: "npx" })) };
  };
  const list = new McpServerList(profile, { request, channel: () => undefined, sessionId: () => undefined, isUnencrypted: () => false });
  await list.refresh();
  return { list, calls };
}

describe("applyComposio", () => {
  it("adds Composio to chosen Bots without it, removes it from the rest, and leaves the others alone", async () => {
    const ops = await bot("ops", []);
    const scout = await bot("scout", ["composio"]);
    const forge = await bot("forge", ["composio"]);
    const outcome = await applyComposio(
      [
        { name: "Ops", list: ops.list, chosen: true },
        { name: "Scout", list: scout.list, chosen: false },
        { name: "Forge", list: forge.list, chosen: true },
      ],
      " key-1 ",
      false,
    );
    expect(outcome).toEqual({ added: ["Ops"], removed: ["Scout"], failed: [] });
    expect(ops.calls[1]).toMatchObject({ method: "POST", body: { name: "composio", env: { COMPOSIO_API_KEY: "key-1" } } });
    expect(composioServer(scout.list)).toBeUndefined();
    expect(forge.calls).toHaveLength(1);
  });

  it("needs the key only for a Bot new to Composio, and says which Bots failed", async () => {
    const ops = await bot("ops", []);
    const scout = await bot("scout", [], true);
    const keyless = await applyComposio([{ name: "Ops", list: ops.list, chosen: true }], "", false);
    expect(keyless.failed).toEqual([{ name: "Ops", problem: "Paste the API key to add Composio." }]);
    expect(ops.calls).toHaveLength(1);

    const refused = await applyComposio([{ name: "Scout", list: scout.list, chosen: true }], "key-1", false);
    expect(refused.failed[0]).toMatchObject({ name: "Scout", problem: expect.stringContaining("Not allowed") });
  });
});
