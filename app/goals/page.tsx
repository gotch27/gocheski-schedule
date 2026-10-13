import { cookies } from "next/headers";
import { ScheduleLogin } from "@/app/components/schedule-login";
import { GoalsDashboard } from "@/app/components/goals-dashboard";
import { isValidSessionCookie, sessionCookieName } from "@/app/lib/schedule-auth";

export default async function GoalsPage() {
  const cookieStore = await cookies();
  return isValidSessionCookie(cookieStore.get(sessionCookieName)?.value) ? (
    <GoalsDashboard />
  ) : (
    <ScheduleLogin returnTo="/schedule/goals" />
  );
}
