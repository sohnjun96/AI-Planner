import { db } from "../db";
import type { Routine, RoutineInput, RoutineOccurrence, TaskFormInput } from "../models";
import { getDateKey, combineDateTimeToIso } from "./date";
import { getRoutineCycle, isCalendarDate, MAX_ROUTINES, MAX_ROUTINE_OCCURRENCES, validateRoutine } from "./routines";
import { trimTaskInput } from "./taskInput";

export async function saveRoutine(input: RoutineInput, existing?: Routine): Promise<void> {
  const normalized = validateRoutine(input);
  await db.transaction("rw", [db.routines, db.projects, db.taskTypes], async () => {
    if (!(await db.projects.get(input.projectId)) || !(await db.taskTypes.get(input.taskTypeId))) throw new Error("프로젝트 또는 종류를 찾을 수 없습니다.");
    if (existing && (await db.routines.get(existing.id))?.updatedAt !== existing.updatedAt) throw new Error("루틴이 변경되었습니다. 다시 열어 주세요.");
    if (!existing && await db.routines.count() >= MAX_ROUTINES) throw new Error("루틴은 최대 500개까지 등록할 수 있습니다.");
    const now = new Date().toISOString();
    await db.routines.put({ ...normalized, id: existing?.id ?? `routine-${crypto.randomUUID()}`, createdAt: existing?.createdAt ?? now, updatedAt: now });
  });
}

export async function removeRoutine(id: string): Promise<void> {
  await db.transaction("rw", [db.routines, db.routineOccurrences], async () => {
    await db.routineOccurrences.where("routineId").equals(id).delete();
    await db.routines.delete(id);
  });
}

export type RoutineAction = "created" | "skipped" | "acknowledged" | "snoozed";
export async function actOnRoutine(routine: Routine, cycleId: string, action: RoutineAction, input?: TaskFormInput, snoozedUntil?: string): Promise<string | undefined> {
  return db.transaction("rw", [db.routines, db.routineOccurrences, db.tasks, db.projects, db.taskTypes], async () => {
    const current = await db.routines.get(routine.id);
    if (!current || !current.isActive || current.updatedAt !== routine.updatedAt) throw new Error("루틴 설정이 바뀌었습니다. 목록에서 다시 확인해 주세요.");
    const records = await db.routineOccurrences.where("routineId").equals(routine.id).toArray();
    const cycle = getRoutineCycle(current, records);
    if (cycle.id !== cycleId || !cycle.needsAttention) throw new Error("이미 처리했거나 안내일이 바뀐 회차입니다.");
    if (!records.some((record) => record.id === cycleId) && await db.routineOccurrences.count() >= MAX_ROUTINE_OCCURRENCES) throw new Error("루틴 처리 이력 한도에 도달했습니다. 사용하지 않는 루틴을 정리해 주세요.");
    const now = new Date().toISOString();
    let taskId: string | undefined;
    if (action === "created") {
      if (!input) throw new Error("일정 내용을 확인해 주세요.");
      const task = trimTaskInput(input);
      if (!(await db.projects.get(task.projectId)) || !(await db.taskTypes.get(task.taskTypeId))) throw new Error("프로젝트 또는 종류를 찾을 수 없습니다.");
      if (await db.tasks.count() >= 20_000) throw new Error("일정 저장 한도에 도달했습니다.");
      taskId = `task-${crypto.randomUUID()}`;
      await db.tasks.add({ ...task, recurrencePattern: "NONE", id: taskId, createdAt: now, updatedAt: now,
        completedAt: task.status === "DONE" ? now : undefined, canceledAt: task.status === "CANCELED" ? now : undefined });
    }
    if (action === "snoozed" && (!snoozedUntil || !isCalendarDate(snoozedUntil) || snoozedUntil <= getDateKey(new Date()))) throw new Error("다시 안내할 날짜는 내일 이후로 선택해 주세요.");
    const record: RoutineOccurrence = { id: cycle.id, routineId: routine.id, period: cycle.period, dueDate: cycle.dueDate,
      status: action, updatedAt: now, taskId, snoozedUntil: action === "snoozed" ? snoozedUntil : undefined };
    await db.routineOccurrences.put(record);
    return taskId;
  });
}

export function routineTaskDraft(routine: Routine, dueDate: string): TaskFormInput {
  return { title: routine.title, content: routine.content, projectId: routine.projectId, taskTypeId: routine.taskTypeId,
    startAt: combineDateTimeToIso(dueDate, routine.time), status: "NOT_DONE", isMajor: false, recurrencePattern: "NONE" };
}
