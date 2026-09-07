import assert from "node:assert/strict";
import {
  createInitialJsonBackupReminderStatus,
  getJsonBackupReminderDueAt,
  hasUserCreatedJsonBackupData,
  isJsonBackupReminderDue,
  JSON_BACKUP_REMINDER_INTERVAL_MS,
} from "../src/utils/jsonBackup";
import type { JsonBackupDataState } from "../src/utils/jsonBackup";

const firstDataCreatedAt = new Date("2026-08-24T12:00:00.000Z");
const initialStatus = createInitialJsonBackupReminderStatus(firstDataCreatedAt);
const expectedDueAt = firstDataCreatedAt.getTime() + JSON_BACKUP_REMINDER_INTERVAL_MS;

assert.equal(getJsonBackupReminderDueAt(initialStatus), expectedDueAt);
assert.equal(isJsonBackupReminderDue({}, firstDataCreatedAt.getTime()), false);
assert.equal(isJsonBackupReminderDue(initialStatus, expectedDueAt - 1), false);
assert.equal(isJsonBackupReminderDue(initialStatus, expectedDueAt), true);
assert.equal(
  getJsonBackupReminderDueAt({ lastExportedAt: firstDataCreatedAt.toISOString() }),
  expectedDueAt,
);

const emptyData: JsonBackupDataState = {
  tasks: [],
  projects: [
    {
      id: "project-general",
      name: "일반",
      color: "#334155",
      isActive: true,
      createdAt: firstDataCreatedAt.toISOString(),
      updatedAt: firstDataCreatedAt.toISOString(),
    },
  ],
  taskTypes: [
    {
      id: "type-meeting",
      name: "회의",
      color: "#2563eb",
      isDefault: true,
      isActive: true,
      order: 1,
      createdAt: firstDataCreatedAt.toISOString(),
      updatedAt: firstDataCreatedAt.toISOString(),
    },
  ],
  memos: [],
  notes: [],
  projectSubcategories: [],
};

assert.equal(hasUserCreatedJsonBackupData(emptyData), false);
assert.equal(
  hasUserCreatedJsonBackupData({
    ...emptyData,
    memos: [{
      id: "memo-global",
      date: "global",
      content: "첫 메모",
      updatedAt: firstDataCreatedAt.toISOString(),
    }],
  }),
  true,
);
assert.equal(
  hasUserCreatedJsonBackupData({
    ...emptyData,
    projects: [
      ...emptyData.projects,
      {
        id: "project-user",
        name: "사용자 프로젝트",
        color: "#000000",
        isActive: true,
        createdAt: firstDataCreatedAt.toISOString(),
        updatedAt: firstDataCreatedAt.toISOString(),
      },
    ],
  }),
  true,
);

process.stdout.write("JSON backup reminder checks passed.\n");
