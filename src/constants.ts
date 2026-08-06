import type { AppSetting, NoteAiAction, NoteStatus, Project, RecurrencePattern, TaskStatus, TaskType } from "./models";

import type { LlmReasoningEffort, UserContext } from "./models";
import { BUILD_PROFILE } from "./config/buildProfile";

export const SETTINGS_ID = "default";
export const USER_CONTEXT_ID = "user-context";
export const DEFAULT_PROJECT_ID = "project-general";
export const LUNCH_PROJECT_ID = "project-lunch";

export const BUILD_PROFILE_ID = BUILD_PROFILE.id;
export const BUILD_PROFILE_LABEL = BUILD_PROFILE.label;
export const DEFAULT_LLM_CHAT_COMPLETIONS_URL = BUILD_PROFILE.chatEndpoint;
export const DEFAULT_LLM_MODELS_URL = BUILD_PROFILE.modelsEndpoint;
export const DEFAULT_LLM_MODELS_URLS = BUILD_PROFILE.modelsEndpoints;
export const LLM_REQUEST_TIMEOUT_MS = 60_000;
export const LLM_IDLE_TIMEOUT_MS = 15_000;
export const LLM_MAX_COMPLETION_TOKENS = 4_096;
export const LLM_MAX_RESPONSE_BYTES = 1_000_000;
export const LLM_MAX_ERROR_BYTES = 8_192;
export const LLM_MAX_TOTAL_PROMPT_CHARS = 250_000;
export const LLM_MAX_MESSAGE_COUNT = 64;
export const LLM_MAX_API_KEY_LENGTH = 4_096;
export const LLM_MAX_MODEL_ID_LENGTH = 200;
export const LLM_MAX_MODEL_COUNT = 500;
export const LLM_MAX_MODEL_LIST_BYTES = 256_000;
export const LLM_MODEL_LIST_TIMEOUT_MS = 15_000;
export const LLM_DEFAULT_MODEL = "gpt-4o-mini";
export const DEFAULT_LLM_TEMPERATURE = 0;
export const MIN_LLM_TEMPERATURE = 0;
export const MAX_LLM_TEMPERATURE = 2;
export const DEFAULT_LLM_REASONING_EFFORT: LlmReasoningEffort = "default";
export const DEFAULT_LLM_GEMMA_THINKING_ENABLED = false;

export function isValidLlmModelId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const normalized = value.trim();
  return normalized.length > 0
    && normalized.length <= LLM_MAX_MODEL_ID_LENGTH
    && /^[A-Za-z0-9._:/-]+$/.test(normalized);
}

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

export const DEFAULT_NOTIFY_BEFORE_MINUTES = 5;
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
  {
    id: "polish",
    label: "다듬기",
    prompt:
      "노트의 의미와 사실관계, 수치, 날짜, 고유명사, 결정사항은 바꾸지 말고 문장만 다듬어줘. 맞춤법·띄어쓰기·문법 오류를 고치고, 어색하거나 장황한 표현은 자연스러운 업무 문서 문체로 정리해줘. 문단 간 흐름과 지시 대상이 모호한 부분은 원문의 범위 안에서 명확하게 만들어줘. 기존 제목, 마크다운 구조, 링크, 표, 체크리스트 항목과 완료 상태는 유지해.",
  },
  {
    id: "summary",
    label: "요약",
    prompt:
      "이 노트의 목적, 핵심 논의·결정, 중요한 사실과 수치, 후속 조치가 한눈에 보이도록 한국어 마크다운으로 요약해줘. 첫머리에 1~2문장 핵심 요약을 두고, 필요하면 ‘주요 내용’, ‘결정 사항’, ‘다음 할 일/확인 필요’로 나눠줘. 원문에 없는 사실·기한·담당자·결론은 추정하거나 추가하지 말고, 불확실한 내용은 확인이 필요함을 분명히 표시해.",
  },
  {
    id: "structure",
    label: "구조화",
    prompt:
      "내용을 삭제하거나 사실을 바꾸지 말고, 읽는 사람이 빠르게 이해하고 필요한 정보를 찾을 수 있도록 노트를 재구성해줘. 노트의 목적과 흐름에 맞는 제목·소제목을 만들고, 서로 관련된 내용을 묶어 짧은 문단과 목록으로 정리해줘. 결정 사항, 배경·논의, 참고 정보, 실행 항목은 구분해 보여줘. 기존 마크다운 요소와 체크리스트의 항목·완료 상태는 유지하고, 원문에 없는 내용은 만들지 마.",
  },
  {
    id: "checklist",
    label: "체크리스트",
    prompt:
      "노트에서 실제로 수행해야 하는 행동·확인·후속 조치만 추려 마크다운 체크리스트로 정리해줘. 각 항목은 누가 읽어도 바로 실행할 수 있도록 ‘무엇을, 필요하면 언제까지/누구와’의 형태로 구체적으로 작성해줘. 단순 배경 설명, 이미 확정된 사실, 실행 주체가 없는 추상적 희망은 할 일로 바꾸지 마. 원문에 있는 기존 체크리스트는 유지하고 완료 상태도 바꾸지 마. 담당자나 기한이 명시되지 않았다면 임의로 채우지 말고 생략하거나 ‘확인 필요’로 표시해.",
  },
  {
    id: "expand",
    label: "구체화",
    prompt:
      "노트의 각 핵심 항목을 실행과 의사결정에 바로 활용할 수 있도록 구체화해줘. 원문에 근거가 있는 경우에만 목적, 대상·범위, 필요한 입력 자료, 수행 절차, 산출물, 담당·기한, 확인 기준을 보완해줘. 근거가 부족한 정보는 사실처럼 만들어내지 말고 ‘확인 필요’ 또는 질문 형태로 남겨줘. 핵심 내용의 우선순위와 원래 의미는 유지하며, 불필요하게 장황한 설명은 추가하지 마.",
  },
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

export const DEFAULT_USER_CONTEXT_PREFERENCE_RULES = [
  "일정 수정 요청에 시간 언급이 따로 없으면 기존 일정의 시작·종료 시간을 그대로 유지한다.",
  "시간 없이 특정 날짜까지 일정을 생성해 달라고 요청하면 그 날짜의 18:00을 시작 시각으로 설정하고 종료 시각은 만들지 않는다.",
] as const;

export const DEFAULT_USER_CONTEXT_MARKDOWN = `# AI 일정 관리 개인 규칙

## 적용 원칙
- 현재 요청에 구체적으로 적힌 내용이 이 규칙보다 우선한다.
- 날짜, 시간, 담당자, 장소, 기한, 프로젝트, 일정 종류는 요청에 없는 내용을 임의로 만들지 않는다.
- 상대 날짜(오늘, 내일, 다음 주 등)는 현재 날짜를 기준으로 해석한다. 기준이 모호하면 확인한다.
- 일정 제목은 짧고 분명하게 작성한다. 가능하면 ‘무엇을 하는 일정인지’가 드러나게 쓴다.

## 기본 시간 규칙
- 점심·식사·밥·lunch 일정에 시간이 없으면 11:30으로 설정한다.
- 제출·마감·과제 일정에 시간이 없으면 18:00을 시작 시각으로 설정하고 종료 시각은 만들지 않는다.
- 그 밖의 일정은 요청에 시간이 없으면 시간을 임의로 지정하지 않는다.
- 시작과 끝이 모두 명시된 시간·날짜 범위에만 종료 시각을 설정한다. ‘18시까지’, ‘금요일까지’처럼 마감만 말한 요청은 해당 시점을 시작 시각으로 설정한다.

## 기본 분류 규칙
- 점심, 식사, 밥, lunch가 포함된 일정은 프로젝트를 \`점심 약속\`, 종류를 \`식사\`로 설정한다. (일정제목은 "(점) 참여자 1, 참여자 2" 포맷으로 한다)
- 제출, 마감, 과제가 포함된 일정은 종류를 \`제출\`로 설정한다.
- 회의, 미팅, 면담, 협의가 포함된 일정은 종류를 \`회의\`로 설정한다.
- 사용자가 프로젝트나 일정 종류를 직접 지정하면 그 값을 우선한다.

## 중요도와 기한
- 제출 또는 마감 성격의 일정은 중요 일정으로 표시한다.
- 요청에 ‘중요’, ‘필수’, ‘긴급’, ‘반드시’ 등의 표현이 있으면 중요 일정으로 표시한다.
- 처장님, 차장님과 관련된 일정은 중요 일정으로 표시한다.
- 단순 참고·선택·보류 성격의 내용은 일정으로 단정하지 말고, 등록이 필요한지 먼저 확인한다.

## 선호 규칙
${DEFAULT_USER_CONTEXT_PREFERENCE_RULES.map((rule) => `- ${rule}`).join("\n")}

## 결과 품질
- 하나의 요청에 서로 독립된 일정이 여러 개 있으면 각각 분리해 제안한다.
- 반복 일정은 반복 주기와 종료 조건이 명확할 때만 설정한다.
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
      note: "시간 없는 제출 일정은 18:00을 시작 시각으로 잡고 종료 시각 없이 중요 일정으로 표시합니다.",
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
  weekStartsOn: "sun",
  timeFormat: "24h",
  llmEndpoint: DEFAULT_LLM_CHAT_COMPLETIONS_URL,
  rememberLlmApiKey: false,
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
  noteTaskSuggestionsEnabled: false,
  relatedNoteSuggestionsEnabled: false,
  updatedAt: "",
};
