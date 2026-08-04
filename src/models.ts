export type TaskStatus = "NOT_DONE" | "ON_HOLD" | "DONE" | "CANCELED";
export type RecurrencePattern = "NONE" | "DAILY" | "WEEKLY" | "MONTHLY";

export interface Task {
  id: string;
  title: string;
  content: string;
  taskTypeId: string;
  projectId: string;
  status: TaskStatus;
  startAt: string;
  endAt?: string;
  isMajor: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  canceledAt?: string;
  recurrencePattern?: RecurrencePattern;
  recurrenceGroupId?: string;
  recurrenceIndex?: number;
  linkedNoteIds?: string[];
}

export interface ArchiveInsightCache {
  id: string;
  sourceFingerprint: string;
  payload: string;
  lastAttemptedAt?: string;
  updatedAt: string;
}

export type NoteStatus = "draft" | "active" | "archived";
export type NoteVersionEditType = "manual" | "ai_full" | "ai_inline" | "autosave" | "restore";
export type NoteTaskLinkSource = "auto_suggest" | "manual";

export interface ProjectSubcategory {
  id: string;
  projectId: string;
  name: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  projectId: string;
  subcategoryId?: string;
  tags: string[];
  status: NoteStatus;
  isPinned: boolean;
  linkedTaskIds: string[];
  /** AI가 이 노트의 프로젝트/세부 항목을 최초 1회 분류한 시각. */
  aiClassifiedAt?: string;
  /** 탐색기에서 드래그로 정한 표시 순서. 없으면(-1 취급) 최근 수정순으로 맨 위 그룹에 온다. */
  sortOrder?: number;
  createdAt: string;
  updatedAt: string;
}

export interface NoteVersion {
  id: string;
  noteId: string;
  title: string;
  content: string;
  editType: NoteVersionEditType;
  aiPrompt?: string;
  createdAt: string;
}

export interface NoteTaskLink {
  id: string;
  noteId: string;
  taskId: string;
  source: NoteTaskLinkSource;
  createdAt: string;
}

export interface NoteFormInput {
  title: string;
  content: string;
  projectId: string;
  subcategoryId?: string;
  tags: string[];
  status: NoteStatus;
  isPinned: boolean;
}

export interface NoteTaskSuggestion {
  taskId: string;
  score: number;
  reason: string;
}

export interface Project {
  id: string;
  name: string;
  color: string;
  description?: string;
  isActive: boolean;
  /** 프로젝트 탭에서 드래그앤드롭으로 정한 표시 순서. 없으면 이름순으로 뒤에 배치된다. */
  order?: number;
  createdAt: string;
  updatedAt: string;
}

export interface TaskType {
  id: string;
  name: string;
  color: string;
  isDefault: boolean;
  isActive: boolean;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface Memo {
  id: string;
  date: string;
  content: string;
  updatedAt: string;
}

export interface NoteAiAction {
  id: string;
  label: string;
  prompt: string;
}

export type LlmReasoningEffort = "default" | "none" | "low" | "medium" | "high";

export interface AppSetting {
  id: string;
  showPastCompleted: boolean;
  weekStartsOn: "sun" | "mon";
  timeFormat: "24h" | "12h";
  llmEndpoint?: string;
  llmApiKey?: string;
  rememberLlmApiKey?: boolean;
  llmModel?: string;
  llmTemperature?: number;
  llmReasoningEffort?: LlmReasoningEffort;
  llmGemmaThinkingEnabled?: boolean;
  notificationsEnabled?: boolean;
  notifyBeforeMinutes?: number;
  autoBackupEnabled?: boolean;
  autoBackupIntervalMinutes?: number;
  aiContextMaxLength?: number;
  noteAiActions?: NoteAiAction[];
  noteTaskSuggestionsEnabled?: boolean;
  relatedNoteSuggestionsEnabled?: boolean;
  updatedAt: string;
}

export type UserContextRuleCategory = "time" | "classification" | "preference";
export type UserContextRuleSource = "default" | "user" | "ai";

export interface UserContextRule {
  id: string;
  category: UserContextRuleCategory;
  label: string;
  trigger: string[];
  projectId?: string;
  taskTypeId?: string;
  defaultTime?: string;
  isMajor?: boolean;
  note?: string;
  source: UserContextRuleSource;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserContext {
  id: string;
  markdown: string;
  rules: UserContextRule[];
  updatedAt: string;
}

export interface UserContextSuggestion {
  category: UserContextRuleCategory;
  label?: string;
  trigger: string[];
  projectId?: string;
  taskTypeId?: string;
  defaultTime?: string;
  isMajor?: boolean;
  note?: string;
  reason?: string;
}

export interface TaskFormInput {
  title: string;
  content: string;
  taskTypeId: string;
  projectId: string;
  status: TaskStatus;
  startAt: string;
  endAt?: string;
  isMajor: boolean;
  recurrencePattern?: RecurrencePattern;
  recurrenceCount?: number;
}
