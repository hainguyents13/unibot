import { describe, expect, it } from "vitest";
import { Transcript } from "./transcript";

const ev = (type: string, payload: Record<string, unknown> = {}) => ({ type, payload });
const contents = (t: Transcript) => t.items.map((i) => i.content);

describe("Transcript.fromHistory", () => {
  it("reads messages and folds consecutive tool rows into one activity line", () => {
    const t = Transcript.fromHistory(
      [
        { role: "user", text: "Check the logs", timestamp: 100 },
        { role: "tool", name: "terminal", context: "tail app.log", tool_call_id: "a" },
        { role: "tool", name: "read_file", context: "app.log", tool_call_id: "b" },
        { role: "assistant", text: "All quiet." },
        { role: "assistant", text: "   " },
        { role: "system", text: "ignored" },
      ],
      false,
    );
    expect(contents(t)).toEqual([
      { kind: "user", text: "Check the logs" },
      {
        kind: "activity",
        steps: [
          { id: "a", name: "terminal", context: "tail app.log", state: "done" },
          { id: "b", name: "read_file", context: "app.log", state: "done" },
        ],
      },
      { kind: "assistant", text: "All quiet." },
    ]);
    expect(t.items[0].date).toBe(100_000);
  });

  it("shows turns Hermes started itself by their kind, not as your messages", () => {
    const t = Transcript.fromHistory(
      [
        {
          role: "user",
          text: "[IMPORTANT: Background process build finished\nexit 0]",
          display_kind: "process_complete",
        },
        { role: "user", text: "continue", display_kind: "auto_continue" },
      ],
      false,
    );
    expect(contents(t)).toEqual([
      { kind: "result", title: "Background process build finished", detail: "exit 0" },
      { kind: "notice", text: "Picked up an interrupted reply" },
    ]);
  });

  it("puts back a running turn's prompt and the reply streamed so far", () => {
    const t = Transcript.fromHistory([{ role: "assistant", text: "Earlier" }], true, { user: "Go on", assistant: "Half a rep" });
    expect(contents(t).at(-1)).toEqual({ kind: "user", text: "Go on" });
    expect(t.draft).toBe("Half a rep");
    expect(t.isRunning).toBe(true);
  });
});

describe("Transcript live events", () => {
  it("streams a reply, folds tool calls between its parts, and ends the turn", () => {
    const t = new Transcript();
    t.sendLocally("Run the checks");
    t.apply(ev("message.start"));
    t.apply(ev("message.delta", { text: "Looking" }));
    t.apply(ev("tool.start", { tool_id: "1", name: "terminal", context: "npm test" }));
    t.apply(ev("tool.progress", { tool_id: "1", percent: 41.6 }));
    expect(t.items.at(-1)?.content).toMatchObject({ kind: "activity", steps: [{ progress: "42%", state: "running" }] });
    t.apply(ev("tool.complete", { tool_id: "1", summary: "12 passed", duration_s: 3 }));
    t.apply(ev("message.delta", { text: "All " }));
    t.apply(ev("message.delta", { text: "good." }));
    expect(t.draft).toBe("All good.");
    t.apply(ev("message.complete", { status: "complete" }));

    expect(t.isRunning).toBe(false);
    expect(t.draft).toBe("");
    expect(contents(t)).toEqual([
      { kind: "user", text: "Run the checks" },
      { kind: "assistant", text: "Looking" },
      { kind: "activity", steps: [{ id: "1", name: "terminal", context: "npm test", state: "done", summary: "12 passed", durationSeconds: 3, progress: undefined }] },
      { kind: "assistant", text: "All good." },
    ]);
  });

  it("takes the whole reply from message.complete when the provider didn't stream", () => {
    const t = new Transcript();
    t.sendLocally("Hi");
    t.apply(ev("message.complete", { text: "Hello!" }));
    expect(contents(t).at(-1)).toEqual({ kind: "assistant", text: "Hello!" });
  });

  it("says Stopped after an interrupt, and marks running steps failed", () => {
    const t = new Transcript();
    t.sendLocally("Long job");
    t.apply(ev("tool.start", { tool_id: "x", name: "terminal" }));
    t.apply(ev("message.complete", { status: "interrupted" }));
    expect(contents(t).at(-1)).toEqual({ kind: "notice", text: "Stopped" });
    expect(t.items[1].content).toMatchObject({ steps: [{ state: "failed" }] });
  });

  it("shows a failed reply as a notice with the gateway's words", () => {
    const t = new Transcript();
    t.sendLocally("Hi");
    t.apply(ev("message.delta", { text: "partial" }));
    t.apply(ev("message.complete", { status: "error", text: "Provider returned 429" }));
    expect(contents(t).at(-1)).toEqual({ kind: "notice", text: "Provider returned 429" });
  });

  it("replaces and clears keyed notices", () => {
    const t = new Transcript();
    t.apply(ev("notification.show", { key: "fallback", text: "Switched to a fallback model" }));
    t.apply(ev("notification.show", { key: "fallback", text: "Back on the main model" }));
    expect(contents(t)).toEqual([{ kind: "notice", text: "Back on the main model" }]);
    t.apply(ev("notification.clear", { key: "fallback" }));
    expect(t.items).toEqual([]);
  });

  it("puts another device's message back where its turn began", () => {
    const t = new Transcript();
    t.apply(ev("message.start"));
    t.apply(ev("message.delta", { text: "Sure, here it is." }));
    t.apply(ev("message.complete"));
    t.insertPrompt({ role: "user", text: "Send me the report", timestamp: 50 }, 0);
    expect(contents(t)).toEqual([
      { kind: "user", text: "Send me the report" },
      { kind: "assistant", text: "Sure, here it is." },
    ]);
  });

  it("knows the newest message for the sidebar, including a reply still streaming", () => {
    const t = new Transcript();
    expect(t.latestMessage()).toBeUndefined();
    t.sendLocally("Hi");
    expect(t.latestMessage()?.text).toBe("Hi");
    t.apply(ev("message.delta", { text: "Hel" }));
    expect(t.latestMessage()?.text).toBe("Hel");
    t.addNotice("Stopped");
    expect(t.latestMessage()?.text).toBe("Hel");
  });

  it("does not repeat an interim message that was already streamed", () => {
    const t = new Transcript();
    t.sendLocally("Hi");
    t.apply(ev("message.delta", { text: "Thinking it over" }));
    t.apply(ev("message.interim", { text: "Thinking it over", already_streamed: true }));
    expect(contents(t).filter((c) => c.kind === "assistant")).toHaveLength(1);
  });
});
