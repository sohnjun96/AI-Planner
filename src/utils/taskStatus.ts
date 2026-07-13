import type { Task, TaskStatus } from "../models";

export function isTaskDone(status: TaskStatus): boolean {
  return status === "DONE";
}

export function isTaskCanceled(status: TaskStatus): boolean {
  return status === "CANCELED";
}

export function isTaskActive(status: TaskStatus): boolean {
  return status === "NOT_DONE" || status === "ON_HOLD";
}

export function isTaskVisibleOnBoard(task: Task): boolean {
  return task.status === "NOT_DONE";
}
