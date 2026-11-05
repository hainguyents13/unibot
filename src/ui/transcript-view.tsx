import { memo } from "react";
import { refName, splitAttachments } from "../hermes/attachments";
import type { ToolStep, TranscriptItem } from "../hermes/transcript";
import { Markdown } from "./markdown";

interface TranscriptViewProps {
  items: TranscriptItem[];
  draft: string;
  isRunning: boolean;
  /** Rooms: the name a member's replies show. */
  memberName?: (memberId: string) => string;
}

export function TranscriptView({ items, draft, isRunning, memberName }: TranscriptViewProps) {
  return (
    <ol className="transcript" aria-label="Messages">
      {items.map((item) =>
        item.content.kind === "member" ? (
          <li key={item.id} className="message assistant member">
            <span className="member-name">{memberName?.(item.content.memberId) ?? item.content.memberId}</span>
            <Markdown text={item.content.text} />
          </li>
        ) : (
          <Item key={item.id} item={item} />
        ),
      )}
      {draft && (
        <li className="message assistant" aria-live="polite">
          <Markdown text={draft} />
        </li>
      )}
      {isRunning && !draft && (
        <li className="working" role="status">
          <span className="dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          Working…
        </li>
      )}
    </ol>
  );
}

/** Items are replaced, never changed, so one that didn't move doesn't render again. */
const Item = memo(function Item({ item }: { item: TranscriptItem }) {
  const { content } = item;
  switch (content.kind) {
    case "user":
      return <UserMessage text={content.text} />;
    case "output":
      return (
        <li className="message assistant">
          <pre className="output">{content.text}</pre>
        </li>
      );
    case "assistant":
      return (
        <li className="message assistant">
          <Markdown text={content.text} />
        </li>
      );
    case "activity":
      return (
        <li className="activity">
          <ActivityLine steps={content.steps} />
        </li>
      );
    case "notice":
      return <li className="notice">{content.text}</li>;
    case "member":
      // Rendered by the list, which knows the members' names.
      return null;
    case "result":
      return (
        <li className="activity">
          <details>
            <summary>{content.title}</summary>
            {content.detail && <pre>{content.detail}</pre>}
          </details>
        </li>
      );
  }
});

/** Your message, with what you sent along shown by name rather than as `@file:` lines. */
function UserMessage({ text }: { text: string }) {
  const { text: body, attachments } = splitAttachments(text);
  return (
    <li className="message user">
      {body}
      {attachments.length > 0 && (
        <ul className="sent-attachments" aria-label="Attachments">
          {attachments.map((ref) => (
            <li key={ref.path} className="chip" title={ref.path}>
              <span className="chip-kind">{ref.kind === "image" ? "Image" : "File"}</span>
              {refName(ref)}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** Consecutive tool calls as one line you can open. */
function ActivityLine({ steps }: { steps: ToolStep[] }) {
  const running = steps.find((s) => s.state === "running");
  const failed = steps.filter((s) => s.state === "failed").length;
  const summary = running
    ? `${toolLabel(running)}${running.progress ? ` · ${running.progress}` : ""}…`
    : `Used ${steps.length === 1 ? toolLabel(steps[0]) : `${steps.length} tools`}${failed ? ` · ${failed} failed` : ""}`;
  return (
    <details>
      <summary className={running ? "running" : undefined}>{summary}</summary>
      <ul className="steps">
        {steps.map((step) => (
          <li key={step.id} className={`step step-${step.state}`}>
            <span className="step-name">{step.name}</span>
            {step.context && <code>{step.context}</code>}
            {step.summary && <span className="step-summary">{step.summary}</span>}
            {step.durationSeconds !== undefined && <span className="step-time">{formatSeconds(step.durationSeconds)}</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}

function toolLabel(step: ToolStep): string {
  return step.context ? `${step.name} ${step.context}` : step.name;
}

function formatSeconds(seconds: number): string {
  return seconds < 10 ? `${seconds.toFixed(1)} s` : `${Math.round(seconds)} s`;
}
