import { z } from "zod";
import { createToBuyItemInputSchema } from "@/nextsignal/schemas";

export const timestamp = z.iso.datetime({ offset: true });
export const timeZone = z
  .string()
  .max(100)
  .refine((zone) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: zone });
      return true;
    } catch {
      return false;
    }
  }, "Use a valid IANA time zone.");
export const rangeSchema = z
  .strictObject({
    weekStart: timestamp.describe("Inclusive range start, ISO 8601 with UTC offset."),
    weekEnd: timestamp.describe("Exclusive range end, after weekStart and at most 31 days later.")
  })
  .refine((range) => {
    const duration = Date.parse(range.weekEnd) - Date.parse(range.weekStart);
    return duration > 0 && duration <= 31 * 24 * 60 * 60_000;
  }, "Request a positive date range of at most 31 days.");
export const listSchema = rangeSchema.safeExtend({
  placement: z.enum(["all", "unscheduled", "scheduled"]).default("all")
});
export const identityFields = {
  id: z.uuid(),
  occurrenceStartsAt: timestamp
    .optional()
    .describe(
      "Original occurrence timestamp from get_schedule; remains unchanged after moving that occurrence."
    )
};
export const eventIdentitySchema = z.strictObject(identityFields);
export const eventTargetSchema = z.strictObject({
  ...identityFields,
  scope: z
    .enum(["series", "occurrence"])
    .optional()
    .describe(
      "Required for recurring events. Series operations target the master; occurrence operations require occurrenceStartsAt."
    )
});
const content = {
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500)
};
const eventOptions = {
  recurrenceIntervalWeeks: z.number().int().min(1).max(52).nullable(),
  recurrenceEndsOn: z.iso.date().nullable(),
  notificationEnabled: z.boolean(),
  notificationOffsetMinutes: z.number().int().min(0).max(10_080).nullable(),
  notificationMessage: z.string().trim().max(500).nullable()
};
export const createEventSchema = z.strictObject({
  ...content,
  description: content.description.default(""),
  startsAt: timestamp,
  endsAt: timestamp,
  timeZone: timeZone.optional(),
  recurrenceIntervalWeeks: eventOptions.recurrenceIntervalWeeks.default(null),
  recurrenceEndsOn: eventOptions.recurrenceEndsOn.default(null),
  notificationEnabled: eventOptions.notificationEnabled.default(false),
  notificationOffsetMinutes: eventOptions.notificationOffsetMinutes.default(null),
  notificationMessage: eventOptions.notificationMessage.default(null)
});
export const updateEventSchema = eventTargetSchema.extend({
  title: content.title.optional(),
  description: content.description.optional(),
  startsAt: timestamp.optional(),
  endsAt: timestamp.optional(),
  timeZone: timeZone.optional(),
  recurrenceIntervalWeeks: eventOptions.recurrenceIntervalWeeks.optional(),
  recurrenceEndsOn: eventOptions.recurrenceEndsOn.optional(),
  notificationEnabled: eventOptions.notificationEnabled.optional(),
  notificationOffsetMinutes: eventOptions.notificationOffsetMinutes.optional(),
  notificationMessage: eventOptions.notificationMessage.optional()
});
export const moveEventSchema = eventTargetSchema.extend({
  startsAt: timestamp,
  endsAt: timestamp.optional(),
  timeZone: timeZone.optional()
});
export const duplicateEventSchema = eventIdentitySchema.extend({
  startsAt: timestamp,
  endsAt: timestamp.optional(),
  title: content.title.optional(),
  timeZone: timeZone.optional()
});
export const idSchema = z.strictObject({ id: z.uuid() });
export const scheduleSchema = idSchema.extend({
  scheduledAt: timestamp,
  timeZone: timeZone.optional()
});
export const reorderSchema = z.strictObject({
  orderedIds: z
    .array(z.uuid())
    .max(500)
    .refine((ids) => new Set(ids).size === ids.length, "Each ID must appear exactly once.")
});
export const createTodoSchema = z.strictObject({
  ...content,
  description: content.description.default(""),
  estimatedMinutes: z.number().int().min(15).max(900).nullable().default(null)
});
export const updateTodoSchema = z.strictObject({
  id: z.uuid(),
  title: content.title.optional(),
  description: content.description.optional(),
  estimatedMinutes: z.number().int().min(15).max(900).nullable().optional(),
  timeZone: timeZone.optional()
});
export const createToBuySchema = z.strictObject(createToBuyItemInputSchema.shape);
export const updateToBuySchema = z.strictObject({
  id: z.uuid(),
  title: content.title.optional(),
  description: content.description.optional(),
  url: createToBuySchema.shape.url.removeDefault().optional()
});
