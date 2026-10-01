import assert from "node:assert/strict";
import type { Task, TaskType } from "../src/models";
import { formatDashboardTaskTime, getDashboardScheduleSummary } from "../src/utils/dashboardSummary";

const todayKey = "2026-10-01";
function localIso(month: number, day: number, hour: number, minute = 0, year = 2026): string {
  return new Date(year, month - 1, day, hour, minute).toISOString();
}
const createdAt = localIso(9, 1, 9);
function task(id: string, startAt: string, patch: Partial<Task> = {}): Task {
  return { id, title: id, content: "", projectId: "test-project", taskTypeId: "type-meeting",
    status: "NOT_DONE", startAt, isMajor: false, createdAt, updatedAt: createdAt, ...patch };
}
function taskType(id: string, name: string): TaskType {
  return { id, name, color: "#123456", isDefault: false, isActive: true, order: 0, createdAt, updatedAt: createdAt };
}
const typeMap = {
  "type-meeting": taskType("type-meeting", "회의"),
  "type-submit": taskType("type-submit", "제출"),
  "type-submit-spaces": taskType("type-submit-spaces", "  제출  "),
  "type-submit-related": taskType("type-submit-related", "자료 제출"),
};
const trip = task("multi-day", localIso(9, 30, 16), { endAt: localIso(10, 2, 10) });
const heldSubmission = task("today-held-submit", localIso(10, 1, 10), { status: "ON_HOLD", taskTypeId: "type-submit" });
const submission = task("today-submit", localIso(10, 1, 14), { taskTypeId: "type-submit" });

// Deliberately mixed dates, statuses and input order: the two panels must not inherit board filters or status ranking.
const tasks = [
  task("future-held", localIso(11, 1, 9), { status: "ON_HOLD" }),
  submission,
  task("today-done", localIso(10, 1, 9), { status: "DONE" }),
  task("past-submit", localIso(9, 9, 18), { taskTypeId: "type-submit" }),
  task("today-canceled-submit", localIso(10, 1, 8), { status: "CANCELED", taskTypeId: "type-submit" }),
  task("today-related-submit", localIso(10, 1, 16), { taskTypeId: "type-submit-related" }),
  heldSubmission,
  task("today-title-only", localIso(10, 1, 11), { title: "제출" }),
  task("future-submit", localIso(11, 2, 18), { taskTypeId: "type-submit" }),
  trip,
  task("today-missing-type", localIso(10, 1, 12), { taskTypeId: "missing-type" }),
  task("past-held", localIso(9, 8, 9), { status: "ON_HOLD" }),
  task("today-done-submit", localIso(10, 1, 8, 30), { status: "DONE", taskTypeId: "type-submit" }),
  task("today-trimmed-submit", localIso(10, 1, 15), { taskTypeId: "type-submit-spaces" }),
];
const snapshot = JSON.stringify(tasks);
for (const item of tasks) Object.freeze(item);
Object.freeze(tasks);
const ids = (items: Task[]) => items.map((item) => item.id);
const summary = getDashboardScheduleSummary(tasks, typeMap, todayKey);
assert.deepEqual(ids(summary.todayTasks), [
  "multi-day", "today-done-submit", "today-done", "today-held-submit", "today-title-only",
  "today-missing-type", "today-submit", "today-trimmed-submit", "today-related-submit",
]);
assert.deepEqual(summary.counts, { pending: 6, onHold: 1, done: 2 });
assert.deepEqual(ids(summary.heldTasks), ["past-held", "today-held-submit", "future-held"]);
assert.deepEqual(ids(summary.submissionTasks), ["past-submit", "today-submit", "today-trimmed-submit", "future-submit"]);
assert.equal(summary.submissionTasks.some((item) => item.id === heldSubmission.id), false);
assert.equal(JSON.stringify(tasks), snapshot, "summary selection must not mutate shared tasks or their order");

const completed = getDashboardScheduleSummary(tasks.map((item) => item.id === submission.id
  ? { ...item, status: "DONE" as const, completedAt: localIso(10, 1, 14, 30) } : item), typeMap, todayKey);
assert.equal(completed.todayTasks.find((item) => item.id === submission.id)?.status, "DONE");
assert.equal(completed.submissionTasks.some((item) => item.id === submission.id), false);
assert.deepEqual(completed.counts, { pending: 5, onHold: 1, done: 3 });

const completedHold = getDashboardScheduleSummary(tasks.map((item) => item.id === heldSubmission.id
  ? { ...item, status: "DONE" as const } : item), typeMap, todayKey);
assert.equal(completedHold.heldTasks.some((item) => item.id === heldSubmission.id), false);
assert.equal(completedHold.todayTasks.find((item) => item.id === heldSubmission.id)?.status, "DONE");
assert.deepEqual(completedHold.counts, { pending: 6, onHold: 0, done: 3 });

const resumedHold = getDashboardScheduleSummary(tasks.map((item) => item.id === heldSubmission.id
  ? { ...item, status: "NOT_DONE" as const } : item), typeMap, todayKey);
assert.equal(resumedHold.heldTasks.some((item) => item.id === heldSubmission.id), false);
assert.deepEqual(ids(resumedHold.submissionTasks), ["past-submit", "today-held-submit", "today-submit", "today-trimmed-submit", "future-submit"]);
assert.deepEqual(resumedHold.counts, { pending: 7, onHold: 0, done: 2 });

// Changing the actual day recalculates the left panel; the undated right panels remain stable.
const tomorrow = getDashboardScheduleSummary(tasks, typeMap, "2026-10-02");
assert.deepEqual(ids(tomorrow.todayTasks), ["multi-day"]);
assert.deepEqual(tomorrow.counts, { pending: 1, onHold: 0, done: 0 });
assert.deepEqual(ids(tomorrow.heldTasks), ids(summary.heldTasks));
assert.deepEqual(ids(tomorrow.submissionTasks), ids(summary.submissionTasks));
assert.deepEqual(ids(getDashboardScheduleSummary([trip], typeMap, "2026-09-30").todayTasks), ["multi-day"]);
assert.deepEqual(getDashboardScheduleSummary([trip], typeMap, "2026-10-03").todayTasks, []);
assert.deepEqual(getDashboardScheduleSummary([], typeMap, todayKey), {
  todayTasks: [], heldTasks: [], submissionTasks: [], counts: { pending: 0, onHold: 0, done: 0 },
});
assert.equal(JSON.stringify(tasks), snapshot);

const sameDay = task("time-range", localIso(10, 1, 9), { endAt: localIso(10, 1, 10, 30) });
const sameDayTime = formatDashboardTaskTime(sameDay, todayKey, "24h");
assert.match(sameDayTime, /^09:00\s*[–-]\s*10:30$/);
assert.equal(formatDashboardTaskTime(task("point", localIso(10, 1, 18)), todayKey, "24h"), "18:00");
assert.match(formatDashboardTaskTime(sameDay, todayKey, "24h", true), /^(오늘\s+|10\.01\.\s+)09:00/);
assert.match(formatDashboardTaskTime(task("past", localIso(9, 9, 18)), todayKey, "24h", true), /09\.09\.\s+18:00/);
assert.match(formatDashboardTaskTime(trip, todayKey, "24h"), /^기간 · 09\.30\. 16:00 – 10\.02\. 10:00$/);

const newYear = task("year-range", localIso(12, 31, 22), { endAt: localIso(1, 1, 9, 0, 2027) });
const newYearTime = formatDashboardTaskTime(newYear, "2026-12-31", "24h");
assert.match(newYearTime, /^기간 · /);
assert.match(newYearTime, /12\.31\. 22:00/);
assert.match(newYearTime, /2027\.01\.01\. 09:00/);
assert.match(formatDashboardTaskTime(task("old-year", localIso(9, 9, 18, 0, 2025)), todayKey, "24h", true), /2025\.09\.09\.\s+18:00/);
const twelveHour = formatDashboardTaskTime(task("afternoon", localIso(10, 1, 13, 15), { endAt: localIso(10, 1, 14, 30) }), todayKey, "12h");
assert.match(twelveHour, /오후/);
assert.match(twelveHour, /0?1:15/);
assert.match(twelveHour, /0?2:30/);
assert.doesNotMatch(twelveHour, /13:15|14:30/);

process.stdout.write("Dashboard summary selection, shared-state transitions and time-label checks passed.\n");
