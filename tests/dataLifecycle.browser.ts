import Dexie from "dexie";
import { db, ScheduleDB } from "../src/db";
import { deleteTasksWithLinks, restoreDeletedTasks, deleteEmptyProject } from "../src/utils/taskLifecycle";
import { backupDb, readStoredAutoBackups, storeAutoBackup } from "../src/utils/autoBackupStore";
import type { Note, Project, RoutineOccurrence, Task, TaskType } from "../src/models";
import { createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { AppDataProvider, useAppData } from "../src/context/AppDataContext";
import { saveRoutine, actOnRoutine, routineTaskDraft, removeRoutine } from "../src/utils/routineStore";
import { getRoutineCycle } from "../src/utils/routines";
import { addDays, getDateKey } from "../src/utils/date";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
async function rejects(fn: () => Promise<unknown>, message: string) {
  let rejected = false;
  try { await fn(); } catch { rejected = true; }
  check(rejected, message);
}

async function verifyRoutineDatabaseMigration(now: string) {
  const schema = { tasks: "id, startAt, status, projectId, taskTypeId, isMajor, updatedAt", projects: "id, name, isActive, updatedAt",
    taskTypes: "id, name, isDefault, isActive, order, updatedAt", memos: "id, date, updatedAt", settings: "id, updatedAt",
    userContexts: "id, updatedAt", notes: "id, projectId, subcategoryId, status, isPinned, updatedAt, createdAt",
    noteVersions: "id, noteId, editType, createdAt", noteTaskLinks: "id, noteId, taskId, [noteId+taskId], createdAt",
    projectSubcategories: "id, projectId, order, updatedAt", archiveInsightCaches: "id, updatedAt",
    routines: "id, updatedAt", routineOccurrences: "id, routineId, taskId, updatedAt" };
  const oldRoutine = { id: "legacy-routine", title: "기존 정산", content: "기존 내용", projectId: "legacy-project", taskTypeId: "legacy-type",
    intervalMonths: 1, startMonth: "2026-01", dayOfMonth: 15, time: "09:00", leadDays: 0, mode: "schedule", isActive: true, createdAt: now, updatedAt: now };
  const oldRecords: RoutineOccurrence[] = ["created", "skipped", "acknowledged", "snoozed"].map((status, index) => {
    const period = `2026-0${index + 6}`;
    return { id: `${oldRoutine.id}:${period}`, routineId: oldRoutine.id, period, dueDate: `${period}-25`,
      status: status as RoutineOccurrence["status"], taskId: status === "created" ? "legacy-task" : undefined,
      snoozedUntil: status === "snoozed" ? "2026-11-01" : undefined, updatedAt: now };
  });
  const name = `routine-migration-${crypto.randomUUID()}`;
  const legacy = new Dexie(name);
  legacy.version(6).stores(schema);
  const upgraded = new ScheduleDB(name);
  try {
    await legacy.table("routines").add(oldRoutine);
    await legacy.table("routineOccurrences").bulkAdd(oldRecords);
    await legacy.table("tasks").add({ id: "legacy-task", title: "이미 완료한 일정", status: "DONE", completedAt: now, updatedAt: now });
    await legacy.table("notes").add({ id: "legacy-note", title: "보존할 노트", content: "원문", updatedAt: now });
    const originalTask = await legacy.table("tasks").get("legacy-task");
    const originalNote = await legacy.table("notes").get("legacy-note");
    legacy.close();
    await upgraded.open();
    check(upgraded.verno === 7, "실제 IndexedDB v6 → v7 업그레이드");
    const migratedRoutine = await upgraded.routines.get(oldRoutine.id);
    check(migratedRoutine?.recurrence?.frequency === "monthly" && migratedRoutine.recurrence.monthDays[0] === 15, "기존 월 규칙 정규화");
    check(migratedRoutine?.startMonth === undefined && migratedRoutine?.updatedAt === now, "레거시 필드 제거와 수정 시각 보존");
    for (const original of oldRecords) {
      const migrated = await upgraded.routineOccurrences.get(`${oldRoutine.id}:${original.dueDate}`);
      check(JSON.stringify(migrated) === JSON.stringify({ ...original, id: `${oldRoutine.id}:${original.dueDate}`, period: original.dueDate }), "수정 전 예정일·상태·연결·미루기·시각 보존");
    }
    check(JSON.stringify(await upgraded.tasks.get("legacy-task")) === JSON.stringify(originalTask), "과거 완료 일정 보존");
    check(JSON.stringify(await upgraded.notes.get("legacy-note")) === JSON.stringify(originalNote), "기존 노트 보존");
  } finally {
    legacy.close(); upgraded.close(); await Dexie.delete(name);
  }

  const conflictName = `routine-migration-conflict-${crypto.randomUUID()}`;
  const conflicting = new Dexie(conflictName);
  conflicting.version(6).stores(schema);
  const conflictUpgrade = new ScheduleDB(conflictName);
  try {
    const monthRecord = oldRecords[0];
    const dateRecord = { ...monthRecord, id: `${oldRoutine.id}:${monthRecord.dueDate}`, period: monthRecord.dueDate, taskId: "other-task" };
    await conflicting.table("routines").add(oldRoutine);
    await conflicting.table("routineOccurrences").bulkAdd([monthRecord, dateRecord]);
    conflicting.close();
    await rejects(() => conflictUpgrade.open(), "같은 실제 날짜의 이력 충돌은 업그레이드 거부");
    conflictUpgrade.close();
    await conflicting.open();
    check(conflicting.verno === 6 && await conflicting.table("routineOccurrences").count() === 2, "충돌 후 원본 DB 버전과 두 처리 이력 유지");
    check((await conflicting.table("routines").get(oldRoutine.id)).recurrence === undefined, "업그레이드 실패 시 규칙 변환도 원자적으로 롤백");
    check((await conflicting.table("routineOccurrences").get(monthRecord.id)).taskId === "legacy-task"
      && (await conflicting.table("routineOccurrences").get(dateRecord.id)).taskId === "other-task", "충돌한 연결 이력을 임의로 합치지 않음");
  } finally {
    conflicting.close(); conflictUpgrade.close(); await Dexie.delete(conflictName);
  }
}

export async function runTests() {
  const now = new Date().toISOString();
  await verifyRoutineDatabaseMigration(now);
  const project: Project = { id: "test-project", name: "테스트", color: "#123456", isActive: true, createdAt: now, updatedAt: now };
  const type: TaskType = { id: "test-type", name: "회의", color: "#123456", isActive: true, isDefault: false, order: 0, createdAt: now, updatedAt: now };
  const task: Task = { id: "test-task", title: "회의", content: "", projectId: project.id, taskTypeId: type.id,
    status: "NOT_DONE", startAt: now, isMajor: false, createdAt: now, updatedAt: now, linkedNoteIds: ["test-note"] };
  const note: Note = { id: "test-note", title: "회의록", content: "내용", projectId: project.id, tags: [], status: "active",
    isPinned: false, linkedTaskIds: [task.id], createdAt: now, updatedAt: now };
  await db.projects.add(project);
  await db.taskTypes.add(type);
  await db.tasks.add(task);
  await db.notes.add(note);
  await db.noteTaskLinks.add({ id: "test-link", noteId: note.id, taskId: task.id, source: "manual", createdAt: now });
  const snapshot = await deleteTasksWithLinks([task.id]);
  check(await db.tasks.count() === 0, "일정 삭제");
  check(await db.noteTaskLinks.count() === 0, "연결 테이블 정리");
  check((await db.notes.get(note.id))?.linkedTaskIds.length === 0, "노트 참조 정리");
  await rejects(() => deleteEmptyProject(project.id), "노트만 있는 프로젝트 삭제 차단");
  // 연결을 복원하면서 노트의 새로운 편집은 보존해야 한다.
  await db.notes.update(note.id, { content: "삭제 이후 편집" });
  await restoreDeletedTasks(snapshot);
  check((await db.notes.get(note.id))?.content === "삭제 이후 편집", "노트 편집 보존");
  check((await db.notes.get(note.id))?.linkedTaskIds[0] === task.id, "노트 연결 복원");
  check((await db.tasks.get(task.id))?.linkedNoteIds?.[0] === note.id, "일정 연결 복원");
  check(await db.noteTaskLinks.count() === 1, "연결 중복 없이 복원");
  const deletedAgain = await deleteTasksWithLinks([task.id]);
  await db.notes.delete(note.id);
  await restoreDeletedTasks(deletedAgain);
  check((await db.tasks.get(task.id))?.linkedNoteIds?.length === 0, "삭제된 노트는 부활시키지 않음");
  await deleteTasksWithLinks([task.id]);
  await db.projectSubcategories.add({ id: "test-sub", projectId: project.id, name: "세부", order: 0, createdAt: now, updatedAt: now });
  await rejects(() => deleteEmptyProject(project.id), "세부 항목만 있는 프로젝트 삭제 차단");
  await db.projectSubcategories.clear();
  await deleteEmptyProject(project.id);
  check(!(await db.projects.get(project.id)), "빈 프로젝트 삭제");
  await rejects(() => restoreDeletedTasks(snapshot), "프로젝트 삭제 후 복원 차단");
  check(await db.tasks.count() === 0, "복원 실패 시 원자성 유지");

  function backupRaw(large = false) {
    return JSON.stringify({ version: 5, exportedAt: now, tasks: [], projects: [project], taskTypes: [type], memos: [],
      notes: large ? Array.from({ length: 100 }, (_, i) => ({ ...note, id: `note-${i}`, content: "a".repeat(90_000), linkedTaskIds: [] })) : [],
      settings: [], userContexts: [], noteVersions: [], noteTaskLinks: [], projectSubcategories: [], archiveInsightCaches: [] });
  }
  localStorage.setItem("schedule_auto_backups_v1", JSON.stringify([{ id: "legacy", createdAt: now, reason: "이전 백업", raw: backupRaw() }]));
  check((await readStoredAutoBackups()).length === 1, "기존 백업 이전");
  check(localStorage.getItem("schedule_auto_backups_v1") === null, "검증 후 기존 저장소 정리");
  await storeAutoBackup({ id: "large", createdAt: now, reason: "9MB 백업", raw: backupRaw(true) });
  const backups = await readStoredAutoBackups();
  check(backups.length === 2, "기존 백업 보존");
  check(JSON.parse(backups.find((entry) => entry.id === "large")!.raw).notes.length === 100, "5MB 초과 전체 백업 저장");
  await Promise.all(["concurrent-a", "concurrent-b"].map((id) => storeAutoBackup({ id, createdAt: now, reason: "동시 저장", raw: backupRaw() })));
  check((await readStoredAutoBackups()).length === 4, "동시 백업 유실 없음");
  await rejects(() => storeAutoBackup({ id: "invalid", createdAt: now, reason: "손상", raw: "bad json" }), "손상 백업 저장 실패 표시");
  check((await backupDb.entries.count()) === 4, "저장 실패 후 기존 백업 유지");
  // UI가 사용하는 Context를 거쳐 실행 취소와 백업 내보내기도 검증한다.
  let api: ReturnType<typeof useAppData> | undefined;
  let ready!: () => void;
  const initialized = new Promise<void>((resolve) => { ready = resolve; });
  function Harness() {
    const value = useAppData();
    useEffect(() => { api = value; if (value.isReady) ready(); }, [value]);
    return null;
  }
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  root.render(createElement(AppDataProvider, null, createElement(Harness)));
  await initialized;
  check(api, "Context 초기화");
  const projectId = (await db.projects.toArray())[0].id;
  const taskTypeId = (await db.taskTypes.toArray())[0].id;
  const id = await api.createTask({ title: "실행 취소 테스트", content: "", projectId, taskTypeId, status: "NOT_DONE", startAt: now, isMajor: false });
  const noteId = await api.createNote({ title: "연결", content: "", projectId, tags: [], status: "active", isPinned: false });
  await api.linkNoteToTask(noteId, id);
  await api.updateTask(id, { title: "수정 후 삭제", content: "", projectId, taskTypeId, status: "NOT_DONE", startAt: now, isMajor: false });
  await api.removeTask(id);
  await api.undoLastChange();
  check((await db.tasks.get(id))?.title === "수정 후 삭제", "삭제 실행 취소가 직전 수정과 합쳐지지 않음");
  check((await db.notes.get(noteId))?.linkedTaskIds.includes(id), "Context 삭제 취소 연결 복원");
  await api.undoLastChange();
  check((await db.tasks.get(id))?.title === "실행 취소 테스트", "수정 실행 취소");
  await api.undoLastChange();
  check(!(await db.tasks.get(id)), "생성 실행 취소");
  check((await db.notes.get(noteId))?.linkedTaskIds.length === 0, "생성 실행 취소 연결 정리");
  const exported = await api.exportData();
  check(api.inspectImportData(exported).notes === 1, "실행 취소 후 백업 참조 무결성");
  const today = getDateKey(new Date());
  await saveRoutine({ title: "영수증 취합", content: "루틴 테스트", projectId, taskTypeId,
    intervalMonths: 1, startMonth: today.slice(0, 7), dayOfMonth: Number(today.slice(-2)), time: "09:00", leadDays: 0,
    mode: "schedule", isActive: true });
  const routine = (await db.routines.toArray())[0];
  check(await db.tasks.count() === 0, "루틴 등록만으로 일정이 생성되지 않음");
  let cycle = getRoutineCycle(routine, []);
  const concurrent = await Promise.allSettled([1, 2].map(() => actOnRoutine(routine, cycle.id, "created", routineTaskDraft(routine, cycle.dueDate))));
  check(concurrent.filter((result) => result.status === "fulfilled").length === 1, "여러 탭에서 한 회차 중복 생성 방지");
  check(await db.tasks.count() === 1 && await db.routineOccurrences.count() === 1, "일정과 회차 원자적 생성");
  const routineBackup = await api.exportData();
  check(api.inspectImportData(routineBackup).routines === 1, "백업에 루틴 포함");
  await api.importData(exported);
  check(await db.routines.count() === 0, "이전 백업 복원 시 루틴 교체");
  await api.importData(routineBackup);
  check(await db.routines.count() === 1 && await db.routineOccurrences.count() === 1, "루틴과 이력 복원");
  check(!getRoutineCycle(routine, await db.routineOccurrences.toArray()).needsAttention, "복원 후 같은 회차 재제안 방지");
  const legacyRoutineBackup = JSON.parse(routineBackup);
  check(legacyRoutineBackup.version === 7, "새 루틴 백업은 v7");
  legacyRoutineBackup.version = 6;
  legacyRoutineBackup.routines = legacyRoutineBackup.routines.map((item: typeof routine) => {
    const common = { ...item };
    delete common.recurrence;
    return { ...common, intervalMonths: 1, startMonth: today.slice(0, 7), dayOfMonth: Number(today.slice(-2)) };
  });
  legacyRoutineBackup.routineOccurrences = legacyRoutineBackup.routineOccurrences.map((item: RoutineOccurrence) => ({
    ...item, id: `${item.routineId}:${item.dueDate.slice(0, 7)}`, period: item.dueDate.slice(0, 7) }));
  await api.importData(JSON.stringify(legacyRoutineBackup));
  check((await db.routines.toArray())[0].recurrence?.frequency === "monthly", "v6 가져오기에서 월 규칙 변환");
  check((await db.routineOccurrences.toArray())[0].id === `${routine.id}:${cycle.dueDate}`, "v6 가져오기에서 저장된 예정일로 회차 변환");
  check(!getRoutineCycle(routine, await db.routineOccurrences.toArray()).needsAttention, "v6 복원 직후 처리한 회차 재제안 방지");
  await rejects(() => actOnRoutine(routine, cycle.id, "created", routineTaskDraft(routine, cycle.dueDate)), "v6 복원 후 같은 회차 중복 생성 거부");
  check(await db.tasks.count() === 1, "v6 복원 후 생성 일정 중복 없음");
  await db.routineOccurrences.clear();
  cycle = getRoutineCycle(routine, []);
  await actOnRoutine(routine, cycle.id, "snoozed", undefined, getDateKey(addDays(new Date(), 1)));
  check(!getRoutineCycle(routine, await db.routineOccurrences.toArray()).needsAttention, "나중에 선택 저장");
  await db.routineOccurrences.clear();
  await actOnRoutine(routine, cycle.id, "skipped");
  check(!getRoutineCycle(routine, await db.routineOccurrences.toArray()).needsAttention, "이번 회차 건너뛰기");
  await saveRoutine({ ...routine, isActive: false }, routine);
  await rejects(() => actOnRoutine(routine, cycle.id, "created", routineTaskDraft(routine, cycle.dueDate)), "변경되거나 중지된 루틴의 오래된 초안 거부");
  await removeRoutine(routine.id);
  check(await db.routineOccurrences.count() === 0 && await db.tasks.count() === 1, "루틴 삭제 시 생성 일정 유지");
  await saveRoutine({ title: "원자성 확인", content: "", projectId, taskTypeId, intervalMonths: 1, startMonth: today.slice(0, 7),
    dayOfMonth: Number(today.slice(-2)), time: "09:00", leadDays: 0, mode: "schedule", isActive: true });
  const atomicRoutine = (await db.routines.toArray())[0];
  const atomicCycle = getRoutineCycle(atomicRoutine, []);
  const rejectOccurrence = (_key: unknown, record: RoutineOccurrence) => {
    if (record.routineId === atomicRoutine.id) throw new Error("회차 저장 실패를 주입");
  };
  db.routineOccurrences.hook("creating", rejectOccurrence);
  try {
    await rejects(() => actOnRoutine(atomicRoutine, atomicCycle.id, "created", routineTaskDraft(atomicRoutine, atomicCycle.dueDate)), "회차 저장 실패 전파");
  } finally {
    db.routineOccurrences.hook("creating").unsubscribe(rejectOccurrence);
  }
  check(await db.tasks.count() === 1 && await db.routineOccurrences.count() === 0, "회차 저장 실패 시 먼저 추가한 일정도 롤백");
  await saveRoutine({ ...atomicRoutine, title: "수정됨" }, atomicRoutine);
  await rejects(() => saveRoutine({ ...atomicRoutine, title: "오래된 편집" }, atomicRoutine), "같은 밀리초의 연속 수정도 오래된 폼 거부");
  root.unmount();
  host.remove();
  return "Data lifecycle browser checks passed.";
}
