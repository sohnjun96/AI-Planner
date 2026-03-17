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
  if (Array.isArray(value)) {
    return value;
  }
  if (!isRecord(value)) {
    return [];
  }
  const candidates = [value.operations, value.tasks, value.draftTasks, value.items, value.drafts];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }
  return [];
}

function parseCreateOperation(value: unknown, options: ParseOptions = {}): AgentCreateTaskOperation | null {
  if (!isRecord(value)) {
    return null;
  }
  const action = typeof value.action === "string" ? value.action : "";
  if (action && action !== "create_task" && action !== "create" && action !== "draft_task") {
    return null;
  }
  const title = pickFirstString(value, ["title", "name", "taskTitle"]);
  const startAt = normalizeDateTime(pickFirstString(value, ["startAt", "start", "startsAt", "scheduledAt", "dateTime", "date"]), "09:00");
  const endAtRaw = pickFirstString(value, ["endAt", "end", "endsAt", "endTime"]);
  let endAt = normalizeDateTime(endAtRaw, "10:00");
  const durationMinutes = typeof value.durationMinutes === "number" ? Math.max(0, Math.floor(value.durationMinutes)) : 0;
  if (!endAt && startAt && durationMinutes > 0) {
    endAt = new Date(new Date(startAt).getTime() + durationMinutes * 60000).toISOString();
  }
  const projectId = resolveEntityId(
    pickFirstString(value, ["projectId", "project", "projectName"]),
    options.projects ?? [],
    options.fallbackProjectId ?? DEFAULT_PROJECT_ID,
  );
  const taskTypeId = resolveEntityId(
    pickFirstString(value, ["taskTypeId", "taskType", "taskTypeName", "type", "typeName"]),
    options.taskTypes ?? [],
    options.fallbackTaskTypeId ?? DEFAULT_TASK_TYPES[0]?.id ?? "",
  );
  if (!title || !startAt || !projectId || !taskTypeId) {
    return null;
  }
  return {
    action: "create_task",
    title,
    content: pickFirstString(value, ["content", "description", "notes", "memo"]),
    taskTypeId,
    projectId,
    status: isTaskStatus(value.status) ? value.status : "NOT_DONE",
    startAt,
    endAt: endAt || undefined,
    isMajor: pickFirstBoolean(value, ["isMajor", "major", "important"]),
  };
}

function parseUpdateOperation(value: unknown, options: ParseOptions = {}): AgentUpdateTaskOperation | null {
  if (!isRecord(value)) {
    return null;
  }
  const action = typeof value.action === "string" ? value.action : "";
  if (action && action !== "update_task" && action !== "update") {
    return null;
  }
  const taskId = typeof value.taskId === "string" ? value.taskId : typeof value.id === "string" ? value.id : "";
  if (!taskId) {
    return null;
  }
  const sourceChanges = isRecord(value.changes) ? value.changes : value;
  const changes: AgentUpdateTaskOperation["changes"] = {};
  if (typeof sourceChanges.title === "string") {
    changes.title = sourceChanges.title;
  }
  if (typeof sourceChanges.content === "string") {
    changes.content = sourceChanges.content;
  }
  const nextTaskTypeId = resolveEntityId(
    pickFirstString(sourceChanges, ["taskTypeId", "taskType", "taskTypeName", "type", "typeName"]),
    options.taskTypes ?? [],
    undefined,
  );
  if (nextTaskTypeId) {
    changes.taskTypeId = nextTaskTypeId;
  }
  const nextProjectId = resolveEntityId(
    pickFirstString(sourceChanges, ["projectId", "project", "projectName"]),
    options.projects ?? [],
    undefined,
  );
  if (nextProjectId) {
    changes.projectId = nextProjectId;
  }
  if (isTaskStatus(sourceChanges.status)) {
    changes.status = sourceChanges.status;
  }
  const nextStartAt = normalizeDateTime(
    pickFirstString(sourceChanges, ["startAt", "start", "startsAt", "scheduledAt", "dateTime", "date"]),
    "09:00",
  );
  if (nextStartAt) {
    changes.startAt = nextStartAt;
  }
  if (sourceChanges.endAt === null) {
    changes.endAt = null;
  } else {
    const nextEndAt = normalizeDateTime(pickFirstString(sourceChanges, ["endAt", "end", "endsAt", "endTime"]), "10:00");
    if (nextEndAt) {
      changes.endAt = nextEndAt;
    }
  }
  if (pickFirstBoolean(sourceChanges, ["isMajor", "major", "important"])) {
    changes.isMajor = true;
  } else if (sourceChanges.isMajor === false || sourceChanges.major === false || sourceChanges.important === false) {
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
  if (!isRecord(value)) {
    return null;
  }
  const action = typeof value.action === "string" ? value.action : "";
  if (action && action !== "delete_task" && action !== "delete" && action !== "remove_task") {
    return null;
  }
  const taskId = typeof value.taskId === "string" ? value.taskId : typeof value.id === "string" ? value.id : "";
  if (!taskId) {
    return null;
  }
  return {
    action: "delete_task",
    taskId,
    reason: typeof value.reason === "string" ? value.reason : undefined,
  };
}

function parseOperationCandidate(value: unknown, options: ParseOptions = {}): AgentOperation | null {
  return parseCreateOperation(value, options) ?? parseUpdateOperation(value, options) ?? parseDeleteOperation(value);
}

function parseProposal(value: unknown, options: ParseOptions = {}): AgentProposal | undefined {
  const operationsRaw = getOperationCandidates(value);
  const operations: AgentOperation[] = [];
  for (const item of operationsRaw) {
    const operation = parseOperationCandidate(item, options);
    if (operation) {
      operations.push(operation);
    }
  }
  if (operations.length === 0 && isRecord(value)) {
    const singleOperation = parseOperationCandidate(value, options);
    if (singleOperation) {
      operations.push(singleOperation);
    }
  }
  if (operations.length === 0) {
    return undefined;
  }
  return {
    summary:
      isRecord(value) && typeof value.summary === "string" && value.summary.trim()
        ? value.summary
        : typeof options.fallbackSummary === "string" && options.fallbackSummary.trim()
          ? options.fallbackSummary
          : "변경 제안",
    operations,
  };
}

function buildSummaryOnlyProposal(value: unknown, fallbackSummary?: string): AgentProposal | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const summary =
    typeof value.summary === "string" && value.summary.trim()
      ? value.summary
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
