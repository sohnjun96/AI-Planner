import {
  clampLlmTemperature,
  DEFAULT_LLM_CHAT_COMPLETIONS_URL,
  DEFAULT_SETTING,
  isValidLlmModelId,
  normalizeLlmGemmaThinkingEnabled,
  normalizeLlmReasoningEffort,
  SETTINGS_ID,
  USER_CONTEXT_ID,
} from "../constants";
import type {
  AppSetting,
  ArchiveInsightCache,
  Memo,
  Note,
  NoteTaskLink,
  NoteVersion,
  Project,
  ProjectSubcategory,
  RecurrencePattern,
  Task,
  TaskType,
  UserContext,
  UserContextRule,
} from "../models";

export const BACKUP_VERSION = 5;
export const MAX_IMPORT_FILE_BYTES = 5_000_000;

export interface ValidatedImportPayload {
  tasks: Task[];
  projects: Project[];
  taskTypes: TaskType[];
  memos: Memo[];
  settings: AppSetting[];
  userContexts: UserContext[];
  notes: Note[];
  noteVersions: NoteVersion[];
  noteTaskLinks: NoteTaskLink[];
  projectSubcategories: ProjectSubcategory[];
  archiveInsightCaches: ArchiveInsightCache[];
  version: number;
  exportedAt: string;
}

const LIMITS = {
  tasks: 20_000,
  projects: 1_000,
  taskTypes: 200,
  memos: 10_000,
  settings: 1,
  userContexts: 1,
  notes: 10_000,
  noteVersions: 20_000,
  noteTaskLinks: 20_000,
  projectSubcategories: 5_000,
  archiveInsightCaches: 5_000,
} as const;

function fail(message: string): never {
  throw new Error(`백업 검증 실패: ${message}`);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} 형식이 올바르지 않습니다.`);
  return value as Record<string, unknown>;
}

function array(value: unknown, label: keyof typeof LIMITS): unknown[] {
  if (!Array.isArray(value)) fail(`${label} 배열이 없습니다.`);
  if (value.length > LIMITS[label]) fail(`${label} 항목 수가 허용 한도를 초과했습니다.`);
  return value;
}

function text(value: unknown, label: string, max: number, allowEmpty = false): string {
  if (typeof value !== "string" || value.length > max || (!allowEmpty && !value.trim())) {
    fail(`${label} 문자열이 올바르지 않습니다.`);
  }
  return value;
}

function optionalText(value: unknown, label: string, max: number): string | undefined {
  return value === undefined || value === null || value === "" ? undefined : text(value, label, max);
}

function id(value: unknown, label: string): string {
  const normalized = text(value, label, 128);
  if (!/^[A-Za-z0-9._:-]+$/.test(normalized)) fail(`${label} 식별자 형식이 올바르지 않습니다.`);
  return normalized;
}

function iso(value: unknown, label: string, optional = false): string | undefined {
  if (optional && (value === undefined || value === null || value === "")) return undefined;
  const normalized = text(value, label, 40);
  if (!Number.isFinite(new Date(normalized).getTime())) fail(`${label} 날짜가 올바르지 않습니다.`);
  return normalized;
}

function bool(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") fail(`${label} 값이 boolean이 아닙니다.`);
  return value;
}

function integer(value: unknown, label: string, min: number, max: number, optional = false): number | undefined {
  if (optional && value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    fail(`${label} 숫자가 허용 범위를 벗어났습니다.`);
  }
  return value;
}

function oneOf<T extends string>(value: unknown, label: string, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) fail(`${label} 값이 허용 목록에 없습니다.`);
  return value as T;
}

function uniqueIds<T extends { id: string }>(items: T[], label: string): T[] {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) fail(`${label}에 중복 ID가 있습니다.`);
    seen.add(item.id);
  }
  return items;
}

function stringIds(value: unknown, label: string, maxItems = 200): string[] {
  if (!Array.isArray(value) || value.length > maxItems) fail(`${label} 배열이 올바르지 않습니다.`);
  return Array.from(new Set(value.map((item, index) => id(item, `${label}[${index}]`))));
}

function parseTask(value: unknown, index: number): Task {
  const item = record(value, `tasks[${index}]`);
  return {
    id: id(item.id, `tasks[${index}].id`),
    title: text(item.title, `tasks[${index}].title`, 500),
    content: text(item.content, `tasks[${index}].content`, 100_000, true),
    taskTypeId: id(item.taskTypeId, `tasks[${index}].taskTypeId`),
    projectId: id(item.projectId, `tasks[${index}].projectId`),
    status: oneOf(item.status, `tasks[${index}].status`, ["NOT_DONE", "ON_HOLD", "DONE", "CANCELED"]),
    startAt: iso(item.startAt, `tasks[${index}].startAt`)!,
    endAt: iso(item.endAt, `tasks[${index}].endAt`, true),
    isMajor: bool(item.isMajor, `tasks[${index}].isMajor`),
    createdAt: iso(item.createdAt, `tasks[${index}].createdAt`)!,
    updatedAt: iso(item.updatedAt, `tasks[${index}].updatedAt`)!,
    completedAt: iso(item.completedAt, `tasks[${index}].completedAt`, true),
    canceledAt: iso(item.canceledAt, `tasks[${index}].canceledAt`, true),
    recurrencePattern: item.recurrencePattern === undefined
      ? undefined
      : oneOf<RecurrencePattern>(item.recurrencePattern, `tasks[${index}].recurrencePattern`, ["NONE", "DAILY", "WEEKLY", "MONTHLY"]),
    recurrenceGroupId: item.recurrenceGroupId === undefined ? undefined : id(item.recurrenceGroupId, `tasks[${index}].recurrenceGroupId`),
    recurrenceIndex: integer(item.recurrenceIndex, `tasks[${index}].recurrenceIndex`, 0, 100_000, true),
    linkedNoteIds: item.linkedNoteIds === undefined ? undefined : stringIds(item.linkedNoteIds, `tasks[${index}].linkedNoteIds`),
  };
}

function parseProject(value: unknown, index: number): Project {
  const item = record(value, `projects[${index}]`);
  const color = text(item.color, `projects[${index}].color`, 20);
  if (!/^#[0-9a-f]{6}$/i.test(color)) fail(`projects[${index}].color 형식이 올바르지 않습니다.`);
  return {
    id: id(item.id, `projects[${index}].id`),
    name: text(item.name, `projects[${index}].name`, 200),
    color,
    description: optionalText(item.description, `projects[${index}].description`, 2_000),
    isActive: bool(item.isActive, `projects[${index}].isActive`),
    order: integer(item.order, `projects[${index}].order`, 0, 100_000, true),
    createdAt: iso(item.createdAt, `projects[${index}].createdAt`)!,
    updatedAt: iso(item.updatedAt, `projects[${index}].updatedAt`)!,
  };
}

function parseTaskType(value: unknown, index: number): TaskType {
  const item = record(value, `taskTypes[${index}]`);
  const color = text(item.color, `taskTypes[${index}].color`, 20);
  if (!/^#[0-9a-f]{6}$/i.test(color)) fail(`taskTypes[${index}].color 형식이 올바르지 않습니다.`);
  return {
    id: id(item.id, `taskTypes[${index}].id`),
    name: text(item.name, `taskTypes[${index}].name`, 200),
    color,
    isDefault: bool(item.isDefault, `taskTypes[${index}].isDefault`),
    isActive: bool(item.isActive, `taskTypes[${index}].isActive`),
    order: integer(item.order, `taskTypes[${index}].order`, 0, 100_000)!,
    createdAt: iso(item.createdAt, `taskTypes[${index}].createdAt`)!,
    updatedAt: iso(item.updatedAt, `taskTypes[${index}].updatedAt`)!,
  };
}

function parseMemo(value: unknown, index: number): Memo {
  const item = record(value, `memos[${index}]`);
  const date = text(item.date, `memos[${index}].date`, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail(`memos[${index}].date 형식이 올바르지 않습니다.`);
  return { id: id(item.id, `memos[${index}].id`), date, content: text(item.content, `memos[${index}].content`, 100_000, true), updatedAt: iso(item.updatedAt, `memos[${index}].updatedAt`)! };
}

function parseSetting(value: unknown): AppSetting {
  const item = record(value, "settings[0]");
  const actionsRaw = item.noteAiActions === undefined ? DEFAULT_SETTING.noteAiActions ?? [] : item.noteAiActions;
  if (!Array.isArray(actionsRaw) || actionsRaw.length > 20) fail("settings[0].noteAiActions 배열이 올바르지 않습니다.");
  return {
    id: SETTINGS_ID,
    showPastCompleted: item.showPastCompleted === true,
    weekStartsOn: item.weekStartsOn === "mon" ? "mon" : "sun",
    timeFormat: item.timeFormat === "12h" ? "12h" : "24h",
    llmEndpoint: DEFAULT_LLM_CHAT_COMPLETIONS_URL,
    rememberLlmApiKey: item.rememberLlmApiKey === true,
    llmModel: isValidLlmModelId(item.llmModel) ? item.llmModel.trim() : DEFAULT_SETTING.llmModel,
    llmTemperature: clampLlmTemperature(item.llmTemperature),
    llmReasoningEffort: normalizeLlmReasoningEffort(item.llmReasoningEffort),
    llmGemmaThinkingEnabled: normalizeLlmGemmaThinkingEnabled(item.llmGemmaThinkingEnabled),
    notificationsEnabled: item.notificationsEnabled !== false,
    notifyBeforeMinutes: typeof item.notifyBeforeMinutes === "number" ? Math.max(0, Math.min(1_440, Math.floor(item.notifyBeforeMinutes))) : DEFAULT_SETTING.notifyBeforeMinutes,
    autoBackupEnabled: item.autoBackupEnabled !== false,
    autoBackupIntervalMinutes: typeof item.autoBackupIntervalMinutes === "number" ? Math.max(15, Math.min(1_440, Math.floor(item.autoBackupIntervalMinutes))) : DEFAULT_SETTING.autoBackupIntervalMinutes,
    aiContextMaxLength: typeof item.aiContextMaxLength === "number" ? Math.max(500, Math.min(8_000, Math.floor(item.aiContextMaxLength))) : DEFAULT_SETTING.aiContextMaxLength,
    noteAiActions: actionsRaw.map((raw, index) => {
      const action = record(raw, `settings[0].noteAiActions[${index}]`);
      return { id: id(action.id, `settings[0].noteAiActions[${index}].id`), label: text(action.label, `settings[0].noteAiActions[${index}].label`, 100), prompt: text(action.prompt, `settings[0].noteAiActions[${index}].prompt`, 4_000) };
    }),
    noteTaskSuggestionsEnabled: item.noteTaskSuggestionsEnabled === true,
    relatedNoteSuggestionsEnabled: item.relatedNoteSuggestionsEnabled === true,
    updatedAt: iso(item.updatedAt, "settings[0].updatedAt") ?? new Date().toISOString(),
  };
}

function parseRule(value: unknown, index: number): UserContextRule {
  const item = record(value, `userContexts[0].rules[${index}]`);
  return {
    id: id(item.id, `userContexts[0].rules[${index}].id`),
    category: oneOf(item.category, `userContexts[0].rules[${index}].category`, ["time", "classification", "preference"]),
    label: text(item.label, `userContexts[0].rules[${index}].label`, 200),
    trigger: Array.isArray(item.trigger) && item.trigger.length <= 20 ? item.trigger.map((entry, triggerIndex) => text(entry, `trigger[${triggerIndex}]`, 100)) : fail("사용자 규칙 trigger가 올바르지 않습니다."),
    projectId: item.projectId === undefined ? undefined : id(item.projectId, `userContexts[0].rules[${index}].projectId`),
    taskTypeId: item.taskTypeId === undefined ? undefined : id(item.taskTypeId, `userContexts[0].rules[${index}].taskTypeId`),
    defaultTime: optionalText(item.defaultTime, `userContexts[0].rules[${index}].defaultTime`, 20),
    isMajor: item.isMajor === undefined ? undefined : bool(item.isMajor, `userContexts[0].rules[${index}].isMajor`),
    note: optionalText(item.note, `userContexts[0].rules[${index}].note`, 2_000),
    source: oneOf(item.source, `userContexts[0].rules[${index}].source`, ["default", "user", "ai"]),
    isActive: bool(item.isActive, `userContexts[0].rules[${index}].isActive`),
    createdAt: iso(item.createdAt, `userContexts[0].rules[${index}].createdAt`)!,
    updatedAt: iso(item.updatedAt, `userContexts[0].rules[${index}].updatedAt`)!,
  };
}

function parseUserContext(value: unknown): UserContext {
  const item = record(value, "userContexts[0]");
  if (!Array.isArray(item.rules) || item.rules.length > 100) fail("사용자 규칙 수가 허용 한도를 초과했습니다.");
  return { id: USER_CONTEXT_ID, markdown: text(item.markdown, "userContexts[0].markdown", 20_000, true), rules: uniqueIds(item.rules.map(parseRule), "사용자 규칙"), updatedAt: iso(item.updatedAt, "userContexts[0].updatedAt")! };
}

function parseNote(value: unknown, index: number): Note {
  const item = record(value, `notes[${index}]`);
  const tags = Array.isArray(item.tags) && item.tags.length <= 50 ? item.tags.map((tag, tagIndex) => text(tag, `notes[${index}].tags[${tagIndex}]`, 100)) : fail(`notes[${index}].tags 배열이 올바르지 않습니다.`);
  return {
    id: id(item.id, `notes[${index}].id`), title: text(item.title, `notes[${index}].title`, 500), content: text(item.content, `notes[${index}].content`, 500_000, true),
    projectId: id(item.projectId, `notes[${index}].projectId`), subcategoryId: item.subcategoryId === undefined ? undefined : id(item.subcategoryId, `notes[${index}].subcategoryId`),
    tags: Array.from(new Set(tags)), status: oneOf(item.status, `notes[${index}].status`, ["draft", "active", "archived"]), isPinned: bool(item.isPinned, `notes[${index}].isPinned`),
    linkedTaskIds: stringIds(item.linkedTaskIds, `notes[${index}].linkedTaskIds`), aiClassifiedAt: iso(item.aiClassifiedAt, `notes[${index}].aiClassifiedAt`, true),
    sortOrder: integer(item.sortOrder, `notes[${index}].sortOrder`, 0, 1_000_000, true), createdAt: iso(item.createdAt, `notes[${index}].createdAt`)!, updatedAt: iso(item.updatedAt, `notes[${index}].updatedAt`)!,
  };
}

function parseNoteVersion(value: unknown, index: number): NoteVersion {
  const item = record(value, `noteVersions[${index}]`);
  return { id: id(item.id, `noteVersions[${index}].id`), noteId: id(item.noteId, `noteVersions[${index}].noteId`), title: text(item.title, `noteVersions[${index}].title`, 500), content: text(item.content, `noteVersions[${index}].content`, 500_000, true), editType: oneOf(item.editType, `noteVersions[${index}].editType`, ["manual", "ai_full", "ai_inline", "autosave", "restore"]), aiPrompt: optionalText(item.aiPrompt, `noteVersions[${index}].aiPrompt`, 4_000), createdAt: iso(item.createdAt, `noteVersions[${index}].createdAt`)! };
}

function parseNoteTaskLink(value: unknown, index: number): NoteTaskLink {
  const item = record(value, `noteTaskLinks[${index}]`);
  return { id: id(item.id, `noteTaskLinks[${index}].id`), noteId: id(item.noteId, `noteTaskLinks[${index}].noteId`), taskId: id(item.taskId, `noteTaskLinks[${index}].taskId`), source: oneOf(item.source, `noteTaskLinks[${index}].source`, ["auto_suggest", "manual"]), createdAt: iso(item.createdAt, `noteTaskLinks[${index}].createdAt`)! };
}

function parseSubcategory(value: unknown, index: number): ProjectSubcategory {
  const item = record(value, `projectSubcategories[${index}]`);
  return { id: id(item.id, `projectSubcategories[${index}].id`), projectId: id(item.projectId, `projectSubcategories[${index}].projectId`), name: text(item.name, `projectSubcategories[${index}].name`, 200), order: integer(item.order, `projectSubcategories[${index}].order`, 0, 100_000)!, createdAt: iso(item.createdAt, `projectSubcategories[${index}].createdAt`)!, updatedAt: iso(item.updatedAt, `projectSubcategories[${index}].updatedAt`)! };
}

function parseCache(value: unknown, index: number): ArchiveInsightCache {
  const item = record(value, `archiveInsightCaches[${index}]`);
  return { id: id(item.id, `archiveInsightCaches[${index}].id`), sourceFingerprint: text(item.sourceFingerprint, `archiveInsightCaches[${index}].sourceFingerprint`, 256), payload: text(item.payload, `archiveInsightCaches[${index}].payload`, 500_000, true), lastAttemptedAt: iso(item.lastAttemptedAt, `archiveInsightCaches[${index}].lastAttemptedAt`, true), updatedAt: iso(item.updatedAt, `archiveInsightCaches[${index}].updatedAt`)! };
}

function requireReference(ids: Set<string>, value: string | undefined, label: string): void {
  if (value !== undefined && !ids.has(value)) fail(`${label} 참조 대상이 없습니다.`);
}

export function parseAndSanitizeImportPayload(raw: string): ValidatedImportPayload {
  if (new TextEncoder().encode(raw).byteLength > MAX_IMPORT_FILE_BYTES) fail("파일 크기가 허용 한도를 초과했습니다.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail("JSON 형식이 올바르지 않습니다.");
  }
  const root = record(parsed, "root");
  if (root.version !== 4 && root.version !== BACKUP_VERSION) fail(`지원하는 백업 버전은 4와 ${BACKUP_VERSION}입니다.`);

  const projects = uniqueIds(array(root.projects, "projects").map(parseProject), "projects");
  const taskTypes = uniqueIds(array(root.taskTypes, "taskTypes").map(parseTaskType), "taskTypes");
  const tasks = uniqueIds(array(root.tasks, "tasks").map(parseTask), "tasks");
  const memos = uniqueIds(array(root.memos, "memos").map(parseMemo), "memos");
  const settingsRaw = array(root.settings, "settings");
  const settings = settingsRaw.length === 0 ? [] : [parseSetting(settingsRaw[0])];
  const contextsRaw = array(root.userContexts ?? [], "userContexts");
  const userContexts = contextsRaw.length === 0 ? [] : [parseUserContext(contextsRaw[0])];
  const notes = uniqueIds(array(root.notes ?? [], "notes").map(parseNote), "notes");
  const noteVersions = uniqueIds(array(root.noteVersions ?? [], "noteVersions").map(parseNoteVersion), "noteVersions");
  const noteTaskLinks = uniqueIds(array(root.noteTaskLinks ?? [], "noteTaskLinks").map(parseNoteTaskLink), "noteTaskLinks");
  const projectSubcategories = uniqueIds(array(root.projectSubcategories ?? [], "projectSubcategories").map(parseSubcategory), "projectSubcategories");
  const archiveInsightCaches = uniqueIds(array(root.archiveInsightCaches ?? [], "archiveInsightCaches").map(parseCache), "archiveInsightCaches");

  const projectIds = new Set(projects.map((item) => item.id));
  const typeIds = new Set(taskTypes.map((item) => item.id));
  const taskIds = new Set(tasks.map((item) => item.id));
  const noteIds = new Set(notes.map((item) => item.id));
  const subcategoryIds = new Set(projectSubcategories.map((item) => item.id));
  tasks.forEach((item) => {
    requireReference(projectIds, item.projectId, `task ${item.id}.projectId`);
    requireReference(typeIds, item.taskTypeId, `task ${item.id}.taskTypeId`);
    item.linkedNoteIds?.forEach((noteId) => requireReference(noteIds, noteId, `task ${item.id}.linkedNoteIds`));
    if (item.endAt && new Date(item.endAt).getTime() < new Date(item.startAt).getTime()) fail(`task ${item.id} 종료 시간이 시작 시간보다 빠릅니다.`);
  });
  projectSubcategories.forEach((item) => requireReference(projectIds, item.projectId, `subcategory ${item.id}.projectId`));
  notes.forEach((item) => { requireReference(projectIds, item.projectId, `note ${item.id}.projectId`); requireReference(subcategoryIds, item.subcategoryId, `note ${item.id}.subcategoryId`); item.linkedTaskIds.forEach((taskId) => requireReference(taskIds, taskId, `note ${item.id}.linkedTaskIds`)); });
  noteVersions.forEach((item) => requireReference(noteIds, item.noteId, `noteVersion ${item.id}.noteId`));
  const noteTaskPairs = new Set<string>();
  noteTaskLinks.forEach((item) => {
    requireReference(noteIds, item.noteId, `noteTaskLink ${item.id}.noteId`);
    requireReference(taskIds, item.taskId, `noteTaskLink ${item.id}.taskId`);
    const pair = `${item.noteId}\u0000${item.taskId}`;
    if (noteTaskPairs.has(pair)) fail("중복된 노트-일정 연결이 있습니다.");
    noteTaskPairs.add(pair);
  });
  userContexts.flatMap((context) => context.rules).forEach((rule) => {
    requireReference(projectIds, rule.projectId, `userContextRule ${rule.id}.projectId`);
    requireReference(typeIds, rule.taskTypeId, `userContextRule ${rule.id}.taskTypeId`);
  });

  return {
    tasks, projects, taskTypes, memos, settings, userContexts, notes, noteVersions, noteTaskLinks,
    projectSubcategories, archiveInsightCaches, version: BACKUP_VERSION,
    exportedAt: iso(root.exportedAt, "exportedAt") ?? new Date().toISOString(),
  };
}

export function stripSecretsFromBackupRaw(raw: string): string {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (Array.isArray(value.settings)) {
      value.settings = value.settings.map((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
        const sanitized: Record<string, unknown> = {
          ...(entry as Record<string, unknown>),
          llmEndpoint: DEFAULT_LLM_CHAT_COMPLETIONS_URL,
        };
        delete sanitized.llmApiKey;
        return sanitized;
      });
    }
    return JSON.stringify(value);
  } catch {
    return raw;
  }
}
