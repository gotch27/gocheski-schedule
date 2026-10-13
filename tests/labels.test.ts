import { test } from "node:test";
import assert from "node:assert/strict";
import { createNextSignalApp } from "@gotch/nextsignal";
import { adapters } from "@/nextsignal/adapters";
import { config } from "@/nextsignal/config";
import {
  services,
  occurrencesInRange,
  rebaseGoalExceptions,
  type CalendarLabel
} from "@/nextsignal/services";
import { createEventBusiness, updateEventBusiness } from "@/nextsignal/processes/business/events";
import {
  listLabelsApi,
  createLabelsApi,
  updateLabelsApi,
  deleteLabelsApi
} from "@/nextsignal/processes/api/labels";
import {
  listLabelsBusiness,
  createLabelsBusiness,
  updateLabelsBusiness,
  deleteLabelsBusiness
} from "@/nextsignal/processes/business/labels";
import {
  createLabelInputSchema,
  createEventInputSchema,
  updateEventInputSchema
} from "@/nextsignal/schemas";
import { eventColorStyle } from "@/app/lib/event-colors";
import type { CalendarEventRecord, CalendarEventExceptionRecord } from "@/db/schema";

const labelA = "b664f2fc-c40f-42ef-a234-6bcde844f43a";
const labelB = "f62b4d23-c09d-43ba-9b69-cee19849e476";
const record: CalendarEventRecord = {
  id: "f36d889d-bba6-46a5-8769-a6c751240fc6",
  goalId: null,
  labelId: labelA,
  title: "Weekly class",
  description: "",
  startsAt: new Date("2026-03-23T09:00:00Z"),
  endsAt: new Date("2026-03-23T10:00:00Z"),
  recurrenceIntervalWeeks: 1,
  recurrenceTimeZone: "Europe/Skopje",
  recurrenceEndsOn: null,
  notificationEnabled: false,
  notificationOffsetMinutes: null,
  notificationMessage: null,
  color: "#8c6cff",
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
const from = new Date("2026-03-23T00:00:00Z");
const until = new Date("2026-03-24T00:00:00Z");

test("labels require a name and a six digit color; legacy event colors remain valid", () => {
  assert.deepEqual(createLabelInputSchema.parse({ name: "  Education  ", color: "#ABCDEF" }), {
    name: "Education",
    color: "#abcdef"
  });
  for (const input of [
    { name: " ", color: "#abcdef" },
    { name: "x".repeat(61), color: "#abcdef" },
    { name: "Fun", color: "blue" },
    { name: "Fun", color: "#abc" },
    { name: "Fun", color: "url(x)" }
  ]) {
    assert.equal(createLabelInputSchema.safeParse(input).success, false);
  }
  const input = {
    title: "Event",
    startsAt: "2026-10-13T09:00:00Z",
    endsAt: "2026-10-13T10:00:00Z"
  };
  assert.equal(createEventInputSchema.parse({ ...input, color: "blue" }).color, "blue");
  assert.equal(
    createEventInputSchema.parse({ ...input, color: "#123456", labelId: labelA }).labelId,
    labelA
  );
  assert.equal(updateEventInputSchema.parse({ ...input, id: record.id }).labelId, undefined);
  assert.equal(
    updateEventInputSchema.parse({ ...input, id: record.id, labelId: null }).labelId,
    null
  );
});

test("occurrences inherit labels, change labels, or explicitly remove labels", () => {
  for (const [overridden, id, expected] of [
    [false, null, labelA],
    [true, labelB, labelB],
    [true, null, null]
  ] as const) {
    const [event] = occurrencesInRange(record, from, until, [
      exception({ labelIsOverridden: overridden, labelId: id })
    ]);
    assert.equal(event.labelId, expected);
  }
});

test("moving a series preserves occurrence label choices and their colors across DST", () => {
  const startsAt = new Date("2026-03-30T08:00:00Z");
  const overrides = rebaseGoalExceptions(
    record,
    [exception({ labelIsOverridden: true, labelId: labelB, color: "#e98175" })],
    startsAt,
    60 * 60_000,
    1,
    "Europe/Skopje"
  );
  const events = occurrencesInRange(
    { ...record, startsAt, endsAt: new Date(startsAt.getTime() + 60 * 60_000) },
    new Date("2026-03-30T00:00:00Z"),
    new Date("2026-04-07T00:00:00Z"),
    overrides
  );
  assert.deepEqual(
    events.map((event) => [event.labelId, event.color]),
    [
      [labelB, "#e98175"],
      [labelA, "#8c6cff"]
    ]
  );
  assert.equal(events[0].startsAt, "2026-03-30T08:00:00.000Z");
  assert.equal(
    rebaseGoalExceptions(
      record,
      [exception({ labelIsOverridden: true, labelId: null, color: "#e98175" })],
      startsAt,
      60 * 60_000,
      1,
      "Europe/Skopje"
    )[0].labelId,
    null
  );
});

test("label API processes support create, list, rename, recolor and remove", async () => {
  let labels: CalendarLabel[] = [];
  const app = createNextSignalApp({
    config,
    adapters,
    processes: [
      listLabelsApi,
      createLabelsApi,
      updateLabelsApi,
      deleteLabelsApi,
      listLabelsBusiness,
      createLabelsBusiness,
      updateLabelsBusiness,
      deleteLabelsBusiness
    ],
    services: {
      ...services,
      labels: {
        ...services.labels,
        async list() {
          return labels;
        },
        async create(_url, input) {
          const label = {
            ...input,
            id: labelA,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          labels.push(label);
          return label;
        },
        async update(_url, input) {
          const label = labels.find((label) => label.id === input.id);
          if (!label) return null;
          Object.assign(label, input);
          return label;
        },
        async delete(_url, id) {
          const exists = labels.some((label) => label.id === id);
          labels = labels.filter((label) => label.id !== id);
          return exists;
        }
      }
    } satisfies typeof services
  });
  assert.equal(
    (await app.dispatch("labels.create", { name: "Education", color: "#8c6cff" })).ok,
    true
  );
  assert.equal(
    (await app.dispatch("labels.update", { id: labelA, name: "Networking", color: "#123456" })).ok,
    true
  );
  assert.equal(labels[0].name, "Networking");
  assert.equal(labels[0].color, "#123456");
  assert.equal((await app.dispatch("labels.list", {})).ok, true);
  assert.equal((await app.dispatch("labels.delete", { id: labelA })).ok, true);
  assert.equal(labels.length, 0);
  assert.equal(
    (await app.dispatch("labels.update", { id: labelA, name: "Fun", color: "#123456" })).ok,
    false
  );
  assert.equal((await app.dispatch("labels.create", { name: " ", color: "#123456" })).ok, false);
});

test("event processes reject missing labels and use the saved label color", async () => {
  let stored = occurrencesInRange(record, from, until, [])[0];
  const app = createNextSignalApp({
    config,
    adapters,
    processes: [createEventBusiness, updateEventBusiness],
    services: {
      ...services,
      labels: {
        ...services.labels,
        async find(_url, id) {
          return id === labelA
            ? { id, name: "Education", color: "#123456", createdAt: "", updatedAt: "" }
            : null;
        }
      },
      events: {
        ...services.events,
        async create(_url, input) {
          stored = { ...stored, ...input, labelId: input.labelId ?? null };
          return stored;
        },
        async update(_url, input) {
          stored = {
            ...stored,
            ...input,
            labelId: input.labelId === undefined ? stored.labelId : input.labelId
          };
          return stored;
        },
        async findOccurrence() {
          return stored;
        }
      },
      notifications: {
        ...services.notifications,
        async reconcile() {
          return { scheduled: 0, cancelled: 0, failed: 0 };
        }
      }
    } satisfies typeof services
  });
  const input = {
    title: "Class",
    startsAt: "2026-10-13T09:00:00Z",
    endsAt: "2026-10-13T10:00:00Z",
    color: "blue",
    labelId: labelA
  };
  assert.equal(
    (await app.dispatch("events.createBusiness", { ...input, labelId: labelB })).ok,
    false
  );
  assert.equal((await app.dispatch("events.createBusiness", input)).ok, true);
  assert.equal(stored.color, "#123456");
  const { labelId: _labelId, ...edit } = input;
  assert.equal((await app.dispatch("events.updateBusiness", { ...edit, id: record.id })).ok, true);
  assert.equal(stored.labelId, labelA);
  assert.equal(stored.color, "#123456");
  assert.equal(
    (await app.dispatch("events.updateBusiness", { ...edit, id: record.id, labelId: null })).ok,
    true
  );
  assert.equal(stored.labelId, null);
});

test("arbitrary colors produce readable dark text on pale event cards", () => {
  for (const color of ["#000000", "#ffffff", "#ffff00", "#0000ff"] as const) {
    const style = eventColorStyle(color);
    const channels = String(style.color).match(/\d+/g)!.map(Number);
    assert.ok(Math.max(...channels) <= 102);
    assert.ok(String(style.background).includes("linear-gradient"));
  }
});
