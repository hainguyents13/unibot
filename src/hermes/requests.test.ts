import { describe, expect, it } from "vitest";
import { chatRequestFrom, encodeClarifyAnswer, shortCommand } from "./requests";

describe("chatRequestFrom", () => {
  it("reads an approval and always offers deny", () => {
    expect(
      chatRequestFrom({
        id: "srq-1",
        method: "approval",
        params: { session_id: "s", command: "rm -rf build", description: "Deletes files", choices: ["once", "session", "bogus"] },
      }),
    ).toEqual({
      kind: "approval",
      id: "srq-1",
      sessionId: "s",
      command: "rm -rf build",
      description: "Deletes files",
      choices: ["once", "session", "deny"],
    });
  });

  it("offers once and deny when the gateway lists no choices", () => {
    expect(chatRequestFrom({ id: "a", method: "approval", params: { session_id: "s" } })).toMatchObject({ choices: ["once", "deny"] });
  });

  it("reads clarify questions, keeping the readable ones", () => {
    const prompt = chatRequestFrom({
      id: "q",
      method: "clarify",
      params: {
        session_id: "s",
        questions: [
          { qid: "1", question: "Which branch?", choices: ["main", "dev"], multi_select: false },
          { qid: "2", question: "Which files?", choices: ["a", "b"], multi_select: true },
          { question: "No id" },
        ],
      },
    });
    expect(prompt).toMatchObject({ kind: "clarify", questions: [{ id: "1", allowsMultiple: false }, { id: "2", allowsMultiple: true }] });
  });

  it("reads secret and sudo prompts", () => {
    expect(chatRequestFrom({ id: "x", method: "secret", params: { session_id: "s", env_var: "GITHUB_TOKEN", prompt: "Paste a token" } })).toEqual({
      kind: "secret",
      id: "x",
      sessionId: "s",
      name: "GITHUB_TOKEN",
      message: "Paste a token",
    });
    expect(chatRequestFrom({ id: "y", method: "sudo", params: { session_id: "s", command: "apt install x" } })).toMatchObject({ kind: "sudo", name: "apt install x" });
  });

  it("ignores requests without a session or of a kind a chat can't show", () => {
    expect(chatRequestFrom({ id: "a", method: "approval", params: {} })).toBeUndefined();
    expect(chatRequestFrom({ id: "a", method: "vault.unlock_prompt", params: { session_id: "s" } })).toBeUndefined();
  });
});

describe("helpers", () => {
  it("encodes multi-select answers as a JSON list", () => {
    const single = { id: "1", text: "", choices: ["a"], allowsMultiple: false };
    const multi = { ...single, allowsMultiple: true };
    expect(encodeClarifyAnswer(["a"], single)).toBe("a");
    expect(encodeClarifyAnswer(["a", "b"], multi)).toBe('["a","b"]');
  });

  it("shortens a long command to one line", () => {
    expect(shortCommand("ls\n-la")).toBe("ls");
    expect(shortCommand("x".repeat(80))).toHaveLength(60);
  });
});
