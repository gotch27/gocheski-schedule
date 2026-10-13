import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const eventColors = ["violet", "blue", "coral", "green", "amber"] as const;
export type EventColor = (typeof eventColors)[number];
export type CalendarEventColor = EventColor | `#${string}`;

export const calendarLabels = pgTable("calendar_labels", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  color: text("color").$type<`#${string}`>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow()
}, (label) => [
  check("calendar_labels_valid_name", sql`length(trim(${label.name})) between 1 and 60`),
  check("calendar_labels_valid_color", sql`${label.color} ~ '^#[0-9a-fA-F]{6}$'`)
]);

export type CalendarLabelRecord = typeof calendarLabels.$inferSelect;

export const calendarGoals = pgTable("calendar_goals", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  startsOn: date("starts_on"),
  endsOn: date("ends_on"),
  timeZone: text("time_zone").notNull(),
  color: text("color").$type<EventColor>().notNull().default("violet"),
  achieved: boolean("achieved").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow()
}, (goal) => [
  check("calendar_goals_valid_range", sql`(${goal.startsOn} is null and ${goal.endsOn} is null) or (${goal.startsOn} is not null and ${goal.endsOn} is not null and ${goal.endsOn} >= ${goal.startsOn})`),
  check("calendar_goals_valid_color", sql`${goal.color} in ('violet', 'blue', 'coral', 'green', 'amber')`)
]);

export type CalendarGoalRecord = typeof calendarGoals.$inferSelect;

export const calendarEvents = pgTable(
  "calendar_events",
  {
    labelId: uuid("label_id").references(() => calendarLabels.id, { onDelete: "set null" }),
    goalId: uuid("goal_id").references(() => calendarGoals.id, { onDelete: "set null" }),
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
    color: text("color").$type<CalendarEventColor>().notNull().default("violet"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow()
  },
  (event) => [
    index("calendar_events_goal_id_idx").on(event.goalId),
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
    check("calendar_events_valid_color", sql`${event.color} in ('violet', 'blue', 'coral', 'green', 'amber') or ${event.color} ~ '^#[0-9a-fA-F]{6}$'`)
  ]
);

export type CalendarEventRecord = typeof calendarEvents.$inferSelect;

export const calendarEventExceptions = pgTable(
  "calendar_event_exceptions",
  {
    labelId: uuid("label_id").references(() => calendarLabels.id, { onDelete: "set null" }),
    labelIsOverridden: boolean("label_is_overridden").notNull().default(false),
    goalId: uuid("goal_id").references(() => calendarGoals.id, { onDelete: "set null" }),
    goalIsOverridden: boolean("goal_is_overridden").notNull().default(false),
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id").notNull().references(() => calendarEvents.id, { onDelete: "cascade" }),
    occurrenceStartsAt: timestamp("occurrence_starts_at", { withTimezone: true, mode: "date" }).notNull(),
    title: text("title"),
    description: text("description"),
    startsAt: timestamp("starts_at", { withTimezone: true, mode: "date" }),
    endsAt: timestamp("ends_at", { withTimezone: true, mode: "date" }),
    color: text("color").$type<CalendarEventColor>(),
    notificationEnabled: boolean("notification_enabled"),
    notificationOffsetMinutes: integer("notification_offset_minutes"),
    notificationMessage: text("notification_message"),
    isCancelled: boolean("is_cancelled").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow()
  },
  (exception) => [
    index("calendar_event_exceptions_goal_id_idx").on(exception.goalId),
    uniqueIndex("calendar_event_exceptions_occurrence_idx").on(exception.eventId, exception.occurrenceStartsAt),
    index("calendar_event_exceptions_starts_at_idx").on(exception.startsAt),
    check(
      "calendar_event_exceptions_valid_range",
      sql`${exception.isCancelled} or (${exception.startsAt} is not null and ${exception.endsAt} > ${exception.startsAt})`
    ),
    check(
      "calendar_event_exceptions_valid_color",
      sql`${exception.color} is null or ${exception.color} in ('violet', 'blue', 'coral', 'green', 'amber') or ${exception.color} ~ '^#[0-9a-fA-F]{6}$'`
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
    goalId: uuid("goal_id").references(() => calendarGoals.id, { onDelete: "set null" }),
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
    index("calendar_todos_goal_id_idx").on(todo.goalId),
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

export const calendarToBuyItems = pgTable(
  "calendar_to_buy_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    url: text("url"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true, mode: "date" }),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow()
  },
  (item) => [
    index("calendar_to_buy_items_sort_order_idx").on(item.sortOrder),
    index("calendar_to_buy_items_scheduled_at_idx").on(item.scheduledAt),
    check("calendar_to_buy_items_valid_sort_order", sql`${item.sortOrder} >= 0`)
  ]
);

export type CalendarToBuyItemRecord = typeof calendarToBuyItems.$inferSelect;
