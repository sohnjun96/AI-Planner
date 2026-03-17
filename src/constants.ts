import type { AppSetting, Project, RecurrencePattern, TaskStatus, TaskType } from "./models";

export const SETTINGS_ID = "default";
export const DEFAULT_PROJECT_ID = "project-general";

// LLM endpoint is intentionally fixed in code for intranet deployment.
export const LLM_CHAT_COMPLETIONS_URL = "http://127.0.0.1:3000/api/chat/completions";
export const LLM_DEFAULT_MODEL = "gpt-4o-mini";

export const DEFAULT_NOTIFY_BEFORE_MINUTES = 30;
export const DEFAULT_AUTO_BACKUP_INTERVAL_MINUTES = 360;

export const COLOR_PRESETS = [
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#eab308",
  "#84cc16",
  "#22c55e",
  "#10b981",
  "#14b8a6",
  "#06b6d4",
  "#0ea5e9",
  "#3b82f6",
  "#6366f1",
  "#8b5cf6",
  "#a855f7",
  "#d946ef",
  "#ec4899",
  "#f43f5e",
  "#64748b",
] as const;

export function pickRandomPresetColor(excludeColor?: string): string {
  const source = excludeColor
    ? COLOR_PRESETS.filter((color) => color.toLowerCase() !== excludeColor.toLowerCase())
    : COLOR_PRESETS;
  if (source.length === 0) {
    return COLOR_PRESETS[0];
  }
  const randomIndex = Math.floor(Math.random() * source.length);
  return source[randomIndex];
}

export const STATUS_LABELS: Record<TaskStatus, string> = {
  NOT_DONE: "미완료",
  ON_HOLD: "보류",
  DONE: "완료",
};

export const RECURRENCE_LABELS: Record<RecurrencePattern, string> = {
  NONE: "반복 없음",
  DAILY: "매일",
  WEEKLY: "매주",
  MONTHLY: "매월",
};

export const DEFAULT_TASK_TYPES: TaskType[] = [
  {
    id: "type-write",
    name: "작성",
    color: "#2563eb",
    isDefault: true,
    isActive: true,
    order: 1,
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "type-submit",
    name: "제출",
    color: "#dc2626",
    isDefault: true,
    isActive: true,
    order: 2,
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "type-report",
    name: "보고",
    color: "#0f766e",
    isDefault: true,
    isActive: true,
    order: 3,
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "type-event",
    name: "행사",
    color: "#f59e0b",
    isDefault: true,
    isActive: true,
    order: 4,
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "type-trip",
    name: "출장",
    color: "#7c3aed",
    isDefault: true,
    isActive: true,
    order: 5,
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "type-leave",
    name: "연가",
    color: "#0ea5e9",
    isDefault: true,
    isActive: true,
    order: 6,
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "type-etc",
    name: "기타",
    color: "#6b7280",
    isDefault: true,
    isActive: true,
    order: 7,
    createdAt: "",
    updatedAt: "",
  },
];

export const DEFAULT_PROJECT: Project = {
  id: DEFAULT_PROJECT_ID,
  name: "일반",
  color: "#334155",
  description: "기본 프로젝트",
  isActive: true,
  createdAt: "",
  updatedAt: "",
};

export const DEFAULT_SETTING: AppSetting = {
  id: SETTINGS_ID,
  showPastCompleted: false,
  weekStartsOn: "mon",
  timeFormat: "24h",
  llmApiKey: "",
  llmModel: LLM_DEFAULT_MODEL,
  notificationsEnabled: true,
  notifyBeforeMinutes: DEFAULT_NOTIFY_BEFORE_MINUTES,
  autoBackupEnabled: true,
  autoBackupIntervalMinutes: DEFAULT_AUTO_BACKUP_INTERVAL_MINUTES,
  updatedAt: "",
};
