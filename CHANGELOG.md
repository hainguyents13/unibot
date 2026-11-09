# Changelog

All notable changes to Unibot are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## Unreleased

### Added

- **A new look**, built on shadcn/ui and prompt-kit: a calmer sidebar, message bubbles, a message box
  with Send, Stop and Attach buttons, a button to jump to the newest message, and dialogs and
  Settings in one style.
- **A panel beside each Bot's chat** (**Details**, or ⋯ → Settings in the sidebar): its name, role and
  rules (SOUL.md), its provider, model and thinking level, its routines, and its computer. A model
  that costs more asks first; a provider without a key takes one there. Saving switches the open
  chat too.
- **Download what a Bot makes**: a file a reply hands over (a `MEDIA:` line, or a path the Bot
  writes out) shows as a card with **Download**, which saves it in your Downloads folder.
- **Make, copy and delete Bots**: **+** beside Bots makes one from a name and what it's for; ⋯ on a
  Bot opens its settings, starts a room with it, duplicates it or deletes it.
- **Appearance** in Settings: light, dark or like Windows, five colour themes, and the size of text
  in chats. The rest of the app's text is bigger too, and replies take most of the chat's width.

- **Sign in to your Hermes gateway** through its sign-in page in your browser. The sign-in is kept in
  Windows Credential Manager, and Unibot reconnects by itself when the connection drops. Gateways
  you've used are listed on the sign-in screen, and one with a saved sign-in opens without the browser.
- **Chat with each Bot** in its Bot Chat, with streaming replies, Markdown, tool calls folded into one
  line, Stop, and messages sent from another device filled in.
- **Settings**: the gateway (switch to another, keeping each sign-in, or sign out), Composio (one
  key for the Bots you tick) and each Bot's apps, in one window with a page list.
- **Approvals, questions and masked prompts** in the chat.
- **Attachments**: pick, drop or paste images and files.
- **Skills and commands** on `/`.
- **Rooms**: start one with two to six Bots, rename or delete it, read and send, `@name` to ask one
  Bot, approve, retry or stop.
- **Routines**: plain-words schedules, pause and resume, Run now, in the chat's panel.
- **Apps**: each Bot's MCP servers on the gateway: add GitHub, Plane or Composio from a quick setup, add from
  Hermes's catalog or your own, sign in on the provider's page, switch, test, remove, and apply to
  the open chat. Apps connected through a Nous Portal account, and a card in the chat when a Bot asks
  to connect one.
- **The Bot's computer**: watch, take over and hand back, on gateways with Bot Screen.
- **Tray, notifications and start with Windows.** Closing the window keeps Unibot running; a dot on
  the tray icon shows when a Bot needs you; notifications open their chat; only one copy runs.
