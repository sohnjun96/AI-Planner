import { LUNCH_PROJECT_ID } from "../constants";
import type { Project, Task, TaskType } from "../models";

const LUNCH_TASK_KEYWORDS = ["점심", "중식", "lunch"];
const DEFAULT_LUNCH_DURATION_MS = 60 * 60 * 1000;

export function isLunchTask(
  task: Task,
  typeMap: Record<string, TaskType | undefined>,
  projectMap: Record<string, Project | undefined>,
): boolean {
  const taskTypeName = typeMap[task.taskTypeId]?.name ?? "";
  const projectName = projectMap[task.projectId]?.name ?? "";
  const source = `${task.title} ${task.content} ${taskTypeName} ${projectName}`.toLowerCase();
  return task.projectId === LUNCH_PROJECT_ID || LUNCH_TASK_KEYWORDS.some((keyword) => source.includes(keyword));
}

export function getLunchAutoCompleteAt(task: Task): number | null {
  const startAt = new Date(task.startAt).getTime();
  if (!Number.isFinite(startAt)) {
    return null;
  }

  const endAt = task.endAt ? new Date(task.endAt).getTime() : Number.NaN;
  return Number.isFinite(endAt) && endAt > startAt ? endAt : startAt + DEFAULT_LUNCH_DURATION_MS;
}
