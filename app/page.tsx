import { cookies } from "next/headers";
import { ScheduleLogin } from "@/app/components/schedule-login";
import { WeekCalendar } from "@/app/components/week-calendar";
import { isValidSessionCookie, sessionCookieName } from "@/app/lib/schedule-auth";

export default async function HomePage() {
  const cookieStore = await cookies();
  const isAuthenticated = isValidSessionCookie(cookieStore.get(sessionCookieName)?.value);

  return isAuthenticated ? <WeekCalendar /> : <ScheduleLogin />;
}
