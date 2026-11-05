import { useState, type ComponentProps, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ChatThread } from "../hermes/chat-thread";
import type { ApprovalChoice, ApprovalPrompt, ChatRequest, ClarifyPrompt, SecretPrompt } from "../hermes/requests";
import { Note } from "./settings-parts";

const CHOICE_LABELS: Record<ApprovalChoice, string> = {
  once: "Allow once",
  session: "Allow in this chat",
  always: "Always allow",
  deny: "Deny",
};

/** A card in the chat for something a Bot waits on you for. */
export function RequestCard({ title, className, children, ...props }: { title: ReactNode; children: ReactNode } & ComponentProps<"section">) {
  return (
    <section className={cn("flex flex-col gap-3 rounded-xl border border-attention/50 bg-card p-4 shadow-xs", className)} {...props}>
      <h3 className="font-semibold">{title}</h3>
      {children}
    </section>
  );
}

/** A command, path or name the Bot means, as it'll run. */
export function CommandText({ children }: { children: string }) {
  return <pre className="overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-[13px] whitespace-pre-wrap">{children}</pre>;
}

export function RequestCards({ thread, requests }: { thread: ChatThread; requests: ChatRequest[] }) {
  if (requests.length === 0) return null;
  return (
    <>
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
    </>
  );
}

function ApprovalCard({ thread, prompt }: { thread: ChatThread; prompt: ApprovalPrompt }) {
  return (
    <RequestCard title="Allow this command?" aria-label="Approval">
      <CommandText>{prompt.command}</CommandText>
      {prompt.description && <Note>{prompt.description}</Note>}
      <div className="flex flex-wrap gap-2">
        {prompt.choices.map((choice) => (
          <Button
            key={choice}
            type="button"
            size="sm"
            variant={choice === "once" ? "default" : choice === "deny" ? "ghost" : "outline"}
            onClick={() => thread.answerApproval(prompt, choice)}
          >
            {CHOICE_LABELS[choice]}
          </Button>
        ))}
      </div>
    </RequestCard>
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
    <form onSubmit={submit}>
      <RequestCard title={prompt.questions.length === 1 ? "A question for you" : "Questions for you"} aria-label="Questions">
        {prompt.questions.map((q) => (
          <fieldset key={q.id} className="flex flex-col gap-2">
            <legend className="mb-2 text-sm">{q.text}</legend>
            {q.choices.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {q.choices.map((choice) => (
                  <Button
                    key={choice}
                    type="button"
                    size="sm"
                    variant="outline"
                    aria-pressed={(picked[q.id] ?? []).includes(choice)}
                    className="aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground"
                    onClick={() => toggle(q.id, choice, q.allowsMultiple)}
                  >
                    {choice}
                  </Button>
                ))}
              </div>
            )}
            <Input
              aria-label={q.choices.length ? "Or type your own answer" : "Your answer"}
              placeholder={q.choices.length ? "Or type your own" : "Your answer"}
              value={typed[q.id] ?? ""}
              onChange={(e) => setTyped({ ...typed, [q.id]: e.target.value })}
            />
          </fieldset>
        ))}
        <div className="flex gap-2">
          <Button type="submit" size="sm">
            Send answers
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => thread.skipClarify(prompt)}>
            Skip
          </Button>
        </div>
      </RequestCard>
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
    <form onSubmit={submit}>
      <RequestCard title={sudo ? "The Bot needs the sudo password" : `The Bot needs ${prompt.name}`} aria-label={sudo ? "Sudo password" : "Secret"}>
        {sudo ? <CommandText>{prompt.name}</CommandText> : prompt.message && <Note>{prompt.message}</Note>}
        <Note className="text-xs">It goes straight to your gateway. Unibot keeps no copy.</Note>
        <Input type="password" aria-label={sudo ? "Sudo password" : prompt.name} value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" />
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={!value}>
            Send
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => thread.skipSecret(prompt)}>
            Skip
          </Button>
        </div>
      </RequestCard>
    </form>
  );
}
