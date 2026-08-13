import { allowAnonymous, apiProcess, forwardFault, systemFail, validateWith, value } from "@gotch/nextsignal";
import type { AppServices, NotificationSyncResult } from "@/nextsignal/services";
import { notificationSyncInputSchema, type NotificationSyncInput } from "@/nextsignal/schemas";

export const syncNotificationsApi = apiProcess<NotificationSyncInput, NotificationSyncResult, AppServices>({
  name: "notifications.sync",
  auth: allowAnonymous(),
  validate: validateWith(notificationSyncInputSchema),
  async handle(ctx, input) {
    const result = await ctx.mediator.dispatch<NotificationSyncInput, NotificationSyncResult>(
      "notifications.syncBusiness",
      input
    );
    if (!result.ok) return forwardFault(result);
    if (!result.data) return systemFail(new Error("Notification sync returned no data."));
    return value(result.data);
  }
});
