import { memo } from "react";
import { ChevronRight, File, Image, Loader2, Wrench } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DotsLoader } from "@/components/ui/loader";
import { Message, MessageContent } from "@/components/ui/message";
import { cn } from "@/lib/utils";
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

export function TranscriptView({ items, draft, isRunning, memberName, profile, memberProfile }: TranscriptViewProps) {
  return (
    <ol className="mx-auto flex w-full max-w-3xl flex-col gap-4" aria-label="Messages">
      {items.map((item) =>
        item.content.kind === "member" ? (
          <li key={item.id}>
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
        <li aria-live="polite">
          <BotMessage text={draft} profile={profile} />
        </li>
      )}
      {isRunning && !draft && (
        <li className="flex items-center gap-2.5 text-[13px] text-muted-foreground" role="status">
          <DotsLoader size="sm" />
          Working…
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
        <li>
          <UserMessage text={content.text} />
        </li>
      );
    case "output":
      return (
        <li>
          <pre className="overflow-x-auto rounded-lg border bg-muted p-3 font-mono text-xs whitespace-pre-wrap">{content.text}</pre>
        </li>
      );
    case "assistant":
      return (
        <li>
          <BotMessage text={content.text} profile={profile} />
        </li>
      );
    case "activity":
      return (
        <li>
          <ActivityLine steps={content.steps} />
        </li>
      );
    case "notice":
      return <li className="text-center text-xs text-muted-foreground">{content.text}</li>;
    case "member":
      // Rendered by the list, which knows the members' names.
      return null;
    case "result":
      return (
        <li>
          <Folded summary={content.title}>{content.detail && <pre className="mt-1 font-mono text-xs whitespace-pre-wrap">{content.detail}</pre>}</Folded>
        </li>
      );
  }
});

function BotMessage({ text, name, profile }: { text: string; name?: string; profile?: string }) {
  const reply = replyFiles(text);
  return (
    <Message className="flex-col gap-1">
      {name && <span className="text-xs font-semibold text-muted-foreground">{name}</span>}
      {/* MessageContent is `prose`, which stops at 65 characters; a reply takes most of the column instead. */}
      <MessageContent className="max-w-[80%] bg-transparent p-0">
        {reply.text && <Markdown text={reply.text} />}
        <ReplyFileCards profile={profile} files={reply.files} />
      </MessageContent>
    </Message>
  );
}

/** Your message, with what you sent along shown by name rather than as `@file:` lines. */
function UserMessage({ text }: { text: string }) {
  const { text: body, attachments } = splitAttachments(text);
  return (
    <Message className="flex-col items-end gap-1.5">
      {body && (
        <MessageContent className="max-w-[80%] rounded-2xl rounded-br-md bg-secondary px-3.5 py-2 text-(length:--chat-text) leading-relaxed whitespace-pre-wrap">{body}</MessageContent>
      )}
      {attachments.length > 0 && (
        <ul className="flex flex-wrap justify-end gap-1.5" aria-label="Attachments">
          {attachments.map((ref) => (
            <li key={ref.path} className="flex items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-xs" title={ref.path}>
              {ref.kind === "image" ? <Image className="size-3.5 text-muted-foreground" aria-label="Image" /> : <File className="size-3.5 text-muted-foreground" aria-label="File" />}
              {refName(ref)}
            </li>
          ))}
        </ul>
      )}
    </Message>
  );
}

/** A one-line summary that opens to show more. */
function Folded({ summary, running, children }: { summary: string; running?: boolean; children: React.ReactNode }) {
  return (
    <Collapsible>
      <CollapsibleTrigger className="group flex items-center gap-1.5 border-0 bg-transparent p-0 text-[13px] text-muted-foreground hover:text-foreground">
        {running ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Wrench className="size-3.5" aria-hidden />}
        <span className={cn(running && "animate-pulse")}>{summary}</span>
        <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1.5 ml-5 border-l pl-3">{children}</CollapsibleContent>
    </Collapsible>
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
    <Folded summary={summary} running={!!running}>
      <ul className="flex flex-col gap-1 text-[13px]">
        {steps.map((step) => (
          <li key={step.id} className={cn("flex flex-wrap items-baseline gap-x-2", step.state === "failed" && "text-destructive")}>
            <span className="font-medium">{step.name}</span>
            {step.context && <code className="rounded bg-muted px-1 text-xs">{step.context}</code>}
            {step.summary && <span className="text-muted-foreground">{step.summary}</span>}
            {step.durationSeconds !== undefined && <span className="text-xs text-muted-foreground">{formatSeconds(step.durationSeconds)}</span>}
          </li>
        ))}
      </ul>
    </Folded>
  );
}

function toolLabel(step: ToolStep): string {
  return step.context ? `${step.name} ${step.context}` : step.name;
}

function formatSeconds(seconds: number): string {
  return seconds < 10 ? `${seconds.toFixed(1)} s` : `${Math.round(seconds)} s`;
}
