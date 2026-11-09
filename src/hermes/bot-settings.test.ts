import { describe, expect, it } from "vitest";
import { BotSettings, configureParams, providersFrom, type BotProfile } from "./bot-settings";

type Row = Record<string, unknown>;

/** A gateway that answers the settings methods and records every call. */
function fakeGateway(options: { confirmModel?: boolean; conflicts?: number; session?: string } = {}) {
  const calls: Array<{ method: string; params: Row }> = [];
  let conflicts = options.conflicts ?? 0;
  let revision = 4;
  const rpc = {
    call: async (method: string, params: Row = {}): Promise<unknown> => {
      calls.push({ method, params });
      switch (method) {
        case "profiles.describe":
          return { name: "scout", description: "Finds jobs", soul: "# Scout\nBe brief.", model: { provider: "deepseek", default: "deepseek-flash" } };
        case "profiles.list":
          return {
            profiles: [
              { name: "default" },
              { name: "scout", ui_meta: { "hermes-bots": { title: "Scout", sectionId: "work", chat: { x: 1 } } }, ui_meta_revisions: { "hermes-bots": revision } },
            ],
          };
        case "config.get":
          return { value: "low", display: "show" };
        case "model.options":
          return {
            providers: [
              { slug: "deepseek", name: "DeepSeek", models: ["deepseek-flash", "deepseek-pro"], capabilities: { "deepseek-flash": { reasoning: false } } },
              { slug: "openai", name: "OpenAI", models: [], authenticated: false, auth_type: "api_key", key_env: "OPENAI_API_KEY", warning: "paste OPENAI_API_KEY to activate" },
            ],
          };
        case "profiles.configure":
          if (params.ui_meta) {
            if (conflicts > 0) {
              conflicts--;
              revision++;
              return { applied: { ui_meta: false, ui_meta_conflicts: ["hermes-bots"] } };
            }
            return { applied: { ui_meta: true } };
          }
          if (params.model && options.confirmModel && !params.confirm_expensive_model) {
            return { applied: { soul: true }, confirm_required: true, confirm_message: "deepseek-pro costs more." };
          }
          return { applied: Object.fromEntries(Object.keys(params).filter((k) => k !== "name" && k !== "provider" && k !== "confirm_expensive_model").map((k) => [k, true])) };
        default:
          return {};
      }
    },
  };
  return { rpc, calls };
}

async function loaded(gateway: ReturnType<typeof fakeGateway>, session?: string, onSaved?: (p: BotProfile) => void) {
  const settings = new BotSettings("scout", () => gateway.rpc, () => session, onSaved);
  await settings.load();
  return settings;
}

describe("Bot settings", () => {
  it("reads the name, description, rules, model and thinking", async () => {
    const settings = await loaded(fakeGateway());
    expect(settings.getView().phase.kind).toBe("ready");
    expect(settings.getView().saved).toEqual({
      title: "Scout",
      description: "Finds jobs",
      soul: "# Scout\nBe brief.",
      provider: "deepseek",
      model: "deepseek-flash",
      reasoning: "low",
    });
  });

  it("lists providers, with the ones that need a key and the models that can't think", () => {
    const [deepseek, openai] = providersFrom({
      providers: [
        { slug: "deepseek", name: "DeepSeek", models: [{ id: "a" }, "b"], featured_models: [], capabilities: { a: { reasoning: false } } },
        { slug: "openai", models: [], authenticated: false, auth_type: "api_key", key_env: "OPENAI_API_KEY" },
        { name: "no slug" },
      ],
    });
    expect(deepseek).toMatchObject({ slug: "deepseek", models: ["a", "b"], isReady: true, withoutReasoning: ["a"] });
    expect(openai).toMatchObject({ name: "openai", isReady: false, keyName: "OPENAI_API_KEY" });
    expect(providersFrom({ providers: [{ slug: "x", models: ["all"], featured_models: ["short"] }] })[0].models).toEqual(["short"]);
  });

  it("sends only what changed", () => {
    const saved: BotProfile = { title: "S", description: "d", soul: "s", provider: "p", model: "m", reasoning: "low" };
    expect(configureParams("scout", saved, saved, false)).toBeUndefined();
    expect(configureParams("scout", saved, { ...saved, description: " d " }, false)).toBeUndefined();
    expect(configureParams("scout", saved, { ...saved, soul: "new" }, false)).toEqual({ name: "scout", soul: "new" });
    expect(configureParams("scout", saved, { ...saved, model: "m2" }, true)).toEqual({ name: "scout", model: "m2", provider: "p", confirm_expensive_model: true });
    // A model without a provider isn't something the gateway can pin.
    expect(configureParams("scout", saved, { ...saved, provider: "" }, false)).toBeUndefined();
  });

  it("renames through ui_meta, keeping what other apps stored there", async () => {
    const gateway = fakeGateway();
    const renamed: BotProfile[] = [];
    const settings = await loaded(gateway, undefined, (p) => renamed.push(p));
    await settings.save({ ...settings.getView().saved!, title: "  Job Scout " });
    const write = gateway.calls.find((c) => c.method === "profiles.configure")!;
    expect(write.params).toEqual({
      name: "scout",
      ui_meta: { "hermes-bots": { title: "Job Scout", sectionId: "work" } },
      ui_meta_expected_revisions: { "hermes-bots": 4 },
    });
    expect(settings.getView().saved?.title).toBe("Job Scout");
    expect(renamed.map((p) => p.title)).toEqual(["Job Scout"]);
  });

  it("tries the name again when another app wrote at the same time", async () => {
    const gateway = fakeGateway({ conflicts: 1 });
    const settings = await loaded(gateway);
    await settings.save({ ...settings.getView().saved!, title: "Scout 2" });
    const writes = gateway.calls.filter((c) => c.method === "profiles.configure");
    expect(writes.map((w) => (w.params.ui_meta_expected_revisions as Row)["hermes-bots"])).toEqual([4, 5]);
    expect(settings.getView().problem).toBeUndefined();
  });

  it("asks before a pricier model, and saves it once you agree", async () => {
    const gateway = fakeGateway({ confirmModel: true });
    const settings = await loaded(gateway);
    const draft = { ...settings.getView().saved!, model: "deepseek-pro", soul: "Be kind." };
    await settings.save(draft);
    expect(settings.getView().confirm).toBe("deepseek-pro costs more.");
    expect(settings.getView().saved?.model).toBe("deepseek-flash");

    await settings.save(draft, true);
    expect(gateway.calls.filter((c) => c.method === "profiles.describe")).toHaveLength(1);
    const last = gateway.calls.filter((c) => c.method === "profiles.configure").at(-1)!;
    expect(last.params).toMatchObject({ model: "deepseek-pro", provider: "deepseek", confirm_expensive_model: true });
    expect(settings.getView().confirm).toBeUndefined();
    expect(settings.getView().saved?.model).toBe("deepseek-pro");
  });

  it("keeps the current model on no, and reads back what the save did write", async () => {
    const gateway = fakeGateway({ confirmModel: true });
    const settings = await loaded(gateway);
    await settings.save({ ...settings.getView().saved!, model: "deepseek-pro" });
    await settings.dismissConfirm();
    expect(settings.getView().confirm).toBeUndefined();
    expect(gateway.calls.filter((c) => c.method === "profiles.describe")).toHaveLength(2);
  });

  it("sets thinking as the Bot's default and switches the open chat too", async () => {
    const gateway = fakeGateway();
    const settings = await loaded(gateway, "chat-1");
    await settings.save({ ...settings.getView().saved!, reasoning: "high", model: "deepseek-pro" });
    const sets = gateway.calls.filter((c) => c.method === "config.set").map((c) => c.params);
    expect(sets).toEqual([
      { key: "reasoning", value: "high", scope: "global", profile: "scout" },
      { session_id: "chat-1", key: "model", value: "deepseek-pro --provider deepseek --session", confirm_expensive_model: true },
      { session_id: "chat-1", key: "reasoning", value: "high" },
    ]);
    expect(settings.getView().notice).toBe("Saved.");
  });

  it("saves a provider key for this Bot and reads the providers again", async () => {
    const gateway = fakeGateway();
    const settings = await loaded(gateway);
    expect(await settings.saveKey("openai", "  sk-test  ")).toBe(true);
    expect(gateway.calls.find((c) => c.method === "model.save_key")?.params).toEqual({ slug: "openai", api_key: "sk-test", profile: "scout" });
    expect(gateway.calls.at(-1)).toMatchObject({ method: "model.options", params: { refresh: true } });
  });

  it("says so when it can't reach the gateway", async () => {
    const settings = new BotSettings("scout", () => undefined, () => undefined);
    await settings.load();
    expect(settings.getView().phase.kind).toBe("failed");
  });
});
