"use client";

import { CalendarPlus, ChevronDown, ChevronUp, Clock3, ExternalLink, GripVertical, Link2, ListTodo, Pencil, Plus, ShoppingBag, Trash2, X } from "lucide-react";
import { useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useEscapeKey } from "@/app/hooks/use-escape-key";

export type CalendarTodo = {
  id: string;
  title: string;
  description: string;
  estimatedMinutes: number | null;
  scheduledAt: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type TodoInput = Pick<CalendarTodo, "title" | "description" | "estimatedMinutes">;

export type CalendarToBuyItem = {
  id: string;
  title: string;
  description: string;
  url: string | null;
  scheduledAt: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type ToBuyInput = Pick<CalendarToBuyItem, "title" | "description" | "url">;

export type ToBuyEditorState =
  | { mode: "create" }
  | { mode: "edit"; item: CalendarToBuyItem };

export type TodoEditorState =
  | { mode: "create" }
  | { mode: "edit"; todo: CalendarTodo };

export function TodoBacklog({
  open,
  todos,
  toBuyItems,
  onClose,
  onCreate,
  onEdit,
  onSchedule,
  onMove,
  onStartDrag,
  onDragMove,
  onDragEnd,
  onDragCancel,
  onCreateToBuy,
  onEditToBuy,
  onMoveToBuy,
  onScheduleToBuy,
  onStartToBuyDrag,
  onToBuyDragMove,
  onToBuyDragEnd,
  onToBuyDragCancel
}: {
  open: boolean;
  todos: CalendarTodo[];
  toBuyItems: CalendarToBuyItem[];
  onClose: () => void;
  onCreate: () => void;
  onEdit: (todo: CalendarTodo) => void;
  onSchedule: (todo: CalendarTodo) => void;
  onMove: (index: number, offset: -1 | 1) => void;
  onStartDrag: (event: ReactPointerEvent<HTMLButtonElement>, todo: CalendarTodo) => void;
  onDragMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onDragEnd: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onDragCancel: () => void;
  onCreateToBuy: () => void;
  onEditToBuy: (item: CalendarToBuyItem) => void;
  onMoveToBuy: (index: number, offset: -1 | 1) => void;
  onScheduleToBuy: (item: CalendarToBuyItem) => void;
  onStartToBuyDrag: (event: ReactPointerEvent<HTMLButtonElement>, item: CalendarToBuyItem) => void;
  onToBuyDragMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onToBuyDragEnd: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onToBuyDragCancel: () => void;
}) {
  const [section, setSection] = useState<"backlog" | "to-buy">("backlog");
  if (!open) return null;

  return (
    <aside className="todo-backlog" aria-label="Backlog and to-buy lists">
      <div className="todo-backlog-header">
        <div>
          <span>Keep it somewhere safe</span>
          <h2>Lists</h2>
        </div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Close lists"><X size={18} /></button>
      </div>

      <div className="backlog-section-tabs" role="tablist" aria-label="Lists">
        <button
          className={section === "backlog" ? "is-active" : ""}
          type="button"
          role="tab"
          aria-selected={section === "backlog"}
          onClick={() => setSection("backlog")}
        >
          <ListTodo size={15} /> Backlog <span>{todos.length}</span>
        </button>
        <button
          className={section === "to-buy" ? "is-active" : ""}
          type="button"
          role="tab"
          aria-selected={section === "to-buy"}
          onClick={() => setSection("to-buy")}
        >
          <ShoppingBag size={15} /> To buy <span>{toBuyItems.length}</span>
        </button>
      </div>

      {section === "backlog" ? (
        <>
          <button className="todo-add-button" type="button" onClick={onCreate}>
            <Plus size={16} /> Add to-do
          </button>
          {todos.length === 0 ? (
            <div className="todo-backlog-empty">
              <ListTodo size={22} />
              <strong>Your backlog is clear</strong>
              <p>Add a quick reminder or a task that needs focused time.</p>
            </div>
          ) : (
            <div className="todo-backlog-list">
              {todos.map((todo, index) => (
                <article className="todo-backlog-item" key={todo.id}>
                  <button
                    className="todo-drag-handle"
                    type="button"
                    aria-label={`Drag ${todo.title} onto the calendar`}
                    title="Drag onto calendar"
                    onPointerDown={(event) => onStartDrag(event, todo)}
                    onPointerMove={onDragMove}
                    onPointerUp={onDragEnd}
                    onPointerCancel={onDragCancel}
                  >
                    <GripVertical size={17} />
                  </button>
                  <button className="todo-backlog-copy" type="button" onClick={() => onEdit(todo)}>
                    <strong>{todo.title}</strong>
                    <span>{todo.estimatedMinutes === null ? "Quick to-do" : formatTodoDuration(todo.estimatedMinutes)}</span>
                  </button>
                  <div className="todo-backlog-actions">
                    <button type="button" aria-label={`Move ${todo.title} up`} disabled={index === 0} onClick={() => onMove(index, -1)}><ChevronUp size={14} /></button>
                    <button type="button" aria-label={`Move ${todo.title} down`} disabled={index === todos.length - 1} onClick={() => onMove(index, 1)}><ChevronDown size={14} /></button>
                    <button type="button" aria-label={`Schedule ${todo.title}`} onClick={() => onSchedule(todo)}><CalendarPlus size={14} /></button>
                    <button type="button" aria-label={`Edit ${todo.title}`} onClick={() => onEdit(todo)}><Pencil size={14} /></button>
                  </div>
                </article>
              ))}
            </div>
          )}
          {todos.length > 0 && (
            <p className="todo-backlog-tip"><GripVertical size={13} /> Drag the handle onto a day and time to schedule.</p>
          )}
        </>
      ) : (
        <>
          <button className="todo-add-button" type="button" onClick={onCreateToBuy}>
            <Plus size={16} /> Add item
          </button>
          {toBuyItems.length === 0 ? (
            <div className="todo-backlog-empty">
              <ShoppingBag size={22} />
              <strong>Your shopping list is clear</strong>
              <p>Save something you need or want, along with the link where you found it.</p>
            </div>
          ) : (
            <div className="todo-backlog-list">
              {toBuyItems.map((item, index) => (
                <article className="todo-backlog-item to-buy-item" key={item.id}>
                  <button
                    className="todo-drag-handle"
                    type="button"
                    aria-label={`Drag ${item.title} onto the calendar`}
                    title="Drag onto calendar"
                    onPointerDown={(event) => onStartToBuyDrag(event, item)}
                    onPointerMove={onToBuyDragMove}
                    onPointerUp={onToBuyDragEnd}
                    onPointerCancel={onToBuyDragCancel}
                  >
                    <ShoppingBag size={16} />
                  </button>
                  <button className="todo-backlog-copy" type="button" onClick={() => onEditToBuy(item)}>
                    <strong>{item.title}</strong>
                    <span>{item.url ? linkHost(item.url) : item.description || "No purchase link yet"}</span>
                  </button>
                  <div className="todo-backlog-actions to-buy-actions">
                    <button type="button" aria-label={`Move ${item.title} up`} disabled={index === 0} onClick={() => onMoveToBuy(index, -1)}><ChevronUp size={14} /></button>
                    <button type="button" aria-label={`Move ${item.title} down`} disabled={index === toBuyItems.length - 1} onClick={() => onMoveToBuy(index, 1)}><ChevronDown size={14} /></button>
                    <button type="button" aria-label={`Schedule ${item.title}`} onClick={() => onScheduleToBuy(item)}><CalendarPlus size={14} /></button>
                    {item.url ? (
                      <a href={item.url} target="_blank" rel="noreferrer" aria-label={`Open purchase link for ${item.title}`} title="Open purchase link"><ExternalLink size={14} /></a>
                    ) : <span />}
                    <button type="button" aria-label={`Edit ${item.title}`} onClick={() => onEditToBuy(item)}><Pencil size={14} /></button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </aside>
  );
}

export function ToBuyDialog({
  editor,
  onClose,
  onSave,
  onDelete
}: {
  editor: ToBuyEditorState;
  onClose: () => void;
  onSave: (input: ToBuyInput, existing?: CalendarToBuyItem) => Promise<void>;
  onDelete: (item: CalendarToBuyItem) => Promise<void>;
}) {
  const existing = editor.mode === "edit" ? editor.item : null;
  const [title, setTitle] = useState(existing?.title ?? "");
  const [url, setUrl] = useState(existing?.url ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEscapeKey(onClose, busy);

  async function submit(formEvent: FormEvent) {
    formEvent.preventDefault();
    if (!title.trim() || busy) return;
    const normalizedUrl = url.trim();
    if (normalizedUrl) {
      try {
        const parsed = new URL(normalizedUrl);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error();
      } catch {
        setError("Enter a complete link beginning with https:// or http://.");
        return;
      }
    }

    setBusy(true);
    setError(null);
    try {
      await onSave({ title: title.trim(), url: normalizedUrl || null, description: description.trim() }, existing ?? undefined);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The item could not be saved.");
      setBusy(false);
    }
  }

  async function remove() {
    if (!existing || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onDelete(existing);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "The item could not be deleted.");
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="scope-dialog todo-dialog" role="dialog" aria-modal="true" aria-labelledby="to-buy-dialog-title">
        <div className="dialog-header">
          <div>
            <h2 id="to-buy-dialog-title">{existing ? "Edit to-buy item" : "Add to buy"}</h2>
            <p>Keep the item and purchase link ready for later.</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <form onSubmit={submit}>
          <label className="field">
            <span>Item</span>
            <input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} placeholder="Headphones, running shoes…" required />
          </label>

          <label className="field to-buy-link-field">
            <span>Purchase link <small>optional</small></span>
            <div><Link2 size={15} /><input type="url" value={url} onChange={(event) => setUrl(event.target.value)} maxLength={2_000} placeholder="https://…" /></div>
          </label>

          <label className="field">
            <span>Notes <small>optional</small></span>
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} placeholder="Size, color, price, or anything to remember…" />
          </label>

          {error && <p className="form-error" role="alert">{error}</p>}

          <div className="todo-dialog-actions">
            {existing ? (
              <button className="delete-button" type="button" disabled={busy} onClick={() => void remove()}><Trash2 size={15} /> Delete</button>
            ) : <span />}
            <div>
              <button className="secondary-button" type="button" disabled={busy} onClick={onClose}>Cancel</button>
              <button className="primary-button" type="submit" disabled={busy || !title.trim()}>{busy ? "Saving…" : existing ? "Save changes" : "Add item"}</button>
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}

export function ToBuyScheduleDialog({
  item,
  initialDate,
  initialTime,
  onClose,
  onSchedule
}: {
  item: CalendarToBuyItem;
  initialDate: string;
  initialTime: string;
  onClose: () => void;
  onSchedule: (scheduledAt: Date) => Promise<void>;
}) {
  const [date, setDate] = useState(initialDate);
  const [time, setTime] = useState(initialTime);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEscapeKey(onClose, busy);

  async function submit(formEvent: FormEvent) {
    formEvent.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSchedule(new Date(`${date}T${time}:00`));
    } catch (scheduleError) {
      setError(scheduleError instanceof Error ? scheduleError.message : "The item could not be scheduled.");
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="scope-dialog todo-schedule-dialog" role="dialog" aria-modal="true" aria-labelledby="to-buy-schedule-title">
        <div className="dialog-header">
          <div>
            <h2 id="to-buy-schedule-title">Add shopping item to calendar</h2>
            <p>{item.title}</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <form onSubmit={submit}>
          <div className="sleep-time-grid">
            <label className="field">
              <span>Day</span>
              <input type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
            </label>
            <label className="field">
              <span>Time</span>
              <input type="time" value={time} step={900} onChange={(event) => setTime(event.target.value)} required />
            </label>
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="scope-actions">
            <button className="secondary-button" type="button" disabled={busy} onClick={onClose}>Cancel</button>
            <button className="primary-button" type="submit" disabled={busy}>{busy ? "Scheduling…" : "Add to calendar"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

export function TodoDialog({
  editor,
  onClose,
  onSave,
  onDelete
}: {
  editor: TodoEditorState;
  onClose: () => void;
  onSave: (input: TodoInput, existing?: CalendarTodo) => Promise<void>;
  onDelete: (todo: CalendarTodo) => Promise<void>;
}) {
  const existing = editor.mode === "edit" ? editor.todo : null;
  const [title, setTitle] = useState(existing?.title ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [kind, setKind] = useState<"quick" | "timed">(existing?.estimatedMinutes === null || !existing ? "quick" : "timed");
  const [durationHours, setDurationHours] = useState(String(Math.floor((existing?.estimatedMinutes ?? 60) / 60)));
  const [durationMinutes, setDurationMinutes] = useState(String((existing?.estimatedMinutes ?? 60) % 60));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEscapeKey(onClose, busy);

  async function submit(formEvent: FormEvent) {
    formEvent.preventDefault();
    if (!title.trim() || busy) return;
    let estimatedMinutes: number | null = null;

    if (kind === "timed") {
      const hours = Number(durationHours);
      const minutes = Number(durationMinutes);
      if (!Number.isInteger(hours) || hours < 0 || hours > 15 || !Number.isInteger(minutes) || minutes < 0 || minutes > 59) {
        setError("Enter a valid duration in hours and minutes.");
        return;
      }
      estimatedMinutes = hours * 60 + minutes;
      if (estimatedMinutes < 15 || estimatedMinutes > 15 * 60) {
        setError("Timed to-dos must be between 15 minutes and 15 hours.");
        return;
      }
      if (existing?.scheduledAt) {
        const scheduledAt = new Date(existing.scheduledAt);
        const startMinutes = scheduledAt.getHours() * 60 + scheduledAt.getMinutes();
        if (startMinutes + estimatedMinutes > 24 * 60) {
          setError("This duration would run past midnight.");
          return;
        }
      }
    }

    setBusy(true);
    setError(null);
    try {
      await onSave({
        title: title.trim(),
        description: description.trim(),
        estimatedMinutes
      }, existing ?? undefined);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The to-do could not be saved.");
      setBusy(false);
    }
  }

  async function remove() {
    if (!existing || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onDelete(existing);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "The to-do could not be deleted.");
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="scope-dialog todo-dialog" role="dialog" aria-modal="true" aria-labelledby="todo-dialog-title">
        <div className="dialog-header">
          <div>
            <h2 id="todo-dialog-title">{existing ? "Edit to-do" : "Add to backlog"}</h2>
            <p>Keep it unscheduled until you know where it belongs.</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <form onSubmit={submit}>
          <label className="field">
            <span>Title</span>
            <input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} placeholder="Remind Alex, prepare proposal…" required />
          </label>

          <fieldset className="todo-kind-field">
            <legend>Type</legend>
            <button className={kind === "quick" ? "is-selected" : ""} type="button" onClick={() => setKind("quick")}>
              <ListTodo size={17} />
              <span><strong>Quick</strong><small>No calendar duration</small></span>
            </button>
            <button className={kind === "timed" ? "is-selected" : ""} type="button" onClick={() => setKind("timed")}>
              <Clock3 size={17} />
              <span><strong>Timed</strong><small>Reserve a time block</small></span>
            </button>
          </fieldset>

          {kind === "timed" && (
            <div className="field duration-field todo-duration-field">
              <span>Estimated duration</span>
              <div className="duration-inputs">
                <label>
                  <input aria-label="Estimated hours" type="number" min={0} max={15} step={1} value={durationHours} onChange={(event) => setDurationHours(event.target.value)} required />
                  <span>hr</span>
                </label>
                <label>
                  <input aria-label="Estimated minutes" type="number" min={0} max={59} step={1} value={durationMinutes} onChange={(event) => setDurationMinutes(event.target.value)} required />
                  <span>min</span>
                </label>
              </div>
            </div>
          )}

          <label className="field">
            <span>Notes <small>optional</small></span>
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} placeholder="Add a little context…" />
          </label>

          {error && <p className="form-error" role="alert">{error}</p>}

          <div className="todo-dialog-actions">
            {existing ? (
              <button className="delete-button" type="button" disabled={busy} onClick={() => void remove()}><Trash2 size={15} /> Delete</button>
            ) : <span />}
            <div>
              <button className="secondary-button" type="button" disabled={busy} onClick={onClose}>Cancel</button>
              <button className="primary-button" type="submit" disabled={busy || !title.trim()}>{busy ? "Saving…" : existing ? "Save changes" : "Add to backlog"}</button>
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}

export function TodoScheduleDialog({
  todo,
  initialDate,
  initialTime,
  onClose,
  onSchedule
}: {
  todo: CalendarTodo;
  initialDate: string;
  initialTime: string;
  onClose: () => void;
  onSchedule: (scheduledAt: Date) => Promise<void>;
}) {
  const [date, setDate] = useState(initialDate);
  const [time, setTime] = useState(initialTime);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEscapeKey(onClose, busy);

  async function submit(formEvent: FormEvent) {
    formEvent.preventDefault();
    const scheduledAt = new Date(`${date}T${time}:00`);
    const minutes = scheduledAt.getHours() * 60 + scheduledAt.getMinutes();
    if (todo.estimatedMinutes !== null && minutes + todo.estimatedMinutes > 24 * 60) {
      setError("This to-do would run past midnight. Choose an earlier time.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await onSchedule(scheduledAt);
    } catch (scheduleError) {
      setError(scheduleError instanceof Error ? scheduleError.message : "The to-do could not be scheduled.");
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="scope-dialog todo-schedule-dialog" role="dialog" aria-modal="true" aria-labelledby="todo-schedule-title">
        <div className="dialog-header">
          <div>
            <h2 id="todo-schedule-title">Add to calendar</h2>
            <p>{todo.title}</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <form onSubmit={submit}>
          <div className="sleep-time-grid">
            <label className="field">
              <span>Day</span>
              <input type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
            </label>
            <label className="field">
              <span>Time</span>
              <input type="time" value={time} step={900} onChange={(event) => setTime(event.target.value)} required />
            </label>
          </div>
          {todo.estimatedMinutes !== null && <p className="sleep-dialog-note">Reserved duration: {formatTodoDuration(todo.estimatedMinutes)}</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="scope-actions">
            <button className="secondary-button" type="button" disabled={busy} onClick={onClose}>Cancel</button>
            <button className="primary-button" type="submit" disabled={busy}>{busy ? "Scheduling…" : "Add to calendar"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

export function formatTodoDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours === 0) return `${remainder} min`;
  if (remainder === 0) return `${hours} hr`;
  return `${hours} hr ${remainder} min`;
}

function linkHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Purchase link";
  }
}
