/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  clampLlmTemperature,
  DEFAULT_AI_CONTEXT_MAX_LENGTH,
  DEFAULT_AUTO_BACKUP_INTERVAL_MINUTES,
  DEFAULT_LLM_CHAT_COMPLETIONS_URL,
  DEFAULT_NOTE_AI_ACTIONS,
  DEFAULT_NOTIFY_BEFORE_MINUTES,
  DEFAULT_PROJECT_IDS,
  DEFAULT_SETTING,
  DEFAULT_USER_CONTEXT,
  isValidLlmModelId,
  LLM_MAX_API_KEY_LENGTH,
  MAX_AI_CONTEXT_MAX_LENGTH,
  MAX_AUTOSAVE_NOTE_VERSIONS,
  MAX_MANUAL_NOTE_VERSIONS,
  MIN_AI_CONTEXT_MAX_LENGTH,
  normalizeLlmGemmaThinkingEnabled,
  normalizeLlmReasoningEffort,
  SETTINGS_ID,
  USER_CONTEXT_ID,
} from "../constants";
import { bootstrapDatabase, db } from "../db";
import type {
  AppSetting,
  Memo,
  Note,
  NoteFormInput,
  NoteTaskLink,
  NoteTaskLinkSource,
  NoteVersion,
  NoteVersionEditType,
  Project,
  ProjectSubcategory,
  RecurrencePattern,
  Task,
  TaskFormInput,
  TaskType,
  UserContext,
  UserContextRule,
  UserContextSuggestion,
} from "../models";
import { toIsoNow } from "../utils/date";
import {
  BACKUP_VERSION,
  MAX_IMPORT_FILE_BYTES,
  parseAndSanitizeImportPayload,
  stripSecretsFromBackupRaw,
  type ValidatedImportPayload,
} from "../utils/importBackup";
import { getLunchAutoCompleteAt, isLunchTask } from "../utils/lunchTasks";
import { isTaskActive, isTaskCanceled, isTaskDone } from "../utils/taskStatus";

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

export interface ImportDataPreview {
  version?: number;
  exportedAt?: string;
  tasks: number;
  projects: number;
  taskTypes: number;
  memos: number;
  settings: number;
  userContexts: number;
  notes: number;
  noteVersions: number;
  noteTaskLinks: number;
  projectSubcategories: number;
  archiveInsightCaches: number;
}

interface AppDataContextValue {
  tasks: Task[];
  projects: Project[];
  taskTypes: TaskType[];
  memos: Memo[];
  notes: Note[];
  noteVersions: NoteVersion[];
  noteTaskLinks: NoteTaskLink[];
  projectSubcategories: ProjectSubcategory[];
  setting: AppSetting;
  userContext: UserContext;
  isReady: boolean;
  bootstrapError?: string;
  credentialStorageError?: string;
  retryBootstrap: () => Promise<void>;
  canUndo: boolean;
  undoDescription?: string;
  autoBackups: AutoBackupSummary[];
  createTask: (input: TaskFormInput) => Promise<string>;
  updateTask: (id: string, input: TaskFormInput) => Promise<void>;
  removeTask: (id: string) => Promise<void>;
  undoLastChange: () => Promise<void>;
  createNote: (input: NoteFormInput, editType?: NoteVersionEditType, aiPrompt?: string) => Promise<string>;
  updateNote: (id: string, input: NoteFormInput, editType?: NoteVersionEditType, aiPrompt?: string) => Promise<void>;
  applyNoteAiClassification: (id: string, projectId: string, subcategoryId?: string, expectedUpdatedAt?: string) => Promise<void>;
  removeNote: (id: string) => Promise<void>;
  restoreNoteVersion: (noteId: string, versionId: string) => Promise<void>;
  linkNoteToTask: (noteId: string, taskId: string, source?: NoteTaskLinkSource) => Promise<void>;
  unlinkNoteFromTask: (noteId: string, taskId: string) => Promise<void>;
  createSubcategory: (projectId: string, name: string) => Promise<string>;
  renameSubcategory: (id: string, name: string) => Promise<void>;
  deleteSubcategory: (id: string) => Promise<void>;
  upsertProject: (input: ProjectInput) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  reorderProjects: (orderedIds: string[]) => Promise<void>;
  reorderNotes: (orderedIds: string[]) => Promise<void>;
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
        | "llmEndpoint"
        | "llmApiKey"
        | "rememberLlmApiKey"
        | "llmModel"
        | "llmTemperature"
        | "llmReasoningEffort"
        | "llmGemmaThinkingEnabled"
        | "notificationsEnabled"
        | "notifyBeforeMinutes"
        | "autoBackupEnabled"
        | "autoBackupIntervalMinutes"
        | "aiContextMaxLength"
        | "noteAiActions"
        | "noteTaskSuggestionsEnabled"
        | "relatedNoteSuggestionsEnabled"
      >
    >,
  ) => Promise<void>;
  updateUserContextMarkdown: (markdown: string) => Promise<void>;
  resetUserContext: () => Promise<void>;
  acceptUserContextSuggestion: (suggestion: UserContextSuggestion) => Promise<void>;
  exportData: () => Promise<string>;
  inspectImportData: (raw: string) => ImportDataPreview;
  importData: (raw: string) => Promise<void>;
  createAutoBackup: (reason?: string) => Promise<void>;
  restoreAutoBackup: (id: string) => Promise<void>;
  deleteAutoBackup: (id: string) => Promise<void>;
  refreshAutoBackups: () => Promise<void>;
}

const AppDataContext = createContext<AppDataContextValue | undefined>(undefined);

const AUTO_BACKUPS_STORAGE_KEY = "schedule_auto_backups_v1";
const ALARM_SYNC_STORAGE_KEY = "schedule_alarm_payload_v1";
const LLM_CREDENTIAL_STORAGE_KEY = "planai_llm_credential_v1";
const MAX_AUTO_BACKUPS = 20;
const MAX_AUTO_BACKUP_TOTAL_BYTES = 8_000_000;
const IMPORT_BATCH_SIZE = 500;
const MAX_ALARM_SYNC_TASKS = 2_000;
const LIVE_QUERY_LIMITS = {
  tasks: 20_000,
  projects: 1_000,
  taskTypes: 200,
  memos: 10_000,
  notes: 10_000,
  noteVersions: 20_000,
  noteTaskLinks: 20_000,
  projectSubcategories: 5_000,
  settings: 1,
  userContexts: 1,
  archiveInsightCaches: 5_000,
} as const;
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

function trimTaskInput(input: TaskFormInput): TaskFormInput {
  const title = input.title.trim();
  const content = input.content.trim();
  if (!title || title.length > 500) throw new Error("일정 제목은 1~500자로 입력해 주세요.");
  if (content.length > 100_000) throw new Error("일정 내용은 100,000자 이하여야 합니다.");
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(input.taskTypeId) || !/^[A-Za-z0-9._:-]{1,128}$/.test(input.projectId)) {
    throw new Error("일정 분류 식별자가 올바르지 않습니다.");
  }
  if (!["NOT_DONE", "ON_HOLD", "DONE", "CANCELED"].includes(input.status)) {
    throw new Error("일정 상태가 올바르지 않습니다.");
  }
  if (input.recurrencePattern && !["NONE", "DAILY", "WEEKLY", "MONTHLY"].includes(input.recurrencePattern)) {
    throw new Error("반복 주기가 올바르지 않습니다.");
  }
  const startTime = new Date(input.startAt).getTime();
  const endTime = input.endAt ? new Date(input.endAt).getTime() : undefined;
  if (!Number.isFinite(startTime) || input.startAt.length > 40 || (endTime !== undefined && (!Number.isFinite(endTime) || endTime < startTime))) {
    throw new Error("일정 시작·종료 시간이 올바르지 않습니다.");
  }
  return {
    ...input,
    title,
    content,
  };
}

function normalizeNoteInput(input: NoteFormInput): NoteFormInput {
  const title = input.title.trim() || "제목 없는 노트";
  if (title.length > 500) throw new Error("노트 제목은 500자 이하여야 합니다.");
  if (input.content.length > 500_000) throw new Error("노트 내용은 500,000자 이하여야 합니다.");
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(input.projectId) || (input.subcategoryId && !/^[A-Za-z0-9._:-]{1,128}$/.test(input.subcategoryId))) {
    throw new Error("노트 분류 식별자가 올바르지 않습니다.");
  }
  if (!["draft", "active", "archived"].includes(input.status)) throw new Error("노트 상태가 올바르지 않습니다.");
  if (!Array.isArray(input.tags) || input.tags.length > 50) throw new Error("노트 태그는 최대 50개까지 지정할 수 있습니다.");
  const tags = Array.from(new Set(input.tags.map((tag) => tag.trim()).filter(Boolean)));
  if (tags.some((tag) => tag.length > 100)) throw new Error("각 노트 태그는 100자 이하여야 합니다.");
  return { ...input, title, tags };
}

function validateColor(value: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error("색상 값은 6자리 HEX 형식이어야 합니다.");
  return value;
}

async function assertCapacity(currentCount: Promise<number>, added: number, limit: number, label: string): Promise<void> {
  if ((await currentCount) + added > limit) {
    throw new Error(`${label} 항목 수가 안전 처리 한도(${limit.toLocaleString()}개)를 초과합니다.`);
  }
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
  const now = toIsoNow();
  return {
    title: input.title.trim(),
    content: input.content.trim(),
    taskTypeId: input.taskTypeId,
    projectId: input.projectId,
    status: input.status,
    startAt: input.startAt,
    endAt: input.endAt || undefined,
    isMajor: input.isMajor,
    completedAt: isTaskDone(input.status) ? now : undefined,
    canceledAt: isTaskCanceled(input.status) ? now : undefined,
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

type ImportPayload = ValidatedImportPayload;

function parseImportPayload(raw: string): ImportPayload {
  return parseAndSanitizeImportPayload(raw);
}

function toImportDataPreview(payload: ImportPayload): ImportDataPreview {
  return {
    version: typeof payload.version === "number" ? payload.version : undefined,
    exportedAt: typeof payload.exportedAt === "string" ? payload.exportedAt : undefined,
    tasks: payload.tasks.length,
    projects: payload.projects.length,
    taskTypes: payload.taskTypes.length,
    memos: payload.memos.length,
    settings: payload.settings.length,
    userContexts: payload.userContexts?.length ?? 0,
    notes: payload.notes?.length ?? 0,
    noteVersions: payload.noteVersions?.length ?? 0,
    noteTaskLinks: payload.noteTaskLinks?.length ?? 0,
    projectSubcategories: payload.projectSubcategories?.length ?? 0,
    archiveInsightCaches: payload.archiveInsightCaches?.length ?? 0,
  };
}

function clampAiContextMaxLength(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_AI_CONTEXT_MAX_LENGTH;
  }
  return Math.max(MIN_AI_CONTEXT_MAX_LENGTH, Math.min(MAX_AI_CONTEXT_MAX_LENGTH, Math.floor(value ?? DEFAULT_AI_CONTEXT_MAX_LENGTH)));
}

function normalizeSetting(setting: AppSetting): AppSetting {
  return {
    id: SETTINGS_ID,
    showPastCompleted: Boolean(setting.showPastCompleted),
    weekStartsOn: setting.weekStartsOn === "mon" ? "mon" : "sun",
    timeFormat: setting.timeFormat === "12h" ? "12h" : "24h",
    notificationsEnabled: setting.notificationsEnabled ?? DEFAULT_SETTING.notificationsEnabled,
    notifyBeforeMinutes: setting.notifyBeforeMinutes ?? DEFAULT_NOTIFY_BEFORE_MINUTES,
    autoBackupEnabled: setting.autoBackupEnabled ?? DEFAULT_SETTING.autoBackupEnabled,
    autoBackupIntervalMinutes: setting.autoBackupIntervalMinutes ?? DEFAULT_AUTO_BACKUP_INTERVAL_MINUTES,
    llmEndpoint: DEFAULT_LLM_CHAT_COMPLETIONS_URL,
    rememberLlmApiKey: setting.rememberLlmApiKey === true,
    llmModel: isValidLlmModelId(setting.llmModel) ? setting.llmModel.trim() : DEFAULT_SETTING.llmModel,
    llmTemperature: clampLlmTemperature(setting.llmTemperature),
    llmReasoningEffort: normalizeLlmReasoningEffort(setting.llmReasoningEffort),
    llmGemmaThinkingEnabled: normalizeLlmGemmaThinkingEnabled(setting.llmGemmaThinkingEnabled),
    aiContextMaxLength: clampAiContextMaxLength(setting.aiContextMaxLength),
    noteAiActions:
      Array.isArray(setting.noteAiActions) && setting.noteAiActions.length > 0
        ? setting.noteAiActions
        : DEFAULT_NOTE_AI_ACTIONS,
    noteTaskSuggestionsEnabled: setting.noteTaskSuggestionsEnabled ?? DEFAULT_SETTING.noteTaskSuggestionsEnabled,
    relatedNoteSuggestionsEnabled: setting.relatedNoteSuggestionsEnabled ?? DEFAULT_SETTING.relatedNoteSuggestionsEnabled,
    updatedAt: typeof setting.updatedAt === "string" ? setting.updatedAt : "",
  };
}

function sanitizeSettingForStorage(setting: AppSetting): AppSetting {
  const sanitized = normalizeSetting(setting);
  delete sanitized.llmApiKey;
  return sanitized;
}

function normalizeUserContext(context: UserContext | undefined): UserContext {
  if (!context) {
    return DEFAULT_USER_CONTEXT;
  }
  return {
    id: context.id || USER_CONTEXT_ID,
    markdown: typeof context.markdown === "string" ? context.markdown : DEFAULT_USER_CONTEXT.markdown,
    rules: Array.isArray(context.rules) ? context.rules : DEFAULT_USER_CONTEXT.rules,
    updatedAt: context.updatedAt || DEFAULT_USER_CONTEXT.updatedAt,
  };
}

function compactText(value: string, maxLength = 80): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 1)}…`;
}

function buildUserContextSuggestionLine(
  suggestion: UserContextSuggestion,
  projectName: string | undefined,
  taskTypeName: string | undefined,
): string {
  const parts = [
    suggestion.trigger.length > 0 ? `"${suggestion.trigger.join(", ")}"` : suggestion.label ?? "새 규칙",
    suggestion.defaultTime ? `기본 시간 ${suggestion.defaultTime}` : "",
    projectName ? `프로젝트 ${projectName}` : "",
    taskTypeName ? `종류 ${taskTypeName}` : "",
    suggestion.isMajor ? "중요 표시" : "",
    suggestion.note ? compactText(suggestion.note, 90) : "",
  ].filter(Boolean);
  return `- ${parts.join(" / ")}`;
}

const AI_LEARNED_CONTEXT_HEADING = "## AI가 학습한 규칙";

function normalizeContextToken(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function normalizeContextTriggers(items: string[]): string[] {
  return items.map(normalizeContextToken).filter(Boolean);
}

function hasTriggerOverlap(left: string[], right: string[]): boolean {
  const leftSet = new Set(normalizeContextTriggers(left));
  return normalizeContextTriggers(right).some((item) => leftSet.has(item));
}

function isSameContextRule(rule: UserContextRule, suggestion: UserContextSuggestion): boolean {
  return (
    rule.category === suggestion.category &&
    hasTriggerOverlap(rule.trigger, suggestion.trigger) &&
    (rule.defaultTime ?? "") === (suggestion.defaultTime ?? "") &&
    (rule.projectId ?? "") === (suggestion.projectId ?? "") &&
    (rule.taskTypeId ?? "") === (suggestion.taskTypeId ?? "") &&
    Boolean(rule.isMajor) === Boolean(suggestion.isMajor)
  );
}

function isConflictingContextRule(rule: UserContextRule, suggestion: UserContextSuggestion): boolean {
  if (!hasTriggerOverlap(rule.trigger, suggestion.trigger)) {
    return false;
  }

  if (suggestion.defaultTime && rule.defaultTime) {
    return true;
  }

  if (suggestion.projectId && rule.projectId) {
    return suggestion.projectId === rule.projectId;
  }

  if (suggestion.taskTypeId && rule.taskTypeId) {
    return suggestion.taskTypeId === rule.taskTypeId;
  }

  if (suggestion.isMajor !== undefined && rule.isMajor !== undefined) {
    return true;
  }

  return rule.category === suggestion.category;
}

function lineHasTimeExpression(line: string): boolean {
  return /\b\d{1,2}:\d{2}\b/.test(line) || /\d{1,2}\s*시(?:\s*\d{1,2}\s*분)?/.test(line);
}

function lineHasAnyToken(line: string, tokens: string[]): boolean {
  const normalizedLine = line.toLowerCase();
  return tokens.some((token) => normalizedLine.includes(token));
}

function isConflictingContextLine(
  line: string,
  suggestion: UserContextSuggestion,
  projectName: string | undefined,
  taskTypeName: string | undefined,
): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith("-")) {
    return false;
  }

  const triggerTokens = normalizeContextTriggers(suggestion.trigger);
  const labelToken = normalizeContextToken(suggestion.label);
  const hasTrigger = triggerTokens.length > 0 ? lineHasAnyToken(trimmed, triggerTokens) : Boolean(labelToken && trimmed.toLowerCase().includes(labelToken));
  if (!hasTrigger) {
    return false;
  }

  if (suggestion.defaultTime) {
    return lineHasTimeExpression(trimmed) || trimmed.includes("기본 시간") || trimmed.includes("시간");
  }

  if (suggestion.projectId) {
    return Boolean(projectName && trimmed.includes(projectName));
  }

  if (suggestion.taskTypeId) {
    return Boolean(taskTypeName && trimmed.includes(taskTypeName));
  }

  if (suggestion.isMajor !== undefined) {
    return trimmed.includes("중요");
  }

  return trimmed.includes(suggestion.category) || trimmed.includes("규칙");
}

function mergeUserContextSuggestionLine(
  markdown: string,
  suggestion: UserContextSuggestion,
  line: string,
  projectName: string | undefined,
  taskTypeName: string | undefined,
): string {
  if (markdown.includes(line)) {
    return markdown;
  }

  const lines = markdown.trimEnd().split(/\r?\n/);
  const nextLines: string[] = [];
  let replaced = false;

  for (const existingLine of lines) {
    if (isConflictingContextLine(existingLine, suggestion, projectName, taskTypeName)) {
      if (!replaced) {
        nextLines.push(line);
        replaced = true;
      }
      continue;
    }
    nextLines.push(existingLine);
  }

  if (replaced) {
    return `${nextLines.join("\n").trimEnd()}\n`;
  }

  const headingIndex = nextLines.findIndex((existingLine) => existingLine.trim() === AI_LEARNED_CONTEXT_HEADING);
  if (headingIndex >= 0) {
    return `${nextLines.join("\n").trimEnd()}\n${line}\n`;
  }

  return `${nextLines.join("\n").trimEnd()}\n\n${AI_LEARNED_CONTEXT_HEADING}\n${line}\n`;
}

interface ChromeStorageLocal {
  get: (keys: string[], callback: (items: Record<string, unknown>) => void) => void;
  set: (items: Record<string, unknown>, callback?: () => void) => void;
  remove: (keys: string[], callback?: () => void) => void;
}

function getChromeStorageLocal(): ChromeStorageLocal | null {
  const maybeChrome = (globalThis as { chrome?: unknown }).chrome as
    | {
        storage?: {
          local?: {
            get: (keys: string[], callback: (items: Record<string, unknown>) => void) => void;
            set: (items: Record<string, unknown>, callback?: () => void) => void;
            remove: (keys: string[], callback?: () => void) => void;
          };
        };
      }
    | undefined;

  return maybeChrome?.storage?.local ?? null;
}

function getChromeRuntimeError(): string | undefined {
  return ((globalThis as { chrome?: { runtime?: { lastError?: { message?: string } } } }).chrome?.runtime?.lastError?.message);
}

async function readChromeStorage(storage: ChromeStorageLocal, key: string): Promise<Record<string, unknown>> {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    storage.get([key], (result) => {
      const message = getChromeRuntimeError();
      if (message) {
        reject(new Error(`확장 프로그램 저장소를 읽지 못했습니다: ${message}`));
        return;
      }
      resolve(result);
    });
  });
}

async function writeChromeStorage(storage: ChromeStorageLocal, value: Record<string, unknown>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    storage.set(value, () => {
      const message = getChromeRuntimeError();
      if (message) {
        reject(new Error(`확장 프로그램 저장소에 쓰지 못했습니다: ${message}`));
        return;
      }
      resolve();
    });
  });
}

async function removeChromeStorage(storage: ChromeStorageLocal, key: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    storage.remove([key], () => {
      const message = getChromeRuntimeError();
      if (message) {
        reject(new Error(`확장 프로그램 저장소에서 삭제하지 못했습니다: ${message}`));
        return;
      }
      resolve();
    });
  });
}

function normalizeStoredApiKey(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (value.length > LLM_MAX_API_KEY_LENGTH || /[\r\n]/.test(value)) return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  return normalized;
}

async function readRememberedLlmApiKey(): Promise<string | undefined> {
  const storage = getChromeStorageLocal();
  if (!storage) return undefined;
  const items = await readChromeStorage(storage, LLM_CREDENTIAL_STORAGE_KEY);
  const raw = items[LLM_CREDENTIAL_STORAGE_KEY];
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Chrome에 저장된 API 키 데이터 형식이 올바르지 않습니다.");
  }
  const credential = raw as Record<string, unknown>;
  const apiKey = normalizeStoredApiKey(credential.apiKey);
  if (credential.version !== 1 || !apiKey) {
    throw new Error("Chrome에 저장된 API 키 데이터가 손상되었습니다.");
  }
  return apiKey;
}

async function writeRememberedLlmApiKey(apiKey: string): Promise<void> {
  const storage = getChromeStorageLocal();
  if (!storage) throw new Error("API 키 영구 저장은 Chrome 확장 프로그램에서만 사용할 수 있습니다.");
  const normalized = normalizeStoredApiKey(apiKey);
  if (!normalized) throw new Error("저장할 API 키를 먼저 입력해 주세요.");
  await writeChromeStorage(storage, {
    [LLM_CREDENTIAL_STORAGE_KEY]: { version: 1, apiKey: normalized, savedAt: toIsoNow() },
  });
  if ((await readRememberedLlmApiKey()) !== normalized) {
    throw new Error("Chrome API 키 저장 검증에 실패했습니다.");
  }
}

async function deleteRememberedLlmApiKey(): Promise<void> {
  const storage = getChromeStorageLocal();
  if (!storage) return;
  await removeChromeStorage(storage, LLM_CREDENTIAL_STORAGE_KEY);
  if ((await readRememberedLlmApiKey()) !== undefined) {
    throw new Error("Chrome API 키 삭제 검증에 실패했습니다.");
  }
}

function sanitizeStoredAutoBackupEntry(value: unknown): StoredAutoBackupEntry | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.id !== "string" ||
    !/^[A-Za-z0-9._:-]{1,128}$/.test(candidate.id) ||
    typeof candidate.createdAt !== "string" ||
    !Number.isFinite(new Date(candidate.createdAt).getTime()) ||
    typeof candidate.reason !== "string" ||
    candidate.reason.length > 200 ||
    typeof candidate.raw !== "string" ||
    new TextEncoder().encode(candidate.raw).byteLength > MAX_IMPORT_FILE_BYTES
  ) {
    return undefined;
  }

  try {
    const raw = JSON.stringify(parseAndSanitizeImportPayload(stripSecretsFromBackupRaw(candidate.raw)));
    return { id: candidate.id, createdAt: candidate.createdAt, reason: candidate.reason, raw };
  } catch {
    return undefined;
  }
}

function limitStoredAutoBackups(values: unknown[]): StoredAutoBackupEntry[] {
  let totalBytes = 0;
  const entries: StoredAutoBackupEntry[] = [];
  for (const value of values.slice(0, MAX_AUTO_BACKUPS * 2)) {
    const entry = sanitizeStoredAutoBackupEntry(value);
    if (!entry) continue;
    const entryBytes = new TextEncoder().encode(entry.raw).byteLength;
    if (totalBytes + entryBytes > MAX_AUTO_BACKUP_TOTAL_BYTES) continue;
    entries.push(entry);
    totalBytes += entryBytes;
    if (entries.length >= MAX_AUTO_BACKUPS) break;
  }
  return entries.sort(compareNewestFirst);
}

async function readStoredAutoBackups(): Promise<StoredAutoBackupEntry[]> {
  const storage = getChromeStorageLocal();
  if (storage) {
    const items = await readChromeStorage(storage, AUTO_BACKUPS_STORAGE_KEY);
    const rawEntries = Array.isArray(items[AUTO_BACKUPS_STORAGE_KEY]) ? items[AUTO_BACKUPS_STORAGE_KEY] : [];
    return limitStoredAutoBackups(rawEntries);
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
    return limitStoredAutoBackups(parsed);
  } catch {
    return [];
  }
}

async function writeStoredAutoBackups(entries: StoredAutoBackupEntry[]): Promise<void> {
  const safeEntries = limitStoredAutoBackups(entries);
  const expected = JSON.stringify(safeEntries);
  const storage = getChromeStorageLocal();
  if (storage) {
    await writeChromeStorage(storage, { [AUTO_BACKUPS_STORAGE_KEY]: safeEntries });
    const stored = await readChromeStorage(storage, AUTO_BACKUPS_STORAGE_KEY);
    if (JSON.stringify(stored[AUTO_BACKUPS_STORAGE_KEY] ?? []) !== expected) {
      throw new Error("자동 백업 저장 검증에 실패했습니다.");
    }
    return;
  }

  if (typeof localStorage !== "undefined") {
    localStorage.setItem(AUTO_BACKUPS_STORAGE_KEY, expected);
    if (localStorage.getItem(AUTO_BACKUPS_STORAGE_KEY) !== expected) {
      throw new Error("자동 백업 저장 검증에 실패했습니다.");
    }
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
    startAt: string;
    status: Task["status"];
  }>;
}): Promise<void> {
  const storage = getChromeStorageLocal();
  if (!storage) {
    return;
  }

  await writeChromeStorage(storage, { [ALARM_SYNC_STORAGE_KEY]: payload });
}

async function addInChunks<T>(items: T[], addChunk: (chunk: T[]) => Promise<unknown>): Promise<void> {
  for (let offset = 0; offset < items.length; offset += IMPORT_BATCH_SIZE) {
    await addChunk(items.slice(offset, offset + IMPORT_BATCH_SIZE));
  }
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
  const [llmApiKey, setLlmApiKey] = useState("");
  const [isLlmCredentialReady, setIsLlmCredentialReady] = useState(false);
  const [credentialStorageError, setCredentialStorageError] = useState<string>();
  // setState 업데이터는 렌더 시점에 실행되므로, 이벤트 핸들러에서 즉시 읽을 수 있는
  // 동기 미러를 유지한다. (업데이터 안에서 top을 캡처하면 pop만 되고 복원이 누락될 수 있음)
  const undoStackRef = useRef<UndoEntry[]>([]);
  const [autoBackups, setAutoBackups] = useState<AutoBackupSummary[]>([]);
  const [bootstrapError, setBootstrapError] = useState<string>();

  const retryBootstrap = useCallback(async () => {
    try {
      await bootstrapDatabase();
      setBootstrapError(undefined);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "알 수 없는 저장소 오류";
      setBootstrapError(`초기 데이터를 준비하지 못했습니다. ${detail}`);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    void bootstrapDatabase().catch((error: unknown) => {
      if (!isMounted) {
        return;
      }
      const detail = error instanceof Error ? error.message : "알 수 없는 저장소 오류";
      setBootstrapError(`초기 데이터를 준비하지 못했습니다. ${detail}`);
    });
    return () => {
      isMounted = false;
    };
  }, []);

  const tasks = useLiveQuery(() => db.tasks.orderBy("startAt").limit(LIVE_QUERY_LIMITS.tasks).toArray(), [], []);
  const projects = useLiveQuery(() => db.projects.limit(LIVE_QUERY_LIMITS.projects).toArray(), [], []);
  const taskTypes = useLiveQuery(() => db.taskTypes.orderBy("order").limit(LIVE_QUERY_LIMITS.taskTypes).toArray(), [], []);
  const memos = useLiveQuery(() => db.memos.orderBy("date").reverse().limit(LIVE_QUERY_LIMITS.memos).toArray(), [], []);
  const notes = useLiveQuery(() => db.notes.orderBy("updatedAt").reverse().limit(LIVE_QUERY_LIMITS.notes).toArray(), [], []);
  const noteVersions = useLiveQuery(() => db.noteVersions.orderBy("createdAt").reverse().limit(LIVE_QUERY_LIMITS.noteVersions).toArray(), [], []);
  const noteTaskLinks = useLiveQuery(() => db.noteTaskLinks.limit(LIVE_QUERY_LIMITS.noteTaskLinks).toArray(), [], []);
  const projectSubcategories = useLiveQuery(() => db.projectSubcategories.limit(LIVE_QUERY_LIMITS.projectSubcategories).toArray(), [], []);
  const rawSetting = useLiveQuery(() => db.settings.get(SETTINGS_ID), [], undefined);
  const rawUserContext = useLiveQuery(() => db.userContexts.get(USER_CONTEXT_ID), [], undefined);
  const hasRawSetting = rawSetting !== undefined;
  const shouldRememberLlmApiKey = rawSetting?.rememberLlmApiKey === true;

  useEffect(() => {
    if (!hasRawSetting) return;

    let isMounted = true;
    void (async () => {
      try {
        if (!shouldRememberLlmApiKey) {
          await deleteRememberedLlmApiKey();
          if (isMounted) {
            setCredentialStorageError(undefined);
          }
          return;
        }

        if (!getChromeStorageLocal()) {
          throw new Error("Chrome 확장 프로그램 저장소를 사용할 수 없습니다.");
        }
        const rememberedApiKey = await readRememberedLlmApiKey();
        if (!rememberedApiKey) {
          throw new Error("Chrome에 저장된 API 키가 없습니다.");
        }
        if (isMounted) {
          setLlmApiKey(rememberedApiKey);
          setCredentialStorageError(undefined);
        }
      } catch (error) {
        if (isMounted) {
          const detail = error instanceof Error ? error.message : "알 수 없는 저장소 오류";
          setLlmApiKey("");
          setCredentialStorageError(`저장된 API 키를 불러오지 않았습니다. ${detail}`);
        }
      } finally {
        if (isMounted) setIsLlmCredentialReady(true);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [hasRawSetting, shouldRememberLlmApiKey]);

  const setting = useMemo(
    () => ({ ...normalizeSetting(rawSetting ?? DEFAULT_SETTING), llmApiKey }),
    [llmApiKey, rawSetting],
  );
  const userContext = useMemo(() => normalizeUserContext(rawUserContext), [rawUserContext]);
  const lunchProjectMap = useMemo<Record<string, Project | undefined>>(
    () => Object.fromEntries(projects.map((project) => [project.id, project])),
    [projects],
  );
  const lunchTypeMap = useMemo<Record<string, TaskType | undefined>>(
    () => Object.fromEntries(taskTypes.map((taskType) => [taskType.id, taskType])),
    [taskTypes],
  );

  useEffect(() => {
    const activeLunchTasks = tasks
      .filter((task) => isTaskActive(task.status) && isLunchTask(task, lunchTypeMap, lunchProjectMap))
      .map((task) => ({ task, completeAt: getLunchAutoCompleteAt(task) }))
      .filter((entry): entry is { task: Task; completeAt: number } => entry.completeAt !== null);

    if (activeLunchTasks.length === 0) {
      return;
    }

    const completeDueLunchTasks = async () => {
      await db.transaction("rw", db.tasks, async () => {
        const currentTasks = (await db.tasks.bulkGet(activeLunchTasks.map(({ task }) => task.id))).filter(
          (task): task is Task => Boolean(task),
        );
        const checkAt = Date.now();
        const completedAt = toIsoNow();
        const dueTasks = currentTasks.filter((task) => {
          if (!isTaskActive(task.status) || !isLunchTask(task, lunchTypeMap, lunchProjectMap)) {
            return false;
          }
          const completeAt = getLunchAutoCompleteAt(task);
          return completeAt !== null && completeAt <= checkAt;
        });

        if (dueTasks.length === 0) {
          return;
        }

        await db.tasks.bulkPut(
          dueTasks.map((task) => ({
            ...task,
            status: "DONE",
            completedAt,
            canceledAt: undefined,
            updatedAt: completedAt,
          })),
        );
      });
    };

    const now = Date.now();
    const hasDueTask = activeLunchTasks.some(({ completeAt }) => completeAt <= now);
    if (hasDueTask) {
      void completeDueLunchTasks().catch((error: unknown) => {
        console.error("점심 일정을 자동 완료하지 못했습니다.", error);
      });
      return;
    }

    const nextCompleteAt = Math.min(...activeLunchTasks.map(({ completeAt }) => completeAt));
    const timeoutMs = Math.min(Math.max(nextCompleteAt - now + 100, 100), 2_147_000_000);
    const timeoutId = window.setTimeout(() => {
      void completeDueLunchTasks().catch((error: unknown) => {
        console.error("점심 일정을 자동 완료하지 못했습니다.", error);
      });
    }, timeoutMs);

    return () => window.clearTimeout(timeoutId);
  }, [lunchProjectMap, lunchTypeMap, tasks]);

  const pushUndo = useCallback((entry: UndoEntry) => {
    const prev = undoStackRef.current;

    // 같은 일정을 15초 내 연속 수정하면 하나의 undo로 병합 (새 항목/토스트 없음)
    if (entry.kind === "upsert_tasks" && entry.tasks.length === 1) {
      const last = prev[prev.length - 1];
      if (
        last?.kind === "upsert_tasks" &&
        last.tasks.length === 1 &&
        last.tasks[0].id === entry.tasks[0].id &&
        Date.now() - new Date(last.createdAt).getTime() < UPDATE_UNDO_MERGE_WINDOW_MS
      ) {
        return;
      }
    }

    const merged = [...prev, entry];
    const next = merged.length > MAX_UNDO_STACK ? merged.slice(merged.length - MAX_UNDO_STACK) : merged;
    undoStackRef.current = next;
    setUndoStack(next);

    // 되돌리기 가능한 변경을 UI(토스트)에 알린다 — 실행 취소 발견성용
    window.dispatchEvent(new CustomEvent("ai-planner:undoable", { detail: { description: entry.description } }));
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
          completedAt: isTaskDone(normalized.status) ? now : undefined,
          canceledAt: isTaskCanceled(normalized.status) ? now : undefined,
          recurrencePattern: effectivePattern,
          recurrenceGroupId,
          recurrenceIndex: effectivePattern === "NONE" ? undefined : index,
        };
      });

      await assertCapacity(db.tasks.count(), records.length, LIVE_QUERY_LIMITS.tasks, "일정");
      const [project, taskType] = await Promise.all([
        db.projects.get(normalized.projectId),
        db.taskTypes.get(normalized.taskTypeId),
      ]);
      if (!project || !taskType) throw new Error("선택한 프로젝트 또는 일정 종류를 찾을 수 없습니다.");
      await db.tasks.bulkAdd(records);

      pushUndo({
        kind: "delete_tasks",
        createdAt: now,
        description: recurrenceCount > 1 ? `반복 일정 ${recurrenceCount}건 추가` : `일정 추가: ${normalized.title}`,
        taskIds: records.map((item) => item.id),
      });

      return records[0]?.id ?? "";
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
      const [project, taskType] = await Promise.all([
        db.projects.get(normalized.projectId),
        db.taskTypes.get(normalized.taskTypeId),
      ]);
      if (!project || !taskType) throw new Error("선택한 프로젝트 또는 일정 종류를 찾을 수 없습니다.");
      const nextTask: Task = {
        ...existing,
        ...toTaskCoreRecord(normalized),
        recurrencePattern: existing.recurrencePattern,
        recurrenceGroupId: existing.recurrenceGroupId,
        recurrenceIndex: existing.recurrenceIndex,
        completedAt: isTaskDone(normalized.status) ? existing.completedAt ?? now : undefined,
        canceledAt: isTaskCanceled(normalized.status) ? existing.canceledAt ?? now : undefined,
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

  const pruneNoteVersions = useCallback(async (noteId: string) => {
    const versions = await db.noteVersions.where("noteId").equals(noteId).sortBy("createdAt");
    const autosave = versions.filter((version) => version.editType === "autosave");
    const others = versions.filter((version) => version.editType !== "autosave");
    const toDelete: string[] = [];
    if (autosave.length > MAX_AUTOSAVE_NOTE_VERSIONS) {
      toDelete.push(...autosave.slice(0, autosave.length - MAX_AUTOSAVE_NOTE_VERSIONS).map((version) => version.id));
    }
    if (others.length > MAX_MANUAL_NOTE_VERSIONS) {
      toDelete.push(...others.slice(0, others.length - MAX_MANUAL_NOTE_VERSIONS).map((version) => version.id));
    }
    if (toDelete.length > 0) {
      await db.noteVersions.bulkDelete(toDelete);
    }
  }, []);

  const createNote = useCallback(
    async (input: NoteFormInput, editType: NoteVersionEditType = "manual", aiPrompt?: string) => {
      const now = toIsoNow();
      const id = getId("note");
      const normalized = normalizeNoteInput(input);
      if (aiPrompt && aiPrompt.length > 4_000) throw new Error("AI 편집 지시문은 4,000자 이하여야 합니다.");
      await assertCapacity(db.notes.count(), 1, LIVE_QUERY_LIMITS.notes, "노트");
      await assertCapacity(db.noteVersions.count(), 1, LIVE_QUERY_LIMITS.noteVersions, "노트 버전");
      const [project, subcategory] = await Promise.all([
        db.projects.get(normalized.projectId),
        normalized.subcategoryId ? db.projectSubcategories.get(normalized.subcategoryId) : undefined,
      ]);
      if (!project || (normalized.subcategoryId && (!subcategory || subcategory.projectId !== normalized.projectId))) {
        throw new Error("선택한 노트 분류를 찾을 수 없습니다.");
      }
      const title = normalized.title;
      const note: Note = {
        id,
        title,
        content: normalized.content,
        projectId: normalized.projectId,
        subcategoryId: normalized.subcategoryId,
        tags: normalized.tags,
        status: normalized.status,
        isPinned: normalized.isPinned,
        linkedTaskIds: [],
        createdAt: now,
        updatedAt: now,
      };
      await db.transaction("rw", [db.notes, db.noteVersions], async () => {
        await db.notes.add(note);
        await db.noteVersions.add({
          id: getId("noteversion"),
          noteId: id,
          title,
          content: normalized.content,
          editType,
          aiPrompt,
          createdAt: now,
        });
      });
      return id;
    },
    [],
  );

  const updateNote = useCallback(
    async (id: string, input: NoteFormInput, editType: NoteVersionEditType = "manual", aiPrompt?: string) => {
      const existing = await db.notes.get(id);
      if (!existing) {
        return;
      }
      const normalized = normalizeNoteInput(input);
      if (aiPrompt && aiPrompt.length > 4_000) throw new Error("AI 편집 지시문은 4,000자 이하여야 합니다.");
      const [project, subcategory] = await Promise.all([
        db.projects.get(normalized.projectId),
        normalized.subcategoryId ? db.projectSubcategories.get(normalized.subcategoryId) : undefined,
      ]);
      if (!project || (normalized.subcategoryId && (!subcategory || subcategory.projectId !== normalized.projectId))) {
        throw new Error("선택한 노트 분류를 찾을 수 없습니다.");
      }
      const now = toIsoNow();
      const nextTitle = normalized.title;
      const nextTags = normalized.tags;
      const contentChanged = existing.content !== normalized.content || existing.title !== nextTitle;
      const metaChanged =
        existing.projectId !== normalized.projectId ||
        (existing.subcategoryId ?? "") !== (normalized.subcategoryId ?? "") ||
        existing.status !== normalized.status ||
        existing.isPinned !== normalized.isPinned ||
        JSON.stringify(existing.tags) !== JSON.stringify(nextTags);

      if (!contentChanged && !metaChanged) {
        return;
      }
      if (contentChanged) {
        await pruneNoteVersions(id);
        await assertCapacity(db.noteVersions.count(), 1, LIVE_QUERY_LIMITS.noteVersions, "노트 버전");
      }

      await db.transaction("rw", [db.notes, db.noteVersions], async () => {
        await db.notes.put({
          ...existing,
          title: nextTitle,
          content: normalized.content,
          projectId: normalized.projectId,
          subcategoryId: normalized.subcategoryId,
          tags: nextTags,
          status: normalized.status,
          isPinned: normalized.isPinned,
          updatedAt: now,
        });

        if (contentChanged) {
          await db.noteVersions.add({
            id: getId("noteversion"),
            noteId: id,
            title: nextTitle,
            content: normalized.content,
            editType,
            aiPrompt,
            createdAt: now,
          });
          await pruneNoteVersions(id);
        }
      });
    },
    [pruneNoteVersions],
  );

  const applyNoteAiClassification = useCallback(async (id: string, projectId: string, subcategoryId?: string, expectedUpdatedAt?: string) => {
    const existing = await db.notes.get(id);
    // Do not let a delayed background classification overwrite a user's edit.
    if (!existing || existing.aiClassifiedAt || (expectedUpdatedAt && existing.updatedAt !== expectedUpdatedAt)) {
      return;
    }
    const [project, subcategory] = await Promise.all([
      db.projects.get(projectId),
      subcategoryId ? db.projectSubcategories.get(subcategoryId) : undefined,
    ]);
    if (!project || (subcategoryId && (!subcategory || subcategory.projectId !== projectId))) return;
    const now = toIsoNow();
    await db.notes.put({
      ...existing,
      projectId,
      subcategoryId,
      aiClassifiedAt: now,
      updatedAt: now,
    });
  }, []);

  const removeNote = useCallback(async (id: string) => {
    await db.transaction("rw", [db.notes, db.tasks, db.noteTaskLinks, db.noteVersions], async () => {
      const note = await db.notes.get(id);
      if (!note) {
        return;
      }
      for (const taskId of note.linkedTaskIds ?? []) {
        await db.tasks
          .where("id")
          .equals(taskId)
          .modify((task) => {
            task.linkedNoteIds = (task.linkedNoteIds ?? []).filter((noteId) => noteId !== id);
          });
      }
      await db.noteTaskLinks.where("noteId").equals(id).delete();
      await db.noteVersions.where("noteId").equals(id).delete();
      await db.notes.delete(id);
    });
  }, []);

  const restoreNoteVersion = useCallback(
    async (noteId: string, versionId: string) => {
      const [note, version] = await Promise.all([db.notes.get(noteId), db.noteVersions.get(versionId)]);
      if (!note || !version || version.noteId !== noteId) {
        return;
      }
      await pruneNoteVersions(noteId);
      await assertCapacity(db.noteVersions.count(), 1, LIVE_QUERY_LIMITS.noteVersions, "노트 버전");
      const now = toIsoNow();
      await db.notes.put({
        ...note,
        title: version.title,
        content: version.content,
        updatedAt: now,
      });
      await db.noteVersions.add({
        id: getId("noteversion"),
        noteId,
        title: version.title,
        content: version.content,
        editType: "restore",
        createdAt: now,
      });
      await pruneNoteVersions(noteId);
    },
    [pruneNoteVersions],
  );

  const linkNoteToTask = useCallback(
    async (noteId: string, taskId: string, source: NoteTaskLinkSource = "manual") => {
      if (
        !/^[A-Za-z0-9._:-]{1,128}$/.test(noteId) ||
        !/^[A-Za-z0-9._:-]{1,128}$/.test(taskId) ||
        (source !== "manual" && source !== "auto_suggest")
      ) {
        throw new Error("노트 연결 정보가 올바르지 않습니다.");
      }
      const now = toIsoNow();
      await db.transaction("rw", [db.notes, db.tasks, db.noteTaskLinks], async () => {
        const [note, task] = await Promise.all([db.notes.get(noteId), db.tasks.get(taskId)]);
        if (!note || !task) {
          return;
        }
        const existingLink = await db.noteTaskLinks.where("[noteId+taskId]").equals([noteId, taskId]).first();
        if (!existingLink) {
          if ((note.linkedTaskIds?.length ?? 0) >= 200 || (task.linkedNoteIds?.length ?? 0) >= 200) {
            throw new Error("노트와 일정 연결은 항목당 최대 200개까지 허용됩니다.");
          }
          await assertCapacity(db.noteTaskLinks.count(), 1, LIVE_QUERY_LIMITS.noteTaskLinks, "노트 연결");
          await db.noteTaskLinks.add({
            id: getId("notelink"),
            noteId,
            taskId,
            source,
            createdAt: now,
          });
        }
        await db.notes
          .where("id")
          .equals(noteId)
          .modify((current) => {
            current.linkedTaskIds = Array.from(new Set([...(current.linkedTaskIds ?? []), taskId]));
            current.updatedAt = now;
          });
        await db.tasks
          .where("id")
          .equals(taskId)
          .modify((current) => {
            current.linkedNoteIds = Array.from(new Set([...(current.linkedNoteIds ?? []), noteId]));
            current.updatedAt = now;
          });
      });
    },
    [],
  );

  const unlinkNoteFromTask = useCallback(async (noteId: string, taskId: string) => {
    const now = toIsoNow();
    await db.transaction("rw", [db.notes, db.tasks, db.noteTaskLinks], async () => {
      await db.noteTaskLinks.where("[noteId+taskId]").equals([noteId, taskId]).delete();
      await db.notes
        .where("id")
        .equals(noteId)
        .modify((current) => {
          current.linkedTaskIds = (current.linkedTaskIds ?? []).filter((id) => id !== taskId);
          current.updatedAt = now;
        });
      await db.tasks
        .where("id")
        .equals(taskId)
        .modify((current) => {
          current.linkedNoteIds = (current.linkedNoteIds ?? []).filter((id) => id !== noteId);
          current.updatedAt = now;
        });
    });
  }, []);

  const createSubcategory = useCallback(async (projectId: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 200) throw new Error("세부 항목 이름은 1~200자로 입력해 주세요.");
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(projectId) || !(await db.projects.get(projectId))) {
      throw new Error("대상 프로젝트를 찾을 수 없습니다.");
    }
    await assertCapacity(db.projectSubcategories.count(), 1, LIVE_QUERY_LIMITS.projectSubcategories, "세부 항목");
    const now = toIsoNow();
    const id = getId("subcat");
    const highest = await db.projectSubcategories.where("projectId").equals(projectId).count();
    await db.projectSubcategories.add({
      id,
      projectId,
      name: trimmed,
      order: highest,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  }, []);

  const renameSubcategory = useCallback(async (id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 200) throw new Error("세부 항목 이름은 1~200자로 입력해 주세요.");
    const existing = await db.projectSubcategories.get(id);
    if (!existing) {
      return;
    }
    await db.projectSubcategories.put({ ...existing, name: trimmed, updatedAt: toIsoNow() });
  }, []);

  const deleteSubcategory = useCallback(async (id: string) => {
    await db.transaction("rw", [db.projectSubcategories, db.notes], async () => {
      await db.projectSubcategories.delete(id);
      // 해당 세부 항목에 속한 노트는 미분류로 되돌린다.
      await db.notes
        .where("subcategoryId")
        .equals(id)
        .modify((note) => {
          note.subcategoryId = undefined;
        });
    });
  }, []);

  const undoLastChange = useCallback(async () => {
    const target = undoStackRef.current[undoStackRef.current.length - 1];
    if (!target) {
      return;
    }
    undoStackRef.current = undoStackRef.current.slice(0, -1);
    setUndoStack(undoStackRef.current);

    if (target.kind === "delete_tasks") {
      await db.tasks.bulkDelete(target.taskIds);
      return;
    }

    await db.tasks.bulkPut(target.tasks);
  }, []);

  const upsertProject = useCallback(async (input: ProjectInput) => {
    const now = toIsoNow();
    const name = input.name.trim();
    if (!name || name.length > 200) throw new Error("프로젝트명은 1~200자로 입력해 주세요.");
    const color = validateColor(input.color);
    const description = input.description?.trim();
    if (description && description.length > 2_000) throw new Error("프로젝트 설명은 2,000자 이하여야 합니다.");

    if (input.id) {
      const existing = await db.projects.get(input.id);
      if (!existing) {
        return;
      }
      await db.projects.put({
        ...existing,
        name,
        color,
        description,
        isActive: input.isActive,
        updatedAt: now,
      });
      return;
    }

    // 새 프로젝트는 목록 맨 뒤 순서로 추가한다
    await assertCapacity(db.projects.count(), 1, LIVE_QUERY_LIMITS.projects, "프로젝트");
    const existingProjects = await db.projects.limit(LIVE_QUERY_LIMITS.projects).toArray();
    const maxOrder = existingProjects.reduce((max, project) => Math.max(max, project.order ?? -1), -1);
    await db.projects.add({
      id: getId("project"),
      name,
      color,
      description,
      isActive: input.isActive,
      order: maxOrder + 1,
      createdAt: now,
      updatedAt: now,
    });
  }, []);

  /** 프로젝트 탭 드래그앤드롭 순서를 저장한다. orderedIds의 인덱스가 곧 표시 순서다. */
  const reorderProjects = useCallback(async (orderedIds: string[]) => {
    const now = toIsoNow();
    await db.transaction("rw", db.projects, async () => {
      for (let index = 0; index < orderedIds.length; index += 1) {
        const existing = await db.projects.get(orderedIds[index]);
        if (existing && existing.order !== index) {
          await db.projects.put({ ...existing, order: index, updatedAt: now });
        }
      }
    });
  }, []);

  /** 노트 탐색기 드래그앤드롭 순서 저장. updatedAt은 건드리지 않아 최근 수정순 정렬을 오염시키지 않는다. */
  const reorderNotes = useCallback(async (orderedIds: string[]) => {
    await db.transaction("rw", db.notes, async () => {
      for (let index = 0; index < orderedIds.length; index += 1) {
        const existing = await db.notes.get(orderedIds[index]);
        if (existing && existing.sortOrder !== index) {
          await db.notes.put({ ...existing, sortOrder: index });
        }
      }
    });
  }, []);

  const deleteProject = useCallback(async (id: string) => {
    if (DEFAULT_PROJECT_IDS.includes(id)) {
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
    if (!name || name.length > 200) throw new Error("종류명은 1~200자로 입력해 주세요.");
    const color = validateColor(input.color);

    if (input.id) {
      const existing = await db.taskTypes.get(input.id);
      if (!existing) {
        return;
      }
      await db.taskTypes.put({
        ...existing,
        name,
        color,
        isActive: input.isActive,
        updatedAt: now,
      });
      return;
    }

    await assertCapacity(db.taskTypes.count(), 1, LIVE_QUERY_LIMITS.taskTypes, "일정 종류");
    const highestOrder = await db.taskTypes.orderBy("order").last();
    await db.taskTypes.add({
      id: getId("type"),
      name,
      color,
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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(new Date(`${date}T00:00:00`).getTime())) {
      throw new Error("메모 날짜 형식이 올바르지 않습니다.");
    }
    if (trimmed.length > 100_000) throw new Error("메모 내용은 100,000자 이하여야 합니다.");
    const id = `memo-${date}`;

    if (!trimmed) {
      await db.memos.delete(id);
      return;
    }

    if (!(await db.memos.get(id))) await assertCapacity(db.memos.count(), 1, LIVE_QUERY_LIMITS.memos, "메모");
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
          | "llmEndpoint"
          | "llmApiKey"
          | "rememberLlmApiKey"
          | "llmModel"
          | "llmTemperature"
          | "llmReasoningEffort"
          | "llmGemmaThinkingEnabled"
          | "notificationsEnabled"
          | "notifyBeforeMinutes"
          | "autoBackupEnabled"
          | "autoBackupIntervalMinutes"
          | "aiContextMaxLength"
          | "noteAiActions"
          | "noteTaskSuggestionsEnabled"
          | "relatedNoteSuggestionsEnabled"
        >
      >,
    ) => {
      if (patch.llmEndpoint !== undefined && patch.llmEndpoint !== DEFAULT_LLM_CHAT_COMPLETIONS_URL) {
        throw new Error("AI Endpoint는 승인된 MOIP 주소만 사용할 수 있습니다.");
      }
      if (patch.llmModel !== undefined && !isValidLlmModelId(patch.llmModel)) {
        throw new Error("LLM 모델명 형식이 올바르지 않습니다.");
      }
      if (patch.noteAiActions !== undefined) {
        if (!Array.isArray(patch.noteAiActions) || patch.noteAiActions.length > 20) {
          throw new Error("AI 노트 작업은 최대 20개까지 저장할 수 있습니다.");
        }
        const actionIds = new Set<string>();
        for (const action of patch.noteAiActions) {
          if (
            !/^[A-Za-z0-9._:-]{1,128}$/.test(action.id) ||
            !action.label.trim() ||
            action.label.length > 100 ||
            !action.prompt.trim() ||
            action.prompt.length > 4_000 ||
            actionIds.has(action.id)
          ) {
            throw new Error("AI 노트 작업의 이름 또는 지시문 형식이 올바르지 않습니다.");
          }
          actionIds.add(action.id);
        }
      }
      const nextApiKey = patch.llmApiKey !== undefined ? patch.llmApiKey.trim() : llmApiKey;
      if (patch.llmApiKey !== undefined) {
        if (patch.llmApiKey.length > LLM_MAX_API_KEY_LENGTH || /[\r\n]/.test(patch.llmApiKey)) {
          throw new Error("API 키 형식이 올바르지 않습니다.");
        }
        setLlmApiKey(nextApiKey);
      }

      if (patch.rememberLlmApiKey !== undefined) {
        if (patch.rememberLlmApiKey) {
          await writeRememberedLlmApiKey(nextApiKey);
        } else {
          await deleteRememberedLlmApiKey();
        }
        setCredentialStorageError(undefined);
      }

      const persistedPatch = { ...patch };
      delete persistedPatch.llmApiKey;
      delete persistedPatch.llmEndpoint;
      if (Object.keys(persistedPatch).length === 0) {
        return;
      }
      const current = normalizeSetting((await db.settings.get(SETTINGS_ID)) ?? DEFAULT_SETTING);
      await db.settings.put(sanitizeSettingForStorage({
        ...current,
        ...persistedPatch,
        llmTemperature: clampLlmTemperature(persistedPatch.llmTemperature ?? current.llmTemperature),
        llmReasoningEffort: normalizeLlmReasoningEffort(
          persistedPatch.llmReasoningEffort ?? current.llmReasoningEffort,
        ),
        llmGemmaThinkingEnabled:
          persistedPatch.llmGemmaThinkingEnabled === undefined
            ? normalizeLlmGemmaThinkingEnabled(current.llmGemmaThinkingEnabled)
            : normalizeLlmGemmaThinkingEnabled(persistedPatch.llmGemmaThinkingEnabled),
        notifyBeforeMinutes:
          persistedPatch.notifyBeforeMinutes !== undefined
            ? Math.max(0, Math.min(24 * 60, Math.floor(persistedPatch.notifyBeforeMinutes)))
            : current.notifyBeforeMinutes,
        autoBackupIntervalMinutes:
          persistedPatch.autoBackupIntervalMinutes !== undefined
            ? Math.max(15, Math.min(24 * 60, Math.floor(persistedPatch.autoBackupIntervalMinutes)))
            : current.autoBackupIntervalMinutes,
        aiContextMaxLength:
          persistedPatch.aiContextMaxLength !== undefined
            ? clampAiContextMaxLength(persistedPatch.aiContextMaxLength)
            : current.aiContextMaxLength,
        id: SETTINGS_ID,
        updatedAt: toIsoNow(),
      }));
    },
    [llmApiKey],
  );

  const updateUserContextMarkdown = useCallback(async (markdown: string) => {
    if (markdown.length > 20_000) throw new Error("AI 맞춤 규칙은 20,000자 이하여야 합니다.");
    const now = toIsoNow();
    const current = normalizeUserContext((await db.userContexts.get(USER_CONTEXT_ID)) ?? DEFAULT_USER_CONTEXT);
    await db.userContexts.put({
      ...current,
      id: USER_CONTEXT_ID,
      markdown,
      updatedAt: now,
    });
  }, []);

  const resetUserContext = useCallback(async () => {
    const now = toIsoNow();
    await db.userContexts.put({
      ...DEFAULT_USER_CONTEXT,
      rules: DEFAULT_USER_CONTEXT.rules.map((rule) => ({
        ...rule,
        createdAt: now,
        updatedAt: now,
      })),
      updatedAt: now,
    });
  }, []);

  const acceptUserContextSuggestion = useCallback(async (suggestion: UserContextSuggestion) => {
    const now = toIsoNow();
    const current = normalizeUserContext((await db.userContexts.get(USER_CONTEXT_ID)) ?? DEFAULT_USER_CONTEXT);
    const projectName = suggestion.projectId ? (await db.projects.get(suggestion.projectId))?.name : undefined;
    const taskTypeName = suggestion.taskTypeId ? (await db.taskTypes.get(suggestion.taskTypeId))?.name : undefined;
    const line = buildUserContextSuggestionLine(suggestion, projectName, taskTypeName);
    const nextMarkdown = mergeUserContextSuggestionLine(current.markdown, suggestion, line, projectName, taskTypeName);
    const nextRule = {
      id: getId("context-rule"),
      category: suggestion.category,
      label: suggestion.label?.trim() || suggestion.trigger.join(", ") || "AI 제안 규칙",
      trigger: suggestion.trigger.map((item) => item.trim()).filter(Boolean).slice(0, 8),
      projectId: suggestion.projectId,
      taskTypeId: suggestion.taskTypeId,
      defaultTime: suggestion.defaultTime,
      isMajor: suggestion.isMajor,
      note: suggestion.note?.trim() || suggestion.reason?.trim(),
      source: "ai" as const,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    const retainedRules = current.rules.filter((rule) => !isConflictingContextRule(rule, suggestion) || isSameContextRule(rule, suggestion));
    const hasSameRule = retainedRules.some((rule) => isSameContextRule(rule, suggestion));
    const defaultRules = retainedRules.filter((rule) => rule.source === "default");
    const customRules = retainedRules.filter((rule) => rule.source !== "default");
    const nextRules = hasSameRule
      ? retainedRules
      : [
          ...defaultRules,
          ...customRules.slice(Math.max(0, customRules.length - Math.max(0, 30 - defaultRules.length - 1))),
          nextRule,
        ];

    await db.userContexts.put({
      ...current,
      id: USER_CONTEXT_ID,
      markdown: nextMarkdown,
      rules: nextRules,
      updatedAt: now,
    });
  }, []);

  const exportData = useCallback(async () => {
    const counts = await Promise.all([
      db.tasks.count(),
      db.projects.count(),
      db.taskTypes.count(),
      db.memos.count(),
      db.notes.count(),
      db.noteVersions.count(),
      db.noteTaskLinks.count(),
      db.projectSubcategories.count(),
      db.settings.count(),
      db.userContexts.count(),
      db.archiveInsightCaches.count(),
    ]);
    const limits = Object.values(LIVE_QUERY_LIMITS);
    if (counts.some((count, index) => count > limits[index])) {
      throw new Error("데이터 항목 수가 단일 백업의 안전 처리 한도를 초과했습니다. 데이터를 분할 보관해 주세요.");
    }
    const data = {
      exportedAt: toIsoNow(),
      version: BACKUP_VERSION,
      tasks: await db.tasks.limit(LIVE_QUERY_LIMITS.tasks).toArray(),
      projects: await db.projects.limit(LIVE_QUERY_LIMITS.projects).toArray(),
      taskTypes: await db.taskTypes.limit(LIVE_QUERY_LIMITS.taskTypes).toArray(),
      memos: await db.memos.limit(LIVE_QUERY_LIMITS.memos).toArray(),
      settings: (await db.settings.limit(LIVE_QUERY_LIMITS.settings).toArray()).map(sanitizeSettingForStorage),
      userContexts: await db.userContexts.limit(LIVE_QUERY_LIMITS.userContexts).toArray(),
      notes: await db.notes.limit(LIVE_QUERY_LIMITS.notes).toArray(),
      noteVersions: await db.noteVersions.limit(LIVE_QUERY_LIMITS.noteVersions).toArray(),
      noteTaskLinks: await db.noteTaskLinks.limit(LIVE_QUERY_LIMITS.noteTaskLinks).toArray(),
      projectSubcategories: await db.projectSubcategories.limit(LIVE_QUERY_LIMITS.projectSubcategories).toArray(),
      archiveInsightCaches: await db.archiveInsightCaches.limit(LIVE_QUERY_LIMITS.archiveInsightCaches).toArray(),
    };
    const raw = JSON.stringify(data, null, 2);
    if (new TextEncoder().encode(raw).byteLength > MAX_IMPORT_FILE_BYTES) {
      throw new Error("백업 데이터가 안전한 처리 한도(5MB)를 초과했습니다. 데이터를 분할 보관해 주세요.");
    }
    return raw;
  }, []);

  const inspectImportData = useCallback((raw: string) => {
    return toImportDataPreview(parseImportPayload(raw));
  }, []);

  const importData = useCallback(async (raw: string) => {
    const parsed = parseImportPayload(raw);

    await db.transaction(
      "rw",
      [
        db.tasks,
        db.projects,
        db.taskTypes,
        db.memos,
        db.settings,
        db.userContexts,
        db.notes,
        db.noteVersions,
        db.noteTaskLinks,
        db.projectSubcategories,
        db.archiveInsightCaches,
      ],
      async () => {
        await db.tasks.clear();
        await db.projects.clear();
        await db.taskTypes.clear();
        await db.memos.clear();
        await db.settings.clear();
        await db.userContexts.clear();
        await db.notes.clear();
        await db.noteVersions.clear();
        await db.noteTaskLinks.clear();
        await db.projectSubcategories.clear();
        await db.archiveInsightCaches.clear();

        await addInChunks(parsed.projects, (chunk) => db.projects.bulkAdd(chunk));
        await addInChunks(parsed.taskTypes, (chunk) => db.taskTypes.bulkAdd(chunk));
        await addInChunks(parsed.notes, (chunk) => db.notes.bulkAdd(chunk));
        await addInChunks(parsed.tasks, (chunk) => db.tasks.bulkAdd(chunk));
        await addInChunks(parsed.memos, (chunk) => db.memos.bulkAdd(chunk));
        await addInChunks(parsed.settings.map(normalizeSetting), (chunk) => db.settings.bulkAdd(chunk));
        await addInChunks(parsed.userContexts.map(normalizeUserContext), (chunk) => db.userContexts.bulkAdd(chunk));
        await addInChunks(parsed.noteVersions, (chunk) => db.noteVersions.bulkAdd(chunk));
        await addInChunks(parsed.noteTaskLinks, (chunk) => db.noteTaskLinks.bulkAdd(chunk));
        await addInChunks(parsed.projectSubcategories, (chunk) => db.projectSubcategories.bulkAdd(chunk));
        await addInChunks(parsed.archiveInsightCaches, (chunk) => db.archiveInsightCaches.bulkAdd(chunk));
      },
    );

    undoStackRef.current = [];
    setUndoStack([]);
    await bootstrapDatabase();
  }, []);

  const refreshAutoBackups = useCallback(async () => {
    const entries = await readStoredAutoBackups();
    // 기존 백업도 다시 써서 과거 버전의 키/임의 엔드포인트를 즉시 제거한다.
    await writeStoredAutoBackups(entries);
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
      const next = limitStoredAutoBackups([entry, ...existing]);
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

      await createAutoBackup("자동 백업 복원 직전");
      await importData(target.raw);
      await refreshAutoBackups();
    },
    [createAutoBackup, importData, refreshAutoBackups],
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
    void refreshAutoBackups().catch((error: unknown) => {
      console.error("자동 백업 저장소 검증에 실패했습니다.", error);
    });
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
    const futureTasks = tasks
      .filter((task) => isTaskActive(task.status) && Number.isFinite(new Date(task.startAt).getTime()))
      .sort((left, right) => new Date(left.startAt).getTime() - new Date(right.startAt).getTime())
      .slice(0, MAX_ALARM_SYNC_TASKS);
    const timerId = window.setTimeout(() => {
      void writeAlarmSyncPayload({
      updatedAt: toIsoNow(),
      settings: {
        notificationsEnabled: Boolean(setting.notificationsEnabled),
        notifyBeforeMinutes: Math.max(0, Math.floor(setting.notifyBeforeMinutes ?? DEFAULT_NOTIFY_BEFORE_MINUTES)),
      },
      tasks: futureTasks.map((task) => ({
          id: task.id,
          startAt: task.startAt,
          status: task.status,
        })),
      }).catch((error: unknown) => {
        console.error("알림 동기화 저장에 실패했습니다.", error);
      });
    }, 300);

    return () => window.clearTimeout(timerId);
  }, [tasks, setting.notificationsEnabled, setting.notifyBeforeMinutes]);

  const isReady = Boolean(rawSetting) && isLlmCredentialReady;

  const value = useMemo<AppDataContextValue>(
    () => ({
      tasks,
      projects,
      taskTypes,
      memos,
      notes,
      noteVersions,
      noteTaskLinks,
      projectSubcategories,
      setting,
      userContext,
      isReady,
      bootstrapError,
      credentialStorageError,
      retryBootstrap,
      canUndo: undoStack.length > 0,
      undoDescription: undoStack[undoStack.length - 1]?.description,
      autoBackups,
      createTask,
      updateTask,
      removeTask,
      undoLastChange,
      createNote,
      updateNote,
      applyNoteAiClassification,
      removeNote,
      restoreNoteVersion,
      linkNoteToTask,
      unlinkNoteFromTask,
      createSubcategory,
      renameSubcategory,
      deleteSubcategory,
      upsertProject,
      deleteProject,
      reorderProjects,
      reorderNotes,
      upsertTaskType,
      deleteTaskType,
      saveMemo,
      updateSetting,
      updateUserContextMarkdown,
      resetUserContext,
      acceptUserContextSuggestion,
      exportData,
      inspectImportData,
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
      notes,
      noteVersions,
      noteTaskLinks,
      projectSubcategories,
      setting,
      userContext,
      isReady,
      bootstrapError,
      credentialStorageError,
      retryBootstrap,
      undoStack,
      autoBackups,
      createTask,
      updateTask,
      removeTask,
      undoLastChange,
      createNote,
      updateNote,
      applyNoteAiClassification,
      removeNote,
      restoreNoteVersion,
      linkNoteToTask,
      unlinkNoteFromTask,
      createSubcategory,
      renameSubcategory,
      deleteSubcategory,
      upsertProject,
      deleteProject,
      reorderProjects,
      reorderNotes,
      upsertTaskType,
      deleteTaskType,
      saveMemo,
      updateSetting,
      updateUserContextMarkdown,
      resetUserContext,
      acceptUserContextSuggestion,
      exportData,
      inspectImportData,
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
