import assert from "node:assert/strict";
import nextEnv from "@next/env";
import { services } from "@/nextsignal/services";

nextEnv.loadEnvConfig(process.cwd());
const base = process.env.GOALS_TEST_BASE_URL;
const token = process.env.GOALS_TEST_TOKEN;
if (!base || !token)
  throw new Error(
    "Set GOALS_TEST_BASE_URL and GOALS_TEST_TOKEN for an explicitly selected test server."
  );
const url = process.env.NEXTSIGNAL_DATABASE__URL!;
const login = await fetch(`${base}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ token })
});
assert.equal(login.status, 200);
const cookie = login.headers.get("set-cookie")!.split(";")[0];
const goalIds: string[] = [];
const eventIds: string[] = [];
const todoIds: string[] = [];
const labelIds: string[] = [];
const prefix = `Goals integration ${Date.now()}`;
async function request(path: string, method = "GET", input?: unknown) {
  const response = await fetch(`${base}/api/${path}`, {
    method,
    headers: { cookie, "content-type": "application/json" },
    ...(input ? { body: JSON.stringify(input) } : {})
  });
  const payload = await response.json();
  assert.equal(payload.ok, true, JSON.stringify(payload.errors));
  return payload.data;
}
try {
  for (const path of ["goals", "goals/statistics", "labels"]) {
    for (const method of path.endsWith("statistics")
      ? ["GET"]
      : ["GET", "POST", "PATCH", "DELETE"]) {
      assert.equal((await fetch(`${base}/api/${path}`, { method })).status, 401);
    }
  }
  const initial = {
    title: `${prefix} A`,
    description: "Integration fixture",
    startsOn: "2026-03-01",
    endsOn: "2026-04-30",
    timeZone: "Europe/Oslo",
    color: "blue",
    achieved: false
  };
  const { goal: a } = await request("goals", "POST", initial);
  goalIds.push(a.id);
  const { goal: b } = await request("goals", "POST", { ...initial, title: `${prefix} B` });
  goalIds.push(b.id);
  const { goal: edited } = await request("goals", "PATCH", {
    ...a,
    title: `${prefix} A edited`,
    achieved: true,
    timeZone: "UTC"
  });
  assert.equal(edited.achieved, true);
  assert.equal(edited.timeZone, "Europe/Oslo", "Goal time zone is immutable");
  await request("goals", "PATCH", { ...edited, achieved: false });
  const baseEvent = {
    title: `${prefix} event`,
    description: "",
    startsAt: "2026-03-23T09:00:00Z",
    endsAt: "2026-03-23T10:00:00Z",
    recurrenceIntervalWeeks: 1,
    recurrenceTimeZone: "Europe/Oslo",
    recurrenceEndsOn: "2026-04-06",
    color: "violet",
    goalId: a.id
  };
  const { event: created } = await request("events", "POST", baseEvent);
  eventIds.push(created.id);
  assert.equal(created.goalId, a.id);
  const { event: unlinked } = await request("events", "PATCH", {
    ...baseEvent,
    id: created.id,
    occurrenceStartsAt: created.startsAt,
    scope: "occurrence",
    goalId: null
  });
  assert.equal(unlinked.goalId, null);
  const { goalId: _unused, ...withoutGoal } = baseEvent;
  const { event: keptUnlinked } = await request("events", "PATCH", {
    ...withoutGoal,
    id: created.id,
    occurrenceStartsAt: created.startsAt,
    scope: "occurrence",
    title: `${prefix} renamed`
  });
  assert.equal(keptUnlinked.goalId, null, "Omitting a goal preserves explicit unlink");
  await request("events", "PATCH", {
    ...baseEvent,
    id: created.id,
    occurrenceStartsAt: "2026-03-30T08:00:00Z",
    startsAt: "2026-03-30T08:00:00Z",
    endsAt: "2026-03-30T09:00:00Z",
    scope: "occurrence",
    goalId: b.id
  });
  await services.events.delete(url, {
    id: created.id,
    scope: "occurrence",
    occurrenceStartsAt: "2026-04-06T08:00:00Z"
  });
  await request("events", "PATCH", { ...baseEvent, id: created.id, scope: "series", goalId: b.id });
  const { events } = await request(
    "events?weekStart=2026-03-01T00:00:00Z&weekEnd=2026-05-01T00:00:00Z"
  );
  const occurrences = events.filter((event: { id: string }) => event.id === created.id);
  assert.equal(occurrences.length, 2, "Goal-only series changes preserve cancellations");
  assert.equal(occurrences[0].goalId, null);
  assert.equal(occurrences[1].goalId, b.id);
  const { label: networking } = await request("labels", "POST", {
    name: `${prefix} Networking`,
    color: "#508cce"
  });
  labelIds.push(networking.id);
  const { label: fun } = await request("labels", "POST", {
    name: `${prefix} Fun`,
    color: "#e98175"
  });
  labelIds.push(fun.id);
  await request("events", "PATCH", {
    ...baseEvent,
    id: created.id,
    scope: "series",
    goalId: b.id,
    labelId: networking.id
  });
  let labeled = (
    await services.events.list(url, "2026-03-01T00:00:00Z", "2026-05-01T00:00:00Z", false)
  ).filter((event) => event.id === created.id);
  assert.equal(labeled.length, 2, "Label-only series edits preserve cancellations");
  assert.ok(
    labeled.every((event) => event.labelId === networking.id && event.color === networking.color)
  );
  await request("events", "PATCH", {
    ...baseEvent,
    id: created.id,
    occurrenceStartsAt: "2026-03-30T08:00:00Z",
    startsAt: "2026-03-30T08:00:00Z",
    endsAt: "2026-03-30T09:00:00Z",
    scope: "occurrence",
    goalId: b.id,
    labelId: fun.id
  });
  await request("labels", "PATCH", {
    id: networking.id,
    name: `${prefix} Learning`,
    color: "#123456"
  });
  labeled = (
    await services.events.list(url, "2026-03-01T00:00:00Z", "2026-05-01T00:00:00Z", false)
  ).filter((event) => event.id === created.id);
  assert.deepEqual(
    labeled.map((event) => event.color),
    ["#123456", "#e98175"],
    "Recoloring a series label preserves an occurrence's different label"
  );
  await request("labels", "DELETE", { id: networking.id });
  labelIds.splice(labelIds.indexOf(networking.id), 1);
  labeled = (
    await services.events.list(url, "2026-03-01T00:00:00Z", "2026-05-01T00:00:00Z", false)
  ).filter((event) => event.id === created.id);
  assert.equal(labeled.length, 2, "Deleting a label preserves events and cancellations");
  assert.equal(labeled[0].labelId, null);
  assert.equal(labeled[0].color, "#123456");
  assert.equal(labeled[1].labelId, fun.id);
  await request("events", "PATCH", {
    ...withoutGoal,
    id: created.id,
    scope: "series",
    title: `${prefix} series renamed`
  });
  const afterRename = await services.events.list(
    url,
    "2026-03-01T00:00:00Z",
    "2026-05-01T00:00:00Z",
    false
  );
  assert.equal(
    afterRename.find(
      (event) => event.id === created.id && event.occurrenceStartsAt === created.startsAt
    )!.goalId,
    null
  );
  const { todo } = await request("todos", "POST", {
    title: `${prefix} todo`,
    estimatedMinutes: 90,
    goalId: b.id
  });
  todoIds.push(todo.id);
  await request("todos", "PATCH", {
    action: "schedule",
    id: todo.id,
    scheduledAt: "2026-03-25T09:00:00Z"
  });
  await request("todos", "PATCH", {
    action: "update",
    id: todo.id,
    title: `${prefix} resized`,
    estimatedMinutes: 120
  });
  const currentTodos = await services.todos.list(
    url,
    "2026-03-23T00:00:00Z",
    "2026-03-30T00:00:00Z"
  );
  assert.equal(currentTodos.scheduled.find((item) => item.id === todo.id)!.goalId, b.id);
  const { goals: statistics } = await request("goals/statistics");
  const bStats = statistics.find((goal: { id: string }) => goal.id === b.id).statistics;
  assert.equal(bStats.elapsedMinutes, 240, "Two 1h occurrences plus a resized 2h to-do");
  await request("events", "PATCH", {
    ...withoutGoal,
    id: created.id,
    scope: "series",
    title: `${prefix} moved series`,
    startsAt: "2026-03-30T08:00:00Z",
    endsAt: "2026-03-30T09:00:00Z"
  });
  const shifted = (
    await services.events.list(url, "2026-03-01T00:00:00Z", "2026-05-01T00:00:00Z", false)
  ).filter((event) => event.id === created.id);
  assert.equal(shifted.length, 2, "Moving the series must not leave orphan goal exceptions");
  assert.equal(shifted[0].goalId, null);
  assert.equal(shifted[1].goalId, b.id);
  await request("goals", "DELETE", { id: b.id });
  goalIds.splice(goalIds.indexOf(b.id), 1);
  const afterDelete = await services.events.list(
    url,
    "2026-03-01T00:00:00Z",
    "2026-05-01T00:00:00Z",
    false
  );
  assert.ok(
    afterDelete.filter((event) => event.id === created.id).every((event) => event.goalId === null)
  );
  assert.equal(
    (await services.todos.list(url, "2026-03-23T00:00:00Z", "2026-03-30T00:00:00Z")).scheduled.find(
      (item) => item.id === todo.id
    )!.goalId,
    null
  );
  const invalid = await fetch(`${base}/api/todos`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ title: prefix, goalId: b.id })
  });
  assert.equal(
    (await invalid.json()).ok,
    false,
    "A deleted goal is an expected validation failure"
  );
  const { goal: ongoing } = await request("goals", "POST", {
    title: `${prefix} Ongoing`,
    timeZone: "Europe/Oslo"
  });
  goalIds.push(ongoing.id);
  assert.equal(ongoing.startsOn, null);
  assert.equal(ongoing.endsOn, null);
  const dayMs = 86_400_000;
  for (const offset of [-dayMs, dayMs]) {
    const start = new Date(Date.now() + offset);
    const { event } = await request("events", "POST", {
      title: `${prefix} contribution`,
      goalId: ongoing.id,
      startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + 60 * 60_000).toISOString()
    });
    eventIds.push(event.id);
  }
  const allStats = await request("goals/statistics");
  const ongoingStats = allStats.goals.find(
    (goal: { id: string }) => goal.id === ongoing.id
  ).statistics;
  assert.equal(ongoingStats.elapsedMinutes, 60);
  assert.equal(ongoingStats.plannedMinutes, 60);
  console.log(
    "Integration checks passed: auth, goal and label CRUD, optional dates, immutable timezone, recurrence overrides, cancellation preservation, omitted fields, statistics and deletion without task loss."
  );
} finally {
  for (const id of eventIds) await services.events.delete(url, { id, scope: "series" });
  for (const id of todoIds) await services.todos.delete(url, id);
  for (const id of goalIds) await services.goals.delete(url, id);
  for (const id of labelIds) await services.labels.delete(url, id);
  console.log("Integration fixtures removed.");
}
