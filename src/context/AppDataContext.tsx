/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  DEFAULT_AUTO_BACKUP_INTERVAL_MINUTES,
  DEFAULT_NOTIFY_BEFORE_MINUTES,
  DEFAULT_PROJECT_ID,
  DEFAULT_SETTING,
  SETTINGS_ID,
} from "../constants";
import { bootstrapDatabase, db } from "../db";
import type {
  AppSetting,
  Memo,
  Project,
  RecurrencePattern,
  Task,
  TaskFormInput,
  TaskType,
} from "../models";
import { toIsoNow } from "../utils/date";

interface ProjectInput {
  id?: string;
  name: string;
  color: string;
  description?: string;
  isActive: boolean;
}

interface TaskTypeInput {
  id?: string;
  name: string;
  color: string;
  isActive: boolean;
}

interface AutoBackupSummary {
  id: string;
  createdAt: string;
  reason: string;
  size: number;
}

interface AppDataContextValue {
  tasks: Task[];
  projects: Project[];
  taskTypes: TaskType[];
  memos: Memo[];
  setting: AppSetting;
  isReady: boolean;
  canUndo: boolean;
  undoDescription?: string;
  autoBackups: AutoBackupSummary[];
  createTask: (input: TaskFormInput) => Promise<void>;
  updateTask: (id: string, input: TaskFormInput) => Promise<void>;
  removeTask: (id: string) => Promise<void>;
  undoLastChange: () => Promise<void>;
  upsertProject: (input: ProjectInput) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  upsertTaskType: (input: TaskTypeInput) => Promise<void>;
  deleteTaskType: (id: string) => Promise<void>;
  saveMemo: (date: string, content: string) => Promise<void>;
  updateSetting: (
    patch: Partial<
      Pick<
        AppSetting,
        | "showPastCompleted"
        | "weekStartsOn"
        | "timeFormat"
        | "llmApiKey"
        | "llmModel"
        | "notificationsEnabled"
        | "notifyBeforeMinutes"
        | "autoBackupEnabled"
        | "autoBackupIntervalMinutes"
      >
    >,
  ) => Promise<void>;
  exportData: () => Promise<string>;
  importData: (raw: string) => Promise<void>;
  createAutoBackup: (reason?: string) => Promise<void>;
  restoreAutoBackup: (id: string) => Promise<void>;
  deleteAutoBackup: (id: string) => Promise<void>;
  refreshAutoBackups: () => Promise<void>;
}

const AppDataContext = createContext<AppDataContextValue | undefined>(undefined);

const AUTO_BACKUPS_STORAGE_KEY = "schedule_auto_backups_v1";
const ALARM_SYNC_STORAGE_KEY = "schedule_alarm_payload_v1";
const MAX_AUTO_BACKUPS = 20;
const MAX_UNDO_STACK = 80;
const UPDATE_UNDO_MERGE_WINDOW_MS = 15_000;

interface StoredAutoBackupEntry {
  id: string;
  createdAt: string;
  reason: string;
  raw: string;
}

type UndoEntry =
  | {
      kind: "delete_tasks";
      createdAt: string;
      description: string;
      taskIds: string[];
    }
  | {
      kind: "upsert_tasks";
      createdAt: string;
      description: string;
      tasks: Task[];
    };

function getId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 12)}`;
}

function isTaskStatusDone(status: Task["status"]): boolean {
  return status === "DONE";
}

function trimTaskInput(input: TaskFormInput): TaskFormInput {
  return {
    ...input,
    title: input.title.trim(),
    content: input.content.trim(),
  };
}

function clampRecurrenceCount(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(1, Math.min(60, Math.floor(value ?? 1)));
}

function shiftIsoByPattern(iso: string, pattern: RecurrencePattern, step: number): string {
  if (step <= 0 || pattern === "NONE") {
    return iso;
  }

  const date = new Date(iso);
  if (pattern === "DAILY") {
    date.setDate(date.getDate() + step);
    return date.toISOString();
  }

  if (pattern === "WEEKLY") {
    date.setDate(date.getDate() + step * 7);
    return date.toISOString();
  }

  date.setMonth(date.getMonth() + step);
  return date.toISOString();
}

function toTaskCoreRecord(input: TaskFormInput): Omit<Task, "id" | "createdAt" | "updatedAt" | "recurrenceGroupId" | "recurrenceIndex"> {
  return {
    title: input.title.trim(),
    content: input.content.trim(),
    taskTypeId: input.taskTypeId,
    projectId: input.projectId,
    status: input.status,
    startAt: input.startAt,
    endAt: input.endAt || undefined,
    isMajor: input.isMajor,
    completedAt: isTaskStatusDone(input.status) ? toIsoNow() : undefined,
    recurrencePattern: undefined,
  };
}

function serializeTaskForEquality(task: Task): string {
  return JSON.stringify({
    title: task.title,
    content: task.content,
    taskTypeId: task.taskTypeId,
    projectId: task.projectId,
    status: task.status,
    startAt: task.startAt,
    endAt: task.endAt ?? "",
    isMajor: task.isMajor,
    recurrencePattern: task.recurrencePattern ?? "NONE",
  });
}

function validateImportPayload(payload: unknown): payload is {
  tasks: Task[];
  projects: Project[];
  taskTypes: TaskType[];
  memos: Memo[];
  settings: AppSetting[];
} {
  if (!payload || typeof payload !== "object") {
    return false;
  }
  const candidate = payload as Record<string, unknown>;
  return (
    Array.isArray(candidate.tasks) &&
    Array.isArray(candidate.projects) &&
    Array.isArray(candidate.taskTypes) &&
    Array.isArray(candidate.memos) &&
    Array.isArray(candidate.settings)
  );
}

function normalizeSetting(setting: AppSetting): AppSetting {
  return {
    ...setting,
    notificationsEnabled: setting.notificationsEnabled ?? DEFAULT_SETTING.notificationsEnabled,
    notifyBeforeMinutes: setting.notifyBeforeMinutes ?? DEFAULT_NOTIFY_BEFORE_MINUTES,
    autoBackupEnabled: setting.autoBackupEnabled ?? DEFAULT_SETTING.autoBackupEnabled,
    autoBackupIntervalMinutes: setting.autoBackupIntervalMinutes ?? DEFAULT_AUTO_BACKUP_INTERVAL_MINUTES,
    llmApiKey: setting.llmApiKey ?? DEFAULT_SETTING.llmApiKey,
    llmModel: setting.llmModel ?? DEFAULT_SETTING.llmModel,
  };
}

function getChromeStorageLocal(): {
  get: (keys: string[], callback: (items: Record<string, unknown>) => void) => void;
  set: (items: Record<string, unknown>, callback?: () => void) => void;
} | null {
  const maybeChrome = (globalThis as { chrome?: unknown }).chrome as
    | {
        storage?: {
          local?: {
            get: (keys: string[], callback: (items: Record<string, unknown>) => void) => void;
            set: (items: Record<string, unknown>, callback?: () => void) => void;
          };
        };
      }
    | undefined;

  return maybeChrome?.storage?.local ?? null;
}

function isStoredAutoBackupEntry(value: unknown): value is StoredAutoBackupEntry {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.reason === "string" &&
    typeof candidate.raw === "string"
  );
}

async function readStoredAutoBackups(): Promise<StoredAutoBackupEntry[]> {
  const storage = getChromeStorageLocal();
  if (storage) {
    const items = await new Promise<Record<string, unknown>>((resolve) => {
      storage.get([AUTO_BACKUPS_STORAGE_KEY], (result) => {
        resolve(result);
      });
    });

    const rawEntries = Array.isArray(items[AUTO_BACKUPS_STORAGE_KEY]) ? items[AUTO_BACKUPS_STORAGE_KEY] : [];
    return rawEntries.filter(isStoredAutoBackupEntry);
  }

  if (typeof localStorage === "undefined") {
    return [];
  }

  const raw = localStorage.getItem(AUTO_BACKUPS_STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isStoredAutoBackupEntry);
  } catch {
    return [];
  }
}

async function writeStoredAutoBackups(entries: StoredAutoBackupEntry[]): Promise<void> {
  const storage = getChromeStorageLocal();
  if (storage) {
    await new Promise<void>((resolve) => {
      storage.set({ [AUTO_BACKUPS_STORAGE_KEY]: entries }, () => resolve());
    });
    return;
  }

  if (typeof localStorage !== "undefined") {
    localStorage.setItem(AUTO_BACKUPS_STORAGE_KEY, JSON.stringify(entries));
  }
}

async function writeAlarmSyncPayload(payload: {
  updatedAt: string;
  settings: {
    notificationsEnabled: boolean;
    notifyBeforeMinutes: number;
  };
  tasks: Array<{
    id: string;
    title: string;
    startAt: string;
    status: Task["status"];
  }>;
}): Promise<void> {
  const storage = getChromeStorageLocal();
  if (!storage) {
    return;
  }

  await new Promise<void>((resolve) => {
    storage.set({ [ALARM_SYNC_STORAGE_KEY]: payload }, () => resolve());
  });
}

function toBackupSummary(entry: StoredAutoBackupEntry): AutoBackupSummary {
  return {
    id: entry.id,
    createdAt: entry.createdAt,
    reason: entry.reason,
    size: entry.raw.length,
  };
}

function compareNewestFirst(a: { createdAt: string }, b: { createdAt: string }): number {
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

export function AppDataProvider({ children }: { children: React.ReactNode }) {
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [autoBackups, setAutoBackups] = useState<AutoBackupSummary[]>([]);

  useEffect(() => {
    void bootstrapDatabase();
  }, []);

  const tasks = useLiveQuery(() => db.tasks.toArray(), [], []);
  const projects = useLiveQuery(() => db.projects.toArray(), [], []);
  const taskTypes = useLiveQuery(() => db.taskTypes.orderBy("order").toArray(), [], []);
  const memos = useLiveQuery(() => db.memos.toArray(), [], []);
  const rawSetting = useLiveQuery(() => db.settings.get(SETTINGS_ID), [], undefined);

  const setting = useMemo(() => normalizeSetting(rawSetting ?? DEFAULT_SETTING), [rawSetting]);

  const pushUndo = useCallback((entry: UndoEntry) => {
    setUndoStack((prev) => {
      const merged = [...prev];

      if (entry.kind === "upsert_tasks" && entry.tasks.length === 1) {
        const last = merged[merged.length - 1];
        if (
          last?.kind === "upsert_tasks" &&
          last.tasks.length === 1 &&
          last.tasks[0].id === entry.tasks[0].id &&
          Date.now() - new Date(last.createdAt).getTime() < UPDATE_UNDO_MERGE_WINDOW_MS
        ) {
          return merged;
        }
      }

      merged.push(entry);
      if (merged.length > MAX_UNDO_STACK) {
        return merged.slice(merged.length - MAX_UNDO_STACK);
      }
      return merged;
    });
  }, []);

  const createTask = useCallback(
    async (input: TaskFormInput) => {
      const now = toIsoNow();
      const normalized = trimTaskInput(input);
      const recurrencePattern = normalized.recurrencePattern ?? "NONE";
      const recurrenceCount = recurrencePattern === "NONE" ? 1 : clampRecurrenceCount(normalized.recurrenceCount);
      const effectivePattern: RecurrencePattern = recurrenceCount > 1 ? recurrencePattern : "NONE";
      const recurrenceGroupId = effectivePattern === "NONE" ? undefined : getId("recurrence");

      const records: Task[] = Array.from({ length: recurrenceCount }, (_, index) => {
        const shiftedStart = shiftIsoByPattern(normalized.startAt, effectivePattern, index);
        const shiftedEnd = normalized.endAt ? shiftIsoByPattern(normalized.endAt, effectivePattern, index) : undefined;

        return {
          id: getId("task"),
          title: normalized.title,
          content: normalized.content,
          taskTypeId: normalized.taskTypeId,
          projectId: normalized.projectId,
          status: normalized.status,
          startAt: shiftedStart,
          endAt: shiftedEnd,
          isMajor: normalized.isMajor,
          createdAt: now,
          updatedAt: now,
          completedAt: isTaskStatusDone(normalized.status) ? now : undefined,
          recurrencePattern: effectivePattern,
          recurrenceGroupId,
          recurrenceIndex: effectivePattern === "NONE" ? undefined : index,
        };
      });

      await db.tasks.bulkAdd(records);

      pushUndo({
        kind: "delete_tasks",
        createdAt: now,
        description: recurrenceCount > 1 ? `반복 일정 ${recurrenceCount}건 추가` : `일정 추가: ${normalized.title}`,
        taskIds: records.map((item) => item.id),
      });
    },
    [pushUndo],
  );

  const updateTask = useCallback(
    async (id: string, input: TaskFormInput) => {
      const existing = await db.tasks.get(id);
      if (!existing) {
        return;
      }

      const now = toIsoNow();
      const normalized = trimTaskInput(input);
      const nextTask: Task = {
        ...existing,
        ...toTaskCoreRecord(normalized),
        recurrencePattern: existing.recurrencePattern,
        recurrenceGroupId: existing.recurrenceGroupId,
        recurrenceIndex: existing.recurrenceIndex,
        completedAt: isTaskStatusDone(normalized.status) ? existing.completedAt ?? now : undefined,
        updatedAt: now,
      };

      if (serializeTaskForEquality(existing) === serializeTaskForEquality(nextTask)) {
        return;
      }

      await db.tasks.put(nextTask);

      pushUndo({
        kind: "upsert_tasks",
        createdAt: now,
        description: `일정 수정: ${existing.title}`,
        tasks: [existing],
      });
    },
    [pushUndo],
  );

  const removeTask = useCallback(
    async (id: string) => {
      const existing = await db.tasks.get(id);
      if (!existing) {
        return;
      }

      await db.tasks.delete(id);

      pushUndo({
        kind: "upsert_tasks",
        createdAt: toIsoNow(),
        description: `일정 삭제: ${existing.title}`,
        tasks: [existing],
      });
    },
    [pushUndo],
  );

  const undoLastChange = useCallback(async () => {
    let target: UndoEntry | undefined;

    setUndoStack((prev) => {
      if (prev.length === 0) {
        return prev;
      }
      target = prev[prev.length - 1];
      return prev.slice(0, -1);
    });

    if (!target) {
      return;
    }

    if (target.kind === "delete_tasks") {
      await db.tasks.bulkDelete(target.taskIds);
      return;
    }

    await db.tasks.bulkPut(target.tasks);
  }, []);

  const upsertProject = useCallback(async (input: ProjectInput) => {
    const now = toIsoNow();
    const name = input.name.trim();
    if (!name) {
      throw new Error("프로젝트명을 입력해 주세요.");
    }

    if (input.id) {
      const existing = await db.projects.get(input.id);
      if (!existing) {
        return;
      }
      await db.projects.put({
        ...existing,
        name,
        color: input.color,
        description: input.description?.trim(),
        isActive: input.isActive,
        updatedAt: now,
      });
      return;
    }

    await db.projects.add({
      id: getId("project"),
      name,
      color: input.color,
      description: input.description?.trim(),
      isActive: input.isActive,
      createdAt: now,
      updatedAt: now,
    });
  }, []);

  const deleteProject = useCallback(async (id: string) => {
    if (id === DEFAULT_PROJECT_ID) {
      throw new Error("기본 프로젝트는 삭제할 수 없습니다.");
    }
    const taskCount = await db.tasks.where("projectId").equals(id).count();
    if (taskCount > 0) {
      throw new Error("해당 프로젝트에 연결된 일정이 있어 삭제할 수 없습니다.");
    }
    await db.projects.delete(id);
  }, []);

  const upsertTaskType = useCallback(async (input: TaskTypeInput) => {
    const now = toIsoNow();
    const name = input.name.trim();
    if (!name) {
      throw new Error("종류명을 입력해 주세요.");
    }

    if (input.id) {
      const existing = await db.taskTypes.get(input.id);
      if (!existing) {
        return;
      }
      await db.taskTypes.put({
        ...existing,
        name,
        color: input.color,
        isActive: input.isActive,
        updatedAt: now,
      });
      return;
    }

    const highestOrder = await db.taskTypes.orderBy("order").last();
    await db.taskTypes.add({
      id: getId("type"),
      name,
      color: input.color,
      isDefault: false,
      isActive: input.isActive,
      order: (highestOrder?.order ?? 0) + 1,
      createdAt: now,
      updatedAt: now,
    });
  }, []);

  const deleteTaskType = useCallback(async (id: string) => {
    const type = await db.taskTypes.get(id);
    if (!type) {
      return;
    }
    if (type.isDefault) {
      throw new Error("기본 종류는 삭제할 수 없습니다.");
    }
    const taskCount = await db.tasks.where("taskTypeId").equals(id).count();
    if (taskCount > 0) {
      throw new Error("해당 종류에 연결된 일정이 있어 삭제할 수 없습니다.");
    }
    await db.taskTypes.delete(id);
  }, []);

  const saveMemo = useCallback(async (date: string, content: string) => {
    const trimmed = content.trim();
    const id = `memo-${date}`;

    if (!trimmed) {
      await db.memos.delete(id);
      return;
    }

    await db.memos.put({
      id,
      date,
      content: trimmed,
      updatedAt: toIsoNow(),
    });
  }, []);

  const updateSetting = useCallback(
    async (
      patch: Partial<
        Pick<
          AppSetting,
          | "showPastCompleted"
          | "weekStartsOn"
          | "timeFormat"
          | "llmApiKey"
          | "llmModel"
          | "notificationsEnabled"
          | "notifyBeforeMinutes"
          | "autoBackupEnabled"
          | "autoBackupIntervalMinutes"
        >
      >,
    ) => {
      const current = normalizeSetting((await db.settings.get(SETTINGS_ID)) ?? DEFAULT_SETTING);
      await db.settings.put({
        ...current,
        ...patch,
        notifyBeforeMinutes:
          patch.notifyBeforeMinutes !== undefined
            ? Math.max(0, Math.min(24 * 60, Math.floor(patch.notifyBeforeMinutes)))
            : current.notifyBeforeMinutes,
        autoBackupIntervalMinutes:
          patch.autoBackupIntervalMinutes !== undefined
            ? Math.max(15, Math.min(24 * 60, Math.floor(patch.autoBackupIntervalMinutes)))
            : current.autoBackupIntervalMinutes,
        id: SETTINGS_ID,
        updatedAt: toIsoNow(),
      });
    },
    [],
  );

  const exportData = useCallback(async () => {
    const data = {
      exportedAt: toIsoNow(),
      version: 1,
      tasks: await db.tasks.toArray(),
      projects: await db.projects.toArray(),
      taskTypes: await db.taskTypes.toArray(),
      memos: await db.memos.toArray(),
      settings: await db.settings.toArray(),
    };
    return JSON.stringify(data, null, 2);
  }, []);

  const importData = useCallback(async (raw: string) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("JSON 형식이 올바르지 않습니다.");
    }

    if (!validateImportPayload(parsed)) {
      throw new Error("가져오기 데이터 형식이 맞지 않습니다.");
    }

    await db.transaction("rw", [db.tasks, db.projects, db.taskTypes, db.memos, db.settings], async () => {
      await db.tasks.clear();
      await db.projects.clear();
      await db.taskTypes.clear();
      await db.memos.clear();
      await db.settings.clear();

      if (parsed.tasks.length > 0) {
        await db.tasks.bulkAdd(parsed.tasks);
      }
      if (parsed.projects.length > 0) {
        await db.projects.bulkAdd(parsed.projects);
      }
      if (parsed.taskTypes.length > 0) {
        await db.taskTypes.bulkAdd(parsed.taskTypes);
      }
      if (parsed.memos.length > 0) {
        await db.memos.bulkAdd(parsed.memos);
      }
      if (parsed.settings.length > 0) {
        await db.settings.bulkAdd(parsed.settings.map(normalizeSetting));
      }
    });

    setUndoStack([]);
    await bootstrapDatabase();
  }, []);

  const refreshAutoBackups = useCallback(async () => {
    const entries = await readStoredAutoBackups();
    setAutoBackups(entries.sort(compareNewestFirst).map(toBackupSummary));
  }, []);

  const createAutoBackup = useCallback(
    async (reason = "수동") => {
      const raw = await exportData();
      const entry: StoredAutoBackupEntry = {
        id: getId("backup"),
        createdAt: toIsoNow(),
        reason,
        raw,
      };

      const existing = await readStoredAutoBackups();
      const next = [entry, ...existing].sort(compareNewestFirst).slice(0, MAX_AUTO_BACKUPS);
      await writeStoredAutoBackups(next);
      await refreshAutoBackups();
    },
    [exportData, refreshAutoBackups],
  );

  const restoreAutoBackup = useCallback(
    async (id: string) => {
      const entries = await readStoredAutoBackups();
      const target = entries.find((item) => item.id === id);
      if (!target) {
        throw new Error("선택한 백업을 찾을 수 없습니다.");
      }

      await importData(target.raw);
      await refreshAutoBackups();
    },
    [importData, refreshAutoBackups],
  );

  const deleteAutoBackup = useCallback(
    async (id: string) => {
      const entries = await readStoredAutoBackups();
      const next = entries.filter((item) => item.id !== id);
      await writeStoredAutoBackups(next);
      await refreshAutoBackups();
    },
    [refreshAutoBackups],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshAutoBackups();
  }, [refreshAutoBackups]);

  useEffect(() => {
    if (!setting.autoBackupEnabled) {
      return;
    }

    const intervalMinutes = Math.max(15, Math.floor(setting.autoBackupIntervalMinutes ?? DEFAULT_AUTO_BACKUP_INTERVAL_MINUTES));
    const timerId = window.setInterval(() => {
      void createAutoBackup("자동");
    }, intervalMinutes * 60_000);

    return () => {
      window.clearInterval(timerId);
    };
  }, [setting.autoBackupEnabled, setting.autoBackupIntervalMinutes, createAutoBackup]);

  useEffect(() => {
    void writeAlarmSyncPayload({
      updatedAt: toIsoNow(),
      settings: {
        notificationsEnabled: Boolean(setting.notificationsEnabled),
        notifyBeforeMinutes: Math.max(0, Math.floor(setting.notifyBeforeMinutes ?? DEFAULT_NOTIFY_BEFORE_MINUTES)),
      },
      tasks: tasks.map((task) => ({
        id: task.id,
        title: task.title,
        startAt: task.startAt,
        status: task.status,
      })),
    });
  }, [tasks, setting.notificationsEnabled, setting.notifyBeforeMinutes]);

  const isReady = Boolean(rawSetting);

  const value = useMemo<AppDataContextValue>(
    () => ({
      tasks,
      projects,
      taskTypes,
      memos,
      setting,
      isReady,
      canUndo: undoStack.length > 0,
      undoDescription: undoStack[undoStack.length - 1]?.description,
      autoBackups,
      createTask,
      updateTask,
      removeTask,
      undoLastChange,
      upsertProject,
      deleteProject,
      upsertTaskType,
      deleteTaskType,
      saveMemo,
      updateSetting,
      exportData,
      importData,
      createAutoBackup,
      restoreAutoBackup,
      deleteAutoBackup,
      refreshAutoBackups,
    }),
    [
      tasks,
      projects,
      taskTypes,
      memos,
      setting,
      isReady,
      undoStack,
      autoBackups,
      createTask,
      updateTask,
      removeTask,
      undoLastChange,
      upsertProject,
      deleteProject,
      upsertTaskType,
      deleteTaskType,
      saveMemo,
      updateSetting,
      exportData,
      importData,
      createAutoBackup,
      restoreAutoBackup,
      deleteAutoBackup,
      refreshAutoBackups,
    ],
  );

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData(): AppDataContextValue {
  const context = useContext(AppDataContext);
  if (!context) {
    throw new Error("useAppData must be used inside AppDataProvider");
  }
  return context;
}
