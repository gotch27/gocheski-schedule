import {
  clearSessionCookie,
  createSessionCookie,
  isAuthenticatedRequest,
  isValidAdminToken
} from "@/app/lib/schedule-auth";

export const runtime = "nodejs";

export function GET(request: Request) {
  return Response.json({ authenticated: isAuthenticatedRequest(request) });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as unknown;
    const token = typeof body === "object" && body !== null
      ? (body as Record<string, unknown>).token
      : undefined;

    if (!isValidAdminToken(token)) {
      return Response.json({ error: "Invalid admin token" }, { status: 401 });
    }

    return Response.json(
      { authenticated: true },
      { headers: { "Set-Cookie": createSessionCookie() } }
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Login failed" },
      { status: 400 }
    );
  }
}

export function DELETE() {
  return Response.json(
    { authenticated: false },
    { headers: { "Set-Cookie": clearSessionCookie() } }
  );
}
