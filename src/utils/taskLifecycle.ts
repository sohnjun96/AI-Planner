import { db } from "../db";
import { DEFAULT_PROJECT_IDS } from "../constants";
import type { NoteTaskLink, Task } from "../models";

export interface DeletedTasks { tasks: Task[]; links: NoteTaskLink[] }

export async function deleteTasksWithLinks(ids: string[]): Promise<DeletedTasks> {
  return db.transaction("rw", [db.tasks, db.notes, db.noteTaskLinks], async () => {
    const idSet = new Set(ids);
    const tasks = (await db.tasks.bulkGet(ids)).filter((task): task is Task => Boolean(task));
    const links = await db.noteTaskLinks.where("taskId").anyOf(ids).toArray();
    await db.notes.filter((note) => note.linkedTaskIds.some((id) => idSet.has(id))).modify((note) => {
      note.linkedTaskIds = note.linkedTaskIds.filter((id) => !idSet.has(id));
    });
    await db.noteTaskLinks.where("taskId").anyOf(ids).delete();
    await db.tasks.bulkDelete(ids);
    return { tasks, links };
  });
}

export async function restoreDeletedTasks(snapshot: DeletedTasks): Promise<void> {
  await db.transaction("rw", [db.tasks, db.notes, db.noteTaskLinks, db.projects, db.taskTypes], async () => {
    for (const task of snapshot.tasks) {
      if (!(await db.projects.get(task.projectId)) || !(await db.taskTypes.get(task.taskTypeId))) {
        throw new Error("원래 프로젝트 또는 일정 종류가 삭제되어 복원할 수 없습니다.");
      }
      const ids = new Set([
        ...(task.linkedNoteIds ?? []),
        ...snapshot.links.filter((link) => link.taskId === task.id).map((link) => link.noteId),
      ]);
      const linkedNoteIds: string[] = [];
      for (const noteId of ids) {
        const note = await db.notes.get(noteId);
        if (!note) continue;
        linkedNoteIds.push(noteId);
        if (!note.linkedTaskIds.includes(task.id)) {
          await db.notes.update(noteId, { linkedTaskIds: [...note.linkedTaskIds, task.id] });
        }
        const link = snapshot.links.find((item) => item.taskId === task.id && item.noteId === noteId);
        await db.noteTaskLinks.put(link ?? {
          id: `notelink:${crypto.randomUUID()}`, noteId, taskId: task.id,
          source: "manual", createdAt: new Date().toISOString(),
        });
      }
      await db.tasks.put({ ...task, linkedNoteIds });
    }
  });
}

export async function deleteEmptyProject(id: string): Promise<void> {
  if (DEFAULT_PROJECT_IDS.includes(id)) throw new Error("기본 프로젝트는 삭제할 수 없습니다.");
  await db.transaction("rw", [db.projects, db.tasks, db.notes, db.projectSubcategories, db.userContexts], async () => {
    const counts = await Promise.all([
      db.tasks.where("projectId").equals(id).count(),
      db.notes.where("projectId").equals(id).count(),
      db.projectSubcategories.where("projectId").equals(id).count(),
      db.userContexts.filter((context) => context.rules.some((rule) => rule.projectId === id)).count(),
    ]);
    if (counts.some(Boolean)) {
      throw new Error(`일정 ${counts[0]}개, 노트 ${counts[1]}개, 세부 항목 ${counts[2]}개, AI 규칙 설정 ${counts[3]}개가 연결되어 삭제할 수 없습니다. 먼저 이동하거나 정리해 주세요.`);
    }
    await db.projects.delete(id);
  });
}
