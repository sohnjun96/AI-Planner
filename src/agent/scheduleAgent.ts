import { DEFAULT_PROJECT_ID, DEFAULT_TASK_TYPES } from "../constants";
import type { Project, Task, TaskStatus, TaskType } from "../models";
import { toIsoNow } from "../utils/date";
import { requestLlmResponse, type LlmChatMessage } from "./llmClient";

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

interface ToolExecutionResult {
  tool: AgentToolName;
  args: Record<string, unknown>;
  ok: boolean;
  result: unknown;
}

export interface RunScheduleAgentInput {
  userMessage: string;
  conversation: AgentConversationMessage[];
  tasks: Task[];
  projects: Project[];
  taskTypes: TaskType[];
  apiKey: string;
  model?: string;
}

export interface RunScheduleAgentResult {
  assistantMessage: string;
  needsUserInput: boolean;
  question?: string;
  proposal?: AgentProposal;
}

interface ParseOptions {
  projects?: Project[];
  taskTypes?: TaskType[];
  fallbackProjectId?: string;
  fallbackTaskTypeId?: string;
  fallbackSummary?: string;
}

const MAX_TOOL_ROUNDS = 4;

const SYSTEM_PROMPT = `
너는 "업무 일정관리 전용 에이전트"다.
반드시 JSON 객체만 출력하고, JSON 외 텍스트는 절대 출력하지 마라.

규칙:
1) 출력 스키마
{
  "assistantMessage": "string",
  "needsUserInput": true|false,
  "userQuestion": "string, optional",
  "toolCalls": [{"tool":"...","args":{...}}],
  "proposal": {
    "summary": "string",
    "operations": [
      {"action":"create_task", ...},
      {"action":"update_task", ...},
      {"action":"delete_task", ...}
    ]
  }
}

2) toolCalls와 proposal을 같은 응답에서 동시에 내지 마라.
3) 수정/삭제가 필요하면 먼저 toolCalls로 조회하고 tool_results 확인 후 proposal을 만들어라.
4) 정보가 모호하면 needsUserInput=true와 userQuestion으로 질문해라.
5) proposal은 최종 반영 전 초안이다. 실제 반영은 사용자가 결정한다.
6) status는 반드시 NOT_DONE / ON_HOLD / DONE 중 하나만 사용한다.
7) 시간은 ISO-8601 문자열로 사용한다. 예: 2026-02-11T09:00:00.000Z

사용 가능한 tool:
- list_projects: {}
- list_task_types: {}
- search_tasks: { "keyword"?: string, "projectId"?: string, "status"?: "NOT_DONE"|"ON_HOLD"|"DONE", "limit"?: number }
- get_task: { "taskId": string }
- current_datetime: {}
`.trim();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isTaskStatus(value: unknown): value is TaskStatus {
  return value === "NOT_DONE" || value === "ON_HOLD" || value === "DONE";
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
  if (["not_done", "notdone", "todo", "pending", "in_progress", "미완료", "대기"].includes(normalized)) {
    return "NOT_DONE";
  }
  if (["on_hold", "hold", "paused", "보류", "홀드"].includes(normalized)) {
    return "ON_HOLD";
  }
  if (["done", "complete", "completed", "완료", "끝남"].includes(normalized)) {
    return "DONE";
  }
  return undefined;
}

function tryParseJsonLikeValue(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return value;
    }
  }
  return value;
}

function extractJsonText(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1).trim();
  }
  return trimmed;
}

function parseModelPayload(raw: string): AgentModelPayload {
  const jsonText = extractJsonText(raw);
  const parsed = JSON.parse(jsonText) as unknown;
  if (!isRecord(parsed)) {
    throw new Error("LLM 응답이 JSON 객체가 아닙니다.");
  }
  return parsed as AgentModelPayload;
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

function normalizeLookupValue(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function pickFirstString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return "";
}

function pickFirstBoolean(record: Record<string, unknown>, keys: string[]): boolean {
  for (const key of keys) {
    if (typeof record[key] === "boolean") {
      return record[key] as boolean;
    }
  }
  return false;
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

function resolveEntityId(rawValue: unknown, items: Array<{ id: string; name: string }>, fallbackId?: string): string {
  const trimmed = typeof rawValue === "string" ? rawValue.trim() : "";
  if (!trimmed) {
    return fallbackId ?? "";
  }
  const exactMatch = items.find((item) => item.id === trimmed);
  if (exactMatch) {
    return exactMatch.id;
  }
  const normalized = normalizeLookupValue(trimmed);
  const nameMatch = items.find((item) => normalizeLookupValue(item.name) === normalized);
  if (nameMatch) {
    return nameMatch.id;
  }
  return fallbackId ?? "";
}

function getOperationCandidates(value: unknown): unknown[] {
  const normalizedValue = tryParseJsonLikeValue(value);
  if (Array.isArray(normalizedValue)) {
    return normalizedValue;
  }
  if (!isRecord(normalizedValue)) {
    return [];
  }

  const directCandidates = [
    normalizedValue.operations,
    normalizedValue.tasks,
    normalizedValue.draftTasks,
    normalizedValue.draft_tasks,
    normalizedValue.items,
    normalizedValue.drafts,
    normalizedValue.actions,
    normalizedValue.operationDrafts,
    normalizedValue.operation_drafts,
  ];
  for (const candidate of directCandidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  const groupedCandidates: unknown[] = [];
  const groupedDefs: Array<[unknown, AgentOperation["action"]]> = [
    [normalizedValue.createTasks, "create_task"],
    [normalizedValue.create_tasks, "create_task"],
    [normalizedValue.creates, "create_task"],
    [normalizedValue.additions, "create_task"],
    [normalizedValue.updateTasks, "update_task"],
    [normalizedValue.update_tasks, "update_task"],
    [normalizedValue.updates, "update_task"],
    [normalizedValue.deleteTasks, "delete_task"],
    [normalizedValue.delete_tasks, "delete_task"],
    [normalizedValue.deletes, "delete_task"],
    [normalizedValue.removals, "delete_task"],
  ];

  for (const [candidate, action] of groupedDefs) {
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
  if (
    action &&
    ![
      "create_task",
      "create",
      "draft_task",
      "add_task",
      "new_task",
      "insert_task",
      "upsert_task",
      "append_task",
    ].includes(action)
  ) {
    return null;
  }
  const title = pickFirstString(normalizedValue, ["title", "name", "taskTitle", "task_title"]);
  const startAt = normalizeDateTime(
    pickFirstString(normalizedValue, [
      "startAt",
      "start_at",
      "start",
      "startsAt",
      "starts_at",
      "scheduledAt",
      "scheduled_at",
      "dateTime",
      "date_time",
      "date",
    ]),
    "09:00",
  );
  const endAtRaw = pickFirstString(normalizedValue, ["endAt", "end_at", "end", "endsAt", "ends_at", "endTime", "end_time"]);
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
    pickFirstString(normalizedValue, ["projectId", "project_id", "project", "projectName", "project_name"]),
    options.projects ?? [],
    options.fallbackProjectId ?? DEFAULT_PROJECT_ID,
  );
  const taskTypeId = resolveEntityId(
    pickFirstString(normalizedValue, [
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
    ]),
    options.taskTypes ?? [],
    options.fallbackTaskTypeId ?? DEFAULT_TASK_TYPES[0]?.id ?? "",
  );
  if (!title || !startAt || !projectId || !taskTypeId) {
    return null;
  }
  return {
    action: "create_task",
    title,
    content: pickFirstString(normalizedValue, ["content", "description", "notes", "memo", "taskContent", "task_content"]),
    taskTypeId,
    projectId,
    status: normalizeTaskStatus(normalizedValue.status) ?? "NOT_DONE",
    startAt,
    endAt: endAt || undefined,
    isMajor: pickFirstBoolean(normalizedValue, ["isMajor", "is_major", "major", "important"]),
  };
}

function parseUpdateOperation(value: unknown, options: ParseOptions = {}): AgentUpdateTaskOperation | null {
  const normalizedValue = tryParseJsonLikeValue(value);
  if (!isRecord(normalizedValue)) {
    return null;
  }
  const action = typeof normalizedValue.action === "string" ? normalizedValue.action.trim().toLowerCase() : "";
  if (
    action &&
    !["update_task", "update", "edit_task", "modify_task", "patch_task", "upsert_update", "change_task"].includes(action)
  ) {
    return null;
  }
  const taskId = pickFirstString(normalizedValue, ["taskId", "task_id", "targetTaskId", "target_task_id", "id"]);
  if (!taskId) {
    return null;
  }
  const sourceChanges =
    (isRecord(normalizedValue.changes) && normalizedValue.changes) ||
    (isRecord(normalizedValue.changeSet) && normalizedValue.changeSet) ||
    (isRecord(normalizedValue.change_set) && normalizedValue.change_set) ||
    (isRecord(normalizedValue.fields) && normalizedValue.fields) ||
    normalizedValue;
  const changes: AgentUpdateTaskOperation["changes"] = {};
  const nextTitle = pickFirstString(sourceChanges, ["title", "taskTitle", "task_title", "name"]);
  if (nextTitle) {
    changes.title = nextTitle;
  }
  const nextContent = pickFirstString(sourceChanges, ["content", "taskContent", "task_content", "description", "notes", "memo"]);
  if (nextContent) {
    changes.content = nextContent;
  }
  const nextTaskTypeId = resolveEntityId(
    pickFirstString(sourceChanges, [
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
    ]),
    options.taskTypes ?? [],
    undefined,
  );
  if (nextTaskTypeId) {
    changes.taskTypeId = nextTaskTypeId;
  }
  const nextProjectId = resolveEntityId(
    pickFirstString(sourceChanges, ["projectId", "project_id", "project", "projectName", "project_name"]),
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
  const nextStartAt = normalizeDateTime(
    pickFirstString(sourceChanges, [
      "startAt",
      "start_at",
      "start",
      "startsAt",
      "starts_at",
      "scheduledAt",
      "scheduled_at",
      "dateTime",
      "date_time",
      "date",
    ]),
    "09:00",
  );
  if (nextStartAt) {
    changes.startAt = nextStartAt;
  }
  if (sourceChanges.endAt === null || sourceChanges.end_at === null) {
    changes.endAt = null;
  } else {
    const nextEndAt = normalizeDateTime(
      pickFirstString(sourceChanges, ["endAt", "end_at", "end", "endsAt", "ends_at", "endTime", "end_time"]),
      "10:00",
    );
    if (nextEndAt) {
      changes.endAt = nextEndAt;
    }
  }
  if (pickFirstBoolean(sourceChanges, ["isMajor", "is_major", "major", "important"])) {
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
  if (
    action &&
    !["delete_task", "delete", "remove_task", "remove", "drop_task", "archive_task"].includes(action)
  ) {
    return null;
  }
  const taskId = pickFirstString(normalizedValue, ["taskId", "task_id", "targetTaskId", "target_task_id", "id"]);
  if (!taskId) {
    return null;
  }
  return {
    action: "delete_task",
    taskId,
    reason: pickFirstString(normalizedValue, ["reason", "deleteReason", "delete_reason"]) || undefined,
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

function executeToolCall(call: AgentToolCall, tasks: Task[], projects: Project[], taskTypes: TaskType[]): ToolExecutionResult {
  if (call.tool === "list_projects") {
    return {
      tool: call.tool,
      args: call.args,
      ok: true,
      result: projects.map((project) => ({
        id: project.id,
        name: project.name,
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
    return {
      tool: call.tool,
      args: call.args,
      ok: true,
      result: {
        now: toIsoNow(),
      },
    };
  }

  if (call.tool === "get_task") {
    const taskId = typeof call.args.taskId === "string" ? call.args.taskId : "";
    const task = tasks.find((item) => item.id === taskId);
    return {
      tool: call.tool,
      args: call.args,
      ok: Boolean(task),
      result: task
        ? {
            id: task.id,
            title: task.title,
            content: task.content,
            status: task.status,
            startAt: task.startAt,
            endAt: task.endAt,
            taskTypeId: task.taskTypeId,
            projectId: task.projectId,
            isMajor: task.isMajor,
            updatedAt: task.updatedAt,
          }
        : { message: "일정을 찾지 못했습니다." },
    };
  }

  const keyword = typeof call.args.keyword === "string" ? call.args.keyword.trim().toLowerCase() : "";
  const projectId = typeof call.args.projectId === "string" ? call.args.projectId : "";
  const status = isTaskStatus(call.args.status) ? call.args.status : undefined;
  const limitRaw = typeof call.args.limit === "number" ? call.args.limit : 20;
  const limit = Math.max(1, Math.min(50, Math.floor(limitRaw)));
  const projectMap = Object.fromEntries(projects.map((project) => [project.id, project]));
  const taskTypeMap = Object.fromEntries(taskTypes.map((taskType) => [taskType.id, taskType]));
  const filtered = tasks
    .filter((task) => {
      if (projectId && task.projectId !== projectId) {
        return false;
      }
      if (status && task.status !== status) {
        return false;
      }
      if (!keyword) {
        return true;
      }
      const projectName = projectMap[task.projectId]?.name ?? "";
      const taskTypeName = taskTypeMap[task.taskTypeId]?.name ?? "";
      const haystack = `${task.title} ${task.content} ${projectName} ${taskTypeName}`.toLowerCase();
      return haystack.includes(keyword);
    })
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, limit)
    .map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      startAt: task.startAt,
      endAt: task.endAt,
      projectId: task.projectId,
      projectName: projectMap[task.projectId]?.name ?? "",
      taskTypeId: task.taskTypeId,
      taskTypeName: taskTypeMap[task.taskTypeId]?.name ?? "",
      isMajor: task.isMajor,
      updatedAt: task.updatedAt,
    }));
  return {
    tool: "search_tasks",
    args: call.args,
    ok: true,
    result: filtered,
  };
}

function buildPromptMessages(input: RunScheduleAgentInput, toolResults: ToolExecutionResult[]): LlmChatMessage[] {
  const userPayload = {
    now: toIsoNow(),
    conversation: input.conversation.slice(-8),
    userRequest: input.userMessage,
    knownChoices: {
      status: ["NOT_DONE", "ON_HOLD", "DONE"],
      projectList: input.projects.map((project) => ({
        id: project.id,
        name: project.name,
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
  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const messages = buildPromptMessages(input, accumulatedToolResults);
    const raw = await requestLlmResponse({
      messages,
      apiKey: input.apiKey,
      model: input.model,
    });
    const payload = parseModelPayload(raw);
    const toolCalls = parseToolCalls(payload.toolCalls).slice(0, 4);
    if (toolCalls.length > 0) {
      const roundResults = toolCalls.map((call) => executeToolCall(call, input.tasks, input.projects, input.taskTypes));
      accumulatedToolResults.push(...roundResults);
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
    };
  }
  throw new Error("LLM이 도구 호출만 반복하여 최종 제안을 만들지 못했습니다.");
}
