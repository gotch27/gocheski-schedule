import { createNextRoute } from "@gotch/nextsignal/next";
import { app } from "@/nextsignal/app";
import { isAuthenticatedRequest } from "@/app/lib/schedule-auth";

export const runtime = "nodejs";

type RouteHandler = ReturnType<typeof createNextRoute>;

function requireScheduleAuth(handler: RouteHandler): RouteHandler {
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

export const GET = requireScheduleAuth(createNextRoute(app, "toBuyItems.list"));
export const POST = requireScheduleAuth(createNextRoute(app, "toBuyItems.create"));
export const PATCH = requireScheduleAuth(createNextRoute(app, "toBuyItems.update"));
export const DELETE = requireScheduleAuth(createNextRoute(app, "toBuyItems.delete"));
