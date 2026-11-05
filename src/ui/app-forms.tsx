import { useState, type FormEvent, type ReactNode } from "react";
import { presetReady, type AppPreset } from "../hermes/app-presets";
import { emptyDraft, isDraftComplete, draftHasSecret, type McpCatalogEntry, type McpServerDraft, type McpServerList } from "../hermes/mcp-servers";
import { openExternal } from "./open-external";

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
    <form className="app-form" onSubmit={submit}>
      <h3>{title}</h3>
      <div className="app-form-body" inert={busy}>
        {children}
        {needsConsent && (
          <label className="consent">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>This gateway uses plain http outside Tailscale, so others on the network could read what you send. Send it anyway.</span>
          </label>
        )}
        <p className="card-note">What you type goes to your gateway, which keeps it. Unibot keeps no copy.</p>
      </div>
      <div className="card-actions">
        <button type="submit" className="primary" disabled={!ready || busy || (needsConsent && !consent)}>
          {busy ? "Adding…" : "Add"}
        </button>
        <button type="button" onClick={onDone} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function Field({ label, help, children }: { label: string; help?: ReactNode; children: ReactNode }) {
  return (
    <label className="dialog-field">
      <span>{label}</span>
      {children}
      {help && <span className="hint">{help}</span>}
    </label>
  );
}

/** GitHub or Plane, from a few values. */
export function PresetForm({ preset, list, onDone }: FormProps & { preset: AppPreset }) {
  const [values, setValues] = useState<Record<string, string>>({});
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
      <p className="card-note">{preset.needs}</p>
      <p>
        <button type="button" className="link-button" onClick={() => void openExternal(preset.link.url)}>
          {preset.link.label}
        </button>
      </p>
      {preset.fields.map((field) => (
        <Field key={field.key} label={field.required ? field.label : `${field.label} (optional)`} help={field.help}>
          <input
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
      {entry.description && <p className="card-note">{entry.description}</p>}
      {entry.needsInstall && <p className="card-note">The gateway fetches it first, which can take a few minutes.</p>}
      {entry.requiredEnv.map((key) => (
        <Field key={key.name} label={key.required ? (key.prompt ?? key.name) : `${key.prompt ?? key.name} (optional)`}>
          <input type="password" autoComplete="off" value={values[key.name] ?? ""} onChange={(e) => setValues({ ...values, [key.name]: e.target.value })} />
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
  const full = { ...draft, env: draft.kind === "program" ? parseEnv(envText) : {} };
  const change = (patch: Partial<McpServerDraft>) => setDraft({ ...draft, ...patch });
  return (
    <AppForm title="Add your own" list={list} onDone={onDone} hasSecret={draftHasSecret(full)} ready={isDraftComplete(full)} add={(allow) => list.add(full, allow)}>
      <Field label="Name" help="Short and without spaces; the Bot sees it in its tool names.">
        <input value={draft.name} onChange={(e) => change({ name: e.target.value })} placeholder="my-app" />
      </Field>
      <div className="segmented" role="radiogroup" aria-label="Kind">
        <button type="button" role="radio" aria-checked={draft.kind === "web"} onClick={() => change({ kind: "web" })}>
          Web address
        </button>
        <button type="button" role="radio" aria-checked={draft.kind === "program"} onClick={() => change({ kind: "program" })}>
          Program on the gateway
        </button>
      </div>
      {draft.kind === "web" ? (
        <>
          <Field label="Address">
            <input value={draft.url} onChange={(e) => change({ url: e.target.value })} placeholder="https://mcp.example.com/mcp" />
          </Field>
          <Field label="Sign-in">
            <select value={draft.auth} onChange={(e) => change({ auth: e.target.value as McpServerDraft["auth"] })}>
              <option value="none">None</option>
              <option value="signIn">Sign in on the provider's page</option>
              <option value="token">A token</option>
            </select>
          </Field>
          {draft.auth === "token" && (
            <Field label="Token" help="Sent as a bearer token.">
              <input type="password" autoComplete="off" value={draft.token} onChange={(e) => change({ token: e.target.value })} />
            </Field>
          )}
        </>
      ) : (
        <>
          <Field label="Program">
            <input value={draft.command} onChange={(e) => change({ command: e.target.value })} placeholder="npx" />
          </Field>
          <Field label="Arguments" help='Separated by spaces. Use "double quotes" around one with spaces.'>
            <input value={draft.arguments} onChange={(e) => change({ arguments: e.target.value })} placeholder="-y @example/mcp-server" />
          </Field>
          <Field label="Environment (optional)" help="One per line, as NAME=value.">
            <textarea className="env-input" rows={3} value={envText} onChange={(e) => setEnvText(e.target.value)} spellCheck={false} />
          </Field>
        </>
      )}
    </AppForm>
  );
}
