import type { Bot } from "./types";

/** One row of `profiles.list`: a Hermes profile plus its "Bot Chat" summary. */
interface ProfileRow {
  name?: unknown;
  display_name?: unknown;
  description?: unknown;
  ui_meta?: { "hermes-bots"?: { title?: unknown; hidden?: unknown } | null } | null;
  canonical_session?: { id?: unknown; resolved_id?: unknown; preview?: unknown; last_active?: unknown } | null;
}

/**
 * The sidebar's Bots from a `profiles.list` result, most recent first. Decoding is lenient field by
 * field, so one odd value never empties the whole roster. Bots the user hid are left out.
 */
export function botsFromProfiles(result: unknown): Bot[] {
  const rows = (result as { profiles?: unknown })?.profiles;
  if (!Array.isArray(rows)) return [];
  const bots: Bot[] = [];
  for (const row of rows as ProfileRow[]) {
    if (typeof row?.name !== "string") continue;
    const meta = row.ui_meta?.["hermes-bots"];
    if (meta?.hidden === true) continue;
    const chat = row.canonical_session;
    const lastActive = typeof chat?.last_active === "number" && chat.last_active > 0 ? chat.last_active * 1000 : 0;
    bots.push({
      id: row.name,
      name: firstText(meta?.title, row.display_name) ?? friendlyName(row.name),
      about: firstText(row.description) ?? "",
      preview: firstText(typeof chat?.preview === "string" ? plainPreview(chat.preview) : undefined, row.description) ?? "",
      lastActivity: lastActive,
      status: "idle",
      chatId: firstText(chat?.resolved_id, chat?.id),
    });
  }
  return bots.sort((a, b) => b.lastActivity - a.lastActivity);
}

function firstText(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

/**
 * The name an untitled profile shows, matching the official app: the primary profile, literally
 * called `default`, is "Hermes"; others read as words, so `job-scout` becomes "Job Scout".
 */
export function friendlyName(profile: string): string {
  if (profile.toLowerCase() === "default") return "Hermes";
  const words = profile.split(/[-_]/).filter(Boolean);
  if (words.length === 0) return profile;
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/**
 * Previews are the start of the last message, usually Markdown, cut at 80 characters by the
 * gateway (so bold or code can be left unclosed). The list shows them as plain text.
 */
export function plainPreview(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*|__|~~|`/g, "")
    // Single-marker emphasis, only around words, so `snake_case` and `2 * 3` keep theirs.
    .replace(/(^|[\s(])([*_])(?=\S)(.+?)(?<=\S)\2(?=$|[\s.,;:!?)])/g, "$1$3")
    .trim()
    .replace(/^[#>]+/, "")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}
