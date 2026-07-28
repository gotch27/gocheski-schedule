import { businessProcess, notFound, ok, validateWith, value } from "@gotch/nextsignal";
import type { AppServices, CalendarEvent } from "@/nextsignal/services";
import {
  createEventInputSchema,
  deleteEventInputSchema,
  listEventsInputSchema,
  updateEventInputSchema,
  type CreateEventInput,
  type DeleteEventInput,
  type ListEventsInput,
  type UpdateEventInput
} from "@/nextsignal/schemas";

function databaseUrl(ctx: { config: { get<T>(path: string, fallback: T): T } }) {
  return ctx.config.get("database.url", "");
}

export const listEventsBusiness = businessProcess<ListEventsInput, CalendarEvent[], AppServices>({
  name: "events.listBusiness",
  auth: () => ok(),
  validate: validateWith(listEventsInputSchema),
  async handle(ctx, input) {
    return value(await ctx.services.events.list(databaseUrl(ctx), input.weekStart, input.weekEnd));
  }
});

export const createEventBusiness = businessProcess<CreateEventInput, CalendarEvent, AppServices>({
  name: "events.createBusiness",
  auth: () => ok(),
  validate: validateWith(createEventInputSchema),
  async handle(ctx, input) {
    return value(await ctx.services.events.create(databaseUrl(ctx), input));
  }
});

export const updateEventBusiness = businessProcess<UpdateEventInput, CalendarEvent, AppServices>({
  name: "events.updateBusiness",
  auth: () => ok(),
  validate: validateWith(updateEventInputSchema),
  async handle(ctx, input) {
    const event = await ctx.services.events.update(databaseUrl(ctx), input);
    return event ? value(event) : notFound("Calendar event not found.");
  }
});

export const deleteEventBusiness = businessProcess<DeleteEventInput, { id: string }, AppServices>({
  name: "events.deleteBusiness",
  auth: () => ok(),
  validate: validateWith(deleteEventInputSchema),
  async handle(ctx, input) {
    const deleted = await ctx.services.events.delete(databaseUrl(ctx), input.id);
    return deleted ? value({ id: input.id }) : notFound("Calendar event not found.");
  }
});
