"use client";
import { useEffect, useState } from "react";
import { goalsRequest } from "@/app/lib/goals-api";
import type { CalendarGoal } from "@/nextsignal/services";

export function GoalSelector({
  value,
  onChange
}: {
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const [goals, setGoals] = useState<CalendarGoal[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    goalsRequest<{ goals: CalendarGoal[] }>("", { signal: controller.signal })
      .then((data) => setGoals(data.goals))
      .catch((error: Error) => {
        if (!controller.signal.aborted) setError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [attempt]);
  return (
    <div className="field field-wide">
      <label className="field">
        <span>
          Goal <small>(optional)</small>
        </span>
        <select
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value || null)}
          disabled={loading}
        >
          <option value="">{loading ? "Loading goals…" : "No goal"}</option>
          {value && !goals.some((goal) => goal.id === value) && (
            <option value={value}>Current goal (unavailable)</option>
          )}
          {goals.map((goal) => (
            <option key={goal.id} value={goal.id}>
              {goal.title}
              {goal.achieved ? " · Achieved" : ""}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <span role="alert">
          {error}{" "}
          <button type="button" onClick={() => setAttempt((n) => n + 1)}>
            Retry
          </button>
        </span>
      )}
    </div>
  );
}
