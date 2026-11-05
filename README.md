# Unibot

A Windows messenger for your [Hermes Agent](https://github.com/NousResearch/hermes-agent) Bots.

Unibot connects to the Hermes gateway you already run and works with Hermes
[Bot Mode](https://hermes-agent.nousresearch.com/docs/user-guide/bot-mode): each Bot is a contact
with its ongoing Bot Chat, group chats are rooms, and routines sit beside each Bot's chat. There is
no agent runtime, model setup or backend in the app; Hermes does that. Unibot lives in the tray and
tells you when a Bot replies or needs you.

## What it does

- **Chat with each Bot**, with replies streaming in, Markdown, and tool calls folded into one line
  you can open. Messages you send from another device show up here too.
- **Answer what Bots ask** right in the chat: allow a command once, for this chat or always, or deny
  it; answer their questions; send a secret or a sudo password in a masked field.
- **Send files**: pick, drop or paste them. Images go to the Bot to look at, other files to its workspace.
- **Skills and commands** on `/`, such as a Bot's skills or Hermes's `/status`.
- **Rooms**: start one with **+** beside Rooms and pick two to six Bots. A message goes to every Bot
  in the room, and `@name` asks one. Approve, retry or stop their turns, and rename or delete the room.
- **Routines**: see each Bot's scheduled jobs in plain words, pause or resume them, and run one now.
- **Apps**: give a Bot tools from other services. Add GitHub, Plane or Composio in a few steps, anything from
  Hermes's catalog (Linear, Notion, Dropbox and more), or your own MCP server; sign in on the
  provider's page where it asks, test it, and apply it to the open chat. Gateways with a Nous Portal
  account also connect apps such as Gmail and Google Drive there. When a Bot asks to connect an app
  mid-chat, the chat shows what it wants and a Connect button.
- **The Bot's computer**: when Hermes gives a Bot a screen of its own (a Linux gateway with Bot
  Screen set up), watch it live, take over the mouse and keyboard, and hand it back.
- **Tray and notifications**: closing the window keeps Unibot connected in the tray; a dot shows
  when a Bot needs you, and notifications open the chat they're about. It can start with Windows.

## Install

Download `Unibot_<version>_x64-setup.exe` from the latest release and run it. It installs for you
alone and needs no administrator rights. The installer isn't code-signed yet, so Windows SmartScreen
may warn the first time: choose **More info**, then **Run anyway**.

Then enter your gateway's address and sign in on the gateway's page that opens in your browser.
Unibot lists the gateways you've used on its sign-in screen, and **Settings** → Gateway switches
between them without signing in again.

## What you'll need

- **A Hermes gateway running the dashboard** (`hermes dashboard`, port 9119) with a sign-in method
  set up. Unibot uses its browser sign-in for apps (`native_pkce` in `/api/status`). Tested with
  Hermes Agent 0.22.5.
- **A way to reach it.** A Linux VPS on [Tailscale](https://tailscale.com) works well: the dashboard
  stays off the public internet, plain `http` is fine inside the tailnet, and you can use your Bots
  from anywhere you're signed in to Tailscale. Public addresses must use `https`.
- **Windows 10 or 11.** Unibot uses the WebView2 runtime Windows already has; the installer fetches
  it if it's missing.

## Connecting apps

Apps live on your gateway, per Bot: Hermes runs them and keeps every token, key and sign-in. Open
**Settings** at the bottom of the sidebar and pick a Bot under Apps, or choose **Apps** in its chat.

- **GitHub**: Quick setup → GitHub, and paste a
  [personal access token](https://github.com/settings/personal-access-tokens/new). It uses GitHub's
  own server at `api.githubcopilot.com/mcp/`. GitHub doesn't let other apps register for its
  sign-in, so a token is the way.
- **Plane**: Quick setup → Plane, with a personal access token and your workspace slug. The gateway
  runs `uvx plane-mcp-server stdio`, so its computer needs [uv](https://docs.astral.sh/uv/).
- **Composio**: **Settings** → Composio, paste an API key from
  [Composio's dashboard](https://dashboard.composio.dev) and tick the Bots that use it (or add it to
  one Bot from its Quick setup). One server gives the Bot hundreds of apps,
  Gmail and Google Drive, Docs, Sheets, Slides and Calendar among them; the first time it needs one,
  it replies with a sign-in link. The gateway runs `npx mcp-remote` to send the key, so its computer
  needs [Node.js](https://nodejs.org). Composio keeps those sign-ins, and the Bot's calls to those
  apps pass through it.
- **Linear, Notion, Dropbox and others** come from Hermes's catalog. Add one, then **Sign in**: the
  provider's page opens in your browser, sends you back to the gateway, and the Bot can use it.
- **Google Drive, Docs, Sheets, Slides and Calendar**: the simplest way is Composio, or Connected
  apps if your gateway has a Nous Portal account. To keep the Google sign-in on your gateway instead,
  run a Google Workspace MCP server (such as
  [google_workspace_mcp](https://github.com/taylorwilsdon/google_workspace_mcp)) with your own Google
  Cloud OAuth client, and add it under **Your own**.

Sign-in pages return to the gateway at the address Unibot uses, unless the gateway sets
`dashboard.public_url`. Many providers want `https` there, and Google refuses a plain IP address,
so a gateway on a Tailscale IP may need [Tailscale Serve](https://tailscale.com/kb/1312/serve) for
an `https://<machine>.<tailnet>.ts.net` address.

Changes reach a chat that's already open only when you **Apply** them: Hermes reloads the apps, and
the next reply costs more because the whole conversation is sent again.

## Build from source

You need [Node.js](https://nodejs.org) 24 with [pnpm](https://pnpm.io), and [Rust](https://rustup.rs)
with the MSVC build tools.

```powershell
pnpm install
$env:UNIBOT_DEMO = "1"; pnpm tauri dev   # a made-up team of Bots; nothing connects anywhere
pnpm tauri dev                           # the real app
pnpm tauri build                         # the installer, in src-tauri/target/release/bundle/nsis
```

`scripts/check.ps1` runs what CI runs. `node scripts/fake-hermes.mjs 19119` starts a pretend gateway
on `127.0.0.1:19119` for trying sign-in, chats, rooms and routines without a real one.

## Credits

Unibot speaks the same gateway protocol as [Usual Bot](https://github.com/usual-labs/usual-bot), the
native Hermes messenger for Mac and iPhone, and follows its design. It uses
[Tauri](https://tauri.app), [React](https://react.dev), [Tailwind CSS](https://tailwindcss.com),
[shadcn/ui](https://ui.shadcn.com) and [Radix](https://www.radix-ui.com) (MIT),
[prompt-kit](https://www.prompt-kit.com) (MIT), [Lucide](https://lucide.dev) icons (ISC), [markdown-it](https://github.com/markdown-it/markdown-it)
(MIT) and [noVNC](https://github.com/novnc/noVNC) (MPL-2.0) for the Bot's screen.

## License

Unibot is licensed under the [Apache License 2.0](LICENSE). Hermes Agent is a separate project by
Nous Research under its own license.

Unibot is an independent project: it isn't made by, affiliated with or endorsed by Nous Research.
