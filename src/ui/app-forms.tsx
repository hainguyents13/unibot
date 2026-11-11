import { useId, useState, type FormEvent, type ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { presetReady, type AppPreset } from "../hermes/app-presets";
import { emptyDraft, isDraftComplete, draftHasSecret, type McpCatalogEntry, type McpServerDraft, type McpServerList } from "../hermes/mcp-servers";
import { openExternal } from "./open-external";
import { Consent, Field, Note, PageTitle, Segmented } from "./settings-parts";

interface FormProps {
  list: McpServerList;
  /** Back to the list, after adding or on Cancel. */
  onDone: () => void;
}

/** A form's frame: its fields, the plain-http consent when a secret would go out, and Add. */
function AppForm({
  title,
  list,
  hasSecret,
  ready,
  add,
  onDone,
  children,
}: FormProps & { title: string; hasSecret: boolean; ready: boolean; add: (allowUnencrypted: boolean) => Promise<boolean>; children: ReactNode }) {
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false);
  const needsConsent = hasSecret && list.isUnencrypted;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || busy || (needsConsent && !consent)) return;
    setBusy(true);
    const added = await add(consent);
    setBusy(false);
    if (added) onDone();
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <PageTitle>{title}</PageTitle>
      <div className="flex flex-col gap-4" inert={busy}>
        {children}
        {needsConsent && <Consent checked={consent} onChange={setConsent} />}
        <Note className="text-[12px] text-ink-3">What you type goes to your gateway, which keeps it. Unibot keeps no copy.</Note>
      </div>
      <div className="flex gap-1.5">
        <Button type="submit" disabled={!ready || busy || (needsConsent && !consent)}>
          {busy ? "Adding…" : "Add"}
        </Button>
        <Button type="button" variant="outline" onClick={onDone} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** GitHub, Plane or Composio, from a few values. */
export function PresetForm({ preset, list, onDone }: FormProps & { preset: AppPreset }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const id = useId();
  const draft = preset.draft(values);
  return (
    <AppForm
      title={`Add ${preset.title}`}
      list={list}
      onDone={onDone}
      hasSecret={draftHasSecret(draft)}
      ready={presetReady(preset, values)}
      add={(allow) => list.add(draft, allow)}
    >
      <Note>{preset.needs}</Note>
      <Button type="button" variant="link" className="inline-flex h-auto items-center gap-1 self-start p-0 text-[13px] font-medium" onClick={() => void openExternal(preset.link.url)}>
        {preset.link.label}
        <ExternalLink aria-hidden />
      </Button>
      {preset.fields.map((field) => (
        <Field key={field.key} htmlFor={`${id}-${field.key}`} label={field.required ? field.label : `${field.label} (optional)`} help={field.help}>
          <Input
            id={`${id}-${field.key}`}
            type={field.secret ? "password" : "text"}
            autoComplete="off"
            placeholder={field.placeholder}
            value={values[field.key] ?? ""}
            onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
          />
        </Field>
      ))}
    </AppForm>
  );
}

/** A server from Hermes's catalog that asks for keys before it can run. */
export function CatalogForm({ entry, list, onDone }: FormProps & { entry: McpCatalogEntry }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const id = useId();
  const ready = entry.requiredEnv.every((k) => !k.required || (values[k.name] ?? "").trim() !== "");
  return (
    <AppForm
      title={`Add ${entry.name}`}
      list={list}
      onDone={onDone}
      hasSecret={Object.values(values).some((v) => v.trim() !== "")}
      ready={ready}
      add={(allow) => list.install(entry, Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim()])), allow)}
    >
      {entry.description && <Note>{entry.description}</Note>}
      {entry.needsInstall && <Note>The gateway fetches it first, which can take a few minutes.</Note>}
      {entry.requiredEnv.map((key) => (
        <Field key={key.name} htmlFor={`${id}-${key.name}`} label={key.required ? (key.prompt ?? key.name) : `${key.prompt ?? key.name} (optional)`}>
          <Input
            id={`${id}-${key.name}`}
            type="password"
            autoComplete="off"
            value={values[key.name] ?? ""}
            onChange={(e) => setValues({ ...values, [key.name]: e.target.value })}
          />
        </Field>
      ))}
    </AppForm>
  );
}

/** `NAME=value` lines, for a program's environment. */
function parseEnv(text: string): Record<string, string> {
  return Object.fromEntries(
    text.split("\n").flatMap((line) => {
      const at = line.indexOf("=");
      return at > 0 ? [[line.slice(0, at).trim(), line.slice(at + 1).trim()]] : [];
    }),
  );
}

/** A server you describe yourself: a web address, or a program the gateway runs. */
export function CustomForm({ list, onDone }: FormProps) {
  const [draft, setDraft] = useState<McpServerDraft>(emptyDraft);
  const [envText, setEnvText] = useState("");
  const id = useId();
  const full = { ...draft, env: draft.kind === "program" ? parseEnv(envText) : {} };
  const change = (patch: Partial<McpServerDraft>) => setDraft({ ...draft, ...patch });
  return (
    <AppForm title="Add your own" list={list} onDone={onDone} hasSecret={draftHasSecret(full)} ready={isDraftComplete(full)} add={(allow) => list.add(full, allow)}>
      <Field htmlFor={`${id}-name`} label="Name" help="Short and without spaces; the Bot sees it in its tool names.">
        <Input id={`${id}-name`} value={draft.name} onChange={(e) => change({ name: e.target.value })} placeholder="my-app" />
      </Field>
      <Segmented
        label="Kind"
        value={draft.kind}
        onChange={(kind) => change({ kind })}
        options={[
          { value: "web", label: "Web address" },
          { value: "program", label: "Program on the gateway" },
        ]}
      />
      {draft.kind === "web" ? (
        <>
          <Field htmlFor={`${id}-url`} label="Address">
            <Input id={`${id}-url`} value={draft.url} onChange={(e) => change({ url: e.target.value })} placeholder="https://mcp.example.com/mcp" />
          </Field>
          <Field htmlFor={`${id}-auth`} label="Sign-in">
            <Select value={draft.auth} onValueChange={(value) => change({ auth: value as McpServerDraft["auth"] })}>
              <SelectTrigger id={`${id}-auth`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="signIn">Sign in on the provider's page</SelectItem>
                <SelectItem value="token">A token</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {draft.auth === "token" && (
            <Field htmlFor={`${id}-token`} label="Token" help="Sent as a bearer token.">
              <Input id={`${id}-token`} type="password" autoComplete="off" value={draft.token} onChange={(e) => change({ token: e.target.value })} />
            </Field>
          )}
        </>
      ) : (
        <>
          <Field htmlFor={`${id}-command`} label="Program">
            <Input id={`${id}-command`} value={draft.command} onChange={(e) => change({ command: e.target.value })} placeholder="npx" />
          </Field>
          <Field htmlFor={`${id}-args`} label="Arguments" help='Separated by spaces. Use "double quotes" around one with spaces.'>
            <Input id={`${id}-args`} value={draft.arguments} onChange={(e) => change({ arguments: e.target.value })} placeholder="-y @example/mcp-server" />
          </Field>
          <Field htmlFor={`${id}-env`} label="Environment (optional)" help="One per line, as NAME=value.">
            <Textarea id={`${id}-env`} className="font-mono text-[12px]" rows={3} value={envText} onChange={(e) => setEnvText(e.target.value)} spellCheck={false} />
          </Field>
        </>
      )}
    </AppForm>
  );
}
