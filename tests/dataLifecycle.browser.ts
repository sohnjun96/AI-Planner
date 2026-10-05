import Dexie from "dexie";
import { db, ScheduleDB } from "../src/db";
import { deleteTasksWithLinks, restoreDeletedTasks, deleteEmptyProject } from "../src/utils/taskLifecycle";
import { backupDb, readStoredAutoBackups, storeAutoBackup } from "../src/utils/autoBackupStore";
import type { Note, NoteFormInput, NoteTaskLink, NoteVersion, Project, RoutineOccurrence, Task, TaskType } from "../src/models";
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

function noteForm(note: Note): NoteFormInput {
  return { title: note.title, content: note.content, projectId: note.projectId, subcategoryId: note.subcategoryId,
    tags: note.tags, status: note.status, isPinned: note.isPinned, sourceNoteIds: note.sourceNoteIds };
}

async function verifyNoteDataApi(api: ReturnType<typeof useAppData>, noteId: string, projectId: string, taskTypeId: string, now: string) {
  const original = (await db.notes.get(noteId))!;
  const originalVersion = (await db.noteVersions.where("noteId").equals(noteId).toArray())[0];
  const firstRevision = await api.updateNote(noteId, { ...noteForm(original), content: "첫 탭 수정" }, "manual", undefined, original.updatedAt);
  check(firstRevision && firstRevision !== original.updatedAt, "노트 저장 결과 revision 반환");
  const historyCount = await db.noteVersions.count();
  await rejects(() => api.updateNote(noteId, { ...noteForm(original), content: "오래된 탭 수정" }, "manual", undefined, original.updatedAt), "초안 기준 stale 저장 거부");
  check((await db.notes.get(noteId))?.content === "첫 탭 수정" && await db.noteVersions.count() === historyCount, "충돌 시 본문과 이력 보존");
  const parallel = await Promise.allSettled(["동시 A", "동시 B"].map((content) => api.updateNote(noteId, { ...noteForm(original), content }, "manual", undefined, firstRevision)));
  check(parallel.filter((result) => result.status === "fulfilled").length === 1, "동일 revision의 동시 저장은 하나만 성공");
  const current = (await db.notes.get(noteId))!;
  check(await api.updateNote(noteId, noteForm(current), "manual", undefined, current.updatedAt) === current.updatedAt, "변경 없는 저장은 현재 revision 반환");
  await rejects(() => api.restoreNoteVersion(noteId, originalVersion.id, original.updatedAt), "stale 버전 복원 거부");
  const restoredRevision = await api.restoreNoteVersion(noteId, originalVersion.id, current.updatedAt);
  check(restoredRevision && restoredRevision !== current.updatedAt && (await db.notes.get(noteId))?.content === original.content, "검증된 복원과 새 revision 반환");

  // At the exact per-note cap, restoring the oldest version must still work.
  await db.noteVersions.where("noteId").equals(noteId).delete();
  const checkpoints: NoteVersion[] = Array.from({ length: 100 }, (_, index) => ({ id: `checkpoint-${index}`, noteId,
    title: `버전 ${index}`, content: `이력 ${index}`, editType: "manual", createdAt: new Date(new Date(now).getTime() - 200000 + index).toISOString() }));
  await db.noteVersions.bulkAdd(checkpoints);
  const beforeRestore = (await db.notes.get(noteId))!;
  await db.projectSubcategories.add({ id: "pending-restore-sub", projectId, name: "미저장 분류", order: 0, createdAt: now, updatedAt: now });
  const pendingDraft: NoteFormInput = { ...noteForm(beforeRestore), title: "미저장 제목", content: "복원 전 미저장 본문",
    subcategoryId: "pending-restore-sub", tags: ["미저장 태그"], status: "draft", isPinned: true };
  await api.restoreNoteVersion(noteId, checkpoints[0].id, beforeRestore.updatedAt, pendingDraft);
  const oldestRestored = (await db.notes.get(noteId))!;
  check(oldestRestored.content === "이력 0" && oldestRestored.title === "버전 0" && await db.noteVersions.where("noteId").equals(noteId).count() === 100, "한도에서 dirty 초안을 보존하며 가장 오래된 버전 복원");
  check((await db.noteVersions.where("noteId").equals(noteId).toArray()).some((version) => version.editType === "manual" && version.title === pendingDraft.title && version.content === pendingDraft.content), "복원 전 미저장 초안은 수동 이력으로 보존");
  check(oldestRestored.subcategoryId === pendingDraft.subcategoryId && oldestRestored.tags[0] === "미저장 태그" && oldestRestored.status === "draft" && oldestRestored.isPinned, "복원은 미저장 초안 메타데이터 반영");
  const beforeFailedRestore = await db.noteVersions.where("noteId").equals(noteId).sortBy("createdAt");
  const failRestoreCheckpoint = (_key: unknown, version: NoteVersion) => { if (version.noteId === noteId && version.editType === "restore") throw new Error("복원 이력 저장 실패 주입"); };
  db.noteVersions.hook("creating", failRestoreCheckpoint);
  try {
    await rejects(() => api.restoreNoteVersion(noteId, beforeFailedRestore[0].id, oldestRestored.updatedAt, { ...pendingDraft, content: "실패해도 보존할 초안" }), "미저장 초안 동반 복원 실패 전파");
  } finally { db.noteVersions.hook("creating").unsubscribe(failRestoreCheckpoint); }
  check(JSON.stringify(await db.notes.get(noteId)) === JSON.stringify(oldestRestored), "복원 실패 시 본문과 메타데이터 롤백");
  check(JSON.stringify(await db.noteVersions.where("noteId").equals(noteId).sortBy("createdAt")) === JSON.stringify(beforeFailedRestore), "복원 실패 시 prune 및 미저장 초안 checkpoint 모두 롤백");

  // The global cap should rotate this note's oldest checkpoint atomically.
  const otherId = await api.createNote({ ...noteForm(original), title: "다른 노트" });
  await db.noteVersions.clear();
  await db.noteVersions.bulkAdd(Array.from({ length: 20000 }, (_, index): NoteVersion => ({
    id: `global-checkpoint-${index}`, noteId: index === 0 ? noteId : otherId, title: "한도", content: "본문", editType: "manual", createdAt: now,
  })));
  const capped = (await db.notes.get(noteId))!;
  await api.updateNote(noteId, { ...noteForm(capped), content: "전역 한도에서도 저장" }, "manual", undefined, capped.updatedAt);
  check(await db.noteVersions.count() === 20000 && (await db.notes.get(noteId))?.content === "전역 한도에서도 저장", "전역 버전 한도에서 기존 노트 저장 가능");
  await api.removeNote(otherId);

  const addedIds: string[] = [];
  for (const title of ["A", "B", "C"]) addedIds.push(await api.createNote({ ...noteForm(original), title }));
  await db.notes.update(noteId, { sortOrder: 0 });
  for (let index = 0; index < addedIds.length; index++) await db.notes.update(addedIds[index], { sortOrder: index + 1 });
  const beforeOrderRevision = (await db.notes.get(addedIds[1]))!.updatedAt;
  await api.reorderNotes([addedIds[2], addedIds[0]]);
  check((await db.notes.toArray()).sort((a, b) => (a.sortOrder ?? -1) - (b.sortOrder ?? -1)).map((note) => note.id).join() === [noteId, addedIds[2], addedIds[1], addedIds[0]].join(), "부분 목록 정렬에서 다른 노트의 전역 위치 보존");
  check((await db.notes.get(addedIds[1]))?.updatedAt === beforeOrderRevision, "정렬은 수정 시각 보존");
  await db.notes.update(addedIds[0], { isPinned: true });
  await rejects(() => api.reorderNotes([addedIds[2], addedIds[0]]), "고정 그룹 경계를 넘는 정렬 거부");
  await db.notes.update(addedIds[0], { isPinned: false });

  const sourceA = (await db.notes.get(addedIds[0]))!;
  const sourceB = (await db.notes.get(addedIds[1]))!;
  const sourceRevisions = { [sourceA.id]: sourceA.updatedAt, [sourceB.id]: sourceB.updatedAt };
  await api.updateNote(sourceA.id, { ...noteForm(sourceA), content: "AI 요청 이후 바뀐 원본" }, "manual", undefined, sourceA.updatedAt);
  const noteCount = await db.notes.count();
  await rejects(() => api.createMergedNote({ ...noteForm(original), title: "통합", content: "오래된 AI 결과" }, [sourceA.id, sourceB.id], "ai_full", "통합", sourceRevisions), "stale AI 결과의 통합 생성 거부");
  check(await db.notes.count() === noteCount && (await db.notes.get(sourceA.id))?.status === "active" && (await db.notes.get(sourceB.id))?.status === "active", "통합 충돌 시 생성과 원본 보관 모두 중단");

  const taskInput = { title: "액션", content: "", projectId, taskTypeId, status: "NOT_DONE" as const, startAt: now, isMajor: false };
  const tasksBefore = await db.tasks.count();
  const linksBefore = await db.noteTaskLinks.count();
  let linkAttempt = 0;
  const failSecondLink = (_key: unknown, link: NoteTaskLink) => { if (link.noteId === noteId && ++linkAttempt === 2) throw new Error("두 번째 연결 실패 주입"); };
  db.noteTaskLinks.hook("creating", failSecondLink);
  try { await rejects(() => api.createTasksForNote(noteId, [taskInput, { ...taskInput, title: "액션 2" }]), "일괄 일정 연결 실패 전파"); }
  finally { db.noteTaskLinks.hook("creating").unsubscribe(failSecondLink); }
  check(await db.tasks.count() === tasksBefore && await db.noteTaskLinks.count() === linksBefore && (await db.notes.get(noteId))?.linkedTaskIds.length === 0, "일괄 생성 실패 시 일정·연결·노트 모두 롤백");
  const ids = await api.createTasksForNote(noteId, [taskInput, { ...taskInput, title: "액션 2" }]);
  check(ids.length === 2 && (await db.notes.get(noteId))?.linkedTaskIds.length === 2, "액션 2개 원자적 생성 및 연결");
  check((await db.tasks.bulkGet(ids)).every((task) => task?.linkedNoteIds?.includes(noteId)), "생성 일정의 역방향 노트 연결");
  await api.undoLastChange();
  check(await db.tasks.count() === tasksBefore && (await db.notes.get(noteId))?.linkedTaskIds.length === 0, "일괄 생성 한 번의 실행 취소");
  await db.notes.update(noteId, { linkedTaskIds: Array.from({ length: 200 }, (_, index) => `limit-${index}`) });
  await rejects(() => api.createTasksForNote(noteId, [taskInput]), "200개 연결 한도에서 생성 거부");
  check(await db.tasks.count() === tasksBefore, "연결 한도 실패 시 일정도 생성하지 않음");
  await db.notes.update(noteId, { linkedTaskIds: [] });

  // Historical inconsistent reverse references must be removed on deletion.
  const orphanTask = await api.createTask(taskInput);
  await db.tasks.update(orphanTask, { linkedNoteIds: [addedIds[0]] });
  await api.removeNote(addedIds[0]);
  check((await db.tasks.get(orphanTask))?.linkedNoteIds?.length === 0, "노트 삭제가 오래된 한쪽 참조도 정리");
  await api.removeTask(orphanTask);
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
  await verifyNoteDataApi(api, noteId, projectId, taskTypeId, now);
  await api.importData(exported);
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
