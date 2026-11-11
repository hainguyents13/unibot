"use client";

import { useLayoutEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/* ─────────────────────────────────────────────────────────
 * PROMPT BAR
 * A composer with real controls: attach, / commands and send.
 * Type / to open the menu; ↑↓ + Enter to pick. Wrapped text
 * moves above the controls, then grows to a compact maximum.
 *
 * From Beautiful UI (beautifului.dev, MIT). Unibot's changes:
 * it's controlled (the caller owns the text, the menu's rows
 * and the attachments), the self-running demo, @ sources,
 * model picker, dictation and glimm sweep are gone, a Stop
 * button joins Send while a reply runs, the text follows the
 * chat's text size, and the buttons have tooltips.
 * ───────────────────────────────────────────────────────── */

function Icon({ children, size = 15, strokeWidth = 1.8 }: { children: ReactNode; size?: number; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

const FILE_GLYPH = (
  <g>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
  </g>
);
const IMAGE_GLYPH = (
  <g>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="9" cy="9" r="2" />
    <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
  </g>
);

export type PromptBarMenuRow = { key: string; name: string; desc: string; tag?: string };

export type PromptBarMenu = {
  /** The listbox's ID, which the text box points at with `aria-controls`. */
  id: string;
  label: string;
  rows: PromptBarMenuRow[];
  active: number;
  onHover: (index: number) => void;
  onPick: (index: number) => void;
  hint: string;
};

export type PromptBarAttachment = { name: string; kind: "image" | "file" };

function Tip({ tip, children }: { tip: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="top">{tip}</TooltipContent>
    </Tooltip>
  );
}

export default function PromptBar({
  value,
  onValueChange,
  onSubmit,
  onKeyDown,
  onPaste,
  placeholder,
  ariaLabel,
  textareaId,
  disabled = false,
  menu,
  attachments = [],
  onRemoveAttachment,
  attach,
  stop,
  canSend,
  sending = false,
  maxHeight = 200,
}: {
  value: string;
  onValueChange: (value: string) => void;
  /** Enter without Shift, unless `onKeyDown` already handled the key. */
  onSubmit: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste?: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  placeholder: string;
  ariaLabel: string;
  textareaId?: string;
  disabled?: boolean;
  menu?: PromptBarMenu;
  attachments?: PromptBarAttachment[];
  onRemoveAttachment?: (index: number) => void;
  /** The + button; left out where nothing can be attached. */
  attach?: { label: string; disabled: boolean; onClick: () => void };
  /** Shown while a reply runs; `text` puts a word beside the icon. */
  stop?: { label: string; text?: string; onClick: () => void };
  canSend: boolean;
  sending?: boolean;
  maxHeight?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [rowBox, setRowBox] = useState<{ top: number; height: number } | null>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const rowRefs = useRef<(HTMLLIElement | null)[]>([]);
  const rows = menu?.rows ?? [];
  const active = menu?.active ?? 0;

  /* a single highlight glides to the active row instead of each row
   * toggling its own background — matches the gliding pill in the nav */
  useLayoutEffect(() => {
    const target = rowRefs.current[active];
    if (target) {
      setRowBox({ top: target.offsetTop, height: target.offsetHeight });
      target.scrollIntoView({ block: "nearest" });
    }
  }, [active, rows.length, menu?.id]);

  /* Move wrapped text above the controls, then grow to a compact maximum. */
  useLayoutEffect(() => {
    const input = inputRef.current;
    const controls = controlsRef.current;
    const measure = measureRef.current;
    const actions = actionsRef.current;
    if (!input || !controls || !measure || !actions) return;

    const fixedControlsWidth = (attach ? 28 : 0) + actions.offsetWidth;
    const inlineGaps = 4 * 2;
    const inlineInputWidth = controls.clientWidth - fixedControlsWidth - inlineGaps;
    const needsFullWidth = value.includes("\n") || measure.offsetWidth + 8 > inlineInputWidth;
    if (needsFullWidth !== expanded) {
      setExpanded(needsFullWidth);
    }

    input.style.height = "0px";
    const contentHeight = input.scrollHeight;
    input.style.height = `${Math.min(Math.max(contentHeight, 28), maxHeight)}px`;
    input.style.overflowY = contentHeight > maxHeight ? "auto" : "hidden";
  }, [value, expanded, attach, stop, maxHeight]);

  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    // Enter while an input method is composing (Vietnamese, Japanese…) finishes the word instead.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      onSubmit();
    }
  }

  const wide = expanded;
  const sendLabel = sending ? "Sending…" : "Send";

  return (
    <TooltipProvider>
      <div data-promptbar className="relative w-full">
        {/* ── / menu ─────────────────────────────────────── */}
        {menu && rows.length > 0 && (
          <div
            className="absolute inset-x-0 bottom-full z-10 mb-2 rounded-[10px] bg-surface p-1 shadow-raised"
            style={{ animation: "pop-in 180ms cubic-bezier(0.23,1,0.32,1) both", transformOrigin: "bottom center" }}
          >
            <ul role="listbox" id={menu.id} aria-label={menu.label} className="relative max-h-72 overflow-y-auto">
              {/* single gliding highlight on the row Enter would pick */}
              <span
                aria-hidden
                className="pointer-events-none absolute inset-x-0 rounded-[6px] bg-hover"
                style={{
                  top: rowBox?.top ?? 0,
                  height: rowBox?.height ?? 0,
                  opacity: rowBox ? 1 : 0,
                  transition: "top 220ms cubic-bezier(0.23,1,0.32,1), height 220ms cubic-bezier(0.23,1,0.32,1), opacity 150ms ease",
                }}
              />
              {rows.map((row, i) => (
                <li
                  key={row.key}
                  id={`${menu.id}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  ref={(el) => {
                    rowRefs.current[i] = el;
                  }}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    menu.onPick(i);
                  }}
                  onMouseEnter={() => menu.onHover(i)}
                  className="relative z-10 flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-[6px] px-2 text-left"
                >
                  <span className="shrink-0 font-mono text-[12.5px] font-medium text-ink">{row.name}</span>
                  {row.tag && (
                    <span className="inline-flex h-5 shrink-0 items-center rounded-chip bg-field px-1.5 text-[11px] text-ink-3 shadow-hairline">{row.tag}</span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-[12px] text-ink-3">{row.desc}</span>
                </li>
              ))}
            </ul>
            <div className="mt-1 border-t border-line px-2 pt-1.5 pb-1 text-[11px] text-ink-3">{menu.hint}</div>
          </div>
        )}

        {/* ── composer ───────────────────────────────────── */}
        <div
          onClick={() => {
            if (!disabled) inputRef.current?.focus();
          }}
          className={`relative isolate flex cursor-text flex-col gap-1.5 overflow-hidden rounded-[14px] border border-line bg-surface p-1.5 shadow-card transition-[border-color,opacity] duration-150 focus-within:border-line-strong ${
            disabled ? "cursor-not-allowed opacity-60" : ""
          }`}
        >
          <span
            ref={measureRef}
            aria-hidden="true"
            className="pointer-events-none invisible absolute text-(length:--chat-text) leading-[1.4] whitespace-pre"
          >
            {value}
          </span>

          {attachments.length > 0 && (
            <ul className="flex flex-wrap gap-1.5 px-0.5 pt-0.5" aria-label="Attachments">
              {attachments.map((file, i) => (
                <li
                  key={`${file.name}-${i}`}
                  className="flex h-6.5 items-center gap-1.5 rounded-chip bg-field py-1 pr-1 pl-1.5 text-[11.5px] text-ink-2 shadow-hairline"
                  style={{ animation: "pop-in 200ms cubic-bezier(0.23,1,0.32,1) both" }}
                >
                  <span aria-label={file.kind === "image" ? "Image" : "File"} role="img" className="flex">
                    <Icon size={12}>{file.kind === "image" ? IMAGE_GLYPH : FILE_GLYPH}</Icon>
                  </span>
                  <span className="max-w-48 truncate">{file.name}</span>
                  {onRemoveAttachment && (
                    <button
                      type="button"
                      aria-label={`Remove ${file.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onRemoveAttachment(i);
                      }}
                      className="-my-1 flex size-6 items-center justify-center rounded-[5px] text-ink-3 transition-colors duration-100 hover:bg-line/70 hover:text-ink"
                    >
                      <Icon size={10} strokeWidth={2.5}>
                        <path d="M18 6L6 18M6 6l12 12" />
                      </Icon>
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          <div
            ref={controlsRef}
            className={`grid items-end gap-x-1 gap-y-1.5 ${attach ? "grid-cols-[28px_minmax(0,1fr)_auto]" : "grid-cols-[minmax(0,1fr)_auto]"}`}
          >
            {attach && (
              <Tip tip={attach.label}>
                <button
                  type="button"
                  aria-label="Attach files"
                  disabled={attach.disabled}
                  onClick={(event) => {
                    event.stopPropagation();
                    attach.onClick();
                  }}
                  className={`flex size-7 shrink-0 items-center justify-center justify-self-start rounded-[8px] text-ink-3 transition-[background-color,color,transform] duration-150 enabled:hover:bg-hover enabled:hover:text-ink enabled:active:scale-[0.94] disabled:opacity-40 ${
                    wide ? "col-start-1 row-start-2" : "col-start-1 row-start-1"
                  }`}
                >
                  <Icon size={16} strokeWidth={2}>
                    <path d="M12 5v14M5 12h14" />
                  </Icon>
                </button>
              </Tip>
            )}

            <textarea
              ref={inputRef}
              id={textareaId}
              rows={1}
              value={value}
              disabled={disabled}
              onChange={(event) => onValueChange(event.target.value)}
              onKeyDown={keyDown}
              onPaste={onPaste}
              placeholder={placeholder}
              aria-label={ariaLabel}
              aria-controls={menu && rows.length ? menu.id : undefined}
              aria-activedescendant={menu && rows.length ? `${menu.id}-${active}` : undefined}
              className={`min-h-7 w-full min-w-0 resize-none bg-transparent px-1 py-[3px] text-(length:--chat-text) leading-[1.4] text-ink outline-none [overflow-wrap:anywhere] placeholder:text-ink-3 disabled:cursor-not-allowed ${
                wide ? "col-span-full col-start-1 row-start-1 px-1.5" : attach ? "col-start-2 row-start-1" : "col-start-1 row-start-1"
              }`}
            />

            <div
              ref={actionsRef}
              className={`flex items-center gap-1 ${wide ? (attach ? "col-start-3 row-start-2" : "col-start-2 row-start-2") : attach ? "col-start-3 row-start-1" : "col-start-2 row-start-1"}`}
            >
              {stop && (
                <Tip tip={stop.label}>
                  <button
                    type="button"
                    aria-label={stop.label}
                    onClick={(event) => {
                      event.stopPropagation();
                      stop.onClick();
                    }}
                    className={`flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-[8px] text-ink-2 shadow-btn transition-[background-color,color,transform] duration-150 hover:bg-hover hover:text-ink active:scale-[0.94] ${
                      stop.text ? "px-2 text-[12px] font-medium" : "w-7"
                    }`}
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                      <rect width="10" height="10" rx="2" fill="currentColor" />
                    </svg>
                    {stop.text}
                  </button>
                </Tip>
              )}

              {/* send — tactile square */}
              <Tip tip={sendLabel}>
                <button
                  type="button"
                  aria-label={sendLabel}
                  disabled={!canSend}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSubmit();
                  }}
                  className={`flex size-7 shrink-0 items-center justify-center rounded-[8px] transition-[background-color,color,transform] duration-200 enabled:active:scale-[0.94] ${
                    sending ? "animate-pulse" : ""
                  }`}
                  style={{
                    background: canSend ? "var(--ink)" : "var(--line-strong)",
                    color: canSend ? "var(--surface)" : "var(--ink-2)",
                  }}
                >
                  <Icon size={16} strokeWidth={2.4}>
                    <path d="M12 19V5M5 12l7-7 7 7" />
                  </Icon>
                </button>
              </Tip>
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
