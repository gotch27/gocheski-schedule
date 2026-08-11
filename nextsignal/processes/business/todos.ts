import { businessProcess, notFound, ok, validateWith, value } from "@gotch/nextsignal";
import type { AppServices, CalendarTodo, CalendarTodoList } from "@/nextsignal/services";
import {
  createTodoInputSchema,
  deleteTodoInputSchema,
  listTodosInputSchema,
  updateTodoInputSchema,
  type CreateTodoInput,
  type DeleteTodoInput,
  type ListTodosInput,
  type UpdateTodoInput
} from "@/nextsignal/schemas";

function databaseUrl(ctx: { config: { get<T>(path: string, fallback: T): T } }) {
  return ctx.config.get("database.url", "");
}

export const listTodosBusiness = businessProcess<ListTodosInput, CalendarTodoList, AppServices>({
  name: "todos.listBusiness",
  auth: () => ok(),
  validate: validateWith(listTodosInputSchema),
  async handle(ctx, input) {
    return value(await ctx.services.todos.list(databaseUrl(ctx), input.weekStart, input.weekEnd));
  }
});

export const createTodoBusiness = businessProcess<CreateTodoInput, CalendarTodo, AppServices>({
  name: "todos.createBusiness",
  auth: () => ok(),
  validate: validateWith(createTodoInputSchema),
  async handle(ctx, input) {
    return value(await ctx.services.todos.create(databaseUrl(ctx), input));
  }
});

export const updateTodoBusiness = businessProcess<UpdateTodoInput, CalendarTodo[], AppServices>({
  name: "todos.updateBusiness",
  auth: () => ok(),
  validate: validateWith(updateTodoInputSchema),
  async handle(ctx, input) {
    const todos = await ctx.services.todos.update(databaseUrl(ctx), input);
    return todos ? value(todos) : notFound("To-do not found.");
  }
});

export const deleteTodoBusiness = businessProcess<DeleteTodoInput, { id: string }, AppServices>({
  name: "todos.deleteBusiness",
  auth: () => ok(),
  validate: validateWith(deleteTodoInputSchema),
  async handle(ctx, input) {
    const deleted = await ctx.services.todos.delete(databaseUrl(ctx), input.id);
    return deleted ? value({ id: input.id }) : notFound("To-do not found.");
  }
});
