"use client";

import { useState } from "react";
import { Plus, Tags, Trash2, X } from "lucide-react";
import { labelsRequest } from "@/app/lib/labels-api";
import { useEscapeKey } from "@/app/hooks/use-escape-key";
import type { CalendarLabel } from "@/nextsignal/services";

type Props = {
  labels: CalendarLabel[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onChange: (labels: CalendarLabel[]) => void;
};

export function LabelManagerDialog({ onClose, ...props }: Props & { onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  useEscapeKey(onClose, busy);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (!busy && event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="scope-dialog labels-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="labels-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog-header">
          <h2 id="labels-title">
            <Tags size={18} /> Labels
          </h2>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close labels"
          >
            <X size={18} />
          </button>
        </div>
        <LabelManager {...props} onBusyChange={setBusy} />
      </section>
    </div>
  );
}

export function LabelManager({
  labels,
  loading,
  error,
  onRetry,
  onChange,
  onBusyChange
}: Props & { onBusyChange?: (busy: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState("#8c6cff");

  async function run(action: () => Promise<void>) {
    setBusy(true);
    onBusyChange?.(true);
    setSaveError(null);
    try {
      await action();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Labels could not be saved.");
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  }

  return (
    <div
      className="label-manager"
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.target instanceof HTMLInputElement)
          event.preventDefault();
      }}
    >
      <p className="label-manager-help">
        Give each color a meaning, such as Education, Fun, or Networking.
      </p>
      {loading ? (
        <p role="status">Loading labels…</p>
      ) : error ? (
        <p role="alert">
          {error}{" "}
          <button type="button" onClick={onRetry}>
            Retry
          </button>
        </p>
      ) : (
        <>
          <div className="label-manager-list">
            {labels.map((label) => (
              <LabelRow
                key={`${label.id}:${label.updatedAt}`}
                label={label}
                busy={busy}
                onSave={(name, color) =>
                  run(async () => {
                    const data = await labelsRequest<{ label: CalendarLabel }>("", {
                      method: "PATCH",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ id: label.id, name, color })
                    });
                    onChange(labels.map((item) => (item.id === label.id ? data.label : item)));
                  })
                }
                onRemove={() =>
                  run(async () => {
                    await labelsRequest("", {
                      method: "DELETE",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ id: label.id })
                    });
                    onChange(labels.filter((item) => item.id !== label.id));
                  })
                }
              />
            ))}
            {!labels.length && <p>No labels yet. Add your first one below.</p>}
          </div>
          <div className="label-manager-add">
            <label className="label-color-input">
              <span className="sr-only">New label color</span>
              <input
                type="color"
                value={color}
                onChange={(event) => setColor(event.target.value)}
                disabled={busy}
              />
            </label>
            <label className="label-name-input">
              <span className="sr-only">New label name</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={60}
                placeholder="New label name"
                disabled={busy}
              />
            </label>
            <button
              className="primary-button"
              type="button"
              disabled={busy || !name.trim()}
              onClick={() =>
                void run(async () => {
                  const data = await labelsRequest<{ label: CalendarLabel }>("", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ name, color })
                  });
                  onChange([...labels, data.label]);
                  setName("");
                })
              }
            >
              <Plus size={14} /> Add
            </button>
          </div>
          <p className="label-manager-help">
            Removing a label keeps its events and their last color.
          </p>
        </>
      )}
      {saveError && (
        <p className="form-error" role="alert">
          {saveError}
        </p>
      )}
    </div>
  );
}

function LabelRow({
  label,
  busy,
  onSave,
  onRemove
}: {
  label: CalendarLabel;
  busy: boolean;
  onSave: (name: string, color: string) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const [name, setName] = useState(label.name);
  const [color, setColor] = useState<string>(label.color);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const changed = name.trim() !== label.name || color !== label.color;
  return (
    <div className="label-manager-row">
      <div className="label-manager-fields">
        <label className="label-color-input">
          <span className="sr-only">Color for {label.name}</span>
          <input
            type="color"
            value={color}
            onChange={(event) => setColor(event.target.value)}
            disabled={busy}
          />
        </label>
        <label className="label-name-input">
          <span className="sr-only">Name for {label.name}</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={60}
            disabled={busy}
          />
        </label>
        <button
          className="secondary-button"
          type="button"
          disabled={busy || !changed || !name.trim()}
          onClick={() => void onSave(name, color)}
        >
          Save
        </button>
        <button
          className="icon-button"
          type="button"
          disabled={busy}
          aria-label={`Remove ${label.name}`}
          onClick={() => setConfirmRemove(!confirmRemove)}
        >
          <Trash2 size={15} />
        </button>
      </div>
      {confirmRemove && (
        <div className="label-remove-confirm">
          <span>Remove “{label.name}”? Events will be kept.</span>
          <button
            className="delete-button"
            type="button"
            disabled={busy}
            onClick={() => void onRemove()}
          >
            Remove
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={busy}
            onClick={() => setConfirmRemove(false)}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
