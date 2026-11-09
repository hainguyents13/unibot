import { ChatThread } from "./chat-thread";
import type { SlashCommand } from "./commands";
import { RoomThread } from "./room";
import { RoutineList } from "./routines";
import type { ChatRequest } from "./requests";
import { Transcript, type HistoryMessage } from "./transcript";

const MINUTE = 60;

const DEMO_COMMANDS: SlashCommand[] = [
  { name: "/web-research", description: "Search the web and write a short summary", kind: "skill" },
  { name: "/release-notes", description: "Draft release notes from merged pull requests", kind: "skill" },
  { name: "/status", description: "Show the model, context and tokens for this chat", kind: "command" },
  { name: "/retry", description: "Put your last message back to edit and send", kind: "command" },
  { name: "/usage", description: "Show token usage for this chat", kind: "command" },
];

/** A demo Bot's chat with nothing in it yet, for a Bot made in the demo. */
export function emptyDemoChat(id: string): ChatThread {
  return ChatThread.demo(id, Transcript.fromHistory([], false), [], playReply, DEMO_COMMANDS);
}

/**
 * The demo's chats: Forge waits on an approval, Ops is in the middle of a reply, Atlas has a
 * Markdown answer. What you send gets a scripted reply; nothing reaches a gateway.
 */
export function demoChats(nowMs: number = Date.now()): ChatThread[] {
  const at = (minutesAgo: number) => nowMs / 1000 - minutesAgo * MINUTE;
  const chat = (id: string, history: HistoryMessage[], requests: ChatRequest[] = [], running?: { user: string; assistant: string }) =>
    ChatThread.demo(id, Transcript.fromHistory(history, running !== undefined, running), requests, playReply, DEMO_COMMANDS);

  return [
    chat(
      "forge",
      [
        { role: "user", text: "Ship the invoice export fix today.", timestamp: at(9) },
        { role: "tool", name: "read_file", context: "src/export/invoices.ts", tool_call_id: "f1", timestamp: at(8) },
        { role: "tool", name: "terminal", context: "pnpm test export", tool_call_id: "f2", timestamp: at(7) },
        {
          role: "assistant",
          text: "The fix is in and **all 48 export tests pass**. The last step is the database migration that adds the `exported_at` column.",
          timestamp: at(3),
        },
      ],
      [
        {
          kind: "approval",
          id: "demo-approval",
          sessionId: "demo-forge",
          command: "pnpm db:migrate --env production",
          description: "Runs the pending migration on the production database.",
          choices: ["once", "session", "always", "deny"],
        },
      ],
    ),
    chat(
      "ops",
      [
        { role: "user", text: "Check last night's backups before the morning report.", timestamp: at(2) },
        { role: "tool", name: "terminal", context: "restic snapshots --latest 3", tool_call_id: "o1", timestamp: at(1) },
      ],
      [],
      { user: "", assistant: "Both database snapshots finished at 02:14. Checking the file store next" },
    ),
    chat("atlas", [
      { role: "user", text: "Which vector database fits us best?", timestamp: at(20) },
      {
        role: "assistant",
        text: [
          "**Turbopuffer** fits best: cheapest at our size, and fast enough.",
          "",
          "| Option | Monthly cost | p95 query |",
          "| --- | --- | --- |",
          "| Turbopuffer | $64 | 38 ms |",
          "| Pinecone | $210 | 22 ms |",
          "| pgvector | $0 extra | 120 ms |",
          "",
          "- Keep pgvector if we never pass a million vectors.",
          "- See the [benchmark notes](https://example.com/notes) for details.",
        ].join("\n"),
        timestamp: at(14),
      },
    ]),
    chat("scribe", [
      { role: "user", text: "Two headline options for the launch post?", timestamp: at(100) },
      { role: "assistant", text: "1. *Your Bots, on Windows*\n2. *A messenger for Hermes*", timestamp: at(95) },
      { role: "user", text: "Make a short teaser clip and the post as a file.", timestamp: at(70) },
      {
        role: "assistant",
        text: "Both are ready. The clip is 12 s at 720p.\n\nMEDIA:/opt/data/profiles/scribe/out/launch-teaser.mp4\n\nThe post is in `/opt/data/profiles/scribe/out/launch-post.md`.",
        timestamp: at(62),
      },
    ]),
    ledger(at),
  ];
}

/** Ledger asks to connect Google Drive and Gmail; Connect "finishes" a moment later. */
function ledger(at: (minutesAgo: number) => number): ChatThread {
  const thread = ChatThread.demo(
    "ledger",
    Transcript.fromHistory(
      [
        { role: "user", text: "Draft the October invoices from the timesheets in Drive.", timestamp: at(30) },
        { role: "tool", name: "manage_connections", context: "google_drive, gmail", tool_call_id: "l1", timestamp: at(29) },
      ],
      false,
    ),
    [],
    playReply,
    DEMO_COMMANDS,
  );
  thread.showDemoConnection({
    id: "demo-connect",
    sessionId: "demo-ledger",
    seq: 1,
    targets: [
      { name: "google_drive", kind: "connector", action: "connect", state: "initiated", connectUrl: "https://example.com/connect", needsCredentials: false, title: "Google Drive" },
      { name: "gmail", kind: "connector", action: "connect", state: "initiated", connectUrl: "https://example.com/connect", needsCredentials: false, title: "Gmail" },
    ],
  });
  return thread;
}

/** The demo's room: three Bots planning a launch, one waiting on your OK. */
export function demoRooms(nowMs: number = Date.now()): RoomThread[] {
  const at = (minutesAgo: number) => nowMs / 1000 - minutesAgo * MINUTE;
  const members = ["forge", "scribe", "atlas"].map((id) => ({ id, profile: id, handle: id }));
  const ev = (seq: number, minutesAgo: number, kind: string, payload: Record<string, unknown>) => ({
    seq,
    kind,
    event_id: `demo-${seq}`,
    payload,
    created_at: at(minutesAgo),
  });
  return [
    RoomThread.withEvents(
      { id: "launch", name: "Launch week", members, updatedAt: at(5) * 1000, latestSeq: 4 },
      [
        ev(1, 12, "message.user", { text: "Let's get the Windows launch out on Thursday. What's left?" }),
        ev(2, 10, "message.member", { member_id: "forge", text: "The installer builds and signs. I need to tag the release. @scribe can you draft the post?" }),
        ev(3, 7, "message.member", { member_id: "scribe", text: "Draft is ready: **Your Bots, on Windows**. Three short sections and a screenshot." }),
        ev(4, 5, "message.member", { member_id: "atlas", text: "Two competitors launched last month; neither has rooms. Worth a line in the post." }),
      ],
      {
        running: true,
        pending_actions: [
          {
            kind: "approval",
            member_id: "forge",
            task_id: "demo-task",
            execution_generation: 1,
            request_id: "demo-room-approval",
            approval: { command: "git tag v0.1.0 && git push --tags", description: "Tags and publishes the release." },
          },
        ],
      },
    ),
  ];
}

/** Each demo Bot's routines; switches and Run now work without a gateway. */
export function demoRoutines(nowMs: number = Date.now()): Record<string, RoutineList> {
  const hour = 3_600_000;
  return {
    ops: RoutineList.demo("ops", [
      { id: "backups", name: "Check backups", schedule: "30 6 * * *", isOn: true, isFinished: false, nextRun: nowMs + 5 * hour, lastRunFailed: false },
      { id: "costs", name: "Weekly cost report", schedule: "0 9 * * mon", isOn: true, isFinished: false, nextRun: nowMs + 50 * hour, lastRunFailed: true, lastError: "The billing API timed out" },
      { id: "certs", name: "Watch certificate expiry", schedule: "every 720m", isOn: false, isFinished: false, lastRunFailed: false },
    ]),
    atlas: RoutineList.demo("atlas", [
      { id: "papers", name: "New papers digest", schedule: "0 8 * * 1-5", isOn: true, isFinished: false, nextRun: nowMs + 9 * hour, lastRunFailed: false },
    ]),
  };
}

/** A turn from a pretend gateway: a tool call, then a reply as it streams. */
function playReply(thread: ChatThread): void {
  const steps: Array<[number, string, Record<string, unknown>]> = [
    [400, "message.start", {}],
    [300, "tool.start", { tool_id: `demo-${Date.now()}`, name: "read_file", context: "notes.md" }],
    [900, "tool.complete", {}],
    ...["I read the notes. ", "Everything you asked about still holds, ", "and nothing else needs your attention."].map(
      (text): [number, string, Record<string, unknown>] => [300, "message.delta", { text }],
    ),
    [300, "message.complete", { status: "complete" }],
  ];
  let toolId = "";
  let delay = 0;
  for (const [pause, type, payload] of steps) {
    delay += pause;
    setTimeout(() => {
      if (!thread.getView().isRunning) return; // Stopped meanwhile.
      if (type === "tool.start") toolId = payload.tool_id as string;
      thread.apply({ type, payload: type === "tool.complete" ? { tool_id: toolId, duration_s: 0.9 } : payload });
    }, delay);
  }
}
