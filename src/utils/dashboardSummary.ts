import type { Task, TaskType } from "../models";
import { compareByStartAtAsc, getDateKey } from "./date";
import { isTaskDisplayedOnDate } from "./taskTiming";

export function isSubmissionTask(task: Task, typeMap: Record<string, TaskType | undefined>): boolean {
  return typeMap[task.taskTypeId]?.name.trim() === "제출";
}

export function getDashboardScheduleSummary(
  tasks: Task[],
  typeMap: Record<string, TaskType | undefined>,
  todayKey: string,
) {
  const todayTasks = tasks
    .filter((task) => task.status !== "CANCELED" && isTaskDisplayedOnDate(task, todayKey))
    .sort(compareByStartAtAsc);
  return {
    todayTasks,
    heldTasks: tasks.filter((task) => task.status === "ON_HOLD").sort(compareByStartAtAsc),
    submissionTasks: tasks
      .filter((task) => task.status === "NOT_DONE" && isSubmissionTask(task, typeMap))
      .sort(compareByStartAtAsc),
    counts: {
      pending: todayTasks.filter((task) => task.status === "NOT_DONE").length,
      onHold: todayTasks.filter((task) => task.status === "ON_HOLD").length,
      done: todayTasks.filter((task) => task.status === "DONE").length,
    },
  };
}

export type DashboardScheduleSummary = ReturnType<typeof getDashboardScheduleSummary>;

export function formatDashboardTaskTime(
  task: Task,
  todayKey: string,
  timeFormat: "24h" | "12h",
  showDate = false,
): string {
  const start = new Date(task.startAt);
  if (!Number.isFinite(start.getTime())) return "일시 확인 필요";
  const end = task.endAt ? new Date(task.endAt) : null;
  const validEnd = end && Number.isFinite(end.getTime()) && end >= start ? end : null;
  const time = (date: Date) => new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit", minute: "2-digit", hour12: timeFormat === "12h",
  }).format(date);
  const dateLabel = (date: Date) => {
    const year = String(date.getFullYear());
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year !== todayKey.slice(0, 4) ? `${year}.` : ""}${month}.${day}.`;
  };
  if (validEnd && getDateKey(start) !== getDateKey(validEnd)) {
    return `기간 · ${dateLabel(start)} ${time(start)} – ${dateLabel(validEnd)} ${time(validEnd)}`;
  }
  const timeLabel = validEnd ? `${time(start)} – ${time(validEnd)}` : time(start);
  if (!showDate) return timeLabel;
  return `${getDateKey(start) === todayKey ? "오늘" : dateLabel(start)} ${timeLabel}`;
}
