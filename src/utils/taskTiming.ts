import type { Task } from "../models";
import { getDateKey } from "./date";
import { isTaskActive } from "./taskStatus";

export function isTaskDisplayedOnDate(task: Task, dateKey: string): boolean {
  const start = new Date(task.startAt).getTime();
  if (!Number.isFinite(start)) return false;
  const startKey = getDateKey(task.startAt);
  const end = task.endAt ? new Date(task.endAt).getTime() : start;
  const endKey = Number.isFinite(end) && end >= start ? getDateKey(new Date(end)) : startKey;
  return dateKey >= startKey && dateKey <= endKey;
}

export function isTaskOverdue(task: Task, now = Date.now()): boolean {
  if (!isTaskActive(task.status)) return false;
  const end = new Date(task.endAt ?? task.startAt).getTime();
  return Number.isFinite(end) && end < now && getDateKey(new Date(end)) < getDateKey(new Date(now));
}

export function selectUpcomingAlarmTasks(tasks: Task[], beforeMinutes: number, now = Date.now(), limit = 2_000): Task[] {
  const offset = Math.max(0, Math.min(1_440, Math.floor(beforeMinutes || 0))) * 60_000;
  return tasks.filter((task) => isTaskActive(task.status) && new Date(task.startAt).getTime() - offset > now)
    .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
    .slice(0, limit);
}
