import {
  allowAnonymous,
  apiProcess,
  forwardFault,
  systemFail,
  validateWith,
  value
} from "@gotch/nextsignal";
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

export const listLabelsApi = apiProcess<
  Record<string, never>,
  { labels: CalendarLabel[] },
  AppServices
>({
  name: "labels.list",
  auth: allowAnonymous(),
  validate: validateWith(listLabelsInputSchema),
  async handle(ctx, input) {
    const result = await ctx.mediator.dispatch<Record<string, never>, CalendarLabel[]>(
      "labels.listBusiness",
      input
    );
    if (!result.ok) return forwardFault(result);
    if (!result.data) return systemFail(new Error("Label operation returned no data."));
    return value({ labels: result.data });
  }
});

export const createLabelsApi = apiProcess<CreateLabelInput, { label: CalendarLabel }, AppServices>({
  name: "labels.create",
  auth: allowAnonymous(),
  validate: validateWith(createLabelInputSchema),
  async handle(ctx, input) {
    const result = await ctx.mediator.dispatch<CreateLabelInput, CalendarLabel>(
      "labels.createBusiness",
      input
    );
    if (!result.ok) return forwardFault(result);
    if (!result.data) return systemFail(new Error("Label operation returned no data."));
    return value({ label: result.data });
  }
});

export const updateLabelsApi = apiProcess<UpdateLabelInput, { label: CalendarLabel }, AppServices>({
  name: "labels.update",
  auth: allowAnonymous(),
  validate: validateWith(updateLabelInputSchema),
  async handle(ctx, input) {
    const result = await ctx.mediator.dispatch<UpdateLabelInput, CalendarLabel>(
      "labels.updateBusiness",
      input
    );
    if (!result.ok) return forwardFault(result);
    if (!result.data) return systemFail(new Error("Label operation returned no data."));
    return value({ label: result.data });
  }
});

export const deleteLabelsApi = apiProcess<LabelIdInput, { deleted: { id: string } }, AppServices>({
  name: "labels.delete",
  auth: allowAnonymous(),
  validate: validateWith(labelIdInputSchema),
  async handle(ctx, input) {
    const result = await ctx.mediator.dispatch<LabelIdInput, { id: string }>(
      "labels.deleteBusiness",
      input
    );
    if (!result.ok) return forwardFault(result);
    if (!result.data) return systemFail(new Error("Label operation returned no data."));
    return value({ deleted: result.data });
  }
});
