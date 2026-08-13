import { businessProcess, ok, validateWith, value } from "@gotch/nextsignal";
import type { AppServices, NotificationProviderConfig, NotificationSyncResult } from "@/nextsignal/services";
import { notificationSyncInputSchema, type NotificationSyncInput } from "@/nextsignal/schemas";

function databaseUrl(ctx: { config: { get<T>(path: string, fallback: T): T } }) {
  return ctx.config.get("database.url", "");
}

function notificationProvider(ctx: { config: { get<T>(path: string, fallback: T): T } }): NotificationProviderConfig {
  return {
    baseUrl: ctx.config.get("notifications.ntfy_base_url", "https://ntfy.sh"),
    topic: ctx.config.get("notifications.ntfy_topic", ""),
    accessToken: ctx.config.get("notifications.ntfy_access_token", ""),
    timeZone: ctx.config.get("notifications.time_zone", "Europe/Skopje")
  };
}

export const syncNotificationsBusiness = businessProcess<NotificationSyncInput, NotificationSyncResult, AppServices>({
  name: "notifications.syncBusiness",
  auth: () => ok(),
  validate: validateWith(notificationSyncInputSchema),
  async handle(ctx) {
    return value(await ctx.services.notifications.reconcile(databaseUrl(ctx), notificationProvider(ctx)));
  }
});
