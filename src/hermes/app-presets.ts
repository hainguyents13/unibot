import { emptyDraft, type McpServerDraft } from "./mcp-servers";

/** Something a preset asks you for: the server's token, or one of its env values. */
export interface PresetField {
  /** `token` for a web server's bearer token, else the env name. */
  key: string;
  label: string;
  secret: boolean;
  required: boolean;
  placeholder?: string;
  help?: string;
}

/**
 * A ready-made server for a service Hermes's catalog doesn't carry. None needs a sign-in flow:
 * GitHub's server has no dynamic client registration, so Hermes can't sign in to it, Plane's
 * hosted sign-in only returns to the apps on its list, and Composio's sign-ins return to Composio.
 */
export interface AppPreset {
  id: string;
  title: string;
  description: string;
  /** What to set up first, outside Unibot. */
  needs: string;
  /** Where to make the token or key. */
  link: { label: string; url: string };
  fields: PresetField[];
  draft: (values: Record<string, string>) => McpServerDraft;
}

export const APP_PRESETS: AppPreset[] = [
  {
    id: "github",
    title: "GitHub",
    description: "Repositories, issues, pull requests and Actions, through GitHub's own MCP server.",
    needs: "A GitHub personal access token. Give it only the repositories and permissions the Bot needs.",
    link: { label: "Make a token on GitHub", url: "https://github.com/settings/personal-access-tokens/new" },
    fields: [{ key: "token", label: "Personal access token", secret: true, required: true, placeholder: "github_pat_…" }],
    draft: (values) => ({
      ...emptyDraft,
      name: "github",
      kind: "web",
      url: "https://api.githubcopilot.com/mcp/",
      auth: "token",
      token: values.token ?? "",
    }),
  },
  {
    id: "plane",
    title: "Plane",
    description: "Projects, work items, cycles and pages in a Plane workspace.",
    needs:
      "A Plane personal access token (Profile Settings → Personal Access Tokens in Plane), and uv on the gateway's computer: it runs plane-mcp-server.",
    link: { label: "How to make a token", url: "https://developers.plane.so/api-reference/introduction" },
    fields: [
      { key: "PLANE_API_KEY", label: "Personal access token", secret: true, required: true },
      { key: "PLANE_WORKSPACE_SLUG", label: "Workspace slug", secret: false, required: true, help: "The part after app.plane.so/ in your workspace's address." },
      { key: "PLANE_BASE_URL", label: "Address of a self-hosted Plane", secret: false, required: false, placeholder: "https://api.plane.so" },
    ],
    draft: (values) => ({
      ...emptyDraft,
      name: "plane",
      kind: "program",
      command: "uvx",
      arguments: "plane-mcp-server stdio",
      env: Object.fromEntries(["PLANE_API_KEY", "PLANE_WORKSPACE_SLUG", "PLANE_BASE_URL"].map((k) => [k, values[k] ?? ""])),
    }),
  },
  {
    id: "composio",
    title: "Composio",
    description: "Hundreds of apps through one server, among them Gmail, Google Drive, Docs, Sheets, Slides and Calendar. The Bot sends you a sign-in link the first time it needs one.",
    needs:
      "A Composio API key, and Node.js on the gateway's computer: it runs mcp-remote to send the key. Your sign-ins to Google and the other apps are kept by Composio, not your gateway, and the Bot's calls to them pass through Composio.",
    link: { label: "Get a key from Composio", url: "https://dashboard.composio.dev" },
    fields: [{ key: "COMPOSIO_API_KEY", label: "API key", secret: true, required: true }],
    // Composio wants the key in `x-consumer-api-key`, and Hermes's add route sends only a bearer
    // token, so mcp-remote carries it. The `${…}` stays literal in the gateway's config: mcp-remote
    // fills it from the env at start, which keeps the key out of the arguments.
    draft: (values) => ({
      ...emptyDraft,
      name: "composio",
      kind: "program",
      command: "npx",
      arguments: "-y mcp-remote https://connect.composio.dev/mcp --header x-consumer-api-key:${COMPOSIO_API_KEY}",
      env: { COMPOSIO_API_KEY: values.COMPOSIO_API_KEY ?? "" },
    }),
  },
];

/** Whether every required field of `preset` is filled in. */
export function presetReady(preset: AppPreset, values: Record<string, string>): boolean {
  return preset.fields.every((f) => !f.required || (values[f.key] ?? "").trim() !== "");
}
