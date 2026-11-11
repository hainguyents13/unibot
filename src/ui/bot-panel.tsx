import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { CalendarClock, Monitor, SlidersHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BotScreen } from "../hermes/screen";
import type { Session } from "../hermes/session";
import type { Bot } from "../hermes/types";
import { BotSettingsForm } from "./bot-settings-form";
import { RoutinesList } from "./routines-list";
import { ScreenView } from "./screen-view";
import { Note } from "./settings-parts";

export type BotPanelTab = "settings" | "routines" | "computer";

const TABS: Array<{ tab: BotPanelTab; label: string; icon: ReactNode }> = [
  { tab: "settings", label: "Settings", icon: <SlidersHorizontal /> },
  { tab: "routines", label: "Routines", icon: <CalendarClock /> },
  { tab: "computer", label: "Computer", icon: <Monitor /> },
];

interface BotPanelProps {
  session: Session;
  bot: Bot;
  tab: BotPanelTab;
  onTab: (tab: BotPanelTab) => void;
  onClose: () => void;
  isUnencrypted: boolean;
  /** Shown above its settings, such as a Bot just made that can't reply yet. */
  notice?: string;
}

/**
 * The right-hand panel of a Bot's chat: its settings, its routines and its computer. The computer
 * gets more room. In a narrow window the panel lies over the chat instead of beside it.
 */
export function BotPanel({ session, bot, tab, onTab, onClose, isUnencrypted, notice }: BotPanelProps) {
  return (
    <aside
      aria-label={`${bot.name}'s details`}
      className={cn(
        "flex min-h-0 flex-col border-l border-line bg-surface transition-[width] duration-300 ease-link",
        "animate-[slide-in-right_280ms_cubic-bezier(0.16,1,0.3,1)_both]",
        tab === "computer" ? "w-[min(760px,55vw)]" : "w-[380px]",
        "max-[1000px]:absolute max-[1000px]:inset-y-0 max-[1000px]:right-0 max-[1000px]:z-30 max-[1000px]:max-w-[calc(100vw-2rem)] max-[1000px]:shadow-overlay",
      )}
    >
      <header className="flex items-center gap-2 border-b border-line px-2.5 py-2">
        {/* Beautiful UI's segmented control. */}
        <div role="tablist" aria-label={`${bot.name}'s details`} className="flex min-w-0 flex-1">
          <div className="flex rounded-full bg-field p-0.5">
            {TABS.map(({ tab: value, label, icon }) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] font-medium transition-[background-color,color,box-shadow] duration-150 [&_svg]:size-3.5",
                  tab === value ? "bg-surface text-ink shadow-btn" : "text-ink-3 hover:text-ink-2",
                )}
                onClick={() => onTab(value)}
              >
                {icon}
                {label}
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          className="primitive-icon-button shrink-0 text-ink-3 transition-colors duration-100 hover:bg-hover hover:text-ink"
          aria-label="Close the panel"
          title="Close the panel"
          onClick={onClose}
        >
          <X className="size-4" aria-hidden />
        </button>
      </header>
      <div role="tabpanel" className="relative min-h-0 flex-1">
        {tab === "settings" && (
          // The form scrolls its fields itself, so Save stays put below them.
          <div className="absolute inset-0 flex flex-col animate-[fade-in_200ms_ease-out_both]">
            {notice && (
              <p className="border-b border-line bg-orange-tint px-4 py-2.5 text-[13px] text-orange" role="status">
                {notice}
              </p>
            )}
            <BotSettingsForm key={bot.id} settings={session.botSettings(bot.id)} isUnencrypted={isUnencrypted} />
          </div>
        )}
        {tab === "routines" && (
          <div className="absolute inset-0 overflow-y-auto bg-canvas p-3">
            <RoutinesList key={bot.id} list={session.routines(bot.id)} botName={bot.name} />
          </div>
        )}
        {tab === "computer" && <ComputerTab key={bot.id} screen={session.screen(bot.id)} botName={bot.name} />}
      </div>
    </aside>
  );
}

/** The Bot's screen when it has one; leaving the tab closes the picture and hands control back. */
function ComputerTab({ screen, botName }: { screen: BotScreen; botName: string }) {
  const view = useSyncExternalStore(screen.subscribe, screen.getView);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    void screen.refresh().finally(() => setChecked(true));
  }, [screen]);

  if (view.status?.supported && view.status.installed) return <ScreenView screen={screen} botName={botName} />;
  return (
    <div className="p-4">
      <Note role="status">
        {!checked
          ? `Looking for ${botName}'s computer…`
          : view.status
            ? `${botName} has no computer of its own. It comes with Bot Screen, on a Linux gateway where it's set up.`
            : `Couldn't tell whether ${botName} has a computer. Check the connection and open this tab again.`}
      </Note>
    </div>
  );
}
