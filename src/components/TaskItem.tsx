import { useNavigate } from "react-router-dom";
import { STATUS_LABELS } from "../constants";
import type { Project, Task, TaskStatus, TaskType } from "../models";
import { formatDateTime } from "../utils/date";

interface TaskItemProps {
  task: Task;
  project?: Project;
  taskType?: TaskType;
  timeFormat: "24h" | "12h";
  selected?: boolean;
  hasConflict?: boolean;
  onClick?: () => void;
  onStatusChange?: (status: TaskStatus) => void;
}

export function TaskItem({ task, project, taskType, timeFormat, selected, hasConflict, onClick, onStatusChange }: TaskItemProps) {
  const navigate = useNavigate();

  return (
    <article
      className={`task-item ${selected ? "selected" : ""} ${onClick ? "clickable" : ""} ${hasConflict ? "conflict" : ""}`}
      style={{ borderLeftColor: project?.color ?? "#94a3b8" }}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={`${task.title} 일정 카드`}
      onKeyDown={(event) => {
        if (onClick && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onClick();
        }
      }}
    >
      <header>
        <h4>{task.title}</h4>
        <div className="badge-row">
          {hasConflict ? <span className="conflict-badge">시간 충돌</span> : null}
          <span className={`status-badge ${task.status.toLowerCase()}`}>{STATUS_LABELS[task.status]}</span>
        </div>
      </header>

      <p className="task-time">
        {formatDateTime(task.startAt, timeFormat)}
        {task.endAt ? ` - ${formatDateTime(task.endAt, timeFormat)}` : ""}
      </p>

      <div className="tag-row">
        <button
          type="button"
          className="tag project-tag project-tag-button"
          style={{ backgroundColor: `${project?.color ?? "#334155"}22`, color: project?.color ?? "#334155" }}
          onClick={(event) => {
            event.stopPropagation();
            if (project?.id) {
              navigate(`/projects?projectId=${encodeURIComponent(project.id)}`);
            } else {
              navigate("/projects");
            }
          }}
        >
          {project?.name ?? "\uD504\uB85C\uC81D\uD2B8 \uC5C6\uC74C"}
        </button>
        <span
          className="tag type-tag"
          style={{ backgroundColor: `${taskType?.color ?? "#64748b"}22`, color: taskType?.color ?? "#64748b" }}
        >
          {taskType?.name ?? "\uC885\uB958 \uC5C6\uC74C"}
        </span>
        {task.isMajor ? <span className="tag major-tag">{"\uC8FC\uC694"}</span> : null}
      </div>

      {task.content ? <p className="task-content">{task.content}</p> : null}

      {onStatusChange ? (
        <div className="button-row compact">
          <button
            type="button"
            className={`btn btn-soft ${task.status === "NOT_DONE" ? "is-active" : ""}`}
            onClick={(event) => {
              event.stopPropagation();
              onStatusChange("NOT_DONE");
            }}
            aria-pressed={task.status === "NOT_DONE"}
            aria-label="상태를 미완료로 변경"
          >
            {STATUS_LABELS.NOT_DONE}
          </button>
          <button
            type="button"
            className={`btn btn-soft ${task.status === "ON_HOLD" ? "is-active" : ""}`}
            onClick={(event) => {
              event.stopPropagation();
              onStatusChange("ON_HOLD");
            }}
            aria-pressed={task.status === "ON_HOLD"}
            aria-label="상태를 보류로 변경"
          >
            {STATUS_LABELS.ON_HOLD}
          </button>
          <button
            type="button"
            className={`btn btn-soft ${task.status === "DONE" ? "is-active" : ""}`}
            onClick={(event) => {
              event.stopPropagation();
              onStatusChange("DONE");
            }}
            aria-pressed={task.status === "DONE"}
            aria-label="상태를 완료로 변경"
          >
            {STATUS_LABELS.DONE}
          </button>
        </div>
      ) : null}
    </article>
  );
}
