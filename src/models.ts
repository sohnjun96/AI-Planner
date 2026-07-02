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

export interface AppSetting {
  id: string;
  showPastCompleted: boolean;
  weekStartsOn: "sun" | "mon";
  timeFormat: "24h" | "12h";
  llmEndpoint?: string;
  llmApiKey?: string;
  llmModel?: string;
  notificationsEnabled?: boolean;
  notifyBeforeMinutes?: number;
  autoBackupEnabled?: boolean;
  autoBackupIntervalMinutes?: number;
  aiContextMaxLength?: number;
  noteAiActions?: NoteAiAction[];
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
