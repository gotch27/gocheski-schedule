import { businessProcess, notFound, ok, validateWith, value } from "@gotch/nextsignal";
import type { AppServices, CalendarLabel } from "@/nextsignal/services";
import {
  listLabelsInputSchema,
  createLabelInputSchema,
  updateLabelInputSchema,
  labelIdInputSchema,
  type CreateLabelInput,
  type UpdateLabelInput,
  type LabelIdInput
} from "@/nextsignal/schemas";

export const listLabelsBusiness = businessProcess<
  Record<string, never>,
  CalendarLabel[],
  AppServices
>({
  name: "labels.listBusiness",
  auth: () => ok(),
  validate: validateWith(listLabelsInputSchema),
  async handle(ctx, input) {
    const url = ctx.config.get("database.url", "");
    const result = await ctx.services.labels.list(url);
    return value(result);
  }
});

export const createLabelsBusiness = businessProcess<CreateLabelInput, CalendarLabel, AppServices>({
  name: "labels.createBusiness",
  auth: () => ok(),
  validate: validateWith(createLabelInputSchema),
  async handle(ctx, input) {
    input = createLabelInputSchema.parse(input);
    const url = ctx.config.get("database.url", "");
    const result = await ctx.services.labels.create(url, input);
    return value(result);
  }
});

export const updateLabelsBusiness = businessProcess<UpdateLabelInput, CalendarLabel, AppServices>({
  name: "labels.updateBusiness",
  auth: () => ok(),
  validate: validateWith(updateLabelInputSchema),
  async handle(ctx, input) {
    input = updateLabelInputSchema.parse(input);
    const url = ctx.config.get("database.url", "");
    const result = await ctx.services.labels.update(url, input);
    return result ? value(result) : notFound("Label not found.");
  }
});

export const deleteLabelsBusiness = businessProcess<LabelIdInput, { id: string }, AppServices>({
  name: "labels.deleteBusiness",
  auth: () => ok(),
  validate: validateWith(labelIdInputSchema),
  async handle(ctx, input) {
    const url = ctx.config.get("database.url", "");
    const result = await ctx.services.labels.delete(url, input.id);
    return result ? value({ id: input.id }) : notFound("Label not found.");
  }
});
