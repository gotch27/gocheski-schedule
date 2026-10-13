import type { NextSignalApp, RequestContext, Result } from "@gotch/nextsignal";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { agentTools } from "@/nextsignal/processes/business/agent-calendar";
import type { AppServices } from "@/nextsignal/services";

export function publicResult(result: Result<unknown>) {
  return {
    ok: result.ok,
    ...(result.ok ? { data: result.data } : {}),
    errors: result.errors.map((error) => ({
      ...(error.code ? { code: error.code } : {}),
      message:
        result.meta.kind === "system"
          ? "The calendar operation failed. Read the current state before retrying a mutation."
          : (error.publicMessage ?? error.message)
    })),
    meta: result.meta
  };
}

export function createCalendarMcpServer(app: NextSignalApp<AppServices>, request: RequestContext) {
  const server = new McpServer(
    { name: "gocheski-schedule", version: "1.0.0" },
    {
      instructions:
        "Use get_calendar_context and read the schedule before making changes. Recurring changes require explicit scope. Use occurrenceStartsAt from reads, never a moved occurrence's startsAt. Goal and label management is not exposed. Mutations affect the same calendar as the UI."
    }
  );
  for (const tool of agentTools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.schema,
        annotations: {
          readOnlyHint: tool.readOnly,
          destructiveHint: tool.destructive,
          openWorldHint: !tool.readOnly
        }
      },
      async (input: unknown) => {
        const result = publicResult(
          await app.dispatch(tool.process.name, input, {
            request,
            runtime: "api"
          })
        );
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
          structuredContent: result,
          isError: !result.ok
        };
      }
    );
  }
  return server;
}
