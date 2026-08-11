import { allowAnonymous, apiProcess, forwardFault, systemFail, validateWith, value } from "@gotch/nextsignal";
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

export const listTodosApi = apiProcess<ListTodosInput, CalendarTodoList, AppServices>({
  name: "todos.list",
  auth: allowAnonymous(),
  validate: validateWith(listTodosInputSchema),
  async handle(ctx, input) {
    const result = await ctx.mediator.dispatch<ListTodosInput, CalendarTodoList>("todos.listBusiness", input);
    if (!result.ok) return forwardFault(result);
    if (!result.data) return systemFail(new Error("To-do list returned no data."));
    return value(result.data);
  }
});

export const createTodoApi = apiProcess<CreateTodoInput, { todo: CalendarTodo }, AppServices>({
  name: "todos.create",
  auth: allowAnonymous(),
  validate: validateWith(createTodoInputSchema),
  async handle(ctx, input) {
    const result = await ctx.mediator.dispatch<CreateTodoInput, CalendarTodo>("todos.createBusiness", input);
    if (!result.ok) return forwardFault(result);
    if (!result.data) return systemFail(new Error("Create to-do returned no data."));
    return value({ todo: result.data });
  }
});

export const updateTodoApi = apiProcess<UpdateTodoInput, { todos: CalendarTodo[] }, AppServices>({
  name: "todos.update",
  auth: allowAnonymous(),
  validate: validateWith(updateTodoInputSchema),
  async handle(ctx, input) {
    const result = await ctx.mediator.dispatch<UpdateTodoInput, CalendarTodo[]>("todos.updateBusiness", input);
    if (!result.ok) return forwardFault(result);
    if (!result.data) return systemFail(new Error("Update to-do returned no data."));
    return value({ todos: result.data });
  }
});

export const deleteTodoApi = apiProcess<DeleteTodoInput, { id: string }, AppServices>({
  name: "todos.delete",
  auth: allowAnonymous(),
  validate: validateWith(deleteTodoInputSchema),
  async handle(ctx, input) {
    const result = await ctx.mediator.dispatch<DeleteTodoInput, { id: string }>("todos.deleteBusiness", input);
    if (!result.ok) return forwardFault(result);
    if (!result.data) return systemFail(new Error("Delete to-do returned no data."));
    return value(result.data);
  }
});
