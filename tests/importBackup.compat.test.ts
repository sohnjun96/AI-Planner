import assert from "node:assert/strict";
import { parseAndSanitizeImportPayload } from "../src/utils/importBackup";
import { GLOBAL_MEMO_KEY, isValidMemoDate, isValidMemoStorageKey } from "../src/utils/memos";

function createBackup(memoDate: string, version = 5): string {
  return JSON.stringify({
    version,
    exportedAt: "2026-08-21T00:00:00.000Z",
    tasks: [],
    projects: [],
    taskTypes: [],
    memos: [{
      id: `memo-${memoDate}`,
      date: memoDate,
      content: "기존 확장 프로그램에서 저장한 메모",
      updatedAt: "2026-08-20T12:00:00.000Z",
    }],
    settings: [],
    userContexts: [],
    notes: [],
    noteVersions: [],
    noteTaskLinks: [],
    projectSubcategories: [],
    archiveInsightCaches: [],
  });
}

assert.equal(isValidMemoStorageKey(GLOBAL_MEMO_KEY), true);
assert.equal(isValidMemoDate("2024-02-29"), true);
assert.equal(isValidMemoDate("2026-02-29"), false);
assert.equal(isValidMemoDate("2026-13-01"), false);

const globalMemoBackup = parseAndSanitizeImportPayload(createBackup(GLOBAL_MEMO_KEY));
assert.equal(globalMemoBackup.memos[0]?.date, GLOBAL_MEMO_KEY);
assert.equal(globalMemoBackup.memos[0]?.id, "memo-global");

const legacyGlobalMemoBackup = parseAndSanitizeImportPayload(createBackup(GLOBAL_MEMO_KEY, 4));
assert.equal(legacyGlobalMemoBackup.memos[0]?.date, GLOBAL_MEMO_KEY);

const datedMemoBackup = parseAndSanitizeImportPayload(createBackup("2026-08-21"));
assert.equal(datedMemoBackup.memos[0]?.date, "2026-08-21");

assert.throws(
  () => parseAndSanitizeImportPayload(createBackup("2026-02-29")),
  /memos\[0\]\.date 형식이 올바르지 않습니다/,
);

process.stdout.write("Import backup compatibility checks passed.\n");
