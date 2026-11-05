import type { ServerRequest } from "./json-rpc-channel";

export type ApprovalChoice = "once" | "session" | "always" | "deny";
const CHOICES: ApprovalChoice[] = ["once", "session", "always", "deny"];

/** The gateway asking whether the agent may run a dangerous command. */
export interface ApprovalPrompt {
  kind: "approval";
  /** The server request ID the answer goes back to. */
  id: string;
  sessionId: string;
  /** Redacted by the gateway before it is sent. */
  command: string;
  description: string;
  /** What the gateway offers, in its order. `deny` is always possible. */
  choices: ApprovalChoice[];
}

export interface ClarifyQuestion {
  id: string;
  text: string;
  /** Suggested answers. You can always type your own instead. */
  choices: string[];
  /** Several of `choices` may be picked. */
  allowsMultiple: boolean;
}

/** The agent's clarify tool asking you one to five questions and waiting for the answers. */
export interface ClarifyPrompt {
  kind: "clarify";
  id: string;
  sessionId: string;
  questions: ClarifyQuestion[];
}

/**
 * The gateway asking for something typed into a masked field: a secret a skill needs (saved as the
 * environment variable `name`), or the sudo password for a command. The app keeps no copy.
 */
export interface SecretPrompt {
  kind: "secret" | "sudo";
  id: string;
  sessionId: string;
  /** The environment variable for a secret; the redacted command for sudo. */
  name: string;
  /** The gateway's own wording, for a secret. */
  message: string;
}

export type ChatRequest = ApprovalPrompt | ClarifyPrompt | SecretPrompt;

/** The prompt `request` asks for, or `undefined` when a chat can't show it. */
export function chatRequestFrom(request: ServerRequest): ChatRequest | undefined {
  const params = request.params ?? {};
  const sessionId = typeof params.session_id === "string" ? params.session_id : undefined;
  if (!sessionId) return undefined;
  const str = (value: unknown) => (typeof value === "string" ? value : "");

  switch (request.method) {
    case "approval": {
      const offered = Array.isArray(params.choices) ? params.choices : [];
      const choices = offered.filter((c): c is ApprovalChoice => CHOICES.includes(c as ApprovalChoice));
      if (choices.length === 0) choices.push("once");
      if (!choices.includes("deny")) choices.push("deny");
      return { kind: "approval", id: request.id, sessionId, command: str(params.command), description: str(params.description), choices };
    }
    case "clarify": {
      const raw = Array.isArray(params.questions) ? (params.questions as Record<string, unknown>[]) : [];
      const questions = raw.flatMap((q): ClarifyQuestion[] => {
        if (typeof q?.qid !== "string" || typeof q.question !== "string") return [];
        const choices = Array.isArray(q.choices) ? q.choices.filter((c): c is string => typeof c === "string") : [];
        return [{ id: q.qid, text: q.question, choices, allowsMultiple: q.multi_select === true && choices.length > 0 }];
      });
      return questions.length ? { kind: "clarify", id: request.id, sessionId, questions } : undefined;
    }
    case "secret":
      if (typeof params.env_var !== "string") return undefined;
      return { kind: "secret", id: request.id, sessionId, name: params.env_var, message: str(params.prompt) };
    case "sudo":
      return { kind: "sudo", id: request.id, sessionId, name: str(params.command), message: "" };
    default:
      return undefined;
  }
}

/** The wire form of one clarify answer: the text itself, or a JSON list for multi-select questions. */
export function encodeClarifyAnswer(picked: string[], question: ClarifyQuestion): string {
  return question.allowsMultiple ? JSON.stringify(picked) : (picked[0] ?? "");
}

/** What the chat says after you answer, naming the command but never a secret. */
export function approvalNotice(choice: ApprovalChoice, command: string): string {
  switch (choice) {
    case "once":
      return `You allowed “${command}” once`;
    case "session":
      return `You allowed “${command}” and commands like it in this chat`;
    case "always":
      return `You allowed “${command}” and commands like it from now on`;
    case "deny":
      return `You denied “${command}”`;
  }
}

/** The command in one line, for notices and the sidebar. */
export function shortCommand(command: string): string {
  const line = command.split("\n")[0].trim();
  return line.length > 60 ? `${line.slice(0, 59)}…` : line;
}
