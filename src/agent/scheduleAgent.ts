import { DEFAULT_AI_CONTEXT_MAX_LENGTH, DEFAULT_PROJECT_ID, DEFAULT_TASK_TYPES } from "../constants";
import type { Project, Task, TaskStatus, TaskType, UserContext, UserContextRuleCategory, UserContextSuggestion } from "../models";
import { toIsoNow } from "../utils/date";
import {
  ToolCallCache,
  capToolResults,
  duplicateCallNotice,
  execCurrentDatetime,
  execGetTask,
  execSearchTasks,
  type SharedToolResult,
} from "./agentTools";
import {
  isRecord,
  pickFirstString,
  pickFirstStringArray,
  requestJsonWithRetry,
  resolveEntityId,
  tryParseJsonLikeValue,
  type LlmChatMessage,
} from "./agentUtils";

type AgentToolName = "list_projects" | "list_task_types" | "search_tasks" | "get_task" | "current_datetime";

interface AgentToolCall {
  tool: AgentToolName;
  args: Record<string, unknown>;
}

interface AgentModelPayload {
  assistantMessage?: unknown;
  needsUserInput?: unknown;
  userQuestion?: unknown;
  toolCalls?: unknown;
  proposal?: unknown;
  contextSuggestions?: unknown;
  summary?: unknown;
}

export interface AgentConversationMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AgentCreateTaskOperation {
  action: "create_task";
  title: string;
  content: string;
  taskTypeId: string;
  projectId: string;
  status: TaskStatus;
  startAt: string;
  endAt?: string;
  isMajor: boolean;
}

export interface AgentUpdateTaskOperation {
  action: "update_task";
  taskId: string;
  changes: Partial<{
    title: string;
    content: string;
    taskTypeId: string;
    projectId: string;
    status: TaskStatus;
    startAt: string;
    endAt: string | null;
    isMajor: boolean;
  }>;
}

export interface AgentDeleteTaskOperation {
  action: "delete_task";
  taskId: string;
  reason?: string;
}

export type AgentOperation = AgentCreateTaskOperation | AgentUpdateTaskOperation | AgentDeleteTaskOperation;

export interface AgentProposal {
  summary: string;
  operations: AgentOperation[];
}

export type AgentContextSuggestion = UserContextSuggestion;

type ToolExecutionResult = SharedToolResult;

export interface RunScheduleAgentInput {
  userMessage: string;
  conversation: AgentConversationMessage[];
  tasks: Task[];
  projects: Project[];
  taskTypes: TaskType[];
  userContext?: UserContext;
  userContextMaxLength?: number;
  endpoint?: string;
  apiKey: string;
  model?: string;
  onProgress?: (info: ScheduleAgentProgress) => void;
  signal?: AbortSignal;
}

export interface ScheduleAgentProgress {
  phase: "tools" | "writing";
  label: string;
  chars?: number;
}

export interface RunScheduleAgentResult {
  assistantMessage: string;
  needsUserInput: boolean;
  question?: string;
  proposal?: AgentProposal;
  contextSuggestions: AgentContextSuggestion[];
  /** AI가 사용한 도구 요약 (신뢰용 작업 내역) */
  trace?: string;
}

const SCHEDULE_TOOL_LABELS: Record<AgentToolName, string> = {
  list_projects: "프로젝트 목록",
  list_task_types: "종류 목록",
  search_tasks: "일정 검색",
  get_task: "일정 조회",
  current_datetime: "현재 시각 확인",
};

function summarizeScheduleTools(counts: Map<string, number>): string {
  return Array.from(counts.entries())
    .map(([label, count]) => `${label} ${count}건`)
    .join(", ");
}

interface ParseOptions {
  projects?: Project[];
  taskTypes?: TaskType[];
  fallbackProjectId?: string;
  fallbackTaskTypeId?: string;
  fallbackSummary?: string;
}

const MAX_TOOL_ROUNDS = 4;

const NOT_DONE_STATUS_ALIASES = ["not_done", "notdone", "todo", "pending", "in_progress", "\ubbf8\uc644\ub8cc", "\ub300\uae30"] as const;
const ON_HOLD_STATUS_ALIASES = ["on_hold", "hold", "paused", "\ubcf4\ub958", "\ud640\ub4dc"] as const;
const DONE_STATUS_ALIASES = ["done", "complete", "completed", "\uc644\ub8cc", "\ub05d\ub0a8"] as const;
const CANCELED_STATUS_ALIASES = ["canceled", "cancelled", "cancel", "cancel_task", "\ucde8\uc18c", "\ucde8\uc18c\ub428", "\ucde8\uc18c\ud558\uae30"] as const;

const DIRECT_OPERATION_KEYS = [
  "operations",
  "tasks",
  "draftTasks",
  "draft_tasks",
  "items",
  "drafts",
  "actions",
  "operationDrafts",
  "operation_drafts",
] as const;

const GROUPED_OPERATION_DEFS = [
  { key: "createTasks", action: "create_task" },
  { key: "create_tasks", action: "create_task" },
  { key: "creates", action: "create_task" },
  { key: "additions", action: "create_task" },
  { key: "updateTasks", action: "update_task" },
  { key: "update_tasks", action: "update_task" },
  { key: "updates", action: "update_task" },
  { key: "deleteTasks", action: "delete_task" },
  { key: "delete_tasks", action: "delete_task" },
  { key: "deletes", action: "delete_task" },
  { key: "removals", action: "delete_task" },
] as const satisfies ReadonlyArray<{ key: string; action: AgentOperation["action"] }>;

const CREATE_ACTION_ALIASES = ["create_task", "create", "draft_task", "add_task", "new_task", "insert_task", "upsert_task", "append_task"] as const;
const UPDATE_ACTION_ALIASES = ["update_task", "update", "edit_task", "modify_task", "patch_task", "upsert_update", "change_task"] as const;
const DELETE_ACTION_ALIASES = ["delete_task", "delete", "remove_task", "remove", "drop_task", "archive_task"] as const;

const TITLE_KEYS = ["title", "name", "taskTitle", "task_title"] as const;
const START_AT_KEYS = ["startAt", "start_at", "start", "startsAt", "starts_at", "scheduledAt", "scheduled_at", "dateTime", "date_time", "date"] as const;
const END_AT_KEYS = ["endAt", "end_at", "end", "endsAt", "ends_at", "endTime", "end_time"] as const;
const PROJECT_KEYS = ["projectId", "project_id", "project", "projectName", "project_name"] as const;
const TASK_TYPE_KEYS = [
  "taskTypeId",
  "task_type_id",
  "taskType",
  "task_type",
  "taskTypeName",
  "task_type_name",
  "type",
  "typeId",
  "type_id",
  "typeName",
  "type_name",
] as const;
const CONTENT_KEYS = ["content", "description", "notes", "memo", "taskContent", "task_content"] as const;
const MAJOR_KEYS = ["isMajor", "is_major", "major", "important"] as const;
const TASK_ID_KEYS = ["taskId", "task_id", "targetTaskId", "target_task_id", "id"] as const;
const CHANGE_CONTAINER_KEYS = ["changes", "changeSet", "change_set", "fields"] as const;
const DELETE_REASON_KEYS = ["reason", "deleteReason", "delete_reason"] as const;

const SYSTEM_PROMPT = `
You are the schedule planning agent for a Korean task and calendar manager.
Return exactly one valid JSON object. Do not use markdown fences. Do not add text before or after the JSON.
All user-facing text values must be written in Korean.

Required root schema:
{
  "assistantMessage": "short Korean message",
  "needsUserInput": false,
  "userQuestion": "",
  "toolCalls": [],
  "contextSuggestions": [],
  "proposal": {
    "summary": "short Korean summary",
    "operations": []
  }
}

Hard output rules:
1. Always include every root key: assistantMessage, needsUserInput, userQuestion, toolCalls, proposal.
2. proposal must always include summary and operations.
3. If you need to inspect existing tasks, projects, or task types, return toolCalls and set proposal.operations to [].
4. If toolCalls is not empty, do not include final create/update/delete operations in the same response.
5. If you can satisfy the request, set toolCalls to [] and put every proposed change in proposal.operations.
6. Never return a summary-only proposal when the user asked to create, update, or delete schedules. The actual draft must be in proposal.operations.
7. If required information is missing or ambiguous, set needsUserInput to true, put one clear Korean question in userQuestion, set toolCalls to [], and set proposal.operations to [].
8. Use only projectId values from knownChoices.projectList and taskTypeId values from knownChoices.taskTypeList. If the user gives a name, map it to the matching id. If it is unclear, ask a question.
9. Use only these status values: NOT_DONE, ON_HOLD, DONE, CANCELED. If the user asks to cancel an existing schedule, update its status to CANCELED instead of deleting it.
10. Interpret user dates and times in Asia/Seoul using the input now value. For startAt/endAt, prefer local ISO without a timezone, for example 2026-02-11T09:00. The app will normalize it.
11. For repeated schedules, create one create_task operation per occurrence unless the repeat rule is unclear.
12. If the user asks for multiple schedules, return multiple operations in the same operations array.
13. Do not invent taskId values. For update_task or delete_task, use search_tasks or get_task first when the exact taskId is not already known.
14. If the user asks to delete an existing schedule by title, time, date, project, or status, use search_tasks first and narrow candidates with keyword/date/projectId/status.
15. Only return delete_task when one specific existing task is identified.
16. If multiple tasks still match a delete request, ask one short Korean clarification question instead of guessing.
17. Prefer active project and task type ids when the user did not specify them.
18. Use userPayload.userContextMarkdown as reusable personal defaults. Current user input overrides it when more specific.
19. If the request reveals a reusable scheduling preference, return it in contextSuggestions. Keep suggestions general, concise, and useful for future requests.

Operation schemas:
create_task requires:
{
  "action": "create_task",
  "title": "task title",
  "content": "",
  "taskTypeId": "known task type id",
  "projectId": "known project id",
  "status": "NOT_DONE",
  "startAt": "local ISO timestamp",
  "isMajor": false
}
Only include endAt when the end time is known.

update_task requires:
{
  "action": "update_task",
  "taskId": "existing task id",
  "changes": {
    "title": "new title"
  }
}
Put only changed fields in changes.

delete_task requires:
{
  "action": "delete_task",
  "taskId": "existing task id",
  "reason": "optional Korean reason"
}

contextSuggestions item schema:
{
  "category": "time" | "classification" | "preference",
  "label": "short Korean label",
  "trigger": ["keyword"],
  "defaultTime": "HH:mm optional",
  "projectId": "known project id optional",
  "taskTypeId": "known task type id optional",
  "isMajor": true,
  "note": "short Korean note",
  "reason": "why this is reusable"
}

Allowed tools:
- list_projects: {}
- list_task_types: {}
- search_tasks: { "keyword"?: string, "projectId"?: string, "status"?: "NOT_DONE"|"ON_HOLD"|"DONE"|"CANCELED", "date"?: "YYYY-MM-DD", "startDate"?: "YYYY-MM-DD", "endDate"?: "YYYY-MM-DD", "limit"?: number }
- get_task: { "taskId": string }

Tool usage notes:
- The current date/time is already provided as "now" in the user payload. Never call a tool to get it.
- Never repeat a tool call with the same arguments; earlier results stay available in toolResults.
- Keep tool calls minimal — batch what you need in one round when possible.

Example final response:
{
  "assistantMessage": "초안을 준비했습니다. 확인 후 반영해 주세요.",
  "needsUserInput": false,
  "userQuestion": "",
  "toolCalls": [],
  "proposal": {
    "summary": "회의 일정을 1건 추가합니다.",
    "operations": [
      {
        "action": "create_task",
        "title": "팀 회의",
        "content": "",
        "taskTypeId": "type-etc",
        "projectId": "project-general",
        "status": "NOT_DONE",
        "startAt": "2026-02-11T09:00",
        "isMajor": false
      }
    ]
  }
}

Example tool response:
{
  "assistantMessage": "기존 일정을 먼저 확인하겠습니다.",
  "needsUserInput": false,
  "userQuestion": "",
  "toolCalls": [
    { "tool": "search_tasks", "args": { "keyword": "팀 회의", "limit": 10 } }
  ],
  "proposal": {
    "summary": "기존 일정 조회가 필요합니다.",
    "operations": []
  }
}

Example delete lookup response:
{
  "assistantMessage": "삭제할 기존 일정을 먼저 찾겠습니다.",
  "needsUserInput": false,
  "userQuestion": "",
  "toolCalls": [
    {
      "tool": "search_tasks",
      "args": {
        "keyword": "팀 미팅",
        "date": "2026-02-11",
        "limit": 10
      }
    }
  ],
  "proposal": {
    "summary": "삭제 대상을 찾는 중입니다.",
    "operations": []
  }
}

Example delete final response:
{
  "assistantMessage": "삭제 초안을 준비했습니다. 확인 후 반영해 주세요.",
  "needsUserInput": false,
  "userQuestion": "",
  "toolCalls": [],
  "proposal": {
    "summary": "기존 일정 1건 삭제 초안입니다.",
    "operations": [
      {
        "action": "delete_task",
        "taskId": "task-123",
        "reason": "사용자 요청으로 삭제"
      }
    ]
  }
}

Example clarification response:
{
  "assistantMessage": "일정을 만들기 위해 시간이 필요합니다.",
  "needsUserInput": true,
  "userQuestion": "몇 시 일정으로 등록할까요?",
  "toolCalls": [],
  "proposal": {
    "summary": "추가 정보가 필요합니다.",
    "operations": []
  }
}
`.trim();

function isTaskStatus(value: unknown): value is TaskStatus {
  return value === "NOT_DONE" || value === "ON_HOLD" || value === "DONE" || value === "CANCELED";
}

function normalizeTaskStatus(value: unknown): TaskStatus | undefined {
  if (isTaskStatus(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (NOT_DONE_STATUS_ALIASES.includes(normalized as (typeof NOT_DONE_STATUS_ALIASES)[number])) {
    return "NOT_DONE";
  }
  if (ON_HOLD_STATUS_ALIASES.includes(normalized as (typeof ON_HOLD_STATUS_ALIASES)[number])) {
    return "ON_HOLD";
  }
  if (DONE_STATUS_ALIASES.includes(normalized as (typeof DONE_STATUS_ALIASES)[number])) {
    return "DONE";
  }
  if (CANCELED_STATUS_ALIASES.includes(normalized as (typeof CANCELED_STATUS_ALIASES)[number])) {
    return "CANCELED";
  }
  return undefined;
}

function parseToolCalls(value: unknown): AgentToolCall[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const allowedTools: AgentToolName[] = ["list_projects", "list_task_types", "search_tasks", "get_task", "current_datetime"];
  return value
    .map((item) => {
      if (!isRecord(item) || typeof item.tool !== "string") {
        return null;
      }
      if (!allowedTools.includes(item.tool as AgentToolName)) {
        return null;
      }
      return {
        tool: item.tool as AgentToolName,
        args: isRecord(item.args) ? item.args : {},
      } satisfies AgentToolCall;
    })
    .filter((item): item is AgentToolCall => item !== null);
}

function getPreferredItemId(items: Array<{ id: string; isActive: boolean }>, fallbackId?: string): string {
  return items.find((item) => item.isActive)?.id ?? items[0]?.id ?? fallbackId ?? "";
}

function truncateText(value: string, maxLength: number): string {
  const normalizedMax = Number.isFinite(maxLength) ? Math.max(0, Math.floor(maxLength)) : DEFAULT_AI_CONTEXT_MAX_LENGTH;
  if (value.length <= normalizedMax) {
    return value;
  }
  return value.slice(0, normalizedMax);
}

function normalizeContextCategory(value: unknown): UserContextRuleCategory | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "time" || normalized === "시간") {
    return "time";
  }
  if (normalized === "classification" || normalized === "category" || normalized === "분류") {
    return "classification";
  }
  if (normalized === "preference" || normalized === "선호" || normalized === "규칙") {
    return "preference";
  }
  return undefined;
}

function normalizeDefaultTime(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  const match = trimmed.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!match) {
    return undefined;
  }
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function pickFirstBoolean(record: Record<string, unknown>, keys: readonly string[]): boolean {
  for (const key of keys) {
    if (typeof record[key] === "boolean") {
      return record[key] as boolean;
    }
  }
  return false;
}

function pickFirstRecord(record: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> | undefined {
  for (const key of keys) {
    const candidate = record[key];
    if (isRecord(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function normalizeDateTime(value: unknown, fallbackTime: string): string {
  if (typeof value !== "string" && typeof value !== "number") {
    return "";
  }
  const raw = String(value).trim();
  if (!raw) {
    return "";
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const localDate = new Date(`${raw}T${fallbackTime}:00`);
    return Number.isNaN(localDate.getTime()) ? "" : localDate.toISOString();
  }
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}$/.test(raw)) {
    const localDate = new Date(raw.replace(" ", "T"));
    return Number.isNaN(localDate.getTime()) ? "" : localDate.toISOString();
  }
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(raw)) {
    const normalizedDate = raw.replace(/\//g, "-");
    const localDate = new Date(`${normalizedDate}T${fallbackTime}:00`);
    return Number.isNaN(localDate.getTime()) ? "" : localDate.toISOString();
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function getOperationCandidates(value: unknown): unknown[] {
  const normalizedValue = tryParseJsonLikeValue(value);
  if (Array.isArray(normalizedValue)) {
    return normalizedValue;
  }
  if (!isRecord(normalizedValue)) {
    return [];
  }

  for (const key of DIRECT_OPERATION_KEYS) {
    const candidate = normalizedValue[key];
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  const groupedCandidates: unknown[] = [];
  for (const { key, action } of GROUPED_OPERATION_DEFS) {
    const candidate = normalizedValue[key];
    if (!Array.isArray(candidate)) {
      continue;
    }
    groupedCandidates.push(
      ...candidate.map((item) => {
        if (!isRecord(item) || typeof item.action === "string") {
          return item;
        }
        return { ...item, action };
      }),
    );
  }

  return groupedCandidates;
}

function parseCreateOperation(value: unknown, options: ParseOptions = {}): AgentCreateTaskOperation | null {
  const normalizedValue = tryParseJsonLikeValue(value);
  if (!isRecord(normalizedValue)) {
    return null;
  }
  const action = typeof normalizedValue.action === "string" ? normalizedValue.action.trim().toLowerCase() : "";
  if (action && !CREATE_ACTION_ALIASES.includes(action as (typeof CREATE_ACTION_ALIASES)[number])) {
    return null;
  }
  const title = pickFirstString(normalizedValue, TITLE_KEYS);
  const startAt = normalizeDateTime(pickFirstString(normalizedValue, START_AT_KEYS), "09:00");
  const endAtRaw = pickFirstString(normalizedValue, END_AT_KEYS);
  let endAt = normalizeDateTime(endAtRaw, "10:00");
  const durationMinutes =
    typeof normalizedValue.durationMinutes === "number"
      ? Math.max(0, Math.floor(normalizedValue.durationMinutes))
      : typeof normalizedValue.duration_minutes === "number"
        ? Math.max(0, Math.floor(normalizedValue.duration_minutes))
        : 0;
  if (!endAt && startAt && durationMinutes > 0) {
    endAt = new Date(new Date(startAt).getTime() + durationMinutes * 60000).toISOString();
  }
  const projectId = resolveEntityId(
    pickFirstString(normalizedValue, PROJECT_KEYS),
    options.projects ?? [],
    options.fallbackProjectId ?? DEFAULT_PROJECT_ID,
  );
  const taskTypeId = resolveEntityId(
    pickFirstString(normalizedValue, TASK_TYPE_KEYS),
    options.taskTypes ?? [],
    options.fallbackTaskTypeId ?? DEFAULT_TASK_TYPES[0]?.id ?? "",
  );
  if (!title || !startAt || !projectId || !taskTypeId) {
    return null;
  }
  return {
    action: "create_task",
    title,
    content: pickFirstString(normalizedValue, CONTENT_KEYS),
    taskTypeId,
    projectId,
    status: normalizeTaskStatus(normalizedValue.status) ?? "NOT_DONE",
    startAt,
    endAt: endAt || undefined,
    isMajor: pickFirstBoolean(normalizedValue, MAJOR_KEYS),
  };
}

function parseUpdateOperation(value: unknown, options: ParseOptions = {}): AgentUpdateTaskOperation | null {
  const normalizedValue = tryParseJsonLikeValue(value);
  if (!isRecord(normalizedValue)) {
    return null;
  }
  const action = typeof normalizedValue.action === "string" ? normalizedValue.action.trim().toLowerCase() : "";
  if (action && !UPDATE_ACTION_ALIASES.includes(action as (typeof UPDATE_ACTION_ALIASES)[number])) {
    return null;
  }
  const taskId = pickFirstString(normalizedValue, TASK_ID_KEYS);
  if (!taskId) {
    return null;
  }
  const sourceChanges = pickFirstRecord(normalizedValue, CHANGE_CONTAINER_KEYS) ?? normalizedValue;
  const changes: AgentUpdateTaskOperation["changes"] = {};
  const nextTitle = pickFirstString(sourceChanges, TITLE_KEYS);
  if (nextTitle) {
    changes.title = nextTitle;
  }
  const nextContent = pickFirstString(sourceChanges, CONTENT_KEYS);
  if (nextContent) {
    changes.content = nextContent;
  }
  const nextTaskTypeId = resolveEntityId(
    pickFirstString(sourceChanges, TASK_TYPE_KEYS),
    options.taskTypes ?? [],
    undefined,
  );
  if (nextTaskTypeId) {
    changes.taskTypeId = nextTaskTypeId;
  }
  const nextProjectId = resolveEntityId(
    pickFirstString(sourceChanges, PROJECT_KEYS),
    options.projects ?? [],
    undefined,
  );
  if (nextProjectId) {
    changes.projectId = nextProjectId;
  }
  const normalizedStatus = normalizeTaskStatus(sourceChanges.status);
  if (normalizedStatus) {
    changes.status = normalizedStatus;
  }
  const nextStartAt = normalizeDateTime(pickFirstString(sourceChanges, START_AT_KEYS), "09:00");
  if (nextStartAt) {
    changes.startAt = nextStartAt;
  }
  if (sourceChanges.endAt === null || sourceChanges.end_at === null) {
    changes.endAt = null;
  } else {
    const nextEndAt = normalizeDateTime(pickFirstString(sourceChanges, END_AT_KEYS), "10:00");
    if (nextEndAt) {
      changes.endAt = nextEndAt;
    }
  }
  if (pickFirstBoolean(sourceChanges, MAJOR_KEYS)) {
    changes.isMajor = true;
  } else if (
    sourceChanges.isMajor === false ||
    sourceChanges.is_major === false ||
    sourceChanges.major === false ||
    sourceChanges.important === false
  ) {
    changes.isMajor = false;
  }
  if (Object.keys(changes).length === 0) {
    return null;
  }
  return {
    action: "update_task",
    taskId,
    changes,
  };
}

function parseDeleteOperation(value: unknown): AgentDeleteTaskOperation | null {
  const normalizedValue = tryParseJsonLikeValue(value);
  if (!isRecord(normalizedValue)) {
    return null;
  }
  const action = typeof normalizedValue.action === "string" ? normalizedValue.action.trim().toLowerCase() : "";
  if (action && !DELETE_ACTION_ALIASES.includes(action as (typeof DELETE_ACTION_ALIASES)[number])) {
    return null;
  }
  const taskId = pickFirstString(normalizedValue, TASK_ID_KEYS);
  if (!taskId) {
    return null;
  }
  return {
    action: "delete_task",
    taskId,
    reason: pickFirstString(normalizedValue, DELETE_REASON_KEYS) || undefined,
  };
}

function parseOperationCandidate(value: unknown, options: ParseOptions = {}): AgentOperation | null {
  return parseCreateOperation(value, options) ?? parseUpdateOperation(value, options) ?? parseDeleteOperation(value);
}

function parseProposal(value: unknown, options: ParseOptions = {}): AgentProposal | undefined {
  const normalizedValue = tryParseJsonLikeValue(value);
  const operationsRaw = getOperationCandidates(normalizedValue);
  const operations: AgentOperation[] = [];
  for (const item of operationsRaw) {
    const operation = parseOperationCandidate(item, options);
    if (operation) {
      operations.push(operation);
    }
  }
  if (operations.length === 0 && isRecord(normalizedValue)) {
    const singleOperation = parseOperationCandidate(normalizedValue, options);
    if (singleOperation) {
      operations.push(singleOperation);
    }
  }
  if (operations.length === 0) {
    return undefined;
  }
  return {
    summary:
      isRecord(normalizedValue) && typeof normalizedValue.summary === "string" && normalizedValue.summary.trim()
        ? normalizedValue.summary
        : typeof options.fallbackSummary === "string" && options.fallbackSummary.trim()
          ? options.fallbackSummary
          : "\uBCC0\uACBD \uC81C\uC548",
    operations,
  };
}

function buildSummaryOnlyProposal(value: unknown, fallbackSummary?: string): AgentProposal | undefined {
  const normalizedValue = tryParseJsonLikeValue(value);
  if (!isRecord(normalizedValue)) {
    return undefined;
  }
  const summary =
    typeof normalizedValue.summary === "string" && normalizedValue.summary.trim()
      ? normalizedValue.summary
      : typeof fallbackSummary === "string" && fallbackSummary.trim()
        ? fallbackSummary
        : "";
  if (!summary) {
    return undefined;
  }
  return {
    summary,
    operations: [],
  };
}

function parseContextSuggestion(value: unknown, options: ParseOptions = {}): AgentContextSuggestion | null {
  const normalizedValue = tryParseJsonLikeValue(value);
  if (!isRecord(normalizedValue)) {
    return null;
  }
  const trigger = pickFirstStringArray(normalizedValue, ["trigger", "triggers", "keywords", "keyword"]);
  const defaultTime = normalizeDefaultTime(normalizedValue.defaultTime ?? normalizedValue.default_time ?? normalizedValue.time);
  const projectId = resolveEntityId(
    pickFirstString(normalizedValue, PROJECT_KEYS),
    options.projects ?? [],
    undefined,
  );
  const taskTypeId = resolveEntityId(
    pickFirstString(normalizedValue, TASK_TYPE_KEYS),
    options.taskTypes ?? [],
    undefined,
  );
  const isMajor = typeof normalizedValue.isMajor === "boolean"
    ? normalizedValue.isMajor
    : typeof normalizedValue.is_major === "boolean"
      ? normalizedValue.is_major
      : typeof normalizedValue.important === "boolean"
        ? normalizedValue.important
        : undefined;
  const note = pickFirstString(normalizedValue, ["note", "description", "memo"]);
  const reason = pickFirstString(normalizedValue, ["reason", "why"]);
  const category =
    normalizeContextCategory(normalizedValue.category) ??
    (defaultTime ? "time" : projectId || taskTypeId ? "classification" : "preference");

  if (trigger.length === 0 || (!defaultTime && !projectId && !taskTypeId && isMajor === undefined && !note)) {
    return null;
  }

  return {
    category,
    label: pickFirstString(normalizedValue, ["label", "title", "name"]) || undefined,
    trigger,
    projectId: projectId || undefined,
    taskTypeId: taskTypeId || undefined,
    defaultTime,
    isMajor,
    note: note || undefined,
    reason: reason || undefined,
  };
}

function parseContextSuggestions(value: unknown, options: ParseOptions = {}): AgentContextSuggestion[] {
  const normalizedValue = tryParseJsonLikeValue(value);
  const source = Array.isArray(normalizedValue) ? normalizedValue : isRecord(normalizedValue) ? [normalizedValue] : [];
  const seen = new Set<string>();
  const suggestions: AgentContextSuggestion[] = [];
  for (const item of source) {
    const suggestion = parseContextSuggestion(item, options);
    if (!suggestion) {
      continue;
    }
    const key = JSON.stringify({
      trigger: suggestion.trigger.map((entry) => entry.toLowerCase()).sort(),
      defaultTime: suggestion.defaultTime ?? "",
      projectId: suggestion.projectId ?? "",
      taskTypeId: suggestion.taskTypeId ?? "",
      isMajor: suggestion.isMajor ?? "",
    });
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    suggestions.push(suggestion);
  }
  return suggestions.slice(0, 5);
}

function executeToolCall(call: AgentToolCall, tasks: Task[], projects: Project[], taskTypes: TaskType[]): ToolExecutionResult {
  const ctx = { tasks, projects, taskTypes };

  if (call.tool === "list_projects") {
    return {
      tool: call.tool,
      args: call.args,
      ok: true,
      result: projects.map((project) => ({
        id: project.id,
        name: project.name,
        description: project.description ?? "",
        isActive: project.isActive,
      })),
    };
  }

  if (call.tool === "list_task_types") {
    return {
      tool: call.tool,
      args: call.args,
      ok: true,
      result: taskTypes.map((taskType) => ({
        id: taskType.id,
        name: taskType.name,
        isActive: taskType.isActive,
      })),
    };
  }

  if (call.tool === "current_datetime") {
    return execCurrentDatetime(call.tool, call.args);
  }

  if (call.tool === "get_task") {
    return execGetTask(call.tool, call.args, ctx);
  }

  return execSearchTasks(call.tool, call.args, ctx);
}

function buildPromptMessages(input: RunScheduleAgentInput, toolResults: ToolExecutionResult[]): LlmChatMessage[] {
  const userContextMaxLength = input.userContextMaxLength ?? DEFAULT_AI_CONTEXT_MAX_LENGTH;
  const userContextMarkdown = truncateText(input.userContext?.markdown ?? "", userContextMaxLength);
  const userPayload = {
    now: toIsoNow(),
    conversation: input.conversation.slice(-8),
    userRequest: input.userMessage,
    userContextMarkdown,
    userContextRules: (input.userContext?.rules ?? [])
      .filter((rule) => rule.isActive)
      .slice(0, 20)
      .map((rule) => ({
        category: rule.category,
        label: rule.label,
        trigger: rule.trigger,
        projectId: rule.projectId ?? "",
        taskTypeId: rule.taskTypeId ?? "",
        defaultTime: rule.defaultTime ?? "",
        isMajor: rule.isMajor ?? false,
        note: rule.note ?? "",
      })),
    knownChoices: {
      status: ["NOT_DONE", "ON_HOLD", "DONE", "CANCELED"],
      projectList: input.projects.map((project) => ({
        id: project.id,
        name: project.name,
        description: project.description ?? "",
        isActive: project.isActive,
      })),
      taskTypeList: input.taskTypes.map((taskType) => ({
        id: taskType.id,
        name: taskType.name,
        isActive: taskType.isActive,
      })),
    },
    toolResults,
  };
  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: JSON.stringify(userPayload, null, 2),
    },
  ];
}

export async function runScheduleAgent(input: RunScheduleAgentInput): Promise<RunScheduleAgentResult> {
  const accumulatedToolResults: ToolExecutionResult[] = [];
  const toolCounts = new Map<string, number>();
  const callCache = new ToolCallCache();

  const fallbackResult = (message: string): RunScheduleAgentResult => ({
    assistantMessage: message,
    needsUserInput: false,
    question: undefined,
    proposal: undefined,
    contextSuggestions: [],
    trace: toolCounts.size > 0 ? summarizeScheduleTools(toolCounts) : undefined,
  });

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const messages = buildPromptMessages(input, capToolResults(accumulatedToolResults));
    let streamedChars = 0;
    const writingLabel = toolCounts.size > 0 ? "조회 결과로 초안 작성 중" : "요청 분석 중";
    const { payload: parsed } = await requestJsonWithRetry({
      messages,
      endpoint: input.endpoint,
      apiKey: input.apiKey,
      model: input.model,
      signal: input.signal,
      onToken: input.onProgress
        ? (delta) => {
            streamedChars += delta.length;
            input.onProgress?.({ phase: "writing", label: writingLabel, chars: streamedChars });
          }
        : undefined,
    });
    if (!parsed) {
      // 재시도 후에도 JSON 파싱 실패 — 크래시 대신 안내 메시지 반환
      return fallbackResult("AI 응답을 해석하지 못했습니다. 요청을 조금 바꿔 다시 시도해 주세요.");
    }
    const payload = parsed as AgentModelPayload;
    const toolCalls = parseToolCalls(payload.toolCalls).slice(0, 4);
    if (toolCalls.length > 0) {
      // 이미 실행한 동일 호출은 건너뛴다 (라운드 낭비·프롬프트 중복 방지)
      const freshCalls = toolCalls.filter((call) => !callCache.has(call.tool, call.args));
      if (freshCalls.length === 0) {
        accumulatedToolResults.push(duplicateCallNotice());
        continue;
      }
      for (const call of freshCalls) {
        callCache.add(call.tool, call.args);
        accumulatedToolResults.push(executeToolCall(call, input.tasks, input.projects, input.taskTypes));
        const label = SCHEDULE_TOOL_LABELS[call.tool];
        toolCounts.set(label, (toolCounts.get(label) ?? 0) + 1);
      }
      input.onProgress?.({ phase: "tools", label: summarizeScheduleTools(toolCounts) });
      continue;
    }
    const proposalOptions: ParseOptions = {
      projects: input.projects,
      taskTypes: input.taskTypes,
      fallbackProjectId: getPreferredItemId(input.projects, DEFAULT_PROJECT_ID),
      fallbackTaskTypeId: getPreferredItemId(input.taskTypes, DEFAULT_TASK_TYPES[0]?.id ?? ""),
      fallbackSummary:
        typeof payload.summary === "string"
          ? payload.summary
          : typeof payload.assistantMessage === "string"
            ? payload.assistantMessage
            : undefined,
    };
    const proposal =
      parseProposal(payload.proposal, proposalOptions) ??
      buildSummaryOnlyProposal(payload.proposal, proposalOptions.fallbackSummary) ??
      parseProposal(payload, proposalOptions);
    const proposalContextSuggestions =
      isRecord(payload.proposal) ? parseContextSuggestions(payload.proposal.contextSuggestions, proposalOptions) : [];
    const contextSuggestions = [
      ...parseContextSuggestions(payload.contextSuggestions, proposalOptions),
      ...proposalContextSuggestions,
    ].slice(0, 5);
    const assistantMessage =
      typeof payload.assistantMessage === "string" && payload.assistantMessage.trim()
        ? payload.assistantMessage
        : proposal
          ? "요청 내용을 바탕으로 변경안을 준비했습니다. 내용을 확인해 주세요."
          : "요청 내용을 해석했습니다.";
    const question = typeof payload.userQuestion === "string" ? payload.userQuestion : undefined;
    return {
      assistantMessage,
      needsUserInput: Boolean(payload.needsUserInput),
      question,
      proposal,
      contextSuggestions,
      trace: toolCounts.size > 0 ? summarizeScheduleTools(toolCounts) : undefined,
    };
  }
  // 루프 초과 — 예외 대신 안내 메시지로 마무리 (#graceful)
  return fallbackResult("일정 정보를 조회했지만 제안을 완성하지 못했습니다. 요청을 조금 더 구체적으로 다시 입력해 주세요.");
}
