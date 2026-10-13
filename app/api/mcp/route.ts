import { app } from "@/nextsignal/app";
import { handleCalendarMcpRequest } from "@/nextsignal/mcp/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handle = (request: Request) => handleCalendarMcpRequest(app, request);
export const POST = handle;
export const GET = handle;
export const DELETE = handle;
