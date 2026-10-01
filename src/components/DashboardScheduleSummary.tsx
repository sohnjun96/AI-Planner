import type { CSSProperties, MouseEvent } from "react";
import { STATUS_LABELS } from "../constants";
import type { Project, Task, TaskType } from "../models";
import { getDateKey } from "../utils/date";
import {
  formatDashboardTaskTime,
  type DashboardScheduleSummary as ScheduleSummary,
} from "../utils/dashboardSummary";

interface Props {
  expanded: boolean;
  summary: ScheduleSummary;
  projectMap: Record<string, Project | undefined>;
  typeMap: Record<string, TaskType | undefined>;
  todayKey: string;
  timeFormat: "24h" | "12h";
  onOpenTask: (taskId: string) => void;
  onCompleteTask: (task: Task, checked: boolean) => void;
  onContextMenu: (event: MouseEvent<HTMLElement>, task: Task) => void;
}

export function DashboardScheduleSummary({
  expanded, summary, projectMap, typeMap, todayKey, timeFormat,
  onOpenTask, onCompleteTask, onContextMenu,
}: Props) {
  const periodTasks: Task[] = [];
  const timedTasks: Task[] = [];
  for (const task of summary.todayTasks) {
    const start = new Date(task.startAt);
    const end = task.endAt ? new Date(task.endAt) : null;
    const isPeriod = end && Number.isFinite(start.getTime()) && Number.isFinite(end.getTime())
      && end >= start && getDateKey(start) !== getDateKey(end);
    (isPeriod ? periodTasks : timedTasks).push(task);
  }

  function renderTasks(items: Task[], emptyText: string, layout: "today" | "side" | "period" = "today") {
    if (items.length === 0) return <p className="dashboard-summary-empty">{emptyText}</p>;
    const side = layout === "side";
    const period = layout === "period";
    return (
      <ol className={`dashboard-summary-task-list ${period ? "dashboard-summary-period-list" : ""}`}>
        {items.map((task) => {
          const project = projectMap[task.projectId];
          const taskType = typeMap[task.taskTypeId];
          const color = project?.color ?? "#64748b";
          const style = { "--summary-project-color": color } as CSSProperties;
          const timeLabel = formatDashboardTaskTime(task, todayKey, timeFormat, side);
          const [startTime, endTime] = timeLabel.split(" – ");
          return (
            <li
              key={task.id}
              className={`dashboard-summary-task-row ${task.status.toLowerCase()} ${task.isMajor ? "major" : ""} ${side ? "side-row" : ""} ${period ? "period-row" : ""}`}
              style={style}
              onContextMenu={(event) => onContextMenu(event, task)}
            >
              <button type="button" className="dashboard-summary-task-detail" onClick={() => onOpenTask(task.id)}>
                {period ? (
                  <span className="dashboard-summary-period-icon" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="5" width="18" height="16" rx="2" />
                      <path d="M16 3v4M8 3v4M3 11h18M8 15h8" />
                    </svg>
                  </span>
                ) : !side ? (
                  <span className="dashboard-summary-task-time">
                    <span className="dashboard-summary-task-time-start">{startTime}</span>
                    {endTime ? <span className="dashboard-summary-task-time-end">– {endTime}</span> : null}
                  </span>
                ) : null}
                <span className="dashboard-summary-task-content">
                  <span className="dashboard-summary-task-title">{task.title}</span>
                  <span className="dashboard-summary-task-meta">
                    {side || period ? <><span>{timeLabel}</span><span aria-hidden="true">·</span></> : null}
                    <span className="dashboard-summary-project-dot" aria-hidden="true" />
                    <span>{project?.name ?? "프로젝트 없음"}</span>
                    {!side && !period && taskType ? <><span aria-hidden="true">·</span><span>{taskType.name}</span></> : null}
                  </span>
                </span>
                <span className="dashboard-summary-task-badges">
                  {task.status !== "NOT_DONE" ? <span className={`status-badge ${task.status.toLowerCase()}`}>{STATUS_LABELS[task.status]}</span> : null}
                  {task.isMajor ? <span className="summary-major-badge">중요</span> : null}
                </span>
              </button>
              <label className="dashboard-summary-completion">
                <input
                  type="checkbox"
                  checked={task.status === "DONE"}
                  onChange={(event) => onCompleteTask(task, event.target.checked)}
                  aria-label={`${task.title} 완료 여부`}
                />
              </label>
            </li>
          );
        })}
      </ol>
    );
  }

  return (
    <div id="dashboard-summary-panel" className="dashboard-schedule-summary" hidden={!expanded}>
      <section className="dashboard-today-schedules" aria-label="오늘 일정">
        {periodTasks.length > 0 ? renderTasks(periodTasks, "", "period") : null}
        {timedTasks.length > 0 || periodTasks.length === 0 ? renderTasks(timedTasks, "오늘 일정이 없습니다.") : null}
      </section>
      <div className="dashboard-summary-side">
        <section aria-labelledby="dashboard-held-schedules-title">
          <header className="dashboard-summary-section-header">
            <h3 id="dashboard-held-schedules-title">보류된 일정</h3>
          </header>
          {renderTasks(summary.heldTasks, "보류된 일정이 없습니다.", "side")}
        </section>
        <section aria-labelledby="dashboard-submission-schedules-title">
          <header className="dashboard-summary-section-header">
            <h3 id="dashboard-submission-schedules-title">제출 일정</h3>
          </header>
          {renderTasks(summary.submissionTasks, "미완료 제출 일정이 없습니다.", "side")}
        </section>
      </div>
    </div>
  );
}
