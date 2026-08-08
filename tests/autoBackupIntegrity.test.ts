import assert from "node:assert/strict";
import { areAutoBackupEntriesEqual, type AutoBackupIntegrityEntry } from "../src/utils/autoBackupIntegrity";

const expected: AutoBackupIntegrityEntry[] = [
  {
    id: "backup:test",
    createdAt: "2026-08-08T14:00:00.000Z",
    reason: "수동",
    raw: '{"version":3,"tasks":[]}',
  },
];

const reorderedProperties = [
  {
    raw: '{"version":3,"tasks":[]}',
    reason: "수동",
    createdAt: "2026-08-08T14:00:00.000Z",
    id: "backup:test",
  },
];

assert.equal(areAutoBackupEntriesEqual(expected, reorderedProperties), true);
assert.equal(areAutoBackupEntriesEqual(expected, [{ ...reorderedProperties[0], raw: '{"version":3,"tasks":[1]}' }]), false);
assert.equal(areAutoBackupEntriesEqual(expected, []), false);

process.stdout.write("Auto-backup integrity checks passed.\n");
