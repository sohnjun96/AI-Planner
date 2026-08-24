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

const exportedAt = "2026-08-21T00:00:00.000Z";

function createUserContextReferenceBackup(options: {
  projectId: string;
  taskTypeId: string;
  projects?: unknown[];
  taskTypes?: unknown[];
  source?: "default" | "user";
}): string {
  return JSON.stringify({
    version: 5,
    exportedAt,
    tasks: [],
    projects: options.projects ?? [],
    taskTypes: options.taskTypes ?? [],
    memos: [],
    settings: [],
    userContexts: [{
      id: "user-context",
      markdown: "",
      rules: [{
        id: "context-lunch-default",
        category: "classification",
        label: "점심 기본 분류",
        trigger: ["점심", "식사"],
        projectId: options.projectId,
        taskTypeId: options.taskTypeId,
        source: options.source ?? "default",
        isActive: true,
        createdAt: exportedAt,
        updatedAt: exportedAt,
      }],
      updatedAt: exportedAt,
    }],
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

const legacyNamedDefaults = parseAndSanitizeImportPayload(createUserContextReferenceBackup({
  projectId: "project-lunch",
  taskTypeId: "type-meal",
  projects: [{
    id: "legacy-project-lunch",
    name: "점심 약속",
    color: "#0e7490",
    description: "구버전 기본 프로젝트",
    isActive: true,
    createdAt: exportedAt,
    updatedAt: exportedAt,
  }],
  taskTypes: [{
    id: "legacy-type-meal",
    name: "식사",
    color: "#0e7490",
    isDefault: true,
    isActive: true,
    order: 1,
    createdAt: exportedAt,
    updatedAt: exportedAt,
  }],
}));
assert.equal(legacyNamedDefaults.projects.length, 1);
assert.equal(legacyNamedDefaults.taskTypes.length, 1);
assert.equal(legacyNamedDefaults.userContexts[0]?.rules[0]?.projectId, "legacy-project-lunch");
assert.equal(legacyNamedDefaults.userContexts[0]?.rules[0]?.taskTypeId, "legacy-type-meal");

const restoredMissingDefaults = parseAndSanitizeImportPayload(createUserContextReferenceBackup({
  projectId: "project-lunch",
  taskTypeId: "type-meal",
  projects: [{
    id: "project-lunch",
    name: "점심 약속",
    color: "#0e7490",
    description: "점심 식사와 식사 약속을 관리하는 기본 프로젝트",
    isActive: true,
    createdAt: exportedAt,
    updatedAt: exportedAt,
  }],
}));
assert.equal(restoredMissingDefaults.projects.some((project) => project.id === "project-lunch"), true);
assert.equal(restoredMissingDefaults.taskTypes.some((taskType) => taskType.id === "type-meal"), true);
assert.equal(restoredMissingDefaults.userContexts[0]?.rules[0]?.projectId, "project-lunch");
assert.equal(restoredMissingDefaults.userContexts[0]?.rules[0]?.taskTypeId, "type-meal");

assert.throws(
  () => parseAndSanitizeImportPayload(createUserContextReferenceBackup({
    projectId: "unknown-project",
    taskTypeId: "unknown-type",
    source: "user",
  })),
  /userContextRule context-lunch-default\.projectId 참조 대상이 없습니다/,
);

process.stdout.write("Import backup compatibility checks passed.\n");
