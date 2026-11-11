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
        // Sized by `--chat-text`; prose spaces everything in `em`, so it all follows.
        // Beautiful UI's ink ramp for prose, with its chips for inline code and inset cards for blocks.
        "prose max-w-none text-(length:--chat-text) leading-relaxed text-ink dark:prose-invert",
        "prose-headings:text-ink prose-strong:text-ink prose-p:text-ink prose-li:text-ink prose-li:marker:text-ink-3 prose-blockquote:border-line-strong prose-blockquote:text-ink-2 prose-hr:border-line",
        "prose-p:my-1.5 prose-headings:mt-4 prose-headings:mb-2 prose-headings:font-semibold prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 prose-table:my-2",
        "prose-a:text-accent-ink prose-a:no-underline prose-a:underline-offset-2 hover:prose-a:underline",
        "prose-code:rounded-chip prose-code:bg-field prose-code:px-1 prose-code:py-0.5 prose-code:font-mono prose-code:text-[0.86em] prose-code:font-normal prose-code:text-ink prose-code:shadow-hairline prose-code:before:content-none prose-code:after:content-none",
        "prose-pre:my-2 prose-pre:rounded-card prose-pre:bg-inset prose-pre:font-mono prose-pre:text-[0.82em] prose-pre:leading-relaxed prose-pre:text-ink prose-pre:shadow-hairline prose-pre:[&_code]:bg-transparent prose-pre:[&_code]:p-0 prose-pre:[&_code]:shadow-none",
        "prose-th:border-line-strong prose-th:px-2 prose-th:text-ink prose-td:border-line prose-td:px-2 prose-tr:border-line [&>:first-child]:mt-0 [&>:last-child]:mb-0",
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
