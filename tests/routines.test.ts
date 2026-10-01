import assert from "node:assert/strict";
import type { Routine, RoutineOccurrence } from "../src/models";
import { createDefaultRoutineRule, getRoutineCycle, getRoutinePreview, getRoutineRule, validateRoutine } from "../src/utils/routines";
import { parseAndSanitizeImportPayload } from "../src/utils/importBackup";
import "./routineRecurrence.test";

const routine: Routine = { id: "r-test", title: "영수증 취합", content: "", projectId: "p-test", taskTypeId: "t-test",
  intervalMonths: 1, startMonth: "2026-01", dayOfMonth: 25, time: "09:00", leadDays: 7, mode: "schedule", isActive: true,
  createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };
function record(dueDate: string, status: RoutineOccurrence["status"] = "created", extra: Partial<RoutineOccurrence> = {}): RoutineOccurrence {
  return { id: `${routine.id}:${dueDate}`, routineId: routine.id, period: dueDate, dueDate, status, updatedAt: routine.updatedAt, ...extra };
}
const past = record("2026-08-25");
assert.equal(getRoutineCycle(routine, [], "2026-09-18").dueDate, "2026-08-25", "최신 실제 미처리 회차가 미래 미리 알림보다 우선");
assert.equal(getRoutineCycle(routine, [], "2026-09-18").needsAttention, true);
assert.equal(getRoutineCycle(routine, [past], "2026-09-18").dueDate, "2026-09-25");
assert.equal(getRoutineCycle(routine, [past], "2026-09-18").needsAttention, true);
assert.equal(getRoutineCycle({ ...routine, startMonth: "2026-09" }, [], "2026-09-17").needsAttention, false);
assert.equal(getRoutineCycle({ ...routine, startMonth: "2026-02", dayOfMonth: 31 }, [], "2026-02-25").dueDate, "2026-02-28");
assert.equal(getRoutinePreview({ ...routine, dayOfMonth: 31 }, [], "2026-03-25", 1)[0].dueDate, "2026-03-31");
assert.equal(getRoutinePreview({ ...routine, startMonth: "2024-02", intervalMonths: 12, dayOfMonth: 29 }, [], "2025-02-25", 1)[0].dueDate, "2025-02-28");
assert.equal(getRoutineCycle({ ...routine, intervalMonths: 3 }, [], "2026-09-01").period, "2026-07-25");
assert.equal(getRoutineCycle({ ...routine, isActive: false }, [], "2026-09-18").needsAttention, false);
const handled = record("2026-09-25", "created", { id: "r-test:2026-09", period: "2026-09", taskId: "task-removed" });
assert.equal(getRoutineCycle(routine, [past, handled], "2026-09-18").period, "2026-10-25", "legacy monthly history matches by due date");
assert.equal(getRoutineCycle(routine, [past, { ...handled, status: "skipped" }], "2026-09-18").needsAttention, false);
assert.equal(getRoutineCycle(routine, [past, { ...handled, status: "snoozed", snoozedUntil: "2026-09-21" }], "2026-09-20").needsAttention, false);
assert.equal(getRoutineCycle(routine, [{ ...handled, status: "snoozed", snoozedUntil: "2026-09-21" }], "2026-09-21").needsAttention, true);
assert.equal(getRoutineCycle(routine, [], "2028-09-18").period, "2028-08-25", "오래 접속하지 않은 경우 최신 실제 회차만 제안");
assert.equal(getRoutineCycle(routine, [record("2028-08-25")], "2028-09-18").period, "2028-09-25", "이전 미처리 회차를 다시 꺼내지 않음");
assert.equal(getRoutineCycle({ ...routine, startMonth: "2027-01" }, [], "2026-09-18").period, "2027-01-25");

const daily: Routine = { ...routine, recurrence: { ...createDefaultRoutineRule("2026-10-01"), frequency: "daily" }, leadDays: 0 };
assert.equal(getRoutineCycle(daily, [], "2026-10-01").dueDate, "2026-10-01");
assert.equal(getRoutinePreview(daily, [], "2026-10-01", 1)[0].dueDate, "2026-10-01", "preview includes today");
assert.equal(getRoutineCycle(daily, [record("2026-10-01")], "2026-10-01").needsAttention, false, "tomorrow with no lead is not due today");
const short: Routine = { ...daily, recurrence: { ...daily.recurrence!, end: { type: "count", count: 1 } } };
assert.equal(getRoutineCycle(short, [record("2026-10-01")], "2026-10-02").ended, true);
assert.equal(getRoutineCycle(short, [], "2026-10-02").dueDate, "2026-10-01", "ended rule retains latest unhandled occurrence");
assert.deepEqual(getRoutinePreview(short, [record("2026-10-01")], "2026-10-01"), []);
const ending = getRoutineCycle(short, [record("2026-10-01")], "2026-10-02");
assert.deepEqual([ending.id, ending.period, ending.dueDate, ending.notifyDate, ending.needsAttention], ["", "", "", "", false]);

const deferred = record("2026-10-01", "snoozed", { snoozedUntil: "2026-11-01" });
const waiting = getRoutineCycle(short, [deferred], "2026-10-02");
assert.equal(waiting.ended, undefined, "future explicit snooze prevents a false ended state");
assert.equal(waiting.dueDate, "2026-10-01");
assert.equal(waiting.notifyDate, "2026-11-01");
assert.equal(waiting.needsAttention, false);
assert.equal(getRoutineCycle(daily, [deferred], "2026-10-02").dueDate, "2026-10-02", "future snooze does not suppress another actual occurrence");
assert.equal(getRoutineCycle(daily, [deferred], "2026-11-01").dueDate, "2026-10-01", "matured snooze survives subsequent periods");
const edited: Routine = { ...daily, recurrence: { ...createDefaultRoutineRule("2027-01-01"), frequency: "yearly" } };
assert.equal(getRoutineCycle(edited, [deferred], "2026-11-01").dueDate, "2026-10-01", "snooze survives rule edits");
assert.equal(getRoutineCycle(daily, [deferred, record("2026-10-02", "snoozed", { snoozedUntil: "2026-10-31" })], "2026-11-01").dueDate, "2026-10-02", "matured snoozes sort by wake date before due date");
assert.equal(getRoutineCycle(daily, [record("2026-10-01", "snoozed", { snoozedUntil: "2026-10-02" }), record("2026-10-01", "created", { updatedAt: "2026-10-02T01:00:00Z" })], "2026-10-03").dueDate, "2026-10-03", "newer handled history prevents reviving old snooze");
assert.equal(getRoutinePreview(daily, [record("2026-10-01", "skipped"), record("2026-10-02", "acknowledged")], "2026-10-01", 1)[0].dueDate, "2026-10-03");
assert.equal(getRoutineCycle({ ...daily, leadDays: 30 }, [], "2026-10-02").dueDate, "2026-10-02", "actual date wins when daily reminders overlap");

assert.throws(() => validateRoutine({ ...routine, intervalMonths: 0 }));
assert.throws(() => validateRoutine({ ...routine, dayOfMonth: 32 }));
assert.throws(() => validateRoutine({ ...routine, startMonth: "2026-13" }));
const normalized = validateRoutine(routine);
assert.equal(normalized.recurrence?.startDate, "2026-01-01");
assert.deepEqual(normalized.recurrence?.monthDays, [25]);
assert.equal(Object.hasOwn(normalized, "intervalMonths"), false);
assert.equal(getRoutineRule({ ...daily, intervalMonths: 0 }).frequency, "daily", "recurrence is authoritative over legacy fields");

const raw = { version: 6, exportedAt: routine.createdAt, tasks: [], projects: [{ id: "p-test", name: "일반", color: "#123456", isActive: true, createdAt: routine.createdAt, updatedAt: routine.updatedAt }],
  taskTypes: [{ id: "t-test", name: "기타", color: "#123456", isActive: true, isDefault: false, order: 1, createdAt: routine.createdAt, updatedAt: routine.updatedAt }],
  memos: [], notes: [], settings: [], userContexts: [], routines: [routine], routineOccurrences: [handled] };
assert.equal(parseAndSanitizeImportPayload(JSON.stringify(raw)).routines.length, 1);
assert.equal(parseAndSanitizeImportPayload(JSON.stringify(raw)).routineOccurrences[0].taskId, "task-removed");
assert.throws(() => parseAndSanitizeImportPayload(JSON.stringify({ ...raw, routineOccurrences: [{ ...handled, routineId: "missing" }] })));
assert.throws(() => parseAndSanitizeImportPayload(JSON.stringify({ ...raw, routines: [{ ...routine, leadDays: 40 }] })));
assert.equal(parseAndSanitizeImportPayload(JSON.stringify({ ...raw, version: 5, routines: undefined, routineOccurrences: undefined })).routines.length, 0);
process.stdout.write("Routine selection, normalization and backup checks passed.\n");
