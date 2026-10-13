import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createConfig,
  createNextSignalApp,
  objectConfigProvider,
  type Result
} from "@gotch/nextsignal";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { adapters } from "@/nextsignal/adapters";
import { appConfigSchema } from "@/nextsignal/config";
import { processes } from "@/nextsignal/processes";
import { services, type AppServices, type CalendarEvent } from "@/nextsignal/services";
import { handleCalendarMcpRequest } from "@/nextsignal/mcp/handler";
import { publicResult } from "@/nextsignal/mcp/server";
import { belongsToSeries } from "@/nextsignal/services/occurrence-identity";
import { updateTodoSchema, updateToBuySchema } from "@/nextsignal/mcp/schemas";

const token = "mcp-test-token";
const endpoint = "http://localhost:3000/schedule/api/mcp";
const id = "cc0b5214-7605-4f9f-8625-83daa71bb9fa";
const otherId = "dff7c316-a703-47f0-9faf-5eeb0b6f133c";
const range = {
  weekStart: "2026-03-23T00:00:00Z",
  weekEnd: "2026-03-30T00:00:00Z"
};
const event: CalendarEvent = {
  id,
  title: "Class",
  description: "Keep these notes",
  labelId: otherId,
  goalId: otherId,
  startsAt: "2026-03-23T09:00:00.000Z",
  endsAt: "2026-03-23T10:00:00.000Z",
  recurrenceAnchorStartsAt: "2026-03-23T09:00:00.000Z",
  occurrenceStartsAt: "2026-03-23T09:00:00.000Z",
  recurrenceIntervalWeeks: 1,
  recurrenceTimeZone: "Europe/Skopje",
  recurrenceEndsOn: null,
  occurrenceKey: `${id}:2026-03-23T09:00:00.000Z`,
  isOccurrenceOverride: false,
  notificationEnabled: false,
  notificationOffsetMinutes: null,
  notificationMessage: null,
  notificationAt: null,
  notificationState: "disabled",
  color: "#123456",
  createdAt: "",
  updatedAt: ""
};

function makeApp(overrides: Partial<AppServices> = {}, accessToken = token) {
  return createNextSignalApp({
    processes,
    services: { ...services, ...overrides },
    config: createConfig({
      providers: [
        objectConfigProvider({
          mcp: { access_token: accessToken, time_zone: "Europe/Skopje" }
        })
      ]
    }),
    adapters: { ...adapters, logger: { info() {}, warn() {}, error() {} } }
  });
}

async function connect(app: ReturnType<typeof makeApp>) {
  const client = new Client({ name: "calendar-test", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(endpoint), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
      fetch: (url, init) => handleCalendarMcpRequest(app, new Request(url, init))
    })
  );
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown>) {
  const result = CallToolResultSchema.parse(await client.callTool({ name, arguments: args }));
  return {
    ...result,
    envelope: result.structuredContent as unknown as Result<unknown> | undefined
  };
}

test("HTTP boundary loads config, requires its own bearer token, rejects foreign origins/hosts and disables missing-token deployments", async () => {
  const app = makeApp();
  assert.equal((await handleCalendarMcpRequest(app, new Request(endpoint))).status, 401);
  assert.equal(
    (
      await handleCalendarMcpRequest(
        app,
        new Request(endpoint, {
          headers: { cookie: "goch_admin_session=anything" }
        })
      )
    ).status,
    401
  );
  for (const authorization of ["Bearer wrong", `Basic ${token}`, `Bearer ${token} extra`]) {
    assert.equal(
      (await handleCalendarMcpRequest(app, new Request(endpoint, { headers: { authorization } })))
        .status,
      401
    );
  }
  const headers = { authorization: `Bearer ${token}` };
  assert.equal(
    (
      await handleCalendarMcpRequest(
        app,
        new Request(endpoint, {
          headers: { ...headers, host: "attacker.test" }
        })
      )
    ).status,
    403
  );
  assert.equal(
    (
      await handleCalendarMcpRequest(
        app,
        new Request(endpoint, {
          headers: { ...headers, origin: "https://example.com" }
        })
      )
    ).status,
    403
  );
  assert.equal(
    (
      await handleCalendarMcpRequest(
        app,
        new Request("http://attacker.test/schedule/api/mcp", { headers })
      )
    ).status,
    403
  );
  assert.equal(
    (await handleCalendarMcpRequest(app, new Request(endpoint, { headers }))).status,
    405
  );
  assert.equal(
    (await handleCalendarMcpRequest(makeApp({}, ""), new Request(endpoint, { headers }))).status,
    503
  );
  assert.equal((await app.dispatch("agent.get_calendar_context", {})).meta.kind, "auth");
});

test("application configuration parses environment allowlists as arrays and rejects malformed settings", () => {
  const mcp = {
    access_token: token,
    time_zone: "Europe/Skopje",
    allowed_hosts: '["gocheski.com"]',
    allowed_origins: "[]"
  };
  assert.deepEqual(appConfigSchema.parse({ mcp }).mcp.allowed_hosts, ["gocheski.com"]);
  assert.equal(
    appConfigSchema.safeParse({
      mcp: { ...mcp, allowed_hosts: "gocheski.com" }
    }).success,
    false
  );
  assert.equal(appConfigSchema.safeParse({ mcp: { ...mcp, time_zone: "invalid" } }).success, false);
});

test("official MCP client initializes, discovers exactly 22 tools, and receives structured results", async () => {
  const client = await connect(makeApp());
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map((tool) => tool.name).sort(),
      [
        "get_calendar_context",
        "get_schedule",
        "get_event",
        "create_event",
        "update_event",
        "move_event",
        "duplicate_event",
        "delete_event",
        "list_todos",
        "create_todo",
        "update_todo",
        "schedule_todo",
        "unschedule_todo",
        "reorder_todos",
        "delete_todo",
        "list_to_buy_items",
        "create_to_buy_item",
        "update_to_buy_item",
        "schedule_to_buy_item",
        "unschedule_to_buy_item",
        "reorder_to_buy_items",
        "delete_to_buy_item"
      ].sort()
    );
    assert.equal(
      tools.find((tool) => tool.name === "get_schedule")?.annotations?.readOnlyHint,
      true
    );
    assert.equal(
      tools.find((tool) => tool.name === "delete_event")?.annotations?.destructiveHint,
      true
    );
    const result = await call(client, "get_calendar_context", {});
    assert.equal(result.isError, false);
    assert.equal(result.envelope?.ok, true);
    assert.equal((result.envelope?.data as { timeZone: string }).timeZone, "Europe/Skopje");
    assert.equal(
      (await call(client, "get_calendar_context", { timeZone: "invalid" })).isError,
      true
    );
    assert.equal((await call(client, "get_calendar_context", { goalId: id })).isError, true);
  } finally {
    await client.close();
  }
});

test("read ranges are bounded and schedule results include all three entity types", async () => {
  let reads = 0;
  const app = makeApp({
    events: {
      ...services.events,
      async list() {
        reads++;
        return [event];
      }
    },
    todos: {
      ...services.todos,
      async list() {
        reads++;
        return { backlog: [], scheduled: [] };
      }
    },
    toBuyItems: {
      ...services.toBuyItems,
      async list() {
        reads++;
        return { list: [], scheduled: [] };
      }
    }
  });
  const client = await connect(app);
  try {
    for (const invalid of [
      { ...range, weekEnd: range.weekStart },
      { ...range, weekEnd: "2026-05-01T00:00:00Z" }
    ]) {
      assert.equal((await call(client, "get_schedule", invalid)).isError, true);
    }
    assert.equal(reads, 0);
    const result = await call(client, "get_schedule", range);
    assert.deepEqual(
      Object.keys(result.envelope?.data as object).sort(),
      ["events", "todos", "toBuyItems", "weekStart", "weekEnd"].sort()
    );
    assert.equal(reads, 3);
  } finally {
    await client.close();
  }
});

test("occurrence identity validation preserves local times across DST and rejects invented occurrences", () => {
  assert.equal(belongsToSeries(event, "2026-03-30T08:00:00Z"), true);
  assert.equal(belongsToSeries(event, "2026-03-30T09:00:00Z"), false);
  assert.equal(belongsToSeries(event, "2026-03-24T09:00:00Z"), false);
  assert.equal(belongsToSeries(event, "2026-03-16T09:00:00Z"), false);
  assert.equal(
    belongsToSeries({ ...event, recurrenceIntervalWeeks: 2 }, "2026-03-30T08:00:00Z"),
    false
  );
  assert.equal(
    belongsToSeries({ ...event, recurrenceEndsOn: "2026-03-29" }, "2026-03-30T08:00:00Z"),
    false
  );
});

test("event patches require recurring scope, preserve master content, duration, time zone, and omitted goal/label fields", async () => {
  let written: Record<string, unknown> | undefined;
  const app = makeApp({
    events: {
      ...services.events,
      async findSeries() {
        return event;
      },
      async findOccurrence() {
        return { ...event, title: "Occurrence title" };
      },
      async update(_url, input) {
        written = input;
        return { ...event, ...input };
      }
    },
    labels: {
      ...services.labels,
      async find() {
        return {
          id: otherId,
          name: "Education",
          color: "#123456",
          createdAt: "",
          updatedAt: ""
        };
      }
    },
    notifications: {
      ...services.notifications,
      async reconcile() {
        return { scheduled: 0, cancelled: 0, failed: 0 };
      }
    }
  });
  const client = await connect(app);
  try {
    for (const args of [
      { id, title: "Changed" },
      { id, scope: "occurrence", title: "Changed" },
      {
        id,
        scope: "occurrence",
        occurrenceStartsAt: "2026-03-24T09:00:00Z",
        title: "Changed"
      },
      {
        id,
        scope: "occurrence",
        occurrenceStartsAt: "2026-03-30T08:00:00Z",
        recurrenceIntervalWeeks: 2
      },
      { id, scope: "series", goalId: null, title: "Changed" }
    ]) {
      assert.equal((await call(client, "update_event", args)).isError, true);
      assert.equal(written, undefined);
    }
    assert.equal(
      (
        await call(client, "move_event", {
          id,
          scope: "series",
          occurrenceStartsAt: "2026-03-30T08:00:00Z",
          startsAt: "2026-03-30T09:00:00Z",
          timeZone: "UTC"
        })
      ).isError,
      false
    );
    assert.equal(written?.title, "Class");
    assert.equal(written?.endsAt, "2026-03-30T10:00:00.000Z");
    assert.equal(written?.recurrenceTimeZone, "Europe/Skopje");
    assert.equal(written?.description, "Keep these notes");
    assert.equal(written?.goalId, undefined);
    assert.equal(written?.labelId, undefined);
  } finally {
    await client.close();
  }
});

test("partial to-do and to-buy schemas do not apply create defaults during edits", () => {
  assert.deepEqual(updateTodoSchema.parse({ id, title: "Change" }), {
    id,
    title: "Change"
  });
  assert.deepEqual(updateToBuySchema.parse({ id, title: "Change" }), {
    id,
    title: "Change"
  });
});

test("to-do scheduling rejects hidden hours and durations crossing midnight; partial edits preserve notes and goal inheritance", async () => {
  let written: Record<string, unknown> | undefined;
  const todo = {
    id,
    title: "Read",
    description: "Keep",
    goalId: otherId,
    estimatedMinutes: 60,
    scheduledAt: null,
    sortOrder: 0,
    createdAt: "",
    updatedAt: ""
  };
  const client = await connect(
    makeApp({
      todos: {
        ...services.todos,
        async find() {
          return todo;
        },
        async update(_url, input) {
          written = input;
          return [todo];
        }
      }
    })
  );
  try {
    for (const scheduledAt of ["2026-03-23T05:00:00+01:00", "2026-03-23T23:30:00+01:00"]) {
      assert.equal((await call(client, "schedule_todo", { id, scheduledAt })).isError, true);
    }
    assert.equal(Object.keys(written ?? {}).length, 0);
    assert.equal((await call(client, "update_todo", { id, title: "New" })).isError, false);
    assert.equal(written?.description, "Keep");
    assert.equal(written?.estimatedMinutes, 60);
    assert.equal(written?.goalId, undefined);
    assert.equal(
      (
        await call(client, "schedule_todo", {
          id,
          scheduledAt: "2026-03-23T10:00:00+01:00"
        })
      ).isError,
      false
    );
  } finally {
    await client.close();
  }
});

test("backlog reorder rejects duplicate, scheduled, unknown, and missing IDs without writing", async () => {
  let writes = 0;
  const todo = {
    id,
    title: "Read",
    description: "",
    goalId: null,
    estimatedMinutes: null,
    scheduledAt: null,
    sortOrder: 0,
    createdAt: "",
    updatedAt: ""
  };
  const client = await connect(
    makeApp({
      todos: {
        ...services.todos,
        async list() {
          return { backlog: [todo], scheduled: [] };
        },
        async update() {
          writes++;
          return [todo];
        }
      }
    })
  );
  try {
    for (const orderedIds of [[], [id, id], [otherId], [id, otherId]]) {
      assert.equal((await call(client, "reorder_todos", { orderedIds })).isError, true);
    }
    assert.equal(writes, 0);
    assert.equal((await call(client, "reorder_todos", { orderedIds: [id] })).isError, false);
    assert.equal(writes, 1);
  } finally {
    await client.close();
  }
});

test("system tool faults redact SQL and tokens while keeping correlation metadata", () => {
  const result = publicResult({
    ok: false,
    errors: [{ message: "SQL password=secret", details: { token } }],
    meta: { kind: "system", correlationId: id }
  });
  assert.equal(JSON.stringify(result).includes("secret"), false);
  assert.equal(JSON.stringify(result).includes(token), false);
  assert.equal(result.meta.correlationId, id);
});

test("HTTP transport rejects malformed and oversized JSON without dispatching", async () => {
  const app = makeApp();
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    accept: "application/json, text/event-stream"
  };
  const malformed = await handleCalendarMcpRequest(
    app,
    new Request(endpoint, { method: "POST", headers, body: "{" })
  );
  assert.equal(malformed.status, 400);
  const oversized = await handleCalendarMcpRequest(
    app,
    new Request(endpoint, {
      method: "POST",
      headers,
      body: "x".repeat(65_537)
    })
  );
  assert.equal(oversized.status, 413);
});
