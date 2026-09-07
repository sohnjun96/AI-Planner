import Dexie, { type Table } from "dexie";
import { parseAndSanitizeImportPayload, stripSecretsFromBackupRaw, MAX_IMPORT_FILE_BYTES } from "./importBackup";
import { areAutoBackupEntriesEqual } from "./autoBackupIntegrity";

export interface StoredAutoBackupEntry {
  id: string;
  createdAt: string;
  reason: string;
  raw: string;
}

// 주 데이터 가져오기/교체와 독립적으로 유지한다. Chrome storage/localStorage의
// 작은 할당량에 백업 보관 용량이 묶이지 않도록 별도 DB를 사용한다.
class BackupDatabase extends Dexie {
  entries!: Table<StoredAutoBackupEntry, string>;
  constructor() {
    super("schedule-manager-backups");
    this.version(1).stores({ entries: "id, createdAt" });
  }
}

export const backupDb = new BackupDatabase();

const LEGACY_KEY = "schedule_auto_backups_v1";
const MAX_TOTAL_BYTES = 100_000_000;

export function sanitizeAutoBackups(values: unknown[]): StoredAutoBackupEntry[] {
  const safe: StoredAutoBackupEntry[] = [];
  for (const value of values) {
    if (!value || typeof value !== "object") continue;
    const item = value as Record<string, unknown>;
    if (typeof item.id !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(item.id) ||
        typeof item.createdAt !== "string" || !Number.isFinite(new Date(item.createdAt).getTime()) ||
        typeof item.reason !== "string" || item.reason.length > 200 ||
        typeof item.raw !== "string" || new TextEncoder().encode(item.raw).byteLength > MAX_IMPORT_FILE_BYTES) continue;
    try {
      const raw = JSON.stringify(parseAndSanitizeImportPayload(stripSecretsFromBackupRaw(item.raw)));
      safe.push({ id: item.id, createdAt: item.createdAt, reason: item.reason, raw });
    } catch { /* 손상된 기존 백업은 복원 대상으로 표시하지 않는다. */ }
  }
  safe.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  let size = 0;
  return safe.filter((entry) => {
    const bytes = new TextEncoder().encode(entry.raw).byteLength;
    if (size + bytes > MAX_TOTAL_BYTES) return false;
    size += bytes;
    return true;
  }).slice(0, 20);
}

async function replaceAndVerify(entries: StoredAutoBackupEntry[]): Promise<void> {
  // 호출자는 entries에 대한 rw transaction 안에 있어야 한다.
  await backupDb.entries.clear();
  await backupDb.entries.bulkPut(entries);
  const byId = (a: StoredAutoBackupEntry, b: StoredAutoBackupEntry) => a.id.localeCompare(b.id);
  if (!areAutoBackupEntriesEqual([...entries].sort(byId), (await backupDb.entries.toArray()).sort(byId))) {
    throw new Error("자동 백업 저장 검증에 실패했습니다.");
  }
}

interface LegacyChrome {
  runtime?: { lastError?: { message?: string } };
  storage?: { local?: {
    get: (keys: string[], callback: (items: Record<string, unknown>) => void) => void;
    remove: (key: string, callback: () => void) => void;
  } };
}

let migration: Promise<void> | undefined;
async function migrateLegacyBackups(): Promise<void> {
  if (migration) return migration;
  migration = (async () => {
    const chromeApi = (globalThis as typeof globalThis & { chrome?: LegacyChrome }).chrome;
    const storage = chromeApi?.storage?.local;
    let rawEntries: unknown;
    if (storage) {
      rawEntries = await new Promise<unknown>((resolve, reject) => storage.get([LEGACY_KEY], (items) => {
        if (chromeApi?.runtime?.lastError) reject(new Error("기존 백업을 읽지 못했습니다."));
        else resolve(items[LEGACY_KEY]);
      }));
    } else {
      const raw = localStorage.getItem(LEGACY_KEY);
      if (raw) {
        try { rawEntries = JSON.parse(raw); } catch { return; }
      }
    }
    if (!Array.isArray(rawEntries)) return;
    const safe = sanitizeAutoBackups(rawEntries);
    // 유효한 백업이 하나도 없으면 원본을 제거하지 않는다.
    if (!safe.length && rawEntries.length) return;
    await backupDb.transaction("rw", backupDb.entries, async () => {
      const current = await backupDb.entries.toArray();
      const merged = [...new Map([...safe, ...current].map((entry) => [entry.id, entry])).values()];
      await replaceAndVerify(sanitizeAutoBackups(merged));
    });
    // 새 DB 저장 및 검증이 끝난 뒤에만 구 저장소를 정리한다.
    if (storage) {
      await new Promise<void>((resolve, reject) => storage.remove(LEGACY_KEY, () => {
        if (chromeApi?.runtime?.lastError) reject(new Error("이전 백업 저장소를 정리하지 못했습니다."));
        else resolve();
      }));
    } else localStorage.removeItem(LEGACY_KEY);
  })().catch((error: unknown) => { migration = undefined; throw error; });
  return migration;
}

export async function readStoredAutoBackups(): Promise<StoredAutoBackupEntry[]> {
  await migrateLegacyBackups();
  return sanitizeAutoBackups(await backupDb.entries.toArray());
}

export async function storeAutoBackup(entry: StoredAutoBackupEntry): Promise<void> {
  await migrateLegacyBackups();
  await backupDb.transaction("rw", backupDb.entries, async () => {
    const current = await backupDb.entries.toArray();
    const next = sanitizeAutoBackups([entry, ...current.filter((item) => item.id !== entry.id)]);
    if (!next.some((item) => item.id === entry.id)) throw new Error("새 백업을 보관할 수 없습니다. 외부 백업을 내보내 주세요.");
    await replaceAndVerify(next);
  });
}

export async function removeStoredAutoBackup(id: string): Promise<void> {
  await migrateLegacyBackups();
  await backupDb.entries.delete(id);
}
