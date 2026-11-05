import { describe, expect, it } from "vitest";
import { GatewayError } from "./gateway-error";
import { RoutineList, routineFrom, scheduleInWords, type GatewayRequest } from "./routines";

describe("routineFrom", () => {
  it("reads a job, its schedule and how its last run went", () => {
    expect(
      routineFrom({
        id: "j1",
        name: "Morning brief",
        schedule: { kind: "cron", expr: "0 9 * * 1-5", display: "0 9 * * 1-5" },
        enabled: true,
        state: "scheduled",
        next_run_at: "2026-11-05T09:00:00.123456+07:00",
        last_status: "error",
        last_error: "Model quota exceeded",
      }),
    ).toEqual({
      id: "j1",
      name: "Morning brief",
      schedule: "0 9 * * 1-5",
      isOn: true,
      isFinished: false,
      nextRun: Date.parse("2026-11-05T09:00:00.123+07:00"),
      lastRun: undefined,
      lastRunFailed: true,
      lastError: "Model quota exceeded",
    });
  });

  it("treats a paused or disabled job as off, and names an unnamed one by its prompt", () => {
    expect(routineFrom({ id: "a", state: "paused", prompt: "Check prices" })).toMatchObject({ isOn: false, name: "Check prices" });
    expect(routineFrom({ id: "b", enabled: false })).toMatchObject({ isOn: false });
    expect(routineFrom({ name: "no id" })).toBeUndefined();
  });
});

describe("scheduleInWords", () => {
  it.each([
    ["0 9 * * 1-5", "Weekdays at 9:00 AM"],
    ["30 18 * * *", "Every day at 6:30 PM"],
    ["0 8 * * mon", "Every Monday at 8:00 AM"],
    ["0 7 1 * *", "Monthly on the 1st at 7:00 AM"],
    ["*/15 * * * *", "Every 15 minutes"],
    ["0 */6 * * *", "Every 6 hours"],
    ["every 120m", "Every 2 hours"],
    ["every 1440m", "Every day"],
    ["every monday 9am", "Every monday 9am"],
  ])("%s reads %s", (schedule, words) => {
    expect(scheduleInWords(schedule, "en-US")).toBe(words);
  });
});

describe("RoutineList", () => {
  const job = { id: "j1", name: "Brief", schedule_display: "0 9 * * *", enabled: true };

  function gateway(answers: Record<string, () => unknown>) {
    const calls: string[] = [];
    const request: GatewayRequest = async (path, options) => {
      const key = `${options?.method ?? "GET"} ${path}`;
      calls.push(key);
      const answer = answers[key];
      if (!answer) throw new GatewayError("http", "Not Found", 404);
      return answer();
    };
    return { request, calls };
  }

  it("loads a Bot's routines for its profile", async () => {
    const { request, calls } = gateway({ "GET /api/cron/jobs?profile=job%20scout": () => [job] });
    const list = new RoutineList("job scout", request);
    await list.refresh();
    expect(calls).toEqual(["GET /api/cron/jobs?profile=job%20scout"]);
    expect(list.getView().routines.map((r) => r.name)).toEqual(["Brief"]);
  });

  it("pauses at once and puts the switch back with the gateway's reason when refused", async () => {
    const { request } = gateway({
      "GET /api/cron/jobs?profile=ops": () => [job],
      "POST /api/cron/jobs/j1/pause?profile=ops": () => {
        throw new GatewayError("http", "Job is locked", 423);
      },
    });
    const list = new RoutineList("ops", request);
    await list.refresh();
    const pausing = list.setOn(list.getView().routines[0], false);
    expect(list.getView().routines[0].isOn).toBe(false);
    await pausing;
    expect(list.getView().routines[0].isOn).toBe(true);
    expect(list.getView().problem).toBe("Couldn't pause “Brief”: Job is locked");
  });

  it("runs now, holding the routine as running until the gateway answers", async () => {
    let finish!: (value: unknown) => void;
    const { request } = gateway({
      "GET /api/cron/jobs?profile=ops": () => [job],
      "POST /api/cron/jobs/j1/trigger?profile=ops": () => new Promise((resolve) => (finish = resolve)),
    });
    const list = new RoutineList("ops", request);
    await list.refresh();
    const run = list.runNow(list.getView().routines[0]);
    await Promise.resolve();
    expect(list.getView().running).toEqual(["j1"]);
    finish({ ...job, last_status: "error", last_error: "Timed out" });
    await run;
    expect(list.getView().running).toEqual([]);
    expect(list.getView().outcomes.j1).toEqual({ succeeded: false, message: "It failed: Timed out" });
  });

  it("says when a routine is already running", async () => {
    const { request } = gateway({
      "GET /api/cron/jobs?profile=ops": () => [job],
      "POST /api/cron/jobs/j1/trigger?profile=ops": () => {
        throw new GatewayError("http", "Already running", 409);
      },
    });
    const list = new RoutineList("ops", request);
    await list.refresh();
    await list.runNow(list.getView().routines[0]);
    expect(list.getView().outcomes.j1).toEqual({ succeeded: false, message: "It's already running." });
  });
});
