import { db } from "../src/db";
import { deleteTasksWithLinks, restoreDeletedTasks, deleteEmptyProject } from "../src/utils/taskLifecycle";
import { backupDb, readStoredAutoBackups, storeAutoBackup } from "../src/utils/autoBackupStore";
import type { Note, Project, Task, TaskType } from "../src/models";
import { createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { AppDataProvider, useAppData } from "../src/context/AppDataContext";

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
  root.unmount();
  host.remove();
  return "Data lifecycle browser checks passed.";
}
