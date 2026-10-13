import { createNextRoute } from "@gotch/nextsignal/next";
import { app } from "@/nextsignal/app";
import { requireScheduleAuth } from "@/app/lib/require-schedule-auth";

export const runtime = "nodejs";

export const GET = requireScheduleAuth(createNextRoute(app, "labels.list"));
export const POST = requireScheduleAuth(createNextRoute(app, "labels.create"));
export const PATCH = requireScheduleAuth(createNextRoute(app, "labels.update"));
export const DELETE = requireScheduleAuth(createNextRoute(app, "labels.delete"));
