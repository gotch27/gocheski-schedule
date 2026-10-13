import { createNextRoute } from "@gotch/nextsignal/next";
import { app } from "@/nextsignal/app";
import { requireScheduleAuth } from "@/app/lib/require-schedule-auth";
export const runtime = "nodejs";
export const GET = requireScheduleAuth(createNextRoute(app, "goals.statistics"));
