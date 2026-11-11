import { setWindowTheme } from "../platform/desktop";

/** Light, dark, or whatever Windows uses. */
export type ThemeMode = "system" | "light" | "dark";

export const THEME_MODES: Array<{ id: ThemeMode; label: string }> = [
  { id: "system", label: "Like Windows" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

/**
 * Accent colours; each is a `[data-palette]` block in `index.css`. `blue` is Beautiful UI's own and
 * the default, so it has none.
 */
export const PALETTES = [
  { id: "blue", label: "Blue", swatch: "oklch(0.626 0.205 254.947)" },
  { id: "slate", label: "Slate", swatch: "oklch(0.446 0.043 257.281)" },
  { id: "stone", label: "Stone", swatch: "oklch(0.444 0.011 73.639)" },
  { id: "green", label: "Green", swatch: "oklch(0.596 0.145 163.225)" },
  { id: "violet", label: "Violet", swatch: "oklch(0.541 0.281 293.009)" },
] as const;

export type Palette = (typeof PALETTES)[number]["id"];

/** Sizes for the text of messages and the message box, in pixels. */
export const CHAT_TEXT_SIZES = [
  { px: 14, label: "Small" },
  { px: 16, label: "Default" },
  { px: 18, label: "Large" },
  { px: 20, label: "Larger" },
] as const;

export interface Appearance {
  mode: ThemeMode;
  palette: Palette;
  chatText: number;
}

const DEFAULTS: Appearance = { mode: "system", palette: "blue", chatText: 16 };

// The page's own storage, so the development build and the installed app each keep theirs.
const KEY = "unibot.appearance";

export function savedAppearance(): Appearance {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Appearance>;
    return {
      mode: THEME_MODES.some((m) => m.id === saved.mode) ? saved.mode! : DEFAULTS.mode,
      palette: PALETTES.some((p) => p.id === saved.palette) ? saved.palette! : DEFAULTS.palette,
      chatText: CHAT_TEXT_SIZES.some((s) => s.px === saved.chatText) ? saved.chatText! : DEFAULTS.chatText,
    };
  } catch {
    return DEFAULTS;
  }
}

/** Shows the app in `appearance`: `index.css` reads `data-theme`, `data-palette` and `--chat-text`. */
export function applyAppearance({ mode, palette, chatText }: Appearance): void {
  const root = document.documentElement;
  if (mode === "system") delete root.dataset.theme;
  else root.dataset.theme = mode;
  if (palette === "blue") delete root.dataset.palette;
  else root.dataset.palette = palette;
  root.style.setProperty("--chat-text", `${chatText}px`);
  setWindowTheme(mode === "system" ? undefined : mode);
}

export function saveAppearance(appearance: Appearance): void {
  applyAppearance(appearance);
  try {
    localStorage.setItem(KEY, JSON.stringify(appearance));
  } catch {
    // Storage can be off; the look still applies until Unibot closes.
  }
}
