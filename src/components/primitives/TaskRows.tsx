"use client";

import { useState, type ReactNode } from "react";

/* ─────────────────────────────────────────────────────────
 * TASK ROWS — from Beautiful UI (beautifului.dev, MIT)
 *
 * Capsule rows that enter staggered (80ms apart), each with a
 * status badge, a label, an amount and a pill; the chevron
 * opens the row into its details on the grid-rows ease.
 *
 * Unibot's changes: the demo's timed status run and its fake
 * rows are gone. Each row's state comes from its caller, the
 * details are any content (so they can hold controls), and a
 * pill takes its own text and tone. The amount sits under the
 * label, so a long name still fits a narrow panel.
 * ───────────────────────────────────────────────────────── */

function SpinnerRing({ active, children }: { active?: boolean; children?: ReactNode }) {
  const size = 24, stroke = 2;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg
        width={size} height={size} className="absolute inset-0"
        style={active ? { animation: "spin 1.1s linear infinite" } : undefined}
      >
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        {active && (
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none"
            stroke="var(--ink-3)" strokeWidth={stroke} strokeLinecap="round"
            strokeDasharray={`${c * 0.28} ${c * 0.72}`}
          />
        )}
      </svg>
      <span className="relative text-[10.5px] font-semibold tabular-nums text-ink">{children}</span>
    </span>
  );
}

function Badge({ tone, children }: { tone: "red" | "green"; children: ReactNode }) {
  return (
    <span
      className={`flex size-5.5 shrink-0 items-center justify-center rounded-full text-white
        ${tone === "red" ? "bg-red" : "bg-green"}`}
      style={{ animation: "pop-in 300ms cubic-bezier(0.23,1,0.32,1) both" }}
    >
      {children}
    </span>
  );
}

const XIcon = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
);
const CheckIcon = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
);

/* A single task row.
 *  - "done"     → green check badge
 *  - "failed"   → red cross badge
 *  - "running"  → spinning ring
 *  - "idle"     → still, empty ring
 */
export type TaskRow = {
  key: string;
  label: string;
  amount: string;
  status: "done" | "failed" | "running" | "idle";
  pill?: { text: string; tone: "green" | "red" | "neutral" };
  details: ReactNode;
};

const PILL_TONES = {
  green: "bg-green-tint text-green",
  red: "bg-red-tint text-red",
  neutral: "bg-field text-ink-2",
};

export default function TaskRows({
  rows,
  className,
  "aria-label": ariaLabel,
}: {
  rows: TaskRow[];
  className?: string;
  "aria-label"?: string;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const badgeFor = (row: TaskRow) => {
    if (row.status === "done") return <Badge tone="green">{CheckIcon}</Badge>;
    if (row.status === "failed") return <Badge tone="red">{XIcon}</Badge>;
    return <SpinnerRing active={row.status === "running"} />;
  };

  return (
    <ul aria-label={ariaLabel} className={`flex w-full flex-col gap-2${className ? ` ${className}` : ""}`}>
      {rows.map((row, i) => {
        const isOpen = open[row.key] ?? false;
        return (
          <li
            key={row.key}
            className="self-stretch overflow-hidden bg-surface shadow-card transition-[border-radius,background-color] duration-300 hover:bg-inset"
            style={{
              borderRadius: isOpen ? 14 : 22,
              animation: `fade-up 450ms cubic-bezier(0.23,1,0.32,1) ${i * 80}ms both`,
            }}
          >
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => setOpen((current) => ({ ...current, [row.key]: !isOpen }))}
              className="flex min-h-11 w-full items-center gap-2.5 px-2.5 py-1.5 text-left"
            >
              <span className="flex size-6 shrink-0 items-center justify-center">
                {badgeFor(row)}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[13px] font-medium text-ink">{row.label}</span>
                <span className="truncate text-[12px] text-ink-3 tabular-nums">{row.amount}</span>
              </span>
              {row.pill && (
                <span
                  className={`inline-flex h-5.5 shrink-0 items-center rounded-full px-2 text-[11.5px] font-medium ${PILL_TONES[row.pill.tone]}`}
                  style={{ animation: "fade-in 200ms ease-out both" }}
                >
                  {row.pill.text}
                </span>
              )}
              <span
                aria-hidden="true"
                className="-ml-2 flex size-7 shrink-0 items-center justify-center rounded-full text-ink-3"
              >
                <svg
                  width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
                  className="transition-transform duration-300"
                  style={{ transform: isOpen ? "rotate(180deg)" : "rotate(0)" }}
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </span>
            </button>

            {/* dropdown detail — same expandable grammar as Chain of Thought */}
            <div
              className="grid transition-[grid-template-rows,opacity] duration-300"
              style={{
                gridTemplateRows: isOpen ? "1fr" : "0fr",
                opacity: isOpen ? 1 : 0,
                transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)",
              }}
              inert={!isOpen}
            >
              <div className="overflow-hidden">
                <div className="mb-2.5 grid grid-cols-[24px_1fr] gap-2.5 px-2.5">
                  <span aria-hidden className="mx-auto h-full w-px bg-line" />
                  <div
                    className="flex min-w-0 flex-col gap-1.5"
                    style={isOpen ? { animation: "fade-up 300ms cubic-bezier(0.23,1,0.32,1) 120ms both" } : undefined}
                  >
                    {row.details}
                  </div>
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
