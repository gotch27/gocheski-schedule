import { createEventApi, deleteEventApi, listEventsApi, updateEventApi } from "@/nextsignal/processes/api/events";
import { createTodoApi, deleteTodoApi, listTodosApi, updateTodoApi } from "@/nextsignal/processes/api/todos";
import { syncNotificationsApi } from "@/nextsignal/processes/api/notifications";
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
import { syncNotificationsBusiness } from "@/nextsignal/processes/business/notifications";

export const processes = [
  listEventsApi,
  createEventApi,
  updateEventApi,
  deleteEventApi,
  listTodosApi,
  createTodoApi,
  updateTodoApi,
  deleteTodoApi,
  syncNotificationsApi,
  listEventsBusiness,
  createEventBusiness,
  updateEventBusiness,
  deleteEventBusiness,
  listTodosBusiness,
  createTodoBusiness,
  updateTodoBusiness,
  deleteTodoBusiness,
  syncNotificationsBusiness
];
