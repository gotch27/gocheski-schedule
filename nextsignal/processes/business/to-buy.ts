import { businessProcess, notFound, ok, validateWith, value } from "@gotch/nextsignal";
import type { AppServices, CalendarToBuyItem, CalendarToBuyItemList } from "@/nextsignal/services";
import {
  createToBuyItemInputSchema,
  deleteToBuyItemInputSchema,
  listToBuyItemsInputSchema,
  updateToBuyItemInputSchema,
  type CreateToBuyItemInput,
  type DeleteToBuyItemInput,
  type ListToBuyItemsInput,
  type UpdateToBuyItemInput
} from "@/nextsignal/schemas";

function databaseUrl(ctx: { config: { get<T>(path: string, fallback: T): T } }) {
  return ctx.config.get("database.url", "");
}

export const listToBuyItemsBusiness = businessProcess<ListToBuyItemsInput, CalendarToBuyItemList, AppServices>({
  name: "toBuyItems.listBusiness",
  auth: () => ok(),
  validate: validateWith(listToBuyItemsInputSchema),
  async handle(ctx, input) {
    return value(await ctx.services.toBuyItems.list(databaseUrl(ctx), input.weekStart, input.weekEnd));
  }
});

export const createToBuyItemBusiness = businessProcess<CreateToBuyItemInput, CalendarToBuyItem, AppServices>({
  name: "toBuyItems.createBusiness",
  auth: () => ok(),
  validate: validateWith(createToBuyItemInputSchema),
  async handle(ctx, input) {
    return value(await ctx.services.toBuyItems.create(databaseUrl(ctx), input));
  }
});

export const updateToBuyItemBusiness = businessProcess<UpdateToBuyItemInput, CalendarToBuyItem[], AppServices>({
  name: "toBuyItems.updateBusiness",
  auth: () => ok(),
  validate: validateWith(updateToBuyItemInputSchema),
  async handle(ctx, input) {
    const items = await ctx.services.toBuyItems.update(databaseUrl(ctx), input);
    return items ? value(items) : notFound("To-buy item not found.");
  }
});

export const deleteToBuyItemBusiness = businessProcess<DeleteToBuyItemInput, { id: string }, AppServices>({
  name: "toBuyItems.deleteBusiness",
  auth: () => ok(),
  validate: validateWith(deleteToBuyItemInputSchema),
  async handle(ctx, input) {
    const deleted = await ctx.services.toBuyItems.delete(databaseUrl(ctx), input);
    return deleted ? value({ id: input.id }) : notFound("To-buy item not found.");
  }
});
