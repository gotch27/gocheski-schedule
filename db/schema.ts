import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const eventColors = ["violet", "blue", "coral", "green", "amber"] as const;
export type EventColor = (typeof eventColors)[number];

export const calendarEvents = pgTable(
  "calendar_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    startsAt: timestamp("starts_at", { withTimezone: true, mode: "date" }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true, mode: "date" }).notNull(),
    recurrenceIntervalWeeks: integer("recurrence_interval_weeks"),
    recurrenceTimeZone: text("recurrence_time_zone"),
    color: text("color").$type<EventColor>().notNull().default("violet"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow()
  },
  (event) => [
    index("calendar_events_starts_at_idx").on(event.startsAt),
    check("calendar_events_valid_range", sql`${event.endsAt} > ${event.startsAt}`),
    check(
      "calendar_events_valid_recurrence_interval",
      sql`${event.recurrenceIntervalWeeks} is null or ${event.recurrenceIntervalWeeks} between 1 and 52`
    ),
    check("calendar_events_valid_color", sql`${event.color} in ('violet', 'blue', 'coral', 'green', 'amber')`)
  ]
);

export type CalendarEventRecord = typeof calendarEvents.$inferSelect;
