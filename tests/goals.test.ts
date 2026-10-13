import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calculateGoalStatistics,
  goalBounds,
  type GoalTask
} from "@/nextsignal/services/goal-statistics";
import { occurrencesInRange, rebaseGoalExceptions } from "@/nextsignal/services";
import {
  createGoalInputSchema,
  updateGoalInputSchema,
  createEventInputSchema,
  updateEventInputSchema,
  updateTodoInputSchema
} from "@/nextsignal/schemas";
import type { CalendarEventRecord, CalendarEventExceptionRecord } from "@/db/schema";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EventCardCopy } from "@/app/components/event-card-copy";

const goalA = "b664f2fc-c40f-42ef-a234-6bcde844f43a";
const goalB = "f62b4d23-c09d-43ba-9b69-cee19849e476";
const period = { startsOn: "2026-09-14", endsOn: "2026-09-20", timeZone: "Europe/Oslo" };
function task(startsAt: string | null, endsAt: string | null, id = "task"): GoalTask {
  return { id, kind: "event", title: "Work", startsAt, endsAt };
}
const record: CalendarEventRecord = {
  id: "f36d889d-bba6-46a5-8769-a6c751240fc6",
  goalId: goalA,
  labelId: null,
  title: "Weekly work",
  description: "",
  startsAt: new Date("2026-03-23T09:00:00Z"),
  endsAt: new Date("2026-03-23T10:00:00Z"),
  recurrenceIntervalWeeks: 1,
  recurrenceTimeZone: "Europe/Oslo",
  recurrenceEndsOn: null,
  notificationEnabled: false,
  notificationOffsetMinutes: null,
  notificationMessage: null,
  color: "violet",
  createdAt: new Date(),
  updatedAt: new Date()
};
function exception(
  fields: Partial<CalendarEventExceptionRecord> = {}
): CalendarEventExceptionRecord {
  return {
    id: "e235fae4-7b9f-4a01-bf0d-155586b9180a",
    eventId: record.id,
    occurrenceStartsAt: record.startsAt,
    startsAt: record.startsAt,
    endsAt: record.endsAt,
    goalId: null,
    goalIsOverridden: false,
    labelId: null,
    labelIsOverridden: false,
    title: null,
    description: null,
    color: null,
    notificationEnabled: null,
    notificationOffsetMinutes: null,
    notificationMessage: null,
    isCancelled: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...fields
  };
}

test("goal validation trims titles and rejects empty titles, long descriptions, reversed dates and invalid zones", () => {
  const input = { ...period, title: "  Learn piano  " };
  assert.equal(createGoalInputSchema.parse(input).title, "Learn piano");
  for (const patch of [
    { title: " " },
    { description: "x".repeat(2001) },
    { endsOn: "2026-09-13" },
    { timeZone: "Not/AZone" }
  ]) {
    assert.equal(createGoalInputSchema.safeParse({ ...input, ...patch }).success, false);
  }
  assert.equal(createGoalInputSchema.safeParse({ ...input, endsOn: input.startsOn }).success, true);
});

test("goals can omit both dates or remove an existing range, but cannot save a partial range", () => {
  const input = { title: "Networking master", timeZone: "Europe/Skopje" };
  const goal = createGoalInputSchema.parse(input);
  assert.equal(goal.startsOn, null);
  assert.equal(goal.endsOn, null);
  assert.equal(
    createGoalInputSchema.safeParse({ ...input, startsOn: null, endsOn: null }).success,
    true
  );
  const edited = updateGoalInputSchema.parse({ ...input, id: goalA, startsOn: null, endsOn: null });
  assert.equal(edited.startsOn, null);
  assert.equal(edited.endsOn, null);
  for (const range of [
    { startsOn: "2026-10-13", endsOn: null },
    { startsOn: null, endsOn: "2026-10-13" },
    { startsOn: "2026-10-13" }
  ]) {
    assert.equal(createGoalInputSchema.safeParse({ ...input, ...range }).success, false);
  }
});

test("goals without dates count past and future linked work without date clipping", () => {
  const goal = { startsOn: null, endsOn: null, timeZone: "Europe/Skopje" };
  const stats = calculateGoalStatistics(
    goal,
    [
      task("2025-01-01T09:00:00Z", "2025-01-01T10:00:00Z", "past"),
      task("2026-10-13T09:00:00Z", "2026-10-13T10:00:00Z", "ongoing"),
      task("2027-01-01T09:00:00Z", "2027-01-01T11:00:00Z", "future"),
      task(null, null, "unscheduled"),
      task("2026-10-13T09:00:00Z", null, "durationless")
    ],
    new Date("2026-10-13T09:30:00Z")
  );
  assert.equal(stats.elapsedMinutes, 90);
  assert.equal(stats.plannedMinutes, 150);
  assert.equal(stats.weeks.length, 3);
  assert.equal(stats.tasks.length, 5);
  assert.deepEqual(calculateGoalStatistics(goal, [], new Date()), {
    elapsedMinutes: 0,
    plannedMinutes: 0,
    weeks: [],
    tasks: []
  });
});

test("goals without dates still split weekly contributions across local Monday and DST", () => {
  const stats = calculateGoalStatistics(
    { startsOn: null, endsOn: null, timeZone: "Europe/Skopje" },
    [task("2026-03-29T20:30:00Z", "2026-03-29T22:30:00Z")],
    new Date("2026-04-01T00:00:00Z")
  );
  assert.deepEqual(
    stats.weeks.map((week) => week.elapsedMinutes),
    [90, 30]
  );
});

test("event cards show the goal name in its color in both normal and compact layouts", () => {
  for (const compact of [false, true]) {
    const markup = renderToStaticMarkup(
      createElement(EventCardCopy, {
        title: "Community meetup",
        time: "11:00 AM",
        label: "Networking",
        goal: { title: "Networking master", color: "blue" },
        compact
      })
    );
    assert.match(markup, /event-goal-name/);
    assert.match(markup, /color:#508cce/);
    assert.match(markup, />Networking master</);
    assert.equal(markup.includes("event-label-name"), !compact);
  }
  const markup = renderToStaticMarkup(
    createElement(EventCardCopy, { title: "Coffee", time: "11:00 AM", compact: false })
  );
  assert.doesNotMatch(markup, /event-goal-name|event-metadata/);
});

test("omitted goal fields stay omitted, while explicit null means unlink", () => {
  const event = {
    title: "Legacy event",
    startsAt: "2026-09-15T09:00:00Z",
    endsAt: "2026-09-15T10:00:00Z"
  };
  assert.equal(createEventInputSchema.parse(event).goalId, undefined);
  assert.equal(updateEventInputSchema.parse({ ...event, id: record.id }).goalId, undefined);
  assert.equal(
    updateEventInputSchema.parse({ ...event, id: record.id, goalId: null }).goalId,
    null
  );
  assert.equal(
    updateTodoInputSchema.parse({ action: "update", id: record.id, title: "Legacy todo" }).action,
    "update"
  );
});

test("elapsed and planned time split ongoing tasks without rounding", () => {
  const stats = calculateGoalStatistics(
    period,
    [task("2026-09-16T09:00:00Z", "2026-09-16T10:00:00Z")],
    new Date("2026-09-16T09:30:30Z")
  );
  assert.equal(stats.elapsedMinutes, 30.5);
  assert.equal(stats.plannedMinutes, 29.5);
});

test("inclusive goal dates clip crossing tasks and ignore work outside the period", () => {
  const stats = calculateGoalStatistics(
    period,
    [
      task("2026-09-13T21:00:00Z", "2026-09-13T23:00:00Z", "start"),
      task("2026-09-20T21:30:00Z", "2026-09-20T23:00:00Z", "end"),
      task("2026-09-21T10:00:00Z", "2026-09-21T11:00:00Z", "outside")
    ],
    new Date("2026-10-01T00:00:00Z")
  );
  assert.equal(stats.elapsedMinutes, 90);
  assert.equal(stats.plannedMinutes, 0);
  assert.equal(stats.tasks.find((task) => task.id === "outside")!.elapsedMinutes, 0);
});

test("Monday buckets split crossing tasks in the goal time zone", () => {
  const stats = calculateGoalStatistics(
    { ...period, endsOn: "2026-09-21" },
    [task("2026-09-20T21:30:00Z", "2026-09-20T22:30:00Z")],
    new Date("2026-10-01T00:00:00Z")
  );
  assert.deepEqual(
    stats.weeks.map((week) => week.elapsedMinutes),
    [30, 30]
  );
});

test("DST days count real elapsed hours, not an assumed 24 hours", () => {
  for (const [date, expected] of [
    ["2026-03-29", 23],
    ["2026-10-25", 25]
  ] as const) {
    const goal = { ...period, startsOn: date, endsOn: date };
    const bounds = goalBounds(goal);
    assert.ok(bounds.start && bounds.end);
    const stats = calculateGoalStatistics(
      goal,
      [task(bounds.start.toISOString(), bounds.end.toISOString())],
      new Date("2027-01-01T00:00:00Z")
    );
    assert.equal(stats.elapsedMinutes, expected * 60);
  }
});

test("overlapping tasks add independently; unscheduled and durationless todos add zero", () => {
  const scheduled = task("2026-09-16T09:00:00Z", "2026-09-16T10:00:00Z");
  const stats = calculateGoalStatistics(
    period,
    [
      scheduled,
      { ...scheduled, id: "todo", kind: "todo" },
      task(null, null),
      task(scheduled.startsAt, null)
    ],
    new Date("2026-10-01T00:00:00Z")
  );
  assert.equal(stats.elapsedMinutes, 120);
  assert.equal(stats.tasks.length, 4);
});

test("weekly recurrence preserves local time across DST and inherits series goals", () => {
  const events = occurrencesInRange(
    record,
    new Date("2026-03-23T00:00:00Z"),
    new Date("2026-04-01T00:00:00Z"),
    []
  );
  assert.deepEqual(
    events.map((event) => event.startsAt),
    ["2026-03-23T09:00:00.000Z", "2026-03-30T08:00:00.000Z"]
  );
  assert.ok(events.every((event) => event.goalId === goalA));
});

test("occurrences inherit, reassign or explicitly unlink their goal", () => {
  for (const [override, id, expected] of [
    [false, null, goalA],
    [true, goalB, goalB],
    [true, null, null]
  ] as const) {
    const events = occurrencesInRange(
      record,
      new Date("2026-03-23T00:00:00Z"),
      new Date("2026-03-24T00:00:00Z"),
      [exception({ goalIsOverridden: override, goalId: id })]
    );
    assert.equal(events[0].goalId, expected);
  }
});

test("cancelled occurrences disappear, moved occurrences enter or leave ranges once", () => {
  const from = new Date("2026-03-23T00:00:00Z");
  const until = new Date("2026-03-24T00:00:00Z");
  assert.equal(
    occurrencesInRange(record, from, until, [exception({ isCancelled: true })]).length,
    0
  );
  const moved = exception({
    startsAt: new Date("2026-03-25T09:00:00Z"),
    endsAt: new Date("2026-03-25T10:00:00Z"),
    goalIsOverridden: true,
    goalId: goalB
  });
  assert.equal(occurrencesInRange(record, from, until, [moved]).length, 0);
  const movedIn = occurrencesInRange(
    record,
    new Date("2026-03-25T00:00:00Z"),
    new Date("2026-03-26T00:00:00Z"),
    [moved]
  );
  assert.equal(movedIn.length, 1);
  assert.equal(movedIn[0].goalId, goalB);
});

test("moving a series rebases goal override keys without creating duplicate occurrences", () => {
  const movedStart = new Date("2026-03-30T08:00:00Z");
  const overrides = rebaseGoalExceptions(
    record,
    [exception({ goalIsOverridden: true, goalId: null })],
    movedStart,
    60 * 60_000,
    1,
    "Europe/Oslo"
  );
  const movedSeries = { ...record, startsAt: movedStart, endsAt: new Date("2026-03-30T09:00:00Z") };
  const events = occurrencesInRange(
    movedSeries,
    new Date("2026-03-01T00:00:00Z"),
    new Date("2026-04-07T00:00:00Z"),
    overrides
  );
  assert.equal(events.length, 2);
  assert.equal(events[0].goalId, null);
  assert.equal(events[1].goalId, goalA);
  assert.equal(events[0].startsAt, "2026-03-30T08:00:00.000Z");
});
