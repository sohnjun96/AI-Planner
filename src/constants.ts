import type { AppSetting, Project, TaskStatus, TaskType } from "./models";

export const SETTINGS_ID = "default";
export const DEFAULT_PROJECT_ID = "project-general";

// LLM endpoint is intentionally fixed in code for intranet deployment.
export const LLM_CHAT_COMPLETIONS_URL = "http://127.0.0.1:3000/api/chat/completions";
export const LLM_DEFAULT_MODEL = "gpt-4o-mini";

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
  NOT_DONE: "\uBBF8\uC644\uB8CC",
  ON_HOLD: "\uBCF4\uB958",
  DONE: "\uC644\uB8CC",
};

export const DEFAULT_TASK_TYPES: TaskType[] = [
  {
    id: "type-write",
    name: "\uC791\uC131",
    color: "#2563eb",
    isDefault: true,
    isActive: true,
    order: 1,
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "type-submit",
    name: "\uC81C\uCD9C",
    color: "#dc2626",
    isDefault: true,
    isActive: true,
    order: 2,
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "type-report",
    name: "\uBCF4\uACE0",
    color: "#0f766e",
    isDefault: true,
    isActive: true,
    order: 3,
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "type-event",
    name: "\uD589\uC0AC",
    color: "#f59e0b",
    isDefault: true,
    isActive: true,
    order: 4,
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "type-trip",
    name: "\uCD9C\uC7A5",
    color: "#7c3aed",
    isDefault: true,
    isActive: true,
    order: 5,
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "type-leave",
    name: "\uC5F0\uAC00",
    color: "#0ea5e9",
    isDefault: true,
    isActive: true,
    order: 6,
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "type-etc",
    name: "\uAE30\uD0C0",
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
  name: "\uC77C\uBC18",
  color: "#334155",
  description: "\uAE30\uBCF8 \uD504\uB85C\uC81D\uD2B8",
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
  updatedAt: "",
};
