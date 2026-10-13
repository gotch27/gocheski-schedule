import type { CalendarEvent } from "@/nextsignal/services";
import {
  addWeeksInTimeZone,
  dateKeyInTimeZone,
  validTimeZone
} from "@/nextsignal/services/calendar-time";

/** Check the original timestamp, not an exception's moved start, against the weekly series. */
export function belongsToSeries(event: CalendarEvent, occurrenceStartsAt: string): boolean {
  const anchor = new Date(event.recurrenceAnchorStartsAt);
  const occurrence = new Date(occurrenceStartsAt);
  if (event.recurrenceIntervalWeeks === null) return anchor.getTime() === occurrence.getTime();
  const zone = validTimeZone(event.recurrenceTimeZone);
  const day = dateKeyInTimeZone(occurrence, zone);
  if (event.recurrenceEndsOn && day > event.recurrenceEndsOn) return false;
  const weeks =
    (Date.parse(day) - Date.parse(dateKeyInTimeZone(anchor, zone))) / (7 * 24 * 60 * 60_000);
  return (
    weeks >= 0 &&
    Number.isInteger(weeks / event.recurrenceIntervalWeeks) &&
    addWeeksInTimeZone(anchor, weeks, zone).getTime() === occurrence.getTime()
  );
}
