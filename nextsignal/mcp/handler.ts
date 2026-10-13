import type { NextSignalApp } from "@gotch/nextsignal";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { hasMcpAccess, mcpTokenConfigured } from "@/nextsignal/mcp/auth";
import { createCalendarMcpServer } from "@/nextsignal/mcp/server";
import type { AppServices } from "@/nextsignal/services";

function errorResponse(status: number, message: string, headers: Record<string, string> = {}) {
  return Response.json(
    { error: message },
    { status, headers: { "cache-control": "no-store", ...headers } }
  );
}

export async function handleCalendarMcpRequest(
  app: NextSignalApp<AppServices>,
  request: Request
): Promise<Response> {
  await app.init();
  if (!mcpTokenConfigured(app.config)) return errorResponse(503, "Calendar MCP is not configured.");
  if (!hasMcpAccess(app.config, request.headers.get("authorization"))) {
    return errorResponse(401, "A valid calendar MCP bearer token is required.", {
      "www-authenticate": 'Bearer realm="gocheski-schedule"'
    });
  }
  const url = new URL(request.url);
  const hosts = app.config.get<string[]>("mcp.allowed_hosts", [
    "gocheski.com",
    "localhost",
    "127.0.0.1"
  ]);
  if (!hosts.includes(url.hostname)) return errorResponse(403, "Host is not allowed.");
  const hostHeader = request.headers.get("host");
  if (hostHeader) {
    try {
      if (
        /[\s/@?#]/.test(hostHeader) ||
        !hosts.includes(new URL(`http://${hostHeader}`).hostname)
      ) {
        return errorResponse(403, "Host is not allowed.");
      }
    } catch {
      return errorResponse(403, "Host is not allowed.");
    }
  }
  const origin = request.headers.get("origin");
  const origins = app.config.get<string[]>("mcp.allowed_origins", []);
  if (origin && origin !== url.origin && !origins.includes(origin)) {
    return errorResponse(403, "Origin is not allowed.");
  }
  // Stateless request/response transport: no persistent SSE channel or session to delete.
  if (request.method !== "POST")
    return errorResponse(405, "Use POST for stateless MCP requests.", {
      allow: "POST"
    });
  const server = createCalendarMcpServer(app, {
    method: request.method,
    url: request.url,
    headers: Object.fromEntries(request.headers)
  });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    maxRequestBodySize: 64 * 1024
  });
  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    response.headers.set("cache-control", "no-store");
    return response;
  } finally {
    await server.close();
  }
}
