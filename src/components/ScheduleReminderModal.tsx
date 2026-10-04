import { useEffect, useRef, useState } from "react";
import type { Project, Task, TaskStatus, TaskType } from "../models";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { ModalBackdrop } from "./ModalBackdrop";
import "./ScheduleReminderModal.css";

interface ScheduleReminderModalProps {
  tasks: Task[];
  selectedTaskId: string;
  projects: Project[];
  taskTypes: TaskType[];
  timeFormat: "24h" | "12h";
  onSelectTask: (id: string) => void;
  onStatusChange: (status: TaskStatus) => Promise<void>;
  onPostpone: (days: 1 | 3 | 7) => Promise<void>;
  onSnooze: () => Promise<void>;
  onAcknowledge: () => void;
  onAcknowledgeAll: () => void;
  onAiEdit: () => void;
  onClose: () => void;
}

function formatTaskTime(task: Task, timeFormat: "24h" | "12h"): string {
  const start = new Date(task.startAt);
  const end = task.endAt ? new Date(task.endAt) : undefined;
  if (!Number.isFinite(start.getTime())) return "시간 미정";

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
  if (start.toDateString() === end.toDateString()) {
    return `${dateFormatter.format(start)} · ${timeFormatter.format(start)} – ${timeFormatter.format(end)}`;
  }
  return `${dateFormatter.format(start)} ${timeFormatter.format(start)} – ${dateFormatter.format(end)} ${timeFormatter.format(end)}`;
}

function getRelativeTime(task: Task, now: number): string {
  const difference = new Date(task.startAt).getTime() - now;
  if (!Number.isFinite(difference)) return "시간 미정";
  const minutes = Math.ceil(Math.abs(difference) / 60_000);
  if (minutes <= 1) return difference > 0 ? "곧 시작" : "방금 시작";
  const unit = minutes >= 1_440 ? `${Math.floor(minutes / 1_440)}일` : minutes >= 60 ? `${Math.floor(minutes / 60)}시간` : `${minutes}분`;
  return `${unit} ${difference > 0 ? "후" : "전"}`;
}

export function ScheduleReminderModal({
  tasks,
  selectedTaskId,
  projects,
  taskTypes,
  timeFormat,
  onSelectTask,
  onStatusChange,
  onPostpone,
  onSnooze,
  onAcknowledge,
  onAcknowledgeAll,
  onAiEdit,
  onClose,
}: ScheduleReminderModalProps) {
  const task = tasks.find((item) => item.id === selectedTaskId) ?? tasks[0];
  const project = projects.find((item) => item.id === task?.projectId);
  const taskType = taskTypes.find((item) => item.id === task?.taskTypeId);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [isPostponeOpen, setIsPostponeOpen] = useState(false);
  const submittingRef = useRef(false);
  const [now, setNow] = useState(() => Date.now());
  const hasMultipleTasks = tasks.length > 1;

  function requestClose() {
    if (!submittingRef.current) onClose();
  }

  const dialogRef = useDialogFocus<HTMLElement>({ isOpen: Boolean(task), onClose: requestClose });

  useEffect(() => {
    setError("");
    setIsMoreOpen(false);
    setIsPostponeOpen(false);
  }, [task?.id]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  async function runAction(action: () => Promise<void>, failureMessage: string) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setIsSubmitting(true);
    setError("");
    try {
      await action();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : failureMessage);
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  function runImmediateAction(action: () => void) {
    if (!submittingRef.current) action();
  }

  function selectTask(id: string) {
    if (submittingRef.current || id === task?.id) return;
    setError("");
    setIsMoreOpen(false);
    setIsPostponeOpen(false);
    onSelectTask(id);
  }

  if (!task) return null;

  const isUpcoming = (item: Task) => new Date(item.startAt).getTime() > now;
  const groups = [
    { id: "soon", label: "시작 임박", tasks: tasks.filter(isUpcoming) },
    { id: "past", label: "지난 알림", tasks: tasks.filter((item) => !isUpcoming(item)) },
  ];

  return (
    <ModalBackdrop className="reminder-review-backdrop" onRequestClose={requestClose}>
      <section
        id="schedule-reminder-dialog"
        ref={dialogRef}
        className={`reminder-review-modal${hasMultipleTasks ? " reminder-review-modal-grouped" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reminder-review-title"
        aria-busy={isSubmitting}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="reminder-review-header">
          <div className="reminder-review-header-title">
            <p>PLANAI · 일정 확인</p>
            {hasMultipleTasks ? (
              <h2 className="reminder-review-count-title">확인할 알림 <span className="reminder-review-count">{tasks.length}</span>건</h2>
            ) : null}
          </div>
          <button type="button" className="reminder-review-close" onClick={requestClose} disabled={isSubmitting} aria-label="일정 알림 닫기">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" focusable="false">
              <path d="m5 5 14 14M19 5 5 19" />
            </svg>
          </button>
        </header>

        <div className="reminder-review-content">
          <span className="reminder-review-kicker">
            {hasMultipleTasks ? `${isUpcoming(task) ? "시작 임박" : "지난 알림"} · ${getRelativeTime(task, now)}` : "지금 확인할 일정"}
          </span>
          <div className="reminder-review-focus-heading">
            <h2 id="reminder-review-title" title={task.title}>{task.title}</h2>
            <button type="button" className="reminder-review-ai-edit" onClick={() => runImmediateAction(onAiEdit)} disabled={isSubmitting}>
              AI 수정
            </button>
          </div>
          <p className="reminder-review-time">{formatTaskTime(task, timeFormat)}</p>
          <dl className="reminder-review-details">
            <div><dt>프로젝트</dt><dd title={project?.name ?? "일반"}>{project?.name ?? "일반"}</dd></div>
            <div><dt>일정 종류</dt><dd title={taskType?.name ?? "기타"}>{taskType?.name ?? "기타"}</dd></div>
          </dl>
          {error ? <p className="reminder-review-error" role="alert">{error}</p> : null}
        </div>

        <div className="reminder-review-actions">
          <div className="reminder-review-primary-actions">
            <button type="button" className="reminder-action-complete" onClick={() => void runAction(() => onStatusChange("DONE"), "일정 상태를 변경하지 못했습니다.")} disabled={isSubmitting} data-dialog-initial-focus>
              완료하기
            </button>
            <button type="button" className="reminder-action-snooze" onClick={() => void runAction(onSnooze, "다시 알림을 설정하지 못했습니다.")} disabled={isSubmitting}>
              30분 후 다시 알림
            </button>
          </div>
          <button
            type="button"
            className="reminder-review-more-toggle"
            onClick={() => {
              if (submittingRef.current) return;
              setIsMoreOpen((open) => !open);
              setIsPostponeOpen(false);
            }}
            disabled={isSubmitting}
            aria-expanded={isMoreOpen}
            aria-controls="reminder-more-options"
          >
            추가 작업 <span aria-hidden="true">{isMoreOpen ? "▴" : "▾"}</span>
          </button>
          {isMoreOpen ? (
            <div id="reminder-more-options" className="reminder-more-options" role="group" aria-label="선택 일정 추가 작업">
              <div className="reminder-review-secondary-actions">
                <button type="button" className="reminder-action-cancel" onClick={() => void runAction(() => onStatusChange("CANCELED"), "일정을 취소하지 못했습니다.")} disabled={isSubmitting}>
                  일정 취소
                </button>
                <button
                  type="button"
                  className="reminder-action-postpone"
                  onClick={() => !submittingRef.current && setIsPostponeOpen((open) => !open)}
                  disabled={isSubmitting}
                  aria-expanded={isPostponeOpen}
                  aria-controls="reminder-postpone-options"
                >
                  일정 날짜 변경 <span aria-hidden="true">{isPostponeOpen ? "▴" : "▾"}</span>
                </button>
              </div>
              {isPostponeOpen ? (
                <div id="reminder-postpone-options" className="reminder-postpone-options" role="group" aria-label="일정 날짜 변경 기간">
                  <p>일정의 시작·종료 날짜를 함께 옮깁니다.</p>
                  <div>
                    <button type="button" onClick={() => void runAction(() => onPostpone(1), "일정을 연기하지 못했습니다.")} disabled={isSubmitting}>내일로 연기</button>
                    <button type="button" onClick={() => void runAction(() => onPostpone(3), "일정을 연기하지 못했습니다.")} disabled={isSubmitting}>3일 뒤로 연기</button>
                    <button type="button" onClick={() => void runAction(() => onPostpone(7), "일정을 연기하지 못했습니다.")} disabled={isSubmitting}>일주일 뒤로 연기</button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {hasMultipleTasks ? (
          <div className="reminder-review-list" aria-label="확인할 일정 알림 목록">
            {groups.filter((group) => group.tasks.length > 0).map((group) => (
              <section key={group.id} className="reminder-review-group" aria-labelledby={`reminder-group-${group.id}`}>
                <h3 id={`reminder-group-${group.id}`} className={`reminder-review-group-title${group.id === "soon" ? " is-soon" : ""}`}>
                  {group.label} · {group.tasks.length}건
                </h3>
                {group.tasks.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`reminder-review-row${item.id === task.id ? " is-selected" : ""}`}
                    data-reminder-task-id={item.id}
                    aria-pressed={item.id === task.id}
                    onClick={() => selectTask(item.id)}
                    disabled={isSubmitting}
                  >
                    <span className="reminder-review-row-main">
                      <span className="reminder-review-row-title">{item.title}</span>
                      <span className="reminder-review-row-meta">{formatTaskTime(item, timeFormat)} · {projects.find((entry) => entry.id === item.projectId)?.name ?? "일반"}</span>
                    </span>
                    <span className={`reminder-review-relative${group.id === "soon" ? " is-soon" : " is-past"}`}>{getRelativeTime(item, now)}</span>
                  </button>
                ))}
              </section>
            ))}
          </div>
        ) : null}

        <footer className="reminder-review-footer">
          <button type="button" className="reminder-review-text-action" onClick={() => runImmediateAction(onAcknowledge)} disabled={isSubmitting}>
            알림만 확인
          </button>
          {hasMultipleTasks ? (
            <button type="button" className="reminder-review-text-action" onClick={() => runImmediateAction(onAcknowledgeAll)} disabled={isSubmitting}>
              전체 알림 확인
            </button>
          ) : null}
        </footer>
      </section>
    </ModalBackdrop>
  );
}
