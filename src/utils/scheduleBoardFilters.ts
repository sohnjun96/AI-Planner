import type { Project, Task, TaskType } from "../models";

export interface ScheduleBoardFilters {
  taskTypeIds: string[];
  projectIds: string[];
  keyword: string;
}

export function createEmptyScheduleBoardFilters(): ScheduleBoardFilters {
  return { taskTypeIds: [], projectIds: [], keyword: "" };
}

export function getActiveScheduleBoardFilterCount(filters: ScheduleBoardFilters): number {
  return Number(filters.taskTypeIds.length > 0) + Number(filters.projectIds.length > 0) + Number(filters.keyword.trim().length > 0);
}

export function filterScheduleBoardTasks(
  tasks: Task[],
  filters: ScheduleBoardFilters,
  projectMap: Record<string, Project | undefined>,
  typeMap: Record<string, TaskType | undefined>,
): Task[] {
  const typeIds = new Set(filters.taskTypeIds);
  const projectIds = new Set(filters.projectIds);
  const keyword = filters.keyword.trim().toLowerCase();

  return tasks.filter((task) => {
    if (typeIds.size > 0 && !typeIds.has(task.taskTypeId)) return false;
    if (projectIds.size > 0 && !projectIds.has(task.projectId)) return false;
    if (!keyword) return true;
    return [task.title, task.content, projectMap[task.projectId]?.name ?? "", typeMap[task.taskTypeId]?.name ?? ""]
      .some((value) => value.toLowerCase().includes(keyword));
  });
}
