import { writeBotTitle } from "./bot-settings";
import type { JsonRpcChannel } from "./json-rpc-channel";

type Rpc = Pick<JsonRpcChannel, "call">;
type Row = Record<string, unknown>;

/** Names Hermes keeps for itself (`hermes_cli.profiles._RESERVED_NAMES`). */
const RESERVED = new Set(["hermes", "default", "test", "tmp", "root", "sudo"]);
const LONGEST = 64;

/**
 * The profile name for a Bot called `name`, as the official app's `slugifyProfileName` makes it, so
 * a Bot gets the same ID here as there. Hermes takes only `^[a-z0-9][a-z0-9_-]{0,63}$`: accented
 * letters fold to their base letter, other letters and digits become `u<hex>` tokens, everything
 * else a dash, and a name too long is cut at a dash so no token is split.
 */
export function botSlug(name: string): string {
  let folded = "";
  for (const character of name.trim().normalize("NFC")) {
    if (!/[\p{L}\p{N}]/u.test(character)) {
      folded += character;
      continue;
    }
    const base = character.normalize("NFKD").replace(/\p{M}/gu, "");
    folded += base && /^[A-Za-z0-9]+$/.test(base) ? base : `-u${[...character].map((c) => c.codePointAt(0)!.toString(16)).join("-u")}-`;
  }
  let slug = "";
  for (const character of folded.toLowerCase()) {
    if (/[a-z0-9_]/.test(character)) slug += character;
    else if (!slug.endsWith("-")) slug += "-";
  }
  slug = slug.replace(/^[-_]+/, "").replace(/-+$/, "");
  if (slug.length <= LONGEST) return slug;
  const cut = slug.slice(0, LONGEST);
  const lastDash = cut.lastIndexOf("-");
  const boundary = slug[LONGEST] === "-" || lastDash < 0 ? LONGEST : lastDash;
  return cut.slice(0, boundary).replace(/-+$/, "");
}

/** Why `name` can't make a Bot yet, in words for the form; undefined when it can. */
export function botNameProblem(name: string, taken: string[]): string | undefined {
  if (!name.trim()) return "Give your Bot a name.";
  const profile = botSlug(name);
  if (!profile) return "Use at least one letter or number in the name.";
  if (RESERVED.has(profile)) return `Hermes keeps the name “${profile}” for itself. Try another name.`;
  if (taken.includes(profile)) return `There's already a Bot called “${profile}” on this gateway. Try another name.`;
  return undefined;
}

/** The official app's starting SOUL.md, less the messaging part the gateway adds by itself. */
export function starterSoul(title: string, profile: string, description: string): string {
  const lines = [`# ${title}`, ""];
  if (description) lines.push(`**Mission:** ${description}`, "");
  lines.push(
    `You are ${title}, a persistent named agent (profile \`${profile}\`) on this machine.`,
    "You keep your own memory, skills, and conversation history across sessions.",
  );
  return lines.join("\n");
}

export interface MadeBot {
  id: string;
  /** Whether it has a model it can reply with; undefined when the gateway can't say. */
  canReply?: boolean;
}

/**
 * Makes a Bot as the official app's New Bot does: a fresh profile with Hermes's bundled skills, the
 * gateway's model and provider keys (`mirror_credentials`, on by default), its sign-ins shared rather
 * than copied (`share_auth`), and a starting SOUL.md. Then the name you typed as its title, and a
 * check, without a model call, that it can reply.
 */
export async function createBot(rpc: Rpc, title: string, description: string): Promise<MadeBot> {
  const name = title.trim();
  const about = description.trim();
  const profile = botSlug(name);
  const params: Row = { name: profile, share_auth: true, soul: starterSoul(name, profile, about) };
  if (about) params.description = about;
  return finish(rpc, (await rpc.call("profiles.create", params, 60_000)) as Row, profile, name);
}

/**
 * Makes a copy of `sourceId` called `title`: Hermes copies its config, keys, SOUL.md, skills and
 * identity (`clone_from`), but not its messaging channels, so two Bots never hold one Telegram bot.
 * Chats, memory and routines stay with the original.
 */
export async function duplicateBot(rpc: Rpc, sourceId: string, title: string, description: string): Promise<MadeBot> {
  const name = title.trim();
  const profile = botSlug(name);
  const params: Row = { name: profile, clone_from: sourceId, share_auth: true };
  if (description.trim()) params.description = description.trim();
  return finish(rpc, (await rpc.call("profiles.create", params, 60_000)) as Row, profile, name);
}

async function finish(rpc: Rpc, result: Row, profile: string, title: string): Promise<MadeBot> {
  const id = typeof result?.name === "string" && result.name ? result.name : profile;
  await writeBotTitle(rpc, id, title);
  const check = (await rpc.call("setup.runtime_check", { profile: id }, 30_000).catch(() => undefined)) as Row | undefined;
  return { id, canReply: typeof check?.ok === "boolean" ? check.ok : undefined };
}
