import { neon } from "@neondatabase/serverless";
import { and, asc, eq, gt, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import { calendarEvents, type CalendarEventRecord, type EventColor } from "@/db/schema";
import type { CreateEventInput, UpdateEventInput } from "@/nextsignal/schemas";

export type CalendarEvent = {
  id: string;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
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

function toCalendarEvent(record: CalendarEventRecord): CalendarEvent {
  return {
    ...record,
    startsAt: record.startsAt.toISOString(),
    endsAt: record.endsAt.toISOString(),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString()
  };
}

export const services = {
  events: {
    async list(connectionString: string, weekStart: string, weekEnd: string): Promise<CalendarEvent[]> {
      const records = await database(connectionString)
        .select()
        .from(calendarEvents)
        .where(and(
          lt(calendarEvents.startsAt, new Date(weekEnd)),
          gt(calendarEvents.endsAt, new Date(weekStart))
        ))
        .orderBy(asc(calendarEvents.startsAt));

      return records.map(toCalendarEvent);
    },

    async create(connectionString: string, input: CreateEventInput): Promise<CalendarEvent> {
      const [record] = await database(connectionString)
        .insert(calendarEvents)
        .values({
          title: input.title,
          description: input.description,
          startsAt: new Date(input.startsAt),
          endsAt: new Date(input.endsAt),
          color: input.color
        })
        .returning();

      return toCalendarEvent(record);
    },

    async update(connectionString: string, input: UpdateEventInput): Promise<CalendarEvent | null> {
      const [record] = await database(connectionString)
        .update(calendarEvents)
        .set({
          title: input.title,
          description: input.description,
          startsAt: new Date(input.startsAt),
          endsAt: new Date(input.endsAt),
          color: input.color,
          updatedAt: new Date()
        })
        .where(eq(calendarEvents.id, input.id))
        .returning();

      return record ? toCalendarEvent(record) : null;
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

export type AppServices = typeof services;
