import { useState, type ReactNode } from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { CHAT_TEXT_SIZES, PALETTES, savedAppearance, saveAppearance, THEME_MODES, type Appearance, type ThemeMode } from "./appearance";
import { PageTitle, Panel, SectionTitle, Segmented } from "./settings-parts";

const MODE_ICONS: Record<ThemeMode, ReactNode> = { system: <Monitor />, light: <Sun />, dark: <Moon /> };

/** Light or dark, an accent colour, and the size of text in chats. Each pick shows at once. */
export function AppearanceSettings() {
  const [appearance, setAppearance] = useState(savedAppearance);

  function pick(change: Partial<Appearance>) {
    const next = { ...appearance, ...change };
    setAppearance(next);
    saveAppearance(next);
  }

  return (
    <>
      <PageTitle>Appearance</PageTitle>

      <SectionTitle>Mode</SectionTitle>
      <Segmented
        label="Mode"
        value={appearance.mode}
        onChange={(mode) => pick({ mode })}
        options={THEME_MODES.map(({ id, label }) => ({
          value: id,
          label: (
            <>
              {MODE_ICONS[id]}
              {label}
            </>
          ),
        }))}
      />

      <SectionTitle>Colour</SectionTitle>
      <div role="radiogroup" aria-label="Colour" className="flex flex-wrap gap-3">
        {PALETTES.map(({ id, label, swatch }) => {
          const on = appearance.palette === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => pick({ palette: id })}
              className="group flex w-14 flex-col items-center gap-1.5"
            >
              <span
                className={cn(
                  "grid size-7 place-items-center rounded-full text-white transition-[box-shadow,transform] duration-200 ease-out-strong group-active:scale-[0.94]",
                  on ? "shadow-[0_0_0_2px_var(--surface),0_0_0_3.5px_var(--ink)]" : "group-hover:scale-105",
                )}
                style={{ background: swatch }}
              >
                {on && <Check className="size-3.5 animate-[pop-in_220ms_cubic-bezier(0.23,1,0.32,1)_both]" strokeWidth={3} aria-hidden />}
              </span>
              <span className={cn("text-[12px] font-medium transition-colors duration-150", on ? "text-ink" : "text-ink-3 group-hover:text-ink-2")}>{label}</span>
            </button>
          );
        })}
      </div>

      <SectionTitle>Text in chats</SectionTitle>
      <Segmented
        label="Text in chats"
        value={appearance.chatText}
        onChange={(chatText) => pick({ chatText })}
        options={CHAT_TEXT_SIZES.map(({ px, label }) => ({
          value: px,
          label: (
            <>
              <span className="leading-none font-semibold" style={{ fontSize: Math.round(px * 0.8) }}>
                Aa
              </span>
              {label}
            </>
          ),
        }))}
      />

      <Panel className="mt-2 gap-2.5">
        <div className="flex justify-end pl-14">
          <p className="rounded-xl bg-field px-3 py-1.5 text-(length:--chat-text) leading-[1.4] text-ink">How does this look?</p>
        </div>
        <p className="text-(length:--chat-text) leading-relaxed text-ink">Your messages and your Bots' replies show like this, and so does the message box.</p>
      </Panel>
    </>
  );
}
