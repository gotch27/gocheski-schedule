import { createNextRoute } from "@gotch/nextsignal/next";
import { app } from "@/nextsignal/app";
import { requireScheduleAuth } from "@/app/lib/require-schedule-auth";

export const runtime = "nodejs";

export const GET = requireScheduleAuth(createNextRoute(app, "goals.list"));
export const POST = requireScheduleAuth(createNextRoute(app, "goals.create"));
export const PATCH = requireScheduleAuth(createNextRoute(app, "goals.update"));
export const DELETE = requireScheduleAuth(createNextRoute(app, "goals.delete"));
