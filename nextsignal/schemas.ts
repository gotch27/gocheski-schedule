import { z } from "zod";
import { eventColors } from "@/db/schema";

export const eventColorSchema = z.enum(eventColors);

const eventFields = {
  title: z.string().trim().min(1, "Give the event a title.").max(120),
  description: z.string().trim().max(500).default(""),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }),
  color: eventColorSchema.default("violet")
};

const validEventRange = (event: { startsAt: string; endsAt: string }) =>
  new Date(event.endsAt).getTime() > new Date(event.startsAt).getTime();

export const listEventsInputSchema = z.object({
  weekStart: z.iso.datetime({ offset: true }),
  weekEnd: z.iso.datetime({ offset: true })
});

export const createEventInputSchema = z.object(eventFields).refine(validEventRange, {
  message: "The event must end after it starts.",
  path: ["endsAt"]
});

export const updateEventInputSchema = z.object({
  id: z.uuid(),
  ...eventFields
}).refine(validEventRange, {
  message: "The event must end after it starts.",
  path: ["endsAt"]
});

export const deleteEventInputSchema = z.object({ id: z.uuid() });

export type EventColor = z.infer<typeof eventColorSchema>;
export type ListEventsInput = z.infer<typeof listEventsInputSchema>;
export type CreateEventInput = z.infer<typeof createEventInputSchema>;
export type UpdateEventInput = z.infer<typeof updateEventInputSchema>;
export type DeleteEventInput = z.infer<typeof deleteEventInputSchema>;
