export type TaskStatus = "NOT_DONE" | "ON_HOLD" | "DONE";

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
  llmApiKey?: string;
  llmModel?: string;
  updatedAt: string;
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
}
