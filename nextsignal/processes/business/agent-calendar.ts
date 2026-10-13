import {
  authFail,
  businessProcess,
  forwardFault,
  notFound,
  ok,
  validateWith,
  validationFail,
  value,
  type ProcessContext,
  type Result
} from "@gotch/nextsignal";
import { z } from "zod";
import type { AppServices, CalendarEvent } from "@/nextsignal/services";
import { belongsToSeries } from "@/nextsignal/services/occurrence-identity";
import { dateKeyInTimeZone } from "@/nextsignal/services/calendar-time";
import {
  createEventInputSchema,
  createTodoInputSchema,
  createToBuyItemInputSchema
} from "@/nextsignal/schemas";
import { hasMcpAccess } from "@/nextsignal/mcp/auth";
import { calendarTimeZone, placementError } from "@/nextsignal/mcp/calendar";
import {
  timeZone,
  rangeSchema,
  listSchema,
  eventIdentitySchema,
  eventTargetSchema,
  createEventSchema,
  updateEventSchema,
  moveEventSchema,
  duplicateEventSchema,
  idSchema,
  scheduleSchema,
  reorderSchema,
  createTodoSchema,
  updateTodoSchema,
  createToBuySchema,
  updateToBuySchema
} from "@/nextsignal/mcp/schemas";

type Context = ProcessContext<AppServices>;
type EventTarget = z.output<typeof eventTargetSchema>;
const databaseUrl = (ctx: Context) => ctx.config.get("database.url", "");

/** Each MCP capability has a named, authenticated, validated NextSignal business process. */
function agentTool<Shape extends z.ZodRawShape>(
  name: string,
  description: string,
  schema: z.ZodObject<Shape>,
  handle: (ctx: Context, input: z.output<z.ZodObject<Shape>>) => Promise<Result<unknown>>,
  options: { readOnly?: boolean; destructive?: boolean } = {}
) {
  return {
    name,
    description,
    schema,
    readOnly: options.readOnly ?? false,
    destructive: options.destructive ?? false,
    process: businessProcess<z.input<z.ZodObject<Shape>>, unknown, AppServices>({
      name: `agent.${name}`,
      auth: (ctx) =>
        hasMcpAccess(ctx.config, ctx.request?.headers.authorization) ? ok() : authFail(),
      validate: validateWith(schema),
      handle: (ctx, input) => handle(ctx, schema.parse(input))
    })
  };
}

async function eventForOperation(
  ctx: Context,
  input: EventTarget,
  mutation = false
): Promise<Result<CalendarEvent>> {
  const master = await ctx.services.events.findSeries(databaseUrl(ctx), input.id);
  if (!master) return notFound("Calendar event not found.");
  const recurring = master.recurrenceIntervalWeeks !== null;
  if (mutation && recurring && !input.scope) {
    return validationFail("Choose scope 'series' or 'occurrence' for this recurring event.");
  }
  if (input.occurrenceStartsAt && !belongsToSeries(master, input.occurrenceStartsAt)) {
    return validationFail(
      "occurrenceStartsAt must be an original occurrence timestamp from this series."
    );
  }
  if (input.scope === "series" || (!recurring && mutation)) {
    // Series edits use master content, even if the selected occurrence has overridden content.
    // Its original time locates the series edit without copying exception fields into the master.
    if (recurring && input.occurrenceStartsAt) {
      const duration = Date.parse(master.endsAt) - Date.parse(master.startsAt);
      return value({
        ...master,
        startsAt: input.occurrenceStartsAt,
        endsAt: new Date(Date.parse(input.occurrenceStartsAt) + duration).toISOString()
      });
    }
    return value(master);
  }
  if (recurring && !input.occurrenceStartsAt) {
    if (mutation)
      return validationFail("Occurrence operations require occurrenceStartsAt from get_schedule.");
    return value(master);
  }
  const occurrence = await ctx.services.events.findOccurrence(
    databaseUrl(ctx),
    input.id,
    input.occurrenceStartsAt
  );
  return occurrence
    ? value(occurrence)
    : notFound("This occurrence is cancelled or no longer exists.");
}

function eventFields(event: CalendarEvent) {
  return {
    title: event.title,
    description: event.description,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    recurrenceIntervalWeeks: event.recurrenceIntervalWeeks,
    recurrenceTimeZone: event.recurrenceTimeZone,
    recurrenceEndsOn: event.recurrenceEndsOn,
    notificationEnabled: event.notificationEnabled,
    notificationOffsetMinutes: event.notificationOffsetMinutes,
    notificationMessage: event.notificationMessage,
    color: event.color
  };
}

async function updateEvent(
  ctx: Context,
  input: z.output<typeof updateEventSchema>
): Promise<Result<unknown>> {
  const selected = await eventForOperation(ctx, input, true);
  if (!selected.ok || !selected.data) return forwardFault(selected);
  const existing = selected.data;
  const { id, occurrenceStartsAt, scope, timeZone: requestedZone, ...patch } = input;
  if (Object.keys(patch).length === 0)
    return validationFail("Provide at least one event field to update.");
  if (
    scope === "occurrence" &&
    (patch.recurrenceIntervalWeeks !== undefined || patch.recurrenceEndsOn !== undefined)
  ) {
    return validationFail("Recurrence changes require scope 'series'.");
  }
  const startsAt = patch.startsAt ?? existing.startsAt;
  const endsAt =
    patch.endsAt ??
    new Date(
      Date.parse(startsAt) + Date.parse(existing.endsAt) - Date.parse(existing.startsAt)
    ).toISOString();
  const zone = calendarTimeZone(
    ctx.config,
    requestedZone ?? existing.recurrenceTimeZone ?? undefined
  );
  const placement = placementError(startsAt, endsAt, zone);
  if (placement) return validationFail(placement);
  const merged = { ...eventFields(existing), ...patch, startsAt, endsAt };
  if (!merged.notificationEnabled) {
    merged.notificationOffsetMinutes = null;
    merged.notificationMessage = null;
  }
  if (merged.recurrenceIntervalWeeks === null) {
    merged.recurrenceTimeZone = null;
    merged.recurrenceEndsOn = null;
  } else {
    merged.recurrenceTimeZone = existing.recurrenceTimeZone ?? zone;
  }
  return ctx.mediator.dispatch("events.updateBusiness", {
    ...merged,
    id,
    occurrenceStartsAt,
    scope: scope ?? "series"
  });
}

const contextTool = agentTool(
  "get_calendar_context",
  "Read current time, calendar time zone, visible hours, and scheduling limits. Does not list goals or labels.",
  z.strictObject({ timeZone: timeZone.optional() }),
  async (ctx, input) => {
    const zone = calendarTimeZone(ctx.config, input.timeZone);
    const now = new Date();
    return value({
      now: now.toISOString(),
      today: dateKeyInTimeZone(now, zone),
      timeZone: zone,
      weekStartsOn: "Monday",
      visibleHours: { start: "07:00", end: "24:00" },
      minimumEventMinutes: 15,
      maximumTodoMinutes: 900,
      maximumReadRangeDays: 31,
      recurrenceIntervalWeeks: { min: 1, max: 52 },
      timestamps:
        "ISO 8601 with an explicit UTC offset. End times and read-range ends are exclusive.",
      recurringEdits:
        "Choose scope explicitly; use the original occurrenceStartsAt returned by get_schedule.",
      completion:
        "To-dos and to-buy items have no completed or purchased status in this application."
    });
  },
  { readOnly: true }
);

const scheduleTool = agentTool(
  "get_schedule",
  "Read events (expanded recurring occurrences), scheduled to-dos, and scheduled to-buy items in a range up to 31 days. End is exclusive.",
  rangeSchema,
  async (ctx, input) => {
    const url = databaseUrl(ctx);
    const [events, todos, toBuy] = await Promise.all([
      ctx.services.events.list(url, input.weekStart, input.weekEnd),
      ctx.services.todos.list(url, input.weekStart, input.weekEnd),
      ctx.services.toBuyItems.list(url, input.weekStart, input.weekEnd)
    ]);
    return value({
      ...input,
      events,
      todos: todos.scheduled,
      toBuyItems: toBuy.scheduled
    });
  },
  { readOnly: true }
);

const getEventTool = agentTool(
  "get_event",
  "Read an event by ID. Supply original occurrenceStartsAt to read an occurrence and its overrides; omit it to read the series master.",
  eventIdentitySchema,
  (ctx, input) => eventForOperation(ctx, input),
  { readOnly: true }
);

const createEventTool = agentTool(
  "create_event",
  "Create an event with explicit start/end times, optional weekly recurrence and reminders. Uses the default color and no goal or label. Reminders must be at least one minute in the future.",
  createEventSchema,
  async (ctx, input) => {
    const { timeZone: requestedZone, ...fields } = input;
    const zone = calendarTimeZone(ctx.config, requestedZone);
    const placement = placementError(input.startsAt, input.endsAt, zone);
    if (placement) return validationFail(placement);
    const parsed = createEventInputSchema.safeParse({
      ...fields,
      recurrenceTimeZone: fields.recurrenceIntervalWeeks === null ? null : zone
    });
    if (!parsed.success)
      return validationFail(parsed.error.issues.map((issue) => issue.message).join(" "));
    return ctx.mediator.dispatch("events.createBusiness", parsed.data);
  }
);

const updateEventTool = agentTool(
  "update_event",
  "Patch event fields; omitted fields and goal/label links are preserved. A start-only change preserves duration. Recurring events require scope; series edits use master content and retain the series time zone. Series content/time changes reset ordinary occurrence edits and cancellations, as in the UI.",
  updateEventSchema,
  updateEvent,
  { destructive: true }
);
const moveEventTool = agentTool(
  "move_event",
  "Move an event, preserving duration unless endsAt is supplied. Recurring events require scope; supply occurrenceStartsAt when moving a selected occurrence or shifting the series relative to it.",
  moveEventSchema,
  updateEvent,
  { destructive: true }
);
const duplicateEventTool = agentTool(
  "duplicate_event",
  "Copy an event into a new one-off event at startsAt, preserving content, goal/label assignments, duration and reminders. A recurring source requires occurrenceStartsAt; the series itself is never cloned.",
  duplicateEventSchema,
  async (ctx, input) => {
    const selected = await eventForOperation(ctx, input);
    if (!selected.ok || !selected.data) return forwardFault(selected);
    const source = selected.data;
    if (source.recurrenceIntervalWeeks !== null && !input.occurrenceStartsAt) {
      return validationFail("Choose an occurrenceStartsAt to duplicate from a recurring event.");
    }
    const endsAt =
      input.endsAt ??
      new Date(
        Date.parse(input.startsAt) + Date.parse(source.endsAt) - Date.parse(source.startsAt)
      ).toISOString();
    const placement = placementError(
      input.startsAt,
      endsAt,
      calendarTimeZone(ctx.config, input.timeZone ?? source.recurrenceTimeZone ?? undefined)
    );
    if (placement) return validationFail(placement);
    return ctx.mediator.dispatch("events.createBusiness", {
      ...eventFields(source),
      title: input.title ?? source.title,
      startsAt: input.startsAt,
      endsAt,
      labelId: source.labelId,
      goalId: source.goalId,
      recurrenceIntervalWeeks: null,
      recurrenceTimeZone: null,
      recurrenceEndsOn: null
    });
  }
);
const deleteEventTool = agentTool(
  "delete_event",
  "Delete a one-off event, cancel a recurring occurrence, or delete an entire series. Recurring events require explicit scope; occurrence cancellation requires original occurrenceStartsAt.",
  eventTargetSchema,
  async (ctx, input) => {
    const selected = await eventForOperation(ctx, input, true);
    if (!selected.ok) return forwardFault(selected);
    return ctx.mediator.dispatch("events.deleteBusiness", {
      ...input,
      scope: input.scope ?? "series"
    });
  },
  { destructive: true }
);

const listTodosTool = agentTool(
  "list_todos",
  "Read the entire unscheduled backlog and/or scheduled to-dos in the specified range. Backlog order is sortOrder. placement defaults to all.",
  listSchema,
  async (ctx, input) => {
    const result = await ctx.services.todos.list(databaseUrl(ctx), input.weekStart, input.weekEnd);
    return value({
      backlog: input.placement === "scheduled" ? [] : result.backlog,
      scheduled: input.placement === "unscheduled" ? [] : result.scheduled
    });
  },
  { readOnly: true }
);
const createTodoTool = agentTool(
  "create_todo",
  "Add a to-do to the backlog. Schedule it separately with schedule_todo. Estimated duration is optional.",
  createTodoSchema,
  async (ctx, input) =>
    ctx.mediator.dispatch("todos.createBusiness", createTodoInputSchema.parse(input))
);
const updateTodoTool = agentTool(
  "update_todo",
  "Patch a to-do's title, description or estimated duration; omitted fields, placement and goal link are preserved.",
  updateTodoSchema,
  async (ctx, input) => {
    const todo = await ctx.services.todos.find(databaseUrl(ctx), input.id);
    if (!todo) return notFound("To-do not found.");
    const { id, timeZone: requestedZone, ...patch } = input;
    if (Object.keys(patch).length === 0)
      return validationFail("Provide at least one to-do field to update.");
    const merged = {
      title: todo.title,
      description: todo.description,
      estimatedMinutes: todo.estimatedMinutes,
      ...patch
    };
    if (todo.scheduledAt && merged.estimatedMinutes !== null) {
      const end = new Date(
        Date.parse(todo.scheduledAt) + merged.estimatedMinutes * 60_000
      ).toISOString();
      const placement = placementError(
        todo.scheduledAt,
        end,
        calendarTimeZone(ctx.config, requestedZone)
      );
      if (placement) return validationFail(placement);
    }
    return ctx.mediator.dispatch("todos.updateBusiness", {
      action: "update",
      id,
      ...merged
    });
  }
);
const scheduleTodoTool = agentTool(
  "schedule_todo",
  "Place a backlog or scheduled to-do on the calendar without converting it to an event. Its estimated duration must fit before midnight.",
  scheduleSchema,
  async (ctx, input) => {
    const todo = await ctx.services.todos.find(databaseUrl(ctx), input.id);
    if (!todo) return notFound("To-do not found.");
    const end =
      todo.estimatedMinutes === null
        ? undefined
        : new Date(Date.parse(input.scheduledAt) + todo.estimatedMinutes * 60_000).toISOString();
    const placement = placementError(
      input.scheduledAt,
      end,
      calendarTimeZone(ctx.config, input.timeZone)
    );
    if (placement) return validationFail(placement);
    return ctx.mediator.dispatch("todos.updateBusiness", {
      action: "schedule",
      id: input.id,
      scheduledAt: input.scheduledAt
    });
  }
);
const unscheduleTodoTool = agentTool(
  "unschedule_todo",
  "Move a to-do back to the end of the backlog, preserving its content and goal link.",
  idSchema,
  async (ctx, input) =>
    ctx.mediator.dispatch("todos.updateBusiness", {
      action: "unschedule",
      ...input
    })
);
const reorderTodosTool = agentTool(
  "reorder_todos",
  "Reorder the backlog. Supply every current unscheduled to-do ID exactly once, in the desired order. Scheduled items cannot be included.",
  reorderSchema,
  async (ctx, input) => {
    const { backlog } = await ctx.services.todos.list(
      databaseUrl(ctx),
      new Date(0).toISOString(),
      new Date(1).toISOString()
    );
    if (!sameIds(backlog, input.orderedIds))
      return validationFail(
        "Reload the backlog and supply all current unscheduled IDs exactly once."
      );
    if (!backlog.length) return value([]);
    return ctx.mediator.dispatch("todos.updateBusiness", {
      action: "reorder",
      ...input
    });
  }
);
const deleteTodoTool = agentTool(
  "delete_todo",
  "Permanently delete a to-do from the calendar or backlog.",
  idSchema,
  async (ctx, input) => ctx.mediator.dispatch("todos.deleteBusiness", input),
  { destructive: true }
);

const listToBuyTool = agentTool(
  "list_to_buy_items",
  "Read the entire unscheduled to-buy list and/or scheduled purchase items in a range. placement defaults to all.",
  listSchema,
  async (ctx, input) => {
    const result = await ctx.services.toBuyItems.list(
      databaseUrl(ctx),
      input.weekStart,
      input.weekEnd
    );
    return value({
      list: input.placement === "scheduled" ? [] : result.list,
      scheduled: input.placement === "unscheduled" ? [] : result.scheduled
    });
  },
  { readOnly: true }
);
const createToBuyTool = agentTool(
  "create_to_buy_item",
  "Add an unscheduled to-buy item with an optional HTTP(S) purchase link. Schedule it separately.",
  createToBuySchema,
  async (ctx, input) =>
    ctx.mediator.dispatch("toBuyItems.createBusiness", createToBuyItemInputSchema.parse(input))
);
const updateToBuyTool = agentTool(
  "update_to_buy_item",
  "Patch a purchase item's title, description or URL, preserving omitted fields and scheduled time. Set URL to null to remove it.",
  updateToBuySchema,
  async (ctx, input) => {
    const item = await ctx.services.toBuyItems.find(databaseUrl(ctx), input.id);
    if (!item) return notFound("To-buy item not found.");
    const { id, ...patch } = input;
    if (Object.keys(patch).length === 0)
      return validationFail("Provide at least one purchase-item field to update.");
    return ctx.mediator.dispatch("toBuyItems.updateBusiness", {
      action: "update",
      id,
      title: item.title,
      description: item.description,
      url: item.url,
      ...patch
    });
  }
);
const scheduleToBuyTool = agentTool(
  "schedule_to_buy_item",
  "Place a purchase item at a calendar time. To-buy items have no duration.",
  scheduleSchema,
  async (ctx, input) => {
    const placement = placementError(
      input.scheduledAt,
      undefined,
      calendarTimeZone(ctx.config, input.timeZone)
    );
    if (placement) return validationFail(placement);
    return ctx.mediator.dispatch("toBuyItems.updateBusiness", {
      action: "schedule",
      id: input.id,
      scheduledAt: input.scheduledAt
    });
  }
);
const unscheduleToBuyTool = agentTool(
  "unschedule_to_buy_item",
  "Return a purchase item to the end of the unscheduled to-buy list.",
  idSchema,
  async (ctx, input) =>
    ctx.mediator.dispatch("toBuyItems.updateBusiness", {
      action: "unschedule",
      ...input
    })
);
const reorderToBuyTool = agentTool(
  "reorder_to_buy_items",
  "Reorder the unscheduled to-buy list. Supply every current unscheduled item ID exactly once; exclude scheduled items.",
  reorderSchema,
  async (ctx, input) => {
    const { list } = await ctx.services.toBuyItems.list(
      databaseUrl(ctx),
      new Date(0).toISOString(),
      new Date(1).toISOString()
    );
    if (!sameIds(list, input.orderedIds))
      return validationFail(
        "Reload the to-buy list and supply all current unscheduled IDs exactly once."
      );
    if (!list.length) return value([]);
    return ctx.mediator.dispatch("toBuyItems.updateBusiness", {
      action: "reorder",
      ...input
    });
  }
);
const deleteToBuyTool = agentTool(
  "delete_to_buy_item",
  "Permanently delete a purchase item from the calendar or to-buy list.",
  idSchema,
  async (ctx, input) => ctx.mediator.dispatch("toBuyItems.deleteBusiness", input),
  { destructive: true }
);

function sameIds(items: { id: string }[], orderedIds: string[]): boolean {
  const ids = new Set(orderedIds);
  return items.length === ids.size && items.every((item) => ids.has(item.id));
}

export const agentTools = [
  contextTool,
  scheduleTool,
  getEventTool,
  createEventTool,
  updateEventTool,
  moveEventTool,
  duplicateEventTool,
  deleteEventTool,
  listTodosTool,
  createTodoTool,
  updateTodoTool,
  scheduleTodoTool,
  unscheduleTodoTool,
  reorderTodosTool,
  deleteTodoTool,
  listToBuyTool,
  createToBuyTool,
  updateToBuyTool,
  scheduleToBuyTool,
  unscheduleToBuyTool,
  reorderToBuyTool,
  deleteToBuyTool
];
export const agentProcesses = agentTools.map((tool) => tool.process);
