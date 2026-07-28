"use client";

import {
  Check,
  ChevronLeft,
  ChevronRight,
  GripHorizontal,
  LogOut,
  Plus,
  Trash2,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";

type EventColor = "violet" | "blue" | "coral" | "green" | "amber";

type CalendarEvent = {
  id: string;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  color: EventColor;
  createdAt: string;
  updatedAt: string;
};

type EventInput = Pick<CalendarEvent, "title" | "description" | "startsAt" | "endsAt" | "color">;

type ApiEnvelope<T> = {
  ok: boolean;
  data?: T;
  errors: Array<{ message: string; publicMessage?: string }>;
};

type EditorState =
  | { mode: "create"; date: string }
  | { mode: "edit"; event: CalendarEvent };

type DragState = {
  pointerId: number;
  eventId: string;
  mode: "move" | "resize";
  original: CalendarEvent;
  current: CalendarEvent;
  grabOffsetY: number;
  startClientX: number;
  startClientY: number;
  moved: boolean;
};

type PendingSave = {
  baseline: CalendarEvent;
  latest: CalendarEvent;
  timer: number;
};

const DAY_START = 7 * 60;
const DAY_END = 22 * 60;
const SLOT_MINUTES = 15;
const SAVE_DELAY_MS = 5_000;
const TIME_GUTTER = 76;
const TOTAL_MINUTES = DAY_END - DAY_START;
const EVENTS_API_PATH = "/schedule/api/events";
const LOGIN_API_PATH = "/schedule/api/auth/login";
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const COLORS: Array<{ value: EventColor; label: string }> = [
  { value: "violet", label: "Violet" },
  { value: "blue", label: "Blue" },
  { value: "coral", label: "Coral" },
  { value: "green", label: "Green" },
  { value: "amber", label: "Amber" }
];

export function WeekCalendar() {
  const [weekStartKey, setWeekStartKey] = useState(() => dateKey(startOfWeek(new Date())));
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [activeEventId, setActiveEventId] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const timelineRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const dragCardRef = useRef<HTMLElement | null>(null);
  const dragFrameRef = useRef<number | null>(null);
  const pendingSavesRef = useRef(new Map<string, PendingSave>());
  const persistedEventsRef = useRef(new Map<string, CalendarEvent>());

  const weekStart = useMemo(() => parseDateKey(weekStartKey), [weekStartKey]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart]);
  const hours = useMemo(() => Array.from({ length: (DAY_END - DAY_START) / 60 }, (_, index) => DAY_START + index * 60), []);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const rangeStart = parseDateKey(weekStartKey);
    const rangeEnd = addDays(rangeStart, 7);

    try {
      const query = new URLSearchParams({
        weekStart: rangeStart.toISOString(),
        weekEnd: rangeEnd.toISOString()
      });
      const data = await apiRequest<{ events: CalendarEvent[] }>(`${EVENTS_API_PATH}?${query}`);
      setEvents(data.events);
      for (const event of data.events) persistedEventsRef.current.set(event.id, event);
    } catch (error) {
      setEvents([]);
      setLoadError(readError(error));
    } finally {
      setLoading(false);
    }
  }, [weekStartKey]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    function flushPendingSaves() {
      for (const pending of pendingSavesRef.current.values()) {
        window.clearTimeout(pending.timer);
        void fetch(EVENTS_API_PATH, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(eventPatchBody(pending.latest)),
          keepalive: true
        });
      }
      pendingSavesRef.current.clear();
    }

    window.addEventListener("pagehide", flushPendingSaves);
    return () => {
      window.removeEventListener("pagehide", flushPendingSaves);
      flushPendingSaves();
      if (dragFrameRef.current !== null) window.cancelAnimationFrame(dragFrameRef.current);
    };
  }, []);

  function changeWeek(offset: number) {
    setWeekStartKey(dateKey(addDays(weekStart, offset * 7)));
  }

  function goToToday() {
    setWeekStartKey(dateKey(startOfWeek(new Date())));
  }

  async function logout() {
    await fetch(LOGIN_API_PATH, { method: "DELETE" });
    window.location.replace("/schedule");
  }

  function openCreate(date = dateKey(isDateInWeek(new Date(), days) ? new Date() : days[0])) {
    setEditor({ mode: "create", date });
  }

  async function saveFromEditor(input: EventInput, id?: string) {
    if (id) {
      const previous = events.find((event) => event.id === id);
      if (!previous) return;
      const optimistic = { ...previous, ...input };
      const pending = cancelScheduledSave(id);
      const rollback = persistedEventsRef.current.get(id) ?? pending?.baseline ?? previous;
      setEvents((current) => current.map((event) => event.id === id ? optimistic : event));
      await persistEvent(optimistic, rollback);
      setNotice("Event updated");
    } else {
      const data = await apiRequest<{ event: CalendarEvent }>(EVENTS_API_PATH, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input)
      });
      const createdWeek = dateKey(startOfWeek(new Date(data.event.startsAt)));
      if (createdWeek !== weekStartKey) {
        setWeekStartKey(createdWeek);
      } else {
        setEvents((current) => [...current, data.event].sort(compareEvents));
      }
      persistedEventsRef.current.set(data.event.id, data.event);
      setNotice("Event created");
    }
    setEditor(null);
  }

  async function deleteFromEditor(id: string) {
    const pending = cancelScheduledSave(id);
    try {
      await apiRequest<{ id: string }>(EVENTS_API_PATH, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id })
      });
    } catch (error) {
      if (pending) scheduleEventSave(pending.latest, pending.baseline);
      throw error;
    }
    persistedEventsRef.current.delete(id);
    setEvents((current) => current.filter((event) => event.id !== id));
    setEditor(null);
    setNotice("Event deleted");
  }

  async function persistEvent(updated: CalendarEvent, previous: CalendarEvent) {
    try {
      const data = await apiRequest<{ event: CalendarEvent }>(EVENTS_API_PATH, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(eventPatchBody(updated))
      });
      persistedEventsRef.current.set(updated.id, data.event);
      const pending = pendingSavesRef.current.get(updated.id);
      if (pending) pendingSavesRef.current.set(updated.id, { ...pending, baseline: data.event });
      setEvents((current) => current.map((event) => {
        if (event.id !== updated.id) return event;
        return hasSameEditableValues(event, updated) ? data.event : event;
      }).sort(compareEvents));
    } catch (error) {
      setEvents((current) => current.map((event) => {
        if (event.id !== previous.id) return event;
        return hasSameEditableValues(event, updated) ? previous : event;
      }));
      setNotice(readError(error));
      throw error;
    }
  }

  function scheduleEventSave(updated: CalendarEvent, fallbackBaseline: CalendarEvent) {
    const existing = pendingSavesRef.current.get(updated.id);
    if (existing) window.clearTimeout(existing.timer);

    const baseline = existing?.baseline ?? persistedEventsRef.current.get(updated.id) ?? fallbackBaseline;
    const timer = window.setTimeout(() => {
      const pending = pendingSavesRef.current.get(updated.id);
      if (!pending || pending.timer !== timer) return;

      pendingSavesRef.current.delete(updated.id);
      void persistEvent(pending.latest, pending.baseline)
        .catch(() => undefined);
    }, SAVE_DELAY_MS);

    pendingSavesRef.current.set(updated.id, { baseline, latest: updated, timer });
  }

  function cancelScheduledSave(id: string) {
    const pending = pendingSavesRef.current.get(id);
    if (!pending) return undefined;

    window.clearTimeout(pending.timer);
    pendingSavesRef.current.delete(id);
    return pending;
  }

  function startDrag(pointerEvent: ReactPointerEvent<HTMLElement>, event: CalendarEvent, mode: "move" | "resize") {
    if (pointerEvent.button !== 0) return;
    const card = pointerEvent.currentTarget.closest<HTMLElement>(".calendar-event");
    if (!card) return;
    card.setPointerCapture(pointerEvent.pointerId);
    dragCardRef.current = card;
    dragRef.current = {
      pointerId: pointerEvent.pointerId,
      eventId: event.id,
      mode,
      original: event,
      current: event,
      grabOffsetY: mode === "move" ? pointerEvent.clientY - card.getBoundingClientRect().top : 0,
      startClientX: pointerEvent.clientX,
      startClientY: pointerEvent.clientY,
      moved: false
    };
    setActiveEventId(event.id);
    pointerEvent.preventDefault();
  }

  function moveDrag(pointerEvent: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    const timeline = timelineRef.current;
    if (!drag || !timeline || drag.pointerId !== pointerEvent.pointerId) return;
    if (!drag.moved && Math.hypot(pointerEvent.clientX - drag.startClientX, pointerEvent.clientY - drag.startClientY) < 3) return;

    const rect = timeline.getBoundingClientRect();
    const originalStart = new Date(drag.original.startsAt);
    const originalEnd = new Date(drag.original.endsAt);
    const duration = Math.max(SLOT_MINUTES, Math.round((originalEnd.getTime() - originalStart.getTime()) / 60_000));
    let updated: CalendarEvent;

    if (drag.mode === "resize") {
      const startMinutes = minutesOfDay(new Date(drag.current.startsAt));
      const pointerMinutes = snapMinutes(DAY_START + ((pointerEvent.clientY - rect.top) / rect.height) * TOTAL_MINUTES);
      const endMinutes = clamp(pointerMinutes, startMinutes + SLOT_MINUTES, DAY_END);
      updated = {
        ...drag.current,
        endsAt: localDateAtMinutes(new Date(drag.current.startsAt), endMinutes).toISOString()
      };
    } else {
      const dayWidth = (rect.width - TIME_GUTTER) / 7;
      const dayIndex = clamp(Math.floor((pointerEvent.clientX - rect.left - TIME_GUTTER) / dayWidth), 0, 6);
      const pointerTop = pointerEvent.clientY - rect.top - drag.grabOffsetY;
      const rawStart = snapMinutes(DAY_START + (pointerTop / rect.height) * TOTAL_MINUTES);
      const startMinutes = clamp(rawStart, DAY_START, DAY_END - duration);
      const start = localDateAtMinutes(days[dayIndex], startMinutes);
      updated = {
        ...drag.current,
        startsAt: start.toISOString(),
        endsAt: new Date(start.getTime() + duration * 60_000).toISOString()
      };
    }

    dragRef.current = { ...drag, current: updated, moved: true };
    if (dragFrameRef.current === null) {
      dragFrameRef.current = window.requestAnimationFrame(() => {
        dragFrameRef.current = null;
        const liveDrag = dragRef.current;
        const card = dragCardRef.current;
        if (!liveDrag || !card) return;
        applyEventCardLayout(card, liveDrag.current, days);
      });
    }
  }

  function endDrag(pointerEvent: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== pointerEvent.pointerId) return;
    if (dragFrameRef.current !== null) {
      window.cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = null;
    }
    dragRef.current = null;
    dragCardRef.current = null;
    setActiveEventId(null);

    if (drag.moved) {
      setEvents((current) => current.map((event) => event.id === drag.eventId ? drag.current : event));
      scheduleEventSave(drag.current, drag.original);
    } else if (drag.mode === "move") {
      setEditor({ mode: "edit", event: drag.original });
    }
  }

  function cancelDrag(pointerEvent: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== pointerEvent.pointerId) return;
    if (dragFrameRef.current !== null) {
      window.cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = null;
    }
    setEvents((current) => current.map((event) => event.id === drag.original.id ? drag.original : event));
    dragRef.current = null;
    dragCardRef.current = null;
    setActiveEventId(null);
  }

  function handleEventKey(event: CalendarEvent, keyboardEvent: React.KeyboardEvent<HTMLButtonElement>) {
    if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
      keyboardEvent.preventDefault();
      setEditor({ mode: "edit", event });
      return;
    }

    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(keyboardEvent.key)) return;
    keyboardEvent.preventDefault();

    const originalStart = new Date(event.startsAt);
    const originalEnd = new Date(event.endsAt);
    let start = new Date(originalStart);
    let end = new Date(originalEnd);

    if (keyboardEvent.shiftKey && (keyboardEvent.key === "ArrowUp" || keyboardEvent.key === "ArrowDown")) {
      end = new Date(end.getTime() + (keyboardEvent.key === "ArrowUp" ? -SLOT_MINUTES : SLOT_MINUTES) * 60_000);
      if (end.getTime() <= start.getTime()) end = new Date(start.getTime() + SLOT_MINUTES * 60_000);
      if (minutesOfDay(end) > DAY_END || dateKey(end) !== dateKey(start)) end = localDateAtMinutes(start, DAY_END);
    } else {
      const minuteDelta = keyboardEvent.key === "ArrowUp" ? -SLOT_MINUTES : keyboardEvent.key === "ArrowDown" ? SLOT_MINUTES : 0;
      const dayDelta = keyboardEvent.key === "ArrowLeft" ? -1 : keyboardEvent.key === "ArrowRight" ? 1 : 0;
      const duration = end.getTime() - start.getTime();
      const currentDayIndex = Math.max(0, days.findIndex((day) => dateKey(day) === dateKey(start)));
      const dayIndex = clamp(currentDayIndex + dayDelta, 0, 6);
      const startMinutes = clamp(minutesOfDay(start) + minuteDelta, DAY_START, DAY_END - duration / 60_000);
      start = localDateAtMinutes(days[dayIndex], startMinutes);
      end = new Date(start.getTime() + duration);
    }

    const updated = { ...event, startsAt: start.toISOString(), endsAt: end.toISOString() };
    setEvents((current) => current.map((item) => item.id === event.id ? updated : item));
    scheduleEventSave(updated, event);
  }

  const todayKey = dateKey(now);
  const currentMinutes = minutesOfDay(now);
  const showCurrentTime = days.some((day) => dateKey(day) === todayKey) && currentMinutes >= DAY_START && currentMinutes <= DAY_END;

  return (
    <main className="schedule-shell">
      <header className="topbar">
        <a className="brand-logo-link" href="/schedule" aria-label="Gocheski home">
          <img className="brand-logo" src="/schedule/goch-mark.svg" alt="" draggable="false" />
        </a>
        <div className="topbar-actions">
          <button className="logout-button" type="button" onClick={() => void logout()}>
            <LogOut size={14} /> <span>Log out</span>
          </button>
          <button className="primary-button" type="button" onClick={() => openCreate()}>
            <Plus size={16} strokeWidth={2.6} /> Event
          </button>
        </div>
      </header>

      <section className="calendar-section" id="calendar" aria-label="Weekly calendar">
        <div className="calendar-toolbar">
          <h1>{formatWeekRange(weekStart, days[6])}</h1>
          <div className="calendar-actions">
            <button className="today-button" type="button" onClick={goToToday}>Today</button>
            <div className="week-arrows" aria-label="Week navigation">
              <button type="button" aria-label="Previous week" onClick={() => changeWeek(-1)}><ChevronLeft size={18} /></button>
              <button type="button" aria-label="Next week" onClick={() => changeWeek(1)}><ChevronRight size={18} /></button>
            </div>
          </div>
        </div>

        {loadError && (
          <div className="connection-banner" role="status">
            <span><span className="connection-dot" /> Database setup needed</span>
            <p>{loadError}</p>
            <button type="button" onClick={() => void loadEvents()}>Try again</button>
          </div>
        )}

        <div className="calendar-frame">
          <div className="calendar-scroller" role="region" aria-label="Calendar hours" tabIndex={0}>
            <div className="calendar-canvas">
              <div className="days-header">
                <div className="timezone-label">Local</div>
                {days.map((day, index) => {
                  const isToday = dateKey(day) === todayKey;
                  return (
                    <button
                      className={`day-heading${isToday ? " is-today" : ""}`}
                      type="button"
                      key={dateKey(day)}
                      onClick={() => openCreate(dateKey(day))}
                      aria-label={`Add event on ${DAY_NAMES[index]}`}
                    >
                      <span>{DAY_NAMES[index].slice(0, 3)}</span>
                      <strong>{day.getDate()}</strong>
                    </button>
                  );
                })}
              </div>

              <div className="calendar-timeline" ref={timelineRef}>
                <div className="time-axis" aria-hidden="true">
                  {hours.map((minutes) => (
                    <span key={minutes} style={{ top: `${((minutes - DAY_START) / TOTAL_MINUTES) * 100}%` }}>
                      {formatTimeMinutes(minutes)}
                    </span>
                  ))}
                </div>

                <div className="day-columns" aria-hidden="true">
                  {days.map((day) => (
                    <div className={`calendar-day${dateKey(day) === todayKey ? " is-today" : ""}`} key={dateKey(day)} />
                  ))}
                </div>

                <div className="events-layer">
                  {events.map((event) => {
                    const layout = eventCardLayout(event, days);
                    if (!layout) return null;

                    return (
                      <button
                        key={event.id}
                        type="button"
                        className={`calendar-event event-${event.color}${activeEventId === event.id ? " is-dragging" : ""}${layout.compact ? " is-compact" : ""}`}
                        style={{ top: layout.top, height: layout.height, left: dayColumnLeft(layout.dayIndex) }}
                        onPointerDown={(pointerEvent) => startDrag(pointerEvent, event, "move")}
                        onPointerMove={moveDrag}
                        onPointerUp={endDrag}
                        onPointerCancel={cancelDrag}
                        onKeyDown={(keyboardEvent) => handleEventKey(event, keyboardEvent)}
                        aria-label={`${event.title}, ${formatEventTime(event)}. Drag to reschedule, or press Enter to edit.`}
                      >
                        <span className="event-accent" />
                        <span className="event-copy">
                          <strong>{event.title}</strong>
                          <span data-event-time>{formatEventTime(event)}</span>
                        </span>
                        <span
                          className="event-resize"
                          role="presentation"
                          onPointerDown={(pointerEvent) => {
                            pointerEvent.stopPropagation();
                            startDrag(pointerEvent, event, "resize");
                          }}
                        ><GripHorizontal size={14} /></span>
                      </button>
                    );
                  })}
                </div>

                {showCurrentTime && (
                  <div
                    className="current-time-line"
                    style={{
                      top: `${((currentMinutes - DAY_START) / TOTAL_MINUTES) * 100}%`,
                      left: `calc(${TIME_GUTTER}px + ((100% - ${TIME_GUTTER}px) / 7) * ${days.findIndex((day) => dateKey(day) === todayKey)})`,
                      width: `calc((100% - ${TIME_GUTTER}px) / 7)`
                    }}
                    aria-hidden="true"
                  ><span /></div>
                )}

                {!loading && !loadError && events.length === 0 && (
                  <button className="empty-calendar-hint" type="button" onClick={() => openCreate()}>
                    <span><Plus size={18} /></span>
                    <strong>Shape your first block</strong>
                    <small>Create an event, then drag it anywhere in the week.</small>
                  </button>
                )}

                {loading && <div className="calendar-loading"><span /> Loading your week</div>}
              </div>
            </div>
          </div>
        </div>
      </section>

      {notice && <div className="toast" role="status"><Check size={15} /> {notice}</div>}

      {editor && (
        <EventDialog
          key={editor.mode === "edit" ? editor.event.id : `new-${editor.date}`}
          editor={editor}
          onClose={() => setEditor(null)}
          onSave={saveFromEditor}
          onDelete={deleteFromEditor}
        />
      )}
    </main>
  );
}

function EventDialog({
  editor,
  onClose,
  onSave,
  onDelete
}: {
  editor: EditorState;
  onClose: () => void;
  onSave: (input: EventInput, id?: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const existing = editor.mode === "edit" ? editor.event : null;
  const initial = existing ? eventToDraft(existing) : newEventDraft(editor.mode === "create" ? editor.date : dateKey(new Date()));
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [duration, setDuration] = useState(initial.duration);
  const [color, setColor] = useState<EventColor>(initial.color);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(formEvent: FormEvent) {
    formEvent.preventDefault();
    if (!title.trim()) return;
    const start = new Date(`${date}T${time}:00`);
    const end = new Date(start.getTime() + duration * 60_000);
    if (minutesOfDay(start) < DAY_START || dateKey(end) !== date || minutesOfDay(end) > DAY_END) {
      setError("Choose a time between 7:00 AM and 10:00 PM.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave({
        title: title.trim(),
        description: description.trim(),
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        color
      }, existing?.id);
    } catch (submitError) {
      setError(readError(submitError));
      setBusy(false);
    }
  }

  async function remove() {
    if (!existing) return;
    setBusy(true);
    setError(null);
    try {
      await onDelete(existing.id);
    } catch (deleteError) {
      setError(readError(deleteError));
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="event-dialog" role="dialog" aria-modal="true" aria-labelledby="event-dialog-title">
        <div className="dialog-header">
          <div>
            <p className="eyebrow">{existing ? "Edit time block" : "New time block"}</p>
            <h2 id="event-dialog-title">{existing ? "Make a change" : "What are you making time for?"}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <form onSubmit={submit}>
          <label className="field field-wide">
            <span>Event name</span>
            <input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Deep work, training, coffee…" maxLength={120} />
          </label>

          <div className="form-grid">
            <label className="field">
              <span>Day</span>
              <input type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
            </label>
            <label className="field">
              <span>Starts at</span>
              <input type="time" value={time} min="07:00" max="21:45" step={900} onChange={(event) => setTime(event.target.value)} required />
            </label>
            <label className="field">
              <span>Duration</span>
              <select value={duration} onChange={(event) => setDuration(Number(event.target.value))}>
                {[15, 30, 45, 60, 90, 120, 180].map((minutes) => (
                  <option value={minutes} key={minutes}>{formatDuration(minutes)}</option>
                ))}
              </select>
            </label>
          </div>

          <label className="field field-wide">
            <span>Notes <small>optional</small></span>
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Add a little context…" maxLength={500} rows={3} />
          </label>

          <fieldset className="color-field">
            <legend>Color</legend>
            <div className="color-options">
              {COLORS.map((option) => (
                <label key={option.value} className={`color-option color-${option.value}${color === option.value ? " is-selected" : ""}`}>
                  <input type="radio" name="color" value={option.value} checked={color === option.value} onChange={() => setColor(option.value)} />
                  <span />
                  <small>{option.label}</small>
                </label>
              ))}
            </div>
          </fieldset>

          {error && <p className="form-error" role="alert">{error}</p>}

          <div className="dialog-actions">
            {existing ? (
              <button className="delete-button" type="button" onClick={() => void remove()} disabled={busy}><Trash2 size={16} /> Delete</button>
            ) : <span />}
            <div>
              <button className="secondary-button" type="button" onClick={onClose} disabled={busy}>Cancel</button>
              <button className="primary-button" type="submit" disabled={busy || !title.trim()}>{busy ? "Saving…" : existing ? "Save changes" : "Create event"}</button>
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}

async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json() as ApiEnvelope<T>;
  if (!response.ok || !payload.ok || !payload.data) {
    throw new Error(payload.errors?.[0]?.publicMessage ?? payload.errors?.[0]?.message ?? "Something went wrong.");
  }
  return payload.data;
}

function eventPatchBody(event: CalendarEvent) {
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    color: event.color
  };
}

function hasSameEditableValues(left: CalendarEvent, right: CalendarEvent) {
  return left.title === right.title
    && left.description === right.description
    && left.startsAt === right.startsAt
    && left.endsAt === right.endsAt
    && left.color === right.color;
}

function eventCardLayout(event: CalendarEvent, days: Date[]) {
  const start = new Date(event.startsAt);
  const end = new Date(event.endsAt);
  const dayIndex = days.findIndex((day) => dateKey(day) === dateKey(start));
  const startMinutes = minutesOfDay(start);
  const endMinutes = minutesOfDay(end);

  if (dayIndex < 0 || startMinutes >= DAY_END || endMinutes <= DAY_START) return null;

  const visibleStart = Math.max(startMinutes, DAY_START);
  const visibleEnd = Math.min(endMinutes, DAY_END);
  const visibleMinutes = visibleEnd - visibleStart;
  const top = `${((visibleStart - DAY_START) / TOTAL_MINUTES) * 100}%`;
  const height = `${(visibleMinutes / TOTAL_MINUTES) * 100}%`;
  return { dayIndex, top, height, compact: visibleMinutes < 45 };
}

function dayColumnLeft(dayIndex: number) {
  return `calc((100% / 7) * ${dayIndex} + 5px)`;
}

function applyEventCardLayout(card: HTMLElement, event: CalendarEvent, days: Date[]) {
  const layout = eventCardLayout(event, days);
  if (!layout) return;

  card.style.left = dayColumnLeft(layout.dayIndex);
  card.style.top = layout.top;
  card.style.height = layout.height;
  card.classList.toggle("is-compact", layout.compact);

  const time = card.querySelector<HTMLElement>("[data-event-time]");
  if (time) time.textContent = formatEventTime(event);
}

function startOfWeek(date: Date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  const day = result.getDay();
  result.setDate(result.getDate() - (day === 0 ? 6 : day - 1));
  return result;
}

function addDays(date: Date, amount: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseDateKey(value: string) {
  return new Date(`${value}T00:00:00`);
}

function localDateAtMinutes(date: Date, minutes: number) {
  const result = new Date(date);
  result.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return result;
}

function minutesOfDay(date: Date) {
  return date.getHours() * 60 + date.getMinutes();
}

function snapMinutes(minutes: number) {
  return Math.round(minutes / SLOT_MINUTES) * SLOT_MINUTES;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function formatTimeMinutes(minutes: number) {
  return new Intl.DateTimeFormat("en", { hour: "numeric", minute: minutes % 60 ? "2-digit" : undefined }).format(localDateAtMinutes(new Date(), minutes));
}

function formatEventTime(event: CalendarEvent) {
  const formatter = new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" });
  return `${formatter.format(new Date(event.startsAt))} – ${formatter.format(new Date(event.endsAt))}`;
}

function formatWeekRange(start: Date, end: Date) {
  const startText = new Intl.DateTimeFormat("en", { month: "long", day: "numeric" }).format(start);
  const endText = new Intl.DateTimeFormat("en", {
    month: start.getMonth() === end.getMonth() ? undefined : "long",
    day: "numeric",
    year: "numeric"
  }).format(end);
  return `${startText} – ${endText}`;
}

function formatDuration(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} hr ${remainder} min` : `${hours} ${hours === 1 ? "hour" : "hours"}`;
}

function isDateInWeek(date: Date, days: Date[]) {
  return date >= days[0] && date < addDays(days[6], 1);
}

function newEventDraft(date: string) {
  const now = new Date();
  const rounded = clamp(Math.ceil(minutesOfDay(now) / SLOT_MINUTES) * SLOT_MINUTES, DAY_START, DAY_END - 60);
  return { title: "", description: "", date, time: minutesToInput(rounded), duration: 60, color: "violet" as EventColor };
}

function eventToDraft(event: CalendarEvent) {
  const start = new Date(event.startsAt);
  const duration = Math.round((new Date(event.endsAt).getTime() - start.getTime()) / 60_000);
  return {
    title: event.title,
    description: event.description,
    date: dateKey(start),
    time: minutesToInput(minutesOfDay(start)),
    duration,
    color: event.color
  };
}

function minutesToInput(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function compareEvents(left: CalendarEvent, right: CalendarEvent) {
  return new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime();
}

function readError(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}
