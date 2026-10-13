import type { createNextRoute } from "@gotch/nextsignal/next";
import { isAuthenticatedRequest } from "@/app/lib/schedule-auth";

type RouteHandler = ReturnType<typeof createNextRoute>;

export function requireScheduleAuth(handler: RouteHandler): RouteHandler {
  return async (request, context) => {
    if (!isAuthenticatedRequest(request)) {
      return Response.json(
        {
          ok: false,
          errors: [{ message: "Authentication required.", publicMessage: "Please log in again." }],
          meta: { kind: "auth", process: "schedule.auth" }
        },
        { status: 401 }
      );
    }

    return handler(request, context);
  };
}
