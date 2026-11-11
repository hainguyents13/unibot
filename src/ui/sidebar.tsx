import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Blocks, ChevronDown, Palette, PanelLeftClose, PanelLeftOpen, Plus, Search, Server, Settings, X } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import GlideMenu from "@/components/primitives/GlideMenu";
import { LoaderGrid, PATTERNS } from "@/components/primitives/LoadingState";
import { cn } from "@/lib/utils";
import type { Link, SessionState } from "../hermes/session";
import { ContactList, type ContactRow } from "./bot-list";
import type { SettingsPage } from "./settings-dialog";

/**
 * Beautiful UI's SidebarNav, holding Unibot's Bots and rooms: the gateway at the top with a menu,
 * Bots and rooms as gliding rows in groups that fold, a search that grows out of the Bots header,
 * and Settings at the foot. It folds to a rail of avatars and remembers that.
 */

const MOTION = { expanded: 272, collapsed: 56, duration: 280, easing: "cubic-bezier(0.16, 1, 0.3, 1)" };
/** The search field's growth, from Beautiful UI's chat search storyboard. */
const SEARCH_MOTION = { duration: 180, closedWidth: 28, easing: "cubic-bezier(0.16, 1, 0.3, 1)" };

// The page's own storage: whether the sidebar is folded is a convenience, fine to lose.
const FOLDED_KEY = "unibot.sidebar-folded";

type Selection = { kind: "bot" | "room"; id: string };

interface SidebarProps {
  state: Extract<SessionState, { kind: "signedIn" }>;
  selection: Selection | undefined;
  onSelect: (selection: Selection) => void;
  botMenu: (row: ContactRow) => ReactNode;
  onNewBot: () => void;
  onNewRoom: () => void;
  onSettings: (page: SettingsPage) => void;
}

export function Sidebar({ state, selection, onSelect, botMenu, onNewBot, onNewRoom, onSettings }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(readFolded);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState({ bots: true, rooms: true });
  const searchRef = useRef<HTMLInputElement>(null);
  const now = Date.now();

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  function fold(next: boolean) {
    setCollapsed(next);
    if (next) closeSearch();
    try {
      localStorage.setItem(FOLDED_KEY, next ? "1" : "0");
    } catch {
      // Storage can be off; the sidebar just opens unfolded next time.
    }
  }

  function closeSearch() {
    setSearchOpen(false);
    setQuery("");
  }

  const needle = query.trim().toLowerCase();
  const matches = (row: ContactRow) => !needle || `${row.name} ${row.preview}`.toLowerCase().includes(needle);
  const bots = state.bots.filter(matches);
  const rooms = state.rooms.filter(matches);
  // A search shows every match, even in a folded group.
  const showBots = open.bots || !!needle;
  const showRooms = open.rooms || !!needle;

  return (
    <aside
      data-sidebar-collapsed={collapsed}
      aria-label="Bots and rooms"
      className="relative flex min-h-0 shrink-0 overflow-hidden border-r border-line bg-canvas transition-[width]"
      style={
        {
          width: collapsed ? MOTION.collapsed : MOTION.expanded,
          transitionDuration: `${MOTION.duration}ms`,
          transitionTimingFunction: MOTION.easing,
          "--sidebar-width": `${MOTION.expanded}px`,
        } as CSSProperties
      }
    >
      <div className="flex min-h-0 shrink-0 flex-col" style={{ width: MOTION.expanded }}>
        <div className="relative h-12 shrink-0">
          <GatewayMenu baseUrl={state.gateway.baseUrl} demo={state.demo} hidden={collapsed} onSettings={onSettings} />
          <button
            type="button"
            aria-label="Fold the sidebar"
            title="Fold the sidebar"
            aria-hidden={collapsed}
            tabIndex={collapsed ? -1 : 0}
            onClick={() => fold(true)}
            className="sidebar-collapse-control absolute top-2 right-2 flex size-8 items-center justify-center rounded-control text-ink-3 transition-[opacity,background-color,color] duration-150 hover:bg-hover-2 hover:text-ink"
          >
            <PanelLeftClose className="size-[18px]" aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Unfold the sidebar"
            title="Unfold the sidebar"
            aria-hidden={!collapsed}
            tabIndex={collapsed ? 0 : -1}
            onClick={() => fold(false)}
            className="sidebar-expand-control absolute top-2 left-2 flex size-10 items-center justify-center rounded-control text-ink-3 transition-[opacity,background-color,color] duration-150 hover:bg-hover-2 hover:text-ink"
          >
            <PanelLeftOpen className="size-[18px]" aria-hidden />
          </button>
        </div>

        <LinkNotice link={state.link} />

        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-2">
          {/* Bots, with the search that grows out of their header. */}
          <div className="sidebar-fold-hide relative mx-2 mb-0.5 h-8">
            <GroupLabel
              label="Bots"
              open={showBots}
              onToggle={() => setOpen((o) => ({ ...o, bots: !o.bots }))}
              className={cn("transition-[opacity,transform]", searchOpen ? "pointer-events-none -translate-x-1 opacity-0" : "translate-x-0 opacity-100")}
              style={{ transitionDuration: `${SEARCH_MOTION.duration}ms`, transitionTimingFunction: SEARCH_MOTION.easing }}
            />
            <div
              className={cn("absolute top-0 right-0 z-10 flex transition-opacity", searchOpen ? "pointer-events-none opacity-0" : "opacity-100")}
              style={{ transitionDuration: `${SEARCH_MOTION.duration}ms` }}
            >
              <HeaderButton label="Search Bots and rooms" onClick={() => setSearchOpen(true)} expanded={searchOpen}>
                <Search className="size-4" aria-hidden />
              </HeaderButton>
              <HeaderButton label="New Bot" onClick={onNewBot}>
                <Plus className="size-4" aria-hidden />
              </HeaderButton>
            </div>
            <div
              className={cn(
                "absolute top-0 right-0 z-20 flex h-8 items-center overflow-hidden rounded-control bg-field text-ink-3 shadow-hairline transition-[width,opacity] focus-within:text-ink-2",
                searchOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
              )}
              style={{
                width: searchOpen ? "100%" : SEARCH_MOTION.closedWidth,
                transitionDuration: `${SEARCH_MOTION.duration}ms`,
                transitionTimingFunction: SEARCH_MOTION.easing,
              }}
            >
              <Search className="ml-2 size-[15px] shrink-0" aria-hidden />
              <input
                ref={searchRef}
                value={query}
                tabIndex={searchOpen ? 0 : -1}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") closeSearch();
                }}
                placeholder="Search Bots and rooms"
                aria-label="Search Bots and rooms"
                className="ml-1.5 min-w-0 flex-1 bg-transparent text-[13px] font-medium text-ink outline-none placeholder:text-ink-3"
              />
              <button
                type="button"
                aria-label="Close the search"
                tabIndex={searchOpen ? 0 : -1}
                onClick={closeSearch}
                className="flex size-8 shrink-0 items-center justify-center rounded-control text-ink-3 transition-[background-color,color,transform] duration-150 hover:bg-hover-2 hover:text-ink active:scale-[0.96]"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
          </div>
          <Group open={showBots}>
            <ContactList
              label="Bots"
              rows={bots}
              selectedId={selection?.kind === "bot" ? selection.id : undefined}
              now={now}
              onSelect={(id) => onSelect({ kind: "bot", id })}
              menu={botMenu}
            />
            {state.link.kind === "online" && state.bots.length === 0 && (
              <p className="sidebar-copy mx-2 px-2 py-1.5 text-[12.5px] text-ink-3">No Bots on this gateway yet. Make one with +.</p>
            )}
          </Group>

          {/* Rooms. */}
          <div className="sidebar-fold-hide relative mx-2 mt-3 mb-0.5 h-8">
            <GroupLabel label="Rooms" open={showRooms} onToggle={() => setOpen((o) => ({ ...o, rooms: !o.rooms }))} />
            <div className="absolute top-0 right-0 flex">
              <HeaderButton label="New room" onClick={onNewRoom}>
                <Plus className="size-4" aria-hidden />
              </HeaderButton>
            </div>
          </div>
          <Group open={showRooms}>
            <ContactList
              label="Rooms"
              rows={rooms}
              selectedId={selection?.kind === "room" ? selection.id : undefined}
              now={now}
              avatar={() => "#"}
              onSelect={(id) => onSelect({ kind: "room", id })}
            />
            {state.link.kind === "online" && state.rooms.length === 0 && (
              <p className="sidebar-copy mx-2 px-2 py-1.5 text-[12.5px] text-ink-3">No rooms yet. Start one with +.</p>
            )}
          </Group>
          {needle && bots.length === 0 && rooms.length === 0 && (
            <p className="sidebar-copy mx-2 px-2 py-2 text-[12.5px] text-ink-3" role="status">
              No Bots or rooms match “{query.trim()}”.
            </p>
          )}
        </div>

        <div className="shrink-0 border-t border-line py-2">
          <GlideMenu rowSelector="[data-row]" highlightClassName="sidebar-glide-highlight rounded-[8px] bg-hover-2" className="flex flex-col">
            <button
              type="button"
              data-row
              title="Settings"
              onClick={() => onSettings({ kind: "gateway" })}
              className="sidebar-row relative z-10 mx-2 flex h-9 items-center gap-2.5 rounded-[8px] px-2.5 text-left text-ink-2 transition-[width,color,transform] duration-150 hover:text-ink active:scale-[0.98]"
            >
              <Settings className="size-[18px] shrink-0" aria-hidden />
              <span className="sidebar-copy min-w-0 flex-1 truncate text-[14px] font-medium">Settings</span>
            </button>
          </GlideMenu>
        </div>
      </div>
    </aside>
  );
}

function readFolded(): boolean {
  try {
    return localStorage.getItem(FOLDED_KEY) === "1";
  } catch {
    return false;
  }
}

/** The gateway's name with a menu, as Beautiful UI's workspace switcher. */
function GatewayMenu({ baseUrl, demo, hidden, onSettings }: { baseUrl: string; demo: boolean; hidden: boolean; onSettings: (page: SettingsPage) => void }) {
  const host = hostOf(baseUrl);
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-hidden={hidden}
          tabIndex={hidden ? -1 : 0}
          title={baseUrl}
          className="sidebar-copy absolute top-2 left-2 flex h-8 items-center rounded-control px-1.5 text-left transition-[background-color,transform,opacity] duration-100 hover:bg-hover-2 active:scale-[0.99] data-[state=open]:bg-hover-2"
          style={{ width: MOTION.expanded - 16 - 40 }}
        >
          <span className="flex size-6 shrink-0 items-center justify-center rounded-[7px] bg-ink text-[11px] font-semibold text-surface">U</span>
          <span className="ml-2 flex min-w-0 flex-1 flex-col leading-tight">
            <span className="truncate text-[13.5px] font-semibold text-ink">Unibot</span>
            <span className="truncate text-[11.5px] text-ink-3">{demo ? "Demo gateway" : host}</span>
          </span>
          <ChevronDown className="ml-1 size-4 shrink-0 text-ink-3" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuItem onSelect={() => onSettings({ kind: "gateway" })}>
          <Server />
          <span className="min-w-0 flex-1 truncate">Gateway</span>
          <span className="max-w-24 truncate text-[11.5px] text-ink-3">{demo ? "Demo" : host}</span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onSettings({ kind: "appearance" })}>
          <Palette />
          Appearance
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onSettings({ kind: "composio" })}>
          <Blocks />
          Composio
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onSettings({ kind: "gateway" })}>
          <Settings />
          All settings
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

/** "Bots" or "Rooms" with Beautiful UI's chevron; it folds the group under it. */
function GroupLabel({ label, open, onToggle, className, style }: { label: string; open: boolean; onToggle: () => void; className?: string; style?: CSSProperties }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className={cn("absolute inset-y-0 left-0 flex items-center gap-1 rounded-control px-1.5 text-[12.5px] font-medium text-ink-3 hover:text-ink-2", className)}
      style={style}
    >
      <ChevronDown className="size-4 transition-transform duration-200" style={{ transform: open ? "rotate(0)" : "rotate(-90deg)" }} aria-hidden />
      {label}
    </button>
  );
}

function HeaderButton({ label, onClick, expanded, children }: { label: string; onClick: () => void; expanded?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-expanded={expanded}
      onClick={onClick}
      className="flex size-8 items-center justify-center rounded-control text-ink-3 transition-[background-color,color,transform] duration-150 hover:bg-hover-2 hover:text-ink active:scale-[0.96]"
    >
      {children}
    </button>
  );
}

/** A group that folds with Beautiful UI's expand grammar: grid rows from 0fr to 1fr. */
function Group({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div
      className="grid transition-[grid-template-rows,opacity] duration-300"
      style={{ gridTemplateRows: open ? "1fr" : "0fr", opacity: open ? 1 : 0, transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)" }}
      inert={!open}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

function LinkNotice({ link }: { link: Link }) {
  const box = "sidebar-copy mx-2 mb-2 flex items-center gap-2 rounded-control px-2.5 py-1.5 text-[12.5px]";
  const appear = { animation: "fade-up 300ms cubic-bezier(0.23,1,0.32,1) both" };
  switch (link.kind) {
    case "connecting":
      return (
        <p className={`${box} bg-field text-ink-2`} style={appear} role="status">
          <LoaderGrid {...PATTERNS.Drive} />
          Connecting…
        </p>
      );
    case "offline":
      return (
        <p className={`${box} bg-orange-tint text-orange`} style={appear} role="status">
          {link.message} Trying again…
        </p>
      );
    case "online":
      return link.dialect === "canonical" ? (
        <p className={`${box} bg-field text-ink-2`} style={appear} role="status">
          <span>
            This gateway runs <code>hermes gateway</code>. Chats there aren't supported yet; use <code>hermes dashboard</code>.
          </span>
        </p>
      ) : null;
  }
}
