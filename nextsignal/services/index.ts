import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import {
  calendarEventExceptions,
  calendarEventNotificationDeliveries,
  calendarEvents,
  calendarTodos,
  type CalendarEventExceptionRecord,
  type CalendarEventRecord,
  type CalendarEventNotificationDeliveryRecord,
  type CalendarTodoRecord,
  type EventColor
} from "@/db/schema";
import type {
  CreateEventInput,
  CreateTodoInput,
  DeleteEventInput,
  UpdateEventInput,
  UpdateTodoInput
} from "@/nextsignal/schemas";

export type CalendarEvent = {
  id: string;
  occurrenceKey: string;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  recurrenceIntervalWeeks: number | null;
  recurrenceTimeZone: string | null;
  recurrenceEndsOn: string | null;
  notificationEnabled: boolean;
  notificationOffsetMinutes: number | null;
  notificationMessage: string | null;
  notificationAt: string | null;
  notificationState: "disabled" | "pending" | "scheduled" | "sent" | "failed";
  recurrenceAnchorStartsAt: string;
  occurrenceStartsAt: string;
  isOccurrenceOverride: boolean;
  color: EventColor;
  createdAt: string;
  updatedAt: string;
};

export type CalendarTodo = {
  id: string;
  title: string;
  description: string;
  estimatedMinutes: number | null;
  scheduledAt: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type CalendarTodoList = {
  backlog: CalendarTodo[];
  scheduled: CalendarTodo[];
};

export type NotificationProviderConfig = {
  baseUrl: string;
  topic: string;
  accessToken: string;
  timeZone: string;
};

export type NotificationSyncResult = {
  scheduled: number;
  cancelled: number;
  failed: number;
};

const notificationHorizonMilliseconds = 60 * 60 * 60_000;
const maximumNotificationOffsetMilliseconds = 7 * 24 * 60 * 60_000;

const databases = new Map<string, ReturnType<typeof createDatabase>>();

function createDatabase(connectionString: string) {
  const client = neon(connectionString);
  return drizzle({ client });
}

function database(connectionString: string) {
  if (!connectionString) {
    throw new Error("Calendar storage is not connected. Add NEXTSIGNAL_DATABASE__URL to .env.local.");
  }

  const existing = databases.get(connectionString);
  if (existing) return existing;

  const created = createDatabase(connectionString);
  databases.set(connectionString, created);
  return created;
}

function toCalendarEvent(
  record: CalendarEventRecord,
  occurrence = { startsAt: record.startsAt, endsAt: record.endsAt, index: 0 }
): CalendarEvent {
  const notificationAt = record.notificationEnabled && record.notificationOffsetMinutes !== null
    ? new Date(occurrence.startsAt.getTime() - record.notificationOffsetMinutes * 60_000).toISOString()
    : null;
  return {
    ...record,
    occurrenceKey: record.recurrenceIntervalWeeks === null
      ? record.id
      : `${record.id}:${occurrence.startsAt.toISOString()}`,
    startsAt: occurrence.startsAt.toISOString(),
    endsAt: occurrence.endsAt.toISOString(),
    recurrenceAnchorStartsAt: record.startsAt.toISOString(),
    occurrenceStartsAt: occurrence.startsAt.toISOString(),
    isOccurrenceOverride: false,
    notificationAt,
    notificationState: record.notificationEnabled ? "pending" : "disabled",
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString()
  };
}

function toCalendarTodo(record: CalendarTodoRecord): CalendarTodo {
  return {
    ...record,
    scheduledAt: record.scheduledAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString()
  };
}

async function nextTodoSortOrder(db: ReturnType<typeof database>) {
  const [lastTodo] = await db
    .select({ sortOrder: calendarTodos.sortOrder })
    .from(calendarTodos)
    .where(isNull(calendarTodos.scheduledAt))
    .orderBy(desc(calendarTodos.sortOrder))
    .limit(1);
  return (lastTodo?.sortOrder ?? -1) + 1;
}

async function queueDeliveryCancellations(
  db: ReturnType<typeof database>,
  eventId: string,
  occurrenceStartsAt?: Date
) {
  const conditions = [
    eq(calendarEventNotificationDeliveries.eventId, eventId),
    gt(calendarEventNotificationDeliveries.notifyAt, new Date())
  ];
  if (occurrenceStartsAt) {
    conditions.push(eq(calendarEventNotificationDeliveries.occurrenceStartsAt, occurrenceStartsAt));
  }
  await db
    .update(calendarEventNotificationDeliveries)
    .set({ state: "cancel_pending", updatedAt: new Date() })
    .where(and(...conditions));
}

export const services = {
  events: {
    async list(connectionString: string, weekStart: string, weekEnd: string): Promise<CalendarEvent[]> {
      const rangeStart = new Date(weekStart);
      const rangeEnd = new Date(weekEnd);
      const db = database(connectionString);
      const records = await db
        .select()
        .from(calendarEvents)
        .where(or(
          and(
            isNull(calendarEvents.recurrenceIntervalWeeks),
            lt(calendarEvents.startsAt, rangeEnd),
            gt(calendarEvents.endsAt, rangeStart)
          ),
          and(
            isNotNull(calendarEvents.recurrenceIntervalWeeks),
            lt(calendarEvents.startsAt, rangeEnd)
          )
        ))
        .orderBy(asc(calendarEvents.startsAt));

      const recurringIds = records
        .filter((record) => record.recurrenceIntervalWeeks !== null)
        .map((record) => record.id);
      const exceptionsById = new Map<string, CalendarEventExceptionRecord>();

      if (recurringIds.length > 0) {
        const seriesExceptions = await db
          .select()
          .from(calendarEventExceptions)
          .where(inArray(calendarEventExceptions.eventId, recurringIds));
        for (const exception of seriesExceptions) exceptionsById.set(exception.id, exception);
      }

      const movedIntoRange = await db
        .select()
        .from(calendarEventExceptions)
        .where(and(
          eq(calendarEventExceptions.isCancelled, false),
          lt(calendarEventExceptions.startsAt, rangeEnd),
          gt(calendarEventExceptions.endsAt, rangeStart)
        ));
      for (const exception of movedIntoRange) exceptionsById.set(exception.id, exception);

      const recordIds = new Set(records.map((record) => record.id));
      const missingEventIds = [...new Set(
        movedIntoRange
          .map((exception) => exception.eventId)
          .filter((eventId) => !recordIds.has(eventId))
      )];
      const allRecords = [...records];

      if (missingEventIds.length > 0) {
        allRecords.push(...await db
          .select()
          .from(calendarEvents)
          .where(inArray(calendarEvents.id, missingEventIds)));
      }

      const exceptionsByEvent = new Map<string, CalendarEventExceptionRecord[]>();
      for (const exception of exceptionsById.values()) {
        const existing = exceptionsByEvent.get(exception.eventId) ?? [];
        existing.push(exception);
        exceptionsByEvent.set(exception.eventId, existing);
      }

      const occurrences = allRecords
        .flatMap((record) => occurrencesInRange(
          record,
          rangeStart,
          rangeEnd,
          exceptionsByEvent.get(record.id) ?? []
        ))
        .sort((left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime());
      return attachDeliveryStates(db, occurrences);
    },

    async create(connectionString: string, input: CreateEventInput): Promise<CalendarEvent> {
      const [record] = await database(connectionString)
        .insert(calendarEvents)
        .values({
          title: input.title,
          description: input.description,
          startsAt: new Date(input.startsAt),
          endsAt: new Date(input.endsAt),
          recurrenceIntervalWeeks: input.recurrenceIntervalWeeks,
          recurrenceTimeZone: input.recurrenceIntervalWeeks === null ? null : input.recurrenceTimeZone ?? "UTC",
          recurrenceEndsOn: input.recurrenceIntervalWeeks === null ? null : input.recurrenceEndsOn,
          notificationEnabled: input.notificationEnabled,
          notificationOffsetMinutes: input.notificationEnabled ? input.notificationOffsetMinutes : null,
          notificationMessage: input.notificationEnabled ? input.notificationMessage : null,
          color: input.color
        })
        .returning();

      return toCalendarEvent(record);
    },

    async update(connectionString: string, input: UpdateEventInput): Promise<CalendarEvent | null> {
      const db = database(connectionString);
      const [existing] = await db
        .select()
        .from(calendarEvents)
        .where(eq(calendarEvents.id, input.id))
        .limit(1);

      if (!existing) return null;

      if (input.scope === "occurrence" && existing.recurrenceIntervalWeeks !== null && input.occurrenceStartsAt) {
        const occurrenceStartsAt = new Date(input.occurrenceStartsAt);
        await queueDeliveryCancellations(db, existing.id, occurrenceStartsAt);
        const [exception] = await db
          .insert(calendarEventExceptions)
          .values({
            eventId: existing.id,
            occurrenceStartsAt,
            title: input.title,
            description: input.description,
            startsAt: new Date(input.startsAt),
            endsAt: new Date(input.endsAt),
            color: input.color,
            notificationEnabled: input.notificationEnabled,
            notificationOffsetMinutes: input.notificationEnabled ? input.notificationOffsetMinutes : null,
            notificationMessage: input.notificationEnabled ? input.notificationMessage : null,
            isCancelled: false
          })
          .onConflictDoUpdate({
            target: [calendarEventExceptions.eventId, calendarEventExceptions.occurrenceStartsAt],
            set: {
              title: input.title,
              description: input.description,
              startsAt: new Date(input.startsAt),
              endsAt: new Date(input.endsAt),
              color: input.color,
              notificationEnabled: input.notificationEnabled,
              notificationOffsetMinutes: input.notificationEnabled ? input.notificationOffsetMinutes : null,
              notificationMessage: input.notificationEnabled ? input.notificationMessage : null,
              isCancelled: false,
              updatedAt: new Date()
            }
          })
          .returning();

        return toExceptionCalendarEvent(existing, exception);
      }

      const requestedStart = new Date(input.startsAt);
      const requestedEnd = new Date(input.endsAt);
      const duration = requestedEnd.getTime() - requestedStart.getTime();
      let storedStart = requestedStart;
      const recurrenceTimeZone = input.recurrenceIntervalWeeks === null
        ? null
        : input.recurrenceTimeZone ?? existing.recurrenceTimeZone ?? "UTC";

      if (existing.recurrenceIntervalWeeks !== null && input.recurrenceIntervalWeeks !== null) {
        const occurrenceStart = input.occurrenceStartsAt
          ? new Date(input.occurrenceStartsAt)
          : existing.startsAt;
        storedStart = shiftSeriesAnchor(
          existing.startsAt,
          occurrenceStart,
          requestedStart,
          recurrenceTimeZone ?? "UTC"
        );
      }

      const storedEnd = new Date(storedStart.getTime() + duration);
      await queueDeliveryCancellations(db, existing.id);
      const [record] = await db
        .update(calendarEvents)
        .set({
          title: input.title,
          description: input.description,
          startsAt: storedStart,
          endsAt: storedEnd,
          recurrenceIntervalWeeks: input.recurrenceIntervalWeeks,
          recurrenceTimeZone,
          recurrenceEndsOn: input.recurrenceIntervalWeeks === null ? null : input.recurrenceEndsOn,
          notificationEnabled: input.notificationEnabled,
          notificationOffsetMinutes: input.notificationEnabled ? input.notificationOffsetMinutes : null,
          notificationMessage: input.notificationEnabled ? input.notificationMessage : null,
          color: input.color,
          updatedAt: new Date()
        })
        .where(eq(calendarEvents.id, input.id))
        .returning();

      await db
        .delete(calendarEventExceptions)
        .where(eq(calendarEventExceptions.eventId, input.id));

      return record
        ? toCalendarEvent(record, { startsAt: requestedStart, endsAt: requestedEnd, index: 0 })
        : null;
    },

    async delete(connectionString: string, input: DeleteEventInput): Promise<boolean> {
      const db = database(connectionString);
      const [existing] = await db
        .select()
        .from(calendarEvents)
        .where(eq(calendarEvents.id, input.id))
        .limit(1);

      if (!existing) return false;

      if (input.scope === "occurrence" && existing.recurrenceIntervalWeeks !== null && input.occurrenceStartsAt) {
        const occurrenceStartsAt = new Date(input.occurrenceStartsAt);
        await queueDeliveryCancellations(db, existing.id, occurrenceStartsAt);
        await db
          .insert(calendarEventExceptions)
          .values({
            eventId: existing.id,
            occurrenceStartsAt,
            isCancelled: true
          })
          .onConflictDoUpdate({
            target: [calendarEventExceptions.eventId, calendarEventExceptions.occurrenceStartsAt],
            set: {
              title: null,
              description: null,
              startsAt: null,
              endsAt: null,
              color: null,
              isCancelled: true,
              updatedAt: new Date()
            }
          });

        return true;
      }

      await queueDeliveryCancellations(db, existing.id);
      const deleted = await db
        .delete(calendarEvents)
        .where(eq(calendarEvents.id, input.id))
        .returning({ id: calendarEvents.id });

      return deleted.length > 0;
    },

    async findOccurrence(
      connectionString: string,
      id: string,
      occurrenceStartsAt?: string
    ): Promise<CalendarEvent | null> {
      const db = database(connectionString);
      const [record] = await db.select().from(calendarEvents).where(eq(calendarEvents.id, id)).limit(1);
      if (!record) return null;
      if (record.recurrenceIntervalWeeks === null) {
        const [event] = await attachDeliveryStates(db, [toCalendarEvent(record)]);
        return event ?? null;
      }
      const occurrence = occurrenceStartsAt ? new Date(occurrenceStartsAt) : record.startsAt;
      const [exception] = await db
        .select()
        .from(calendarEventExceptions)
        .where(and(
          eq(calendarEventExceptions.eventId, id),
          eq(calendarEventExceptions.occurrenceStartsAt, occurrence)
        ))
        .limit(1);
      if (exception?.isCancelled) return null;
      const duration = record.endsAt.getTime() - record.startsAt.getTime();
      const event = exception
        ? toExceptionCalendarEvent(record, exception)
        : toCalendarEvent(record, { startsAt: occurrence, endsAt: new Date(occurrence.getTime() + duration), index: 0 });
      const [withState] = await attachDeliveryStates(db, [event]);
      return withState ?? null;
    }
  },

  notifications: {
    async reconcile(
      connectionString: string,
      provider: NotificationProviderConfig,
      eventId?: string
    ): Promise<NotificationSyncResult> {
      const db = database(connectionString);
      const now = new Date();
      const horizon = new Date(now.getTime() + notificationHorizonMilliseconds);
      const occurrenceEnd = new Date(horizon.getTime() + maximumNotificationOffsetMilliseconds);
      const occurrences = await loadNotificationOccurrences(db, now, occurrenceEnd, eventId);
      const desired = occurrences.filter((event) => {
        if (!event.notificationEnabled || !event.notificationAt) return false;
        const notifyAt = new Date(event.notificationAt);
        return notifyAt > now && notifyAt <= horizon;
      });
      const desiredKeys = new Set(desired.map((event) => `${event.id}:${event.occurrenceStartsAt}`));
      const result: NotificationSyncResult = { scheduled: 0, cancelled: 0, failed: 0 };

      const cancellationConditions = [eq(calendarEventNotificationDeliveries.state, "cancel_pending")];
      if (eventId) cancellationConditions.push(eq(calendarEventNotificationDeliveries.eventId, eventId));
      const cancellations = await db
        .select()
        .from(calendarEventNotificationDeliveries)
        .where(and(...cancellationConditions));

      for (const delivery of cancellations) {
        const key = `${delivery.eventId}:${delivery.occurrenceStartsAt.toISOString()}`;
        if (delivery.eventId && desiredKeys.has(key)) continue;
        try {
          await cancelNtfyNotification(provider, delivery.providerSequenceId);
          await db
            .update(calendarEventNotificationDeliveries)
            .set({ state: "cancelled", lastError: null, updatedAt: new Date() })
            .where(eq(calendarEventNotificationDeliveries.id, delivery.id));
          result.cancelled += 1;
        } catch (error) {
          await db
            .update(calendarEventNotificationDeliveries)
            .set({ state: "cancel_pending", lastError: errorMessage(error), updatedAt: new Date() })
            .where(eq(calendarEventNotificationDeliveries.id, delivery.id));
          result.failed += 1;
        }
      }

      for (const event of desired) {
        const notifyAt = new Date(event.notificationAt!);
        const sequenceId = notificationSequenceId(event.id, event.occurrenceStartsAt);
        const [delivery] = await db
          .insert(calendarEventNotificationDeliveries)
          .values({
            eventId: event.id,
            occurrenceStartsAt: new Date(event.occurrenceStartsAt),
            notifyAt,
            providerSequenceId: sequenceId,
            state: "pending"
          })
          .onConflictDoUpdate({
            target: [calendarEventNotificationDeliveries.eventId, calendarEventNotificationDeliveries.occurrenceStartsAt],
            set: {
              notifyAt,
              providerSequenceId: sequenceId,
              state: "pending",
              lastError: null,
              updatedAt: new Date()
            }
          })
          .returning();
        try {
          await scheduleNtfyNotification(provider, event, sequenceId, notifyAt);
          await db
            .update(calendarEventNotificationDeliveries)
            .set({ state: "scheduled", providerScheduledAt: new Date(), lastError: null, updatedAt: new Date() })
            .where(eq(calendarEventNotificationDeliveries.id, delivery.id));
          result.scheduled += 1;
        } catch (error) {
          await db
            .update(calendarEventNotificationDeliveries)
            .set({ state: "failed", lastError: errorMessage(error), updatedAt: new Date() })
            .where(eq(calendarEventNotificationDeliveries.id, delivery.id));
          result.failed += 1;
        }
      }

      return result;
    }
  },

  todos: {
    async list(connectionString: string, weekStart: string, weekEnd: string): Promise<CalendarTodoList> {
      const db = database(connectionString);
      const rangeStart = new Date(weekStart);
      const rangeEnd = new Date(weekEnd);
      const [backlogRecords, scheduledRecords] = await Promise.all([
        db
          .select()
          .from(calendarTodos)
          .where(isNull(calendarTodos.scheduledAt))
          .orderBy(asc(calendarTodos.sortOrder), asc(calendarTodos.createdAt)),
        db
          .select()
          .from(calendarTodos)
          .where(and(
            isNotNull(calendarTodos.scheduledAt),
            gte(calendarTodos.scheduledAt, rangeStart),
            lt(calendarTodos.scheduledAt, rangeEnd)
          ))
          .orderBy(asc(calendarTodos.scheduledAt))
      ]);
      return {
        backlog: backlogRecords.map(toCalendarTodo),
        scheduled: scheduledRecords.map(toCalendarTodo)
      };
    },

    async create(connectionString: string, input: CreateTodoInput): Promise<CalendarTodo> {
      const db = database(connectionString);
      const [record] = await db
        .insert(calendarTodos)
        .values({
          title: input.title,
          description: input.description,
          estimatedMinutes: input.estimatedMinutes,
          sortOrder: await nextTodoSortOrder(db)
        })
        .returning();
      return toCalendarTodo(record);
    },

    async update(connectionString: string, input: UpdateTodoInput): Promise<CalendarTodo[] | null> {
      const db = database(connectionString);

      if (input.action === "reorder") {
        const existing = await db
          .select({ id: calendarTodos.id })
          .from(calendarTodos)
          .where(and(isNull(calendarTodos.scheduledAt), inArray(calendarTodos.id, input.orderedIds)));
        if (existing.length !== input.orderedIds.length) return null;
        for (const [sortOrder, id] of input.orderedIds.entries()) {
          await db
            .update(calendarTodos)
            .set({ sortOrder, updatedAt: new Date() })
            .where(and(eq(calendarTodos.id, id), isNull(calendarTodos.scheduledAt)));
        }
        const reordered = await db
          .select()
          .from(calendarTodos)
          .where(isNull(calendarTodos.scheduledAt))
          .orderBy(asc(calendarTodos.sortOrder), asc(calendarTodos.createdAt));
        return reordered.map(toCalendarTodo);
      }

      const values = input.action === "update"
        ? {
            title: input.title,
            description: input.description,
            estimatedMinutes: input.estimatedMinutes,
            updatedAt: new Date()
          }
        : input.action === "schedule"
          ? { scheduledAt: new Date(input.scheduledAt), updatedAt: new Date() }
          : { scheduledAt: null, sortOrder: await nextTodoSortOrder(db), updatedAt: new Date() };
      const [record] = await db
        .update(calendarTodos)
        .set(values)
        .where(eq(calendarTodos.id, input.id))
        .returning();
      return record ? [toCalendarTodo(record)] : null;
    },

    async delete(connectionString: string, id: string): Promise<boolean> {
      const deleted = await database(connectionString)
        .delete(calendarTodos)
        .where(eq(calendarTodos.id, id))
        .returning({ id: calendarTodos.id });
      return deleted.length > 0;
    }
  }
};

const weekMilliseconds = 7 * 24 * 60 * 60 * 1000;

async function loadNotificationOccurrences(
  db: ReturnType<typeof database>,
  rangeStart: Date,
  rangeEnd: Date,
  eventId?: string
) {
  const records = await db
    .select()
    .from(calendarEvents)
    .where(eventId
      ? eq(calendarEvents.id, eventId)
      : or(
          and(
            isNull(calendarEvents.recurrenceIntervalWeeks),
            gte(calendarEvents.startsAt, rangeStart),
            lt(calendarEvents.startsAt, rangeEnd)
          ),
          and(
            isNotNull(calendarEvents.recurrenceIntervalWeeks),
            lt(calendarEvents.startsAt, rangeEnd)
          )
        ));
  const recurringIds = records
    .filter((record) => record.recurrenceIntervalWeeks !== null)
    .map((record) => record.id);
  const exceptions = recurringIds.length === 0
    ? []
    : await db
        .select()
        .from(calendarEventExceptions)
        .where(inArray(calendarEventExceptions.eventId, recurringIds));
  const exceptionsByEvent = new Map<string, CalendarEventExceptionRecord[]>();
  for (const exception of exceptions) {
    const existing = exceptionsByEvent.get(exception.eventId) ?? [];
    existing.push(exception);
    exceptionsByEvent.set(exception.eventId, existing);
  }
  return records.flatMap((record) => occurrencesInRange(
    record,
    rangeStart,
    rangeEnd,
    exceptionsByEvent.get(record.id) ?? []
  ));
}

function notificationSequenceId(eventId: string, occurrenceStartsAt: string) {
  return `goch-${createHash("sha256").update(`${eventId}:${occurrenceStartsAt}`).digest("hex").slice(0, 32)}`;
}

async function scheduleNtfyNotification(
  provider: NotificationProviderConfig,
  event: CalendarEvent,
  sequenceId: string,
  notifyAt: Date
) {
  assertNtfyProvider(provider);
  const response = await fetch(ntfyMessageUrl(provider, sequenceId), {
    method: "POST",
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "x-title": encodeNtfyHeader(event.title),
      "x-at": String(Math.floor(notifyAt.getTime() / 1000)),
      ...(provider.accessToken ? { authorization: `Bearer ${provider.accessToken}` } : {})
    },
    body: event.notificationMessage || defaultNotificationMessage(event, provider.timeZone),
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`ntfy scheduling failed (${response.status}): ${await response.text()}`);
}

async function cancelNtfyNotification(provider: NotificationProviderConfig, sequenceId: string) {
  assertNtfyProvider(provider);
  const response = await fetch(ntfyMessageUrl(provider, sequenceId), {
    method: "DELETE",
    headers: provider.accessToken ? { authorization: `Bearer ${provider.accessToken}` } : undefined,
    cache: "no-store"
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`ntfy cancellation failed (${response.status}): ${await response.text()}`);
  }
}

function assertNtfyProvider(provider: NotificationProviderConfig) {
  if (!provider.baseUrl || !provider.topic) {
    throw new Error("ntfy is not configured. Add the notification server and topic environment variables.");
  }
}

function ntfyMessageUrl(provider: NotificationProviderConfig, sequenceId: string) {
  return `${provider.baseUrl.replace(/\/$/, "")}/${encodeURIComponent(provider.topic)}/${encodeURIComponent(sequenceId)}`;
}

function encodeNtfyHeader(value: string) {
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function defaultNotificationMessage(event: CalendarEvent, fallbackTimeZone: string) {
  const offset = event.notificationOffsetMinutes ?? 0;
  const lead = offset === 0 ? "now" : `in ${formatLeadTime(offset)}`;
  const time = new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: event.recurrenceTimeZone ?? fallbackTimeZone
  }).format(new Date(event.startsAt));
  return offset === 0 ? `Starts now at ${time}.` : `Starts ${lead} at ${time}.`;
}

function formatLeadTime(minutes: number) {
  if (minutes % (24 * 60) === 0) {
    const days = minutes / (24 * 60);
    return `${days} ${days === 1 ? "day" : "days"}`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 1000) : "Unknown notification provider error.";
}

async function attachDeliveryStates(
  db: ReturnType<typeof database>,
  events: CalendarEvent[]
): Promise<CalendarEvent[]> {
  const eventIds = [...new Set(events.filter((event) => event.notificationEnabled).map((event) => event.id))];
  if (eventIds.length === 0) return events;
  const deliveries = await db
    .select()
    .from(calendarEventNotificationDeliveries)
    .where(inArray(calendarEventNotificationDeliveries.eventId, eventIds));
  const byOccurrence = new Map(deliveries.map((delivery) => [
    `${delivery.eventId}:${delivery.occurrenceStartsAt.toISOString()}`,
    delivery
  ]));
  const now = Date.now();
  return events.map((event) => {
    if (!event.notificationEnabled || !event.notificationAt) return event;
    const delivery = byOccurrence.get(`${event.id}:${event.occurrenceStartsAt}`);
    if (!delivery) return event;
    const notificationState: CalendarEvent["notificationState"] = delivery.state === "scheduled"
      ? new Date(event.notificationAt).getTime() <= now ? "sent" : "scheduled"
      : delivery.state === "failed" ? "failed" : "pending";
    return { ...event, notificationState };
  });
}

function occurrencesInRange(
  record: CalendarEventRecord,
  rangeStart: Date,
  rangeEnd: Date,
  exceptions: CalendarEventExceptionRecord[]
): CalendarEvent[] {
  if (record.recurrenceIntervalWeeks === null) return [toCalendarEvent(record)];

  const interval = record.recurrenceIntervalWeeks * weekMilliseconds;
  const duration = record.endsAt.getTime() - record.startsAt.getTime();
  const approximateIndex = Math.max(0, Math.floor((rangeStart.getTime() - record.endsAt.getTime()) / interval) + 1);
  const firstIndex = Math.max(0, approximateIndex - 1);
  const occurrences: CalendarEvent[] = [];
  const timeZone = validTimeZone(record.recurrenceTimeZone);
  const exceptionsByOccurrence = new Map(
    exceptions.map((exception) => [exception.occurrenceStartsAt.toISOString(), exception])
  );
  const consideredOccurrences = new Set<string>();

  for (let index = firstIndex; ; index += 1) {
    const startsAt = addWeeksInTimeZone(record.startsAt, index * record.recurrenceIntervalWeeks, timeZone);
    if (startsAt >= rangeEnd) break;
    if (record.recurrenceEndsOn && dateKeyInTimeZone(startsAt, timeZone) > record.recurrenceEndsOn) break;

    const endsAt = new Date(startsAt.getTime() + duration);
    const occurrenceKey = startsAt.toISOString();
    consideredOccurrences.add(occurrenceKey);
    const exception = exceptionsByOccurrence.get(occurrenceKey);

    if (exception) {
      if (!exception.isCancelled) {
        const overridden = toExceptionCalendarEvent(record, exception);
        if (eventOverlapsRange(overridden, rangeStart, rangeEnd)) occurrences.push(overridden);
      }
    } else if (endsAt > rangeStart) {
      occurrences.push(toCalendarEvent(record, { startsAt, endsAt, index }));
    }
  }

  for (const exception of exceptions) {
    if (exception.isCancelled || consideredOccurrences.has(exception.occurrenceStartsAt.toISOString())) continue;
    if (record.recurrenceEndsOn && dateKeyInTimeZone(exception.occurrenceStartsAt, timeZone) > record.recurrenceEndsOn) continue;
    const overridden = toExceptionCalendarEvent(record, exception);
    if (eventOverlapsRange(overridden, rangeStart, rangeEnd)) occurrences.push(overridden);
  }

  return occurrences;
}

function toExceptionCalendarEvent(record: CalendarEventRecord, exception: CalendarEventExceptionRecord): CalendarEvent {
  const startsAt = exception.startsAt ?? exception.occurrenceStartsAt;
  const endsAt = exception.endsAt ?? new Date(startsAt.getTime() + record.endsAt.getTime() - record.startsAt.getTime());
  const occurrenceStartsAt = exception.occurrenceStartsAt.toISOString();
  const notificationEnabled = exception.notificationEnabled ?? record.notificationEnabled;
  const notificationOffsetMinutes = exception.notificationEnabled === null
    ? record.notificationOffsetMinutes
    : exception.notificationOffsetMinutes;
  const notificationMessage = exception.notificationEnabled === null
    ? record.notificationMessage
    : exception.notificationMessage;
  const notificationAt = notificationEnabled && notificationOffsetMinutes !== null
    ? new Date(startsAt.getTime() - notificationOffsetMinutes * 60_000).toISOString()
    : null;

  return {
    ...toCalendarEvent(record, { startsAt, endsAt, index: 0 }),
    occurrenceKey: `${record.id}:${occurrenceStartsAt}`,
    title: exception.title ?? record.title,
    description: exception.description ?? record.description,
    color: exception.color ?? record.color,
    notificationEnabled,
    notificationOffsetMinutes,
    notificationMessage,
    notificationAt,
    notificationState: notificationEnabled ? "pending" : "disabled",
    occurrenceStartsAt,
    isOccurrenceOverride: true,
    updatedAt: exception.updatedAt.toISOString()
  };
}

function eventOverlapsRange(event: CalendarEvent, rangeStart: Date, rangeEnd: Date) {
  return new Date(event.startsAt) < rangeEnd && new Date(event.endsAt) > rangeStart;
}

type DateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function shiftSeriesAnchor(anchor: Date, occurrence: Date, requested: Date, timeZone: string) {
  const zone = validTimeZone(timeZone);
  const occurrenceWallTime = partsAsUtc(zonedParts(occurrence, zone));
  const requestedWallTime = partsAsUtc(zonedParts(requested, zone));
  return addWallMilliseconds(anchor, requestedWallTime - occurrenceWallTime, zone);
}

function addWeeksInTimeZone(date: Date, weeks: number, timeZone: string) {
  return addWallMilliseconds(date, weeks * weekMilliseconds, timeZone);
}

function addWallMilliseconds(date: Date, milliseconds: number, timeZone: string) {
  const wallTime = new Date(partsAsUtc(zonedParts(date, timeZone)) + milliseconds);
  return zonedTimeToDate({
    year: wallTime.getUTCFullYear(),
    month: wallTime.getUTCMonth() + 1,
    day: wallTime.getUTCDate(),
    hour: wallTime.getUTCHours(),
    minute: wallTime.getUTCMinutes(),
    second: wallTime.getUTCSeconds()
  }, timeZone);
}

function zonedTimeToDate(parts: DateParts, timeZone: string) {
  const targetWallTime = partsAsUtc(parts);
  let instant = targetWallTime;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const representedWallTime = partsAsUtc(zonedParts(new Date(instant), timeZone));
    instant += targetWallTime - representedWallTime;
  }

  return new Date(instant);
}

function zonedParts(date: Date, timeZone: string): DateParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  const values = Object.fromEntries(
    formatter.formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  );

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second
  };
}

function partsAsUtc(parts: DateParts) {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

function dateKeyInTimeZone(date: Date, timeZone: string) {
  const parts = zonedParts(date, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function validTimeZone(timeZone: string | null) {
  if (!timeZone) return "UTC";

  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
    return timeZone;
  } catch {
    return "UTC";
  }
}

export type AppServices = typeof services;
