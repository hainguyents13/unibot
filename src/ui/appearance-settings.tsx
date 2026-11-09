import { useState, type ReactNode } from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { CHAT_TEXT_SIZES, PALETTES, savedAppearance, saveAppearance, THEME_MODES, type Appearance, type ThemeMode } from "./appearance";
import { PageTitle, Panel, SectionTitle } from "./settings-parts";

const MODE_ICONS: Record<ThemeMode, ReactNode> = { system: <Monitor />, light: <Sun />, dark: <Moon /> };

/** Light or dark, a colour theme, and the size of text in chats. Each pick shows at once. */
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
      <Choices label="Mode">
        {THEME_MODES.map(({ id, label }) => (
          <Choice key={id} checked={appearance.mode === id} onPick={() => pick({ mode: id })}>
            <span className="[&_svg]:size-5">{MODE_ICONS[id]}</span>
            <span className="text-xs">{label}</span>
          </Choice>
        ))}
      </Choices>

      <SectionTitle>Colour</SectionTitle>
      <Choices label="Colour">
        {PALETTES.map(({ id, label, swatch }) => (
          <Choice key={id} checked={appearance.palette === id} onPick={() => pick({ palette: id })}>
            <span className="grid size-6 place-items-center rounded-full text-white" style={{ background: swatch }}>
              {appearance.palette === id && <Check className="size-3.5" aria-hidden />}
            </span>
            <span className="text-xs">{label}</span>
          </Choice>
        ))}
      </Choices>

      <SectionTitle>Text in chats</SectionTitle>
      <Choices label="Text in chats">
        {CHAT_TEXT_SIZES.map(({ px, label }) => (
          <Choice key={px} checked={appearance.chatText === px} onPick={() => pick({ chatText: px })}>
            <span className="leading-none font-semibold" style={{ fontSize: px }}>
              Aa
            </span>
            <span className="text-xs text-muted-foreground">{label}</span>
          </Choice>
        ))}
      </Choices>

      <Panel className="mt-1">
        <div className="flex justify-end">
          <p className="max-w-[80%] rounded-2xl rounded-br-md bg-secondary px-3.5 py-2 text-(length:--chat-text) leading-relaxed">How does this look?</p>
        </div>
        <p className="text-(length:--chat-text) leading-relaxed">Your messages and your Bots' replies show like this, and so does the message box.</p>
      </Panel>
    </>
  );
}

function Choices({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {children}
    </div>
  );
}

function Choice({ checked, onPick, children }: { checked: boolean; onPick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onPick}
      className={cn(
        "flex min-w-22 flex-col items-center gap-1.5 rounded-lg border bg-card px-3 py-2.5 transition-colors hover:bg-accent",
        checked && "border-primary ring-1 ring-primary",
      )}
    >
      {children}
    </button>
  );
}
