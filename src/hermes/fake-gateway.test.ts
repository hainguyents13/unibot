import { describe, expect, it } from "vitest";
import { FakeGateway } from "./fake-gateway";

describe("FakeGateway", () => {
  const now = Date.UTC(2026, 10, 4, 12, 0);
  const gateway = new FakeGateway(() => now);

  it("lists the most recently active Bot first", async () => {
    const bots = await gateway.listBots();
    expect(bots.map((b) => b.id)).toEqual(["ops", "forge", "atlas", "scribe", "ledger"]);
  });

  it("has a Bot waiting on you and one working, so the sidebar shows both states", async () => {
    const statuses = (await gateway.listBots()).map((b) => b.status);
    expect(statuses).toContain("needsYou");
    expect(statuses).toContain("working");
  });

  it("uses the example address, never a real one", () => {
    expect(gateway.address).toBe("hermes.example.com");
  });
});
