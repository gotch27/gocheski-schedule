import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

export const sessionCookieName = "goch_admin_session";
const maxAgeSeconds = 60 * 60 * 24 * 7;

export function createSessionCookie() {
  const issuedAt = Date.now().toString();
  const signature = sign(issuedAt);

  return [
    `${sessionCookieName}=${issuedAt}.${signature}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    secureCookiePart(),
    `Max-Age=${maxAgeSeconds}`
  ]
    .filter(Boolean)
    .join("; ");
}

export function clearSessionCookie() {
  return [
    `${sessionCookieName}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    secureCookiePart(),
    "Max-Age=0"
  ]
    .filter(Boolean)
    .join("; ");
}

export function isAuthenticatedRequest(request: Request) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const value = cookieHeader
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${sessionCookieName}=`))
    ?.slice(sessionCookieName.length + 1);

  return isValidSessionCookie(value);
}

export function isValidSessionCookie(value: string | undefined) {
  if (!value) return false;

  const [issuedAt, signature] = value.split(".");
  if (!issuedAt || !signature || sign(issuedAt) !== signature) return false;

  const age = Date.now() - Number(issuedAt);
  return Number.isFinite(age) && age >= 0 && age <= maxAgeSeconds * 1000;
}

export function isValidAdminToken(token: unknown) {
  if (typeof token !== "string") return false;

  const expected = requiredEnv("ADMIN_TOKEN");
  const actualBuffer = Buffer.from(token);
  const expectedBuffer = Buffer.from(expected);

  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function sign(value: string) {
  return createHmac("sha256", requiredEnv("SESSION_SECRET")).update(value).digest("hex");
}

function requiredEnv(name: "ADMIN_TOKEN" | "SESSION_SECRET") {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function secureCookiePart() {
  return process.env.VERCEL ? "Secure" : "";
}
