import type { Config } from "@gotch/nextsignal";
import { dateKeyInTimeZone } from "@/nextsignal/services/calendar-time";
import { timeZone } from "@/nextsignal/mcp/schemas";

export function calendarTimeZone(config: Config, requested?: string): string {
  return timeZone.parse(requested ?? config.get("mcp.time_zone", "Europe/Skopje"));
}

/** The calendar renders 07:00 through midnight; retain minute precision accepted by its forms. */
export function placementError(
  startsAt: string,
  endsAt: string | undefined,
  zone: string
): string | null {
  const start = new Date(startsAt);
  const hour = Number(
    new Intl.DateTimeFormat("en", {
      timeZone: zone,
      hour: "numeric",
      hourCycle: "h23"
    }).format(start)
  );
  if (hour < 7) return "Choose a start time from 07:00 to midnight in the calendar time zone.";
  if (endsAt) {
    const end = new Date(endsAt);
    const duration = end.getTime() - start.getTime();
    if (duration < 15 * 60_000) return "The scheduled interval must be at least 15 minutes long.";
    // An interval may end exactly at the following midnight.
    if (dateKeyInTimeZone(start, zone) !== dateKeyInTimeZone(new Date(end.getTime() - 1), zone)) {
      return "The scheduled interval must end by midnight on the same calendar day.";
    }
  }
  return null;
}
