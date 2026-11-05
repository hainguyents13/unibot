Unibot is a Windows messenger for Hermes Agent's Bot Mode. It talks to a Hermes dashboard
(`hermes dashboard`) the user already runs, usually on a Linux VPS reached over Tailscale.

## What Unibot won't compromise on

- **Hermes only, and thin.** No agent runtime, no model providers, no backend of its own. Bots, memory,
  skills, routines, rooms and approvals live in Hermes; the app shows them and answers them.
- **Simple setup.** Install, enter the gateway address, sign in on the gateway's page.
- **Private.** Tokens stay in Windows Credential Manager; conversations stay on the device and the
  user's gateway.
- **Plain.** Text in the app says what happened and what to do next. User-facing text says "Bot", not "agent".
- **Independent.** Unibot isn't affiliated with Nous Research, and says so.

## Ways to hurt yourself

1. **Writing to a real gateway.** Its Bots and models are the developer's real ones: a test message
   costs money. Use the demo (`UNIBOT_DEMO=1` in a debug build, or the Vite preview in a browser) or
   the fakes, and a real gateway only when the change depends on it and the developer agrees.
2. **Touching real credentials.** Never print, log, commit or clear the saved sign-in. Examples use
   `100.101.102.103` and `hermes.example.com`.
3. **Stopping the wrong process.** Stop only a PID you captured when you started it.
4. **Renaming the CI job.** `name: build` is meant to be the required status check on `main`.

## Layout

- `src/hermes/`: the gateway client, plain TypeScript with no React, tested with Vitest.
  `session.ts` owns sign-in, the connection and every chat, room, routine list and screen;
  `chat-thread.ts`, `room.ts`, `routines.ts`, `screen.ts` and `mcp-servers.ts`/`connectors.ts` (a
  Bot's apps) are one of each. `demo-chats.ts` and
  `fake-gateway.ts` are the demo's data.
- `src/platform/`: the Tauri side of the client's interfaces (HTTP, WebSocket, Credential Manager,
  loopback). Loaded only inside the app, so the browser preview never imports Tauri plugins.
- `src/ui/`: React screens.
- `src-tauri/`: Rust, only for what the webview can't do: Credential Manager (`token_store.rs`), the
  sign-in loopback listener (`loopback.rs`), and the tray, close-to-tray, attention dot, start with
  Windows and notifications (`desktop.rs`).

## Traps

- **Rooms push nothing.** A room on screen is read every 2 s; the others when the room list shows new
  events or they're at work. A room's approval writes no event, which is why a working room keeps
  being read.
- **Notifications from a development build show as Windows PowerShell.** Toasts need an
  AppUserModelID, which only the installed app has (its identifier); `desktop.rs` borrows
  PowerShell's in debug builds, as Tauri's notification plugin does. Test click-through with an
  installed build.
- **Tauri's notification plugin can't report a click on Windows**, so `desktop.rs` uses
  `tauri-winrt-notification` directly and emits `unibot://open` with the chat to open.
- **Only one copy runs** (`tauri-plugin-single-instance`, registered first). A second launch shows
  the running window and exits; so does a development build while the installed app runs.
- **The Bot's screen opens a WebSocket from the page itself** (noVNC), not through Rust: binary
  frames through Tauri's IPC would be too slow. Whether a gateway accepts the page's `Origin` on
  `/api/display/ws` hasn't been seen on a real screen yet.

- **Gateway traffic goes through Rust.** The webview's own `fetch` and `WebSocket` would hit the
  gateway's CORS and Origin checks; Tauri's HTTP and WebSocket plugins don't. The HTTP plugin adds an
  `Origin` header unless the request sets it empty, which needs its `unsafe-headers` feature.
- **`gateway.ready` comes before `connect` returns.** The WebSocket plugin's JS wrapper drops frames
  that arrive before it hands back the socket, so `tauri-platform.ts` calls the plugin directly and
  holds early frames.
- **File drops need `dragDropEnabled: false`** on the window in `tauri.conf.json`; otherwise Tauri
  takes the drop and the page never sees it.
- **`/btw`, `/bg` and `/reasoning` are left out of the `/` menu** (`commands.ts`): they need handling
  of their own, which Unibot doesn't have yet.
- **Apps are two things in Hermes.** MCP servers go through the dashboard's REST routes
  (`/api/mcp/*`, each with `?profile=`; `mcp-servers.ts`); connected apps are Nous Portal accounts
  through the socket's `connectors.*` (`connectors.ts`) and exist only on a gateway with a Portal
  account. A Bot asking mid-turn is `connection.request`/`connection.update` events, answered with
  `connection.respond` as the session's owner (`connection-request.ts`); the card moves only when
  Hermes's next frame says so. Rooms get no card: Hermes puts the link in the member's reply.
- **An MCP sign-in returns to the gateway, not to Unibot.** Hermes builds the callback from the
  address Unibot used, unless `dashboard.public_url` is set, so a provider may refuse a plain-http
  Tailscale IP. Unibot opens the page and polls `/api/mcp/oauth/flows/{id}`.
- **GitHub, Plane and Composio are presets, not sign-ins** (`app-presets.ts`): GitHub's server has
  no dynamic client registration, so Hermes can't sign in to it, and hosted Plane's sign-in returns
  only to apps on its list. The add route takes a bearer token for a web server and `env` for a
  program, but no other headers, which is why Plane runs as `uvx plane-mcp-server stdio` and
  Composio (key in `x-consumer-api-key`) through `npx mcp-remote --header`. The `${COMPOSIO_API_KEY}`
  in its arguments is meant to stay literal: Hermes leaves an unset `${…}` alone and mcp-remote fills
  it from the server's env. Composio on a real gateway hasn't been tried.
- **Apply costs money.** `reload.mcp` (`confirm: true`, never `always`) drops the prompt cache, so
  the next reply resends the whole conversation. The panel says so.
- **Recent gateways are a file, not `localStorage`** (`recent_gateways.rs`, in the app's config
  folder). A development build's page is `localhost:1420` and the installed app's is
  `tauri.localhost`, so the webview's storage isn't shared between them; Credential Manager and the
  file are.
- **Only the refresh token is saved.** Credential Manager caps a credential at 2,560 bytes; a
  restored sign-in refreshes before its first request.

## Protocol reference

Unibot speaks the same protocol as Usual Bot (github.com/usual-labs/usual-bot): the dashboard socket
`/api/ws` (legacy dialect) and the dashboard's REST routes. Port behavior from Usual Bot's
`Packages/HermesKit` and the reasons in its `docs/agents/decisions.md`; don't guess at the protocol.

## Verifying

- `scripts/check.ps1 -Fast` while you work, `scripts/check.ps1` before you push. It runs what CI runs.
- See UI changes with `pnpm dev` and open http://localhost:1420 (the browser always shows the demo),
  or `pnpm tauri dev` with `UNIBOT_DEMO=1` for the real window. Screenshot light and dark.
- To check sign-in, the connection and chat end to end without a real gateway, run
  `node scripts/fake-hermes.mjs 19119` and sign in to `127.0.0.1:19119` in `pnpm tauri dev`. It logs
  each request, including whether an `Origin` header came along, streams a reply to any message,
  asks for an approval first when the message says "approve", offers `/summarize` and `/status`, and
  takes attachments. It also serves the MCP routes: its sign-in page is
  `/fake-oauth?flow=…`, and opening it approves the flow. It has no Nous Portal account. Set `WEBVIEW2_USER_DATA_FOLDER` to a
  scratch folder so the dev app doesn't restore your real sign-in. Sign out afterwards: that removes
  the test credential from Credential Manager.
- A logic bug gets a test that fails first. Fix a flaky test by finding the race; don't retry it.
