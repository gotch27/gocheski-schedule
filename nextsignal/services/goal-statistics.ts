import { dateKeyInTimeZone, zonedTimeToDate } from "@/nextsignal/services/calendar-time";

export type GoalPeriod = { startsOn: string | null; endsOn: string | null; timeZone: string };
export type GoalTask = {
  id: string;
  kind: "event" | "todo";
  title: string;
  startsAt: string | null;
  endsAt: string | null;
};
export type GoalStatistics = {
  elapsedMinutes: number;
  plannedMinutes: number;
  weeks: { startsOn: string; elapsedMinutes: number; plannedMinutes: number }[];
  tasks: (GoalTask & { elapsedMinutes: number; plannedMinutes: number })[];
};

export function shiftDateKey(key: string, days: number) {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export function goalMidnight(key: string, timeZone: string) {
  const [year, month, day] = key.split("-").map(Number);
  return zonedTimeToDate({ year, month, day, hour: 0, minute: 0, second: 0 }, timeZone);
}
export function goalBounds(goal: GoalPeriod) {
  return {
    start: goal.startsOn ? goalMidnight(goal.startsOn, goal.timeZone) : null,
    end: goal.endsOn ? goalMidnight(shiftDateKey(goal.endsOn, 1), goal.timeZone) : null
  };
}

/** Each task is counted independently; overlapping work is intentionally additive. */
export function calculateGoalStatistics(
  goal: GoalPeriod,
  tasks: GoalTask[],
  now: Date
): GoalStatistics {
  const { start, end } = goalBounds(goal);
  const from = start?.getTime() ?? -Infinity;
  const until = end?.getTime() ?? Infinity;
  const current = now.getTime();
  const totals = (a: number, b: number) => ({
    elapsedMinutes: Math.max(0, Math.min(b, current) - a) / 60_000,
    plannedMinutes: Math.max(0, b - Math.max(a, current)) / 60_000
  });
  const weeks: GoalStatistics["weeks"] = [];
  if (goal.startsOn && goal.endsOn) {
    const dayOfWeek = new Date(`${goal.startsOn}T12:00:00Z`).getUTCDay();
    for (
      let key = shiftDateKey(goal.startsOn, -(dayOfWeek === 0 ? 6 : dayOfWeek - 1));
      key <= goal.endsOn;
      key = shiftDateKey(key, 7)
    ) {
      weeks.push({ startsOn: key, elapsedMinutes: 0, plannedMinutes: 0 });
    }
  }
  const byWeek = new Map(weeks.map((week) => [week.startsOn, week]));
  const counted = tasks.map((task) => {
    const a = Math.max(from, task.startsAt ? new Date(task.startsAt).getTime() : Infinity);
    const b = Math.min(until, task.endsAt ? new Date(task.endsAt).getTime() : -Infinity);
    if (b <= a) return { ...task, elapsedMinutes: 0, plannedMinutes: 0 };
    let cursor = a;
    while (cursor < b) {
      const key = dateKeyInTimeZone(new Date(cursor), goal.timeZone);
      const day = new Date(`${key}T12:00:00Z`).getUTCDay();
      const monday = shiftDateKey(key, -(day === 0 ? 6 : day - 1));
      const next = Math.min(b, goalMidnight(shiftDateKey(monday, 7), goal.timeZone).getTime());
      let bucket = byWeek.get(monday);
      if (!bucket) {
        bucket = { startsOn: monday, elapsedMinutes: 0, plannedMinutes: 0 };
        byWeek.set(monday, bucket);
        weeks.push(bucket);
      }
      const value = totals(cursor, next);
      bucket.elapsedMinutes += value.elapsedMinutes;
      bucket.plannedMinutes += value.plannedMinutes;
      cursor = next;
    }
    return { ...task, ...totals(a, b) };
  });
  return {
    elapsedMinutes: counted.reduce((sum, task) => sum + task.elapsedMinutes, 0),
    plannedMinutes: counted.reduce((sum, task) => sum + task.plannedMinutes, 0),
    weeks: weeks.sort((a, b) => a.startsOn.localeCompare(b.startsOn)),
    tasks: counted.sort((a, b) => (a.startsAt ?? "9999").localeCompare(b.startsAt ?? "9999"))
  };
}
