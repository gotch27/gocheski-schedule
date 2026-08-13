import { createNextRoute } from "@gotch/nextsignal/next";
import { app } from "@/nextsignal/app";

export const runtime = "nodejs";

const handler = createNextRoute(app, "notifications.sync");

export async function GET(request: Request, context: unknown) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false, errors: [{ message: "Unauthorized cron request." }] }, { status: 401 });
  }
  return handler(request, context as never);
}
