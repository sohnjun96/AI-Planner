import type { AppSetting, NoteAiAction, NoteStatus, Project, RecurrencePattern, TaskStatus, TaskType } from "./models";

import type { LlmReasoningEffort, UserContext } from "./models";

export const SETTINGS_ID = "default";
export const USER_CONTEXT_ID = "user-context";
export const DEFAULT_PROJECT_ID = "project-general";
export const LUNCH_PROJECT_ID = "project-lunch";

export const DEFAULT_LLM_CHAT_COMPLETIONS_URL = "http://127.0.0.1:3000/api/chat/completions";
export const LLM_DEFAULT_MODEL = "gpt-4o-mini";
export const DEFAULT_LLM_TEMPERATURE = 0;
export const MIN_LLM_TEMPERATURE = 0;
export const MAX_LLM_TEMPERATURE = 2;
export const DEFAULT_LLM_REASONING_EFFORT: LlmReasoningEffort = "default";
export const DEFAULT_LLM_GEMMA_THINKING_ENABLED = false;

export function clampLlmTemperature(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_LLM_TEMPERATURE;
  }
  return Math.max(MIN_LLM_TEMPERATURE, Math.min(MAX_LLM_TEMPERATURE, value));
}

export function normalizeLlmReasoningEffort(value: unknown): LlmReasoningEffort {
  return value === "none" || value === "low" || value === "medium" || value === "high"
    ? value
    : DEFAULT_LLM_REASONING_EFFORT;
}

export function normalizeLlmGemmaThinkingEnabled(value: unknown): boolean {
  return value === true;
}

export const DEFAULT_NOTIFY_BEFORE_MINUTES = 30;
export const DEFAULT_AUTO_BACKUP_INTERVAL_MINUTES = 360;
export const DEFAULT_AI_CONTEXT_MAX_LENGTH = 2000;
export const MIN_AI_CONTEXT_MAX_LENGTH = 500;
export const MAX_AI_CONTEXT_MAX_LENGTH = 8000;

// AI 노트 관련 상수
export const NOTE_AUTOSAVE_DEBOUNCE_MS = 5 * 60 * 1000; // 자동저장 5분 디바운스 (버전 폭발 방지)
export const MAX_MANUAL_NOTE_VERSIONS = 100; // 수동/AI 버전 보관 개수
export const MAX_AUTOSAVE_NOTE_VERSIONS = 20; // 자동저장 버전 보관 개수
export const MAX_NOTE_TASK_SUGGESTIONS = 5; // 관련 일정 추천 개수
export const NOTE_SUGGESTION_DATE_WINDOW_DAYS = 3; // 일정 추천 시 노트 생성일 ±N일

export const NOTE_STATUS_LABELS: Record<NoteStatus, string> = {
  draft: "초안",
  active: "활성",
  archived: "보관",
};

export const DEFAULT_NOTE_AI_ACTIONS: NoteAiAction[] = [
  { id: "polish", label: "다듬기", prompt: "맞춤법과 어색한 문장을 자연스럽게 다듬어줘. 내용과 구조는 유지해." },
  { id: "summary", label: "요약", prompt: "핵심만 간결하게 요약해줘." },
  { id: "structure", label: "구조화", prompt: "제목과 소제목, 목록을 활용해 읽기 쉽게 구조화해줘." },
  { id: "checklist", label: "체크리스트", prompt: "할 일 항목을 마크다운 체크리스트로 정리해줘." },
  { id: "expand", label: "구체화", prompt: "각 항목을 더 구체적이고 실행 가능하게 확장해줘." },
];

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
  "#1d4ed8",
  "#2563eb",
  "#60a5fa",
  "#38bdf8",
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
  CANCELED: "취소",
};

export const RECURRENCE_LABELS: Record<RecurrencePattern, string> = {
  NONE: "반복 없음",
  DAILY: "매일",
  WEEKLY: "매주",
  MONTHLY: "매월",
};

export const DEFAULT_TASK_TYPES: TaskType[] = [
  {
    id: "type-meeting",
    name: "회의",
    color: "#2563eb",
    isDefault: true,
    isActive: true,
    order: 1,
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "type-meal",
    name: "식사",
    color: "#0e7490",
    isDefault: true,
    isActive: true,
    order: 2,
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "type-write",
    name: "작성",
    color: "#3b82f6",
    isDefault: true,
    isActive: true,
    order: 3,
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "type-submit",
    name: "제출",
    color: "#dc2626",
    isDefault: true,
    isActive: true,
    order: 4,
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "type-report",
    name: "보고",
    color: "#0f766e",
    isDefault: true,
    isActive: true,
    order: 5,
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "type-event",
    name: "행사",
    color: "#f59e0b",
    isDefault: true,
    isActive: true,
    order: 6,
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "type-trip",
    name: "출장",
    color: "#1d4ed8",
    isDefault: true,
    isActive: true,
    order: 7,
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "type-leave",
    name: "연가",
    color: "#0ea5e9",
    isDefault: true,
    isActive: true,
    order: 8,
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "type-etc",
    name: "기타",
    color: "#6b7280",
    isDefault: true,
    isActive: true,
    order: 9,
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

export const DEFAULT_PROJECTS: Project[] = [
  DEFAULT_PROJECT,
  {
    id: LUNCH_PROJECT_ID,
    name: "점심 약속",
    color: "#0e7490",
    description: "점심 식사와 식사 약속을 관리하는 기본 프로젝트",
    isActive: true,
    createdAt: "",
    updatedAt: "",
  },
];

export const DEFAULT_PROJECT_IDS = DEFAULT_PROJECTS.map((project) => project.id);

export const DEFAULT_USER_CONTEXT_MARKDOWN = `# User Context

## 기본 시간 규칙
- 점심 일정은 시간이 없으면 11:30으로 설정한다.
- 제출 일정은 시간이 없으면 18:00으로 설정한다.

## 기본 분류 규칙
- 점심, 식사, 밥, lunch가 포함되면 프로젝트는 점심 약속, 종류는 식사로 설정한다.
- 제출, 마감, 과제가 포함되면 종류는 제출로 설정한다.
- 회의, 미팅이 포함되면 종류는 회의로 설정한다.

## 선호 규칙
- 제출 또는 마감 일정은 중요 일정으로 표시한다.
`;

export const DEFAULT_USER_CONTEXT: UserContext = {
  id: USER_CONTEXT_ID,
  markdown: DEFAULT_USER_CONTEXT_MARKDOWN,
  rules: [
    {
      id: "context-lunch-default",
      category: "classification",
      label: "점심 기본 분류",
      trigger: ["점심", "식사", "밥", "lunch"],
      projectId: LUNCH_PROJECT_ID,
      taskTypeId: "type-meal",
      defaultTime: "11:30",
      isMajor: false,
      note: "점심 일정은 기본 프로젝트와 식사 종류로 정리합니다.",
      source: "default",
      isActive: true,
      createdAt: "",
      updatedAt: "",
    },
    {
      id: "context-submit-default",
      category: "time",
      label: "제출 기본 시간",
      trigger: ["제출", "마감", "과제"],
      taskTypeId: "type-submit",
      defaultTime: "18:00",
      isMajor: true,
      note: "시간 없는 제출 일정은 18:00까지로 잡고 중요 일정으로 표시합니다.",
      source: "default",
      isActive: true,
      createdAt: "",
      updatedAt: "",
    },
    {
      id: "context-meeting-default",
      category: "classification",
      label: "회의 기본 종류",
      trigger: ["회의", "미팅"],
      taskTypeId: "type-meeting",
      note: "회의성 일정은 기본적으로 회의 종류로 분류합니다.",
      source: "default",
      isActive: true,
      createdAt: "",
      updatedAt: "",
    },
  ],
  updatedAt: "",
};

export const DEFAULT_SETTING: AppSetting = {
  id: SETTINGS_ID,
  showPastCompleted: false,
  weekStartsOn: "mon",
  timeFormat: "24h",
  llmEndpoint: DEFAULT_LLM_CHAT_COMPLETIONS_URL,
  llmApiKey: "",
  llmModel: LLM_DEFAULT_MODEL,
  llmTemperature: DEFAULT_LLM_TEMPERATURE,
  llmReasoningEffort: DEFAULT_LLM_REASONING_EFFORT,
  llmGemmaThinkingEnabled: DEFAULT_LLM_GEMMA_THINKING_ENABLED,
  notificationsEnabled: true,
  notifyBeforeMinutes: DEFAULT_NOTIFY_BEFORE_MINUTES,
  autoBackupEnabled: true,
  autoBackupIntervalMinutes: DEFAULT_AUTO_BACKUP_INTERVAL_MINUTES,
  aiContextMaxLength: DEFAULT_AI_CONTEXT_MAX_LENGTH,
  noteAiActions: DEFAULT_NOTE_AI_ACTIONS,
  updatedAt: "",
};
