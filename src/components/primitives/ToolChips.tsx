"use client";

import { useState, type ReactNode } from "react";

/* ─────────────────────────────────────────────────────────
 * TOOL CHIPS
 * An agent run as compact rows: tool calls with inline
 * chips. Hover a row to reveal its chevron; every row expands
 * to show what the tool actually did.
 *
 * From Beautiful UI (beautifului.dev, MIT). Unibot's changes:
 * the rows are the Bot's real tool calls instead of a timed
 * demo, the run opens by itself while a tool is working and
 * folds when it's done, a failed row turns red, and the file
 * diff chips are gone (Hermes reports no diffs).
 * ───────────────────────────────────────────────────────── */

const Icons: Record<ToolIcon, ReactNode> = {
  think: <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />,
  write: <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" /></g>,
  run: <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 17l6-5-6-5M12 19h8" /></g>,
  read: <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></g>,
  tool: <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" /></g>,
};

export type ToolIcon = "think" | "write" | "run" | "read" | "tool";

export type ToolDetailLine = { text: string; tone?: "add" | "fail" };

export type ToolStep = {
  id: string;
  icon: ToolIcon;
  label: string;
  /** What the tool worked on; empty hides the chip. */
  chip: string;
  mono: boolean;
  detailMono: boolean;
  detail: ToolDetailLine[];
  /** The row's label turns red. */
  failed?: boolean;
  /** The row spins its icon while the tool runs. */
  running?: boolean;
};

export default function ToolChips({
  steps,
  header,
  working = false,
  className,
}: {
  steps: ToolStep[];
  /** The run's one-line summary, shown on the button that folds it. */
  header: ReactNode;
  /** A tool is running: the run stays open until it's done, unless folded by hand. */
  working?: boolean;
  className?: string;
}) {
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const [openRows, setOpenRows] = useState<Set<string>>(new Set());
  const open = manualOpen ?? working;

  const toggleRow = (id: string) =>
    setOpenRows((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className={`w-full max-w-xl${className ? ` ${className}` : ""}`}>
      {/* collapsed run header */}
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setManualOpen(!open)}
        className="-mx-1.5 flex w-fit max-w-full items-center gap-1.5 rounded-control px-1.5 py-1 text-[12.5px] text-ink-2 transition-colors duration-100 hover:bg-hover-2"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 transition-transform duration-200" style={{ transform: open ? "rotate(0deg)" : "rotate(-90deg)" }} aria-hidden>
          <path d="M6 9l6 6 6-6" />
        </svg>
        <span className="min-w-0 truncate tabular-nums">{header}</span>
      </button>

      {/* tool call rows */}
      <div
        className="grid transition-[grid-template-rows,opacity] duration-300"
        style={{ gridTemplateRows: open ? "1fr" : "0fr", opacity: open ? 1 : 0, transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)" }}
        inert={!open}
      >
        {/* -mx-1 + px-1.5 keeps content at the same x while giving the
            row hover pills room inside this overflow-hidden clip box */}
        <div className="-mx-1 min-h-0 overflow-hidden px-1.5 pb-1">
          <ul className="mt-1.5 flex flex-col gap-1">
            {steps.map((row) => {
              const rowOpen = openRows.has(row.id);
              const canOpen = row.detail.length > 0;
              return (
                <li key={row.id} style={{ animation: "fade-up 300ms cubic-bezier(0.23,1,0.32,1) both" }}>
                  <button
                    type="button"
                    aria-expanded={canOpen ? rowOpen : undefined}
                    disabled={!canOpen}
                    onClick={() => toggleRow(row.id)}
                    className="group/row -mx-[3px] flex h-7 w-[calc(100%+6px)] min-w-0 items-center gap-2 rounded-control px-[3px] text-left transition-colors duration-100 enabled:hover:bg-hover-2 disabled:cursor-default"
                  >
                    <span className={`relative flex size-4 shrink-0 items-center justify-center ${row.failed ? "text-red" : "text-ink-3"}`}>
                      {row.running ? (
                        <span className="size-3 rounded-full border-[1.5px] border-line-strong border-t-ink-2" style={{ animation: "spin 700ms linear infinite" }} aria-hidden />
                      ) : (
                        <svg
                          width="13" height="13" viewBox="0 0 24 24" fill={row.icon === "think" ? "currentColor" : "none"} stroke="currentColor"
                          className={`transition-opacity duration-100 ${canOpen ? "group-hover/row:opacity-0" : ""} ${rowOpen ? "opacity-0" : ""}`}
                          aria-hidden
                        >
                          {Icons[row.icon]}
                        </svg>
                      )}
                      {canOpen && !row.running && (
                        <svg
                          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
                          className={`absolute transition-[opacity,transform] duration-150 group-hover/row:opacity-100 ${rowOpen ? "opacity-100" : "opacity-0"}`}
                          style={{ transform: rowOpen ? "rotate(0deg)" : "rotate(-90deg)" }}
                          aria-hidden
                        >
                          <path d="M6 9l6 6 6-6" />
                        </svg>
                      )}
                    </span>
                    <span className={`shrink-0 text-[12.5px] font-medium ${row.failed ? "text-red" : "text-ink"}`}>{row.label}</span>
                    {row.chip && (
                      <span
                        className={`inline-flex h-5.5 min-w-0 flex-1 items-center truncate rounded-chip bg-field px-1.5
                          text-[11.5px] text-ink-2 shadow-hairline
                          ${row.mono ? "font-mono" : ""}`}
                        title={row.chip}
                      >
                        <span className="truncate">{row.chip}</span>
                      </span>
                    )}
                  </button>

                  {/* expanded detail */}
                  {canOpen && (
                    <div
                      className="grid transition-[grid-template-rows,opacity] duration-300"
                      style={{ gridTemplateRows: rowOpen ? "1fr" : "0fr", opacity: rowOpen ? 1 : 0, transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)" }}
                    >
                      <div className="min-h-0 overflow-hidden">
                        <div className="mt-0.5 mb-1 ml-2 flex flex-col gap-0.5 border-l border-line py-0.5 pl-3.5">
                          {row.detail.map((line, index) => (
                            <span
                              key={index}
                              className={`text-[11.5px] leading-[1.6] whitespace-pre-wrap [overflow-wrap:anywhere] ${row.detailMono ? "font-mono" : ""} ${
                                line.tone === "add" ? "text-green" : line.tone === "fail" ? "text-red" : "text-ink-2"
                              }`}
                            >
                              {line.text}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
