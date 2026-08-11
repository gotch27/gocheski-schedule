import { neon } from "@neondatabase/serverless";
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import {
  calendarEventExceptions,
  calendarEvents,
  calendarTodos,
  type CalendarEventExceptionRecord,
  type CalendarEventRecord,
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

      return allRecords
        .flatMap((record) => occurrencesInRange(
          record,
          rangeStart,
          rangeEnd,
          exceptionsByEvent.get(record.id) ?? []
        ))
        .sort((left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime());
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
        await db
          .insert(calendarEventExceptions)
          .values({
            eventId: existing.id,
            occurrenceStartsAt: new Date(input.occurrenceStartsAt),
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

      const deleted = await db
        .delete(calendarEvents)
        .where(eq(calendarEvents.id, input.id))
        .returning({ id: calendarEvents.id });

      return deleted.length > 0;
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

  return {
    ...toCalendarEvent(record, { startsAt, endsAt, index: 0 }),
    occurrenceKey: `${record.id}:${occurrenceStartsAt}`,
    title: exception.title ?? record.title,
    description: exception.description ?? record.description,
    color: exception.color ?? record.color,
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
