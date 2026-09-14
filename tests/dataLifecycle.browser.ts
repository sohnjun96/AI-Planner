import { db } from "../src/db";
import { deleteTasksWithLinks, restoreDeletedTasks, deleteEmptyProject } from "../src/utils/taskLifecycle";
import { backupDb, readStoredAutoBackups, storeAutoBackup } from "../src/utils/autoBackupStore";
import type { Note, Project, Task, TaskType } from "../src/models";
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

export async function runTests() {
  const now = new Date().toISOString();
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
  root.unmount();
  host.remove();
  return "Data lifecycle browser checks passed.";
}
