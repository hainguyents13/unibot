import { useEffect, useSyncExternalStore } from "react";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { scheduleInWords, type RoutineList } from "../hermes/routines";
import { Note, Panel, Problem } from "./settings-parts";

const when = new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });

/** A Bot's scheduled jobs: what each does when, a switch to pause it, and Run now. */
export function RoutinesList({ list, botName }: { list: RoutineList; botName: string }) {
  const view = useSyncExternalStore(list.subscribe, list.getView);

  useEffect(() => {
    void list.refresh();
  }, [list]);

  return (
    <div className="flex flex-col gap-3">
      {view.phase.kind === "loading" && <Note>Loading…</Note>}
      {view.phase.kind === "failed" && <Problem>{view.phase.message}</Problem>}
      {view.problem && <Problem>{view.problem}</Problem>}
      {view.phase.kind === "ready" && view.routines.length === 0 && (
        <Note>
          {botName} has no routines. Set them up in the Hermes app or ask {botName} in the chat.
        </Note>
      )}
      <ul className="flex flex-col gap-2" aria-label={`${botName}'s routines`}>
        {view.routines.map((routine) => {
          const running = view.running.includes(routine.id);
          const outcome = view.outcomes[routine.id];
          return (
            <li key={routine.id}>
              <Panel>
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold">{routine.name}</span>
                  <Switch
                    checked={routine.isOn}
                    disabled={routine.isFinished}
                    onCheckedChange={(checked) => void list.setOn(routine, checked)}
                    aria-label={`${routine.isOn ? "Pause" : "Turn on"} ${routine.name}`}
                  />
                </div>
                <Note>
                  {routine.isFinished ? "Finished" : scheduleInWords(routine.schedule)}
                  {routine.isOn && routine.nextRun && !routine.isFinished ? ` · next ${when.format(routine.nextRun)}` : ""}
                  {!routine.isOn && !routine.isFinished ? " · paused" : ""}
                </Note>
                {routine.lastRunFailed && <Problem>Last run failed{routine.lastError ? `: ${routine.lastError}` : "."}</Problem>}
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" size="sm" disabled={running} onClick={() => void list.runNow(routine)}>
                    <Play aria-hidden />
                    {running ? "Running…" : "Run now"}
                  </Button>
                  {outcome && (outcome.succeeded ? <Note>{outcome.message}</Note> : <Problem>{outcome.message}</Problem>)}
                </div>
              </Panel>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
