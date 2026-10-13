const weekMilliseconds = 7 * 24 * 60 * 60_000;

type DateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export function shiftSeriesAnchor(
  anchor: Date,
  occurrence: Date,
  requested: Date,
  timeZone: string
) {
  const zone = validTimeZone(timeZone);
  const occurrenceWallTime = partsAsUtc(zonedParts(occurrence, zone));
  const requestedWallTime = partsAsUtc(zonedParts(requested, zone));
  return addWallMilliseconds(anchor, requestedWallTime - occurrenceWallTime, zone);
}

export function addWeeksInTimeZone(date: Date, weeks: number, timeZone: string) {
  return addWallMilliseconds(date, weeks * weekMilliseconds, timeZone);
}

function addWallMilliseconds(date: Date, milliseconds: number, timeZone: string) {
  const wallTime = new Date(partsAsUtc(zonedParts(date, timeZone)) + milliseconds);
  return zonedTimeToDate(
    {
      year: wallTime.getUTCFullYear(),
      month: wallTime.getUTCMonth() + 1,
      day: wallTime.getUTCDate(),
      hour: wallTime.getUTCHours(),
      minute: wallTime.getUTCMinutes(),
      second: wallTime.getUTCSeconds()
    },
    timeZone
  );
}

export function zonedTimeToDate(parts: DateParts, timeZone: string) {
  const targetWallTime = partsAsUtc(parts);
  let instant = targetWallTime;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const representedWallTime = partsAsUtc(zonedParts(new Date(instant), timeZone));
    instant += targetWallTime - representedWallTime;
  }

  return new Date(instant);
}

function zonedParts(date: Date, timeZone: string): DateParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  const values = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  );

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second
  };
}

function partsAsUtc(parts: DateParts) {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

export function dateKeyInTimeZone(date: Date, timeZone: string) {
  const parts = zonedParts(date, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function validTimeZone(timeZone: string | null) {
  if (!timeZone) return "UTC";

  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
    return timeZone;
  } catch {
    return "UTC";
  }
}
