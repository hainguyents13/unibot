import { useState, type ComponentProps, type FormEvent, type ReactNode } from "react";
import ApprovalCard from "@/components/primitives/ApprovalCard";
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

/** Least to most: the footer reads left to right, ending on the button you'd usually press. */
const CHOICE_ORDER: ApprovalChoice[] = ["deny", "always", "session", "once"];

/**
 * A card in the chat for something a Bot waits on you for, in Beautiful UI's ApprovalCard shell: a
 * raised card that comes up into view, the ask as its heading, and pill actions in its footer.
 */
export function RequestCard({
  title,
  actions,
  className,
  children,
  ...props
}: { title: ReactNode; actions?: ReactNode; children?: ReactNode } & ComponentProps<"section">) {
  return (
    <section
      className={cn("w-full max-w-xl overflow-hidden rounded-card bg-surface shadow-card", className)}
      style={{ animation: "fade-up 380ms cubic-bezier(0.23,1,0.32,1) both" }}
      {...props}
    >
      <div className="primitive-card-pad flex flex-col gap-2.5">
        <h3 className="flex items-center gap-2 text-[14px] font-medium text-ink">
          {/* It waits on you: the attention colour the sidebar's "Needs you" uses. */}
          <span className="size-1.5 shrink-0 rounded-full bg-orange" aria-hidden />
          {title}
        </h3>
        {children}
      </div>
      {actions && <div className="primitive-card-footer flex flex-wrap items-center justify-end gap-1.5">{actions}</div>}
    </section>
  );
}

/** A command, path or name the Bot means, as it'll run. */
export function CommandText({ children }: { children: string }) {
  return <pre className="overflow-x-auto rounded-control bg-inset px-2.5 py-2 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-ink shadow-hairline">{children}</pre>;
}

export function RequestCards({ thread, requests }: { thread: ChatThread; requests: ChatRequest[] }) {
  if (requests.length === 0) return null;
  return (
    <>
      {requests.map((request) => {
        switch (request.kind) {
          case "approval":
            return <ApprovalRequest key={request.id} thread={thread} prompt={request} />;
          case "clarify":
            return <ClarifyRequest key={request.id} thread={thread} prompt={request} />;
          case "secret":
          case "sudo":
            return <SecretRequest key={request.id} thread={thread} prompt={request} />;
        }
      })}
    </>
  );
}

function ApprovalRequest({ thread, prompt }: { thread: ChatThread; prompt: ApprovalPrompt }) {
  const choices = CHOICE_ORDER.filter((choice) => prompt.choices.includes(choice));
  return (
    <RequestCard
      title="Allow this command?"
      aria-label="Approval"
      actions={choices.map((choice) => (
        <Button
          key={choice}
          type="button"
          size="sm"
          variant={choice === "once" ? "accent" : choice === "deny" ? "ghost" : "outline"}
          onClick={() => thread.answerApproval(prompt, choice)}
        >
          {CHOICE_LABELS[choice]}
        </Button>
      ))}
    >
      <CommandText>{prompt.command}</CommandText>
      {prompt.description && <Note>{prompt.description}</Note>}
    </RequestCard>
  );
}

/** The Bot's questions, one at a time, in Beautiful UI's ApprovalCard. */
function ClarifyRequest({ thread, prompt }: { thread: ChatThread; prompt: ClarifyPrompt }) {
  return (
    <ApprovalCard
      aria-label="Questions"
      questions={prompt.questions.map((q) => ({ q: q.text, type: q.allowsMultiple ? "check" : "radio", options: q.choices }))}
      labels={{ dismiss: "Skip the questions" }}
      onDismiss={() => thread.skipClarify(prompt)}
      onSubmitted={(picked, typed) => {
        const answers: Record<string, string[]> = {};
        prompt.questions.forEach((q, i) => {
          const own = typed[i]?.trim();
          answers[q.id] = own ? [own] : (picked[i] ?? []).map((index) => q.choices[index]);
        });
        thread.answerClarify(prompt, answers);
      }}
    />
  );
}

function SecretRequest({ thread, prompt }: { thread: ChatThread; prompt: SecretPrompt }) {
  const [value, setValue] = useState("");
  const sudo = prompt.kind === "sudo";

  function submit(event: FormEvent) {
    event.preventDefault();
    thread.answerSecret(prompt, value);
  }

  return (
    <form onSubmit={submit}>
      <RequestCard
        title={sudo ? "The Bot needs the sudo password" : `The Bot needs ${prompt.name}`}
        aria-label={sudo ? "Sudo password" : "Secret"}
        actions={
          <>
            <Button type="button" size="sm" variant="ghost" onClick={() => thread.skipSecret(prompt)}>
              Skip
            </Button>
            <Button type="submit" size="sm" variant="accent" disabled={!value}>
              Send
            </Button>
          </>
        }
      >
        {sudo ? <CommandText>{prompt.name}</CommandText> : prompt.message && <Note>{prompt.message}</Note>}
        <Input type="password" aria-label={sudo ? "Sudo password" : prompt.name} value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" />
        <Note className="text-[12px] text-ink-3">It goes straight to your gateway. Unibot keeps no copy.</Note>
      </RequestCard>
    </form>
  );
}
