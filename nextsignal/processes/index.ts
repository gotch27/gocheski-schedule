import { createEventApi, deleteEventApi, listEventsApi, updateEventApi } from "@/nextsignal/processes/api/events";
import { createTodoApi, deleteTodoApi, listTodosApi, updateTodoApi } from "@/nextsignal/processes/api/todos";
import { createToBuyItemApi, deleteToBuyItemApi, listToBuyItemsApi, updateToBuyItemApi } from "@/nextsignal/processes/api/to-buy";
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
import {
  createToBuyItemBusiness,
  deleteToBuyItemBusiness,
  listToBuyItemsBusiness,
  updateToBuyItemBusiness
} from "@/nextsignal/processes/business/to-buy";

export const processes = [
  listEventsApi,
  createEventApi,
  updateEventApi,
  deleteEventApi,
  listTodosApi,
  createTodoApi,
  updateTodoApi,
  deleteTodoApi,
  listToBuyItemsApi,
  createToBuyItemApi,
  updateToBuyItemApi,
  deleteToBuyItemApi,
  syncNotificationsApi,
  listEventsBusiness,
  createEventBusiness,
  updateEventBusiness,
  deleteEventBusiness,
  listTodosBusiness,
  createTodoBusiness,
  updateTodoBusiness,
  deleteTodoBusiness,
  listToBuyItemsBusiness,
  createToBuyItemBusiness,
  updateToBuyItemBusiness,
  deleteToBuyItemBusiness,
  syncNotificationsBusiness
];
