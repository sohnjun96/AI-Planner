import assert from "node:assert/strict";
import type { Project, Task, TaskType } from "../src/models";
import {
  createEmptyScheduleBoardFilters,
  filterScheduleBoardTasks,
  getActiveScheduleBoardFilterCount,
  type ScheduleBoardFilters,
} from "../src/utils/scheduleBoardFilters";

const timestamp = "2026-10-01T00:00:00.000Z";
const projects: Record<string, Project> = {
  work: { id: "work", name: "업무 Alpha", color: "#123456", isActive: true, createdAt: timestamp, updatedAt: timestamp },
  personal: { id: "personal", name: "개인", color: "#123456", isActive: false, createdAt: timestamp, updatedAt: timestamp },
};
const types: Record<string, TaskType> = {
  meeting: { id: "meeting", name: "회의", color: "#123456", isActive: true, isDefault: true, order: 0, createdAt: timestamp, updatedAt: timestamp },
  leave: { id: "leave", name: "연가", color: "#123456", isActive: false, isDefault: false, order: 1, createdAt: timestamp, updatedAt: timestamp },
};
function task(id: string, patch: Partial<Task> = {}): Task {
  return { id, title: id, content: "", projectId: "work", taskTypeId: "meeting", status: "NOT_DONE", startAt: timestamp, isMajor: false, createdAt: timestamp, updatedAt: timestamp, ...patch };
}
const tasks = [
  task("work-meeting", { title: "Review <report>", content: "예산 검토" }),
  task("personal-meeting", { projectId: "personal", status: "DONE" }),
  task("personal-leave", { projectId: "personal", taskTypeId: "leave", status: "ON_HOLD" }),
  task("work-leave", { taskTypeId: "leave", status: "CANCELED" }),
  task("missing-references", { projectId: "deleted-project", taskTypeId: "deleted-type" }),
];
const snapshot = JSON.stringify({ tasks, projects, types });
const empty = createEmptyScheduleBoardFilters();
const ids = (patch: Partial<ScheduleBoardFilters>) => filterScheduleBoardTasks(tasks, { ...empty, ...patch }, projects, types).map((item) => item.id);

assert.deepEqual(ids({}), tasks.map((item) => item.id), "no selected category means all, including missing references and every status");
assert.deepEqual(ids({ keyword: "   " }), tasks.map((item) => item.id));
assert.deepEqual(ids({ taskTypeIds: ["meeting", "leave"], projectIds: ["personal"] }), ["personal-meeting", "personal-leave"]);
assert.deepEqual(ids({ taskTypeIds: ["leave"], projectIds: ["work", "personal"] }), ["personal-leave", "work-leave"]);
assert.deepEqual(ids({ taskTypeIds: ["meeting"], projectIds: ["work"], keyword: "  REVIEW  " }), ["work-meeting"]);
assert.deepEqual(ids({ keyword: "예산" }), ["work-meeting"], "content is searchable");
assert.deepEqual(ids({ keyword: "alpha" }), ["work-meeting", "work-leave"], "project names are searchable without case sensitivity");
assert.deepEqual(ids({ keyword: "연가" }), ["personal-leave", "work-leave"], "inactive type names remain searchable");
assert.deepEqual(ids({ keyword: "<report>" }), ["work-meeting"], "search uses literal text");
assert.deepEqual(ids({ projectIds: ["personal"], keyword: "alpha" }), [], "keyword must match in addition to categories");
assert.deepEqual(ids({ taskTypeIds: ["missing-type"] }), [], "unavailable category does not silently widen results");
assert.deepEqual(ids({ projectIds: ["deleted-project"] }), ["missing-references"]);
assert.equal(getActiveScheduleBoardFilterCount(empty), 0);
assert.equal(getActiveScheduleBoardFilterCount({ taskTypeIds: ["meeting", "leave"], projectIds: ["personal"], keyword: "  " }), 2);
assert.equal(getActiveScheduleBoardFilterCount({ ...empty, keyword: "review" }), 1);
assert.equal(JSON.stringify({ tasks, projects, types }), snapshot, "filtering must not change stored records or their order");
const nextEmpty = createEmptyScheduleBoardFilters();
nextEmpty.taskTypeIds.push("leave");
assert.deepEqual(empty.taskTypeIds, [], "reset creates independent selections");

console.info("일정 보드 필터 검증 통과");
