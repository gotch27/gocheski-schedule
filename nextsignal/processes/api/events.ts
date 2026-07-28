import { allowAnonymous, apiProcess, forwardFault, systemFail, validateWith, value } from "@gotch/nextsignal";
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

export const listEventsApi = apiProcess<ListEventsInput, { events: CalendarEvent[] }, AppServices>({
  name: "events.list",
  auth: allowAnonymous(),
  validate: validateWith(listEventsInputSchema),
  async handle(ctx, input) {
    const result = await ctx.mediator.dispatch<ListEventsInput, CalendarEvent[]>("events.listBusiness", input);
    if (!result.ok) return forwardFault(result);
    if (!result.data) return systemFail(new Error("Event list returned no data."));
    return value({ events: result.data });
  }
});

export const createEventApi = apiProcess<CreateEventInput, { event: CalendarEvent }, AppServices>({
  name: "events.create",
  auth: allowAnonymous(),
  validate: validateWith(createEventInputSchema),
  async handle(ctx, input) {
    const result = await ctx.mediator.dispatch<CreateEventInput, CalendarEvent>("events.createBusiness", input);
    if (!result.ok) return forwardFault(result);
    if (!result.data) return systemFail(new Error("Create event returned no data."));
    return value({ event: result.data });
  }
});

export const updateEventApi = apiProcess<UpdateEventInput, { event: CalendarEvent }, AppServices>({
  name: "events.update",
  auth: allowAnonymous(),
  validate: validateWith(updateEventInputSchema),
  async handle(ctx, input) {
    const result = await ctx.mediator.dispatch<UpdateEventInput, CalendarEvent>("events.updateBusiness", input);
    if (!result.ok) return forwardFault(result);
    if (!result.data) return systemFail(new Error("Update event returned no data."));
    return value({ event: result.data });
  }
});

export const deleteEventApi = apiProcess<DeleteEventInput, { id: string }, AppServices>({
  name: "events.delete",
  auth: allowAnonymous(),
  validate: validateWith(deleteEventInputSchema),
  async handle(ctx, input) {
    const result = await ctx.mediator.dispatch<DeleteEventInput, { id: string }>("events.deleteBusiness", input);
    if (!result.ok) return forwardFault(result);
    if (!result.data) return systemFail(new Error("Delete event returned no data."));
    return value(result.data);
  }
});
