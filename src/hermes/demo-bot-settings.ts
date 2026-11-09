import type { Bot } from "./types";

type Row = Record<string, unknown>;

const pause = () => new Promise((resolve) => setTimeout(resolve, 300));

const PROVIDERS = [
  {
    slug: "anthropic",
    name: "Anthropic",
    models: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"],
  },
  {
    slug: "deepseek",
    name: "DeepSeek",
    models: ["deepseek-flash", "deepseek-pro"],
    capabilities: { "deepseek-flash": { reasoning: false } },
  },
  { slug: "openai", name: "OpenAI", models: [], authenticated: false, auth_type: "api_key", key_env: "OPENAI_API_KEY", warning: "paste OPENAI_API_KEY to activate" },
];

/**
 * The demo's gateway for Bot settings: each Bot's name, description, rules, model and thinking,
 * kept for the session. A key "activates" its provider with a short list of models.
 */
export function demoBotSettingsBackend(bot: (id: string) => Bot | undefined) {
  const profiles = new Map<string, Row>();
  const ready = new Set<string>();

  const profileOf = (id: string): Row => {
    let profile = profiles.get(id);
    if (!profile) {
      const known = bot(id);
      profile = {
        title: known?.name ?? id,
        description: known?.about ?? "",
        soul: `# ${known?.name ?? id}\n\nYou are ${known?.name ?? id}, one of the user's Bots.\n\n**Mission:** ${known?.about ?? "Help the user."}\n\n- Answer briefly, then offer more.\n- Ask before anything you can't undo.\n`,
        provider: "anthropic",
        model: "claude-sonnet-5-5",
        reasoning: "medium",
      };
      profiles.set(id, profile);
    }
    return profile;
  };

  const call = async (method: string, params: Row = {}): Promise<unknown> => {
    await pause();
    if (method === "profiles.list") {
      return { profiles: [...profiles].map(([name, p]) => ({ name, ui_meta: { "hermes-bots": { title: p.title } } })) };
    }
    const id = String(params.name ?? params.profile ?? "default");
    const profile = profileOf(id);
    switch (method) {
      case "profiles.describe":
        return { name: id, description: profile.description, soul: profile.soul, model: { provider: profile.provider, default: profile.model } };
      case "profiles.configure": {
        const applied: Row = {};
        const meta = (params.ui_meta as Row | undefined)?.["hermes-bots"] as Row | undefined;
        if (meta) {
          profile.title = meta.title;
          applied.ui_meta = true;
        }
        for (const key of ["soul", "description"]) {
          if (typeof params[key] === "string") {
            profile[key] = params[key];
            applied[key] = true;
          }
        }
        if (params.model) {
          // Opus is the demo's pricey pick, so the confirmation shows.
          if (params.model === "claude-opus-5-5" && !params.confirm_expensive_model) {
            return { applied, confirm_required: true, confirm_message: "Claude Opus 5.5 costs about five times what this Bot uses now." };
          }
          profile.model = params.model;
          profile.provider = params.provider;
          applied.model = true;
        }
        return { ok: true, applied };
      }
      case "config.get":
        return { value: profile.reasoning, display: "show" };
      case "config.set":
        if (params.key === "reasoning" && params.scope === "global") profile.reasoning = params.value;
        return { key: params.key, value: params.value };
      case "model.options":
        return {
          providers: PROVIDERS.map((p) =>
            ready.has(p.slug) ? { ...p, authenticated: true, models: ["gpt-5.5", "gpt-5.5-mini"], warning: undefined } : p,
          ),
        };
      case "model.save_key":
        ready.add(String(params.slug));
        return { ok: true };
      default:
        return {};
    }
  };

  return { call };
}
