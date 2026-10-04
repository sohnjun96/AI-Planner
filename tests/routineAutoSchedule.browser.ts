import { db } from "../src/db";
import type { Routine } from "../src/models";
import { actOnRoutine, createAutomaticRoutineTask, routineTaskDraft } from "../src/utils/routineStore";
import { createDefaultRoutineRule, getRoutineCycle } from "../src/utils/routines";

export async function runTests() {
  let passed = 0;
  const check = (value: unknown, label: string) => { if (!value) throw new Error(label); passed += 1; };
  const now = new Date().toISOString();
  const base: Routine = { id: "auto-base", title: "자동 정산", content: "영수증 확인", projectId: "auto-project", taskTypeId: "auto-type",
    recurrence: createDefaultRoutineRule("2026-10-01"), time: "14:30", leadDays: 0, mode: "auto", isActive: true, createdAt: now, updatedAt: now };
  await db.projects.put({ id: base.projectId, name: "검증 프로젝트", color: "#123456", isActive: true, createdAt: now, updatedAt: now });
  await db.taskTypes.put({ id: base.taskTypeId, name: "검증 종류", color: "#123456", isActive: true, isDefault: false, order: 0, createdAt: now, updatedAt: now });
  const put = async (id: string, changes: Partial<Routine> = {}) => {
    const routine = { ...base, id, ...changes }; await db.routines.put(routine); return routine;
  };
  const cycle = async (routine: Routine) => getRoutineCycle(routine, await db.routineOccurrences.where("routineId").equals(routine.id).toArray());
  const create = async (routine: Routine) => createAutomaticRoutineTask(routine.id, (await cycle(routine)).id);

  const concurrent = await put("auto-concurrent");
  const concurrentCycle = await cycle(concurrent);
  const ids = await Promise.all(Array.from({ length: 4 }, () => createAutomaticRoutineTask(concurrent.id, concurrentCycle.id)));
  check(ids.filter(Boolean).length === 1, "동시 실행은 한 번만 생성");
  const record = await db.routineOccurrences.get(concurrentCycle.id);
  check(record?.status === "created" && record.taskId === ids.find(Boolean), "생성 일정과 처리 이력 연결");
  const task = await db.tasks.get(record!.taskId!);
  check(task?.title === concurrent.title && task.content === concurrent.content && task.projectId === concurrent.projectId && task.taskTypeId === concurrent.taskTypeId,
    "자동 생성 일정의 내용과 분류 유지");
  check(task?.startAt === "2026-10-01T05:30:00.000Z" && task.status === "NOT_DONE" && task.recurrencePattern === "NONE", "예정일·시간과 미완료 상태 적용");
  check(await createAutomaticRoutineTask(concurrent.id, concurrentCycle.id) === undefined, "처리된 회차는 재생성하지 않음");
  await db.tasks.delete(record!.taskId!);
  check(await createAutomaticRoutineTask(concurrent.id, concurrentCycle.id) === undefined, "생성 일정 삭제 후에도 회차 중복 방지");

  for (const [id, changes] of [
    ["manual", { mode: "schedule" }], ["remind", { mode: "remind" }], ["paused", { isActive: false }],
    ["future", { recurrence: { ...base.recurrence!, monthDays: [25] }, leadDays: 7 }],
  ] as Array<[string, Partial<Routine>]>) {
    const routine = await put(id, changes);
    check(await create(routine) === undefined, `${id} 루틴은 자동 생성하지 않음`);
    check(await db.routineOccurrences.where("routineId").equals(id).count() === 0, `${id} 처리 이력을 쓰지 않음`);
  }
  check(await createAutomaticRoutineTask("deleted", "deleted:2026-10-01") === undefined, "삭제된 루틴은 생성하지 않음");

  const lead = await put("lead", { recurrence: { ...base.recurrence!, monthDays: [8] }, leadDays: 7 });
  const leadTask = await create(lead);
  check((await db.tasks.get(leadTask!))?.startAt === "2026-10-08T05:30:00.000Z", "미리 알림일에 미래 예정일의 일정을 생성");
  const recent = await put("recent", { recurrence: { ...base.recurrence!, startDate: "2026-07-01", monthDays: [25] } });
  const recentTask = await create(recent);
  check((await db.tasks.get(recentTask!))?.startAt === "2026-09-25T05:30:00.000Z", "장기 미접속 후 최근 실제 회차만 생성");
  check(await create(recent) === undefined, "더 오래된 누락 회차를 다시 생성하지 않음");

  const finite = await put("finite", { recurrence: { ...base.recurrence!, end: { type: "count", count: 1 } } });
  await create(finite);
  check((await cycle(finite)).ended, "유한 반복의 마지막 자동 생성 후 종료");
  const edited = await put("edited");
  const staleCycle = await cycle(edited);
  await db.routines.put({ ...edited, title: "변경된 제목", time: "16:00", updatedAt: "2026-10-01T03:00:01.000Z" });
  const editedTask = await createAutomaticRoutineTask(edited.id, staleCycle.id);
  check((await db.tasks.get(editedTask!))?.title === "변경된 제목" && (await db.tasks.get(editedTask!))?.startAt === "2026-10-01T07:00:00.000Z", "저장된 최신 루틴을 사용");
  const changed = await put("changed");
  const oldCycle = await cycle(changed);
  await db.routines.put({ ...changed, recurrence: { ...base.recurrence!, monthDays: [25] } });
  check(await createAutomaticRoutineTask(changed.id, oldCycle.id) === undefined, "예정일이 변경된 오래된 자동 실행 무시");

  const deferred = await put("deferred");
  await db.routineOccurrences.put({ id: "deferred:2026-10-01", routineId: deferred.id, period: "2026-10-01", dueDate: "2026-10-01", status: "snoozed", snoozedUntil: "2026-10-02", updatedAt: now });
  check(await createAutomaticRoutineTask(deferred.id, "deferred:2026-10-01") === undefined, "아직 미뤄진 회차는 자동 생성하지 않음");
  const race = await put("manual-race", { title: "수동·자동 동시 생성" });
  const raceCycle = await cycle(race);
  await Promise.allSettled([createAutomaticRoutineTask(race.id, raceCycle.id), actOnRoutine(race, raceCycle.id, "created", routineTaskDraft(race, raceCycle.dueDate))]);
  check(await db.routineOccurrences.where("routineId").equals(race.id).count() === 1, "수동·자동 경합에서도 이력은 한 건");
  check(await db.tasks.filter(item => item.title === race.title).count() === 1, "수동·자동 경합에서도 일정은 한 건");

  const broken = await put("broken", { projectId: "missing-project" });
  const beforeTasks = await db.tasks.count();
  let failed = false;
  try { await create(broken); } catch { failed = true; }
  check(failed && await db.tasks.count() === beforeTasks && await db.routineOccurrences.where("routineId").equals(broken.id).count() === 0, "분류 오류 시 일정·이력 모두 미저장");
  const daily = await put("daily-lead", { recurrence: { ...base.recurrence!, frequency: "daily" }, leadDays: 2 });
  for (let index = 0; index < 3; index += 1) check(Boolean(await create(daily)), "미리 알림 범위의 매일 회차 생성");
  check(await create(daily) === undefined, "미리 알림 범위 밖의 매일 회차 생성 중단");
  check(await db.routineOccurrences.where("routineId").equals(daily.id).count() === 3, "미리 알림 회차 수 정확");
  return `Routine automatic creation: ${passed} transaction, concurrency, timing, edit, pause, end and atomic failure checks passed.`;
}
