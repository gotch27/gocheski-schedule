import { z } from "zod";
import { eventColors } from "@/db/schema";

export const eventColorSchema = z.enum(eventColors);
export const recurringEventScopeSchema = z.enum(["series", "occurrence"]);

const eventFields = {
  title: z.string().trim().min(1, "Give the event a title.").max(120),
  description: z.string().trim().max(500).default(""),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }),
  recurrenceIntervalWeeks: z.number().int().min(1).max(52).nullable().default(null),
  recurrenceTimeZone: z.string().trim().min(1).max(100).nullable().default(null),
  recurrenceEndsOn: z.iso.date().nullable().default(null),
  color: eventColorSchema.default("violet")
};

type EventFields = {
  startsAt: string;
  endsAt: string;
  recurrenceIntervalWeeks: number | null;
  recurrenceTimeZone: string | null;
  recurrenceEndsOn: string | null;
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
    event.recurrenceIntervalWeeks !== null
    && event.recurrenceEndsOn !== null
    && event.recurrenceEndsOn < dateKeyInTimeZone(new Date(event.startsAt), event.recurrenceTimeZone)
  ) {
    ctx.addIssue({
      code: "custom",
      message: "The repeat end date cannot be before the first event.",
      path: ["recurrenceEndsOn"]
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
    formatter.formatToParts(date)
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

export const updateEventInputSchema = z.object({
  id: z.uuid(),
  occurrenceStartsAt: z.iso.datetime({ offset: true }).optional(),
  scope: recurringEventScopeSchema.default("series"),
  ...eventFields
}).superRefine(validateEvent);

export const deleteEventInputSchema = z.object({
  id: z.uuid(),
  occurrenceStartsAt: z.iso.datetime({ offset: true }).optional(),
  scope: recurringEventScopeSchema.default("series")
});

const todoFields = {
  title: z.string().trim().min(1, "Give the to-do a title.").max(120),
  description: z.string().trim().max(500).default(""),
  estimatedMinutes: z.number().int().min(15).max(15 * 60).nullable().default(null)
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
