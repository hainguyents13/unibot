import { useEffect, useSyncExternalStore } from "react";
import { Play } from "lucide-react";
import TaskRows, { type TaskRow } from "@/components/primitives/TaskRows";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { scheduleInWords, type Routine, type RoutineList } from "../hermes/routines";
import { Note, Problem } from "./settings-parts";

const when = new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });

/**
 * A Bot's scheduled jobs as Beautiful UI's task capsules: how each stands at a glance, and inside,
 * when it runs, a switch to pause it, and Run now.
 */
export function RoutinesList({ list, botName }: { list: RoutineList; botName: string }) {
  const view = useSyncExternalStore(list.subscribe, list.getView);

  useEffect(() => {
    void list.refresh();
  }, [list]);

  const rows: TaskRow[] = view.routines.map((routine) => {
    const running = view.running.includes(routine.id);
    const outcome = view.outcomes[routine.id];
    return {
      key: routine.id,
      label: routine.name,
      amount: routine.isFinished ? "" : scheduleInWords(routine.schedule),
      status: running ? "running" : routine.lastRunFailed ? "failed" : routine.isOn && !routine.isFinished ? "done" : "idle",
      pill: pillFor(routine, running),
      details: (
        <>
          <Detail label="Runs" value={routine.isFinished ? "Finished" : scheduleInWords(routine.schedule)} />
          {routine.isOn && routine.nextRun && !routine.isFinished && <Detail label="Next" value={when.format(routine.nextRun)} />}
          {routine.lastRunFailed && <Problem className="text-[12px]">Last run failed{routine.lastError ? `: ${routine.lastError}` : "."}</Problem>}
          {outcome && (outcome.succeeded ? <Note className="text-[12px]">{outcome.message}</Note> : <Problem className="text-[12px]">{outcome.message}</Problem>)}
          <div className="mt-1 flex items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
              <Switch
                checked={routine.isOn}
                disabled={routine.isFinished}
                onCheckedChange={(checked) => void list.setOn(routine, checked)}
                aria-label={`${routine.isOn ? "Pause" : "Turn on"} ${routine.name}`}
              />
              {routine.isFinished ? "Finished" : routine.isOn ? "On" : "Paused"}
            </label>
            <Button type="button" variant="outline" size="sm" disabled={running} onClick={() => void list.runNow(routine)}>
              <Play aria-hidden />
              {running ? "Running…" : "Run now"}
            </Button>
          </div>
        </>
      ),
    };
  });

  return (
    <div className="flex flex-col gap-3">
      {view.phase.kind === "loading" && <Note role="status">Loading…</Note>}
      {view.phase.kind === "failed" && <Problem>{view.phase.message}</Problem>}
      {view.problem && <Problem>{view.problem}</Problem>}
      {view.phase.kind === "ready" && view.routines.length === 0 && (
        <Note>
          {botName} has no routines. Set them up in the Hermes app or ask {botName} in the chat.
        </Note>
      )}
      {rows.length > 0 && <TaskRows rows={rows} aria-label={`${botName}'s routines`} />}
    </div>
  );
}

function pillFor(routine: Routine, running: boolean): TaskRow["pill"] {
  if (running) return { text: "Running", tone: "neutral" };
  if (routine.lastRunFailed) return { text: "Failed", tone: "red" };
  if (routine.isFinished) return { text: "Finished", tone: "neutral" };
  if (!routine.isOn) return { text: "Paused", tone: "neutral" };
  if (routine.nextRun) return { text: when.format(routine.nextRun), tone: "green" };
  return { text: "On", tone: "green" };
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[12px] text-ink-2">{label}</span>
      <span className="truncate font-mono text-[11.5px] text-ink-3 tabular-nums">{value}</span>
    </div>
  );
}
