import type { ReactNode } from "react";
import { Ellipsis } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import GlideMenu from "@/components/primitives/GlideMenu";
import { cn } from "@/lib/utils";
import type { BotStatus } from "../hermes/types";
import { Avatar } from "./avatar";
import { relativeTime } from "./relative-time";

const statusLabel: Record<BotStatus, string | undefined> = {
  idle: undefined,
  working: "Working",
  needsYou: "Needs you",
};

/** What a sidebar row shows: a Bot or a room. */
export interface ContactRow {
  id: string;
  name: string;
  preview: string;
  lastActivity: number;
  status: BotStatus;
}

interface ContactListProps {
  label: string;
  rows: ContactRow[];
  selectedId: string | undefined;
  now: number;
  /** Rooms show a mark instead of an initial. */
  avatar?: (row: ContactRow) => string;
  onSelect: (id: string) => void;
  /** The items of the ⋯ menu on the row you point at. */
  menu?: (row: ContactRow) => ReactNode;
}

/**
 * Bots or rooms as Beautiful UI's sidebar rows: one highlight glides to the row under the pointer
 * (GlideMenu), and the open row keeps its own until the pointer is in the list. When the sidebar is
 * folded to a rail, only the avatars stay, with a dot for a Bot that's working or waits on you.
 */
export function ContactList({ label, rows, selectedId, now, avatar, onSelect, menu }: ContactListProps) {
  return (
    <GlideMenu rowSelector="[data-row]" highlightClassName="sidebar-glide-highlight rounded-[8px] bg-hover-2" className="flex flex-col gap-px">
      <ul className="contents" aria-label={label}>
        {rows.map((row) => {
          const badge = statusLabel[row.status];
          const current = row.id === selectedId;
          return (
            <li key={row.id} className="group/row relative">
              <button
                type="button"
                data-row
                title={row.name}
                className={cn(
                  "sidebar-row relative z-10 mx-2 flex items-center gap-2.5 rounded-[8px] px-1.5 py-1.5 text-left transition-[width,background-color,transform] duration-150 active:scale-[0.985]",
                  current && "bg-hover-2 group-hover/glide-menu:bg-transparent",
                )}
                aria-current={current ? "true" : undefined}
                onClick={() => onSelect(row.id)}
              >
                <span className="relative shrink-0">
                  <Avatar name={row.name} mark={avatar?.(row)} className="size-7 text-[12.5px]" />
                  {row.status !== "idle" && (
                    <span
                      aria-hidden
                      className={cn(
                        "sidebar-dot absolute -top-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-canvas",
                        row.status === "needsYou" ? "bg-orange" : "bg-accent",
                      )}
                    />
                  )}
                </span>
                <span className="sidebar-copy flex min-w-0 flex-1 flex-col">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className={cn("truncate text-[14px] font-medium", current ? "text-ink" : "text-ink-2 group-hover/row:text-ink")}>
                      {row.name}
                    </span>
                    {/* The ⋯ button takes the time's place while you point at the row or its menu is open. */}
                    <span
                      className={cn(
                        "shrink-0 text-[11.5px] text-ink-3 tabular-nums",
                        menu && "group-hover/row:invisible group-has-focus-visible/row:invisible group-has-data-[state=open]/row:invisible",
                      )}
                    >
                      {relativeTime(row.lastActivity, now)}
                    </span>
                  </span>
                  {(row.preview || badge) && (
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-[12.5px] text-ink-3">{row.preview}</span>
                      {badge && <StatusBadge status={row.status}>{badge}</StatusBadge>}
                    </span>
                  )}
                </span>
              </button>
              {menu && (
                // Not modal: its items open dialogs, and a modal menu closing under a dialog can leave
                // the page unclickable.
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="sidebar-fold-hide absolute top-1 right-3 z-20 flex size-6 items-center justify-center rounded-[6px] text-ink-3 opacity-0 transition-[opacity,background-color,color] duration-150 group-hover/row:opacity-100 group-has-focus-visible/row:opacity-100 hover:bg-surface hover:text-ink data-[state=open]:bg-surface data-[state=open]:text-ink data-[state=open]:opacity-100"
                      aria-label={`More for ${row.name}`}
                      title={`More for ${row.name}`}
                    >
                      <Ellipsis className="size-4" aria-hidden />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" side="right" className="w-56">
                    {menu(row)}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </li>
          );
        })}
      </ul>
    </GlideMenu>
  );
}

/** Beautiful UI's soft status pill: orange when a Bot waits on you, the accent while it works. */
export function StatusBadge({ status, children }: { status: BotStatus; children: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[11px] font-medium",
        status === "needsYou" ? "bg-orange-tint text-orange" : "bg-accent-tint text-accent-ink",
      )}
      style={{ animation: "fade-in 200ms ease-out both" }}
    >
      {children}
    </span>
  );
}
