import {
  allowAnonymous,
  apiProcess,
  forwardFault,
  systemFail,
  validateWith,
  value
} from "@gotch/nextsignal";
import type { AppServices, CalendarGoal, GoalWithStatistics } from "@/nextsignal/services";
import {
  listGoalsInputSchema,
  createGoalInputSchema,
  updateGoalInputSchema,
  goalIdInputSchema,
  type CreateGoalInput,
  type UpdateGoalInput,
  type GoalIdInput
} from "@/nextsignal/schemas";

export const listGoalsApi = apiProcess<
  Record<string, never>,
  { goals: CalendarGoal[] },
  AppServices
>({
  name: "goals.list",
  auth: allowAnonymous(),
  validate: validateWith(listGoalsInputSchema),
  async handle(ctx, input) {
    const result = await ctx.mediator.dispatch<Record<string, never>, CalendarGoal[]>(
      "goals.listBusiness",
      input
    );
    if (!result.ok) return forwardFault(result);
    if (!result.data) return systemFail(new Error("Goal operation returned no data."));
    return value({ goals: result.data });
  }
});

export const statisticsGoalsApi = apiProcess<
  Record<string, never>,
  { goals: GoalWithStatistics[] },
  AppServices
>({
  name: "goals.statistics",
  auth: allowAnonymous(),
  validate: validateWith(listGoalsInputSchema),
  async handle(ctx, input) {
    const result = await ctx.mediator.dispatch<Record<string, never>, GoalWithStatistics[]>(
      "goals.statisticsBusiness",
      input
    );
    if (!result.ok) return forwardFault(result);
    if (!result.data) return systemFail(new Error("Goal operation returned no data."));
    return value({ goals: result.data });
  }
});

export const createGoalsApi = apiProcess<CreateGoalInput, { goal: CalendarGoal }, AppServices>({
  name: "goals.create",
  auth: allowAnonymous(),
  validate: validateWith(createGoalInputSchema),
  async handle(ctx, input) {
    const result = await ctx.mediator.dispatch<CreateGoalInput, CalendarGoal>(
      "goals.createBusiness",
      input
    );
    if (!result.ok) return forwardFault(result);
    if (!result.data) return systemFail(new Error("Goal operation returned no data."));
    return value({ goal: result.data });
  }
});

export const updateGoalsApi = apiProcess<UpdateGoalInput, { goal: CalendarGoal }, AppServices>({
  name: "goals.update",
  auth: allowAnonymous(),
  validate: validateWith(updateGoalInputSchema),
  async handle(ctx, input) {
    const result = await ctx.mediator.dispatch<UpdateGoalInput, CalendarGoal>(
      "goals.updateBusiness",
      input
    );
    if (!result.ok) return forwardFault(result);
    if (!result.data) return systemFail(new Error("Goal operation returned no data."));
    return value({ goal: result.data });
  }
});

export const deleteGoalsApi = apiProcess<GoalIdInput, { deleted: { id: string } }, AppServices>({
  name: "goals.delete",
  auth: allowAnonymous(),
  validate: validateWith(goalIdInputSchema),
  async handle(ctx, input) {
    const result = await ctx.mediator.dispatch<GoalIdInput, { id: string }>(
      "goals.deleteBusiness",
      input
    );
    if (!result.ok) return forwardFault(result);
    if (!result.data) return systemFail(new Error("Goal operation returned no data."));
    return value({ deleted: result.data });
  }
});
