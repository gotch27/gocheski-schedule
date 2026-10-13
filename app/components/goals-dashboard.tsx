"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent
} from "react";
import { Plus, Target, X } from "lucide-react";
import { SectionNavigation } from "@/app/components/section-navigation";
import { goalsRequest } from "@/app/lib/goals-api";
import type { CalendarGoal, GoalWithStatistics } from "@/nextsignal/services";
import type { CreateGoalInput } from "@/nextsignal/schemas";
import { goalColors as colors } from "@/app/lib/goal-colors";

type DatedGoal = GoalWithStatistics & { startsOn: string; endsOn: string };
const dayMs = 86_400_000;
function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function dateNumber(key: string) {
  return Date.parse(`${key}T00:00:00Z`);
}
function displayDate(key: string) {
  return new Date(`${key}T12:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  });
}
function hours(minutes: number) {
  return `${(minutes / 60).toLocaleString(undefined, { maximumFractionDigits: 1 })}h`;
}
function zonedToday(goal: CalendarGoal, now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: goal.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
function status(goal: CalendarGoal, now: Date) {
  const today = zonedToday(goal, now);
  return goal.achieved
    ? "Achieved"
    : !goal.startsOn || !goal.endsOn
      ? "Ongoing"
      : goal.endsOn < today
        ? "Overdue"
        : goal.startsOn > today
          ? "Upcoming"
          : "In progress";
}

export function GoalsDashboard() {
  const [goals, setGoals] = useState<GoalWithStatistics[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => new Date());
  const [timelineFocus, setTimelineFocus] = useState<{ date: string } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<CalendarGoal | "new" | null>(null);
  const [deleting, setDeleting] = useState<CalendarGoal | null>(null);
  const [busy, setBusy] = useState(false);
  const [mutationError, setMutationError] = useState("");
  const requestRef = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const data = await goalsRequest<{ goals: GoalWithStatistics[] }>("/statistics", {
        signal: controller.signal
      });
      if (controller.signal.aborted) return;
      setGoals(data.goals);
      setNow(new Date());
      setLoaded(true);
      setError("");
    } catch (error) {
      if (!controller.signal.aborted)
        setError(error instanceof Error ? error.message : "Goals could not be loaded.");
    }
  }, []);
  useEffect(() => {
    void refresh();
    const update = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const interval = window.setInterval(update, 60_000);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      requestRef.current?.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [refresh]);
  const selected = goals.find((goal) => goal.id === selectedId);
  const datedGoals = goals.filter(
    (goal): goal is DatedGoal => goal.startsOn !== null && goal.endsOn !== null
  );
  const ongoingGoals = goals.filter((goal) => goal.startsOn === null);

  async function save(input: CreateGoalInput, existing?: CalendarGoal) {
    const data = await goalsRequest<{ goal: CalendarGoal }>("", {
      method: existing ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...input, ...(existing ? { id: existing.id } : {}) })
    });
    setSelectedId(data.goal.id);
    setTimelineFocus(data.goal.startsOn ? { date: data.goal.startsOn } : null);
    setEditor(null);
    await refresh();
  }
  async function toggle(goal: CalendarGoal) {
    setBusy(true);
    setMutationError("");
    try {
      await goalsRequest("", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: goal.id,
          title: goal.title,
          description: goal.description,
          startsOn: goal.startsOn,
          endsOn: goal.endsOn,
          timeZone: goal.timeZone,
          color: goal.color,
          achieved: !goal.achieved
        })
      });
      await refresh();
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "The goal could not be updated.");
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!deleting) return;
    setBusy(true);
    setMutationError("");
    try {
      await goalsRequest("", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: deleting.id })
      });
      if (selectedId === deleting.id) setSelectedId(null);
      setDeleting(null);
      await refresh();
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "The goal could not be deleted.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="goals-shell">
      <header className="topbar goals-topbar">
        <a className="brand-logo-link" href="/schedule" aria-label="Gocheski home">
          <img className="brand-logo" src="/schedule/goch-mark.svg" alt="" />
        </a>
        <SectionNavigation active="goals" />
        <span className="goals-topbar-caption">Make time for what matters.</span>
      </header>
      <div className="goals-content">
        <div className="goals-heading">
          <div>
            <p className="goals-eyebrow">THE BIGGER PICTURE</p>
            <h1>Your goals</h1>
            <p>Give your ambitions a place in your calendar.</p>
          </div>
          <button className="primary-button" onClick={() => setEditor("new")}>
            <Plus size={16} /> New goal
          </button>
        </div>
        {error && (
          <div className="goals-error" role="alert">
            {error}{" "}
            <button className="secondary-button" onClick={() => void refresh()}>
              Retry
            </button>
          </div>
        )}
        {!loaded && !error && <p role="status">Loading your goals…</p>}
        {loaded && (
          <>
            {goals.length === 0 ? (
              <section className="goals-empty">
                <Target size={36} />
                <h2>What do you want to work toward?</h2>
                <p>
                  Create a goal, with or without dates, then connect calendar events and to-dos to
                  see your time add up.
                </p>
                <button className="primary-button" onClick={() => setEditor("new")}>
                  Create your first goal
                </button>
              </section>
            ) : (
              <>
                {ongoingGoals.length > 0 && (
                  <section className="ongoing-goals" aria-label="Ongoing goals">
                    <h2>
                      Ongoing goals <span>No deadline</span>
                    </h2>
                    <div className="ongoing-goal-list">
                      {ongoingGoals.map((goal) => (
                        <button
                          key={goal.id}
                          type="button"
                          className={`ongoing-goal${selectedId === goal.id ? " is-selected" : ""}${goal.achieved ? " is-achieved" : ""}`}
                          aria-pressed={selectedId === goal.id}
                          onClick={() => setSelectedId(goal.id)}
                        >
                          <span
                            className="ongoing-goal-dot"
                            style={{ background: colors[goal.color] }}
                          />
                          <strong>{goal.title}</strong>
                          <span>
                            {goal.achieved ? "Achieved · " : ""}
                            {hours(goal.statistics.elapsedMinutes)} elapsed ·{" "}
                            {hours(goal.statistics.plannedMinutes)} upcoming
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>
                )}
                {datedGoals.length > 0 && (
                  <GoalTimeline
                    goals={datedGoals}
                    now={now}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    focus={timelineFocus}
                  />
                )}
                {selected ? (
                  <GoalDetails
                    key={selected.id}
                    goal={selected}
                    now={now}
                    busy={busy}
                    error={mutationError}
                    onEdit={() => setEditor(selected)}
                    onToggle={() => void toggle(selected)}
                    onDelete={() => {
                      setMutationError("");
                      setDeleting(selected);
                    }}
                  />
                ) : null}
              </>
            )}
          </>
        )}
      </div>
      {editor && (
        <GoalEditor
          goal={editor === "new" ? undefined : editor}
          onSave={save}
          onClose={() => setEditor(null)}
        />
      )}
      {deleting && (
        <GoalModal
          title="Delete this goal?"
          onClose={() => {
            if (!busy) setDeleting(null);
          }}
        >
          <p>
            Delete “{deleting.title}”? Linked calendar events and to-dos will remain, with their
            goal links cleared.
          </p>
          {mutationError && (
            <p className="form-error" role="alert">
              {mutationError}
            </p>
          )}
          <div className="goals-controls">
            <button className="secondary-button" disabled={busy} onClick={() => setDeleting(null)}>
              Keep goal
            </button>
            <button className="primary-button" disabled={busy} onClick={() => void remove()}>
              {busy ? "Deleting…" : "Delete goal"}
            </button>
          </div>
        </GoalModal>
      )}
    </main>
  );
}

function GoalTimeline({
  goals,
  now,
  selectedId,
  onSelect,
  focus
}: {
  goals: DatedGoal[];
  now: Date;
  selectedId: string | null;
  onSelect: (id: string) => void;
  focus: { date: string } | null;
}) {
  const pixelsPerDay = 12;
  const viewport = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  const [from, setFrom] = useState(() => dateNumber(dateKey(now)) - 14 * dayMs);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ id: number; x: number; from: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  useEffect(() => {
    const element = viewport.current!;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    setWidth(element.clientWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (focus) setFrom(dateNumber(focus.date) - 7 * dayMs);
  }, [focus]);
  const position = (date: number) => ((date - from) / dayMs) * pixelsPerDay;
  const until = from + (width / pixelsPerDay) * dayMs;
  // Each goal keeps its own row, including while panning across dates.
  const lines = [...goals]
    .sort(
      (a, b) =>
        a.startsOn.localeCompare(b.startsOn) ||
        a.endsOn.localeCompare(b.endsOn) ||
        a.id.localeCompare(b.id)
    )
    .map((goal, lane) => {
      const start = dateNumber(goal.startsOn);
      const end = dateNumber(goal.endsOn) + dayMs;
      return { goal, lane, start, end };
    });
  const firstTick = Math.floor(from / dayMs / 7) * 7 * dayMs;
  const ticks = Array.from(
    { length: Math.ceil(width / pixelsPerDay / 7) + 2 },
    (_, index) => new Date(firstTick + index * 7 * dayMs)
  );
  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (drag.current?.id !== event.pointerId) return;
    suppressClick.current = drag.current.moved;
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }
  return (
    <div
      ref={viewport}
      className={`goals-timeline-pan${dragging ? " is-dragging" : ""}`}
      role="region"
      tabIndex={0}
      aria-label="Goal timeline. Drag left or right to browse dates. Use arrow keys to pan, or Home to return to today."
      onPointerDown={(event) => {
        if (!event.isPrimary || event.button !== 0) return;
        suppressClick.current = false;
        drag.current = { id: event.pointerId, x: event.clientX, from, moved: false };
      }}
      onPointerMove={(event) => {
        const active = drag.current;
        if (!active || active.id !== event.pointerId) return;
        const distance = event.clientX - active.x;
        if (!active.moved && Math.abs(distance) < 4) return;
        if (!active.moved) {
          active.moved = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
        }
        setFrom(active.from - (distance / pixelsPerDay) * dayMs);
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={() => {
        drag.current = null;
        setDragging(false);
      }}
      onClickCapture={(event) => {
        if (suppressClick.current && event.detail !== 0) {
          event.preventDefault();
          event.stopPropagation();
        }
        suppressClick.current = false;
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          setFrom((value) => value + (event.key === "ArrowLeft" ? -7 : 7) * dayMs);
        } else if (event.key === "Home") {
          event.preventDefault();
          setFrom(dateNumber(dateKey(now)) - 14 * dayMs);
        }
      }}
      onWheel={(event) => {
        const distance = event.deltaX || (event.shiftKey ? event.deltaY : 0);
        if (distance)
          setFrom(
            (value) =>
              value + ((distance * (event.deltaMode === 1 ? 16 : 1)) / pixelsPerDay) * dayMs
          );
      }}
    >
      <div className="goal-axis">
        {ticks.map((tick) => (
          <span key={tick.toISOString()} style={{ left: position(tick.getTime()) }}>
            {tick.toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
              timeZone: "UTC"
            })}
          </span>
        ))}
      </div>
      <div className="goal-lines" style={{ height: Math.max(1, lines.length) * 34 + 16 }}>
        <div
          className="goal-today-marker"
          style={{ left: position(dateNumber(dateKey(now))) }}
          title="Today"
        />
        {lines
          .filter(({ start, end }) => start < until && end > from)
          .map(({ goal, lane, start, end }) => {
            const left = Math.max(0, position(start));
            const right = Math.min(width, position(end));
            const label = `${goal.title}, ${displayDate(goal.startsOn)} to ${displayDate(goal.endsOn)}, ${status(goal, now)}`;
            return (
              <button
                key={goal.id}
                className={`goal-timeline-line${selectedId === goal.id ? " is-selected" : ""}${goal.achieved ? " is-achieved" : ""}`}
                style={{ left, width: right - left, top: lane * 34 + 8, color: colors[goal.color] }}
                onClick={() => onSelect(goal.id)}
                aria-label={label}
                title={label}
                aria-pressed={selectedId === goal.id}
              >
                <span>{goal.title}</span>
                <i />
              </button>
            );
          })}
      </div>
    </div>
  );
}

function GoalDetails({
  goal,
  now,
  busy,
  error,
  onEdit,
  onToggle,
  onDelete
}: {
  goal: GoalWithStatistics;
  now: Date;
  busy: boolean;
  error: string;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const [shown, setShown] = useState(20);
  const stats = goal.statistics;
  const maxWeek = Math.max(
    1,
    ...stats.weeks.map((week) => week.elapsedMinutes + week.plannedMinutes)
  );
  const elapsedDays =
    goal.startsOn && goal.endsOn
      ? Math.max(
          0,
          Math.min(
            1,
            (dateNumber(zonedToday(goal, now)) - dateNumber(goal.startsOn)) /
              (dateNumber(goal.endsOn) + dayMs - dateNumber(goal.startsOn))
          )
        )
      : null;
  return (
    <section className="goal-details" aria-label={`${goal.title} details`}>
      <div className="goals-heading">
        <div>
          <p className="goals-eyebrow">GOAL DETAILS · {status(goal, now).toUpperCase()}</p>
          <h2>{goal.title}</h2>
          <p>
            {goal.startsOn && goal.endsOn
              ? `${displayDate(goal.startsOn)} – ${displayDate(goal.endsOn)}`
              : "No deadline"}{" "}
            · {goal.timeZone}
          </p>
        </div>
        <div className="goals-controls">
          <button className="secondary-button" disabled={busy} onClick={onEdit}>
            Edit
          </button>
          <button className="primary-button" disabled={busy} onClick={onToggle}>
            {goal.achieved ? "Reopen goal" : "Mark achieved"}
          </button>
          <button className="goal-delete" disabled={busy} onClick={onDelete}>
            Delete
          </button>
        </div>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {goal.description && <p className="goal-description">{goal.description}</p>}
      {elapsedDays !== null && (
        <div className="goal-date-progress">
          <span>
            Date progress <b>{Math.round(elapsedDays * 100)}%</b>
          </span>
          <progress max={1} value={elapsedDays} />
          <small>Time elapsed in the goal period. Achievement is marked manually.</small>
        </div>
      )}
      <div className="goal-detail-columns">
        <div>
          <h3>Time by week</h3>
          <p className="goal-hours-line">
            <strong>{hours(stats.elapsedMinutes)}</strong> elapsed <span>·</span>{" "}
            <strong>{hours(stats.plannedMinutes)}</strong> upcoming
          </p>
          <div className="goal-chart-legend">
            <span>
              <i />
              Elapsed
            </span>
            <span>
              <i />
              Planned
            </span>
          </div>
          {!stats.weeks.length && (
            <p className="goal-small-note">
              Link a scheduled event or to-do to start tracking time.
            </p>
          )}
          <div className="goal-week-chart">
            {stats.weeks.map((week) => (
              <div className="goal-week" key={week.startsOn}>
                <span>{displayDate(week.startsOn)}</span>
                <div
                  className="goal-week-track"
                  aria-label={`${hours(week.elapsedMinutes)} elapsed, ${hours(week.plannedMinutes)} planned`}
                >
                  <i style={{ width: `${(week.elapsedMinutes / maxWeek) * 100}%` }} />
                  <i style={{ width: `${(week.plannedMinutes / maxWeek) * 100}%` }} />
                </div>
                <span>{hours(week.elapsedMinutes + week.plannedMinutes)}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <h3>
            Linked tasks <span className="goal-task-count">{stats.tasks.length}</span>
          </h3>
          <p className="goal-small-note">
            {goal.startsOn
              ? "Event occurrences within goal dates, plus linked to-dos."
              : "Linked events and to-dos. Weekly repeats include the next 12 weeks."}
          </p>
          {!stats.tasks.length && (
            <p>No tasks yet. Choose this goal in a calendar event or to-do.</p>
          )}
          <ul className="goal-task-list">
            {stats.tasks.slice(0, shown).map((task) => (
              <li key={`${task.kind}:${task.id}`}>
                <div>
                  <strong>{task.title}</strong>
                  <span>
                    {task.kind === "event" ? "Event" : "To-do"} ·{" "}
                    {task.startsAt
                      ? new Date(task.startsAt).toLocaleString(undefined, {
                          timeZone: goal.timeZone,
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit"
                        })
                      : "Unscheduled"}
                    {task.startsAt && !task.endsAt ? " · No duration" : ""}
                  </span>
                </div>
                <span>{hours(task.elapsedMinutes + task.plannedMinutes)}</span>
              </li>
            ))}
          </ul>
          {shown < stats.tasks.length && (
            <button className="secondary-button" onClick={() => setShown((count) => count + 20)}>
              Show more tasks
            </button>
          )}
          <a className="goal-calendar-link" href="/schedule">
            Open calendar →
          </a>
        </div>
      </div>
      <p className="goals-accounting-note">
        {goal.startsOn
          ? "Time is inferred from the current schedule within this goal’s dates."
          : "Time is inferred from all linked work. Upcoming weekly repeats are counted for the next 12 weeks."}{" "}
        Overlapping tasks count independently. Editing, unlinking, or deleting past tasks changes
        these totals. Unscheduled to-dos and tasks without a duration add no time.
      </p>
    </section>
  );
}

function GoalModal({
  title,
  onClose,
  children
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    dialog.querySelector<HTMLInputElement>("input")?.focus();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="goal-modal"
      aria-labelledby="goal-modal-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="dialog-header">
        <h2 id="goal-modal-title">{title}</h2>
        <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

function GoalEditor({
  goal,
  onSave,
  onClose
}: {
  goal?: CalendarGoal;
  onSave: (input: CreateGoalInput, existing?: CalendarGoal) => Promise<void>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(goal?.title ?? "");
  const [description, setDescription] = useState(goal?.description ?? "");
  const [startsOn, setStartsOn] = useState(goal?.startsOn ?? dateKey(new Date()));
  const [endsOn, setEndsOn] = useState(
    goal?.endsOn ?? dateKey(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0))
  );
  const [hasDateRange, setHasDateRange] = useState(Boolean(goal?.startsOn && goal?.endsOn));
  const [color, setColor] = useState<CalendarGoal["color"]>(goal?.color ?? "violet");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!title.trim()) {
      setError("Give the goal a title.");
      return;
    }
    if (hasDateRange && (!startsOn || !endsOn || endsOn < startsOn)) {
      setError("Choose a start date and a deadline on or after it.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onSave(
        {
          title: title.trim(),
          description: description.trim(),
          startsOn: hasDateRange ? startsOn : null,
          endsOn: hasDateRange ? endsOn : null,
          color,
          timeZone: goal?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
          achieved: goal?.achieved ?? false
        },
        goal
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : "The goal could not be saved.");
      setBusy(false);
    }
  }
  return (
    <GoalModal
      title={goal ? "Edit goal" : "A new goal"}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form onSubmit={submit}>
        <label className="field">
          <span>Title</span>
          <input
            autoFocus
            required
            maxLength={120}
            placeholder="What do you want to achieve?"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="field">
          <span>
            Description <small>(optional)</small>
          </span>
          <textarea
            maxLength={2000}
            rows={4}
            placeholder="What would success look like?"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <label className="goal-range-toggle">
          <input
            type="checkbox"
            checked={hasDateRange}
            onChange={(event) => setHasDateRange(event.target.checked)}
          />
          <span>
            Set a date range <small>Optional — leave off for an ongoing goal.</small>
          </span>
        </label>
        {hasDateRange && (
          <div className="goal-date-fields">
            <label className="field">
              <span>Start date</span>
              <input
                type="date"
                required
                value={startsOn}
                onInput={(event) => setStartsOn(event.currentTarget.value)}
                onChange={(event) => setStartsOn(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Deadline</span>
              <input
                type="date"
                required
                min={startsOn}
                value={endsOn}
                onInput={(event) => setEndsOn(event.currentTarget.value)}
                onChange={(event) => setEndsOn(event.target.value)}
              />
            </label>
          </div>
        )}
        <fieldset className="goal-colors">
          <legend>Color</legend>
          {Object.entries(colors).map(([name, hex]) => (
            <label key={name}>
              <input
                type="radio"
                name="goal-color"
                value={name}
                checked={color === name}
                onChange={() => setColor(name as CalendarGoal["color"])}
              />
              <span style={{ background: hex }} />
              {name}
            </label>
          ))}
        </fieldset>
        <p className="goal-small-note">
          {hasDateRange ? "Dates use" : "Time is shown in"}{" "}
          {goal?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone}. Mark the goal
          achieved whenever you’re ready.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="goals-controls">
          <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" disabled={busy}>
            {busy ? "Saving…" : goal ? "Save changes" : "Create goal"}
          </button>
        </div>
      </form>
    </GoalModal>
  );
}
