import { createHash, timingSafeEqual } from "node:crypto";
import type { Config } from "@gotch/nextsignal";

export function mcpTokenConfigured(config: Config): boolean {
  return config.get("mcp.access_token", "").length > 0;
}

export function hasMcpAccess(config: Config, authorization?: string | null): boolean {
  const expected = config.get("mcp.access_token", "");
  const supplied = authorization?.match(/^Bearer ([^\s]+)$/i)?.[1];
  if (!expected || !supplied) return false;
  const digest = (token: string) => createHash("sha256").update(token).digest();
  return timingSafeEqual(digest(expected), digest(supplied));
}
