import { createNextRoute } from "@gotch/nextsignal/next";
import { app } from "@/nextsignal/app";

export const runtime = "nodejs";
export const GET = createNextRoute(app, "events.list");
export const POST = createNextRoute(app, "events.create");
export const PATCH = createNextRoute(app, "events.update");
export const DELETE = createNextRoute(app, "events.delete");
