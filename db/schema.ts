import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

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
    recurrenceEndsOn: date("recurrence_ends_on"),
    notificationEnabled: boolean("notification_enabled").notNull().default(false),
    notificationOffsetMinutes: integer("notification_offset_minutes"),
    notificationMessage: text("notification_message"),
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
    check(
      "calendar_events_valid_recurrence_end",
      sql`${event.recurrenceIntervalWeeks} is not null or ${event.recurrenceEndsOn} is null`
    ),
    check(
      "calendar_events_valid_notification",
      sql`(${event.notificationEnabled} and ${event.notificationOffsetMinutes} between 0 and 10080) or (not ${event.notificationEnabled} and ${event.notificationOffsetMinutes} is null)`
    ),
    check("calendar_events_valid_color", sql`${event.color} in ('violet', 'blue', 'coral', 'green', 'amber')`)
  ]
);

export type CalendarEventRecord = typeof calendarEvents.$inferSelect;

export const calendarEventExceptions = pgTable(
  "calendar_event_exceptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id").notNull().references(() => calendarEvents.id, { onDelete: "cascade" }),
    occurrenceStartsAt: timestamp("occurrence_starts_at", { withTimezone: true, mode: "date" }).notNull(),
    title: text("title"),
    description: text("description"),
    startsAt: timestamp("starts_at", { withTimezone: true, mode: "date" }),
    endsAt: timestamp("ends_at", { withTimezone: true, mode: "date" }),
    color: text("color").$type<EventColor>(),
    notificationEnabled: boolean("notification_enabled"),
    notificationOffsetMinutes: integer("notification_offset_minutes"),
    notificationMessage: text("notification_message"),
    isCancelled: boolean("is_cancelled").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow()
  },
  (exception) => [
    uniqueIndex("calendar_event_exceptions_occurrence_idx").on(exception.eventId, exception.occurrenceStartsAt),
    index("calendar_event_exceptions_starts_at_idx").on(exception.startsAt),
    check(
      "calendar_event_exceptions_valid_range",
      sql`${exception.isCancelled} or (${exception.startsAt} is not null and ${exception.endsAt} > ${exception.startsAt})`
    ),
    check(
      "calendar_event_exceptions_valid_color",
      sql`${exception.color} is null or ${exception.color} in ('violet', 'blue', 'coral', 'green', 'amber')`
    ),
    check(
      "calendar_event_exceptions_valid_notification",
      sql`${exception.notificationEnabled} is null or (${exception.notificationEnabled} and ${exception.notificationOffsetMinutes} between 0 and 10080) or (not ${exception.notificationEnabled} and ${exception.notificationOffsetMinutes} is null)`
    )
  ]
);

export type CalendarEventExceptionRecord = typeof calendarEventExceptions.$inferSelect;

export const notificationDeliveryStates = ["pending", "scheduled", "cancel_pending", "cancelled", "failed"] as const;
export type NotificationDeliveryState = (typeof notificationDeliveryStates)[number];

export const calendarEventNotificationDeliveries = pgTable(
  "calendar_event_notification_deliveries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id").references(() => calendarEvents.id, { onDelete: "set null" }),
    occurrenceStartsAt: timestamp("occurrence_starts_at", { withTimezone: true, mode: "date" }).notNull(),
    notifyAt: timestamp("notify_at", { withTimezone: true, mode: "date" }).notNull(),
    providerSequenceId: text("provider_sequence_id").notNull(),
    state: text("state").$type<NotificationDeliveryState>().notNull().default("pending"),
    providerScheduledAt: timestamp("provider_scheduled_at", { withTimezone: true, mode: "date" }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow()
  },
  (delivery) => [
    uniqueIndex("calendar_event_notification_deliveries_occurrence_idx").on(delivery.eventId, delivery.occurrenceStartsAt),
    uniqueIndex("calendar_event_notification_deliveries_sequence_idx").on(delivery.providerSequenceId),
    index("calendar_event_notification_deliveries_notify_at_idx").on(delivery.notifyAt),
    index("calendar_event_notification_deliveries_state_idx").on(delivery.state),
    check(
      "calendar_event_notification_deliveries_valid_state",
      sql`${delivery.state} in ('pending', 'scheduled', 'cancel_pending', 'cancelled', 'failed')`
    )
  ]
);

export type CalendarEventNotificationDeliveryRecord = typeof calendarEventNotificationDeliveries.$inferSelect;

export const calendarTodos = pgTable(
  "calendar_todos",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    estimatedMinutes: integer("estimated_minutes"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true, mode: "date" }),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow()
  },
  (todo) => [
    index("calendar_todos_scheduled_at_idx").on(todo.scheduledAt),
    index("calendar_todos_sort_order_idx").on(todo.sortOrder),
    check(
      "calendar_todos_valid_estimate",
      sql`${todo.estimatedMinutes} is null or ${todo.estimatedMinutes} between 15 and 900`
    ),
    check("calendar_todos_valid_sort_order", sql`${todo.sortOrder} >= 0`)
  ]
);

export type CalendarTodoRecord = typeof calendarTodos.$inferSelect;
