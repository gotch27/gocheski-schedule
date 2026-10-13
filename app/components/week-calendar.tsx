"use client";

import { GoalSelector } from "@/app/components/goal-selector";
import { SectionNavigation } from "@/app/components/section-navigation";
import { EventCardCopy } from "@/app/components/event-card-copy";
import { goalsRequest } from "@/app/lib/goals-api";
import { LabelManager, LabelManagerDialog } from "@/app/components/label-manager";
import { labelsRequest } from "@/app/lib/labels-api";
import { eventColorHex, eventColorStyle } from "@/app/lib/event-colors";
import type { CalendarEvent, CalendarGoal, CalendarLabel } from "@/nextsignal/services";

import {
  Bell,
  Check,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ClipboardPaste,
  Copy,
  ExternalLink,
  GripHorizontal,
  ListTodo,
  LogOut,
  Moon,
  Pencil,
  Plus,
  ShoppingBag,
  Tags,
  Trash2,
  TriangleAlert,
  Undo2,
  X
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import {
  TodoBacklog,
  TodoDialog,
  TodoScheduleDialog,
  ToBuyDialog,
  ToBuyScheduleDialog,
  type CalendarToBuyItem,
  type CalendarTodo,
  type ToBuyEditorState,
  type ToBuyInput,
  type TodoEditorState,
  type TodoInput
} from "@/app/components/todo-backlog";
import { useEscapeKey } from "@/app/hooks/use-escape-key";

type EventColor = CalendarEvent["color"];
type RecurringEventScope = "series" | "occurrence";
type NotificationState = CalendarEvent["notificationState"];

type EventInput = Pick<CalendarEvent, "goalId" | "title" | "description" | "startsAt" | "endsAt" | "recurrenceIntervalWeeks" | "recurrenceTimeZone" | "recurrenceEndsOn" | "notificationEnabled" | "notificationOffsetMinutes" | "notificationMessage" | "color">
  & { occurrenceStartsAt?: string; labelId?: string | null };

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

type EventClipboard = Pick<CalendarEvent, "labelId" | "goalId" | "title" | "description" | "color" | "notificationEnabled" | "notificationOffsetMinutes" | "notificationMessage"> & {
  durationMinutes: number;
};

type CalendarContextMenu = {
  kind: "calendar";
  x: number;
  y: number;
  date: string;
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

type TodoContextMenu = {
  kind: "todo";
  x: number;
  y: number;
  todo: CalendarTodo;
};

type ToBuyContextMenu = {
  kind: "to-buy";
  x: number;
  y: number;
  item: CalendarToBuyItem;
};

type ContextMenu = CalendarContextMenu | EventContextMenu | SelectionContextMenu | TodoContextMenu | ToBuyContextMenu;

type ContextDelete = {
  event: CalendarEvent;
  busy: boolean;
};

type BulkDelete = {
  events: CalendarEvent[];
  busy: boolean;
};

type BacklogTodoDragState = {
  pointerId: number;
  todo: CalendarTodo;
};

type BacklogTodoGhost = {
  todo: CalendarTodo;
  x: number;
  y: number;
  overCalendar: boolean;
};

type ToBuyDragState = {
  pointerId: number;
  item: CalendarToBuyItem;
};

type ToBuyGhost = {
  item: CalendarToBuyItem;
  x: number;
  y: number;
  overCalendar: boolean;
};

type ScheduledToBuyDragState = {
  pointerId: number;
  original: CalendarToBuyItem;
  current: CalendarToBuyItem;
  startClientX: number;
  startClientY: number;
  moved: boolean;
};

type ScheduledTodoDragState = {
  pointerId: number;
  mode: "move" | "resize";
  original: CalendarTodo;
  current: CalendarTodo;
  grabOffsetY: number;
  startClientX: number;
  startClientY: number;
  moved: boolean;
};

type SleepHours = {
  startMinutes: number;
  endMinutes: number;
};

const DAY_START = 0;
const DAY_END = 24 * 60;
const INITIAL_VIEW_START = 7 * 60;
const INITIAL_VISIBLE_MINUTES = DAY_END - INITIAL_VIEW_START;
const DAY_HEADER_HEIGHT = 56;
const SLOT_MINUTES = 15;
const SAVE_DELAY_MS = 5_000;
const TIME_GUTTER = 76;
const TOTAL_MINUTES = DAY_END - DAY_START;
const SLEEP_HOURS_STORAGE_KEY = "gocheski-schedule:sleep-hours";
const DEFAULT_SLEEP_HOURS: SleepHours = { startMinutes: 23 * 60, endMinutes: 7 * 60 };
const EVENTS_API_PATH = "/schedule/api/events";
const TODOS_API_PATH = "/schedule/api/todos";
const TO_BUY_API_PATH = "/schedule/api/to-buy";
const LOGIN_API_PATH = "/schedule/api/auth/login";
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const NOTIFICATION_PRESETS = [
  { value: 0, label: "At start" },
  { value: 5, label: "5 minutes before" },
  { value: 10, label: "10 minutes before" },
  { value: 15, label: "15 minutes before" },
  { value: 30, label: "30 minutes before" },
  { value: 60, label: "1 hour before" },
  { value: 120, label: "2 hours before" },
  { value: 24 * 60, label: "1 day before" }
] as const;

export function WeekCalendar() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // The week, local date labels, and current-time marker depend on the browser's
  // clock and time zone. Keep SSR and the first hydration render identical.
  if (!mounted) {
    return <main className="schedule-shell" aria-busy="true"><p role="status">Loading calendar…</p></main>;
  }

  return <MountedWeekCalendar />;
}

function MountedWeekCalendar() {
  const [goals, setGoals] = useState<CalendarGoal[]>([]);
  const [goalNamesError, setGoalNamesError] = useState<string | null>(null);
  const [labels, setLabels] = useState<CalendarLabel[]>([]);
  const [labelsLoading, setLabelsLoading] = useState(true);
  const [labelsError, setLabelsError] = useState<string | null>(null);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [weekStartKey, setWeekStartKey] = useState(() => dateKey(startOfWeek(new Date())));
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [backlogTodos, setBacklogTodos] = useState<CalendarTodo[]>([]);
  const [scheduledTodos, setScheduledTodos] = useState<CalendarTodo[]>([]);
  const [toBuyItems, setToBuyItems] = useState<CalendarToBuyItem[]>([]);
  const [scheduledToBuyItems, setScheduledToBuyItems] = useState<CalendarToBuyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [todosLoading, setTodosLoading] = useState(true);
  const [toBuyLoading, setToBuyLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [todoEditor, setTodoEditor] = useState<TodoEditorState | null>(null);
  const [todoScheduleEditor, setTodoScheduleEditor] = useState<CalendarTodo | null>(null);
  const [toBuyEditor, setToBuyEditor] = useState<ToBuyEditorState | null>(null);
  const [toBuyScheduleEditor, setToBuyScheduleEditor] = useState<CalendarToBuyItem | null>(null);
  const [backlogOpen, setBacklogOpen] = useState(false);
  const [backlogTodoGhost, setBacklogTodoGhost] = useState<BacklogTodoGhost | null>(null);
  const [toBuyGhost, setToBuyGhost] = useState<ToBuyGhost | null>(null);
  const [activeTodoId, setActiveTodoId] = useState<string | null>(null);
  const [activeToBuyId, setActiveToBuyId] = useState<string | null>(null);
  const [activeEventKey, setActiveEventKey] = useState<string | null>(null);
  const [pendingScopeChange, setPendingScopeChange] = useState<PendingScopeChange | null>(null);
  const [eventClipboard, setEventClipboard] = useState<EventClipboard | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [contextDelete, setContextDelete] = useState<ContextDelete | null>(null);
  const [selectedEventKeys, setSelectedEventKeys] = useState<Set<string>>(() => new Set());
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const [bulkDelete, setBulkDelete] = useState<BulkDelete | null>(null);
  const [sleepHours, setSleepHours] = useState<SleepHours | null>(null);
  const [sleepEditorOpen, setSleepEditorOpen] = useState(false);
  const [isMobileView, setIsMobileView] = useState(false);
  const [mobileDayIndex, setMobileDayIndex] = useState(() => dayIndexInWeek(new Date()));
  const [now, setNow] = useState(() => new Date());
  const calendarScrollerRef = useRef<HTMLDivElement>(null);
  const calendarCanvasRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const timelineHeightRef = useRef(0);
  const initialScrollAppliedRef = useRef(false);
  const dragRef = useRef<DragState | null>(null);
  const backlogTodoDragRef = useRef<BacklogTodoDragState | null>(null);
  const toBuyDragRef = useRef<ToBuyDragState | null>(null);
  const scheduledTodoDragRef = useRef<ScheduledTodoDragState | null>(null);
  const scheduledToBuyDragRef = useRef<ScheduledToBuyDragState | null>(null);
  const dragFrameRef = useRef<number | null>(null);
  const selectionDragRef = useRef<SelectionDragState | null>(null);
  const pendingSavesRef = useRef(new Map<string, PendingSave>());
  const persistedEventsRef = useRef(new Map<string, CalendarEvent>());

  const weekStart = useMemo(() => parseDateKey(weekStartKey), [weekStartKey]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart]);
  const visibleDays = useMemo(
    () => isMobileView ? [days[mobileDayIndex] ?? days[0]] : days,
    [days, isMobileView, mobileDayIndex]
  );
  const visibleDayCount = visibleDays.length;
  const hours = useMemo(() => Array.from({ length: (DAY_END - DAY_START) / 60 + 1 }, (_, index) => DAY_START + index * 60), []);
  const goalsById = useMemo(() => new Map(goals.map((goal) => [goal.id, goal])), [goals]);

  const loadGoalNames = useCallback(async () => {
    try {
      const data = await goalsRequest<{ goals: CalendarGoal[] }>();
      setGoals(data.goals);
      setGoalNamesError(null);
    } catch { setGoalNamesError("Goal names could not be loaded."); }
  }, []);

  useEffect(() => {
    void loadGoalNames();
    const refresh = () => { void loadGoalNames(); };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [loadGoalNames]);

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

  const loadLabels = useCallback(async () => {
    setLabelsLoading(true);
    setLabelsError(null);
    try {
      const data = await labelsRequest<{ labels: CalendarLabel[] }>();
      setLabels(data.labels);
    } catch (error) { setLabelsError(readError(error)); }
    finally { setLabelsLoading(false); }
  }, []);

  useEffect(() => { void loadLabels(); }, [loadLabels]);

  function updateLabels(updated: CalendarLabel[]) {
    const byId = new Map(updated.map((label) => [label.id, label]));
    const previousById = new Map(labels.map((label) => [label.id, label]));
    const refreshEvent = (event: CalendarEvent): CalendarEvent => {
      if (!event.labelId) return event;
      const label = byId.get(event.labelId);
      return { ...event, labelId: label?.id ?? null, color: label?.color ?? previousById.get(event.labelId)?.color ?? event.color };
    };
    setLabels(updated);
    setEvents((current) => current.map(refreshEvent));
    for (const [key, event] of persistedEventsRef.current) persistedEventsRef.current.set(key, refreshEvent(event));
    for (const pending of pendingSavesRef.current.values()) {
      pending.baseline = refreshEvent(pending.baseline);
      pending.latest = refreshEvent(pending.latest);
    }
    setEditor((current) => current?.mode === "edit" ? { ...current, event: refreshEvent(current.event) } : current);
    setEventClipboard((current) => {
      if (!current?.labelId) return current;
      const label = byId.get(current.labelId);
      return { ...current, labelId: label?.id ?? null, color: label?.color ?? previousById.get(current.labelId)?.color ?? current.color };
    });
  }

  const loadTodos = useCallback(async () => {
    setTodosLoading(true);
    const rangeStart = parseDateKey(weekStartKey);
    const rangeEnd = addDays(rangeStart, 7);

    try {
      const query = new URLSearchParams({
        weekStart: rangeStart.toISOString(),
        weekEnd: rangeEnd.toISOString()
      });
      const data = await apiRequest<{ backlog: CalendarTodo[]; scheduled: CalendarTodo[] }>(`${TODOS_API_PATH}?${query}`);
      setBacklogTodos(data.backlog);
      setScheduledTodos(data.scheduled);
    } catch (error) {
      setBacklogTodos([]);
      setScheduledTodos([]);
      setLoadError(readError(error));
    } finally {
      setTodosLoading(false);
    }
  }, [weekStartKey]);

  const loadToBuyItems = useCallback(async () => {
    const rangeStart = parseDateKey(weekStartKey);
    const rangeEnd = addDays(rangeStart, 7);
    setToBuyLoading(true);
    try {
      const query = new URLSearchParams({
        weekStart: rangeStart.toISOString(),
        weekEnd: rangeEnd.toISOString()
      });
      const data = await apiRequest<{ list: CalendarToBuyItem[]; scheduled: CalendarToBuyItem[] }>(`${TO_BUY_API_PATH}?${query}`);
      setToBuyItems(data.list);
      setScheduledToBuyItems(data.scheduled);
    } catch (error) {
      setToBuyItems([]);
      setScheduledToBuyItems([]);
      setLoadError(readError(error));
    } finally {
      setToBuyLoading(false);
    }
  }, [weekStartKey]);

  useEffect(() => {
    void loadEvents();
    void loadTodos();
    void loadToBuyItems();
  }, [loadEvents, loadTodos, loadToBuyItems]);

  useEffect(() => {
    setSelectedEventKeys(new Set());
    setSelectionBox(null);
  }, [weekStartKey]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const update = () => setIsMobileView(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(SLEEP_HOURS_STORAGE_KEY);
      if (!stored) return;
      const parsed: unknown = JSON.parse(stored);
      if (isValidSleepHours(parsed)) setSleepHours(parsed);
    } catch {}
  }, []);

  useEffect(() => {
    const scroller = calendarScrollerRef.current;
    const canvas = calendarCanvasRef.current;
    if (!scroller || !canvas) return;

    const syncTimelineHeight = () => {
      const previousTimelineHeight = timelineHeightRef.current;
      const visibleStartMinutes = initialScrollAppliedRef.current && previousTimelineHeight > 0
        ? (scroller.scrollTop / previousTimelineHeight) * TOTAL_MINUTES
        : INITIAL_VIEW_START;
      const visibleTimelineHeight = Math.max(1, scroller.clientHeight - DAY_HEADER_HEIGHT);
      const timelineHeight = visibleTimelineHeight * (TOTAL_MINUTES / INITIAL_VISIBLE_MINUTES);
      timelineHeightRef.current = timelineHeight;
      canvas.style.height = `${DAY_HEADER_HEIGHT + timelineHeight}px`;
      scroller.scrollTop = (visibleStartMinutes / TOTAL_MINUTES) * timelineHeight;
      initialScrollAppliedRef.current = true;
    };

    syncTimelineHeight();
    const observer = new ResizeObserver(syncTimelineHeight);
    observer.observe(scroller);
    return () => observer.disconnect();
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
          body: JSON.stringify(eventPatchBody(pending.latest, pending.scope, pending.baseline)),
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
    setMobileDayIndex(dayIndexInWeek(new Date()));
  }

  function changeMobileDay(offset: -1 | 1) {
    const nextIndex = mobileDayIndex + offset;
    if (nextIndex < 0) {
      setMobileDayIndex(6);
      setWeekStartKey(dateKey(addDays(weekStart, -7)));
      return;
    }
    if (nextIndex > 6) {
      setMobileDayIndex(0);
      setWeekStartKey(dateKey(addDays(weekStart, 7)));
      return;
    }
    setMobileDayIndex(nextIndex);
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

  function saveSleepHours(nextSleepHours: SleepHours) {
    setSleepHours(nextSleepHours);
    window.localStorage.setItem(SLEEP_HOURS_STORAGE_KEY, JSON.stringify(nextSleepHours));
    setSleepEditorOpen(false);
    setNotice("Sleeping hours updated");
  }

  async function saveTodoFromEditor(input: TodoInput, existing?: CalendarTodo) {
    if (existing) {
      const data = await apiRequest<{ todos: CalendarTodo[] }>(TODOS_API_PATH, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "update", id: existing.id, ...input })
      });
      const updated = data.todos[0];
      setBacklogTodos((current) => current.map((todo) => todo.id === updated.id ? updated : todo));
      setScheduledTodos((current) => current.map((todo) => todo.id === updated.id ? updated : todo));
      setNotice("To-do updated");
    } else {
      const data = await apiRequest<{ todo: CalendarTodo }>(TODOS_API_PATH, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input)
      });
      setBacklogTodos((current) => [...current, data.todo]);
      setNotice("Added to backlog");
    }
    setTodoEditor(null);
  }

  async function deleteTodo(todo: CalendarTodo) {
    await apiRequest<{ id: string }>(TODOS_API_PATH, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: todo.id })
    });
    setBacklogTodos((current) => current.filter((item) => item.id !== todo.id));
    setScheduledTodos((current) => current.filter((item) => item.id !== todo.id));
    setTodoEditor(null);
    setNotice("To-do deleted");
  }

  async function saveToBuyItem(input: ToBuyInput, existing?: CalendarToBuyItem) {
    if (existing) {
      const data = await apiRequest<{ items: CalendarToBuyItem[] }>(TO_BUY_API_PATH, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "update", id: existing.id, ...input })
      });
      const updated = data.items[0];
      setToBuyItems((current) => current.map((item) => item.id === updated.id ? updated : item));
      setScheduledToBuyItems((current) => current.map((item) => item.id === updated.id ? updated : item));
      setNotice("To-buy item updated");
    } else {
      const data = await apiRequest<{ item: CalendarToBuyItem }>(TO_BUY_API_PATH, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input)
      });
      setToBuyItems((current) => [...current, data.item]);
      setNotice("Added to your to-buy list");
    }
    setToBuyEditor(null);
  }

  async function deleteToBuyItem(item: CalendarToBuyItem) {
    await apiRequest<{ id: string }>(TO_BUY_API_PATH, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: item.id })
    });
    setToBuyItems((current) => current.filter((currentItem) => currentItem.id !== item.id));
    setScheduledToBuyItems((current) => current.filter((currentItem) => currentItem.id !== item.id));
    setToBuyEditor(null);
    setNotice("To-buy item deleted");
  }

  async function scheduleToBuyItem(item: CalendarToBuyItem, scheduledAt: Date) {
    const data = await apiRequest<{ items: CalendarToBuyItem[] }>(TO_BUY_API_PATH, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "schedule", id: item.id, scheduledAt: scheduledAt.toISOString() })
    });
    const updated = data.items[0];
    if (isMobileView) setMobileDayIndex(dayIndexInWeek(scheduledAt));
    setToBuyItems((current) => current.filter((currentItem) => currentItem.id !== updated.id));
    const scheduledWeek = dateKey(startOfWeek(scheduledAt));
    if (scheduledWeek !== weekStartKey) {
      setWeekStartKey(scheduledWeek);
    } else {
      setScheduledToBuyItems((current) => [...current.filter((currentItem) => currentItem.id !== updated.id), updated].sort(compareToBuyItems));
    }
    setNotice("To-buy item added to calendar");
  }

  async function returnToBuyItemToList(item: CalendarToBuyItem) {
    const data = await apiRequest<{ items: CalendarToBuyItem[] }>(TO_BUY_API_PATH, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "unschedule", id: item.id })
    });
    const updated = data.items[0];
    setScheduledToBuyItems((current) => current.filter((currentItem) => currentItem.id !== updated.id));
    setToBuyItems((current) => [...current.filter((currentItem) => currentItem.id !== updated.id), updated]);
    setNotice("Returned to the to-buy list");
  }

  async function reorderToBuyItems(index: number, offset: -1 | 1) {
    const targetIndex = index + offset;
    if (targetIndex < 0 || targetIndex >= toBuyItems.length) return;
    const previous = toBuyItems;
    const reordered = [...toBuyItems];
    [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];
    setToBuyItems(reordered);
    try {
      const data = await apiRequest<{ items: CalendarToBuyItem[] }>(TO_BUY_API_PATH, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "reorder", orderedIds: reordered.map((item) => item.id) })
      });
      setToBuyItems(data.items);
    } catch (error) {
      setToBuyItems(previous);
      setNotice(readError(error));
    }
  }

  async function reorderBacklogTodos(index: number, offset: -1 | 1) {
    const targetIndex = index + offset;
    if (targetIndex < 0 || targetIndex >= backlogTodos.length) return;
    const previous = backlogTodos;
    const reordered = [...backlogTodos];
    [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];
    setBacklogTodos(reordered);
    try {
      const data = await apiRequest<{ todos: CalendarTodo[] }>(TODOS_API_PATH, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "reorder", orderedIds: reordered.map((todo) => todo.id) })
      });
      setBacklogTodos(data.todos);
    } catch (error) {
      setBacklogTodos(previous);
      setNotice(readError(error));
    }
  }

  async function scheduleTodo(todo: CalendarTodo, scheduledAt: Date) {
    const data = await apiRequest<{ todos: CalendarTodo[] }>(TODOS_API_PATH, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "schedule", id: todo.id, scheduledAt: scheduledAt.toISOString() })
    });
    const updated = data.todos[0];
    if (isMobileView) setMobileDayIndex(dayIndexInWeek(scheduledAt));
    setBacklogTodos((current) => current.filter((item) => item.id !== updated.id));
    const scheduledWeek = dateKey(startOfWeek(scheduledAt));
    if (scheduledWeek !== weekStartKey) {
      setWeekStartKey(scheduledWeek);
    } else {
      setScheduledTodos((current) => [...current.filter((item) => item.id !== updated.id), updated].sort(compareTodos));
    }
    setNotice("To-do added to calendar");
  }

  async function returnTodoToBacklog(todo: CalendarTodo) {
    const data = await apiRequest<{ todos: CalendarTodo[] }>(TODOS_API_PATH, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "unschedule", id: todo.id })
    });
    const updated = data.todos[0];
    setScheduledTodos((current) => current.filter((item) => item.id !== updated.id));
    setBacklogTodos((current) => [...current.filter((item) => item.id !== updated.id), updated]);
    setNotice("Returned to backlog");
  }

  function startBacklogTodoDrag(pointerEvent: ReactPointerEvent<HTMLButtonElement>, todo: CalendarTodo) {
    if (pointerEvent.button !== 0) return;
    pointerEvent.currentTarget.setPointerCapture(pointerEvent.pointerId);
    backlogTodoDragRef.current = { pointerId: pointerEvent.pointerId, todo };
    setBacklogTodoGhost({ todo, x: pointerEvent.clientX, y: pointerEvent.clientY, overCalendar: false });
    pointerEvent.preventDefault();
  }

  function moveBacklogTodoDrag(pointerEvent: ReactPointerEvent<HTMLButtonElement>) {
    const drag = backlogTodoDragRef.current;
    const timeline = timelineRef.current;
    if (!drag || !timeline || drag.pointerId !== pointerEvent.pointerId) return;
    const rect = timeline.getBoundingClientRect();
    const overCalendar = pointerEvent.clientX >= rect.left + TIME_GUTTER
      && pointerEvent.clientX <= rect.right
      && pointerEvent.clientY >= rect.top
      && pointerEvent.clientY <= rect.bottom;
    setBacklogTodoGhost({
      todo: drag.todo,
      x: pointerEvent.clientX,
      y: pointerEvent.clientY,
      overCalendar
    });
  }

  function endBacklogTodoDrag(pointerEvent: ReactPointerEvent<HTMLButtonElement>) {
    const drag = backlogTodoDragRef.current;
    const timeline = timelineRef.current;
    backlogTodoDragRef.current = null;
    setBacklogTodoGhost(null);
    if (!drag || !timeline || drag.pointerId !== pointerEvent.pointerId) return;

    const rect = timeline.getBoundingClientRect();
    const contentX = pointerEvent.clientX - rect.left - TIME_GUTTER;
    if (
      contentX < 0
      || contentX >= rect.width - TIME_GUTTER
      || pointerEvent.clientY < rect.top
      || pointerEvent.clientY > rect.bottom
    ) return;

    const dayWidth = (rect.width - TIME_GUTTER) / visibleDayCount;
    const dayIndex = clamp(Math.floor(contentX / dayWidth), 0, visibleDayCount - 1);
    const duration = drag.todo.estimatedMinutes ?? 0;
    const startMinutes = clamp(
      snapMinutes(DAY_START + ((pointerEvent.clientY - rect.top) / rect.height) * TOTAL_MINUTES),
      DAY_START,
      DAY_END - Math.max(SLOT_MINUTES, duration)
    );
    void scheduleTodo(drag.todo, localDateAtMinutes(visibleDays[dayIndex], startMinutes)).catch((error) => {
      setNotice(readError(error));
    });
  }

  function cancelBacklogTodoDrag() {
    backlogTodoDragRef.current = null;
    setBacklogTodoGhost(null);
  }

  function startToBuyDrag(pointerEvent: ReactPointerEvent<HTMLButtonElement>, item: CalendarToBuyItem) {
    if (pointerEvent.button !== 0) return;
    pointerEvent.currentTarget.setPointerCapture(pointerEvent.pointerId);
    toBuyDragRef.current = { pointerId: pointerEvent.pointerId, item };
    setToBuyGhost({ item, x: pointerEvent.clientX, y: pointerEvent.clientY, overCalendar: false });
    pointerEvent.preventDefault();
  }

  function moveToBuyDrag(pointerEvent: ReactPointerEvent<HTMLButtonElement>) {
    const drag = toBuyDragRef.current;
    const timeline = timelineRef.current;
    if (!drag || !timeline || drag.pointerId !== pointerEvent.pointerId) return;
    const rect = timeline.getBoundingClientRect();
    const overCalendar = pointerEvent.clientX >= rect.left + TIME_GUTTER
      && pointerEvent.clientX <= rect.right
      && pointerEvent.clientY >= rect.top
      && pointerEvent.clientY <= rect.bottom;
    setToBuyGhost({ item: drag.item, x: pointerEvent.clientX, y: pointerEvent.clientY, overCalendar });
  }

  function endToBuyDrag(pointerEvent: ReactPointerEvent<HTMLButtonElement>) {
    const drag = toBuyDragRef.current;
    const timeline = timelineRef.current;
    toBuyDragRef.current = null;
    setToBuyGhost(null);
    if (!drag || !timeline || drag.pointerId !== pointerEvent.pointerId) return;
    const rect = timeline.getBoundingClientRect();
    const contentX = pointerEvent.clientX - rect.left - TIME_GUTTER;
    if (
      contentX < 0
      || contentX >= rect.width - TIME_GUTTER
      || pointerEvent.clientY < rect.top
      || pointerEvent.clientY > rect.bottom
    ) return;
    const dayWidth = (rect.width - TIME_GUTTER) / visibleDayCount;
    const dayIndex = clamp(Math.floor(contentX / dayWidth), 0, visibleDayCount - 1);
    const startMinutes = clamp(
      snapMinutes(DAY_START + ((pointerEvent.clientY - rect.top) / rect.height) * TOTAL_MINUTES),
      DAY_START,
      DAY_END - SLOT_MINUTES
    );
    void scheduleToBuyItem(drag.item, localDateAtMinutes(visibleDays[dayIndex], startMinutes)).catch((error) => {
      setNotice(readError(error));
    });
  }

  function cancelToBuyDrag() {
    toBuyDragRef.current = null;
    setToBuyGhost(null);
  }

  function startScheduledTodoDrag(
    pointerEvent: ReactPointerEvent<HTMLElement>,
    todo: CalendarTodo,
    mode: "move" | "resize" = "move"
  ) {
    if (pointerEvent.button !== 0 || !todo.scheduledAt) return;
    pointerEvent.currentTarget.setPointerCapture(pointerEvent.pointerId);
    scheduledTodoDragRef.current = {
      pointerId: pointerEvent.pointerId,
      mode,
      original: todo,
      current: todo,
      grabOffsetY: mode === "resize" || todo.estimatedMinutes === null
        ? 0
        : pointerEvent.clientY - pointerEvent.currentTarget.getBoundingClientRect().top,
      startClientX: pointerEvent.clientX,
      startClientY: pointerEvent.clientY,
      moved: false
    };
    setActiveTodoId(todo.id);
    setContextMenu(null);
    pointerEvent.preventDefault();
    pointerEvent.stopPropagation();
  }

  function moveScheduledTodoDrag(pointerEvent: ReactPointerEvent<HTMLElement>) {
    const drag = scheduledTodoDragRef.current;
    const timeline = timelineRef.current;
    if (!drag || !timeline || drag.pointerId !== pointerEvent.pointerId) return;
    if (!drag.moved && Math.hypot(pointerEvent.clientX - drag.startClientX, pointerEvent.clientY - drag.startClientY) < 3) return;

    const rect = timeline.getBoundingClientRect();
    if (drag.mode === "resize" && drag.current.scheduledAt) {
      const startMinutes = minutesOfDay(new Date(drag.current.scheduledAt));
      const pointerMinutes = snapMinutes(DAY_START + ((pointerEvent.clientY - rect.top) / rect.height) * TOTAL_MINUTES);
      const estimatedMinutes = clamp(pointerMinutes - startMinutes, SLOT_MINUTES, DAY_END - startMinutes);
      const current = { ...drag.current, estimatedMinutes };
      scheduledTodoDragRef.current = { ...drag, current, moved: true };
      setScheduledTodos((todos) => todos.map((todo) => todo.id === current.id ? current : todo));
      pointerEvent.preventDefault();
      pointerEvent.stopPropagation();
      return;
    }

    const dayWidth = (rect.width - TIME_GUTTER) / visibleDayCount;
    const dayIndex = clamp(
      Math.floor((pointerEvent.clientX - rect.left - TIME_GUTTER) / dayWidth),
      0,
      visibleDayCount - 1
    );
    const pointerTop = pointerEvent.clientY - rect.top - drag.grabOffsetY;
    const duration = drag.current.estimatedMinutes ?? 0;
    const startMinutes = clamp(
      snapMinutes(DAY_START + (pointerTop / rect.height) * TOTAL_MINUTES),
      DAY_START,
      DAY_END - Math.max(SLOT_MINUTES, duration)
    );
    const current = {
      ...drag.current,
      scheduledAt: localDateAtMinutes(visibleDays[dayIndex], startMinutes).toISOString()
    };
    scheduledTodoDragRef.current = { ...drag, current, moved: true };
    setScheduledTodos((todos) => todos.map((todo) => todo.id === current.id ? current : todo));
    pointerEvent.preventDefault();
    pointerEvent.stopPropagation();
  }

  function endScheduledTodoDrag(pointerEvent: ReactPointerEvent<HTMLElement>) {
    const drag = scheduledTodoDragRef.current;
    if (!drag || drag.pointerId !== pointerEvent.pointerId) return;
    scheduledTodoDragRef.current = null;
    setActiveTodoId(null);
    pointerEvent.stopPropagation();

    if (!drag.moved || !drag.current.scheduledAt) {
      if (drag.mode === "move") setTodoEditor({ mode: "edit", todo: drag.original });
      return;
    }

    const persist = drag.mode === "resize"
      ? saveTodoFromEditor({
          goalId: drag.current.goalId,
          title: drag.current.title,
          description: drag.current.description,
          estimatedMinutes: drag.current.estimatedMinutes
        }, drag.current)
      : scheduleTodo(drag.current, new Date(drag.current.scheduledAt));
    void persist.catch((error) => {
      setScheduledTodos((todos) => todos.map((todo) => todo.id === drag.original.id ? drag.original : todo));
      setNotice(readError(error));
    });
  }

  function cancelScheduledTodoDrag(pointerEvent: ReactPointerEvent<HTMLElement>) {
    const drag = scheduledTodoDragRef.current;
    if (!drag || drag.pointerId !== pointerEvent.pointerId) return;
    scheduledTodoDragRef.current = null;
    setActiveTodoId(null);
    setScheduledTodos((todos) => todos.map((todo) => todo.id === drag.original.id ? drag.original : todo));
    pointerEvent.stopPropagation();
  }

  function startScheduledToBuyDrag(pointerEvent: ReactPointerEvent<HTMLElement>, item: CalendarToBuyItem) {
    if (pointerEvent.button !== 0 || !item.scheduledAt) return;
    pointerEvent.currentTarget.setPointerCapture(pointerEvent.pointerId);
    scheduledToBuyDragRef.current = {
      pointerId: pointerEvent.pointerId,
      original: item,
      current: item,
      startClientX: pointerEvent.clientX,
      startClientY: pointerEvent.clientY,
      moved: false
    };
    setActiveToBuyId(item.id);
    setContextMenu(null);
    pointerEvent.preventDefault();
    pointerEvent.stopPropagation();
  }

  function moveScheduledToBuyDrag(pointerEvent: ReactPointerEvent<HTMLElement>) {
    const drag = scheduledToBuyDragRef.current;
    const timeline = timelineRef.current;
    if (!drag || !timeline || drag.pointerId !== pointerEvent.pointerId) return;
    if (!drag.moved && Math.hypot(pointerEvent.clientX - drag.startClientX, pointerEvent.clientY - drag.startClientY) < 3) return;
    const rect = timeline.getBoundingClientRect();
    const dayWidth = (rect.width - TIME_GUTTER) / visibleDayCount;
    const dayIndex = clamp(Math.floor((pointerEvent.clientX - rect.left - TIME_GUTTER) / dayWidth), 0, visibleDayCount - 1);
    const startMinutes = clamp(
      snapMinutes(DAY_START + ((pointerEvent.clientY - rect.top) / rect.height) * TOTAL_MINUTES),
      DAY_START,
      DAY_END - SLOT_MINUTES
    );
    const current = { ...drag.current, scheduledAt: localDateAtMinutes(visibleDays[dayIndex], startMinutes).toISOString() };
    scheduledToBuyDragRef.current = { ...drag, current, moved: true };
    setScheduledToBuyItems((items) => items.map((item) => item.id === current.id ? current : item));
    pointerEvent.preventDefault();
    pointerEvent.stopPropagation();
  }

  function endScheduledToBuyDrag(pointerEvent: ReactPointerEvent<HTMLElement>) {
    const drag = scheduledToBuyDragRef.current;
    if (!drag || drag.pointerId !== pointerEvent.pointerId) return;
    scheduledToBuyDragRef.current = null;
    setActiveToBuyId(null);
    pointerEvent.stopPropagation();
    if (!drag.moved || !drag.current.scheduledAt) {
      setToBuyEditor({ mode: "edit", item: drag.original });
      return;
    }
    void scheduleToBuyItem(drag.current, new Date(drag.current.scheduledAt)).catch((error) => {
      setScheduledToBuyItems((items) => items.map((item) => item.id === drag.original.id ? drag.original : item));
      setNotice(readError(error));
    });
  }

  function cancelScheduledToBuyDrag(pointerEvent: ReactPointerEvent<HTMLElement>) {
    const drag = scheduledToBuyDragRef.current;
    if (!drag || drag.pointerId !== pointerEvent.pointerId) return;
    scheduledToBuyDragRef.current = null;
    setActiveToBuyId(null);
    setScheduledToBuyItems((items) => items.map((item) => item.id === drag.original.id ? drag.original : item));
    pointerEvent.stopPropagation();
  }

  function openCreate(
    date = dateKey(isMobileView ? visibleDays[0] : isDateInWeek(new Date(), days) ? new Date() : days[0]),
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
    if (isMobileView) setMobileDayIndex(dayIndexInWeek(new Date(data.event.startsAt)));
    const createdWeek = dateKey(startOfWeek(new Date(data.event.startsAt)));
    if (createdWeek !== weekStartKey) {
      setWeekStartKey(createdWeek);
    } else {
      setEvents((current) => [...current, data.event].sort(compareEvents));
    }
    persistedEventsRef.current.set(data.event.occurrenceKey, data.event);
    setNotice(data.event.notificationState === "failed"
      ? `${successNotice}, but the phone notification needs attention`
      : successNotice);
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
      const saved = await persistEvent(optimistic, rollback, scope);
      const successNotice = scope === "occurrence" ? "Event updated" : "Series updated";
      setNotice(saved.notificationState === "failed"
        ? `${successNotice}, but the phone notification needs attention`
        : successNotice);
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

  function openTodoContextMenu(mouseEvent: ReactMouseEvent, todo: CalendarTodo) {
    mouseEvent.preventDefault();
    mouseEvent.stopPropagation();
    setSelectedEventKeys(new Set());
    setContextMenu({
      kind: "todo",
      ...contextMenuPosition(mouseEvent.clientX, mouseEvent.clientY, 126),
      todo
    });
  }

  function openToBuyContextMenu(mouseEvent: ReactMouseEvent, item: CalendarToBuyItem) {
    mouseEvent.preventDefault();
    mouseEvent.stopPropagation();
    setSelectedEventKeys(new Set());
    setContextMenu({
      kind: "to-buy",
      ...contextMenuPosition(mouseEvent.clientX, mouseEvent.clientY, item.url ? 164 : 126),
      item
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

    const dayWidth = (rect.width - TIME_GUTTER) / visibleDayCount;
    const dayIndex = clamp(Math.floor(contentX / dayWidth), 0, visibleDayCount - 1);
    const startMinutes = clamp(
      snapMinutes(DAY_START + ((mouseEvent.clientY - rect.top) / rect.height) * TOTAL_MINUTES),
      DAY_START,
      DAY_END - SLOT_MINUTES
    );
    setContextMenu({
      kind: "calendar",
      ...contextMenuPosition(mouseEvent.clientX, mouseEvent.clientY, eventClipboard ? 88 : 50),
      date: dateKey(visibleDays[dayIndex]),
      startMinutes
    });
  }

  function addEventFromContextMenu(menu: CalendarContextMenu) {
    setContextMenu(null);
    openCreate(menu.date, menu.startMinutes);
  }

  function copyEventOccurrence(event: CalendarEvent) {
    const durationMinutes = Math.max(
      SLOT_MINUTES,
      Math.round((new Date(event.endsAt).getTime() - new Date(event.startsAt).getTime()) / 60_000)
    );
    setEventClipboard({
      labelId: event.labelId,
      goalId: event.goalId,
      title: event.title,
      description: event.description,
      color: event.color,
      notificationEnabled: event.notificationEnabled,
      notificationOffsetMinutes: event.notificationOffsetMinutes,
      notificationMessage: event.notificationMessage,
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
    const startsAt = localDateAtMinutes(parseDateKey(menu.date), startMinutes);
    const endsAt = new Date(startsAt.getTime() + eventClipboard.durationMinutes * 60_000);
    if (
      eventClipboard.notificationEnabled
      && notificationTimeIsTooSoon(startsAt, eventClipboard.notificationOffsetMinutes)
    ) {
      setNotice("Paste the event later so its notification is at least one minute from now");
      return;
    }
    const input: EventInput = {
      labelId: eventClipboard.labelId,
      goalId: eventClipboard.goalId,
      title: eventClipboard.title,
      description: eventClipboard.description,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      recurrenceIntervalWeeks: null,
      recurrenceTimeZone: null,
      recurrenceEndsOn: null,
      notificationEnabled: eventClipboard.notificationEnabled,
      notificationOffsetMinutes: eventClipboard.notificationEnabled ? eventClipboard.notificationOffsetMinutes : null,
      notificationMessage: eventClipboard.notificationEnabled ? eventClipboard.notificationMessage : null,
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
        body: JSON.stringify(eventPatchBody(updated, scope, previous))
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
      return data.event;
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
      const dayWidth = (rect.width - TIME_GUTTER) / visibleDayCount;
      const desiredVisibleDayIndex = clamp(
        Math.floor((pointerEvent.clientX - rect.left - TIME_GUTTER) / dayWidth),
        0,
        visibleDayCount - 1
      );
      const desiredDayIndex = days.findIndex((day) => dateKey(day) === dateKey(visibleDays[desiredVisibleDayIndex]));
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
      const latestEnd = Math.max(...drag.originals.map((item) => calendarEndMinutes(
        new Date(item.startsAt),
        new Date(item.endsAt)
      )));
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
          if (current) applyEventCardLayout(card, current, visibleDays);
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
  const showCurrentTime = visibleDays.some((day) => dateKey(day) === todayKey) && currentMinutes >= DAY_START && currentMinutes <= DAY_END;

  return (
    <main className="schedule-shell">
      <header className="topbar">
        <a className="brand-logo-link" href="/schedule" aria-label="Gocheski home">
          <img className="brand-logo" src="/schedule/goch-mark.svg" alt="" draggable="false" />
        </a>

        <SectionNavigation active="calendar" />
        <div className="calendar-toolbar">
          <h1 aria-label={formatWeekRange(weekStart, days[6])}>
            <span className="week-range-full" aria-hidden="true">{formatWeekRange(weekStart, days[6])}</span>
            <span className="week-range-compact" aria-hidden="true">{formatCompactWeekRange(weekStart, days[6])}</span>
          </h1>
          <div className="calendar-actions">
            <button className="today-button" type="button" aria-label="Go to today" onClick={goToToday}>
              <CalendarDays size={14} /> <span>Today</span>
            </button>
            <div className="week-arrows" aria-label="Week navigation">
              <button type="button" aria-label="Previous week" onClick={() => changeWeek(-1)}><ChevronLeft size={18} /></button>
              <button type="button" aria-label="Next week" onClick={() => changeWeek(1)}><ChevronRight size={18} /></button>
            </div>
          </div>
        </div>

        <div className="topbar-utilities">
          <button className="toolbar-icon-button" type="button" aria-label="Manage labels" title="Manage labels" onClick={() => setLabelsOpen(true)}><Tags size={16} /></button>
          <button
            className={`toolbar-icon-button backlog-toggle${backlogOpen ? " is-active" : ""}`}
            type="button"
            aria-label="Open backlog and to-buy lists"
            aria-pressed={backlogOpen}
            title="Backlog and to-buy lists"
            onClick={() => setBacklogOpen((current) => !current)}
          >
            <ListTodo size={16} />
            {backlogTodos.length + toBuyItems.length > 0 && (
              <span>{backlogTodos.length + toBuyItems.length > 99 ? "99+" : backlogTodos.length + toBuyItems.length}</span>
            )}
          </button>
          <button
            className={`toolbar-icon-button${sleepHours ? " is-active" : ""}`}
            type="button"
            aria-label="Set sleeping hours"
            title="Sleeping hours"
            onClick={() => setSleepEditorOpen(true)}
          >
            <Moon size={16} />
          </button>
        </div>

        <div className="topbar-actions">
          <button className="logout-button" type="button" aria-label="Log out" onClick={() => void logout()}>
            <LogOut size={14} /> <span>Log out</span>
          </button>
          <button className="primary-button" type="button" aria-label="Add event" onClick={() => openCreate()}>
            <Plus size={16} strokeWidth={2.6} /> <span>Event</span>
          </button>
        </div>
      </header>

      <section className="calendar-section" id="calendar" aria-label="Weekly calendar">
        {goalNamesError && <p className="goal-names-error" role="status">{goalNamesError} <button type="button" onClick={() => void loadGoalNames()}>Retry</button></p>}
        {loadError && (
          <div className="connection-banner" role="status">
            <span><span className="connection-dot" /> Database setup needed</span>
            <p>{loadError}</p>
            <button type="button" onClick={() => {
              void loadEvents();
              void loadTodos();
              void loadToBuyItems();
            }}>Try again</button>
          </div>
        )}

        <div className="mobile-day-navigation" aria-label="Day navigation">
          <button type="button" aria-label="Previous day" onClick={() => changeMobileDay(-1)}><ChevronLeft size={19} /></button>
          <div aria-live="polite">
            <span>{formatMobileDayName(visibleDays[0])}</span>
            <strong>{formatMobileDayDate(visibleDays[0])}</strong>
          </div>
          <button type="button" aria-label="Next day" onClick={() => changeMobileDay(1)}><ChevronRight size={19} /></button>
        </div>

        <div className="calendar-frame">
          <div ref={calendarScrollerRef} className="calendar-scroller" role="region" aria-label="Calendar hours" tabIndex={0}>
            <div
              ref={calendarCanvasRef}
              className="calendar-canvas"
              style={{ "--visible-day-count": visibleDayCount } as CSSProperties}
            >
              <div className="days-header">
                <div className="timezone-label">Local</div>
                {visibleDays.map((day) => {
                  const isToday = dateKey(day) === todayKey;
                  const weekdayIndex = dayIndexInWeek(day);
                  return (
                    <button
                      className={`day-heading${isToday ? " is-today" : ""}`}
                      type="button"
                      key={dateKey(day)}
                      onClick={() => openCreate(dateKey(day))}
                      aria-label={`Add event on ${DAY_NAMES[weekdayIndex]}`}
                    >
                      <span>{DAY_NAMES[weekdayIndex].slice(0, 3)}</span>
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
                    <span
                      className={minutes === INITIAL_VIEW_START ? "is-initial-hour" : undefined}
                      key={minutes}
                      style={{ top: `${((minutes - DAY_START) / TOTAL_MINUTES) * 100}%` }}
                    >
                      {formatTimeMinutes(minutes)}
                    </span>
                  ))}
                </div>

                <div className="day-columns" aria-hidden="true">
                  {visibleDays.map((day) => (
                    <div className={`calendar-day${dateKey(day) === todayKey ? " is-today" : ""}`} key={dateKey(day)}>
                      {sleepHours && sleepHourSegments(sleepHours).map((segment) => (
                        <span
                          className="sleep-hours-block"
                          key={`${segment.startMinutes}-${segment.endMinutes}`}
                          style={{
                            top: `${(segment.startMinutes / TOTAL_MINUTES) * 100}%`,
                            height: `${((segment.endMinutes - segment.startMinutes) / TOTAL_MINUTES) * 100}%`
                          }}
                        />
                      ))}
                    </div>
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
                    const layout = eventCardLayout(event, visibleDays);
                    if (!layout) return null;
                    const isSelected = selectedEventKeys.has(event.occurrenceKey);
                    const notificationState = displayedNotificationState(event, now);
                    const label = labels.find((item) => item.id === event.labelId);
                    const goal = event.goalId ? goalsById.get(event.goalId) : undefined;
                    const colorStyle = event.color.startsWith("#") || label ? eventColorStyle(label?.color ?? event.color) : {};

                    return (
                      <button
                        key={event.occurrenceKey}
                        type="button"
                        className={`calendar-event event-${event.color}${activeEventKey === event.occurrenceKey ? " is-dragging" : ""}${isSelected ? " is-selected" : ""}${layout.compact ? " is-compact" : ""}`}
                        data-event-key={event.occurrenceKey}
                        aria-pressed={isSelected}
                        style={{ ...colorStyle, top: layout.top, height: layout.height, left: dayColumnLeft(layout.dayIndex, visibleDayCount) }}
                        title={[event.title, label?.name, goal?.title].filter(Boolean).join(" · ")}
                        onPointerDown={(pointerEvent) => startDrag(pointerEvent, event, "move")}
                        onPointerMove={moveDrag}
                        onPointerUp={endDrag}
                        onPointerCancel={cancelDrag}
                        onContextMenu={(mouseEvent) => openEventContextMenu(mouseEvent, event)}
                        onKeyDown={(keyboardEvent) => handleEventKey(event, keyboardEvent)}
                        aria-label={`${event.title}${label ? `, ${label.name}` : ""}${goal ? `, goal: ${goal.title}` : ""}, ${formatEventTime(event)}.${formatRecurrenceForAria(event)}${formatNotificationForAria(event, notificationState)} Drag to reschedule, press Enter to edit, or right-click to copy.`}
                      >
                        <span className="event-accent" />
                        <EventCardCopy title={event.title} time={formatEventTime(event)} label={label?.name} goal={goal} compact={layout.compact} />
                        {event.notificationEnabled && (
                          <span className={`event-notification is-${notificationState}`} aria-hidden="true">
                            <Bell size={13} />
                            {notificationState === "sent" && <span className="event-notification-badge"><Check size={8} strokeWidth={3} /></span>}
                            {notificationState === "failed" && <span className="event-notification-badge"><TriangleAlert size={8} strokeWidth={2.5} /></span>}
                          </span>
                        )}
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

                  {scheduledTodos.map((todo) => {
                    const layout = todoCalendarLayout(todo, visibleDays);
                    if (!layout) return null;
                    const isDragging = activeTodoId === todo.id;

                    if (todo.estimatedMinutes === null) {
                      return (
                        <button
                          className={`calendar-todo-quick${isDragging ? " is-dragging" : ""}`}
                          type="button"
                          key={todo.id}
                          style={{ top: layout.top, left: dayColumnLeft(layout.dayIndex, visibleDayCount) }}
                          onPointerDown={(event) => startScheduledTodoDrag(event, todo)}
                          onPointerMove={moveScheduledTodoDrag}
                          onPointerUp={endScheduledTodoDrag}
                          onPointerCancel={cancelScheduledTodoDrag}
                          onContextMenu={(event) => openTodoContextMenu(event, todo)}
                          aria-label={`${todo.title}, quick to-do at ${formatTodoTime(todo)}. Drag to reschedule or right-click for actions.`}
                        >
                          <ListTodo size={12} />
                          <strong>{todo.title}</strong>
                          <span>{formatTodoTime(todo)}</span>
                        </button>
                      );
                    }

                    return (
                      <button
                        className={`calendar-event calendar-todo-timed${isDragging ? " is-dragging" : ""}${layout.compact ? " is-compact" : ""}`}
                        type="button"
                        key={todo.id}
                        style={{ top: layout.top, height: layout.height, left: dayColumnLeft(layout.dayIndex, visibleDayCount) }}
                        onPointerDown={(event) => startScheduledTodoDrag(event, todo)}
                        onPointerMove={moveScheduledTodoDrag}
                        onPointerUp={endScheduledTodoDrag}
                        onPointerCancel={cancelScheduledTodoDrag}
                        onContextMenu={(event) => openTodoContextMenu(event, todo)}
                        aria-label={`${todo.title}, timed to-do ${formatTodoTime(todo)}. Drag to reschedule or right-click for actions.`}
                      >
                        <span className="event-accent" />
                        <span className="event-copy">
                          <strong>{todo.title}</strong>
                          <span>{formatTodoTime(todo)}</span>
                        </span>
                        <span
                          className="event-resize"
                          role="presentation"
                          onPointerDown={(event) => {
                            event.stopPropagation();
                            startScheduledTodoDrag(event, todo, "resize");
                          }}
                        ><GripHorizontal size={14} /></span>
                      </button>
                    );
                  })}

                  {scheduledToBuyItems.map((item) => {
                    const layout = toBuyCalendarLayout(item, visibleDays);
                    if (!layout) return null;
                    return (
                      <button
                        className={`calendar-todo-quick calendar-to-buy-quick${activeToBuyId === item.id ? " is-dragging" : ""}`}
                        type="button"
                        key={item.id}
                        style={{ top: layout.top, left: dayColumnLeft(layout.dayIndex, visibleDayCount) }}
                        onPointerDown={(event) => startScheduledToBuyDrag(event, item)}
                        onPointerMove={moveScheduledToBuyDrag}
                        onPointerUp={endScheduledToBuyDrag}
                        onPointerCancel={cancelScheduledToBuyDrag}
                        onContextMenu={(event) => openToBuyContextMenu(event, item)}
                        aria-label={`${item.title}, to-buy item at ${formatToBuyTime(item)}. Drag to reschedule or right-click for actions.`}
                      >
                        <ShoppingBag size={12} />
                        <strong>{item.title}</strong>
                        <span>{formatToBuyTime(item)}</span>
                      </button>
                    );
                  })}
                </div>

                {showCurrentTime && (
                  <div
                    className="current-time-line"
                    style={{
                      top: `${((currentMinutes - DAY_START) / TOTAL_MINUTES) * 100}%`,
                      left: `calc(${TIME_GUTTER}px + ((100% - ${TIME_GUTTER}px) / ${visibleDayCount}) * ${visibleDays.findIndex((day) => dateKey(day) === todayKey)})`,
                      width: `calc((100% - ${TIME_GUTTER}px) / ${visibleDayCount})`
                    }}
                    aria-hidden="true"
                  ><span /></div>
                )}

                {!loading && !todosLoading && !toBuyLoading && !loadError && events.length === 0 && scheduledTodos.length === 0 && scheduledToBuyItems.length === 0 && (
                  <button className="empty-calendar-hint" type="button" onClick={() => openCreate()}>
                    <span><Plus size={18} /></span>
                    <strong>Shape your first block</strong>
                    <small>Create an event, then drag it anywhere in the week.</small>
                  </button>
                )}

                {(loading || todosLoading || toBuyLoading) && <div className="calendar-loading"><span /> Loading your week</div>}
              </div>
            </div>
          </div>
        </div>
      </section>

      <TodoBacklog
        open={backlogOpen}
        todos={backlogTodos}
        toBuyItems={toBuyItems}
        onClose={() => setBacklogOpen(false)}
        onCreate={() => setTodoEditor({ mode: "create" })}
        onEdit={(todo) => setTodoEditor({ mode: "edit", todo })}
        onSchedule={setTodoScheduleEditor}
        onMove={(index, offset) => void reorderBacklogTodos(index, offset)}
        onStartDrag={startBacklogTodoDrag}
        onDragMove={moveBacklogTodoDrag}
        onDragEnd={endBacklogTodoDrag}
        onDragCancel={cancelBacklogTodoDrag}
        onCreateToBuy={() => setToBuyEditor({ mode: "create" })}
        onEditToBuy={(item) => setToBuyEditor({ mode: "edit", item })}
        onMoveToBuy={(index, offset) => void reorderToBuyItems(index, offset)}
        onScheduleToBuy={setToBuyScheduleEditor}
        onStartToBuyDrag={startToBuyDrag}
        onToBuyDragMove={moveToBuyDrag}
        onToBuyDragEnd={endToBuyDrag}
        onToBuyDragCancel={cancelToBuyDrag}
      />

      {backlogTodoGhost && (
        <div
          className={`todo-drag-ghost${backlogTodoGhost.overCalendar ? " is-over-calendar" : ""}`}
          style={{ left: backlogTodoGhost.x, top: backlogTodoGhost.y }}
          aria-hidden="true"
        >
          <ListTodo size={15} />
          <span>{backlogTodoGhost.todo.title}</span>
        </div>
      )}

      {toBuyGhost && (
        <div
          className={`todo-drag-ghost to-buy-drag-ghost${toBuyGhost.overCalendar ? " is-over-calendar" : ""}`}
          style={{ left: toBuyGhost.x, top: toBuyGhost.y }}
          aria-hidden="true"
        >
          <ShoppingBag size={15} />
          <span>{toBuyGhost.item.title}</span>
        </div>
      )}

      {notice && <div className="toast" role="status"><Check size={15} /> {notice}</div>}

      {contextMenu && (
        <div
          className="calendar-context-menu"
          role="menu"
          aria-label={contextMenu.kind === "event"
            ? "Event actions"
            : contextMenu.kind === "todo"
              ? "To-do actions"
            : contextMenu.kind === "to-buy"
              ? "To-buy actions"
            : contextMenu.kind === "selection"
              ? "Selected event actions"
              : "Calendar actions"}
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onContextMenu={(mouseEvent) => mouseEvent.preventDefault()}
          onClick={(mouseEvent) => mouseEvent.stopPropagation()}
        >
          {contextMenu.kind === "to-buy" ? (
            <>
              <button type="button" role="menuitem" onClick={() => {
                setToBuyEditor({ mode: "edit", item: contextMenu.item });
                setContextMenu(null);
              }}>
                <Pencil size={15} />
                <span>Edit to-buy item</span>
              </button>
              {contextMenu.item.url && (
                <button type="button" role="menuitem" onClick={() => {
                  window.open(contextMenu.item.url ?? "", "_blank", "noopener,noreferrer");
                  setContextMenu(null);
                }}>
                  <ExternalLink size={15} />
                  <span>Open purchase link</span>
                </button>
              )}
              <button type="button" role="menuitem" onClick={() => {
                const item = contextMenu.item;
                setContextMenu(null);
                void returnToBuyItemToList(item).catch((error) => setNotice(readError(error)));
              }}>
                <Undo2 size={15} />
                <span>Return to To buy</span>
              </button>
              <button className="is-danger" type="button" role="menuitem" onClick={() => {
                const item = contextMenu.item;
                setContextMenu(null);
                void deleteToBuyItem(item).catch((error) => setNotice(readError(error)));
              }}>
                <Trash2 size={15} />
                <span>Delete item</span>
              </button>
            </>
          ) : contextMenu.kind === "todo" ? (
            <>
              <button type="button" role="menuitem" onClick={() => {
                setTodoEditor({ mode: "edit", todo: contextMenu.todo });
                setContextMenu(null);
              }}>
                <Pencil size={15} />
                <span>Edit to-do</span>
              </button>
              <button type="button" role="menuitem" onClick={() => {
                const todo = contextMenu.todo;
                setContextMenu(null);
                void returnTodoToBacklog(todo).catch((error) => setNotice(readError(error)));
              }}>
                <Undo2 size={15} />
                <span>Return to backlog</span>
              </button>
              <button className="is-danger" type="button" role="menuitem" onClick={() => {
                const todo = contextMenu.todo;
                setContextMenu(null);
                void deleteTodo(todo).catch((error) => setNotice(readError(error)));
              }}>
                <Trash2 size={15} />
                <span>Delete to-do</span>
              </button>
            </>
          ) : contextMenu.kind === "event" ? (
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
          labels={labels}
          labelsLoading={labelsLoading}
          labelsError={labelsError}
          onRetryLabels={loadLabels}
          onLabelsChange={updateLabels}
          onClose={() => setEditor(null)}
          onSave={saveFromEditor}
          onDelete={deleteFromEditor}
        />
      )}

      {labelsOpen && <LabelManagerDialog labels={labels} loading={labelsLoading} error={labelsError} onRetry={loadLabels} onChange={updateLabels} onClose={() => setLabelsOpen(false)} />}

      {todoEditor && (
        <TodoDialog
          key={todoEditor.mode === "edit" ? todoEditor.todo.id : "new-todo"}
          editor={todoEditor}
          onClose={() => setTodoEditor(null)}
          onSave={saveTodoFromEditor}
          onDelete={deleteTodo}
        />
      )}

      {todoScheduleEditor && (
        <TodoScheduleDialog
          key={todoScheduleEditor.id}
          todo={todoScheduleEditor}
          initialDate={dateKey(isDateInWeek(new Date(), days) ? new Date() : days[0])}
          initialTime={minutesToInput(clamp(
            Math.ceil(minutesOfDay(new Date()) / SLOT_MINUTES) * SLOT_MINUTES,
            DAY_START,
            DAY_END - Math.max(SLOT_MINUTES, todoScheduleEditor.estimatedMinutes ?? 0)
          ))}
          onClose={() => setTodoScheduleEditor(null)}
          onSchedule={async (scheduledAt) => {
            await scheduleTodo(todoScheduleEditor, scheduledAt);
            setTodoScheduleEditor(null);
          }}
        />
      )}

      {toBuyEditor && (
        <ToBuyDialog
          key={toBuyEditor.mode === "edit" ? toBuyEditor.item.id : "new-to-buy-item"}
          editor={toBuyEditor}
          onClose={() => setToBuyEditor(null)}
          onSave={saveToBuyItem}
          onDelete={deleteToBuyItem}
        />
      )}


      {toBuyScheduleEditor && (
        <ToBuyScheduleDialog
          key={toBuyScheduleEditor.id}
          item={toBuyScheduleEditor}
          initialDate={dateKey(isDateInWeek(new Date(), days) ? new Date() : days[0])}
          initialTime={minutesToInput(clamp(
            Math.ceil(minutesOfDay(new Date()) / SLOT_MINUTES) * SLOT_MINUTES,
            DAY_START,
            DAY_END - SLOT_MINUTES
          ))}
          onClose={() => setToBuyScheduleEditor(null)}
          onSchedule={async (scheduledAt) => {
            await scheduleToBuyItem(toBuyScheduleEditor, scheduledAt);
            setToBuyScheduleEditor(null);
          }}
        />
      )}

      {sleepEditorOpen && (
        <SleepHoursDialog
          value={sleepHours ?? DEFAULT_SLEEP_HOURS}
          onClose={() => setSleepEditorOpen(false)}
          onSave={saveSleepHours}
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

function SleepHoursDialog({
  value,
  onClose,
  onSave
}: {
  value: SleepHours;
  onClose: () => void;
  onSave: (value: SleepHours) => void;
}) {
  const [startTime, setStartTime] = useState(minutesToInput(value.startMinutes));
  const [endTime, setEndTime] = useState(minutesToInput(value.endMinutes));
  const [error, setError] = useState<string | null>(null);
  useEscapeKey(onClose);

  function submit(formEvent: FormEvent) {
    formEvent.preventDefault();
    const nextValue = {
      startMinutes: inputTimeToMinutes(startTime),
      endMinutes: inputTimeToMinutes(endTime)
    };
    if (!isValidSleepHours(nextValue)) {
      setError("Choose two different sleeping times.");
      return;
    }
    onSave(nextValue);
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="scope-dialog sleep-dialog" role="dialog" aria-modal="true" aria-labelledby="sleep-dialog-title">
        <div className="dialog-header">
          <div>
            <h2 id="sleep-dialog-title">Sleeping hours</h2>
            <p>These hours will be shaded across every day.</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <form onSubmit={submit}>
          <div className="sleep-time-grid">
            <label className="field">
              <span>Sleep from</span>
              <input type="time" step={900} value={startTime} onChange={(event) => setStartTime(event.target.value)} required />
            </label>
            <label className="field">
              <span>Wake at</span>
              <input type="time" step={900} value={endTime} onChange={(event) => setEndTime(event.target.value)} required />
            </label>
          </div>
          <p className="sleep-dialog-note">Overnight ranges are supported—for example, 11:00 PM to 7:00 AM.</p>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="scope-actions">
            <button className="secondary-button" type="button" onClick={onClose}>Cancel</button>
            <button className="primary-button" type="submit">Save hours</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function EventDialog({
  editor,
  labels,
  labelsLoading,
  labelsError,
  onRetryLabels,
  onLabelsChange,
  onClose,
  onSave,
  onDelete
}: {
  editor: EditorState;
  labels: CalendarLabel[];
  labelsLoading: boolean;
  labelsError: string | null;
  onRetryLabels: () => void;
  onLabelsChange: (labels: CalendarLabel[]) => void;
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
  const [goalId, setGoalId] = useState<string | null>(existing?.goalId ?? null);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [durationHours, setDurationHours] = useState(String(Math.floor(initial.duration / 60)));
  const [durationMinutes, setDurationMinutes] = useState(String(initial.duration % 60));
  const [color, setColor] = useState<EventColor>(initial.color);
  const [labelId, setLabelId] = useState<string | null>(existing?.labelId ?? null);
  const [manageLabels, setManageLabels] = useState(false);
  const [labelsBusy, setLabelsBusy] = useState(false);
  const selectedLabel = labels.find((label) => label.id === labelId);
  const [recurring, setRecurring] = useState(initial.recurrenceIntervalWeeks !== null);
  const [recurrenceIntervalWeeks, setRecurrenceIntervalWeeks] = useState(initial.recurrenceIntervalWeeks ?? 1);
  const [recurrenceEndMode, setRecurrenceEndMode] = useState<"on" | "never">(
    initial.recurrenceIntervalWeeks !== null && initial.recurrenceEndsOn === null ? "never" : "on"
  );
  const [recurrenceEndsOn, setRecurrenceEndsOn] = useState(initial.recurrenceEndsOn ?? defaultRecurrenceEnd(initial.date));
  const initialNotificationOffset = initial.notificationOffsetMinutes ?? 15;
  const [notificationEnabled, setNotificationEnabled] = useState(initial.notificationEnabled);
  const [notificationLeadMode, setNotificationLeadMode] = useState<string>(
    NOTIFICATION_PRESETS.some((preset) => preset.value === initialNotificationOffset)
      ? String(initialNotificationOffset)
      : "custom"
  );
  const [notificationHours, setNotificationHours] = useState(String(Math.floor(initialNotificationOffset / 60)));
  const [notificationMinutes, setNotificationMinutes] = useState(String(initialNotificationOffset % 60));
  const [notificationMessage, setNotificationMessage] = useState(initial.notificationMessage ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scopedAction, setScopedAction] = useState<EditorScopedAction | null>(null);
  useEscapeKey(onClose, busy || labelsBusy || scopedAction !== null);

  async function submit(formEvent: FormEvent) {
    formEvent.preventDefault();
    if (busy || labelsBusy || !title.trim() || (labelId && !selectedLabel)) return;
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
    if (minutesOfDay(start) < DAY_START || !eventFitsVisibleDay(start, end)) {
      setError("Events must end by midnight on the selected day.");
      return;
    }
    const selectedNotificationOffset = notificationLeadMode === "custom"
      ? Number(notificationHours) * 60 + Number(notificationMinutes)
      : Number(notificationLeadMode);
    if (
      notificationEnabled
      && (!Number.isInteger(selectedNotificationOffset) || selectedNotificationOffset < 0 || selectedNotificationOffset > 7 * 24 * 60)
    ) {
      setError("Choose a notification time between the event start and seven days before it.");
      return;
    }
    if (
      notificationEnabled
      && notificationTimeIsTooSoon(start, selectedNotificationOffset)
      && !(existing && needsRecurrenceScopeChoice(existing))
      && !canKeepSentNotification(existing, start, selectedNotificationOffset, notificationMessage.trim() || null)
    ) {
      setError("Choose a notification time at least one minute from now.");
      return;
    }
    const input: EventInput = {
      ...(!existing || labelId !== existing.labelId ? { labelId } : {}),
      goalId,
      title: title.trim(),
      description: description.trim(),
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      recurrenceIntervalWeeks: recurring ? recurrenceIntervalWeeks : null,
      recurrenceTimeZone: recurring
        ? existing?.recurrenceTimeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC"
        : null,
      recurrenceEndsOn: recurring && recurrenceEndMode === "on" ? recurrenceEndsOn : null,
      notificationEnabled,
      notificationOffsetMinutes: notificationEnabled ? selectedNotificationOffset : null,
      notificationMessage: notificationEnabled ? notificationMessage.trim() || null : null,
      ...(existing ? { occurrenceStartsAt: existing.occurrenceStartsAt } : {}),
      color: selectedLabel?.color ?? color
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
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => !busy && !labelsBusy && event.target === event.currentTarget && onClose()}>
      <section className="event-dialog" role="dialog" aria-modal="true" aria-labelledby="event-dialog-title">
        <div className="dialog-header">
          <div>
            <h2 id="event-dialog-title">{existing ? "Make a change" : "What are you making time for?"}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} disabled={busy || labelsBusy} aria-label="Close"><X size={18} /></button>
        </div>

        <form onSubmit={submit}>
          <label className="field field-wide">
            <span>Event name</span>
            <input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Deep work, training, coffee…" maxLength={120} />
          </label>

          <GoalSelector value={goalId} onChange={setGoalId} />
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
              <input type="time" value={time} min="00:00" max="23:45" step={900} onChange={(event) => setTime(event.target.value)} required />
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

          <div className={`notification-control${notificationEnabled ? " is-enabled" : ""}`}>
            <label className="notification-toggle">
              <input
                type="checkbox"
                checked={notificationEnabled}
                onChange={(event) => setNotificationEnabled(event.target.checked)}
              />
              <span className="notification-toggle-icon"><Bell size={16} /></span>
              <span>
                <strong>Notify me</strong>
                <small>Get a reminder on your phone.</small>
              </span>
            </label>
            {notificationEnabled && (
              <div className="notification-settings">
                <label className="field">
                  <span>Notify before</span>
                  <select
                    value={notificationLeadMode}
                    onChange={(event) => setNotificationLeadMode(event.target.value)}
                  >
                    {NOTIFICATION_PRESETS.map((preset) => (
                      <option key={preset.value} value={preset.value}>{preset.label}</option>
                    ))}
                    <option value="custom">Custom…</option>
                  </select>
                </label>
                {notificationLeadMode === "custom" && (
                  <div className="field notification-custom-time">
                    <span>Custom lead time</span>
                    <div className="duration-inputs">
                      <label>
                        <input
                          aria-label="Notification hours before"
                          type="number"
                          min={0}
                          max={168}
                          step={1}
                          value={notificationHours}
                          onChange={(event) => setNotificationHours(event.target.value)}
                          required
                        />
                        <span>hr</span>
                      </label>
                      <label>
                        <input
                          aria-label="Notification minutes before"
                          type="number"
                          min={0}
                          max={59}
                          step={1}
                          value={notificationMinutes}
                          onChange={(event) => setNotificationMinutes(event.target.value)}
                          required
                        />
                        <span>min</span>
                      </label>
                    </div>
                  </div>
                )}
                <label className="field field-wide notification-message">
                  <span>Notification message <small>optional</small></span>
                  <textarea
                    value={notificationMessage}
                    onChange={(event) => setNotificationMessage(event.target.value)}
                    placeholder="Leave blank for an automatic reminder."
                    maxLength={500}
                    rows={2}
                  />
                </label>
              </div>
            )}
          </div>

          <label className="field field-wide">
            <span>Notes <small>optional</small></span>
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Add a little context…" maxLength={500} rows={3} />
          </label>

          <fieldset className="color-field">
            <legend>Label</legend>
            {labelsLoading ? (
              <p role="status">Loading labels…</p>
            ) : labelsError ? (
              <p role="alert">
                {labelsError}{" "}
                <button type="button" onClick={onRetryLabels}>
                  Retry
                </button>
              </p>
            ) : (
              <>
                <div className="color-options">
                  <label className={`color-option${labelId === null ? " is-selected" : ""}`}>
                    <input
                      type="radio"
                      name="event-label"
                      checked={labelId === null}
                      onChange={() => {
                        setColor(selectedLabel?.color ?? color);
                        setLabelId(null);
                      }}
                    />
                    <span style={{ background: eventColorHex(color) }} />
                    <small>No label</small>
                  </label>
                  {labels.map((label) => (
                    <label
                      key={label.id}
                      className={`color-option${labelId === label.id ? " is-selected" : ""}`}
                    >
                      <input
                        type="radio"
                        name="event-label"
                        value={label.id}
                        checked={labelId === label.id}
                        onChange={() => {
                          setLabelId(label.id);
                          setColor(label.color);
                        }}
                      />
                      <span style={{ background: label.color }} />
                      <small>{label.name}</small>
                    </label>
                  ))}
                </div>
                {labelId && !selectedLabel && (
                  <p role="alert">The selected label is unavailable. Choose another label or No label.</p>
                )}
              </>
            )}
            <button
              className="label-manage-toggle"
              type="button"
              disabled={labelsBusy}
              onClick={() => setManageLabels(!manageLabels)}
            >
              <Tags size={14} /> {manageLabels ? "Close label manager" : "Manage labels"}
            </button>
            {manageLabels && (
              <LabelManager
                labels={labels}
                loading={labelsLoading}
                error={labelsError}
                onRetry={onRetryLabels}
                onBusyChange={setLabelsBusy}
                onChange={(updated) => {
                  if (labelId && !updated.some((label) => label.id === labelId)) {
                    setColor(selectedLabel?.color ?? color);
                    setLabelId(null);
                  }
                  onLabelsChange(updated);
                }}
              />
            )}
          </fieldset>

          {error && <p className="form-error" role="alert">{error}</p>}

          <div className="dialog-actions">
            {existing ? (
              <button className="delete-button" type="button" onClick={() => void remove()} disabled={busy || labelsBusy}>
                <Trash2 size={16} /> Delete
              </button>
            ) : <span />}
            <div>
              <button className="secondary-button" type="button" onClick={onClose} disabled={busy || labelsBusy}>Cancel</button>
              <button className="primary-button" type="submit" disabled={busy || labelsBusy || !title.trim() || Boolean(labelId && !selectedLabel)}>{busy ? "Saving…" : existing ? "Save changes" : "Create event"}</button>
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
  useEscapeKey(onCancel, busy);

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
  useEscapeKey(onCancel, busy);

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

function eventPatchBody(event: CalendarEvent, scope: RecurringEventScope, baseline: CalendarEvent) {
  return {
    id: event.id,
    ...(event.labelId !== baseline.labelId ? { labelId: event.labelId } : {}),
    ...(event.goalId !== baseline.goalId ? { goalId: event.goalId } : {}),
    title: event.title,
    description: event.description,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    recurrenceIntervalWeeks: event.recurrenceIntervalWeeks,
    recurrenceTimeZone: event.recurrenceTimeZone,
    recurrenceEndsOn: event.recurrenceEndsOn,
    notificationEnabled: event.notificationEnabled,
    notificationOffsetMinutes: event.notificationEnabled ? event.notificationOffsetMinutes : null,
    notificationMessage: event.notificationEnabled ? event.notificationMessage : null,
    occurrenceStartsAt: event.occurrenceStartsAt,
    scope,
    color: event.color
  };
}

function needsRecurrenceScopeChoice(event: CalendarEvent) {
  return event.recurrenceIntervalWeeks !== null && !event.isOccurrenceOverride;
}

function hasSameEditableValues(left: CalendarEvent, right: CalendarEvent) {
  return left.labelId === right.labelId
    && left.goalId === right.goalId
    && left.title === right.title
    && left.description === right.description
    && left.startsAt === right.startsAt
    && left.endsAt === right.endsAt
    && left.recurrenceIntervalWeeks === right.recurrenceIntervalWeeks
    && left.recurrenceTimeZone === right.recurrenceTimeZone
    && left.recurrenceEndsOn === right.recurrenceEndsOn
    && left.notificationEnabled === right.notificationEnabled
    && left.notificationOffsetMinutes === right.notificationOffsetMinutes
    && left.notificationMessage === right.notificationMessage
    && left.color === right.color;
}

function eventCardLayout(event: CalendarEvent, days: Date[]) {
  const start = new Date(event.startsAt);
  const end = new Date(event.endsAt);
  const dayIndex = days.findIndex((day) => dateKey(day) === dateKey(start));
  const startMinutes = minutesOfDay(start);
  const endMinutes = calendarEndMinutes(start, end);

  if (dayIndex < 0 || startMinutes >= DAY_END || endMinutes <= DAY_START) return null;

  const visibleStart = Math.max(startMinutes, DAY_START);
  const visibleEnd = Math.min(endMinutes, DAY_END);
  const visibleMinutes = visibleEnd - visibleStart;
  const top = `${((visibleStart - DAY_START) / TOTAL_MINUTES) * 100}%`;
  const height = `${(visibleMinutes / TOTAL_MINUTES) * 100}%`;
  return { dayIndex, top, height, compact: visibleMinutes < 45 };
}

function todoCalendarLayout(todo: CalendarTodo, days: Date[]) {
  if (!todo.scheduledAt) return null;
  const start = new Date(todo.scheduledAt);
  const dayIndex = days.findIndex((day) => dateKey(day) === dateKey(start));
  if (dayIndex < 0) return null;
  const startMinutes = minutesOfDay(start);
  const visibleMinutes = Math.min(todo.estimatedMinutes ?? 0, DAY_END - startMinutes);
  return {
    dayIndex,
    top: `${((startMinutes - DAY_START) / TOTAL_MINUTES) * 100}%`,
    height: `${(visibleMinutes / TOTAL_MINUTES) * 100}%`,
    compact: visibleMinutes < 45
  };
}

function toBuyCalendarLayout(item: CalendarToBuyItem, days: Date[]) {
  if (!item.scheduledAt) return null;
  const start = new Date(item.scheduledAt);
  const dayIndex = days.findIndex((day) => dateKey(day) === dateKey(start));
  if (dayIndex < 0) return null;
  return {
    dayIndex,
    top: `${((minutesOfDay(start) - DAY_START) / TOTAL_MINUTES) * 100}%`
  };
}

function dayColumnLeft(dayIndex: number, dayCount: number) {
  return `calc((100% / ${dayCount}) * ${dayIndex} + 5px)`;
}

function calendarEndMinutes(start: Date, end: Date) {
  return dateKey(end) === dateKey(start) ? minutesOfDay(end) : DAY_END;
}

function eventFitsVisibleDay(start: Date, end: Date) {
  return end.getTime() <= localDateAtMinutes(start, DAY_END).getTime();
}

function sleepHourSegments(sleepHours: SleepHours) {
  if (sleepHours.startMinutes < sleepHours.endMinutes) {
    return [{ startMinutes: sleepHours.startMinutes, endMinutes: sleepHours.endMinutes }];
  }
  return [
    { startMinutes: DAY_START, endMinutes: sleepHours.endMinutes },
    { startMinutes: sleepHours.startMinutes, endMinutes: DAY_END }
  ].filter((segment) => segment.endMinutes > segment.startMinutes);
}

function isValidSleepHours(value: unknown): value is SleepHours {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SleepHours>;
  return Number.isInteger(candidate.startMinutes)
    && Number.isInteger(candidate.endMinutes)
    && candidate.startMinutes! >= DAY_START
    && candidate.startMinutes! < DAY_END
    && candidate.endMinutes! >= DAY_START
    && candidate.endMinutes! < DAY_END
    && candidate.startMinutes !== candidate.endMinutes;
}

function applyEventCardLayout(card: HTMLElement, event: CalendarEvent, days: Date[]) {
  const layout = eventCardLayout(event, days);
  if (!layout) return;

  card.style.left = dayColumnLeft(layout.dayIndex, days.length);
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

function dayIndexInWeek(date: Date) {
  return date.getDay() === 0 ? 6 : date.getDay() - 1;
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

function formatTodoTime(todo: CalendarTodo) {
  if (!todo.scheduledAt) return "Unscheduled";
  const formatter = new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" });
  const start = new Date(todo.scheduledAt);
  if (todo.estimatedMinutes === null) return formatter.format(start);
  return `${formatter.format(start)} – ${formatter.format(new Date(start.getTime() + todo.estimatedMinutes * 60_000))}`;
}

function formatToBuyTime(item: CalendarToBuyItem) {
  if (!item.scheduledAt) return "Unscheduled";
  return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(new Date(item.scheduledAt));
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

function displayedNotificationState(event: CalendarEvent, now: Date): NotificationState {
  if (
    event.notificationState === "scheduled"
    && event.notificationAt
    && new Date(event.notificationAt) <= now
  ) return "sent";
  return event.notificationState;
}

function formatNotificationForAria(event: CalendarEvent, state: NotificationState) {
  if (!event.notificationEnabled) return "";
  if (state === "sent") return " Notification sent.";
  if (state === "failed") return " Notification scheduling needs attention.";
  return " Notification enabled.";
}

function notificationTimeIsTooSoon(startsAt: Date, offsetMinutes: number | null) {
  if (offsetMinutes === null) return true;
  return startsAt.getTime() - offsetMinutes * 60_000 < Date.now() + 60_000;
}

function canKeepSentNotification(
  existing: CalendarEvent | null,
  startsAt: Date,
  offsetMinutes: number,
  message: string | null
) {
  return existing?.notificationState === "sent"
    && existing.startsAt === startsAt.toISOString()
    && existing.notificationOffsetMinutes === offsetMinutes
    && existing.notificationMessage === message;
}

function formatWeekRange(start: Date, end: Date) {
  const month = (date: Date) => new Intl.DateTimeFormat("en", { month: "short" }).format(date);
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  const sameYear = start.getFullYear() === end.getFullYear();

  if (sameMonth) return `${month(start)} ${start.getDate()}–${end.getDate()}, ${end.getFullYear()}`;
  if (sameYear) return `${month(start)} ${start.getDate()}–${month(end)} ${end.getDate()}, ${end.getFullYear()}`;
  return `${month(start)} ${start.getDate()}, ${start.getFullYear()}–${month(end)} ${end.getDate()}, ${end.getFullYear()}`;
}

function formatCompactWeekRange(start: Date, end: Date) {
  const month = (date: Date) => new Intl.DateTimeFormat("en", { month: "short" }).format(date);
  const startYear = String(start.getFullYear()).slice(-2);
  const endYear = String(end.getFullYear()).slice(-2);
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  if (sameMonth) return `${month(start)} ${start.getDate()}–${end.getDate()} ’${endYear}`;
  if (start.getFullYear() === end.getFullYear()) {
    return `${month(start)} ${start.getDate()}–${month(end)} ${end.getDate()} ’${endYear}`;
  }
  return `${month(start)} ${start.getDate()} ’${startYear}–${month(end)} ${end.getDate()} ’${endYear}`;
}

function formatMobileDayName(date: Date) {
  return new Intl.DateTimeFormat("en", { weekday: "long" }).format(date);
}

function formatMobileDayDate(date: Date) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(date);
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
    notificationEnabled: false,
    notificationOffsetMinutes: null,
    notificationMessage: null,
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
    notificationEnabled: event.notificationEnabled,
    notificationOffsetMinutes: event.notificationOffsetMinutes,
    notificationMessage: event.notificationMessage,
    color: event.color
  };
}

function minutesToInput(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function inputTimeToMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function defaultRecurrenceEnd(date: string) {
  return dateKey(addDays(parseDateKey(date), 12 * 7));
}

function compareEvents(left: CalendarEvent, right: CalendarEvent) {
  return new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime();
}

function compareTodos(left: CalendarTodo, right: CalendarTodo) {
  return new Date(left.scheduledAt ?? 0).getTime() - new Date(right.scheduledAt ?? 0).getTime();
}

function compareToBuyItems(left: CalendarToBuyItem, right: CalendarToBuyItem) {
  return new Date(left.scheduledAt ?? 0).getTime() - new Date(right.scheduledAt ?? 0).getTime();
}

function readError(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}
