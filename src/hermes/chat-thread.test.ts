import { describe, expect, it } from "vitest";
import { ChatThread } from "./chat-thread";
import { GatewayError } from "./gateway-error";
import type { ApprovalPrompt, ClarifyPrompt, SecretPrompt } from "./requests";

/** A channel playing a legacy gateway: answers calls from `answers`, records calls and responses. */
function gateway(answers: Record<string, (params: Record<string, unknown>) => unknown> = {}) {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const responses: Array<[string, unknown]> = [];
  const channel = {
    call: async (method: string, params: Record<string, unknown> = {}) => {
      calls.push([method, params]);
      const answer = answers[method];
      if (answer) return answer(params);
      if (method === "session.resume") return { session_id: "live", messages: [{ role: "assistant", text: "Hello" }] };
      return {};
    },
    respond: (id: string, result: unknown) => {
      responses.push([id, result]);
    },
  };
  return { channel, calls, responses };
}

async function openThread(answers?: Parameters<typeof gateway>[0]) {
  const g = gateway(answers);
  const thread = new ChatThread("ops", () => g.channel);
  await thread.open("stored", "legacy");
  return { ...g, thread };
}

const approval: ApprovalPrompt = { kind: "approval", id: "srq-1", sessionId: "live", command: "rm -rf build\n# cleanup", description: "", choices: ["once", "deny"] };

describe("ChatThread", () => {
  it("opens the Bot Chat and shows its history", async () => {
    const { thread } = await openThread();
    expect(thread.getView()).toMatchObject({ phase: { kind: "ready" }, canSend: true, items: [{ content: { kind: "assistant", text: "Hello" } }] });
    expect(thread.sessionId).toBe("live");
  });

  it("says why a chat couldn't open", async () => {
    const { thread } = await openThread({
      "session.resume": () => {
        throw new GatewayError("rpc", "Session is open in another Hermes window", 4009);
      },
    });
    expect(thread.getView().phase).toEqual({ kind: "failed", message: "Session is open in another Hermes window" });
  });

  it("refuses chats on the newer protocol, saying so", async () => {
    const thread = new ChatThread("ops", () => gateway().channel);
    await thread.open(undefined, "canonical");
    expect(thread.getView().phase).toMatchObject({ kind: "failed" });
  });

  it("shows your message at once and submits it", async () => {
    const { thread, calls } = await openThread();
    thread.send("  Check the backups  ");
    expect(thread.getView().items.at(-1)?.content).toEqual({ kind: "user", text: "Check the backups" });
    expect(thread.status).toBe("working");
    expect(calls.at(-1)).toEqual(["prompt.submit", { session_id: "live", text: "Check the backups" }]);
  });

  it("steers a running turn instead of starting a new one", async () => {
    const { thread, calls } = await openThread();
    thread.send("First");
    thread.send("Use the staging server");
    expect(calls.at(-1)).toEqual(["session.steer", { session_id: "live", text: "Use the staging server" }]);
  });

  it("resubmits a steer that arrived after the turn ended", async () => {
    const { thread, calls } = await openThread({ "session.steer": () => ({ status: "rejected" }) });
    thread.send("First");
    thread.send("Second");
    await Promise.resolve();
    await Promise.resolve();
    expect(calls.at(-1)).toEqual(["prompt.submit", { session_id: "live", text: "Second" }]);
  });

  it("ends the turn with a notice when the gateway refuses the message", async () => {
    const { thread } = await openThread({
      "prompt.submit": () => {
        throw new GatewayError("rpc", "No model configured", 1);
      },
    });
    thread.send("Hi");
    await Promise.resolve();
    await Promise.resolve();
    expect(thread.getView()).toMatchObject({ isRunning: false });
    expect(thread.getView().items.at(-1)?.content).toEqual({ kind: "notice", text: "No model configured" });
  });

  it("interrupts a running turn", async () => {
    const { thread, calls } = await openThread();
    thread.send("Long job");
    thread.stop();
    expect(calls.at(-1)).toEqual(["session.interrupt", { session_id: "live" }]);
  });

  it("answers an approval and says so in the chat", async () => {
    const { thread, responses } = await openThread();
    thread.receive(approval);
    expect(thread.status).toBe("needsYou");
    thread.answerApproval(approval, "once");
    expect(responses).toEqual([["srq-1", { choice: "once" }]]);
    expect(thread.getView().requests).toEqual([]);
    expect(thread.getView().items.at(-1)?.content).toEqual({ kind: "notice", text: "You allowed “rm -rf build” once" });
  });

  it("picks up requests the gateway was already waiting on when it opened", async () => {
    const { thread } = await openThread({
      "session.resume": () => ({
        session_id: "live",
        open_requests: [{ id: "srq-9", method: "approval", params: { command: "ls" } }],
      }),
    });
    expect(thread.getView().requests).toMatchObject([{ id: "srq-9", kind: "approval", sessionId: "live" }]);
  });

  it("drops a request the gateway withdrew, noting a timeout", async () => {
    const { thread } = await openThread();
    thread.receive(approval);
    thread.apply({ type: "request.cancel", payload: { id: "srq-1", reason: "timeout" } });
    expect(thread.getView().requests).toEqual([]);
    expect(thread.getView().items.at(-1)?.content).toEqual({ kind: "notice", text: "Nobody answered in time, so “rm -rf build” didn't run." });
  });

  it("answers clarify questions, showing your answers as your side of the chat", async () => {
    const { thread, responses } = await openThread();
    const prompt: ClarifyPrompt = {
      kind: "clarify",
      id: "q",
      sessionId: "live",
      questions: [
        { id: "1", text: "Branch?", choices: ["main"], allowsMultiple: false },
        { id: "2", text: "Files?", choices: ["a", "b"], allowsMultiple: true },
        { id: "3", text: "Notes?", choices: [], allowsMultiple: false },
      ],
    };
    thread.receive(prompt);
    thread.answerClarify(prompt, { "1": ["main"], "2": ["a", "b"] });
    expect(responses).toEqual([["q", { answers: { "1": "main", "2": '["a","b"]', "3": null }, outcome: "submitted" }]]);
    expect(thread.getView().items.at(-1)?.content).toEqual({ kind: "user", text: "main\na, b" });
  });

  it("sends a secret without ever writing it into the chat", async () => {
    const { thread, responses } = await openThread();
    const prompt: SecretPrompt = { kind: "secret", id: "s", sessionId: "live", name: "GITHUB_TOKEN", message: "" };
    thread.receive(prompt);
    thread.answerSecret(prompt, "ghp_secret");
    expect(responses).toEqual([["s", { value: "ghp_secret" }]]);
    expect(JSON.stringify(thread.getView().items)).not.toContain("ghp_secret");
    expect(thread.getView().items.at(-1)?.content).toEqual({ kind: "notice", text: "You sent GITHUB_TOKEN" });
  });

  it("skips a secret with an empty value", async () => {
    const { thread, responses } = await openThread();
    const prompt: SecretPrompt = { kind: "sudo", id: "p", sessionId: "live", name: "apt install x", message: "" };
    thread.receive(prompt);
    thread.skipSecret(prompt);
    expect(responses).toEqual([["p", { value: "" }]]);
  });

  describe("commands", () => {
    const catalog = { pairs: [["/status", "Show status"], ["/research", "Research a topic"], ["/retry", "Retry"]], skills: { "/research": {} } };

    it("loads the / menu once the chat is open", async () => {
      const { thread } = await openThread({ "commands.catalog": () => catalog });
      await Promise.resolve();
      expect(thread.getView().commands.map((c) => c.name)).toEqual(["/status", "/research", "/retry"]);
    });

    it("sends a skill's message, showing what you typed", async () => {
      const { thread, calls } = await openThread({
        "commands.catalog": () => catalog,
        "command.dispatch": () => ({ type: "skill", message: "[skill text] topic: vector databases" }),
      });
      await Promise.resolve();
      thread.send("/research vector databases");
      await Promise.resolve();
      await Promise.resolve();
      expect(calls).toContainEqual(["command.dispatch", { session_id: "live", name: "research", arg: "vector databases" }]);
      expect(calls.at(-1)).toEqual(["prompt.submit", { session_id: "live", text: "[skill text] topic: vector databases" }]);
      expect(thread.getView().items.at(-1)?.content).toEqual({ kind: "user", text: "/research vector databases" });
    });

    it("runs a Hermes built-in through slash.exec and shows its output", async () => {
      const { thread, calls } = await openThread({
        "commands.catalog": () => catalog,
        "command.dispatch": () => {
          throw new GatewayError("rpc", "not a quick/plugin/skill command: status", 4018);
        },
        "slash.exec": () => ({ output: "Model: deepseek-chat\nTokens: 1,204" }),
      });
      await Promise.resolve();
      thread.send("/status");
      for (let i = 0; i < 5; i++) await Promise.resolve();
      expect(calls.at(-1)).toEqual(["slash.exec", { session_id: "live", command: "/status" }]);
      expect(thread.getView().items.slice(-2).map((i) => i.content)).toEqual([
        { kind: "user", text: "/status" },
        { kind: "output", text: "Model: deepseek-chat\nTokens: 1,204" },
      ]);
      expect(thread.getView().isRunning).toBe(false);
    });

    it("puts a command's text back in the message box once", async () => {
      const { thread } = await openThread({
        "commands.catalog": () => catalog,
        "command.dispatch": () => ({ type: "prefill", message: "Check the backups" }),
      });
      await Promise.resolve();
      thread.send("/retry");
      for (let i = 0; i < 3; i++) await Promise.resolve();
      expect(thread.takePrefill()).toBe("Check the backups");
      expect(thread.takePrefill()).toBeUndefined();
    });

    it("sends a message that only looks like a command as a message", async () => {
      const { thread, calls } = await openThread({ "commands.catalog": () => catalog });
      await Promise.resolve();
      thread.send("/unknown thing");
      expect(calls.at(-1)).toEqual(["prompt.submit", { session_id: "live", text: "/unknown thing" }]);
    });
  });

  describe("attachments", () => {
    const bytes = new TextEncoder().encode("hello");

    it("queues images, saves files in the workspace, and sends the file references", async () => {
      const { thread, calls } = await openThread({
        "image.attach_bytes": () => ({ attached: true, path: "/tmp/hermes/shot.png" }),
        "file.attach": () => ({ ref_text: "@file:`uploads/my notes.txt`" }),
      });
      const sent = await thread.sendWithAttachments("Look at these", [
        { name: "shot.png", bytes },
        { name: "my notes.txt", bytes },
      ]);
      expect(sent).toBe(true);
      expect(calls.find((c) => c[0] === "image.attach_bytes")?.[1]).toEqual({ session_id: "live", content_base64: "aGVsbG8=", filename: "shot.png" });
      expect(calls.find((c) => c[0] === "file.attach")?.[1]).toEqual({
        session_id: "live",
        name: "my notes.txt",
        data_url: "data:application/octet-stream;base64,aGVsbG8=",
      });
      expect(calls.at(-1)).toEqual(["prompt.submit", { session_id: "live", text: "Look at these\n\n@file:`uploads/my notes.txt`" }]);
      expect(thread.getView().items.at(-1)?.content).toEqual({
        kind: "user",
        text: "Look at these\n\n@image:/tmp/hermes/shot.png\n@file:`uploads/my notes.txt`",
      });
    });

    it("sends nothing when an upload fails, and takes back images already queued", async () => {
      const { thread, calls } = await openThread({
        "image.attach_bytes": () => ({ attached: true, path: "/tmp/a.png" }),
        "file.attach": () => {
          throw new GatewayError("rpc", "Disk full", 1);
        },
      });
      const sent = await thread.sendWithAttachments("Hi", [
        { name: "a.png", bytes },
        { name: "b.pdf", bytes },
      ]);
      expect(sent).toBe(false);
      expect(calls.map((c) => c[0])).not.toContain("prompt.submit");
      expect(calls).toContainEqual(["image.detach", { session_id: "live", path: "/tmp/a.png" }]);
      expect(thread.getView().items.at(-1)?.content).toEqual({ kind: "notice", text: "Couldn't attach b.pdf: Disk full" });
    });

    it("refuses a file over the limit before uploading it", async () => {
      const { thread, calls } = await openThread();
      const big = new Uint8Array(26 * 1024 * 1024);
      expect(await thread.sendWithAttachments("", [{ name: "huge.png", bytes: big }])).toBe(false);
      expect(calls.map((c) => c[0])).not.toContain("image.attach_bytes");
      expect(thread.getView().items.at(-1)?.content).toEqual({ kind: "notice", text: "Couldn't attach huge.png: It's over the 25 MB limit." });
    });
  });

  it("fills in the message another device sent once its turn is stored", async () => {
    const { thread } = await openThread({
      "session.history": () => ({
        messages: [
          { role: "assistant", text: "Hello" },
          { role: "user", text: "Sent from my phone" },
          { role: "assistant", text: "Got it." },
        ],
      }),
    });
    thread.apply({ type: "message.start", payload: {} });
    thread.apply({ type: "message.delta", payload: { text: "Got it." } });
    thread.apply({ type: "message.complete", payload: { status: "complete" } });
    await Promise.resolve();
    await Promise.resolve();
    expect(thread.getView().items.map((i) => i.content)).toEqual([
      { kind: "assistant", text: "Hello" },
      { kind: "user", text: "Sent from my phone" },
      { kind: "assistant", text: "Got it." },
    ]);
  });

  describe("alerts", () => {
    it("alerts when a reply finishes, with the reply's start", async () => {
      const { thread } = await openThread();
      const alerts: unknown[] = [];
      thread.alerts.onAlert((a) => alerts.push(a));
      thread.send("Hi");
      thread.apply({ type: "message.delta", payload: { text: "**All** backups are fine." } });
      expect(alerts).toEqual([]);
      thread.apply({ type: "message.complete", payload: { status: "complete" } });
      expect(alerts).toEqual([{ kind: "reply", text: "All backups are fine." }]);
    });

    it("announces each request once, however often the gateway sends it", async () => {
      const { thread } = await openThread();
      const alerts: unknown[] = [];
      thread.alerts.onAlert((a) => alerts.push(a));
      thread.receive(approval);
      thread.answerApproval(approval, "once");
      thread.receive(approval);
      expect(alerts).toEqual([{ kind: "needsYou", text: "Wants to run “rm -rf build”" }]);
    });
  });

  it("keeps the transcript but lets go of the session and its requests when the link drops", async () => {
    const { thread } = await openThread();
    thread.receive(approval);
    thread.detach();
    expect(thread.sessionId).toBeUndefined();
    expect(thread.getView()).toMatchObject({ canSend: false, requests: [] });
    expect(thread.getView().items).toHaveLength(1);
  });
});
