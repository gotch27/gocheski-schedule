import assert from "node:assert/strict";
import nextEnv from "@next/env";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Result } from "@gotch/nextsignal";
import {
  services,
  type CalendarEvent,
  type CalendarTodo,
  type CalendarToBuyItem
} from "@/nextsignal/services";

nextEnv.loadEnvConfig(process.cwd());
const endpoint = process.env.MCP_TEST_URL;
const token = process.env.MCP_TEST_TOKEN;
const connectionString = process.env.NEXTSIGNAL_DATABASE__URL;
if (!endpoint || !token || !connectionString) {
  throw new Error(
    "Set MCP_TEST_URL, MCP_TEST_TOKEN, and NEXTSIGNAL_DATABASE__URL for an explicitly selected test server and its database."
  );
}
const client = new Client({ name: "schedule-integration", version: "1.0.0" });
const prefix = `MCP integration ${Date.now()}`;
const events: string[] = [],
  todos: string[] = [],
  purchases: string[] = [],
  goals: string[] = [],
  labels: string[] = [];
const exercised = new Set<string>();
const range = {
  weekStart: "2026-03-23T00:00:00Z",
  weekEnd: "2026-04-13T00:00:00Z"
};

async function call<T>(name: string, args: Record<string, unknown>, expectedOk = true): Promise<T> {
  exercised.add(name);
  const result = CallToolResultSchema.parse(await client.callTool({ name, arguments: args }));
  const envelope = result.structuredContent as unknown as Result<T> | undefined;
  if (!expectedOk) {
    assert.equal(result.isError, true);
    return envelope?.data as T;
  }
  assert.equal(result.isError, false, JSON.stringify(result.content));
  assert.equal(envelope?.ok, true, JSON.stringify(result.content));
  return envelope!.data as T;
}

try {
  assert.equal((await fetch(endpoint, { method: "POST" })).status, 401);
  await client.connect(
    new StreamableHTTPClientTransport(new URL(endpoint), {
      requestInit: { headers: { authorization: `Bearer ${token}` } }
    })
  );
  const discovered = (await client.listTools()).tools;
  assert.equal(discovered.length, 22);
  await call("get_calendar_context", {});

  const created = await call<CalendarEvent>("create_event", {
    title: `${prefix} recurring`,
    description: "Original notes",
    startsAt: "2026-03-23T09:00:00Z",
    endsAt: "2026-03-23T10:00:00Z",
    timeZone: "Europe/Skopje",
    recurrenceIntervalWeeks: 1,
    recurrenceEndsOn: "2026-04-06"
  });
  events.push(created.id);

  // Simulate existing UI assignments without exposing goal or label MCP tools.
  const goal = await services.goals.create(connectionString, {
    title: `${prefix} goal`,
    description: "",
    startsOn: null,
    endsOn: null,
    timeZone: "Europe/Skopje",
    achieved: false,
    color: "green"
  });
  goals.push(goal.id);
  const label = await services.labels.create(connectionString, {
    name: `${prefix} label`,
    color: "#123456"
  });
  labels.push(label.id);
  await services.events.update(connectionString, {
    ...created,
    scope: "series",
    goalId: goal.id,
    labelId: label.id,
    color: label.color
  });

  const schedule = await call<{ events: CalendarEvent[] }>("get_schedule", range);
  const instances = schedule.events.filter((event) => event.id === created.id);
  assert.deepEqual(
    instances.map((event) => event.startsAt),
    ["2026-03-23T09:00:00.000Z", "2026-03-30T08:00:00.000Z", "2026-04-06T08:00:00.000Z"]
  );
  await call("update_event", { id: created.id, title: "Missing scope" }, false);
  await call(
    "update_event",
    {
      id: created.id,
      scope: "occurrence",
      occurrenceStartsAt: "2026-03-24T09:00:00Z",
      title: "Invalid occurrence"
    },
    false
  );
  const edited = await call<CalendarEvent>("update_event", {
    id: created.id,
    scope: "occurrence",
    occurrenceStartsAt: instances[1].occurrenceStartsAt,
    title: `${prefix} occurrence`
  });
  assert.equal(edited.goalId, goal.id);
  assert.equal(edited.labelId, label.id);
  assert.equal(edited.description, "Original notes");
  const moved = await call<CalendarEvent>("move_event", {
    id: created.id,
    scope: "occurrence",
    occurrenceStartsAt: instances[1].occurrenceStartsAt,
    startsAt: "2026-03-31T08:00:00Z"
  });
  assert.equal(moved.endsAt, "2026-03-31T09:00:00.000Z");
  assert.equal(moved.occurrenceStartsAt, instances[1].occurrenceStartsAt);
  const fetched = await call<CalendarEvent>("get_event", {
    id: created.id,
    occurrenceStartsAt: instances[1].occurrenceStartsAt
  });
  assert.equal(fetched.title, `${prefix} occurrence`);
  assert.equal(fetched.startsAt, moved.startsAt);
  const duplicate = await call<CalendarEvent>("duplicate_event", {
    id: created.id,
    occurrenceStartsAt: instances[1].occurrenceStartsAt,
    startsAt: "2026-04-01T08:00:00Z"
  });
  events.push(duplicate.id);
  assert.equal(duplicate.recurrenceIntervalWeeks, null);
  assert.equal(duplicate.goalId, goal.id);
  assert.equal(duplicate.labelId, label.id);
  await call("delete_event", {
    id: created.id,
    scope: "occurrence",
    occurrenceStartsAt: instances[2].occurrenceStartsAt
  });
  const afterCancel = await call<{ events: CalendarEvent[] }>("get_schedule", range);
  assert.equal(afterCancel.events.filter((event) => event.id === created.id).length, 2);

  const seriesMove = await call<CalendarEvent>("move_event", {
    id: created.id,
    scope: "series",
    occurrenceStartsAt: instances[1].occurrenceStartsAt,
    startsAt: "2026-03-30T09:00:00Z"
  });
  assert.equal(
    seriesMove.title,
    created.title,
    "Series edit must not promote occurrence content to the master"
  );
  assert.equal(seriesMove.recurrenceAnchorStartsAt, "2026-03-23T10:00:00.000Z");
  assert.equal(seriesMove.recurrenceTimeZone, "Europe/Skopje");
  assert.equal(seriesMove.goalId, goal.id);
  const updatedSeries = await call<{ events: CalendarEvent[] }>("get_schedule", range);
  assert.deepEqual(
    updatedSeries.events.filter((event) => event.id === created.id).map((event) => event.startsAt),
    ["2026-03-23T10:00:00.000Z", "2026-03-30T09:00:00.000Z", "2026-04-06T09:00:00.000Z"]
  );

  const todo = await call<CalendarTodo>("create_todo", {
    title: `${prefix} todo`,
    description: "Keep these notes",
    estimatedMinutes: 45
  });
  todos.push(todo.id);
  await services.todos.update(connectionString, {
    action: "update",
    id: todo.id,
    title: todo.title,
    description: todo.description,
    estimatedMinutes: 45,
    goalId: goal.id
  });
  const [updatedTodo] = await call<CalendarTodo[]>("update_todo", {
    id: todo.id,
    title: `${prefix} updated todo`
  });
  assert.equal(updatedTodo.description, "Keep these notes");
  assert.equal(updatedTodo.estimatedMinutes, 45);
  assert.equal(updatedTodo.goalId, goal.id);
  await call("schedule_todo", { id: todo.id, scheduledAt: "2026-03-23T23:30:00+01:00" }, false);
  await call("schedule_todo", {
    id: todo.id,
    scheduledAt: "2026-03-23T11:00:00+01:00"
  });
  const scheduledTodos = await call<{ scheduled: CalendarTodo[] }>("list_todos", {
    ...range,
    placement: "scheduled"
  });
  assert.equal(scheduledTodos.scheduled.find((item) => item.id === todo.id)?.goalId, goal.id);
  await call("unschedule_todo", { id: todo.id });
  const backlog = await call<{ backlog: CalendarTodo[] }>("list_todos", range);
  const todoOrder = backlog.backlog.map((item) => item.id);
  await call("reorder_todos", { orderedIds: [...todoOrder, todo.id] }, false);
  await call("reorder_todos", { orderedIds: todoOrder });

  const purchase = await call<CalendarToBuyItem>("create_to_buy_item", {
    title: `${prefix} buy`,
    description: "Keep purchase notes",
    url: "https://example.com/item"
  });
  purchases.push(purchase.id);
  const [updatedPurchase] = await call<CalendarToBuyItem[]>("update_to_buy_item", {
    id: purchase.id,
    title: `${prefix} updated buy`
  });
  assert.equal(updatedPurchase.url, purchase.url);
  assert.equal(updatedPurchase.description, purchase.description);
  await call("schedule_to_buy_item", {
    id: purchase.id,
    scheduledAt: "2026-03-24T12:00:00+01:00"
  });
  const scheduledPurchases = await call<{ scheduled: CalendarToBuyItem[] }>("list_to_buy_items", {
    ...range,
    placement: "scheduled"
  });
  assert.ok(scheduledPurchases.scheduled.some((item) => item.id === purchase.id));
  await call("unschedule_to_buy_item", { id: purchase.id });
  const toBuy = await call<{ list: CalendarToBuyItem[] }>("list_to_buy_items", range);
  await call("reorder_to_buy_items", {
    orderedIds: toBuy.list.map((item) => item.id)
  });

  await call("delete_to_buy_item", { id: purchase.id });
  await call("delete_todo", { id: todo.id });
  await call("delete_event", { id: duplicate.id });
  await call("delete_event", { id: created.id, scope: "series" });
  assert.equal(await services.events.findSeries(connectionString, created.id), null);
  assert.equal(await services.todos.find(connectionString, todo.id), null);
  assert.equal(await services.toBuyItems.find(connectionString, purchase.id), null);
  assert.deepEqual([...exercised].sort(), discovered.map((tool) => tool.name).sort());
  console.log(
    "MCP HTTP integration passed: all 22 tools, authenticated transport, CRUD, partial edits, recurring scopes, DST, association preservation, and validation."
  );
} finally {
  await client.close();
  // Direct service cleanup avoids reminder reconciliation and removes only this run's fixtures.
  for (const id of events) await services.events.delete(connectionString, { id, scope: "series" });
  for (const id of todos) await services.todos.delete(connectionString, id);
  for (const id of purchases) await services.toBuyItems.delete(connectionString, { id });
  for (const id of goals) await services.goals.delete(connectionString, id);
  for (const id of labels) await services.labels.delete(connectionString, id);
}
