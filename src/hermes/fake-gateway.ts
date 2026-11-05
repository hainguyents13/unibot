import type { Bot } from "./types";

const MINUTE = 60_000;

/**
 * A made-up team of Bots for trying the app and taking screenshots. It never connects
 * anywhere, so nothing here can reach a real gateway.
 */
export class FakeGateway {
  readonly address = "hermes.example.com";

  constructor(private readonly now: () => number = Date.now) {}

  async listBots(): Promise<Bot[]> {
    const now = this.now();
    const bots: Bot[] = [
      {
        id: "forge",
        name: "Forge",
        about: "Writes and ships code across the web app and the API; opens pull requests.",
        preview: "Needs your OK to run the migration",
        lastActivity: now - 2 * MINUTE,
        status: "needsYou",
      },
      {
        id: "atlas",
        name: "Atlas",
        about: "Researches tools, papers and competitors, and writes short recommendations.",
        preview: "Turbopuffer fits best: cheapest at our size, and…",
        lastActivity: now - 14 * MINUTE,
        status: "idle",
      },
      {
        id: "scribe",
        name: "Scribe",
        about: "Drafts posts, release notes and emails in the house style.",
        preview: "Two headline options for the launch post",
        lastActivity: now - 95 * MINUTE,
        status: "idle",
      },
      {
        id: "ops",
        name: "Ops",
        about: "Watches servers, backups and costs, and reports each morning.",
        preview: "Checking last night's backups…",
        lastActivity: now - 1 * MINUTE,
        status: "working",
      },
      {
        id: "ledger",
        name: "Ledger",
        about: "Keeps the books: invoices, receipts and the monthly close.",
        preview: "October invoices are drafted for review",
        lastActivity: now - 26 * 60 * MINUTE,
        status: "idle",
      },
    ];
    return bots.sort((a, b) => b.lastActivity - a.lastActivity);
  }
}
