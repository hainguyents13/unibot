import type { BotStatus } from "../hermes/types";
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
}

export function ContactList({ label, rows, selectedId, now, avatar, onSelect }: ContactListProps) {
  return (
    <ul className="bot-list" aria-label={label}>
      {rows.map((row) => {
        const badge = statusLabel[row.status];
        return (
          <li key={row.id}>
            <button
              type="button"
              className="bot-row"
              aria-current={row.id === selectedId ? "true" : undefined}
              onClick={() => onSelect(row.id)}
            >
              <span className="avatar" aria-hidden="true">
                {avatar ? avatar(row) : row.name.slice(0, 1)}
              </span>
              <span className="bot-text">
                <span className="bot-line">
                  <span className="bot-name">{row.name}</span>
                  <span className="bot-time">{relativeTime(row.lastActivity, now)}</span>
                </span>
                {(row.preview || badge) && (
                  <span className="bot-line">
                    <span className="bot-preview">{row.preview}</span>
                    {badge && <span className={`badge badge-${row.status}`}>{badge}</span>}
                  </span>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
