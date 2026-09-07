import assert from "node:assert/strict";
import JSZip from "jszip";
import { encodeBackupFile, decodeBackupFile, MAX_BACKUP_BYTES } from "../src/utils/backupArchive";
import { isTaskDisplayedOnDate, isTaskOverdue, selectUpcomingAlarmTasks } from "../src/utils/taskTiming";
import { buildTaskConflictMap, findTaskConflictsForRange } from "../src/utils/taskConflicts";
import type { Task } from "../src/models";

const now = new Date(2026, 8, 8, 12).getTime();
function task(id: string, start: number, end?: number): Task {
  return { id, title: id, content: "", projectId: "p", taskTypeId: "t", status: "NOT_DONE", isMajor: false,
    startAt: new Date(start).toISOString(), endAt: end === undefined ? undefined : new Date(end).toISOString(),
    createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() };
}
const trip = task("trip", new Date(2026, 8, 7, 9).getTime(), new Date(2026, 8, 9, 18).getTime());
assert.equal(isTaskDisplayedOnDate(trip, "2026-09-08"), true);
assert.equal(isTaskOverdue(trip, now), false);
assert.equal(isTaskOverdue(trip, new Date(2026, 8, 10, 9).getTime()), true);
assert.equal(isTaskOverdue({ ...trip, status: "DONE" }, new Date(2026, 8, 10, 9).getTime()), false);
assert.equal(isTaskDisplayedOnDate(trip, "2026-09-10"), false);
const stale = Array.from({ length: 2_001 }, (_, i) => task(`old-${i}`, now - 86_400_000 - i));
const future = task("future", now + 3_600_000);
assert.deepEqual(selectUpcomingAlarmTasks([...stale, future], 10, now).map((item) => item.id), ["future"]);
assert.equal(selectUpcomingAlarmTasks([future], 60, now).length, 0);
assert.equal(selectUpcomingAlarmTasks([{ ...future, status: "CANCELED" }], 0, now).length, 0);
const a = task("a", now, now + 3_600_000);
const b = task("b", now + 3_600_000, now + 7_200_000);
assert.deepEqual(buildTaskConflictMap([a, b]), { a: [], b: [] });
assert.equal(findTaskConflictsForRange([a], b.startAt, b.endAt).length, 0);
assert.equal(findTaskConflictsForRange([a], new Date(now + 1_800_000).toISOString(), b.endAt).length, 1);
assert.equal(findTaskConflictsForRange([a], a.startAt, a.startAt).length, 0);
const small = await encodeBackupFile('{"version":5}');
assert.equal(small.extension, "json");
assert.equal(await decodeBackupFile(small.blob), '{"version":5}');
const largeRaw = JSON.stringify({ text: "가나다".repeat(600_000) });
const large = await encodeBackupFile(largeRaw);
assert.equal(large.extension, "zip");
assert.equal(await decodeBackupFile(large.blob), largeRaw);
const invalid = await new JSZip().file("other.json", "{}").generateAsync({ type: "uint8array" });
await assert.rejects(decodeBackupFile(new Blob([invalid])), /backup.json/);
await assert.rejects(decodeBackupFile(new Blob([new Uint8Array(MAX_BACKUP_BYTES + 1)])), /50MB/);
// 압축 파일 크기는 작아도 압축 해제 상한을 넘으면 중단한다.
const bomb = await new JSZip().file("backup.json", "x".repeat(MAX_BACKUP_BYTES + 1))
  .generateAsync({ type: "uint8array", compression: "DEFLATE" });
await assert.rejects(decodeBackupFile(new Blob([bomb])), /50MB/);
process.stdout.write("Feature gap regression checks passed.\n");
