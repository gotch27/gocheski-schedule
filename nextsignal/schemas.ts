import { z } from "zod";
import { eventColors } from "@/db/schema";

export const eventColorSchema = z.enum(eventColors);
export const labelColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Choose a valid color.")
  .transform((color) => color.toLowerCase() as `#${string}`);
export const listLabelsInputSchema = z.object({});
export const createLabelInputSchema = z.object({
  name: z.string().trim().min(1, "Give the label a name.").max(60),
  color: labelColorSchema
});
export const updateLabelInputSchema = createLabelInputSchema.extend({ id: z.uuid() });
export const labelIdInputSchema = z.object({ id: z.uuid() });
export type CreateLabelInput = z.infer<typeof createLabelInputSchema>;
export type UpdateLabelInput = z.infer<typeof updateLabelInputSchema>;
export type LabelIdInput = z.infer<typeof labelIdInputSchema>;
export const recurringEventScopeSchema = z.enum(["series", "occurrence"]);

const eventFields = {
  labelId: z.uuid().nullable().optional(),
  goalId: z.uuid().nullable().optional(),
  title: z.string().trim().min(1, "Give the event a title.").max(120),
  description: z.string().trim().max(500).default(""),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }),
  recurrenceIntervalWeeks: z.number().int().min(1).max(52).nullable().default(null),
  recurrenceTimeZone: z.string().trim().min(1).max(100).nullable().default(null),
  recurrenceEndsOn: z.iso.date().nullable().default(null),
  notificationEnabled: z.boolean().default(false),
  notificationOffsetMinutes: z
    .number()
    .int()
    .min(0)
    .max(7 * 24 * 60)
    .nullable()
    .default(null),
  notificationMessage: z.string().trim().max(500).nullable().default(null),
  color: z.union([eventColorSchema, labelColorSchema]).default("violet")
};

type EventFields = {
  startsAt: string;
  endsAt: string;
  recurrenceIntervalWeeks: number | null;
  recurrenceTimeZone: string | null;
  recurrenceEndsOn: string | null;
  notificationEnabled: boolean;
  notificationOffsetMinutes: number | null;
};

function validateEvent(event: EventFields, ctx: z.RefinementCtx) {
  const duration = new Date(event.endsAt).getTime() - new Date(event.startsAt).getTime();

  if (duration < 15 * 60_000) {
    ctx.addIssue({
      code: "custom",
      message: "The event must be at least 15 minutes long.",
      path: ["endsAt"]
    });
  }

  if (event.recurrenceIntervalWeeks === null && event.recurrenceEndsOn !== null) {
    ctx.addIssue({
      code: "custom",
      message: "A repeat end date requires a repeating event.",
      path: ["recurrenceEndsOn"]
    });
  }

  if (
    event.recurrenceIntervalWeeks !== null &&
    event.recurrenceEndsOn !== null &&
    event.recurrenceEndsOn < dateKeyInTimeZone(new Date(event.startsAt), event.recurrenceTimeZone)
  ) {
    ctx.addIssue({
      code: "custom",
      message: "The repeat end date cannot be before the first event.",
      path: ["recurrenceEndsOn"]
    });
  }

  if (event.notificationEnabled !== (event.notificationOffsetMinutes !== null)) {
    ctx.addIssue({
      code: "custom",
      message: event.notificationEnabled
        ? "Choose when the notification should be sent."
        : "Disable the notification before clearing its lead time.",
      path: ["notificationOffsetMinutes"]
    });
  }
}

function dateKeyInTimeZone(date: Date, timeZone: string | null) {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone ?? "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    });
  } catch {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    });
  }

  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export const listEventsInputSchema = z.object({
  weekStart: z.iso.datetime({ offset: true }),
  weekEnd: z.iso.datetime({ offset: true })
});

export const createEventInputSchema = z.object(eventFields).superRefine(validateEvent);

export const updateEventInputSchema = z
  .object({
    id: z.uuid(),
    occurrenceStartsAt: z.iso.datetime({ offset: true }).optional(),
    scope: recurringEventScopeSchema.default("series"),
    ...eventFields
  })
  .superRefine(validateEvent);

export const deleteEventInputSchema = z.object({
  id: z.uuid(),
  occurrenceStartsAt: z.iso.datetime({ offset: true }).optional(),
  scope: recurringEventScopeSchema.default("series")
});

const todoFields = {
  goalId: z.uuid().nullable().optional(),
  title: z.string().trim().min(1, "Give the to-do a title.").max(120),
  description: z.string().trim().max(500).default(""),
  estimatedMinutes: z
    .number()
    .int()
    .min(15)
    .max(15 * 60)
    .nullable()
    .default(null)
};

export const listTodosInputSchema = z.object({
  weekStart: z.iso.datetime({ offset: true }),
  weekEnd: z.iso.datetime({ offset: true })
});

export const createTodoInputSchema = z.object(todoFields);

export const updateTodoInputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("update"),
    id: z.uuid(),
    ...todoFields
  }),
  z.object({
    action: z.literal("schedule"),
    id: z.uuid(),
    scheduledAt: z.iso.datetime({ offset: true })
  }),
  z.object({
    action: z.literal("unschedule"),
    id: z.uuid()
  }),
  z.object({
    action: z.literal("reorder"),
    orderedIds: z.array(z.uuid()).max(500)
  })
]);

export const deleteTodoInputSchema = z.object({ id: z.uuid() });

const toBuyFields = {
  title: z.string().trim().min(1, "Give the item a name.").max(120),
  description: z.string().trim().max(500).default(""),
  url: z
    .union([
      z
        .url("Enter a complete link, including https://")
        .max(2_000)
        .refine(
          (url) => /^https?:\/\//i.test(url),
          "The purchase link must begin with https:// or http://."
        ),
      z.literal("")
    ])
    .transform((url) => url || null)
    .nullable()
    .default(null)
};

export const listToBuyItemsInputSchema = z.object({
  weekStart: z.iso.datetime({ offset: true }),
  weekEnd: z.iso.datetime({ offset: true })
});
export const createToBuyItemInputSchema = z.object(toBuyFields);
export const updateToBuyItemInputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("update"),
    id: z.uuid(),
    ...toBuyFields
  }),
  z.object({
    action: z.literal("reorder"),
    orderedIds: z.array(z.uuid()).max(500)
  }),
  z.object({
    action: z.literal("schedule"),
    id: z.uuid(),
    scheduledAt: z.iso.datetime({ offset: true })
  }),
  z.object({
    action: z.literal("unschedule"),
    id: z.uuid()
  })
]);
export const deleteToBuyItemInputSchema = z.object({ id: z.uuid() });
export const notificationSyncInputSchema = z.object({});

export type EventColor = z.infer<typeof eventColorSchema>;
export type RecurringEventScope = z.infer<typeof recurringEventScopeSchema>;
export type ListEventsInput = z.infer<typeof listEventsInputSchema>;
export type CreateEventInput = z.infer<typeof createEventInputSchema>;
export type UpdateEventInput = z.infer<typeof updateEventInputSchema>;
export type DeleteEventInput = z.infer<typeof deleteEventInputSchema>;
export type ListTodosInput = z.infer<typeof listTodosInputSchema>;
export type CreateTodoInput = z.infer<typeof createTodoInputSchema>;
export type UpdateTodoInput = z.infer<typeof updateTodoInputSchema>;
export type DeleteTodoInput = z.infer<typeof deleteTodoInputSchema>;
export type ListToBuyItemsInput = z.infer<typeof listToBuyItemsInputSchema>;
export type CreateToBuyItemInput = z.infer<typeof createToBuyItemInputSchema>;
export type UpdateToBuyItemInput = z.infer<typeof updateToBuyItemInputSchema>;
export type DeleteToBuyItemInput = z.infer<typeof deleteToBuyItemInputSchema>;
export type NotificationSyncInput = z.infer<typeof notificationSyncInputSchema>;

const goalFields = {
  title: z.string().trim().min(1, "Give the goal a title.").max(120),
  description: z.string().trim().max(2_000).default(""),
  startsOn: z.iso.date().nullable().default(null),
  endsOn: z.iso.date().nullable().default(null),
  timeZone: z
    .string()
    .max(100)
    .refine((zone) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: zone });
        return true;
      } catch {
        return false;
      }
    }, "Choose a valid time zone."),
  color: eventColorSchema.default("violet"),
  achieved: z.boolean().default(false)
};
const validGoalRange = (goal: { startsOn: string | null; endsOn: string | null }) =>
  (goal.startsOn === null && goal.endsOn === null) ||
  (goal.startsOn !== null && goal.endsOn !== null && goal.endsOn >= goal.startsOn);
const goalRangeError = {
  message:
    "Choose both dates, or leave the date range off. The deadline cannot be before the start date.",
  path: ["endsOn"]
};
export const listGoalsInputSchema = z.object({});
export const createGoalInputSchema = z.object(goalFields).refine(validGoalRange, goalRangeError);
export const updateGoalInputSchema = z
  .object({ id: z.uuid(), ...goalFields })
  .refine(validGoalRange, goalRangeError);
export const goalIdInputSchema = z.object({ id: z.uuid() });
export type CreateGoalInput = z.infer<typeof createGoalInputSchema>;
export type UpdateGoalInput = z.infer<typeof updateGoalInputSchema>;
export type GoalIdInput = z.infer<typeof goalIdInputSchema>;
