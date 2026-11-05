import MarkdownIt from "markdown-it";
import { useMemo, type MouseEvent } from "react";
import { cn } from "@/lib/utils";
import { openExternal } from "./open-external";

/**
 * Raw HTML is off: a Bot's reply is shown as text, never run as markup. Links are made from bare
 * URLs too.
 */
const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true });

export function Markdown({ text, className }: { text: string; className?: string }) {
  const html = useMemo(() => markdown.render(text), [text]);
  return (
    <div
      className={cn(
        "prose prose-sm max-w-none text-foreground dark:prose-invert",
        "prose-p:my-1.5 prose-headings:mt-4 prose-headings:mb-2 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 prose-table:my-2",
        "prose-a:text-working prose-a:no-underline hover:prose-a:underline",
        "prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:font-normal prose-code:before:content-none prose-code:after:content-none",
        "prose-pre:my-2 prose-pre:rounded-lg prose-pre:border prose-pre:bg-muted prose-pre:text-foreground prose-pre:[&_code]:bg-transparent prose-pre:[&_code]:p-0",
        "prose-th:px-2 prose-td:px-2 [&>:first-child]:mt-0 [&>:last-child]:mb-0",
        className,
      )}
      onClick={openLinksOutside}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** Links open in the browser, not inside the app's window. */
function openLinksOutside(event: MouseEvent<HTMLDivElement>) {
  const link = (event.target as HTMLElement).closest("a");
  if (!link?.href) return;
  event.preventDefault();
  void openExternal(link.href);
}
