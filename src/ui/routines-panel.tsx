import { useEffect, useSyncExternalStore } from "react";
import { scheduleInWords, type RoutineList } from "../hermes/routines";

const when = new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });

/** A Bot's scheduled jobs: what each does when, a switch to pause it, and Run now. */
export function RoutinesPanel({ list, botName, onClose }: { list: RoutineList; botName: string; onClose(): void }) {
  const view = useSyncExternalStore(list.subscribe, list.getView);

  useEffect(() => {
    void list.refresh();
  }, [list]);

  return (
    <aside className="side-panel" aria-label={`${botName}'s routines`}>
      <header className="side-panel-header">
        <h2>Routines</h2>
        <button type="button" aria-label="Close routines" onClick={onClose}>
          ×
        </button>
      </header>
      {view.phase.kind === "loading" && <p className="card-note">Loading…</p>}
      {view.phase.kind === "failed" && (
        <p className="problem" role="alert">
          {view.phase.message}
        </p>
      )}
      {view.problem && (
        <p className="problem" role="alert">
          {view.problem}
        </p>
      )}
      {view.phase.kind === "ready" && view.routines.length === 0 && (
        <p className="card-note">{botName} has no routines. Set them up in the Hermes app or ask {botName} in the chat.</p>
      )}
      <ul className="routines">
        {view.routines.map((routine) => {
          const running = view.running.includes(routine.id);
          const outcome = view.outcomes[routine.id];
          return (
            <li key={routine.id} className="routine">
              <div className="routine-top">
                <span className="routine-name">{routine.name}</span>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={routine.isOn}
                    disabled={routine.isFinished}
                    onChange={(e) => void list.setOn(routine, e.target.checked)}
                    aria-label={`${routine.isOn ? "Pause" : "Turn on"} ${routine.name}`}
                  />
                  <span aria-hidden="true" />
                </label>
              </div>
              <p className="card-note">
                {routine.isFinished ? "Finished" : scheduleInWords(routine.schedule)}
                {routine.isOn && routine.nextRun && !routine.isFinished ? ` · next ${when.format(routine.nextRun)}` : ""}
                {!routine.isOn && !routine.isFinished ? " · paused" : ""}
              </p>
              {routine.lastRunFailed && <p className="routine-failed">Last run failed{routine.lastError ? `: ${routine.lastError}` : "."}</p>}
              <div className="card-actions">
                <button type="button" disabled={running} onClick={() => void list.runNow(routine)}>
                  {running ? "Running…" : "Run now"}
                </button>
                {outcome && <span className={outcome.succeeded ? "card-note" : "routine-failed"}>{outcome.message}</span>}
              </div>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
