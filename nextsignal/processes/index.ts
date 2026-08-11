import { createEventApi, deleteEventApi, listEventsApi, updateEventApi } from "@/nextsignal/processes/api/events";
import { createTodoApi, deleteTodoApi, listTodosApi, updateTodoApi } from "@/nextsignal/processes/api/todos";
import {
  createEventBusiness,
  deleteEventBusiness,
  listEventsBusiness,
  updateEventBusiness
} from "@/nextsignal/processes/business/events";
import {
  createTodoBusiness,
  deleteTodoBusiness,
  listTodosBusiness,
  updateTodoBusiness
} from "@/nextsignal/processes/business/todos";

export const processes = [
  listEventsApi,
  createEventApi,
  updateEventApi,
  deleteEventApi,
  listTodosApi,
  createTodoApi,
  updateTodoApi,
  deleteTodoApi,
  listEventsBusiness,
  createEventBusiness,
  updateEventBusiness,
  deleteEventBusiness,
  listTodosBusiness,
  createTodoBusiness,
  updateTodoBusiness,
  deleteTodoBusiness
];
