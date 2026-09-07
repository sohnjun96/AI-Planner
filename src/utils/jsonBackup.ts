import { encodeBackupFile } from "./backupArchive";
import { DEFAULT_PROJECT_IDS } from "../constants";
import type { Memo, Note, Project, ProjectSubcategory, Task, TaskType } from "../models";

export interface JsonBackupReminderStatus {
  lastExportedAt?: string;
  nextReminderAt?: string;
}

export interface JsonBackupDataState {
  tasks: readonly Task[];
  projects: readonly Project[];
  taskTypes: readonly TaskType[];
  memos: readonly Memo[];
  notes: readonly Note[];
  projectSubcategories: readonly ProjectSubcategory[];
}

export const JSON_BACKUP_STATUS_CHANGED_EVENT = "ai-planner:json-backup-status-changed";
export const JSON_BACKUP_REMINDER_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

const JSON_BACKUP_STATUS_STORAGE_KEY = "schedule_json_export_reminder_v1";


interface ChromeStorageLocal {
  get: (keys: string[], callback: (items: Record<string, unknown>) => void) => void;
  set: (items: Record<string, unknown>, callback?: () => void) => void;
}

function getChromeStorageLocal(): ChromeStorageLocal | null {
  const maybeChrome = (globalThis as { chrome?: unknown }).chrome as
    | { storage?: { local?: ChromeStorageLocal } }
    | undefined;
  return maybeChrome?.storage?.local ?? null;
}

function getChromeRuntimeError(): string | undefined {
  return ((globalThis as { chrome?: { runtime?: { lastError?: { message?: string } } } }).chrome?.runtime?.lastError?.message);
}

function readChromeStorage(storage: ChromeStorageLocal): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    storage.get([JSON_BACKUP_STATUS_STORAGE_KEY], (items) => {
      const message = getChromeRuntimeError();
      if (message) {
        reject(new Error(`백업 상태를 읽지 못했습니다: ${message}`));
        return;
      }
      resolve(items);
    });
  });
}

function writeChromeStorage(storage: ChromeStorageLocal, status: JsonBackupReminderStatus): Promise<void> {
  return new Promise((resolve, reject) => {
    storage.set({ [JSON_BACKUP_STATUS_STORAGE_KEY]: status }, () => {
      const message = getChromeRuntimeError();
      if (message) {
        reject(new Error(`백업 상태를 저장하지 못했습니다: ${message}`));
        return;
      }
      resolve();
    });
  });
}

function normalizeIsoDate(value: unknown): string | undefined {
  if (typeof value !== "string" || !Number.isFinite(new Date(value).getTime())) return undefined;
  return value;
}

function normalizeStatus(value: unknown): JsonBackupReminderStatus {
  if (!value || typeof value !== "object") return {};
  const candidate = value as Record<string, unknown>;
  return {
    lastExportedAt: normalizeIsoDate(candidate.lastExportedAt),
    nextReminderAt: normalizeIsoDate(candidate.nextReminderAt),
  };
}

export async function readJsonBackupReminderStatus(): Promise<JsonBackupReminderStatus> {
  const storage = getChromeStorageLocal();
  if (storage) {
    const items = await readChromeStorage(storage);
    return normalizeStatus(items[JSON_BACKUP_STATUS_STORAGE_KEY]);
  }
  if (typeof localStorage === "undefined") return {};

  try {
    const raw = localStorage.getItem(JSON_BACKUP_STATUS_STORAGE_KEY);
    return raw ? normalizeStatus(JSON.parse(raw) as unknown) : {};
  } catch {
    return {};
  }
}

async function writeJsonBackupReminderStatus(status: JsonBackupReminderStatus): Promise<void> {
  const storage = getChromeStorageLocal();
  if (storage) {
    await writeChromeStorage(storage, status);
  } else if (typeof localStorage !== "undefined") {
    localStorage.setItem(JSON_BACKUP_STATUS_STORAGE_KEY, JSON.stringify(status));
  }

  window.dispatchEvent(
    new CustomEvent<JsonBackupReminderStatus>(JSON_BACKUP_STATUS_CHANGED_EVENT, { detail: status }),
  );
}

function addReminderInterval(value: Date): string {
  return new Date(value.getTime() + JSON_BACKUP_REMINDER_INTERVAL_MS).toISOString();
}

export function hasUserCreatedJsonBackupData(data: JsonBackupDataState): boolean {
  return data.tasks.length > 0
    || data.notes.length > 0
    || data.memos.some((memo) => memo.content.trim().length > 0)
    || data.projectSubcategories.length > 0
    || data.projects.some((project) => !DEFAULT_PROJECT_IDS.includes(project.id))
    || data.taskTypes.some((taskType) => !taskType.isDefault);
}

export function createInitialJsonBackupReminderStatus(now = new Date()): JsonBackupReminderStatus {
  return { nextReminderAt: addReminderInterval(now) };
}

export function getJsonBackupReminderDueAt(status: JsonBackupReminderStatus): number | undefined {
  const explicitReminderAt = status.nextReminderAt ? new Date(status.nextReminderAt).getTime() : Number.NaN;
  if (Number.isFinite(explicitReminderAt)) return explicitReminderAt;
  const lastExportedAt = status.lastExportedAt ? new Date(status.lastExportedAt).getTime() : Number.NaN;
  return Number.isFinite(lastExportedAt) ? lastExportedAt + JSON_BACKUP_REMINDER_INTERVAL_MS : undefined;
}

export function isJsonBackupReminderDue(status: JsonBackupReminderStatus, now = Date.now()): boolean {
  const dueAt = getJsonBackupReminderDueAt(status);
  return dueAt !== undefined && dueAt <= now;
}

export async function initializeJsonBackupReminder(): Promise<JsonBackupReminderStatus> {
  const current = await readJsonBackupReminderStatus();
  if (getJsonBackupReminderDueAt(current) !== undefined) {
    return current;
  }

  const status = {
    ...current,
    ...createInitialJsonBackupReminderStatus(),
  } satisfies JsonBackupReminderStatus;
  await writeJsonBackupReminderStatus(status);
  return status;
}

export async function snoozeJsonBackupReminder(): Promise<JsonBackupReminderStatus> {
  const current = await readJsonBackupReminderStatus();
  const status = {
    ...current,
    nextReminderAt: addReminderInterval(new Date()),
  } satisfies JsonBackupReminderStatus;
  await writeJsonBackupReminderStatus(status);
  return status;
}

function createBackupFileName(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hour = String(now.getHours()).padStart(2, "0");
  const minute = String(now.getMinutes()).padStart(2, "0");
  return `플래나이-백업-${year}-${month}-${day}-${hour}${minute}.json`;
}

export async function downloadJsonBackup(content: string): Promise<JsonBackupReminderStatus> {
  const { blob, extension } = await encodeBackupFile(content);
  const now = new Date();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = createBackupFileName(now).replace(/\.json$/, `.${extension}`);
  anchor.hidden = true;
  document.body.appendChild(anchor);

  try {
    anchor.click();
  } finally {
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  const status = {
    lastExportedAt: now.toISOString(),
    nextReminderAt: addReminderInterval(now),
  } satisfies JsonBackupReminderStatus;
  await writeJsonBackupReminderStatus(status);
  return status;
}
