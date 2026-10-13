import { goalColors } from "@/app/lib/goal-colors";
import type { CalendarGoal } from "@/nextsignal/services";

export function EventCardCopy({
  title,
  time,
  label,
  goal,
  compact
}: {
  title: string;
  time: string;
  label?: string;
  goal?: Pick<CalendarGoal, "title" | "color">;
  compact: boolean;
}) {
  return (
    <span className="event-copy">
      <strong>{title}</strong>
      {(goal || (label && !compact)) && (
        <span className="event-metadata">
          {label && !compact && <span className="event-label-name">{label}</span>}
          {goal && (
            <span
              className="event-goal-name"
              style={{ color: goalColors[goal.color] }}
              title={goal.title}
            >
              {goal.title}
            </span>
          )}
        </span>
      )}
      <span data-event-time>{time}</span>
    </span>
  );
}
