/** What a Bot is doing, as the sidebar shows it. */
export type BotStatus = "idle" | "working" | "needsYou";

/** One Hermes profile, shown as a contact. */
export interface Bot {
  /** The Hermes profile name. */
  id: string;
  name: string;
  /** What the Bot is for, from its profile. */
  about: string;
  /** The last line of its Bot Chat. */
  preview: string;
  /** Milliseconds since the epoch. */
  lastActivity: number;
  status: BotStatus;
  /** The ID of its Bot Chat on the gateway, when it has one. */
  chatId?: string;
}

/** A group chat with several Bots, as the sidebar lists it. */
export interface RoomEntry {
  id: string;
  name: string;
  memberCount: number;
  /** The newest message, with who said it. */
  preview: string;
  /** Milliseconds since the epoch. */
  lastActivity: number;
  status: BotStatus;
}
