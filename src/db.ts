import Dexie, { type Table } from "dexie";
import { DEFAULT_PROJECTS, DEFAULT_SETTING, DEFAULT_TASK_TYPES, DEFAULT_USER_CONTEXT, SETTINGS_ID, USER_CONTEXT_ID } from "./constants";
import type {
  AppSetting,
  Memo,
  Note,
  NoteTaskLink,
  NoteVersion,
  Project,
  ProjectSubcategory,
  Task,
  TaskType,
  UserContext,
} from "./models";
import { toIsoNow } from "./utils/date";

class ScheduleDB extends Dexie {
  tasks!: Table<Task, string>;
  projects!: Table<Project, string>;
  taskTypes!: Table<TaskType, string>;
  memos!: Table<Memo, string>;
  settings!: Table<AppSetting, string>;
  userContexts!: Table<UserContext, string>;
  notes!: Table<Note, string>;
  noteVersions!: Table<NoteVersion, string>;
  noteTaskLinks!: Table<NoteTaskLink, string>;
  projectSubcategories!: Table<ProjectSubcategory, string>;

  constructor() {
    super("schedule-manager-db");
    this.version(1).stores({
      tasks: "id, startAt, status, projectId, taskTypeId, isMajor, updatedAt",
      projects: "id, name, isActive, updatedAt",
      taskTypes: "id, name, isDefault, isActive, order, updatedAt",
      memos: "id, date, updatedAt",
      settings: "id, updatedAt",
    });
    this.version(2).stores({
      tasks: "id, startAt, status, projectId, taskTypeId, isMajor, updatedAt",
      projects: "id, name, isActive, updatedAt",
      taskTypes: "id, name, isDefault, isActive, order, updatedAt",
      memos: "id, date, updatedAt",
      settings: "id, updatedAt",
      userContexts: "id, updatedAt",
    });
    this.version(3).stores({
      tasks: "id, startAt, status, projectId, taskTypeId, isMajor, updatedAt",
      projects: "id, name, isActive, updatedAt",
      taskTypes: "id, name, isDefault, isActive, order, updatedAt",
      memos: "id, date, updatedAt",
      settings: "id, updatedAt",
      userContexts: "id, updatedAt",
      notes: "id, projectId, status, isPinned, updatedAt, createdAt",
      noteVersions: "id, noteId, editType, createdAt",
      noteTaskLinks: "id, noteId, taskId, [noteId+taskId], createdAt",
    });
    this.version(4).stores({
      tasks: "id, startAt, status, projectId, taskTypeId, isMajor, updatedAt",
      projects: "id, name, isActive, updatedAt",
      taskTypes: "id, name, isDefault, isActive, order, updatedAt",
      memos: "id, date, updatedAt",
      settings: "id, updatedAt",
      userContexts: "id, updatedAt",
      notes: "id, projectId, subcategoryId, status, isPinned, updatedAt, createdAt",
      noteVersions: "id, noteId, editType, createdAt",
      noteTaskLinks: "id, noteId, taskId, [noteId+taskId], createdAt",
      projectSubcategories: "id, projectId, order, updatedAt",
    });
  }
}

export const db = new ScheduleDB();

export async function bootstrapDatabase(): Promise<void> {
  const now = toIsoNow();

  const existingTaskTypes = await db.taskTypes.toArray();
  const existingTaskTypeNames = new Set(existingTaskTypes.map((type) => type.name.trim().toLowerCase()));
  const existingTaskTypeIds = new Set(existingTaskTypes.map((type) => type.id));
  const missingTaskTypes = DEFAULT_TASK_TYPES.filter(
    (type) => !existingTaskTypeIds.has(type.id) && !existingTaskTypeNames.has(type.name.trim().toLowerCase()),
  );
  if (missingTaskTypes.length > 0) {
    const highestOrder = existingTaskTypes.reduce((max, type) => Math.max(max, type.order), 0);
    const seeded = missingTaskTypes.map((type, index) => ({
      ...type,
      order: existingTaskTypes.length === 0 ? type.order : highestOrder + index + 1,
      createdAt: now,
      updatedAt: now,
    }));
    await db.taskTypes.bulkPut(seeded);
  }

  const existingProjects = await db.projects.toArray();
  const existingProjectNames = new Set(existingProjects.map((project) => project.name.trim().toLowerCase()));
  const existingProjectIds = new Set(existingProjects.map((project) => project.id));
  const missingProjects = DEFAULT_PROJECTS.filter(
    (project) => !existingProjectIds.has(project.id) && !existingProjectNames.has(project.name.trim().toLowerCase()),
  );
  if (missingProjects.length > 0) {
    await db.projects.bulkPut(missingProjects.map((project) => ({
      ...project,
      createdAt: now,
      updatedAt: now,
    })));
  }

  const setting = await db.settings.get(SETTINGS_ID);
  if (!setting) {
    await db.settings.put({
      ...DEFAULT_SETTING,
      updatedAt: now,
    });
  }

  if (
    setting &&
    (
      setting.llmEndpoint === undefined ||
      setting.llmApiKey === undefined ||
      setting.llmModel === undefined ||
      setting.notificationsEnabled === undefined ||
      setting.notifyBeforeMinutes === undefined ||
      setting.autoBackupEnabled === undefined ||
      setting.autoBackupIntervalMinutes === undefined ||
      setting.aiContextMaxLength === undefined
    )
  ) {
    await db.settings.put({
      ...setting,
      llmEndpoint: setting.llmEndpoint ?? DEFAULT_SETTING.llmEndpoint,
      llmApiKey: setting.llmApiKey ?? DEFAULT_SETTING.llmApiKey,
      llmModel: setting.llmModel ?? DEFAULT_SETTING.llmModel,
      notificationsEnabled: setting.notificationsEnabled ?? DEFAULT_SETTING.notificationsEnabled,
      notifyBeforeMinutes: setting.notifyBeforeMinutes ?? DEFAULT_SETTING.notifyBeforeMinutes,
      autoBackupEnabled: setting.autoBackupEnabled ?? DEFAULT_SETTING.autoBackupEnabled,
      autoBackupIntervalMinutes: setting.autoBackupIntervalMinutes ?? DEFAULT_SETTING.autoBackupIntervalMinutes,
      aiContextMaxLength: setting.aiContextMaxLength ?? DEFAULT_SETTING.aiContextMaxLength,
      updatedAt: now,
    });
  }

  const userContext = await db.userContexts.get(USER_CONTEXT_ID);
  if (!userContext) {
    await db.userContexts.put({
      ...DEFAULT_USER_CONTEXT,
      rules: DEFAULT_USER_CONTEXT.rules.map((rule) => ({
        ...rule,
        createdAt: now,
        updatedAt: now,
      })),
      updatedAt: now,
    });
  }
}
