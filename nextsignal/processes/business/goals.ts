import { businessProcess, notFound, ok, validateWith, value } from "@gotch/nextsignal";
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

export const listGoalsBusiness = businessProcess<
  Record<string, never>,
  CalendarGoal[],
  AppServices
>({
  name: "goals.listBusiness",
  auth: () => ok(),
  validate: validateWith(listGoalsInputSchema),
  async handle(ctx, input) {
    const url = ctx.config.get("database.url", "");
    const result = await ctx.services.goals.list(url);
    return value(result);
  }
});

export const statisticsGoalsBusiness = businessProcess<
  Record<string, never>,
  GoalWithStatistics[],
  AppServices
>({
  name: "goals.statisticsBusiness",
  auth: () => ok(),
  validate: validateWith(listGoalsInputSchema),
  async handle(ctx, input) {
    const url = ctx.config.get("database.url", "");
    const result = await ctx.services.goals.statistics(url);
    return value(result);
  }
});

export const createGoalsBusiness = businessProcess<CreateGoalInput, CalendarGoal, AppServices>({
  name: "goals.createBusiness",
  auth: () => ok(),
  validate: validateWith(createGoalInputSchema),
  async handle(ctx, input) {
    input = createGoalInputSchema.parse(input);
    const url = ctx.config.get("database.url", "");
    const result = await ctx.services.goals.create(url, input);
    return value(result);
  }
});

export const updateGoalsBusiness = businessProcess<UpdateGoalInput, CalendarGoal, AppServices>({
  name: "goals.updateBusiness",
  auth: () => ok(),
  validate: validateWith(updateGoalInputSchema),
  async handle(ctx, input) {
    input = updateGoalInputSchema.parse(input);
    const url = ctx.config.get("database.url", "");
    const result = await ctx.services.goals.update(url, input);
    return result ? value(result) : notFound("Goal not found.");
  }
});

export const deleteGoalsBusiness = businessProcess<GoalIdInput, { id: string }, AppServices>({
  name: "goals.deleteBusiness",
  auth: () => ok(),
  validate: validateWith(goalIdInputSchema),
  async handle(ctx, input) {
    const url = ctx.config.get("database.url", "");
    const result = await ctx.services.goals.delete(url, input.id);
    return result ? value({ id: input.id }) : notFound("Goal not found.");
  }
});
