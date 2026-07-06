/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  DEFAULT_AI_CONTEXT_MAX_LENGTH,
  DEFAULT_AUTO_BACKUP_INTERVAL_MINUTES,
  DEFAULT_NOTE_AI_ACTIONS,
  DEFAULT_NOTIFY_BEFORE_MINUTES,
  DEFAULT_PROJECT_IDS,
  DEFAULT_SETTING,
  DEFAULT_USER_CONTEXT,
  MAX_AI_CONTEXT_MAX_LENGTH,
  MAX_AUTOSAVE_NOTE_VERSIONS,
  MAX_MANUAL_NOTE_VERSIONS,
  MIN_AI_CONTEXT_MAX_LENGTH,
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
  canUndo: boolean;
  undoDescription?: string;
  autoBackups: AutoBackupSummary[];
  createTask: (input: TaskFormInput) => Promise<string>;
  updateTask: (id: string, input: TaskFormInput) => Promise<void>;
  removeTask: (id: string) => Promise<void>;
  undoLastChange: () => Promise<void>;
  createNote: (input: NoteFormInput, editType?: NoteVersionEditType, aiPrompt?: string) => Promise<string>;
  updateNote: (id: string, input: NoteFormInput, editType?: NoteVersionEditType, aiPrompt?: string) => Promise<void>;
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
        | "llmModel"
        | "notificationsEnabled"
        | "notifyBeforeMinutes"
        | "autoBackupEnabled"
        | "autoBackupIntervalMinutes"
        | "aiContextMaxLength"
        | "noteAiActions"
      >
    >,
  ) => Promise<void>;
  updateUserContextMarkdown: (markdown: string) => Promise<void>;
  resetUserContext: () => Promise<void>;
  acceptUserContextSuggestion: (suggestion: UserContextSuggestion) => Promise<void>;
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

function validateImportPayload(payload: unknown): payload is {
  tasks: Task[];
  projects: Project[];
  taskTypes: TaskType[];
  memos: Memo[];
  settings: AppSetting[];
  userContexts?: UserContext[];
  notes?: Note[];
  noteVersions?: NoteVersion[];
  noteTaskLinks?: NoteTaskLink[];
  projectSubcategories?: ProjectSubcategory[];
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
    Array.isArray(candidate.settings) &&
    (candidate.userContexts === undefined || Array.isArray(candidate.userContexts)) &&
    (candidate.notes === undefined || Array.isArray(candidate.notes)) &&
    (candidate.noteVersions === undefined || Array.isArray(candidate.noteVersions)) &&
    (candidate.noteTaskLinks === undefined || Array.isArray(candidate.noteTaskLinks)) &&
    (candidate.projectSubcategories === undefined || Array.isArray(candidate.projectSubcategories))
  );
}

function clampAiContextMaxLength(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_AI_CONTEXT_MAX_LENGTH;
  }
  return Math.max(MIN_AI_CONTEXT_MAX_LENGTH, Math.min(MAX_AI_CONTEXT_MAX_LENGTH, Math.floor(value ?? DEFAULT_AI_CONTEXT_MAX_LENGTH)));
}

function normalizeSetting(setting: AppSetting): AppSetting {
  return {
    ...setting,
    notificationsEnabled: setting.notificationsEnabled ?? DEFAULT_SETTING.notificationsEnabled,
    notifyBeforeMinutes: setting.notifyBeforeMinutes ?? DEFAULT_NOTIFY_BEFORE_MINUTES,
    autoBackupEnabled: setting.autoBackupEnabled ?? DEFAULT_SETTING.autoBackupEnabled,
    autoBackupIntervalMinutes: setting.autoBackupIntervalMinutes ?? DEFAULT_AUTO_BACKUP_INTERVAL_MINUTES,
    llmEndpoint: setting.llmEndpoint ?? DEFAULT_SETTING.llmEndpoint,
    llmApiKey: setting.llmApiKey ?? DEFAULT_SETTING.llmApiKey,
    llmModel: setting.llmModel ?? DEFAULT_SETTING.llmModel,
    aiContextMaxLength: clampAiContextMaxLength(setting.aiContextMaxLength),
    noteAiActions:
      Array.isArray(setting.noteAiActions) && setting.noteAiActions.length > 0
        ? setting.noteAiActions
        : DEFAULT_NOTE_AI_ACTIONS,
  };
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
  // setState 업데이터는 렌더 시점에 실행되므로, 이벤트 핸들러에서 즉시 읽을 수 있는
  // 동기 미러를 유지한다. (업데이터 안에서 top을 캡처하면 pop만 되고 복원이 누락될 수 있음)
  const undoStackRef = useRef<UndoEntry[]>([]);
  const [autoBackups, setAutoBackups] = useState<AutoBackupSummary[]>([]);

  useEffect(() => {
    void bootstrapDatabase();
  }, []);

  const tasks = useLiveQuery(() => db.tasks.toArray(), [], []);
  const projects = useLiveQuery(() => db.projects.toArray(), [], []);
  const taskTypes = useLiveQuery(() => db.taskTypes.orderBy("order").toArray(), [], []);
  const memos = useLiveQuery(() => db.memos.toArray(), [], []);
  const notes = useLiveQuery(() => db.notes.toArray(), [], []);
  const noteVersions = useLiveQuery(() => db.noteVersions.toArray(), [], []);
  const noteTaskLinks = useLiveQuery(() => db.noteTaskLinks.toArray(), [], []);
  const projectSubcategories = useLiveQuery(() => db.projectSubcategories.toArray(), [], []);
  const rawSetting = useLiveQuery(() => db.settings.get(SETTINGS_ID), [], undefined);
  const rawUserContext = useLiveQuery(() => db.userContexts.get(USER_CONTEXT_ID), [], undefined);

  const setting = useMemo(() => normalizeSetting(rawSetting ?? DEFAULT_SETTING), [rawSetting]);
  const userContext = useMemo(() => normalizeUserContext(rawUserContext), [rawUserContext]);

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
      const title = input.title.trim() || "제목 없는 노트";
      const note: Note = {
        id,
        title,
        content: input.content,
        projectId: input.projectId,
        subcategoryId: input.subcategoryId,
        tags: input.tags.map((tag) => tag.trim()).filter(Boolean),
        status: input.status,
        isPinned: input.isPinned,
        linkedTaskIds: [],
        createdAt: now,
        updatedAt: now,
      };
      await db.notes.add(note);
      await db.noteVersions.add({
        id: getId("noteversion"),
        noteId: id,
        title,
        content: input.content,
        editType,
        aiPrompt,
        createdAt: now,
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
      const now = toIsoNow();
      const nextTitle = input.title.trim() || "제목 없는 노트";
      const nextTags = input.tags.map((tag) => tag.trim()).filter(Boolean);
      const contentChanged = existing.content !== input.content || existing.title !== nextTitle;
      const metaChanged =
        existing.projectId !== input.projectId ||
        (existing.subcategoryId ?? "") !== (input.subcategoryId ?? "") ||
        existing.status !== input.status ||
        existing.isPinned !== input.isPinned ||
        JSON.stringify(existing.tags) !== JSON.stringify(nextTags);

      if (!contentChanged && !metaChanged) {
        return;
      }

      await db.notes.put({
        ...existing,
        title: nextTitle,
        content: input.content,
        projectId: input.projectId,
        subcategoryId: input.subcategoryId,
        tags: nextTags,
        status: input.status,
        isPinned: input.isPinned,
        updatedAt: now,
      });

      if (contentChanged) {
        await db.noteVersions.add({
          id: getId("noteversion"),
          noteId: id,
          title: nextTitle,
          content: input.content,
          editType,
          aiPrompt,
          createdAt: now,
        });
        await pruneNoteVersions(id);
      }
    },
    [pruneNoteVersions],
  );

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
      if (!note || !version) {
        return;
      }
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
      const now = toIsoNow();
      await db.transaction("rw", [db.notes, db.tasks, db.noteTaskLinks], async () => {
        const [note, task] = await Promise.all([db.notes.get(noteId), db.tasks.get(taskId)]);
        if (!note || !task) {
          return;
        }
        const existingLink = await db.noteTaskLinks.where("[noteId+taskId]").equals([noteId, taskId]).first();
        if (!existingLink) {
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
    if (!trimmed) {
      throw new Error("세부 항목 이름을 입력해 주세요.");
    }
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
    if (!trimmed) {
      throw new Error("세부 항목 이름을 입력해 주세요.");
    }
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

    // 새 프로젝트는 목록 맨 뒤 순서로 추가한다
    const existingProjects = await db.projects.toArray();
    const maxOrder = existingProjects.reduce((max, project) => Math.max(max, project.order ?? -1), -1);
    await db.projects.add({
      id: getId("project"),
      name,
      color: input.color,
      description: input.description?.trim(),
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
          | "llmEndpoint"
          | "llmApiKey"
          | "llmModel"
          | "notificationsEnabled"
          | "notifyBeforeMinutes"
          | "autoBackupEnabled"
          | "autoBackupIntervalMinutes"
          | "aiContextMaxLength"
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
        aiContextMaxLength:
          patch.aiContextMaxLength !== undefined
            ? clampAiContextMaxLength(patch.aiContextMaxLength)
            : current.aiContextMaxLength,
        id: SETTINGS_ID,
        updatedAt: toIsoNow(),
      });
    },
    [],
  );

  const updateUserContextMarkdown = useCallback(async (markdown: string) => {
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
    const data = {
      exportedAt: toIsoNow(),
      version: 3,
      tasks: await db.tasks.toArray(),
      projects: await db.projects.toArray(),
      taskTypes: await db.taskTypes.toArray(),
      memos: await db.memos.toArray(),
      settings: await db.settings.toArray(),
      userContexts: await db.userContexts.toArray(),
      notes: await db.notes.toArray(),
      noteVersions: await db.noteVersions.toArray(),
      noteTaskLinks: await db.noteTaskLinks.toArray(),
      projectSubcategories: await db.projectSubcategories.toArray(),
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
        if (parsed.userContexts && parsed.userContexts.length > 0) {
          await db.userContexts.bulkAdd(parsed.userContexts.map(normalizeUserContext));
        }
        if (parsed.notes && parsed.notes.length > 0) {
          await db.notes.bulkAdd(parsed.notes);
        }
        if (parsed.noteVersions && parsed.noteVersions.length > 0) {
          await db.noteVersions.bulkAdd(parsed.noteVersions);
        }
        if (parsed.noteTaskLinks && parsed.noteTaskLinks.length > 0) {
          await db.noteTaskLinks.bulkAdd(parsed.noteTaskLinks);
        }
        if (parsed.projectSubcategories && parsed.projectSubcategories.length > 0) {
          await db.projectSubcategories.bulkAdd(parsed.projectSubcategories);
        }
      },
    );

    undoStackRef.current = [];
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
      tasks: tasks
        .filter((task) => isTaskActive(task.status))
        .map((task) => ({
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
      notes,
      noteVersions,
      noteTaskLinks,
      projectSubcategories,
      setting,
      userContext,
      isReady,
      canUndo: undoStack.length > 0,
      undoDescription: undoStack[undoStack.length - 1]?.description,
      autoBackups,
      createTask,
      updateTask,
      removeTask,
      undoLastChange,
      createNote,
      updateNote,
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
      upsertTaskType,
      deleteTaskType,
      saveMemo,
      updateSetting,
      updateUserContextMarkdown,
      resetUserContext,
      acceptUserContextSuggestion,
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
      notes,
      noteVersions,
      noteTaskLinks,
      projectSubcategories,
      setting,
      userContext,
      isReady,
      undoStack,
      autoBackups,
      createTask,
      updateTask,
      removeTask,
      undoLastChange,
      createNote,
      updateNote,
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
      upsertTaskType,
      deleteTaskType,
      saveMemo,
      updateSetting,
      updateUserContextMarkdown,
      resetUserContext,
      acceptUserContextSuggestion,
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
