/** A skill or command the `/` menu offers. */
export interface SlashCommand {
  /** With its slash, e.g. `/web-research`. */
  name: string;
  description: string;
  /** A skill loads one of the Bot's skills for the message after it; a command is a quick, plugin or built-in one. */
  kind: "skill" | "command";
}

/**
 * Hermes built-ins left out of the menu although the official app offers them: they would switch,
 * rename or split the Bot's one chat (which the app finds by its title), or style a terminal.
 */
const NOT_IN_MESSENGER = new Set([
  "/new", "/resume", "/sessions", "/branch", "/title", "/handoff", "/import", "/profile",
  "/skin", "/pet", "/hatch", "/palette", "/timestamps", "/suggestions",
]);

/**
 * Commands that need handling of their own, which Unibot doesn't have yet: side questions and
 * background tasks answer outside the transcript, and `/reasoning` has to change the live chat.
 */
const NOT_YET = new Set(["/btw", "/bg", "/background", "/reasoning"]);

/**
 * The menu from `commands.catalog`: the Bot's skills, its quick and plugin commands, and Hermes's
 * built-ins that make sense here. Built-ins with a `desktop` reason are terminal-only, settings or
 * advanced in the official app, so they stay out here too.
 */
export function commandsFromCatalog(catalog: unknown): SlashCommand[] {
  const c = catalog as { pairs?: unknown; skills?: unknown; commands?: unknown } | null;
  if (!Array.isArray(c?.pairs)) return [];
  const skills = new Set(c.skills && typeof c.skills === "object" ? Object.keys(c.skills) : []);
  const registry = (c.commands && typeof c.commands === "object" ? c.commands : {}) as Record<string, { desktop?: unknown }>;
  const seen = new Set<string>();
  const result: SlashCommand[] = [];
  for (const pair of c.pairs) {
    if (!Array.isArray(pair) || typeof pair[0] !== "string") continue;
    const name = pair[0];
    if (!name.startsWith("/") || seen.has(name)) continue;
    seen.add(name);
    const description = typeof pair[1] === "string" ? pair[1] : "";
    if (skills.has(name)) {
      result.push({ name, description, kind: "skill" });
      continue;
    }
    if (NOT_YET.has(name)) continue;
    const meta = registry[name];
    if (meta && (typeof meta.desktop === "string" || NOT_IN_MESSENGER.has(name))) continue;
    result.push({ name, description, kind: "command" });
  }
  return result;
}

/** The menu command a message starts with, if any. */
export function commandIn(text: string, commands: SlashCommand[]): SlashCommand | undefined {
  if (!text.startsWith("/")) return undefined;
  const name = text.split(/\s/, 1)[0].toLowerCase();
  return commands.find((c) => c.name.toLowerCase() === name);
}

/** What the menu shows while you type `query` (the text so far, starting with `/`). */
export function matchingCommands(query: string, commands: SlashCommand[]): SlashCommand[] {
  if (!query.startsWith("/") || /\s/.test(query)) return [];
  const typed = query.toLowerCase();
  const starts = commands.filter((c) => c.name.toLowerCase().startsWith(typed));
  const contains = commands.filter((c) => !starts.includes(c) && c.name.toLowerCase().includes(typed.slice(1)));
  return [...starts, ...contains];
}
