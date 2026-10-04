import assert from "node:assert/strict";
import type { RoutineRecurrence } from "../src/models";
import { BACKUP_VERSION, parseAndSanitizeImportPayload } from "../src/utils/importBackup";

const timestamp = "2026-10-01T00:00:00.000Z";
const legacyRoutine = { id: "r-backup", title: "정산", content: "", projectId: "p-backup", taskTypeId: "t-backup",
  intervalMonths: 1, startMonth: "2026-01", dayOfMonth: 15, time: "09:00", leadDays: 0,
  mode: "schedule", isActive: true, createdAt: timestamp, updatedAt: timestamp };
const recurrence: RoutineRecurrence = { frequency: "weekly", interval: 2, startDate: "2026-10-01", weekdays: [1, 3],
  months: [], monthMode: "dates", monthDays: [], ordinal: 1, ordinalWeekdays: [], missingDate: "clamp", weekend: "none",
  excludeDates: [], end: { type: "never" } };
const legacyOccurrence = { id: "r-backup:2026-09", routineId: "r-backup", period: "2026-09", dueDate: "2026-09-25",
  status: "created", taskId: "deleted-task", updatedAt: timestamp };
const base = { version: 6, exportedAt: timestamp, tasks: [], projects: [{ id: "p-backup", name: "일반", color: "#123456", isActive: true, createdAt: timestamp, updatedAt: timestamp }],
  taskTypes: [{ id: "t-backup", name: "정산", color: "#123456", isActive: true, isDefault: false, order: 0, createdAt: timestamp, updatedAt: timestamp }],
  memos: [], notes: [], settings: [], userContexts: [], routines: [legacyRoutine], routineOccurrences: [legacyOccurrence] };
const read = (value: unknown) => parseAndSanitizeImportPayload(JSON.stringify(value));
assert.equal(BACKUP_VERSION, 7);
const migrated = read(base);
assert.equal(migrated.version, 7);
assert.equal(migrated.routines[0].recurrence?.frequency, "monthly");
assert.deepEqual(migrated.routines[0].recurrence?.monthDays, [15]);
assert.equal(migrated.routines[0].intervalMonths, undefined);
assert.equal(migrated.routineOccurrences[0].id, "r-backup:2026-09-25");
assert.equal(migrated.routineOccurrences[0].period, "2026-09-25");
assert.equal(migrated.routineOccurrences[0].dueDate, "2026-09-25", "historical due date is not recalculated from the edited rule");
assert.equal(migrated.routineOccurrences[0].taskId, "deleted-task");
assert.equal(migrated.routineOccurrences[0].updatedAt, timestamp);
const snoozed = read({ ...base, routineOccurrences: [{ ...legacyOccurrence, status: "snoozed", snoozedUntil: "2026-10-07" }] });
assert.equal(snoozed.routineOccurrences[0].snoozedUntil, "2026-10-07");
assert.equal(snoozed.routineOccurrences[0].status, "snoozed");
assert.throws(() => read({ ...base, routineOccurrences: [{ ...legacyOccurrence, id: "r-backup:2026-09-25" }] }), /회차/);
assert.throws(() => read({ ...base, routineOccurrences: [{ ...legacyOccurrence, dueDate: "2026-10-25" }] }), /날짜/);
assert.throws(() => read({ ...base, routineOccurrences: [legacyOccurrence, legacyOccurrence] }), /중복 ID/);
assert.throws(() => read({ ...base, routineOccurrences: [{ ...legacyOccurrence, status: "snoozed" }] }), /회차/);

const current = { ...base, version: 7, routines: [{ ...legacyRoutine, recurrence }], routineOccurrences: migrated.routineOccurrences };
const restored = read(current);
assert.deepEqual(restored.routines[0].recurrence, recurrence);
assert.deepEqual(restored.routineOccurrences, migrated.routineOccurrences);
assert.equal(restored.routines[0].dayOfMonth, undefined);
for (const mode of ["schedule", "remind", "auto"] as const) {
  const modePayload = read({ ...current, routines: [{ ...legacyRoutine, recurrence, mode, leadDays: 7, time: "10:30" }] });
  const roundTripped = read(modePayload);
  assert.equal(roundTripped.version, 7);
  assert.equal(roundTripped.routines[0].mode, mode, "backup round-trip preserves the selected guidance mode");
  assert.equal(roundTripped.routines[0].leadDays, 7, "automatic creation keeps the advance date setting");
  assert.equal(roundTripped.routines[0].time, "10:30", "automatic creation keeps the schedule time");
  assert.deepEqual(roundTripped.routines[0].recurrence, recurrence);
  assert.deepEqual(roundTripped.routineOccurrences, migrated.routineOccurrences, "creation history survives the mode round-trip");
}
for (const mode of [undefined, null, "", "automatic", "AUTO", true, 1]) {
  assert.throws(() => read({ ...current, routines: [{ ...legacyRoutine, recurrence, mode }] }), /routine.mode/);
}
assert.throws(() => read({ ...current, routines: [legacyRoutine] }), /반복/);
assert.throws(() => read({ ...current, routineOccurrences: [legacyOccurrence] }), /날짜|회차/);
assert.throws(() => read({ ...current, routineOccurrences: [{ ...migrated.routineOccurrences[0], period: "2026-09-24" }] }), /날짜/);
assert.throws(() => read({ ...current, routineOccurrences: [migrated.routineOccurrences[0], migrated.routineOccurrences[0]] }), /중복 ID/);
assert.throws(() => read({ ...current, routineOccurrences: [{ ...migrated.routineOccurrences[0], routineId: "missing", id: "missing:2026-09-25" }] }), /참조/);

for (const badRule of [null, [], "weekly", { ...recurrence, frequency: "workdays" }, { ...recurrence, interval: 366 },
  { ...recurrence, interval: 1.5 }, { ...recurrence, weekdays: [8] }, { ...recurrence, weekdays: Array(8).fill(1) },
  { ...recurrence, startDate: "2026-02-29" }, { ...recurrence, startDate: "2101-01-01" },
  { ...recurrence, end: { type: "count", count: 10_001 } }, { ...recurrence, end: { type: "date", date: "2026-09-01" } },
  { ...recurrence, end: { type: "never", unexpected: true } }, { ...recurrence, unexpected: true },
  { ...recurrence, excludeDates: Array(1001).fill("2026-10-02") }, { ...recurrence, excludeDates: ["2026-04-31"] }]) {
  assert.throws(() => read({ ...current, routines: [{ ...legacyRoutine, recurrence: badRule }] }));
}
const duplicateSelections = read({ ...current, routines: [{ ...legacyRoutine, recurrence: { ...recurrence, weekdays: [3, 1, 3] } }] });
assert.deepEqual(duplicateSelections.routines[0].recurrence?.weekdays, [1, 3]);
for (const version of [4, 5]) assert.equal(read({ ...base, version, routines: undefined, routineOccurrences: undefined }).routines.length, 0);
assert.throws(() => read({ ...base, version: 8 }), /지원/);

// A valid legacy key can become three characters longer when its month ID is converted.
const longRoutineId = "r".repeat(120);
const longMigrated = read({ ...base, routines: [{ ...legacyRoutine, id: longRoutineId }],
  routineOccurrences: [{ ...legacyOccurrence, routineId: longRoutineId, id: `${longRoutineId}:2026-09` }] });
assert.equal(longMigrated.routineOccurrences[0].id.length, 131);
assert.equal(read({ ...base, version: 7, routines: longMigrated.routines, routineOccurrences: longMigrated.routineOccurrences }).routineOccurrences[0].id.length, 131);
process.stdout.write("Routine backup v7, legacy conversion, strict shape and bounded rule checks passed.\n");
