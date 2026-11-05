import { describeError, isGatewayError } from "./gateway-error";

/** A scheduled job a Bot runs on its own (a Hermes cron job). */
export interface Routine {
  id: string;
  name: string;
  /** How the gateway describes the schedule, e.g. "every monday at 9am" or "0 9 * * 1". */
  schedule: string;
  /** Runs on schedule; false while paused. */
  isOn: boolean;
  /** Finished for good, e.g. a one-off that already ran. */
  isFinished: boolean;
  /** Milliseconds since the epoch. */
  nextRun?: number;
  lastRun?: number;
  lastRunFailed: boolean;
  /** Why the last run failed, in the gateway's words. */
  lastError?: string;
}

type Row = Record<string, unknown>;
const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);

/** Reads one job from `/api/cron/jobs`. `undefined` for anything without an ID. */
export function routineFrom(job: unknown): Routine | undefined {
  const row = job as Row;
  const id = str(row?.id);
  if (!id) return undefined;
  const schedule = row.schedule as Row | undefined;
  const state = str(row.state);
  const failed = ["error", "failed"].includes(str(row.last_status) ?? "") || state === "error";
  return {
    id,
    name: str(row.name) ?? str(row.prompt) ?? id,
    schedule: str(row.schedule_display) ?? str(schedule?.display) ?? str(schedule?.expr) ?? "",
    isOn: row.enabled !== false && state !== "paused",
    isFinished: state === "completed",
    nextRun: parseDate(row.next_run_at),
    lastRun: parseDate(row.last_run_at),
    lastRunFailed: failed,
    lastError: failed ? str(row.last_error) : undefined,
  };
}

/** Python's `isoformat()`; JavaScript reads it once the microseconds are cut to milliseconds. */
function parseDate(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const ms = Date.parse(value.replace(/(\.\d{3})\d+/, "$1"));
  return Number.isNaN(ms) ? undefined : ms;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEKDAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/**
 * "Weekdays at 9:00 AM" for "0 9 * * 1-5", "Every 2 hours" for "every 120m". Phrases the gateway
 * kept as typed, like "every monday 9am", come back capitalised.
 */
export function scheduleInWords(schedule: string, locale?: string): string {
  const text = schedule.trim();
  const interval = /^every (\d+)m$/.exec(text);
  if (interval) return intervalWords(Number(interval[1]));
  return cronWords(text, locale) ?? text.charAt(0).toUpperCase() + text.slice(1);
}

function intervalWords(minutes: number): string {
  if (minutes % 1440 === 0) return minutes === 1440 ? "Every day" : `Every ${minutes / 1440} days`;
  if (minutes % 60 === 0) return minutes === 60 ? "Every hour" : `Every ${minutes / 60} hours`;
  return minutes === 1 ? "Every minute" : `Every ${minutes} minutes`;
}

function cronWords(text: string, locale?: string): string | undefined {
  const fields = text.split(/\s+/);
  if (fields.length !== 5 || !fields.every((f) => /^[A-Za-z\d*\-,/]+$/.test(f))) return undefined;
  const [minute, hour, day, month, weekday] = fields;
  if (month !== "*") return undefined;
  if (hour === "*" && day === "*" && weekday === "*") {
    if (minute === "0") return "Every hour";
    const step = /^\*\/(\d+)$/.exec(minute);
    return step ? `Every ${step[1]} minutes` : undefined;
  }
  const hourStep = /^\*\/(\d+)$/.exec(hour);
  if (minute === "0" && day === "*" && weekday === "*" && hourStep) return `Every ${hourStep[1]} hours`;
  const m = Number(minute);
  const h = Number(hour);
  if (!/^\d+$/.test(minute) || !/^\d+$/.test(hour) || m > 59 || h > 23) return undefined;
  const time = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(Date.UTC(2000, 0, 1, h, m));
  if (day === "*" && weekday === "*") return `Every day at ${time}`;
  if (day === "*" && /^(1-5|mon-fri)$/i.test(weekday)) return `Weekdays at ${time}`;
  if (day === "*" && /^(0,6|6,0|sat,sun)$/i.test(weekday)) return `Weekends at ${time}`;
  if (day === "*") {
    const index = WEEKDAY_NAMES.indexOf(weekday.toLowerCase());
    const n = index >= 0 ? index : /^[0-7]$/.test(weekday) ? Number(weekday) % 7 : -1;
    return n >= 0 ? `Every ${WEEKDAYS[n]} at ${time}` : undefined;
  }
  if (weekday === "*" && /^\d+$/.test(day) && Number(day) >= 1 && Number(day) <= 31) return `Monthly on the ${ordinal(Number(day))} at ${time}`;
  return undefined;
}

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/** How a "Run now" went. */
export interface RunOutcome {
  succeeded: boolean;
  message: string;
}

export interface RoutinesView {
  phase: { kind: "loading" } | { kind: "ready" } | { kind: "failed"; message: string };
  routines: Routine[];
  /** Routines running now because you asked, until the gateway answers. */
  running: string[];
  outcomes: Record<string, RunOutcome>;
  /** Why the last change didn't take. */
  problem?: string;
}

/** Sends one authenticated JSON request to the gateway. */
export type GatewayRequest = (path: string, options?: { method?: string; timeoutMs?: number }) => Promise<unknown>;

/** A run can take many minutes, and the trigger route answers only when it ends. */
const TRIGGER_TIMEOUT_MS = 30 * 60_000;

/** One Bot's routines, read and changed through the gateway's `/api/cron/jobs` routes. */
export class RoutineList {
  private view: RoutinesView = { phase: { kind: "loading" }, routines: [], running: [], outcomes: {} };
  private readonly listeners = new Set<() => void>();
  private refreshing = false;

  constructor(
    private readonly profile: string,
    private readonly request: GatewayRequest | undefined,
  ) {}

  /** A list already showing `routines`, for the demo. Switches and Run now work locally. */
  static demo(profile: string, routines: Routine[]): RoutineList {
    const list = new RoutineList(profile, undefined);
    list.set({ phase: { kind: "ready" }, routines });
    return list;
  }

  getView = (): RoutinesView => this.view;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Reloads the list. Keeps showing the old one if the reload fails. */
  async refresh(): Promise<void> {
    if (!this.request || this.refreshing) return;
    this.refreshing = true;
    try {
      const rows = await this.call("/api/cron/jobs");
      this.set({ phase: { kind: "ready" }, routines: (Array.isArray(rows) ? rows : []).flatMap((r) => routineFrom(r) ?? []) });
    } catch (error) {
      if (this.view.phase.kind !== "ready") this.set({ phase: { kind: "failed", message: describe(error) } });
    } finally {
      this.refreshing = false;
    }
  }

  /** Pauses or resumes a routine. The switch moves at once and moves back if the gateway refuses. */
  async setOn(routine: Routine, on: boolean): Promise<void> {
    this.replace({ ...routine, isOn: on });
    this.set({ problem: undefined });
    if (!this.request) return;
    try {
      const updated = routineFrom(await this.call(`/api/cron/jobs/${encodeURIComponent(routine.id)}/${on ? "resume" : "pause"}`, { method: "POST" }));
      if (updated) this.replace(updated);
    } catch (error) {
      this.replace(routine);
      this.set({ problem: `Couldn't ${on ? "turn on" : "pause"} “${routine.name}”: ${describe(error)}` });
    }
  }

  /**
   * Runs a routine now, in the background: `running` holds it until the gateway answers, which can
   * take minutes, and `outcomes` then says how it went.
   */
  async runNow(routine: Routine): Promise<void> {
    if (this.view.running.includes(routine.id)) return;
    this.set({ running: [...this.view.running, routine.id], outcomes: { ...this.view.outcomes, [routine.id]: undefined! } });
    let outcome: RunOutcome;
    if (!this.request) {
      outcome = { succeeded: true, message: "Finished. The result is in the Bot's chat." };
    } else {
      try {
        const after = routineFrom(await this.call(`/api/cron/jobs/${encodeURIComponent(routine.id)}/trigger`, { method: "POST", timeoutMs: TRIGGER_TIMEOUT_MS })) ?? routine;
        this.replace(after);
        outcome = after.lastRunFailed
          ? { succeeded: false, message: after.lastError ? `It failed: ${after.lastError}` : "It failed." }
          : { succeeded: true, message: "Finished." };
      } catch (error) {
        if (isGatewayError(error, "http") && error.code === 409) outcome = { succeeded: false, message: "It's already running." };
        else if (isGatewayError(error, "timedOut") || isGatewayError(error, "unreachable")) {
          outcome = { succeeded: false, message: "Lost touch with the gateway while it ran. It may still be going." };
        } else outcome = { succeeded: false, message: `Couldn't run it: ${describe(error)}` };
      }
    }
    this.set({ running: this.view.running.filter((id) => id !== routine.id), outcomes: { ...this.view.outcomes, [routine.id]: outcome } });
    void this.refresh();
  }

  private call(route: string, options: { method?: string; timeoutMs?: number } = {}): Promise<unknown> {
    return this.request!(`${route}?profile=${encodeURIComponent(this.profile)}`, options);
  }

  private replace(routine: Routine): void {
    this.set({ routines: this.view.routines.map((r) => (r.id === routine.id ? routine : r)) });
  }

  private set(change: Partial<RoutinesView>): void {
    this.view = { ...this.view, ...change };
    for (const listener of this.listeners) listener();
  }
}

/** The gateway's own reason for a refused change (how to write a schedule, say), without the status. */
function describe(error: unknown): string {
  if (isGatewayError(error, "http") && error.detail && (error.code ?? 0) >= 400 && (error.code ?? 0) < 500) return error.detail;
  return describeError(error);
}
