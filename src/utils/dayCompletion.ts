import type { Task } from "../models";
import { getDateKey } from "./date";
import { isTaskActive, isTaskCanceled, isTaskDone } from "./taskStatus";

export function shouldCelebrateAllTodayTasksCompleted(
  previousTasks: Task[],
  currentTasks: Task[],
  todayKey: string,
): boolean {
  const previousTodayTasks = previousTasks.filter(
    (task) => getDateKey(task.startAt) === todayKey && !isTaskCanceled(task.status),
  );
  const currentTodayTasks = currentTasks.filter(
    (task) => getDateKey(task.startAt) === todayKey && !isTaskCanceled(task.status),
  );

  if (currentTodayTasks.length === 0 || !previousTodayTasks.some((task) => isTaskActive(task.status))) {
    return false;
  }
  if (currentTodayTasks.some((task) => isTaskActive(task.status))) {
    return false;
  }

  const previousStatusById = new Map(previousTodayTasks.map((task) => [task.id, task.status]));
  return currentTodayTasks.some(
    (task) => isTaskDone(task.status) && isTaskActive(previousStatusById.get(task.id) ?? task.status),
  );
}
