import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { WeekCalendar } from "@/app/components/week-calendar";

test("calendar hydration markup is independent of clock, date, and time zone", (context) => {
  const originalZone = process.env.TZ;
  context.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-20T23:59:59Z") });
  try {
    process.env.TZ = "UTC";
    const serverMarkup = renderToString(createElement(WeekCalendar));
    context.mock.timers.tick(120_000);
    process.env.TZ = "Pacific/Auckland";
    const browserInitialMarkup = renderToString(createElement(WeekCalendar));
    assert.equal(browserInitialMarkup, serverMarkup);
    assert.match(serverMarkup, /Loading calendar/);
    assert.doesNotMatch(serverMarkup, /current-time-line/);
  } finally {
    context.mock.timers.reset();
    if (originalZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalZone;
  }
});
