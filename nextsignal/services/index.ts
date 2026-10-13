import {
  calculateGoalStatistics,
  goalBounds,
  type GoalStatistics,
  type GoalTask
} from "@/nextsignal/services/goal-statistics";
import {
  shiftSeriesAnchor,
  addWeeksInTimeZone,
  dateKeyInTimeZone,
  validTimeZone
} from "@/nextsignal/services/calendar-time";
import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import {
  calendarEventExceptions,
  calendarEventNotificationDeliveries,
  calendarEvents,
  calendarLabels,
  type CalendarLabelRecord,
  type CalendarEventColor,
  calendarGoals,
  type CalendarGoalRecord,
  calendarToBuyItems,
  calendarTodos,
  type CalendarEventExceptionRecord,
  type CalendarEventRecord,
  type CalendarEventNotificationDeliveryRecord,
  type CalendarToBuyItemRecord,
  type CalendarTodoRecord
} from "@/db/schema";
import type {
  CreateEventInput,
  CreateLabelInput,
  UpdateLabelInput,
  CreateGoalInput,
  UpdateGoalInput,
  CreateToBuyItemInput,
  CreateTodoInput,
  DeleteToBuyItemInput,
  DeleteEventInput,
  UpdateToBuyItemInput,
  UpdateEventInput,
  UpdateTodoInput
} from "@/nextsignal/schemas";

export type CalendarGoal = Omit<CalendarGoalRecord, "createdAt" | "updatedAt"> & {
  createdAt: string;
  updatedAt: string;
};
export type CalendarLabel = Omit<CalendarLabelRecord, "createdAt" | "updatedAt"> & {
  createdAt: string;
  updatedAt: string;
};
function toCalendarLabel(record: CalendarLabelRecord): CalendarLabel {
  return {
    ...record,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString()
  };
}
export type GoalWithStatistics = CalendarGoal & { statistics: GoalStatistics };
function toCalendarGoal(record: CalendarGoalRecord): CalendarGoal {
  return {
    ...record,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString()
  };
}

export type CalendarEvent = {
  labelId: string | null;
  goalId: string | null;
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
  color: CalendarEventColor;
  createdAt: string;
  updatedAt: string;
};

export type CalendarTodo = {
  goalId: string | null;
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

export type CalendarToBuyItem = {
  id: string;
  title: string;
  description: string;
  url: string | null;
  scheduledAt: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type CalendarToBuyItemList = {
  list: CalendarToBuyItem[];
  scheduled: CalendarToBuyItem[];
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

function toCalendarToBuyItem(record: CalendarToBuyItemRecord): CalendarToBuyItem {
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

async function nextToBuySortOrder(db: ReturnType<typeof database>) {
  const [lastItem] = await db
    .select({ sortOrder: calendarToBuyItems.sortOrder })
    .from(calendarToBuyItems)
    .where(isNull(calendarToBuyItems.scheduledAt))
    .orderBy(desc(calendarToBuyItems.sortOrder))
    .limit(1);
  return (lastItem?.sortOrder ?? -1) + 1;
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
  labels: {
    async list(connectionString: string): Promise<CalendarLabel[]> {
      return (
        await database(connectionString)
          .select()
          .from(calendarLabels)
          .orderBy(asc(calendarLabels.createdAt), asc(calendarLabels.id))
      ).map(toCalendarLabel);
    },
    async find(connectionString: string, id: string): Promise<CalendarLabel | null> {
      const [record] = await database(connectionString)
        .select()
        .from(calendarLabels)
        .where(eq(calendarLabels.id, id))
        .limit(1);
      return record ? toCalendarLabel(record) : null;
    },
    async create(connectionString: string, input: CreateLabelInput): Promise<CalendarLabel> {
      const [record] = await database(connectionString)
        .insert(calendarLabels)
        .values(input)
        .returning();
      return toCalendarLabel(record);
    },
    async update(connectionString: string, input: UpdateLabelInput): Promise<CalendarLabel | null> {
      const db = database(connectionString);
      // Keep a color snapshot on events so removing a label preserves their appearance.
      const [updated] = await db.batch([
        db
          .update(calendarLabels)
          .set({ name: input.name, color: input.color, updatedAt: new Date() })
          .where(eq(calendarLabels.id, input.id))
          .returning(),
        db
          .update(calendarEvents)
          .set({ color: input.color })
          .where(eq(calendarEvents.labelId, input.id)),
        db
          .update(calendarEventExceptions)
          .set({ color: input.color })
          .where(
            or(
              eq(calendarEventExceptions.labelId, input.id),
              and(
                eq(calendarEventExceptions.labelIsOverridden, false),
                inArray(
                  calendarEventExceptions.eventId,
                  db
                    .select({ id: calendarEvents.id })
                    .from(calendarEvents)
                    .where(eq(calendarEvents.labelId, input.id))
                )
              )
            )
          )
      ]);
      return updated[0] ? toCalendarLabel(updated[0]) : null;
    },
    async delete(connectionString: string, id: string): Promise<boolean> {
      return (
        (
          await database(connectionString)
            .delete(calendarLabels)
            .where(eq(calendarLabels.id, id))
            .returning({ id: calendarLabels.id })
        ).length > 0
      );
    }
  },
  goals: {
    async list(connectionString: string): Promise<CalendarGoal[]> {
      return (
        await database(connectionString)
          .select()
          .from(calendarGoals)
          .orderBy(asc(calendarGoals.startsOn), asc(calendarGoals.createdAt))
      ).map(toCalendarGoal);
    },
    async exists(connectionString: string, id: string): Promise<boolean> {
      return (
        (
          await database(connectionString)
            .select({ id: calendarGoals.id })
            .from(calendarGoals)
            .where(eq(calendarGoals.id, id))
            .limit(1)
        ).length > 0
      );
    },
    async create(connectionString: string, input: CreateGoalInput): Promise<CalendarGoal> {
      const [record] = await database(connectionString)
        .insert(calendarGoals)
        .values({
          title: input.title,
          description: input.description,
          startsOn: input.startsOn,
          endsOn: input.endsOn,
          timeZone: input.timeZone,
          color: input.color,
          achieved: input.achieved
        })
        .returning();
      return toCalendarGoal(record);
    },
    async update(connectionString: string, input: UpdateGoalInput): Promise<CalendarGoal | null> {
      const [record] = await database(connectionString)
        .update(calendarGoals)
        .set({
          title: input.title,
          description: input.description,
          startsOn: input.startsOn,
          endsOn: input.endsOn,
          color: input.color,
          achieved: input.achieved,
          updatedAt: new Date()
        })
        .where(eq(calendarGoals.id, input.id))
        .returning();
      return record ? toCalendarGoal(record) : null;
    },
    async delete(connectionString: string, id: string): Promise<boolean> {
      return (
        (
          await database(connectionString)
            .delete(calendarGoals)
            .where(eq(calendarGoals.id, id))
            .returning({ id: calendarGoals.id })
        ).length > 0
      );
    },
    async statistics(connectionString: string): Promise<GoalWithStatistics[]> {
      const goals = await services.goals.list(connectionString);
      if (!goals.length) return [];
      const db = database(connectionString);
      const linkedMasters = db
        .select({ id: calendarEvents.id })
        .from(calendarEvents)
        .where(isNotNull(calendarEvents.goalId));
      const [exceptions, todos] = await Promise.all([
        db
          .select()
          .from(calendarEventExceptions)
          .where(
            or(
              eq(calendarEventExceptions.goalIsOverridden, true),
              inArray(calendarEventExceptions.eventId, linkedMasters)
            )
          ),
        db.select().from(calendarTodos).where(isNotNull(calendarTodos.goalId))
      ]);
      const overriddenIds = [...new Set(exceptions.map((exception) => exception.eventId))];
      const records = await db
        .select()
        .from(calendarEvents)
        .where(
          or(
            isNotNull(calendarEvents.goalId),
            ...(overriddenIds.length ? [inArray(calendarEvents.id, overriddenIds)] : [])
          )
        );
      const exceptionsByEvent = new Map<string, CalendarEventExceptionRecord[]>();
      for (const exception of exceptions) {
        const existing = exceptionsByEvent.get(exception.eventId) ?? [];
        existing.push(exception);
        exceptionsByEvent.set(exception.eventId, existing);
      }
      const now = new Date();
      return goals.map((goal) => {
        const bounds = goalBounds(goal);
        const horizon = addWeeksInTimeZone(now, 12, goal.timeZone);
        const candidates = records.filter(
          (record) =>
            record.goalId === goal.id ||
            exceptionsByEvent
              .get(record.id)
              ?.some((exception) => exception.goalIsOverridden && exception.goalId === goal.id)
        );
        const events = candidates.flatMap((record) => {
          const seriesExceptions = exceptionsByEvent.get(record.id) ?? [];
          const start =
            bounds.start ??
            new Date(
              Math.min(
                record.startsAt.getTime(),
                ...seriesExceptions.map((exception) =>
                  (exception.startsAt ?? exception.occurrenceStartsAt).getTime()
                )
              )
            );
          return occurrencesInRange(record, start, bounds.end ?? horizon, seriesExceptions);
        });
        const tasks: GoalTask[] = events
          .filter(
            (event) =>
              event.goalId === goal.id &&
              (!bounds.start || new Date(event.endsAt) > bounds.start) &&
              (!bounds.end || new Date(event.startsAt) < bounds.end)
          )
          .map((event) => ({
            id: event.occurrenceKey,
            kind: "event",
            title: event.title,
            startsAt: event.startsAt,
            endsAt: event.endsAt
          }));
        tasks.push(
          ...todos
            .filter((todo) => todo.goalId === goal.id)
            .map((todo): GoalTask => ({
              id: todo.id,
              kind: "todo",
              title: todo.title,
              startsAt: todo.scheduledAt?.toISOString() ?? null,
              endsAt:
                todo.scheduledAt && todo.estimatedMinutes !== null
                  ? new Date(
                      todo.scheduledAt.getTime() + todo.estimatedMinutes * 60_000
                    ).toISOString()
                  : null
            }))
        );
        return { ...goal, statistics: calculateGoalStatistics(goal, tasks, now) };
      });
    }
  },
  events: {
    async findSeries(connectionString: string, id: string): Promise<CalendarEvent | null> {
      const [record] = await database(connectionString)
        .select()
        .from(calendarEvents)
        .where(eq(calendarEvents.id, id))
        .limit(1);
      return record ? toCalendarEvent(record) : null;
    },

    async list(connectionString: string, weekStart: string, weekEnd: string, includeDeliveryStates = true): Promise<CalendarEvent[]> {
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
      return includeDeliveryStates ? attachDeliveryStates(db, occurrences) : occurrences;
    },

    async create(connectionString: string, input: CreateEventInput): Promise<CalendarEvent> {
      const [record] = await database(connectionString)
        .insert(calendarEvents)
        .values({
          labelId: input.labelId,
          goalId: input.goalId,
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

      if (
        input.scope === "occurrence" &&
        existing.recurrenceIntervalWeeks !== null &&
        input.occurrenceStartsAt
      ) {
        const occurrenceStartsAt = new Date(input.occurrenceStartsAt);
        const [previousException] = await db
          .select()
          .from(calendarEventExceptions)
          .where(
            and(
              eq(calendarEventExceptions.eventId, existing.id),
              eq(calendarEventExceptions.occurrenceStartsAt, occurrenceStartsAt)
            )
          )
          .limit(1);
        const goalIsOverridden =
          previousException?.goalIsOverridden === true || input.goalId !== undefined;
        const labelIsOverridden =
          previousException?.labelIsOverridden === true || input.labelId !== undefined;
        await queueDeliveryCancellations(db, existing.id, occurrenceStartsAt);
        const [exception] = await db
          .insert(calendarEventExceptions)
          .values({
            eventId: existing.id,
            occurrenceStartsAt,
            labelIsOverridden,
            labelId: input.labelId === undefined ? previousException?.labelId : input.labelId,
            goalIsOverridden,
            goalId: input.goalId,
            title: input.title,
            description: input.description,
            startsAt: new Date(input.startsAt),
            endsAt: new Date(input.endsAt),
            color: input.color,
            notificationEnabled: input.notificationEnabled,
            notificationOffsetMinutes: input.notificationEnabled
              ? input.notificationOffsetMinutes
              : null,
            notificationMessage: input.notificationEnabled ? input.notificationMessage : null,
            isCancelled: false
          })
          .onConflictDoUpdate({
            target: [calendarEventExceptions.eventId, calendarEventExceptions.occurrenceStartsAt],
            set: {
              labelIsOverridden,
              labelId: input.labelId,
              goalIsOverridden,
              goalId: input.goalId,
              title: input.title,
              description: input.description,
              startsAt: new Date(input.startsAt),
              endsAt: new Date(input.endsAt),
              color: input.color,
              notificationEnabled: input.notificationEnabled,
              notificationOffsetMinutes: input.notificationEnabled
                ? input.notificationOffsetMinutes
                : null,
              notificationMessage: input.notificationEnabled ? input.notificationMessage : null,
              isCancelled: false,
              updatedAt: new Date()
            }
          })
          .returning();

        return toExceptionCalendarEvent(existing, exception);
      }

      // A series edit from an overridden occurrence must keep the master's label color
      // when the request does not explicitly change its label.
      if (input.labelId === undefined && existing.labelId !== null) {
        input = { ...input, color: existing.color };
      }
      const requestedStart = new Date(input.startsAt);
      const requestedEnd = new Date(input.endsAt);
      const duration = requestedEnd.getTime() - requestedStart.getTime();
      let storedStart = requestedStart;
      const recurrenceTimeZone =
        input.recurrenceIntervalWeeks === null
          ? null
          : (input.recurrenceTimeZone ?? existing.recurrenceTimeZone ?? "UTC");

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
      const updateSeries = db
        .update(calendarEvents)
        .set({
          labelId: input.labelId,
          goalId: input.goalId,
          title: input.title,
          description: input.description,
          startsAt: storedStart,
          endsAt: storedEnd,
          recurrenceIntervalWeeks: input.recurrenceIntervalWeeks,
          recurrenceTimeZone,
          recurrenceEndsOn: input.recurrenceIntervalWeeks === null ? null : input.recurrenceEndsOn,
          notificationEnabled: input.notificationEnabled,
          notificationOffsetMinutes: input.notificationEnabled
            ? input.notificationOffsetMinutes
            : null,
          notificationMessage: input.notificationEnabled ? input.notificationMessage : null,
          color: input.color,
          updatedAt: new Date()
        })
        .where(eq(calendarEvents.id, input.id))
        .returning();

      const seriesFieldsChanged =
        existing.title !== input.title ||
        existing.description !== input.description ||
        existing.startsAt.getTime() !== storedStart.getTime() ||
        existing.endsAt.getTime() !== storedEnd.getTime() ||
        existing.recurrenceIntervalWeeks !== input.recurrenceIntervalWeeks ||
        existing.recurrenceTimeZone !== recurrenceTimeZone ||
        existing.recurrenceEndsOn !== input.recurrenceEndsOn ||
        existing.notificationEnabled !== input.notificationEnabled ||
        existing.notificationOffsetMinutes !== input.notificationOffsetMinutes ||
        existing.notificationMessage !== input.notificationMessage;
      let record: CalendarEventRecord | undefined;
      if (seriesFieldsChanged) {
        const retained =
          existing.recurrenceIntervalWeeks !== null && input.recurrenceIntervalWeeks !== null
            ? await db
                .select()
                .from(calendarEventExceptions)
                .where(
                  and(
                    eq(calendarEventExceptions.eventId, input.id),
                    or(
                      eq(calendarEventExceptions.goalIsOverridden, true),
                      eq(calendarEventExceptions.labelIsOverridden, true)
                    )
                  )
                )
            : [];
        const rebased = rebaseGoalExceptions(
          existing,
          retained,
          storedStart,
          duration,
          input.recurrenceIntervalWeeks ?? 1,
          recurrenceTimeZone ?? "UTC"
        );
        const clearExceptions = db
          .delete(calendarEventExceptions)
          .where(eq(calendarEventExceptions.eventId, input.id));
        // Rebase occurrence keys atomically, including shifts onto another occurrence's old key.
        if (rebased.length) {
          const [updated] = await db.batch([
            updateSeries,
            clearExceptions,
            db.insert(calendarEventExceptions).values(rebased)
          ]);
          record = updated[0];
        } else {
          const [updated] = await db.batch([updateSeries, clearExceptions]);
          record = updated[0];
        }
      } else {
        // Label-only edits preserve occurrence timing and cancellations. Exceptions
        // without an explicit label choice follow the new series color.
        const [updated] = await db.batch([
          updateSeries,
          db
            .update(calendarEventExceptions)
            .set({ color: input.color })
            .where(
              and(
                eq(calendarEventExceptions.eventId, input.id),
                eq(calendarEventExceptions.labelIsOverridden, false)
              )
            )
        ]);
        record = updated[0];
      }

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
              labelId: null,
              labelIsOverridden: false,
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
    async find(connectionString: string, id: string): Promise<CalendarTodo | null> {
      const [record] = await database(connectionString)
        .select()
        .from(calendarTodos)
        .where(eq(calendarTodos.id, id))
        .limit(1);
      return record ? toCalendarTodo(record) : null;
    },

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
          goalId: input.goalId,
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
            goalId: input.goalId,
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
  },

  toBuyItems: {
    async find(connectionString: string, id: string): Promise<CalendarToBuyItem | null> {
      const [record] = await database(connectionString)
        .select()
        .from(calendarToBuyItems)
        .where(eq(calendarToBuyItems.id, id))
        .limit(1);
      return record ? toCalendarToBuyItem(record) : null;
    },

    async list(connectionString: string, weekStart: string, weekEnd: string): Promise<CalendarToBuyItemList> {
      const db = database(connectionString);
      const rangeStart = new Date(weekStart);
      const rangeEnd = new Date(weekEnd);
      const [listRecords, scheduledRecords] = await Promise.all([
        db
          .select()
          .from(calendarToBuyItems)
          .where(isNull(calendarToBuyItems.scheduledAt))
          .orderBy(asc(calendarToBuyItems.sortOrder), asc(calendarToBuyItems.createdAt)),
        db
          .select()
          .from(calendarToBuyItems)
          .where(and(
            isNotNull(calendarToBuyItems.scheduledAt),
            gte(calendarToBuyItems.scheduledAt, rangeStart),
            lt(calendarToBuyItems.scheduledAt, rangeEnd)
          ))
          .orderBy(asc(calendarToBuyItems.scheduledAt))
      ]);
      return {
        list: listRecords.map(toCalendarToBuyItem),
        scheduled: scheduledRecords.map(toCalendarToBuyItem)
      };
    },

    async create(connectionString: string, input: CreateToBuyItemInput): Promise<CalendarToBuyItem> {
      const db = database(connectionString);
      const [record] = await db
        .insert(calendarToBuyItems)
        .values({
          title: input.title,
          description: input.description,
          url: input.url,
          scheduledAt: null,
          sortOrder: await nextToBuySortOrder(db)
        })
        .returning();
      return toCalendarToBuyItem(record);
    },

    async update(connectionString: string, input: UpdateToBuyItemInput): Promise<CalendarToBuyItem[] | null> {
      const db = database(connectionString);
      if (input.action === "reorder") {
        const existing = await db
          .select({ id: calendarToBuyItems.id })
          .from(calendarToBuyItems)
          .where(and(isNull(calendarToBuyItems.scheduledAt), inArray(calendarToBuyItems.id, input.orderedIds)));
        if (existing.length !== input.orderedIds.length) return null;
        for (const [sortOrder, id] of input.orderedIds.entries()) {
          await db
            .update(calendarToBuyItems)
            .set({ sortOrder, updatedAt: new Date() })
            .where(and(eq(calendarToBuyItems.id, id), isNull(calendarToBuyItems.scheduledAt)));
        }
        const reordered = await db
          .select()
          .from(calendarToBuyItems)
          .where(isNull(calendarToBuyItems.scheduledAt))
          .orderBy(asc(calendarToBuyItems.sortOrder), asc(calendarToBuyItems.createdAt));
        return reordered.map(toCalendarToBuyItem);
      }

      const values = input.action === "update"
        ? {
            title: input.title,
            description: input.description,
            url: input.url,
            updatedAt: new Date()
          }
        : input.action === "schedule"
          ? { scheduledAt: new Date(input.scheduledAt), updatedAt: new Date() }
          : { scheduledAt: null, sortOrder: await nextToBuySortOrder(db), updatedAt: new Date() };
      const [record] = await db
        .update(calendarToBuyItems)
        .set(values)
        .where(eq(calendarToBuyItems.id, input.id))
        .returning();
      return record ? [toCalendarToBuyItem(record)] : null;
    },

    async delete(connectionString: string, input: DeleteToBuyItemInput): Promise<boolean> {
      const deleted = await database(connectionString)
        .delete(calendarToBuyItems)
        .where(eq(calendarToBuyItems.id, input.id))
        .returning({ id: calendarToBuyItems.id });
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

/** A series edit resets occurrence fields, but preserves explicit goal and label choices at the same occurrence index. */
export function rebaseGoalExceptions(
  previous: CalendarEventRecord,
  exceptions: CalendarEventExceptionRecord[],
  startsAt: Date,
  duration: number,
  intervalWeeks: number,
  timeZone: string
): CalendarEventExceptionRecord[] {
  const oldZone = validTimeZone(previous.recurrenceTimeZone);
  const anchorDay = Date.parse(dateKeyInTimeZone(previous.startsAt, oldZone));
  return exceptions.map((exception) => {
    const occurrenceDay = Date.parse(dateKeyInTimeZone(exception.occurrenceStartsAt, oldZone));
    const index = Math.max(0, Math.round((occurrenceDay - anchorDay) / (weekMilliseconds * (previous.recurrenceIntervalWeeks ?? 1))));
    const occurrenceStartsAt = addWeeksInTimeZone(startsAt, index * intervalWeeks, timeZone);
    return {
      ...exception, occurrenceStartsAt, startsAt: occurrenceStartsAt,
      endsAt: new Date(occurrenceStartsAt.getTime() + duration),
      title: null, description: null, color: exception.labelIsOverridden ? exception.color : null,
      notificationEnabled: null, notificationOffsetMinutes: null, notificationMessage: null,
      updatedAt: new Date()
    };
  });
}

export function occurrencesInRange(
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
    goalId: exception.goalIsOverridden ? exception.goalId : record.goalId,
    labelId: exception.labelIsOverridden ? exception.labelId : record.labelId,
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

export type AppServices = typeof services;
