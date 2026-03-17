import type { Task } from "../models";

interface TimeRange {
  start: number;
  end: number;
}

function toTimeRange(startAt: string, endAt?: string): TimeRange {
  const start = new Date(startAt).getTime();
  const endRaw = endAt ? new Date(endAt).getTime() : start;
  const end = Number.isFinite(endRaw) ? endRaw : start;
  return {
    start,
    end: Math.max(start, end),
  };
}

function overlaps(a: TimeRange, b: TimeRange): boolean {
  return a.start <= b.end && b.start <= a.end;
}

export function buildTaskConflictMap(tasks: Task[]): Record<string, string[]> {
  const activeTasks = tasks.filter((task) => task.status !== "DONE");
  const conflictMap: Record<string, Set<string>> = {};

  for (const task of activeTasks) {
    conflictMap[task.id] = new Set<string>();
  }

  for (let i = 0; i < activeTasks.length; i += 1) {
    const a = activeTasks[i];
    const rangeA = toTimeRange(a.startAt, a.endAt);

    for (let j = i + 1; j < activeTasks.length; j += 1) {
      const b = activeTasks[j];
      const rangeB = toTimeRange(b.startAt, b.endAt);

      if (!overlaps(rangeA, rangeB)) {
        continue;
      }

      conflictMap[a.id]?.add(b.id);
      conflictMap[b.id]?.add(a.id);
    }
  }

  return Object.fromEntries(
    Object.entries(conflictMap).map(([taskId, taskIdSet]) => [taskId, [...taskIdSet]]),
  );
}

export function findTaskConflictsForRange(
  tasks: Task[],
  rangeStartAt: string,
  rangeEndAt?: string,
  excludeTaskId?: string,
): Task[] {
  const targetRange = toTimeRange(rangeStartAt, rangeEndAt);

  return tasks
    .filter((task) => task.status !== "DONE")
    .filter((task) => task.id !== excludeTaskId)
    .filter((task) => overlaps(targetRange, toTimeRange(task.startAt, task.endAt)))
    .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
}
