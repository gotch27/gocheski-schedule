"use client";

import {
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardPaste,
  Copy,
  GripHorizontal,
  LogOut,
  Pencil,
  Plus,
  Trash2,
  X
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent
} from "react";

type EventColor = "violet" | "blue" | "coral" | "green" | "amber";
type RecurringEventScope = "series" | "occurrence";

type CalendarEvent = {
  id: string;
  occurrenceKey: string;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  recurrenceIntervalWeeks: number | null;
  recurrenceTimeZone: string | null;
  recurrenceEndsOn: string | null;
  recurrenceAnchorStartsAt: string;
  occurrenceStartsAt: string;
  isOccurrenceOverride: boolean;
  color: EventColor;
  createdAt: string;
  updatedAt: string;
};

type EventInput = Pick<CalendarEvent, "title" | "description" | "startsAt" | "endsAt" | "recurrenceIntervalWeeks" | "recurrenceTimeZone" | "recurrenceEndsOn" | "color">
  & { occurrenceStartsAt?: string };

type ApiEnvelope<T> = {
  ok: boolean;
  data?: T;
  errors: Array<{ message: string; publicMessage?: string }>;
};

type EditorState =
  | { mode: "create"; date: string; startMinutes?: number }
  | { mode: "edit"; event: CalendarEvent };

type DragState = {
  pointerId: number;
  eventKey: string;
  mode: "move" | "resize";
  original: CalendarEvent;
  current: CalendarEvent;
  originals: CalendarEvent[];
  currentEvents: CalendarEvent[];
  grabOffsetY: number;
  startClientX: number;
  startClientY: number;
  moved: boolean;
};

type SelectionDragState = {
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
};

type SelectionBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type PendingSave = {
  baseline: CalendarEvent;
  latest: CalendarEvent;
  scope: RecurringEventScope;
  reloadAfterSave: boolean;
  timer: number;
};

type PendingScopeChange = {
  previous: CalendarEvent;
  updated: CalendarEvent;
};

type EditorScopedAction =
  | { kind: "save"; input: EventInput }
  | { kind: "delete" };

type EventClipboard = Pick<CalendarEvent, "title" | "description" | "color"> & {
  durationMinutes: number;
};

type CalendarContextMenu = {
  kind: "calendar";
  x: number;
  y: number;
  dayIndex: number;
  startMinutes: number;
};

type EventContextMenu = {
  kind: "event";
  x: number;
  y: number;
  event: CalendarEvent;
};

type SelectionContextMenu = {
  kind: "selection";
  x: number;
  y: number;
  events: CalendarEvent[];
};

type ContextMenu = CalendarContextMenu | EventContextMenu | SelectionContextMenu;

type ContextDelete = {
  event: CalendarEvent;
  busy: boolean;
};

type BulkDelete = {
  events: CalendarEvent[];
  busy: boolean;
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
  const [activeEventKey, setActiveEventKey] = useState<string | null>(null);
  const [pendingScopeChange, setPendingScopeChange] = useState<PendingScopeChange | null>(null);
  const [eventClipboard, setEventClipboard] = useState<EventClipboard | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [contextDelete, setContextDelete] = useState<ContextDelete | null>(null);
  const [selectedEventKeys, setSelectedEventKeys] = useState<Set<string>>(() => new Set());
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const [bulkDelete, setBulkDelete] = useState<BulkDelete | null>(null);
  const [now, setNow] = useState(() => new Date());
  const timelineRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const dragFrameRef = useRef<number | null>(null);
  const selectionDragRef = useRef<SelectionDragState | null>(null);
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
      for (const event of data.events) persistedEventsRef.current.set(event.occurrenceKey, event);
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
    setSelectedEventKeys(new Set());
    setSelectionBox(null);
  }, [weekStartKey]);

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
    if (!contextMenu) return;

    const closeMenu = () => setContextMenu(null);
    const closeMenuOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };

    document.addEventListener("click", closeMenu);
    document.addEventListener("keydown", closeMenuOnEscape);
    window.addEventListener("blur", closeMenu);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      document.removeEventListener("click", closeMenu);
      document.removeEventListener("keydown", closeMenuOnEscape);
      window.removeEventListener("blur", closeMenu);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [contextMenu]);

  useEffect(() => {
    function flushPendingSaves() {
      for (const pending of pendingSavesRef.current.values()) {
        window.clearTimeout(pending.timer);
        void fetch(EVENTS_API_PATH, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(eventPatchBody(pending.latest, pending.scope)),
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

  function applyPendingScopeChange(scope: RecurringEventScope) {
    if (!pendingScopeChange) return;
    const updated = scope === "occurrence"
      ? { ...pendingScopeChange.updated, isOccurrenceOverride: true }
      : pendingScopeChange.updated;
    setEvents((current) => current.map((event) =>
      event.occurrenceKey === updated.occurrenceKey ? updated : event
    ));
    scheduleEventSave(updated, pendingScopeChange.previous, scope);
    setPendingScopeChange(null);
  }

  function cancelPendingScopeChange() {
    if (!pendingScopeChange) return;
    setEvents((current) => current.map((event) =>
      event.occurrenceKey === pendingScopeChange.previous.occurrenceKey
        ? pendingScopeChange.previous
        : event
    ));
    setPendingScopeChange(null);
  }

  async function logout() {
    await fetch(LOGIN_API_PATH, { method: "DELETE" });
    window.location.replace("/schedule");
  }

  function openCreate(
    date = dateKey(isDateInWeek(new Date(), days) ? new Date() : days[0]),
    startMinutes?: number
  ) {
    setEditor({ mode: "create", date, startMinutes });
  }

  async function createEvent(input: EventInput, successNotice: string) {
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
    persistedEventsRef.current.set(data.event.occurrenceKey, data.event);
    setNotice(successNotice);
  }

  async function saveFromEditor(
    input: EventInput,
    existing?: CalendarEvent,
    scope: RecurringEventScope = "series"
  ) {
    if (existing) {
      const previous = events.find((event) => event.occurrenceKey === existing.occurrenceKey);
      if (!previous) return;
      const optimistic = { ...previous, ...input };
      const pending = cancelScheduledSave(existing.occurrenceKey);
      const rollback = persistedEventsRef.current.get(existing.occurrenceKey) ?? pending?.baseline ?? previous;
      setEvents((current) => current.map((event) => event.occurrenceKey === existing.occurrenceKey ? optimistic : event));
      await persistEvent(optimistic, rollback, scope);
      setNotice(scope === "occurrence" ? "Event updated" : "Series updated");
    } else {
      await createEvent(input, "Event created");
    }
    setEditor(null);
  }

  function openEventContextMenu(mouseEvent: ReactMouseEvent, event: CalendarEvent) {
    mouseEvent.preventDefault();
    mouseEvent.stopPropagation();
    const selectedEvents = selectedEventKeys.has(event.occurrenceKey)
      ? events.filter((item) => selectedEventKeys.has(item.occurrenceKey))
      : [];

    if (selectedEvents.length > 1) {
      setContextMenu({
        kind: "selection",
        ...contextMenuPosition(mouseEvent.clientX, mouseEvent.clientY, 50),
        events: selectedEvents
      });
      return;
    }

    setSelectedEventKeys(new Set());
    setContextMenu({
      kind: "event",
      ...contextMenuPosition(mouseEvent.clientX, mouseEvent.clientY, 126),
      event
    });
  }

  function openCalendarContextMenu(mouseEvent: ReactMouseEvent<HTMLDivElement>) {
    mouseEvent.preventDefault();
    const timeline = timelineRef.current;
    if (!timeline) return;

    const rect = timeline.getBoundingClientRect();
    const contentX = mouseEvent.clientX - rect.left - TIME_GUTTER;
    if (contentX < 0 || contentX >= rect.width - TIME_GUTTER) {
      setContextMenu(null);
      return;
    }

    const dayWidth = (rect.width - TIME_GUTTER) / 7;
    const dayIndex = clamp(Math.floor(contentX / dayWidth), 0, 6);
    const startMinutes = clamp(
      snapMinutes(DAY_START + ((mouseEvent.clientY - rect.top) / rect.height) * TOTAL_MINUTES),
      DAY_START,
      DAY_END - SLOT_MINUTES
    );
    setContextMenu({
      kind: "calendar",
      ...contextMenuPosition(mouseEvent.clientX, mouseEvent.clientY, eventClipboard ? 88 : 50),
      dayIndex,
      startMinutes
    });
  }

  function addEventFromContextMenu(menu: CalendarContextMenu) {
    setContextMenu(null);
    openCreate(dateKey(days[menu.dayIndex]), menu.startMinutes);
  }

  function copyEventOccurrence(event: CalendarEvent) {
    const durationMinutes = Math.max(
      SLOT_MINUTES,
      Math.round((new Date(event.endsAt).getTime() - new Date(event.startsAt).getTime()) / 60_000)
    );
    setEventClipboard({
      title: event.title,
      description: event.description,
      color: event.color,
      durationMinutes
    });
    setContextMenu(null);
    setNotice("Event copied");
  }

  function editEventFromContextMenu(event: CalendarEvent) {
    setContextMenu(null);
    setEditor({ mode: "edit", event });
  }

  async function deleteEventFromContextMenu(event: CalendarEvent) {
    setContextMenu(null);
    if (needsRecurrenceScopeChoice(event)) {
      setContextDelete({ event, busy: false });
      return;
    }

    try {
      await deleteFromEditor(event, event.isOccurrenceOverride ? "occurrence" : "series");
    } catch (error) {
      setNotice(readError(error));
    }
  }

  async function confirmContextDelete(scope: RecurringEventScope) {
    if (!contextDelete) return;
    setContextDelete({ ...contextDelete, busy: true });
    try {
      await deleteFromEditor(contextDelete.event, scope);
      setContextDelete(null);
    } catch (error) {
      setNotice(readError(error));
      setContextDelete({ ...contextDelete, busy: false });
    }
  }

  function requestBulkDelete(selectedEvents: CalendarEvent[]) {
    setContextMenu(null);
    setBulkDelete({ events: selectedEvents, busy: false });
  }

  async function confirmBulkDelete() {
    if (!bulkDelete) return;
    const selectedEvents = bulkDelete.events;
    setBulkDelete({ ...bulkDelete, busy: true });
    let deletedCount = 0;

    try {
      for (const event of selectedEvents) {
        const scope: RecurringEventScope = event.recurrenceIntervalWeeks !== null ? "occurrence" : "series";
        await deleteFromEditor(event, scope);
        deletedCount += 1;
      }
      setSelectedEventKeys(new Set());
      setBulkDelete(null);
      setNotice(`${deletedCount} events deleted`);
    } catch (error) {
      setSelectedEventKeys(new Set());
      setBulkDelete(null);
      const prefix = deletedCount > 0 ? `${deletedCount} events deleted. ` : "";
      setNotice(`${prefix}${readError(error)}`);
    }
  }

  async function pasteEvent(menu: CalendarContextMenu) {
    if (!eventClipboard) return;
    setContextMenu(null);

    if (eventClipboard.durationMinutes > TOTAL_MINUTES) {
      setNotice("This event is too long to paste into one day");
      return;
    }

    const startMinutes = clamp(
      menu.startMinutes,
      DAY_START,
      DAY_END - eventClipboard.durationMinutes
    );
    const startsAt = localDateAtMinutes(days[menu.dayIndex], startMinutes);
    const endsAt = new Date(startsAt.getTime() + eventClipboard.durationMinutes * 60_000);
    const input: EventInput = {
      title: eventClipboard.title,
      description: eventClipboard.description,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      recurrenceIntervalWeeks: null,
      recurrenceTimeZone: null,
      recurrenceEndsOn: null,
      color: eventClipboard.color
    };

    try {
      await createEvent(input, "Event pasted");
    } catch (error) {
      setNotice(readError(error));
    }
  }

  async function deleteFromEditor(event: CalendarEvent, scope: RecurringEventScope = "series") {
    const pending = cancelScheduledSave(event.occurrenceKey);
    try {
      await apiRequest<{ id: string }>(EVENTS_API_PATH, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: event.id,
          occurrenceStartsAt: event.occurrenceStartsAt,
          scope
        })
      });
    } catch (error) {
      if (pending) scheduleEventSave(pending.latest, pending.baseline, pending.scope, pending.reloadAfterSave);
      throw error;
    }
    if (scope === "series") {
      for (const [key, persisted] of persistedEventsRef.current) {
        if (persisted.id === event.id) persistedEventsRef.current.delete(key);
      }
      setEvents((current) => current.filter((item) => item.id !== event.id));
    } else {
      persistedEventsRef.current.delete(event.occurrenceKey);
      setEvents((current) => current.filter((item) => item.occurrenceKey !== event.occurrenceKey));
    }
    setEditor(null);
    setNotice(scope === "occurrence" ? "Event deleted" : "Series deleted");
  }

  async function persistEvent(
    updated: CalendarEvent,
    previous: CalendarEvent,
    scope: RecurringEventScope,
    reloadAfterSave = scope === "series"
  ) {
    const eventKey = updated.occurrenceKey;
    try {
      const data = await apiRequest<{ event: CalendarEvent }>(EVENTS_API_PATH, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(eventPatchBody(updated, scope))
      });
      persistedEventsRef.current.delete(eventKey);
      persistedEventsRef.current.set(data.event.occurrenceKey, data.event);
      const pending = pendingSavesRef.current.get(eventKey);
      if (pending) pendingSavesRef.current.set(eventKey, { ...pending, baseline: data.event });
      setEvents((current) => current.map((event) => {
        if (event.occurrenceKey !== eventKey) return event;
        return hasSameEditableValues(event, updated) ? data.event : event;
      }).sort(compareEvents));
      if (reloadAfterSave) void loadEvents();
    } catch (error) {
      setEvents((current) => current.map((event) => {
        if (event.occurrenceKey !== previous.occurrenceKey) return event;
        return hasSameEditableValues(event, updated) ? previous : event;
      }));
      setNotice(readError(error));
      throw error;
    }
  }

  function scheduleEventSave(
    updated: CalendarEvent,
    fallbackBaseline: CalendarEvent,
    scope: RecurringEventScope,
    reloadAfterSave = scope === "series"
  ) {
    const eventKey = updated.occurrenceKey;
    const existing = pendingSavesRef.current.get(eventKey);
    if (existing) window.clearTimeout(existing.timer);

    const baseline = existing?.baseline ?? persistedEventsRef.current.get(eventKey) ?? fallbackBaseline;
    const timer = window.setTimeout(() => {
      const pending = pendingSavesRef.current.get(eventKey);
      if (!pending || pending.timer !== timer) return;

      pendingSavesRef.current.delete(eventKey);
      void persistEvent(pending.latest, pending.baseline, pending.scope, pending.reloadAfterSave)
        .catch(() => undefined);
    }, SAVE_DELAY_MS);

    pendingSavesRef.current.set(eventKey, { baseline, latest: updated, scope, reloadAfterSave, timer });
  }

  function cancelScheduledSave(eventKey: string) {
    const pending = pendingSavesRef.current.get(eventKey);
    if (!pending) return undefined;

    window.clearTimeout(pending.timer);
    pendingSavesRef.current.delete(eventKey);
    return pending;
  }

  function startSelection(pointerEvent: ReactPointerEvent<HTMLDivElement>) {
    if (pointerEvent.button !== 0 || (pointerEvent.target as HTMLElement).closest(".calendar-event")) return;
    const timeline = timelineRef.current;
    if (!timeline) return;

    const rect = timeline.getBoundingClientRect();
    const startX = clamp(pointerEvent.clientX - rect.left, TIME_GUTTER, rect.width);
    const startY = clamp(pointerEvent.clientY - rect.top, 0, rect.height);
    if (pointerEvent.clientX - rect.left < TIME_GUTTER) return;

    timeline.setPointerCapture(pointerEvent.pointerId);
    selectionDragRef.current = {
      pointerId: pointerEvent.pointerId,
      startX,
      startY,
      moved: false
    };
    setSelectedEventKeys(new Set());
    setSelectionBox(null);
    setContextMenu(null);
    pointerEvent.preventDefault();
  }

  function moveSelection(pointerEvent: ReactPointerEvent<HTMLDivElement>) {
    const selection = selectionDragRef.current;
    const timeline = timelineRef.current;
    if (!selection || !timeline || selection.pointerId !== pointerEvent.pointerId) return;

    const rect = timeline.getBoundingClientRect();
    const currentX = clamp(pointerEvent.clientX - rect.left, TIME_GUTTER, rect.width);
    const currentY = clamp(pointerEvent.clientY - rect.top, 0, rect.height);
    if (!selection.moved && Math.hypot(currentX - selection.startX, currentY - selection.startY) < 4) return;

    const box = {
      left: Math.min(selection.startX, currentX),
      top: Math.min(selection.startY, currentY),
      width: Math.abs(currentX - selection.startX),
      height: Math.abs(currentY - selection.startY)
    };
    selectionDragRef.current = { ...selection, moved: true };
    setSelectionBox(box);

    const selectionRect = {
      left: rect.left + box.left,
      top: rect.top + box.top,
      right: rect.left + box.left + box.width,
      bottom: rect.top + box.top + box.height
    };
    const selected = new Set<string>();
    timeline.querySelectorAll<HTMLElement>(".calendar-event").forEach((card) => {
      const cardRect = card.getBoundingClientRect();
      const intersects = cardRect.left < selectionRect.right
        && cardRect.right > selectionRect.left
        && cardRect.top < selectionRect.bottom
        && cardRect.bottom > selectionRect.top;
      if (intersects && card.dataset.eventKey) selected.add(card.dataset.eventKey);
    });
    setSelectedEventKeys(selected);
    pointerEvent.preventDefault();
  }

  function endSelection(pointerEvent: ReactPointerEvent<HTMLDivElement>) {
    const selection = selectionDragRef.current;
    if (!selection || selection.pointerId !== pointerEvent.pointerId) return;
    selectionDragRef.current = null;
    setSelectionBox(null);
  }

  function cancelSelection(pointerEvent: ReactPointerEvent<HTMLDivElement>) {
    const selection = selectionDragRef.current;
    if (!selection || selection.pointerId !== pointerEvent.pointerId) return;
    selectionDragRef.current = null;
    setSelectionBox(null);
    setSelectedEventKeys(new Set());
  }

  function startDrag(pointerEvent: ReactPointerEvent<HTMLElement>, event: CalendarEvent, mode: "move" | "resize") {
    if (pointerEvent.button !== 0) return;
    const card = pointerEvent.currentTarget.closest<HTMLElement>(".calendar-event");
    if (!card) return;
    const originals = mode === "move" && selectedEventKeys.has(event.occurrenceKey) && selectedEventKeys.size > 1
      ? events.filter((item) => selectedEventKeys.has(item.occurrenceKey))
      : [event];
    if (originals.length === 1 && selectedEventKeys.size > 0) setSelectedEventKeys(new Set());
    card.setPointerCapture(pointerEvent.pointerId);
    dragRef.current = {
      pointerId: pointerEvent.pointerId,
      eventKey: event.occurrenceKey,
      mode,
      original: event,
      current: event,
      originals,
      currentEvents: originals,
      grabOffsetY: mode === "move" ? pointerEvent.clientY - card.getBoundingClientRect().top : 0,
      startClientX: pointerEvent.clientX,
      startClientY: pointerEvent.clientY,
      moved: false
    };
    setActiveEventKey(event.occurrenceKey);
    setContextMenu(null);
    pointerEvent.preventDefault();
    pointerEvent.stopPropagation();
  }

  function moveDrag(pointerEvent: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    const timeline = timelineRef.current;
    if (!drag || !timeline || drag.pointerId !== pointerEvent.pointerId) return;
    if (!drag.moved && Math.hypot(pointerEvent.clientX - drag.startClientX, pointerEvent.clientY - drag.startClientY) < 3) return;

    const rect = timeline.getBoundingClientRect();
    const originalStart = new Date(drag.original.startsAt);
    let updated: CalendarEvent;
    let currentEvents: CalendarEvent[];

    if (drag.mode === "resize") {
      const startMinutes = minutesOfDay(new Date(drag.current.startsAt));
      const pointerMinutes = snapMinutes(DAY_START + ((pointerEvent.clientY - rect.top) / rect.height) * TOTAL_MINUTES);
      const endMinutes = clamp(pointerMinutes, startMinutes + SLOT_MINUTES, DAY_END);
      updated = {
        ...drag.current,
        endsAt: localDateAtMinutes(new Date(drag.current.startsAt), endMinutes).toISOString()
      };
      currentEvents = [updated];
    } else {
      const dayWidth = (rect.width - TIME_GUTTER) / 7;
      const desiredDayIndex = clamp(Math.floor((pointerEvent.clientX - rect.left - TIME_GUTTER) / dayWidth), 0, 6);
      const originalDayIndexes = drag.originals.map((item) => days.findIndex((day) => dateKey(day) === dateKey(new Date(item.startsAt))));
      const anchorDayIndex = days.findIndex((day) => dateKey(day) === dateKey(originalStart));
      const dayDelta = clamp(
        desiredDayIndex - anchorDayIndex,
        -Math.min(...originalDayIndexes),
        6 - Math.max(...originalDayIndexes)
      );
      const pointerTop = pointerEvent.clientY - rect.top - drag.grabOffsetY;
      const rawStart = snapMinutes(DAY_START + (pointerTop / rect.height) * TOTAL_MINUTES);
      const earliestStart = Math.min(...drag.originals.map((item) => minutesOfDay(new Date(item.startsAt))));
      const latestEnd = Math.max(...drag.originals.map((item) => minutesOfDay(new Date(item.endsAt))));
      const requestedMinuteDelta = rawStart - minutesOfDay(originalStart);
      const minuteDelta = clamp(requestedMinuteDelta, DAY_START - earliestStart, DAY_END - latestEnd);

      currentEvents = drag.originals.map((item) => {
        const itemStart = new Date(item.startsAt);
        const itemEnd = new Date(item.endsAt);
        const targetDay = addDays(itemStart, dayDelta);
        const start = localDateAtMinutes(targetDay, minutesOfDay(itemStart) + minuteDelta);
        return {
          ...item,
          startsAt: start.toISOString(),
          endsAt: new Date(start.getTime() + itemEnd.getTime() - itemStart.getTime()).toISOString()
        };
      });
      updated = currentEvents.find((item) => item.occurrenceKey === drag.eventKey) ?? drag.current;
    }

    dragRef.current = { ...drag, current: updated, currentEvents, moved: true };
    if (dragFrameRef.current === null) {
      dragFrameRef.current = window.requestAnimationFrame(() => {
        dragFrameRef.current = null;
        const liveDrag = dragRef.current;
        const timeline = timelineRef.current;
        if (!liveDrag || !timeline) return;
        const currentByKey = new Map(liveDrag.currentEvents.map((item) => [item.occurrenceKey, item]));
        timeline.querySelectorAll<HTMLElement>(".calendar-event").forEach((card) => {
          const current = card.dataset.eventKey ? currentByKey.get(card.dataset.eventKey) : undefined;
          if (current) applyEventCardLayout(card, current, days);
        });
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
    setActiveEventKey(null);

    if (drag.moved) {
      const currentByKey = new Map(drag.currentEvents.map((item) => [item.occurrenceKey, item]));
      setEvents((current) => current.map((event) => currentByKey.get(event.occurrenceKey) ?? event));
      if (drag.originals.length > 1) {
        for (const original of drag.originals) {
          const current = currentByKey.get(original.occurrenceKey);
          if (!current) continue;
          scheduleEventSave(
            current,
            original,
            original.recurrenceIntervalWeeks !== null ? "occurrence" : "series",
            false
          );
        }
        setNotice(`${drag.originals.length} events moved`);
      } else if (!needsRecurrenceScopeChoice(drag.original)) {
        scheduleEventSave(
          drag.current,
          drag.original,
          drag.original.isOccurrenceOverride ? "occurrence" : "series"
        );
      } else {
        setPendingScopeChange({ previous: drag.original, updated: drag.current });
      }
    } else if (drag.mode === "move" && drag.originals.length === 1) {
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
    const originalsByKey = new Map(drag.originals.map((item) => [item.occurrenceKey, item]));
    setEvents((current) => current.map((event) => originalsByKey.get(event.occurrenceKey) ?? event));
    dragRef.current = null;
    setActiveEventKey(null);
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
    setEvents((current) => current.map((item) => item.occurrenceKey === event.occurrenceKey ? updated : item));
    if (!needsRecurrenceScopeChoice(event)) {
      scheduleEventSave(updated, event, event.isOccurrenceOverride ? "occurrence" : "series");
    } else {
      setPendingScopeChange({ previous: event, updated });
    }
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

              <div
                className="calendar-timeline"
                ref={timelineRef}
                onPointerDown={startSelection}
                onPointerMove={moveSelection}
                onPointerUp={endSelection}
                onPointerCancel={cancelSelection}
                onContextMenu={openCalendarContextMenu}
              >
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

                {selectionBox && (
                  <div
                    className="selection-box"
                    style={selectionBox}
                    aria-hidden="true"
                  />
                )}

                <div className="events-layer">
                  {events.map((event) => {
                    const layout = eventCardLayout(event, days);
                    if (!layout) return null;
                    const isSelected = selectedEventKeys.has(event.occurrenceKey);

                    return (
                      <button
                        key={event.occurrenceKey}
                        type="button"
                        className={`calendar-event event-${event.color}${activeEventKey === event.occurrenceKey ? " is-dragging" : ""}${isSelected ? " is-selected" : ""}${layout.compact ? " is-compact" : ""}`}
                        data-event-key={event.occurrenceKey}
                        aria-pressed={isSelected}
                        style={{ top: layout.top, height: layout.height, left: dayColumnLeft(layout.dayIndex) }}
                        onPointerDown={(pointerEvent) => startDrag(pointerEvent, event, "move")}
                        onPointerMove={moveDrag}
                        onPointerUp={endDrag}
                        onPointerCancel={cancelDrag}
                        onContextMenu={(mouseEvent) => openEventContextMenu(mouseEvent, event)}
                        onKeyDown={(keyboardEvent) => handleEventKey(event, keyboardEvent)}
                        aria-label={`${event.title}, ${formatEventTime(event)}.${formatRecurrenceForAria(event)} Drag to reschedule, press Enter to edit, or right-click to copy.`}
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

      {contextMenu && (
        <div
          className="calendar-context-menu"
          role="menu"
          aria-label={contextMenu.kind === "event"
            ? "Event actions"
            : contextMenu.kind === "selection"
              ? "Selected event actions"
              : "Calendar actions"}
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onContextMenu={(mouseEvent) => mouseEvent.preventDefault()}
          onClick={(mouseEvent) => mouseEvent.stopPropagation()}
        >
          {contextMenu.kind === "event" ? (
            <>
              <button type="button" role="menuitem" onClick={() => copyEventOccurrence(contextMenu.event)}>
                <Copy size={15} />
                <span>Copy event</span>
              </button>
              <button type="button" role="menuitem" onClick={() => editEventFromContextMenu(contextMenu.event)}>
                <Pencil size={15} />
                <span>Edit event</span>
              </button>
              <button
                className="is-danger"
                type="button"
                role="menuitem"
                onClick={() => void deleteEventFromContextMenu(contextMenu.event)}
              >
                <Trash2 size={15} />
                <span>Delete event</span>
              </button>
            </>
          ) : contextMenu.kind === "selection" ? (
            <button
              className="is-danger"
              type="button"
              role="menuitem"
              onClick={() => requestBulkDelete(contextMenu.events)}
            >
              <Trash2 size={15} />
              <span>Delete {contextMenu.events.length} selected events</span>
            </button>
          ) : (
            <>
              <button type="button" role="menuitem" onClick={() => addEventFromContextMenu(contextMenu)}>
                <Plus size={15} />
                <span>Add event</span>
              </button>
              {eventClipboard && (
                <button type="button" role="menuitem" onClick={() => void pasteEvent(contextMenu)}>
                  <ClipboardPaste size={15} />
                  <span>Paste “{eventClipboard.title}”</span>
                </button>
              )}
            </>
          )}
        </div>
      )}

      {editor && (
        <EventDialog
          key={editor.mode === "edit" ? editor.event.occurrenceKey : `new-${editor.date}`}
          editor={editor}
          onClose={() => setEditor(null)}
          onSave={saveFromEditor}
          onDelete={deleteFromEditor}
        />
      )}

      {pendingScopeChange && (
        <RecurrenceScopeDialog
          action="update"
          onChoose={applyPendingScopeChange}
          onCancel={cancelPendingScopeChange}
        />
      )}

      {contextDelete && (
        <RecurrenceScopeDialog
          action="delete"
          busy={contextDelete.busy}
          onChoose={(scope) => void confirmContextDelete(scope)}
          onCancel={() => setContextDelete(null)}
        />
      )}

      {bulkDelete && (
        <BulkDeleteDialog
          count={bulkDelete.events.length}
          busy={bulkDelete.busy}
          onConfirm={() => void confirmBulkDelete()}
          onCancel={() => setBulkDelete(null)}
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
  onSave: (input: EventInput, existing?: CalendarEvent, scope?: RecurringEventScope) => Promise<void>;
  onDelete: (event: CalendarEvent, scope?: RecurringEventScope) => Promise<void>;
}) {
  const existing = editor.mode === "edit" ? editor.event : null;
  const initial = editor.mode === "edit"
    ? eventToDraft(editor.event)
    : newEventDraft(editor.date, editor.startMinutes);
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [durationHours, setDurationHours] = useState(String(Math.floor(initial.duration / 60)));
  const [durationMinutes, setDurationMinutes] = useState(String(initial.duration % 60));
  const [color, setColor] = useState<EventColor>(initial.color);
  const [recurring, setRecurring] = useState(initial.recurrenceIntervalWeeks !== null);
  const [recurrenceIntervalWeeks, setRecurrenceIntervalWeeks] = useState(initial.recurrenceIntervalWeeks ?? 1);
  const [recurrenceEndMode, setRecurrenceEndMode] = useState<"on" | "never">(
    initial.recurrenceIntervalWeeks !== null && initial.recurrenceEndsOn === null ? "never" : "on"
  );
  const [recurrenceEndsOn, setRecurrenceEndsOn] = useState(initial.recurrenceEndsOn ?? defaultRecurrenceEnd(initial.date));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scopedAction, setScopedAction] = useState<EditorScopedAction | null>(null);

  async function submit(formEvent: FormEvent) {
    formEvent.preventDefault();
    if (!title.trim()) return;
    const hours = Number(durationHours);
    const minutes = Number(durationMinutes);
    if (!Number.isInteger(hours) || hours < 0 || hours > 15 || !Number.isInteger(minutes) || minutes < 0 || minutes > 59) {
      setError("Enter a valid duration in hours and minutes.");
      return;
    }
    const duration = hours * 60 + minutes;
    if (duration < SLOT_MINUTES) {
      setError("Events must be at least 15 minutes long.");
      return;
    }
    const start = new Date(`${date}T${time}:00`);
    const end = new Date(start.getTime() + duration * 60_000);
    if (minutesOfDay(start) < DAY_START || dateKey(end) !== date || minutesOfDay(end) > DAY_END) {
      setError("Choose a time between 7:00 AM and 10:00 PM.");
      return;
    }
    const input: EventInput = {
      title: title.trim(),
      description: description.trim(),
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      recurrenceIntervalWeeks: recurring ? recurrenceIntervalWeeks : null,
      recurrenceTimeZone: recurring
        ? existing?.recurrenceTimeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC"
        : null,
      recurrenceEndsOn: recurring && recurrenceEndMode === "on" ? recurrenceEndsOn : null,
      ...(existing ? { occurrenceStartsAt: existing.occurrenceStartsAt } : {}),
      color
    };

    if (existing && needsRecurrenceScopeChoice(existing)) {
      setScopedAction({ kind: "save", input });
      return;
    }

    await commitSave(input, existing?.isOccurrenceOverride ? "occurrence" : "series");
  }

  async function remove() {
    if (!existing) return;

    if (needsRecurrenceScopeChoice(existing)) {
      setScopedAction({ kind: "delete" });
      return;
    }

    await commitDelete(existing.isOccurrenceOverride ? "occurrence" : "series");
  }

  async function commitSave(input: EventInput, scope: RecurringEventScope) {
    setBusy(true);
    setError(null);
    try {
      await onSave(input, existing ?? undefined, scope);
    } catch (saveError) {
      setError(readError(saveError));
      setBusy(false);
      setScopedAction(null);
    }
  }

  async function commitDelete(scope: RecurringEventScope) {
    if (!existing) return;
    setBusy(true);
    setError(null);
    try {
      await onDelete(existing, scope);
    } catch (deleteError) {
      setError(readError(deleteError));
      setBusy(false);
      setScopedAction(null);
    }
  }

  if (scopedAction) {
    return (
      <RecurrenceScopeDialog
        action={scopedAction.kind === "save" ? "update" : "delete"}
        busy={busy}
        onChoose={(scope) => {
          if (scopedAction.kind === "save") void commitSave(scopedAction.input, scope);
          else void commitDelete(scope);
        }}
        onCancel={() => setScopedAction(null)}
      />
    );
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="event-dialog" role="dialog" aria-modal="true" aria-labelledby="event-dialog-title">
        <div className="dialog-header">
          <div>
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
              <input
                type="date"
                value={date}
                onChange={(event) => {
                  const nextDate = event.target.value;
                  setDate(nextDate);
                  if (recurrenceEndMode === "on" && recurrenceEndsOn < nextDate) {
                    setRecurrenceEndsOn(defaultRecurrenceEnd(nextDate));
                  }
                }}
                required
              />
            </label>
            <label className="field">
              <span>Starts at</span>
              <input type="time" value={time} min="07:00" max="21:45" step={900} onChange={(event) => setTime(event.target.value)} required />
            </label>
            <div className="field duration-field">
              <span>Duration</span>
              <div className="duration-inputs">
                <label>
                  <input
                    aria-label="Duration hours"
                    type="number"
                    min={0}
                    max={15}
                    step={1}
                    inputMode="numeric"
                    value={durationHours}
                    onChange={(event) => setDurationHours(event.target.value)}
                    required
                  />
                  <span>hr</span>
                </label>
                <label>
                  <input
                    aria-label="Duration minutes"
                    type="number"
                    min={0}
                    max={59}
                    step={1}
                    inputMode="numeric"
                    value={durationMinutes}
                    onChange={(event) => setDurationMinutes(event.target.value)}
                    required
                  />
                  <span>min</span>
                </label>
              </div>
            </div>
          </div>

          <div className={`recurrence-control${recurring ? " is-enabled" : ""}`}>
            <label className="recurrence-toggle">
              <input
                type="checkbox"
                checked={recurring}
                onChange={(event) => setRecurring(event.target.checked)}
              />
              <span>
                <strong>Repeat this event</strong>
                <small>Keep it on future weeks.</small>
              </span>
            </label>
            {recurring && (
              <div className="recurrence-settings">
                <label className="recurrence-frequency">
                  <span>Every</span>
                  <input
                    aria-label="Repeat interval in weeks"
                    type="number"
                    min={1}
                    max={52}
                    step={1}
                    value={recurrenceIntervalWeeks}
                    onChange={(event) => setRecurrenceIntervalWeeks(clamp(Number(event.target.value) || 1, 1, 52))}
                  />
                  <span>{recurrenceIntervalWeeks === 1 ? "week" : "weeks"}</span>
                </label>
                <label className="recurrence-end">
                  <span>Ends</span>
                  <select
                    aria-label="Repeat end condition"
                    value={recurrenceEndMode}
                    onChange={(event) => setRecurrenceEndMode(event.target.value as "on" | "never")}
                  >
                    <option value="on">On</option>
                    <option value="never">Never</option>
                  </select>
                  {recurrenceEndMode === "on" && (
                    <input
                      aria-label="Repeat end date"
                      type="date"
                      min={date}
                      value={recurrenceEndsOn}
                      onChange={(event) => setRecurrenceEndsOn(event.target.value)}
                      required
                    />
                  )}
                </label>
              </div>
            )}
          </div>

          {existing && needsRecurrenceScopeChoice(existing) && (
            <p className="recurrence-note">When you save or delete, choose this event or the entire series.</p>
          )}

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
              <button className="delete-button" type="button" onClick={() => void remove()} disabled={busy}>
                <Trash2 size={16} /> Delete
              </button>
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

function BulkDeleteDialog({
  count,
  busy,
  onConfirm,
  onCancel
}: {
  count: number;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="scope-dialog" role="dialog" aria-modal="true" aria-labelledby="bulk-delete-dialog-title">
        <p className="eyebrow">Multiple events</p>
        <h2 id="bulk-delete-dialog-title">Delete {count} selected events?</h2>
        <p>Standalone events will be removed. For recurring events, only the selected occurrences will be deleted.</p>
        <div className="scope-actions">
          <button className="secondary-button" type="button" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="scope-delete-button" type="button" onClick={onConfirm} disabled={busy}>
            {busy ? "Deleting…" : `Delete ${count} events`}
          </button>
        </div>
      </section>
    </div>
  );
}

function RecurrenceScopeDialog({
  action,
  busy = false,
  onChoose,
  onCancel
}: {
  action: "update" | "delete";
  busy?: boolean;
  onChoose: (scope: RecurringEventScope) => void;
  onCancel: () => void;
}) {
  const deleting = action === "delete";

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="scope-dialog" role="dialog" aria-modal="true" aria-labelledby="scope-dialog-title">
        <p className="eyebrow">Recurring event</p>
        <h2 id="scope-dialog-title">{deleting ? "Delete recurring event?" : "Update recurring event?"}</h2>
        <p>Choose whether this applies only to the occurrence you selected or to every event in the series.</p>
        <div className="scope-actions">
          <button className="secondary-button" type="button" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className={deleting ? "scope-delete-button" : "secondary-button"} type="button" onClick={() => onChoose("occurrence")} disabled={busy}>
            This event
          </button>
          <button className={deleting ? "scope-delete-button" : "primary-button"} type="button" onClick={() => onChoose("series")} disabled={busy}>
            Entire series
          </button>
        </div>
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

function eventPatchBody(event: CalendarEvent, scope: RecurringEventScope) {
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    recurrenceIntervalWeeks: event.recurrenceIntervalWeeks,
    recurrenceTimeZone: event.recurrenceTimeZone,
    recurrenceEndsOn: event.recurrenceEndsOn,
    occurrenceStartsAt: event.occurrenceStartsAt,
    scope,
    color: event.color
  };
}

function needsRecurrenceScopeChoice(event: CalendarEvent) {
  return event.recurrenceIntervalWeeks !== null && !event.isOccurrenceOverride;
}

function hasSameEditableValues(left: CalendarEvent, right: CalendarEvent) {
  return left.title === right.title
    && left.description === right.description
    && left.startsAt === right.startsAt
    && left.endsAt === right.endsAt
    && left.recurrenceIntervalWeeks === right.recurrenceIntervalWeeks
    && left.recurrenceTimeZone === right.recurrenceTimeZone
    && left.recurrenceEndsOn === right.recurrenceEndsOn
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

function contextMenuPosition(clientX: number, clientY: number, menuHeight: number) {
  const menuWidth = 220;
  const viewportPadding = 8;
  return {
    x: clamp(clientX, viewportPadding, window.innerWidth - menuWidth - viewportPadding),
    y: clamp(clientY, viewportPadding, window.innerHeight - menuHeight - viewportPadding)
  };
}

function formatTimeMinutes(minutes: number) {
  return new Intl.DateTimeFormat("en", { hour: "numeric", minute: minutes % 60 ? "2-digit" : undefined }).format(localDateAtMinutes(new Date(), minutes));
}

function formatEventTime(event: CalendarEvent) {
  const formatter = new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" });
  return `${formatter.format(new Date(event.startsAt))} – ${formatter.format(new Date(event.endsAt))}`;
}

function formatRecurrenceForAria(event: CalendarEvent) {
  if (event.recurrenceIntervalWeeks === null) return "";
  const frequency = event.recurrenceIntervalWeeks === 1
    ? " Repeats every week."
    : ` Repeats every ${event.recurrenceIntervalWeeks} weeks.`;
  if (!event.recurrenceEndsOn) return frequency;
  const endDate = new Intl.DateTimeFormat("en", { dateStyle: "long", timeZone: "UTC" })
    .format(new Date(`${event.recurrenceEndsOn}T00:00:00Z`));
  return `${frequency.slice(0, -1)} through ${endDate}.`;
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

function isDateInWeek(date: Date, days: Date[]) {
  return date >= days[0] && date < addDays(days[6], 1);
}

function newEventDraft(date: string, requestedStartMinutes?: number) {
  const now = new Date();
  const rounded = requestedStartMinutes ?? clamp(
    Math.ceil(minutesOfDay(now) / SLOT_MINUTES) * SLOT_MINUTES,
    DAY_START,
    DAY_END - 60
  );
  return {
    title: "",
    description: "",
    date,
    time: minutesToInput(rounded),
    duration: Math.min(60, DAY_END - rounded),
    recurrenceIntervalWeeks: null,
    recurrenceEndsOn: null,
    color: "violet" as EventColor
  };
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
    recurrenceIntervalWeeks: event.recurrenceIntervalWeeks,
    recurrenceEndsOn: event.recurrenceEndsOn,
    color: event.color
  };
}

function minutesToInput(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function defaultRecurrenceEnd(date: string) {
  return dateKey(addDays(parseDateKey(date), 12 * 7));
}

function compareEvents(left: CalendarEvent, right: CalendarEvent) {
  return new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime();
}

function readError(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}
