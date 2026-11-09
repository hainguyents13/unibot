import { useEffect, useId, useState, useSyncExternalStore, type FormEvent } from "react";
import { KeyRound, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { REASONING_LEVELS, type BotProfile, type BotSettings, type BotSettingsView, type ProviderOption } from "../hermes/bot-settings";
import { friendlyName } from "../hermes/roster";
import { Consent, Field, Note, Panel, Problem, SectionTitle } from "./settings-parts";

const LEVEL_NAMES: Record<string, string> = {
  none: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
  ultra: "Ultra",
};

interface BotSettingsFormProps {
  settings: BotSettings;
  /** Over plain http outside Tailscale, a key is sent only with your say-so. */
  isUnencrypted: boolean;
}

/** A Bot's name, role, rules, model and thinking, saved on the gateway with one Save. */
export function BotSettingsForm({ settings, isUnencrypted }: BotSettingsFormProps) {
  const view = useSyncExternalStore(settings.subscribe, settings.getView);

  useEffect(() => {
    void settings.load();
  }, [settings]);

  if (view.phase.kind === "failed" && !view.saved) {
    return (
      <div className="flex flex-col items-start gap-2 p-4">
        <Problem>{view.phase.message}</Problem>
        <Button type="button" variant="outline" size="sm" onClick={() => void settings.load()}>
          Try again
        </Button>
      </div>
    );
  }
  if (!view.saved)
    return (
      <Note role="status" className="p-4">
        Loading…
      </Note>
    );
  // A new key starts the form over from what's saved, after a save or a fresh read.
  return <Form key={JSON.stringify(view.saved)} settings={settings} view={view} saved={view.saved} isUnencrypted={isUnencrypted} />;
}

function Form({ settings, view, saved, isUnencrypted }: BotSettingsFormProps & { view: BotSettingsView; saved: BotProfile }) {
  const id = useId();
  const [draft, setDraft] = useState(saved);
  const change = (edit: Partial<BotProfile>) => setDraft((current) => ({ ...current, ...edit }));
  const changed = JSON.stringify(draft) !== JSON.stringify(saved);
  const provider = view.providers.find((p) => p.slug === draft.provider);
  const notReady = !!provider && !provider.isReady;
  const canThink = !provider?.withoutReasoning.includes(draft.model);

  function submit(event: FormEvent) {
    event.preventDefault();
    void settings.save(draft);
  }

  return (
    <form className="flex min-h-0 flex-1 flex-col" onSubmit={submit}>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <Field label="Name" htmlFor={`${id}-name`}>
          <Input id={`${id}-name`} value={draft.title} placeholder={friendlyName(settings.profile)} onChange={(e) => change({ title: e.target.value })} />
        </Field>
        <Field label="Role" htmlFor={`${id}-role`} help="What it's for, in a line. It shows under the name.">
          <Input id={`${id}-role`} value={draft.description} placeholder="Finds and summarises job posts" onChange={(e) => change({ description: e.target.value })} />
        </Field>
        <Field
          label="Rules"
          htmlFor={`${id}-rules`}
          help="Its SOUL.md: who it is and the rules it keeps. Every chat, routine and room starts from it."
        >
          <Textarea
            id={`${id}-rules`}
            className="max-h-[45vh] min-h-48 font-mono text-xs md:text-xs"
            value={draft.soul}
            spellCheck={false}
            onChange={(e) => change({ soul: e.target.value })}
          />
        </Field>

        <SectionTitle>Model</SectionTitle>
        <ModelFields id={id} draft={draft} providers={view.providers} saved={saved} change={change} />
        {provider && notReady && <ProviderKey key={provider.slug} provider={provider} settings={settings} view={view} isUnencrypted={isUnencrypted} />}
        <Field
          label="Thinking"
          htmlFor={`${id}-thinking`}
          help={canThink ? "How hard it thinks before answering. More is slower and costs more." : `${draft.model} doesn't take a thinking level.`}
        >
          <Select value={draft.reasoning} disabled={!canThink} onValueChange={(reasoning) => change({ reasoning })}>
            <SelectTrigger id={`${id}-thinking`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {withCurrent([...REASONING_LEVELS], draft.reasoning).map((level) => (
                <SelectItem key={level} value={level}>
                  {LEVEL_NAMES[level] ?? level}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        {view.confirm && (
          <Panel className="border-attention/40 bg-attention-soft/50" role="alert">
            <p className="text-[13px]">{view.confirm}</p>
            <div className="flex gap-2">
              <Button type="button" size="sm" disabled={view.isSaving} onClick={() => void settings.save(draft, true)}>
                Use it anyway
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => void settings.dismissConfirm()}>
                Keep the current model
              </Button>
            </div>
          </Panel>
        )}
        {view.problem && <Problem>{view.problem}</Problem>}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t bg-background px-4 py-3">
        <Button type="submit" disabled={!changed || view.isSaving || notReady}>
          {view.isSaving ? "Saving…" : "Save"}
        </Button>
        {changed && (
          <Button type="button" variant="ghost" disabled={view.isSaving} onClick={() => setDraft(saved)}>
            <RotateCcw aria-hidden />
            Undo changes
          </Button>
        )}
        {!changed && view.notice && (
          <Note role="status" className="min-w-0 flex-1">
            {view.notice}
          </Note>
        )}
        {changed && !view.isSaving && <Note className="w-full text-xs">Saved for all its chats, routines and rooms. The open chat switches too.</Note>}
      </div>
    </form>
  );
}

/** Provider and model from the gateway's catalog, or typed in when the gateway has no catalog. */
function ModelFields({
  id,
  draft,
  saved,
  providers,
  change,
}: {
  id: string;
  draft: BotProfile;
  saved: BotProfile;
  providers: ProviderOption[];
  change: (edit: Partial<BotProfile>) => void;
}) {
  if (providers.length === 0) {
    return (
      <>
        <Field label="Provider" htmlFor={`${id}-provider`}>
          <Input id={`${id}-provider`} value={draft.provider} onChange={(e) => change({ provider: e.target.value })} />
        </Field>
        <Field label="Model" htmlFor={`${id}-model`} help="This gateway didn't list its models, so type the model's ID.">
          <Input id={`${id}-model`} value={draft.model} onChange={(e) => change({ model: e.target.value })} />
        </Field>
      </>
    );
  }
  const provider = providers.find((p) => p.slug === draft.provider);
  // The saved model stays on offer even when the catalog's shortlist leaves it out.
  const models = withCurrent(provider?.models ?? [], draft.provider === saved.provider ? saved.model : "");
  return (
    <>
      <Field label="Provider" htmlFor={`${id}-provider`}>
        <Select
          value={draft.provider || undefined}
          onValueChange={(slug) => change({ provider: slug, model: slug === saved.provider ? saved.model : (providers.find((p) => p.slug === slug)?.models[0] ?? "") })}
        >
          <SelectTrigger id={`${id}-provider`} className="w-full">
            <SelectValue placeholder="Pick a provider" />
          </SelectTrigger>
          <SelectContent>
            {providers.map((p) => (
              <SelectItem key={p.slug} value={p.slug}>
                {p.name}
                {!p.isReady && <span className="text-muted-foreground"> · {p.keyName ? "needs a key" : "not set up"}</span>}
              </SelectItem>
            ))}
            {draft.provider && !provider && <SelectItem value={draft.provider}>{draft.provider}</SelectItem>}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Model" htmlFor={`${id}-model`}>
        <Select value={draft.model || undefined} disabled={models.length === 0} onValueChange={(model) => change({ model })}>
          <SelectTrigger id={`${id}-model`} className="w-full">
            <SelectValue placeholder={models.length ? "Pick a model" : "No models until the provider is set up"} />
          </SelectTrigger>
          <SelectContent>
            {models.map((model) => (
              <SelectItem key={model} value={model}>
                {model}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </>
  );
}

/** A provider with no key yet: paste one, and the gateway keeps it for this Bot. */
function ProviderKey({ provider, settings, view, isUnencrypted }: { provider: ProviderOption; settings: BotSettings; view: BotSettingsView; isUnencrypted: boolean }) {
  const id = useId();
  const [key, setKey] = useState("");
  const [consent, setConsent] = useState(false);
  if (!provider.keyName) {
    return <Note>{provider.name} isn't set up on the gateway. Run <code>hermes model</code> there to set it up.</Note>;
  }
  const saving = view.savingKey === provider.slug;
  return (
    <Panel>
      <Field label={`${provider.name} API key`} htmlFor={id} help={`Kept on the gateway as ${provider.keyName}, for this Bot. Unibot doesn't keep it.`}>
        <Input id={id} type="password" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} />
      </Field>
      {isUnencrypted && <Consent checked={consent} onChange={setConsent} what="the key" />}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!key.trim() || saving || (isUnencrypted && !consent)}
          onClick={() => void settings.saveKey(provider.slug, key).then((ok) => ok && setKey(""))}
        >
          <KeyRound aria-hidden />
          {saving ? "Saving…" : "Save key"}
        </Button>
      </div>
      {view.keyProblem && <Problem>{view.keyProblem}</Problem>}
    </Panel>
  );
}

function withCurrent(list: string[], current: string): string[] {
  return current && !list.includes(current) ? [...list, current] : list;
}
