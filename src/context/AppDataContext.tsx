/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { DEFAULT_PROJECT_ID, DEFAULT_SETTING, SETTINGS_ID } from "../constants";
import { bootstrapDatabase, db } from "../db";
import type { AppSetting, Memo, Project, Task, TaskFormInput, TaskType } from "../models";
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

interface AppDataContextValue {
  tasks: Task[];
  projects: Project[];
  taskTypes: TaskType[];
  memos: Memo[];
  setting: AppSetting;
  isReady: boolean;
  createTask: (input: TaskFormInput) => Promise<void>;
  updateTask: (id: string, input: TaskFormInput) => Promise<void>;
  removeTask: (id: string) => Promise<void>;
  upsertProject: (input: ProjectInput) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  upsertTaskType: (input: TaskTypeInput) => Promise<void>;
  deleteTaskType: (id: string) => Promise<void>;
  saveMemo: (date: string, content: string) => Promise<void>;
  updateSetting: (
    patch: Partial<Pick<AppSetting, "showPastCompleted" | "weekStartsOn" | "timeFormat" | "llmApiKey" | "llmModel">>,
  ) => Promise<void>;
  exportData: () => Promise<string>;
  importData: (raw: string) => Promise<void>;
}

const AppDataContext = createContext<AppDataContextValue | undefined>(undefined);

function getId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 12)}`;
}

function toTaskRecord(input: TaskFormInput): Omit<Task, "id" | "createdAt" | "updatedAt"> {
  return {
    title: input.title.trim(),
    content: input.content.trim(),
    taskTypeId: input.taskTypeId,
    projectId: input.projectId,
    status: input.status,
    startAt: input.startAt,
    endAt: input.endAt || undefined,
    isMajor: input.isMajor,
    completedAt: input.status === "DONE" ? toIsoNow() : undefined,
  };
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

export function AppDataProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    void bootstrapDatabase();
  }, []);

  const tasks = useLiveQuery(() => db.tasks.toArray(), [], []);
  const projects = useLiveQuery(() => db.projects.toArray(), [], []);
  const taskTypes = useLiveQuery(() => db.taskTypes.orderBy("order").toArray(), [], []);
  const memos = useLiveQuery(() => db.memos.toArray(), [], []);
  const setting = useLiveQuery(() => db.settings.get(SETTINGS_ID), [], undefined);

  const createTask = useCallback(async (input: TaskFormInput) => {
    const now = toIsoNow();
    const record = toTaskRecord(input);

    await db.tasks.add({
      id: getId("task"),
      ...record,
      createdAt: now,
      updatedAt: now,
    });
  }, []);

  const updateTask = useCallback(async (id: string, input: TaskFormInput) => {
    const existing = await db.tasks.get(id);
    if (!existing) {
      return;
    }

    const record = toTaskRecord(input);
    await db.tasks.put({
      ...existing,
      ...record,
      completedAt: input.status === "DONE" ? existing.completedAt ?? toIsoNow() : undefined,
      updatedAt: toIsoNow(),
    });
  }, []);

  const removeTask = useCallback(async (id: string) => {
    await db.tasks.delete(id);
  }, []);

  const upsertProject = useCallback(async (input: ProjectInput) => {
    const now = toIsoNow();
    const name = input.name.trim();
    if (!name) {
      throw new Error("프로젝트명은 필수입니다.");
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
      throw new Error("종류명은 필수입니다.");
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
      patch: Partial<Pick<AppSetting, "showPastCompleted" | "weekStartsOn" | "timeFormat" | "llmApiKey" | "llmModel">>,
    ) => {
      const current = (await db.settings.get(SETTINGS_ID)) ?? DEFAULT_SETTING;
      await db.settings.put({
        ...current,
        ...patch,
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
        await db.settings.bulkAdd(parsed.settings);
      }
    });

    await bootstrapDatabase();
  }, []);

  const isReady = Boolean(setting);

  const value = useMemo<AppDataContextValue>(
    () => ({
      tasks,
      projects,
      taskTypes,
      memos,
      setting: setting ?? DEFAULT_SETTING,
      isReady,
      createTask,
      updateTask,
      removeTask,
      upsertProject,
      deleteProject,
      upsertTaskType,
      deleteTaskType,
      saveMemo,
      updateSetting,
      exportData,
      importData,
    }),
    [
      tasks,
      projects,
      taskTypes,
      memos,
      setting,
      isReady,
      createTask,
      updateTask,
      removeTask,
      upsertProject,
      deleteProject,
      upsertTaskType,
      deleteTaskType,
      saveMemo,
      updateSetting,
      exportData,
      importData,
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
