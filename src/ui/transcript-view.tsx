import { memo, useState, type ReactNode } from "react";
import { Shimmer } from "@/components/atoms/Shimmer";
import LoadingState from "@/components/primitives/LoadingState";
import ToolChips, { type ToolDetailLine, type ToolIcon, type ToolStep as ToolChip } from "@/components/primitives/ToolChips";
import { refName, splitAttachments } from "../hermes/attachments";
import { replyFiles } from "../hermes/reply-files";
import { ReplyFileCards } from "./reply-file-cards";
import type { ToolStep, TranscriptItem } from "../hermes/transcript";
import { Markdown } from "./markdown";

interface TranscriptViewProps {
  items: TranscriptItem[];
  draft: string;
  isRunning: boolean;
  /** Rooms: the name a member's replies show. */
  memberName?: (memberId: string) => string;
  /** The Hermes profile whose files a reply hands over: the chat's Bot, or a room member's. */
  profile?: string;
  memberProfile?: (memberId: string) => string | undefined;
}

/** Each message comes in as Beautiful UI's do: up and into view. */
const ENTER = { animation: "fade-up 400ms cubic-bezier(0.23,1,0.32,1) both" };

export function TranscriptView({ items, draft, isRunning, memberName, profile, memberProfile }: TranscriptViewProps) {
  return (
    <ol className="mx-auto flex w-full max-w-3xl flex-col gap-4" aria-label="Messages">
      {items.map((item) =>
        item.content.kind === "member" ? (
          <li key={item.id} style={ENTER}>
            <BotMessage
              name={memberName?.(item.content.memberId) ?? item.content.memberId}
              text={item.content.text}
              profile={memberProfile?.(item.content.memberId)}
            />
          </li>
        ) : (
          <Item key={item.id} item={item} profile={profile} />
        ),
      )}
      {draft && (
        <li aria-live="polite" style={ENTER}>
          <BotMessage text={draft} profile={profile} streaming />
        </li>
      )}
      {isRunning && !draft && (
        <li style={ENTER}>
          <LoadingState label="Working" />
        </li>
      )}
    </ol>
  );
}

/** Items are replaced, never changed, so one that didn't move doesn't render again. */
const Item = memo(function Item({ item, profile }: { item: TranscriptItem; profile?: string }) {
  const { content } = item;
  switch (content.kind) {
    case "user":
      return (
        <li style={ENTER}>
          <UserMessage text={content.text} />
        </li>
      );
    case "output":
      return (
        <li style={ENTER}>
          <pre className="overflow-x-auto rounded-card bg-inset p-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-ink-2 shadow-hairline">{content.text}</pre>
        </li>
      );
    case "assistant":
      return (
        <li style={ENTER}>
          <BotMessage text={content.text} profile={profile} />
        </li>
      );
    case "activity":
      return (
        <li style={ENTER}>
          <ActivityLine steps={content.steps} />
        </li>
      );
    case "notice":
      return (
        <li className="text-center text-[12px] text-ink-3" style={ENTER}>
          {content.text}
        </li>
      );
    case "member":
      // Rendered by the list, which knows the members' names.
      return null;
    case "result":
      return (
        <li style={ENTER}>
          <Folded summary={content.title}>
            {content.detail && <pre className="font-mono text-[11.5px] leading-[1.6] whitespace-pre-wrap text-ink-2">{content.detail}</pre>}
          </Folded>
        </li>
      );
  }
});

/**
 * Beautiful UI's streaming caret (`.stream-caret.is-streaming`), after the last thing the reply
 * has written so far. Markdown is rendered HTML, so the caret is that element's `::after`.
 */
const STREAM_CARET =
  "[&>:last-child]:after:ml-[1.5px] [&>:last-child]:after:inline-block [&>:last-child]:after:h-[1.05em] [&>:last-child]:after:w-[2px] [&>:last-child]:after:translate-y-[-0.5px] [&>:last-child]:after:rounded-[1px] [&>:last-child]:after:bg-ink [&>:last-child]:after:align-text-bottom [&>:last-child]:after:content-['']";

function BotMessage({ text, name, profile, streaming }: { text: string; name?: string; profile?: string; streaming?: boolean }) {
  const reply = replyFiles(text);
  return (
    <div className="flex flex-col gap-1">
      {name && <span className="text-[12px] font-medium text-ink-3">{name}</span>}
      {/* A reply takes most of the column, not prose's 65 characters. */}
      <div className="max-w-[80%] break-words">
        {reply.text && <Markdown text={reply.text} className={streaming ? STREAM_CARET : undefined} />}
        <ReplyFileCards profile={profile} files={reply.files} />
      </div>
    </div>
  );
}

/** Your message, with what you sent along shown by name rather than as `@file:` lines. */
function UserMessage({ text }: { text: string }) {
  const { text: body, attachments } = splitAttachments(text);
  return (
    <div className="flex flex-col items-end gap-1.5 pl-14">
      {body && (
        <p className="max-w-[80%] rounded-xl bg-field px-3 py-1.5 text-(length:--chat-text) leading-[1.45] break-words whitespace-pre-wrap text-ink">{body}</p>
      )}
      {attachments.length > 0 && (
        <ul className="flex flex-wrap justify-end gap-1.5" aria-label="Attachments">
          {attachments.map((ref) => (
            <li key={ref.path} className="flex h-6.5 items-center gap-1.5 rounded-chip bg-field px-1.5 text-[11.5px] text-ink-2 shadow-hairline" title={ref.path}>
              <span role="img" aria-label={ref.kind === "image" ? "Image" : "File"} className="flex text-ink-3">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  {ref.kind === "image" ? (
                    <g>
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <circle cx="9" cy="9" r="2" />
                      <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
                    </g>
                  ) : (
                    <g>
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <path d="M14 2v6h6" />
                    </g>
                  )}
                </svg>
              </span>
              {refName(ref)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A one-line summary that opens to show more, in ToolChips' grammar: chevron, then a growing row. */
function Folded({ summary, children }: { summary: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="w-full max-w-xl">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="-mx-1.5 flex w-fit max-w-full items-center gap-1.5 rounded-control px-1.5 py-1 text-[12.5px] text-ink-2 transition-colors duration-100 hover:bg-hover-2"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 transition-transform duration-200" style={{ transform: open ? "rotate(0deg)" : "rotate(-90deg)" }} aria-hidden>
          <path d="M6 9l6 6 6-6" />
        </svg>
        <span className="min-w-0 truncate">{summary}</span>
      </button>
      <div
        className="grid transition-[grid-template-rows,opacity] duration-300"
        style={{ gridTemplateRows: open ? "1fr" : "0fr", opacity: open ? 1 : 0, transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)" }}
        inert={!open}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="mt-1 mb-1 ml-2 border-l border-line py-0.5 pl-3.5">{children}</div>
        </div>
      </div>
    </div>
  );
}

/** Consecutive tool calls as one line you can open (Beautiful UI's ToolChips). */
function ActivityLine({ steps }: { steps: ToolStep[] }) {
  const running = steps.find((s) => s.state === "running");
  const failed = steps.filter((s) => s.state === "failed").length;
  const header = running ? (
    <Shimmer>{`Running ${toolLabel(running)}${running.progress ? ` · ${running.progress}` : ""}…`}</Shimmer>
  ) : (
    `Used ${steps.length === 1 ? toolLabel(steps[0]) : `${steps.length} tools`}${failed ? ` · ${failed} failed` : ""}`
  );
  return <ToolChips header={header} working={!!running} steps={steps.map(toChip)} />;
}

function toChip(step: ToolStep): ToolChip {
  const detail: ToolDetailLine[] = [];
  if (step.progress) detail.push({ text: step.progress });
  if (step.summary) detail.push({ text: step.summary, tone: step.state === "failed" ? "fail" : undefined });
  else if (step.state === "failed") detail.push({ text: "It failed.", tone: "fail" });
  if (step.durationSeconds !== undefined) detail.push({ text: `Took ${formatSeconds(step.durationSeconds)}` });
  return {
    id: step.id,
    icon: toolIcon(step.name),
    label: step.name,
    chip: step.context,
    mono: true,
    detailMono: false,
    detail,
    failed: step.state === "failed",
    running: step.state === "running",
  };
}

/** The glyph for a tool, from what its name says it does. */
function toolIcon(name: string): ToolIcon {
  const n = name.toLowerCase();
  if (/think|reason/.test(n)) return "think";
  if (/write|edit|patch|create|replace|save/.test(n)) return "write";
  if (/terminal|shell|run|exec|command|bash|process/.test(n)) return "run";
  if (/read|search|list|view|browser|fetch|find|grep|open|get/.test(n)) return "read";
  return "tool";
}

function toolLabel(step: ToolStep): string {
  return step.context ? `${step.name} ${step.context}` : step.name;
}

function formatSeconds(seconds: number): string {
  return seconds < 10 ? `${seconds.toFixed(1)} s` : `${Math.round(seconds)} s`;
}
