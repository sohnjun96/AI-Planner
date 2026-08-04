import Dexie, { type Table } from "dexie";
import {
  clampLlmTemperature,
  DEFAULT_LLM_CHAT_COMPLETIONS_URL,
  DEFAULT_PROJECTS,
  DEFAULT_SETTING,
  DEFAULT_TASK_TYPES,
  DEFAULT_USER_CONTEXT,
  DEFAULT_USER_CONTEXT_PREFERENCE_RULES,
  normalizeLlmGemmaThinkingEnabled,
  normalizeLlmReasoningEffort,
  SETTINGS_ID,
  USER_CONTEXT_ID,
} from "./constants";
import type {
  AppSetting,
  ArchiveInsightCache,
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
  archiveInsightCaches!: Table<ArchiveInsightCache, string>;

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
    this.version(5).stores({
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
      archiveInsightCaches: "id, updatedAt",
    });
  }
}

export const db = new ScheduleDB();

function sanitizePersistentSetting(setting: AppSetting): AppSetting {
  const sanitized = { ...setting, llmEndpoint: DEFAULT_LLM_CHAT_COMPLETIONS_URL };
  delete sanitized.llmApiKey;
  return sanitized;
}

const LEGACY_DEADLINE_PREFERENCE =
  "시간 없이 특정 날짜까지 일정을 생성해 달라고 요청하면 해당 일정의 시간을 18:00으로 설정한다.";
const LEGACY_SUBMIT_RULE_NOTE = "시간 없는 제출 일정은 18:00까지로 잡고 중요 일정으로 표시합니다.";

function mergeRequiredUserContextPreferences(markdown: string): string {
  const deadlinePreference = DEFAULT_USER_CONTEXT_PREFERENCE_RULES[1];
  const migratedMarkdown = markdown
    .split(/\r?\n/)
    .map((line) =>
      line.trim() === `- ${LEGACY_DEADLINE_PREFERENCE}` ? `- ${deadlinePreference}` : line,
    )
    .join("\n");
  const missingRules = DEFAULT_USER_CONTEXT_PREFERENCE_RULES.filter((rule) => !migratedMarkdown.includes(rule));
  if (missingRules.length === 0) {
    return migratedMarkdown;
  }

  const lines = migratedMarkdown.trimEnd().split(/\r?\n/);
  const heading = "## 선호 규칙";
  const headingIndex = lines.findIndex((line) => line.trim() === heading);
  if (headingIndex >= 0) {
    const nextHeadingIndex = lines.findIndex((line, index) => index > headingIndex && line.startsWith("## "));
    const insertAt = nextHeadingIndex >= 0 ? nextHeadingIndex : lines.length;
    lines.splice(insertAt, 0, ...missingRules.map((rule) => `- ${rule}`), "");
    return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
  }

  return `${migratedMarkdown.trimEnd()}\n\n${heading}\n${missingRules.map((rule) => `- ${rule}`).join("\n")}\n`;
}

export async function bootstrapDatabase(): Promise<void> {
  const now = toIsoNow();

  const existingTaskTypes = await db.taskTypes.limit(200).toArray();
  const legacyTripType = existingTaskTypes.find(
    (type) => type.id === "type-trip" && type.color.toLowerCase() === "#7c3aed",
  );
  if (legacyTripType) {
    await db.taskTypes.update(legacyTripType.id, {
      color: "#1d4ed8",
      updatedAt: now,
    });
  }
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

  const existingProjects = await db.projects.limit(1_000).toArray();
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

  const normalizedLlmTemperature = clampLlmTemperature(setting?.llmTemperature);
  const normalizedLlmReasoningEffort = normalizeLlmReasoningEffort(setting?.llmReasoningEffort);
  const normalizedLlmGemmaThinkingEnabled = normalizeLlmGemmaThinkingEnabled(setting?.llmGemmaThinkingEnabled);

  if (
    setting &&
    (
      setting.llmEndpoint !== DEFAULT_LLM_CHAT_COMPLETIONS_URL ||
      setting.llmApiKey !== undefined ||
      setting.rememberLlmApiKey === undefined ||
      setting.llmModel === undefined ||
      setting.llmTemperature !== normalizedLlmTemperature ||
      setting.llmReasoningEffort !== normalizedLlmReasoningEffort ||
      setting.llmGemmaThinkingEnabled !== normalizedLlmGemmaThinkingEnabled ||
      setting.notificationsEnabled === undefined ||
      setting.notifyBeforeMinutes === undefined ||
      setting.autoBackupEnabled === undefined ||
      setting.autoBackupIntervalMinutes === undefined ||
      setting.aiContextMaxLength === undefined ||
      setting.noteTaskSuggestionsEnabled === undefined ||
      setting.relatedNoteSuggestionsEnabled === undefined
    )
  ) {
    await db.settings.put(sanitizePersistentSetting({
      ...setting,
      llmEndpoint: DEFAULT_LLM_CHAT_COMPLETIONS_URL,
      rememberLlmApiKey: setting.rememberLlmApiKey === true,
      llmModel: setting.llmModel ?? DEFAULT_SETTING.llmModel,
      llmTemperature: normalizedLlmTemperature,
      llmReasoningEffort: normalizedLlmReasoningEffort,
      llmGemmaThinkingEnabled: normalizedLlmGemmaThinkingEnabled,
      notificationsEnabled: setting.notificationsEnabled ?? DEFAULT_SETTING.notificationsEnabled,
      notifyBeforeMinutes: setting.notifyBeforeMinutes ?? DEFAULT_SETTING.notifyBeforeMinutes,
      autoBackupEnabled: setting.autoBackupEnabled ?? DEFAULT_SETTING.autoBackupEnabled,
      autoBackupIntervalMinutes: setting.autoBackupIntervalMinutes ?? DEFAULT_SETTING.autoBackupIntervalMinutes,
      aiContextMaxLength: setting.aiContextMaxLength ?? DEFAULT_SETTING.aiContextMaxLength,
      noteTaskSuggestionsEnabled: setting.noteTaskSuggestionsEnabled ?? DEFAULT_SETTING.noteTaskSuggestionsEnabled,
      relatedNoteSuggestionsEnabled: setting.relatedNoteSuggestionsEnabled ?? DEFAULT_SETTING.relatedNoteSuggestionsEnabled,
      updatedAt: now,
    }));
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
  } else {
    const markdown = mergeRequiredUserContextPreferences(userContext.markdown);
    const rules = userContext.rules.map((rule) =>
      rule.id === "context-submit-default" && rule.source === "default" && rule.note === LEGACY_SUBMIT_RULE_NOTE
        ? {
            ...rule,
            note: "시간 없는 제출 일정은 18:00을 시작 시각으로 잡고 종료 시각 없이 중요 일정으로 표시합니다.",
            updatedAt: now,
          }
        : rule,
    );
    const rulesChanged = rules.some((rule, index) => rule !== userContext.rules[index]);
    if (markdown !== userContext.markdown || rulesChanged) {
      await db.userContexts.put({
        ...userContext,
        markdown,
        rules,
        updatedAt: now,
      });
    }
  }
}
