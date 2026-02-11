import Dexie, { type Table } from "dexie";
import { DEFAULT_PROJECT, DEFAULT_SETTING, DEFAULT_TASK_TYPES, SETTINGS_ID } from "./constants";
import type { AppSetting, Memo, Project, Task, TaskType } from "./models";
import { toIsoNow } from "./utils/date";

class ScheduleDB extends Dexie {
  tasks!: Table<Task, string>;
  projects!: Table<Project, string>;
  taskTypes!: Table<TaskType, string>;
  memos!: Table<Memo, string>;
  settings!: Table<AppSetting, string>;

  constructor() {
    super("schedule-manager-db");
    this.version(1).stores({
      tasks: "id, startAt, status, projectId, taskTypeId, isMajor, updatedAt",
      projects: "id, name, isActive, updatedAt",
      taskTypes: "id, name, isDefault, isActive, order, updatedAt",
      memos: "id, date, updatedAt",
      settings: "id, updatedAt",
    });
  }
}

export const db = new ScheduleDB();

export async function bootstrapDatabase(): Promise<void> {
  const now = toIsoNow();

  const taskTypeCount = await db.taskTypes.count();
  if (taskTypeCount === 0) {
    const seeded = DEFAULT_TASK_TYPES.map((type) => ({
      ...type,
      createdAt: now,
      updatedAt: now,
    }));
    await db.taskTypes.bulkAdd(seeded);
  }

  const projectCount = await db.projects.count();
  if (projectCount === 0) {
    await db.projects.add({
      ...DEFAULT_PROJECT,
      createdAt: now,
      updatedAt: now,
    });
  }

  const setting = await db.settings.get(SETTINGS_ID);
  if (!setting) {
    await db.settings.add({
      ...DEFAULT_SETTING,
      updatedAt: now,
    });
    return;
  }

  if (setting.llmApiKey === undefined || setting.llmModel === undefined) {
    await db.settings.put({
      ...setting,
      llmApiKey: setting.llmApiKey ?? DEFAULT_SETTING.llmApiKey,
      llmModel: setting.llmModel ?? DEFAULT_SETTING.llmModel,
      updatedAt: now,
    });
  }
}
