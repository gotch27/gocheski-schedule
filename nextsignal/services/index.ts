import { neon } from "@neondatabase/serverless";
import { and, asc, eq, gt, isNotNull, isNull, lt, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import { calendarEvents, type CalendarEventRecord, type EventColor } from "@/db/schema";
import type { CreateEventInput, UpdateEventInput } from "@/nextsignal/schemas";

export type CalendarEvent = {
  id: string;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  recurrenceIntervalWeeks: number | null;
  recurrenceTimeZone: string | null;
  recurrenceAnchorStartsAt: string;
  occurrenceStartsAt: string;
  color: EventColor;
  createdAt: string;
  updatedAt: string;
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
    startsAt: occurrence.startsAt.toISOString(),
    endsAt: occurrence.endsAt.toISOString(),
    recurrenceAnchorStartsAt: record.startsAt.toISOString(),
    occurrenceStartsAt: occurrence.startsAt.toISOString(),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString()
  };
}

export const services = {
  events: {
    async list(connectionString: string, weekStart: string, weekEnd: string): Promise<CalendarEvent[]> {
      const rangeStart = new Date(weekStart);
      const rangeEnd = new Date(weekEnd);
      const records = await database(connectionString)
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

      return records
        .flatMap((record) => occurrencesInRange(record, rangeStart, rangeEnd))
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
          color: input.color,
          updatedAt: new Date()
        })
        .where(eq(calendarEvents.id, input.id))
        .returning();

      return record
        ? toCalendarEvent(record, { startsAt: requestedStart, endsAt: requestedEnd, index: 0 })
        : null;
    },

    async delete(connectionString: string, id: string): Promise<boolean> {
      const deleted = await database(connectionString)
        .delete(calendarEvents)
        .where(eq(calendarEvents.id, id))
        .returning({ id: calendarEvents.id });

      return deleted.length > 0;
    }
  }
};

const weekMilliseconds = 7 * 24 * 60 * 60 * 1000;

function occurrencesInRange(record: CalendarEventRecord, rangeStart: Date, rangeEnd: Date): CalendarEvent[] {
  if (record.recurrenceIntervalWeeks === null) return [toCalendarEvent(record)];

  const interval = record.recurrenceIntervalWeeks * weekMilliseconds;
  const duration = record.endsAt.getTime() - record.startsAt.getTime();
  const approximateIndex = Math.max(0, Math.floor((rangeStart.getTime() - record.endsAt.getTime()) / interval) + 1);
  const firstIndex = Math.max(0, approximateIndex - 1);
  const occurrences: CalendarEvent[] = [];
  const timeZone = validTimeZone(record.recurrenceTimeZone);

  for (let index = firstIndex; ; index += 1) {
    const startsAt = addWeeksInTimeZone(record.startsAt, index * record.recurrenceIntervalWeeks, timeZone);
    if (startsAt >= rangeEnd) break;

    const endsAt = new Date(startsAt.getTime() + duration);
    if (endsAt > rangeStart) occurrences.push(toCalendarEvent(record, { startsAt, endsAt, index }));
  }

  return occurrences;
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
