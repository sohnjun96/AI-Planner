import { useState } from "react";
import type { Project, Task, TaskStatus, TaskType } from "../models";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { ModalBackdrop } from "./ModalBackdrop";

interface ScheduleReminderModalProps {
  task: Task;
  project?: Project;
  taskType?: TaskType;
  timeFormat: "24h" | "12h";
  onStatusChange: (status: TaskStatus) => Promise<void>;
  onAiEdit: () => void;
  onClose: () => void;
}

function formatTaskTime(task: Task, timeFormat: "24h" | "12h"): string {
  const start = new Date(task.startAt);
  const end = task.endAt ? new Date(task.endAt) : undefined;
  const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
  });
  const timeFormatter = new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: timeFormat === "12h",
  });

  if (!end || !Number.isFinite(end.getTime())) {
    return `${dateFormatter.format(start)} · ${timeFormatter.format(start)}`;
  }

  const isSameDay = start.toDateString() === end.toDateString();
  if (isSameDay) {
    return `${dateFormatter.format(start)} · ${timeFormatter.format(start)} – ${timeFormatter.format(end)}`;
  }

  return `${dateFormatter.format(start)} ${timeFormatter.format(start)} – ${dateFormatter.format(end)} ${timeFormatter.format(end)}`;
}

export function ScheduleReminderModal({
  task,
  project,
  taskType,
  timeFormat,
  onStatusChange,
  onAiEdit,
  onClose,
}: ScheduleReminderModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useDialogFocus<HTMLElement>({ isOpen: true, onClose: isSubmitting ? undefined : onClose });

  async function handleStatusChange(status: TaskStatus) {
    if (isSubmitting) {
      return;
    }
    setIsSubmitting(true);
    setError("");
    try {
      await onStatusChange(status);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "일정 상태를 변경하지 못했습니다.");
      setIsSubmitting(false);
    }
  }

  return (
    <ModalBackdrop
      className="reminder-review-backdrop"
      onRequestClose={() => !isSubmitting && onClose()}
    >
      <section
        ref={dialogRef}
        className="reminder-review-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reminder-review-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="reminder-review-header">
          <p>PLANAI · 일정 확인</p>
          <div className="reminder-review-header-actions">
            <button type="button" className="reminder-review-ai-edit" onClick={onAiEdit} disabled={isSubmitting}>
              AI 수정
            </button>
            <button type="button" className="reminder-review-close" onClick={onClose} disabled={isSubmitting} aria-label="일정 검토 닫기">
              ×
            </button>
          </div>
        </header>

        <div className="reminder-review-content">
          <span className="reminder-review-kicker">지금 확인할 일정</span>
          <h2 id="reminder-review-title">{task.title}</h2>
          <p className="reminder-review-time">{formatTaskTime(task, timeFormat)}</p>

          <dl className="reminder-review-details">
            <div>
              <dd>{project?.name ?? "일반"}</dd>
            </div>
            <div>
              <dd>{taskType?.name ?? "기타"}</dd>
            </div>
          </dl>

          {error ? <p className="reminder-review-error" role="alert">{error}</p> : null}
        </div>

        <footer className="reminder-review-primary-actions">
          <button type="button" className="reminder-action-complete" onClick={() => void handleStatusChange("DONE")} disabled={isSubmitting} data-dialog-initial-focus>
            완료하기
          </button>
          <button type="button" className="reminder-action-cancel" onClick={() => void handleStatusChange("CANCELED")} disabled={isSubmitting}>
            취소하기
          </button>
          <button type="button" className="reminder-action-hold" onClick={() => void handleStatusChange("ON_HOLD")} disabled={isSubmitting}>
            보류하기
          </button>
        </footer>
      </section>
    </ModalBackdrop>
  );
}
