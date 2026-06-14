export type TaskStatus = "NOT_DONE" | "ON_HOLD" | "DONE";
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
  recurrencePattern?: RecurrencePattern;
  recurrenceGroupId?: string;
  recurrenceIndex?: number;
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
