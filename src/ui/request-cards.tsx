import { useState, type FormEvent } from "react";
import type { ChatThread } from "../hermes/chat-thread";
import type { ApprovalChoice, ApprovalPrompt, ChatRequest, ClarifyPrompt, SecretPrompt } from "../hermes/requests";

const CHOICE_LABELS: Record<ApprovalChoice, string> = {
  once: "Allow once",
  session: "Allow in this chat",
  always: "Always allow",
  deny: "Deny",
};

export function RequestCards({ thread, requests }: { thread: ChatThread; requests: ChatRequest[] }) {
  if (requests.length === 0) return null;
  return (
    <div className="requests">
      {requests.map((request) => {
        switch (request.kind) {
          case "approval":
            return <ApprovalCard key={request.id} thread={thread} prompt={request} />;
          case "clarify":
            return <ClarifyCard key={request.id} thread={thread} prompt={request} />;
          case "secret":
          case "sudo":
            return <SecretCard key={request.id} thread={thread} prompt={request} />;
        }
      })}
    </div>
  );
}

function ApprovalCard({ thread, prompt }: { thread: ChatThread; prompt: ApprovalPrompt }) {
  return (
    <section className="card" aria-label="Approval">
      <h3>Allow this command?</h3>
      <pre className="command">{prompt.command}</pre>
      {prompt.description && <p className="card-note">{prompt.description}</p>}
      <div className="card-actions">
        {prompt.choices.map((choice) => (
          <button
            key={choice}
            type="button"
            className={choice === "once" ? "primary" : undefined}
            onClick={() => thread.answerApproval(prompt, choice)}
          >
            {CHOICE_LABELS[choice]}
          </button>
        ))}
      </div>
    </section>
  );
}

function ClarifyCard({ thread, prompt }: { thread: ChatThread; prompt: ClarifyPrompt }) {
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [typed, setTyped] = useState<Record<string, string>>({});

  function toggle(questionId: string, choice: string, multiple: boolean) {
    setPicked((current) => {
      const now = current[questionId] ?? [];
      if (!multiple) return { ...current, [questionId]: [choice] };
      return { ...current, [questionId]: now.includes(choice) ? now.filter((c) => c !== choice) : [...now, choice] };
    });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const answers: Record<string, string[]> = {};
    for (const q of prompt.questions) {
      const own = typed[q.id]?.trim();
      answers[q.id] = own ? [own] : (picked[q.id] ?? []);
    }
    thread.answerClarify(prompt, answers);
  }

  return (
    <form className="card" aria-label="Questions" onSubmit={submit}>
      {prompt.questions.map((q) => (
        <fieldset key={q.id}>
          <legend>{q.text}</legend>
          {q.choices.length > 0 && (
            <div className="card-actions">
              {q.choices.map((choice) => (
                <button
                  key={choice}
                  type="button"
                  aria-pressed={(picked[q.id] ?? []).includes(choice)}
                  className="choice"
                  onClick={() => toggle(q.id, choice, q.allowsMultiple)}
                >
                  {choice}
                </button>
              ))}
            </div>
          )}
          <input
            aria-label={q.choices.length ? "Or type your own answer" : "Your answer"}
            placeholder={q.choices.length ? "Or type your own" : "Your answer"}
            value={typed[q.id] ?? ""}
            onChange={(e) => setTyped({ ...typed, [q.id]: e.target.value })}
          />
        </fieldset>
      ))}
      <div className="card-actions">
        <button type="submit" className="primary">
          Send answers
        </button>
        <button type="button" onClick={() => thread.skipClarify(prompt)}>
          Skip
        </button>
      </div>
    </form>
  );
}

function SecretCard({ thread, prompt }: { thread: ChatThread; prompt: SecretPrompt }) {
  const [value, setValue] = useState("");
  const sudo = prompt.kind === "sudo";

  function submit(event: FormEvent) {
    event.preventDefault();
    thread.answerSecret(prompt, value);
  }

  return (
    <form className="card" aria-label={sudo ? "Sudo password" : "Secret"} onSubmit={submit}>
      <h3>{sudo ? "The Bot needs the sudo password" : `The Bot needs ${prompt.name}`}</h3>
      {sudo ? <pre className="command">{prompt.name}</pre> : prompt.message && <p className="card-note">{prompt.message}</p>}
      <p className="card-note">It goes straight to your gateway. Unibot keeps no copy.</p>
      <input
        type="password"
        aria-label={sudo ? "Sudo password" : prompt.name}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoComplete="off"
      />
      <div className="card-actions">
        <button type="submit" className="primary" disabled={!value}>
          Send
        </button>
        <button type="button" onClick={() => thread.skipSecret(prompt)}>
          Skip
        </button>
      </div>
    </form>
  );
}
