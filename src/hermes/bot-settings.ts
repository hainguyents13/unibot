import { describeError, GatewayError } from "./gateway-error";
import type { JsonRpcChannel } from "./json-rpc-channel";

type Rpc = Pick<JsonRpcChannel, "call">;
type Row = Record<string, unknown>;
const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const rows = (value: unknown): Row[] => (Array.isArray(value) ? value.filter((v): v is Row => !!v && typeof v === "object") : []);

/** How hard a Bot thinks before answering: Hermes's levels, lowest first. `none` is off. */
export const REASONING_LEVELS = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"] as const;

/** What the Bot settings edit: its name, what it's for, its rules (SOUL.md), model and thinking. */
export interface BotProfile {
  /** The name the apps show; empty goes back to the one Hermes gives the profile. */
  title: string;
  /** What it's for, one line (the profile's description). */
  description: string;
  /** Its SOUL.md: who it is and the rules it keeps. */
  soul: string;
  provider: string;
  model: string;
  /** One of `REASONING_LEVELS`, as Hermes reports it. */
  reasoning: string;
}

/** A provider in the gateway's model catalog (`model.options`). */
export interface ProviderOption {
  slug: string;
  name: string;
  models: string[];
  /** False until it has a key or sign-in on the gateway. */
  isReady: boolean;
  /** The key it needs, when pasting one would set it up. */
  keyName?: string;
  /** What Hermes says it needs, when it isn't ready. */
  warning?: string;
  /** Models whose catalog entry says they take no thinking level. */
  withoutReasoning: string[];
}

/** The providers from a `model.options` result, in the gateway's order. */
export function providersFrom(result: unknown): ProviderOption[] {
  return rows((result as Row)?.providers).flatMap((row) => {
    const slug = str(row.slug);
    if (!slug) return [];
    // Model IDs are plain strings on current gateways and `{id}` objects on older ones.
    const names = (value: unknown) => (Array.isArray(value) ? value : []).map((m) => str(typeof m === "string" ? m : (m as Row)?.id)).filter(Boolean);
    const featured = names(row.featured_models);
    const all = names(row.models);
    const capabilities = (row.capabilities ?? {}) as Record<string, Row | undefined>;
    return [
      {
        slug,
        name: str(row.name) || slug,
        models: featured.length ? featured : all,
        isReady: row.authenticated !== false,
        keyName: row.auth_type === "api_key" ? str(row.key_env) || undefined : undefined,
        warning: str(row.warning) || undefined,
        withoutReasoning: Object.entries(capabilities)
          .filter(([, entry]) => entry?.reasoning === false)
          .map(([model]) => model),
      },
    ];
  });
}

/** The edits that differ from `saved`, as `profiles.configure` takes them. */
export function configureParams(profile: string, saved: BotProfile, draft: BotProfile, confirmed: boolean): Row | undefined {
  const params: Row = { name: profile };
  if (draft.soul !== saved.soul) params.soul = draft.soul;
  if (draft.description.trim() !== saved.description) params.description = draft.description.trim();
  if (modelChanged(saved, draft)) {
    params.model = draft.model.trim();
    params.provider = draft.provider.trim();
    if (confirmed) params.confirm_expensive_model = true;
  }
  return Object.keys(params).length > 1 ? params : undefined;
}

function modelChanged(saved: BotProfile, draft: BotProfile): boolean {
  const model = draft.model.trim();
  const provider = draft.provider.trim();
  return !!model && !!provider && (model !== saved.model || provider !== saved.provider);
}

export interface BotSettingsView {
  phase: { kind: "loading" } | { kind: "ready" } | { kind: "failed"; message: string };
  saved?: BotProfile;
  providers: ProviderOption[];
  isSaving: boolean;
  /** The gateway wants a yes before switching to a pricier model; save again with `confirmed`. */
  confirm?: string;
  notice?: string;
  problem?: string;
  /** A provider key being saved, and why the last one wasn't. */
  savingKey?: string;
  keyProblem?: string;
}

const META_KEY = "hermes-bots";

/**
 * Sets the name apps show for `profile`. It lives in `ui_meta['hermes-bots']`, which
 * `profiles.configure` replaces whole and other apps keep more in. So this writes back the stored
 * value with only the title changed, guarded by its revision, and tries again if something else
 * wrote in between.
 */
export async function writeBotTitle(rpc: Rpc, profile: string, title: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const listed = await rpc.call("profiles.list", { include_sessions: false });
    const row = rows((listed as Row)?.profiles).find((r) => r.name === profile);
    if (!row) throw new GatewayError("rpc", "This Bot isn't on the gateway any more.");
    const stored = (row.ui_meta as Row | undefined)?.[META_KEY];
    const meta: Row = stored && typeof stored === "object" ? { ...(stored as Row) } : {};
    // The official app leaves this out of every write too.
    delete meta.chat;
    meta.title = title;
    const params: Row = { name: profile, ui_meta: { [META_KEY]: meta } };
    const revisions = row.ui_meta_revisions as Row | undefined;
    // An older gateway reports no revisions, and takes the write unguarded.
    if (revisions && typeof revisions === "object") {
      params.ui_meta_expected_revisions = { [META_KEY]: Math.max(Number(revisions[META_KEY]) || 0, 0) };
    }
    const result = (await rpc.call("profiles.configure", params)) as Row;
    const applied = (result?.applied ?? {}) as Row;
    if (applied.ui_meta_conflicts !== undefined) continue;
    if (applied.ui_meta !== true) throw new GatewayError("rpc", "The gateway didn't save the name. Update Hermes and try again.");
    return;
  }
  throw new GatewayError("rpc", "This Bot was changing somewhere else at the same time. Try again.");
}

/**
 * One Bot's own settings on the gateway. Name, description, rules and model go through
 * `profiles.configure`, as the official Bots editor saves them; thinking is the profile's
 * `agent.reasoning_effort` (`config.set … scope: global`). Saving also switches the open Bot Chat,
 * which otherwise keeps the model it started with.
 */
export class BotSettings {
  private view: BotSettingsView = { phase: { kind: "loading" }, providers: [], isSaving: false };
  private readonly listeners = new Set<() => void>();

  constructor(
    readonly profile: string,
    private readonly channel: () => Rpc | undefined,
    /** The open Bot Chat's session, to switch it too. */
    private readonly sessionId: () => string | undefined,
    /** Called once a save lands, so the sidebar shows the new name at once. */
    private readonly onSaved: (profile: BotProfile) => void = () => {},
  ) {}

  getView = (): BotSettingsView => this.view;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Reads the Bot's settings and the models it could use. */
  async load(): Promise<void> {
    const rpc = this.channel();
    if (!rpc) return this.set({ phase: { kind: "failed", message: describeError(new GatewayError("disconnected")) } });
    if (!this.view.saved) this.set({ phase: { kind: "loading" } });
    try {
      const [described, listed, reasoning, options] = await Promise.all([
        rpc.call("profiles.describe", { name: this.profile }),
        rpc.call("profiles.list", { include_sessions: false }),
        // Older gateways may not answer these; the rest still works.
        rpc.call("config.get", { key: "reasoning", profile: this.profile }).catch(() => undefined),
        rpc.call("model.options", { profile: this.profile, include_unconfigured: true }, 30_000).catch(() => undefined),
      ]);
      const model = ((described as Row)?.model ?? {}) as Row;
      const row = rows((listed as Row)?.profiles).find((r) => r.name === this.profile);
      const meta = ((row?.ui_meta as Row | undefined)?.[META_KEY] ?? {}) as Row;
      this.set({
        phase: { kind: "ready" },
        notice: undefined,
        problem: undefined,
        confirm: undefined,
        saved: {
          title: str(meta.title),
          description: str((described as Row)?.description),
          soul: typeof (described as Row)?.soul === "string" ? ((described as Row).soul as string) : "",
          provider: str(model.provider),
          model: str(model.default),
          reasoning: str((reasoning as Row)?.value) || "medium",
        },
        providers: providersFrom(options),
      });
    } catch (error) {
      this.set({ phase: { kind: "failed", message: describeError(error) } });
    }
  }

  /** Saves what differs from the last read. A pricier model stops at `confirm` until `confirmed`. */
  async save(draft: BotProfile, confirmed = false): Promise<void> {
    const rpc = this.channel();
    const saved = this.view.saved;
    if (!rpc || !saved || this.view.isSaving) return;
    this.set({ isSaving: true, confirm: undefined, notice: undefined, problem: undefined });
    try {
      const title = draft.title.trim();
      if (title !== saved.title) await this.writeTitle(rpc, title);

      const params = configureParams(this.profile, saved, draft, confirmed);
      if (params) {
        const result = (await rpc.call("profiles.configure", params)) as Row;
        if (result?.confirm_required === true) {
          // Nothing of the model was written; the other sections were, and are written again on yes.
          return this.set({ isSaving: false, confirm: str(result.confirm_message) || `${draft.model} costs more than the model this Bot uses.` });
        }
        const failed = Object.entries((result?.applied ?? {}) as Row).filter(([, ok]) => ok === false).map(([section]) => section);
        if (failed.length) throw new GatewayError("rpc", `The gateway didn't save: ${failed.join(", ")}.`);
      }

      const reasoningChanged = draft.reasoning !== saved.reasoning;
      if (reasoningChanged) {
        await rpc.call("config.set", { key: "reasoning", value: draft.reasoning, scope: "global", profile: this.profile });
      }

      const next: BotProfile = { ...draft, title, description: draft.description.trim(), model: draft.model.trim(), provider: draft.provider.trim() };
      const switched = await this.switchOpenChat(rpc, modelChanged(saved, draft) ? next : undefined, reasoningChanged ? next.reasoning : undefined);
      this.set({ isSaving: false, saved: next, notice: switched ? "Saved." : "Saved. The open chat keeps its model until it's reopened." });
      this.onSaved(next);
    } catch (error) {
      this.set({ isSaving: false, problem: describeError(error) });
    }
  }

  /** Saves an API key for `slug` on the gateway, for this Bot, then reads the providers again. */
  async saveKey(slug: string, apiKey: string): Promise<boolean> {
    const rpc = this.channel();
    const key = apiKey.trim();
    if (!rpc || !key) return false;
    this.set({ savingKey: slug, keyProblem: undefined });
    try {
      await rpc.call("model.save_key", { slug, api_key: key, profile: this.profile });
      const options = await rpc.call("model.options", { profile: this.profile, include_unconfigured: true, refresh: true }, 60_000);
      this.set({ savingKey: undefined, providers: providersFrom(options) });
      return true;
    } catch (error) {
      this.set({ savingKey: undefined, keyProblem: describeError(error) });
      return false;
    }
  }

  /**
   * Keeps the model the Bot has. Everything else in that save was written already, so the form reads
   * the Bot again to show what it has now.
   */
  dismissConfirm(): Promise<void> {
    this.set({ confirm: undefined });
    return this.load();
  }

  private writeTitle(rpc: Rpc, title: string): Promise<void> {
    return writeBotTitle(rpc, this.profile, title);
  }

  /** The Bot Chat keeps the model it started with, so a change is applied to it too. */
  private async switchOpenChat(rpc: Rpc, model: BotProfile | undefined, reasoning: string | undefined): Promise<boolean> {
    const session = this.sessionId();
    if (!session || (!model && !reasoning)) return true;
    try {
      if (model) {
        await rpc.call(
          "config.set",
          { session_id: session, key: "model", value: `${model.model} --provider ${model.provider} --session`, confirm_expensive_model: true },
          45_000,
        );
      }
      if (reasoning) await rpc.call("config.set", { session_id: session, key: "reasoning", value: reasoning });
      return true;
    } catch {
      return false;
    }
  }

  private set(change: Partial<BotSettingsView>): void {
    this.view = { ...this.view, ...change };
    for (const listener of this.listeners) listener();
  }
}
