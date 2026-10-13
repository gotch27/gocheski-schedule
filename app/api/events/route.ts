import { createNextRoute } from "@gotch/nextsignal/next";
import { app } from "@/nextsignal/app";
import { requireScheduleAuth } from "@/app/lib/require-schedule-auth";

export const runtime = "nodejs";

export const GET = requireScheduleAuth(createNextRoute(app, "events.list"));
export const POST = requireScheduleAuth(createNextRoute(app, "events.create"));
export const PATCH = requireScheduleAuth(createNextRoute(app, "events.update"));
export const DELETE = requireScheduleAuth(createNextRoute(app, "events.delete"));
