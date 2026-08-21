import { allowAnonymous, apiProcess, forwardFault, systemFail, validateWith, value } from "@gotch/nextsignal";
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

export const listToBuyItemsApi = apiProcess<ListToBuyItemsInput, CalendarToBuyItemList, AppServices>({
  name: "toBuyItems.list",
  auth: allowAnonymous(),
  validate: validateWith(listToBuyItemsInputSchema),
  async handle(ctx, input) {
    const result = await ctx.mediator.dispatch<ListToBuyItemsInput, CalendarToBuyItemList>("toBuyItems.listBusiness", input);
    if (!result.ok) return forwardFault(result);
    if (!result.data) return systemFail(new Error("To-buy list returned no data."));
    return value(result.data);
  }
});

export const createToBuyItemApi = apiProcess<CreateToBuyItemInput, { item: CalendarToBuyItem }, AppServices>({
  name: "toBuyItems.create",
  auth: allowAnonymous(),
  validate: validateWith(createToBuyItemInputSchema),
  async handle(ctx, input) {
    const result = await ctx.mediator.dispatch<CreateToBuyItemInput, CalendarToBuyItem>("toBuyItems.createBusiness", input);
    if (!result.ok) return forwardFault(result);
    if (!result.data) return systemFail(new Error("Create to-buy item returned no data."));
    return value({ item: result.data });
  }
});

export const updateToBuyItemApi = apiProcess<UpdateToBuyItemInput, { items: CalendarToBuyItem[] }, AppServices>({
  name: "toBuyItems.update",
  auth: allowAnonymous(),
  validate: validateWith(updateToBuyItemInputSchema),
  async handle(ctx, input) {
    const result = await ctx.mediator.dispatch<UpdateToBuyItemInput, CalendarToBuyItem[]>("toBuyItems.updateBusiness", input);
    if (!result.ok) return forwardFault(result);
    if (!result.data) return systemFail(new Error("Update to-buy item returned no data."));
    return value({ items: result.data });
  }
});

export const deleteToBuyItemApi = apiProcess<DeleteToBuyItemInput, { id: string }, AppServices>({
  name: "toBuyItems.delete",
  auth: allowAnonymous(),
  validate: validateWith(deleteToBuyItemInputSchema),
  async handle(ctx, input) {
    const result = await ctx.mediator.dispatch<DeleteToBuyItemInput, { id: string }>("toBuyItems.deleteBusiness", input);
    if (!result.ok) return forwardFault(result);
    if (!result.data) return systemFail(new Error("Delete to-buy item returned no data."));
    return value(result.data);
  }
});
