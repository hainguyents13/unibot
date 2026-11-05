import MarkdownIt from "markdown-it";
import { useMemo, type MouseEvent } from "react";
import { openExternal } from "./open-external";

/**
 * Raw HTML is off: a Bot's reply is shown as text, never run as markup. Links are made from bare
 * URLs too.
 */
const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true });

export function Markdown({ text }: { text: string }) {
  const html = useMemo(() => markdown.render(text), [text]);
  return <div className="markdown" onClick={openLinksOutside} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Links open in the browser, not inside the app's window. */
function openLinksOutside(event: MouseEvent<HTMLDivElement>) {
  const link = (event.target as HTMLElement).closest("a");
  if (!link?.href) return;
  event.preventDefault();
  void openExternal(link.href);
}
