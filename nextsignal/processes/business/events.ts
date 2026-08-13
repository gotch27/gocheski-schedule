import { businessProcess, notFound, ok, validateWith, validationFail, value } from "@gotch/nextsignal";
import type { AppServices, CalendarEvent, NotificationProviderConfig } from "@/nextsignal/services";
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

function notificationProvider(ctx: { config: { get<T>(path: string, fallback: T): T } }): NotificationProviderConfig {
  return {
    baseUrl: ctx.config.get("notifications.ntfy_base_url", "https://ntfy.sh"),
    topic: ctx.config.get("notifications.ntfy_topic", ""),
    accessToken: ctx.config.get("notifications.ntfy_access_token", ""),
    timeZone: ctx.config.get("notifications.time_zone", "Europe/Skopje")
  };
}

function notificationTimeIsInvalid(input: CreateEventInput | UpdateEventInput, existing?: CalendarEvent | null) {
  if (!input.notificationEnabled || input.notificationOffsetMinutes === null) return false;
  const notificationAt = new Date(input.startsAt).getTime() - input.notificationOffsetMinutes * 60_000;
  if (notificationAt >= Date.now() + 60_000) return false;
  if ("scope" in input && input.scope === "series" && input.recurrenceIntervalWeeks !== null) return false;
  return !(existing?.notificationState === "sent"
    && existing.startsAt === input.startsAt
    && existing.notificationEnabled === input.notificationEnabled
    && existing.notificationOffsetMinutes === input.notificationOffsetMinutes
    && existing.notificationMessage === input.notificationMessage);
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
    if (notificationTimeIsInvalid(input)) {
      return validationFail({
        message: "Notification time must be in the future.",
        publicMessage: "Choose a notification time at least one minute from now."
      });
    }
    const connectionString = databaseUrl(ctx);
    const created = await ctx.services.events.create(connectionString, input);
    await ctx.services.notifications.reconcile(connectionString, notificationProvider(ctx), created.id);
    return value(await ctx.services.events.findOccurrence(connectionString, created.id, created.occurrenceStartsAt) ?? created);
  }
});

export const updateEventBusiness = businessProcess<UpdateEventInput, CalendarEvent, AppServices>({
  name: "events.updateBusiness",
  auth: () => ok(),
  validate: validateWith(updateEventInputSchema),
  async handle(ctx, input) {
    const connectionString = databaseUrl(ctx);
    const existing = await ctx.services.events.findOccurrence(connectionString, input.id, input.occurrenceStartsAt);
    if (notificationTimeIsInvalid(input, existing)) {
      return validationFail({
        message: "Notification time must be in the future.",
        publicMessage: "Choose a notification time at least one minute from now."
      });
    }
    const event = await ctx.services.events.update(connectionString, input);
    if (event) {
      await ctx.services.notifications.reconcile(connectionString, notificationProvider(ctx), event.id);
    }
    const refreshed = event
      ? await ctx.services.events.findOccurrence(connectionString, event.id, event.occurrenceStartsAt)
      : null;
    return refreshed ? value(refreshed) : notFound("Calendar event not found.");
  }
});

export const deleteEventBusiness = businessProcess<DeleteEventInput, { id: string }, AppServices>({
  name: "events.deleteBusiness",
  auth: () => ok(),
  validate: validateWith(deleteEventInputSchema),
  async handle(ctx, input) {
    const connectionString = databaseUrl(ctx);
    const deleted = await ctx.services.events.delete(connectionString, input);
    if (deleted) await ctx.services.notifications.reconcile(connectionString, notificationProvider(ctx));
    return deleted ? value({ id: input.id }) : notFound("Calendar event not found.");
  }
});
