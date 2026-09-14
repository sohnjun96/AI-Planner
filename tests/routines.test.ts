import assert from "node:assert/strict";
import type { Routine, RoutineOccurrence } from "../src/models";
import { getRoutineCycle, validateRoutine } from "../src/utils/routines";
import { parseAndSanitizeImportPayload } from "../src/utils/importBackup";

const routine: Routine = { id: "r-test", title: "영수증 취합", content: "", projectId: "p-test", taskTypeId: "t-test",
  intervalMonths: 1, startMonth: "2026-01", dayOfMonth: 25, time: "09:00", leadDays: 7, mode: "schedule", isActive: true,
  createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };
assert.equal(getRoutineCycle(routine, [], "2026-09-18").dueDate, "2026-09-25");
assert.equal(getRoutineCycle(routine, [], "2026-09-18").needsAttention, true);
assert.equal(getRoutineCycle({ ...routine, startMonth: "2026-09" }, [], "2026-09-17").needsAttention, false);
assert.equal(getRoutineCycle({ ...routine, dayOfMonth: 31 }, [], "2026-02-25").dueDate, "2026-02-28");
assert.equal(getRoutineCycle({ ...routine, dayOfMonth: 31 }, [], "2026-03-25").dueDate, "2026-03-31");
assert.equal(getRoutineCycle({ ...routine, startMonth: "2024-02", intervalMonths: 12, dayOfMonth: 29 }, [], "2025-02-25").dueDate, "2025-02-28");
assert.equal(getRoutineCycle({ ...routine, intervalMonths: 3 }, [], "2026-09-01").period, "2026-07");
assert.equal(getRoutineCycle({ ...routine, isActive: false }, [], "2026-09-18").needsAttention, false);
const handled: RoutineOccurrence = { id: "r-test:2026-09", routineId: "r-test", period: "2026-09", dueDate: "2026-09-25", status: "created", taskId: "task-removed", updatedAt: routine.updatedAt };
assert.equal(getRoutineCycle(routine, [handled], "2026-09-18").period, "2026-10");
assert.equal(getRoutineCycle(routine, [{ ...handled, status: "skipped" }], "2026-09-18").needsAttention, false);
assert.equal(getRoutineCycle(routine, [{ ...handled, status: "snoozed", snoozedUntil: "2026-09-21" }], "2026-09-20").needsAttention, false);
assert.equal(getRoutineCycle(routine, [{ ...handled, status: "snoozed", snoozedUntil: "2026-09-21" }], "2026-09-21").needsAttention, true);
assert.equal(getRoutineCycle(routine, [], "2028-09-18").period, "2028-09", "오래 접속하지 않은 경우 최신 회차만 제안");
assert.equal(getRoutineCycle({ ...routine, startMonth: "2027-01" }, [], "2026-09-18").period, "2027-01");
assert.throws(() => validateRoutine({ ...routine, intervalMonths: 0 }));
assert.throws(() => validateRoutine({ ...routine, dayOfMonth: 32 }));
assert.throws(() => validateRoutine({ ...routine, startMonth: "2026-13" }));
const raw = { version: 6, exportedAt: routine.createdAt, tasks: [], projects: [{ id: "p-test", name: "일반", color: "#123456", isActive: true, createdAt: routine.createdAt, updatedAt: routine.updatedAt }],
  taskTypes: [{ id: "t-test", name: "기타", color: "#123456", isActive: true, isDefault: false, order: 1, createdAt: routine.createdAt, updatedAt: routine.updatedAt }],
  memos: [], notes: [], settings: [], userContexts: [], routines: [routine], routineOccurrences: [handled] };
assert.equal(parseAndSanitizeImportPayload(JSON.stringify(raw)).routines.length, 1);
assert.equal(parseAndSanitizeImportPayload(JSON.stringify(raw)).routineOccurrences[0].taskId, "task-removed");
assert.throws(() => parseAndSanitizeImportPayload(JSON.stringify({ ...raw, routineOccurrences: [{ ...handled, routineId: "missing" }] })));
assert.throws(() => parseAndSanitizeImportPayload(JSON.stringify({ ...raw, routines: [{ ...routine, leadDays: 40 }] })));
assert.equal(parseAndSanitizeImportPayload(JSON.stringify({ ...raw, version: 5, routines: undefined, routineOccurrences: undefined })).routines.length, 0);
process.stdout.write("Routine calendar and backup checks passed.\n");
