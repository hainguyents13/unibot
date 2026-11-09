import type { ReactNode } from "react";
import { Ellipsis } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
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

export function ContactList({ label, rows, selectedId, now, avatar, onSelect, menu }: ContactListProps) {
  return (
    <ul className="flex flex-col gap-0.5 px-2" aria-label={label}>
      {rows.map((row) => {
        const badge = statusLabel[row.status];
        return (
          <li key={row.id} className="group relative">
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-lg border-0 bg-transparent px-2 py-2 text-left transition-colors group-hover:bg-sidebar-accent aria-[current=true]:bg-sidebar-accent"
              aria-current={row.id === selectedId ? "true" : undefined}
              onClick={() => onSelect(row.id)}
            >
              <Avatar name={row.name} mark={avatar?.(row)} className="size-9" />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-semibold">{row.name}</span>
                  {/* The ⋯ button takes the time's place while you point at the row or its menu is open. */}
                  <span
                    className={cn(
                      "shrink-0 text-xs text-muted-foreground",
                      menu && "group-hover:invisible group-has-focus-visible:invisible group-has-data-[state=open]:invisible",
                    )}
                  >
                    {relativeTime(row.lastActivity, now)}
                  </span>
                </span>
                {(row.preview || badge) && (
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-[13px] text-muted-foreground">{row.preview}</span>
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
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute top-1.5 right-1.5 size-7 text-muted-foreground opacity-0 group-hover:opacity-100 group-has-focus-visible:opacity-100 hover:bg-background data-[state=open]:bg-background data-[state=open]:opacity-100"
                    aria-label={`More for ${row.name}`}
                    title={`More for ${row.name}`}
                  >
                    <Ellipsis aria-hidden />
                  </Button>
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
  );
}

export function StatusBadge({ status, children }: { status: BotStatus; children: string }) {
  return (
    <Badge
      className={cn(
        "h-5 shrink-0 rounded-full border-0 px-2 text-[11px]",
        status === "needsYou" ? "bg-attention-soft text-attention" : "bg-working-soft text-working",
      )}
    >
      {children}
    </Badge>
  );
}
