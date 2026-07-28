import { createEventApi, deleteEventApi, listEventsApi, updateEventApi } from "@/nextsignal/processes/api/events";
import {
  createEventBusiness,
  deleteEventBusiness,
  listEventsBusiness,
  updateEventBusiness
} from "@/nextsignal/processes/business/events";

export const processes = [
  listEventsApi,
  createEventApi,
  updateEventApi,
  deleteEventApi,
  listEventsBusiness,
  createEventBusiness,
  updateEventBusiness,
  deleteEventBusiness
];
