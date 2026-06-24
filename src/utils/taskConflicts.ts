import type { Task } from "../models";

interface TimeRange {
  start: number;
  end: number;
}

function toTimedRange(startAt: string, endAt?: string): TimeRange | null {
  if (!endAt) {
    return null;
  }

  const start = new Date(startAt).getTime();
  const endRaw = new Date(endAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(endRaw)) {
    return null;
  }

  return {
    start,
    end: Math.max(start, endRaw),
  };
}

function overlaps(a: TimeRange, b: TimeRange): boolean {
  return a.start <= b.end && b.start <= a.end;
}

export function buildTaskConflictMap(tasks: Task[]): Record<string, string[]> {
  const activeTasks = tasks.filter((task) => task.status !== "DONE");
  const conflictMap: Record<string, Set<string>> = {};
  const timedTasks = activeTasks
    .map((task) => ({
      task,
      range: toTimedRange(task.startAt, task.endAt),
    }))
    .filter((entry): entry is { task: Task; range: TimeRange } => entry.range !== null);

  for (const task of activeTasks) {
    conflictMap[task.id] = new Set<string>();
  }

  for (let i = 0; i < timedTasks.length; i += 1) {
    const { task: a, range: rangeA } = timedTasks[i];

    for (let j = i + 1; j < timedTasks.length; j += 1) {
      const { task: b, range: rangeB } = timedTasks[j];

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
  const targetRange = toTimedRange(rangeStartAt, rangeEndAt);
  if (!targetRange) {
    return [];
  }

  return tasks
    .filter((task) => task.status !== "DONE")
    .filter((task) => task.id !== excludeTaskId)
    .filter((task) => {
      const taskRange = toTimedRange(task.startAt, task.endAt);
      return taskRange ? overlaps(targetRange, taskRange) : false;
    })
    .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
}
