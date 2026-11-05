import { APP_PRESETS } from "./app-presets";
import type { McpServer, McpServerList } from "./mcp-servers";

/** Composio's quick setup, which the Composio page in Settings adds to each Bot you pick. */
export const COMPOSIO = APP_PRESETS.find((preset) => preset.id === "composio")!;

/** The Bot's Composio server, if it has one. */
export function composioServer(list: McpServerList): McpServer | undefined {
  return list.getView().servers.find((server) => server.name === "composio");
}

export interface ComposioBot {
  name: string;
  list: McpServerList;
  /** Whether you want Composio on this Bot. */
  chosen: boolean;
}

export interface ComposioOutcome {
  added: string[];
  removed: string[];
  failed: Array<{ name: string; problem: string }>;
}

/**
 * Adds Composio to each chosen Bot that hasn't got it, with `apiKey`, and removes it from each Bot
 * that has it but isn't chosen. Bots already as you want them are left alone, so the key is only
 * needed for a Bot that's new to Composio.
 */
export async function applyComposio(bots: ComposioBot[], apiKey: string, allowUnencrypted: boolean): Promise<ComposioOutcome> {
  const outcome: ComposioOutcome = { added: [], removed: [], failed: [] };
  for (const bot of bots) {
    const server = composioServer(bot.list);
    if (bot.chosen && !server) {
      if (!apiKey.trim()) {
        outcome.failed.push({ name: bot.name, problem: "Paste the API key to add Composio." });
      } else if (await bot.list.add(COMPOSIO.draft({ COMPOSIO_API_KEY: apiKey.trim() }), allowUnencrypted)) {
        outcome.added.push(bot.name);
      } else {
        outcome.failed.push({ name: bot.name, problem: bot.list.getView().problem ?? "The gateway didn't add it." });
      }
    } else if (!bot.chosen && server) {
      if (await bot.list.remove(server)) outcome.removed.push(bot.name);
      else outcome.failed.push({ name: bot.name, problem: bot.list.getView().problem ?? "The gateway didn't remove it." });
    }
  }
  return outcome;
}
