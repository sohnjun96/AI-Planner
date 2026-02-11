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

const MAX_TOOL_ROUNDS = 4;

const SYSTEM_PROMPT = `
너는 "업무 일정관리" 앱용 에이전트다.
반드시 JSON 객체만 출력하고, JSON 외 텍스트를 절대 출력하지 마라.

규칙:
1) 출력 스키마:
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

2) toolCalls와 proposal은 같은 응답에서 동시에 넣지 마라.
3) 수정/삭제를 하려면 먼저 toolCalls로 후보 일정을 조회하고, tool_results를 확인한 후 proposal을 만들어라.
4) 정보가 모호하면 needsUserInput=true와 userQuestion으로 질문해라.
5) proposal은 최종 확인 전 초안이다. 실제 반영은 사용자가 결정한다.
6) status는 반드시 NOT_DONE / ON_HOLD / DONE 중 하나만 사용한다.
7) 시간은 ISO-8601 문자열(예: 2026-02-11T09:00:00.000Z)을 사용한다.

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

function parseCreateOperation(value: unknown): AgentCreateTaskOperation | null {
  if (!isRecord(value) || value.action !== "create_task") {
    return null;
  }

  if (
    typeof value.title !== "string" ||
    typeof value.taskTypeId !== "string" ||
    typeof value.projectId !== "string" ||
    typeof value.startAt !== "string"
  ) {
    return null;
  }

  return {
    action: "create_task",
    title: value.title,
    content: typeof value.content === "string" ? value.content : "",
    taskTypeId: value.taskTypeId,
    projectId: value.projectId,
    status: isTaskStatus(value.status) ? value.status : "NOT_DONE",
    startAt: value.startAt,
    endAt: typeof value.endAt === "string" ? value.endAt : undefined,
    isMajor: typeof value.isMajor === "boolean" ? value.isMajor : false,
  };
}

function parseUpdateOperation(value: unknown): AgentUpdateTaskOperation | null {
  if (!isRecord(value) || value.action !== "update_task" || typeof value.taskId !== "string") {
    return null;
  }

  const sourceChanges = isRecord(value.changes) ? value.changes : {};
  const changes: AgentUpdateTaskOperation["changes"] = {};

  if (typeof sourceChanges.title === "string") {
    changes.title = sourceChanges.title;
  }
  if (typeof sourceChanges.content === "string") {
    changes.content = sourceChanges.content;
  }
  if (typeof sourceChanges.taskTypeId === "string") {
    changes.taskTypeId = sourceChanges.taskTypeId;
  }
  if (typeof sourceChanges.projectId === "string") {
    changes.projectId = sourceChanges.projectId;
  }
  if (isTaskStatus(sourceChanges.status)) {
    changes.status = sourceChanges.status;
  }
  if (typeof sourceChanges.startAt === "string") {
    changes.startAt = sourceChanges.startAt;
  }
  if (typeof sourceChanges.endAt === "string" || sourceChanges.endAt === null) {
    changes.endAt = sourceChanges.endAt;
  }
  if (typeof sourceChanges.isMajor === "boolean") {
    changes.isMajor = sourceChanges.isMajor;
  }

  if (Object.keys(changes).length === 0) {
    return null;
  }

  return {
    action: "update_task",
    taskId: value.taskId,
    changes,
  };
}

function parseDeleteOperation(value: unknown): AgentDeleteTaskOperation | null {
  if (!isRecord(value) || value.action !== "delete_task" || typeof value.taskId !== "string") {
    return null;
  }

  return {
    action: "delete_task",
    taskId: value.taskId,
    reason: typeof value.reason === "string" ? value.reason : undefined,
  };
}

function parseProposal(value: unknown): AgentProposal | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const operationsRaw = Array.isArray(value.operations) ? value.operations : [];
  const operations: AgentOperation[] = [];

  for (const item of operationsRaw) {
    const createOp = parseCreateOperation(item);
    if (createOp) {
      operations.push(createOp);
      continue;
    }

    const updateOp = parseUpdateOperation(item);
    if (updateOp) {
      operations.push(updateOp);
      continue;
    }

    const deleteOp = parseDeleteOperation(item);
    if (deleteOp) {
      operations.push(deleteOp);
    }
  }

  if (operations.length === 0) {
    return undefined;
  }

  return {
    summary: typeof value.summary === "string" ? value.summary : "변경 제안",
    operations,
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

    const proposal = parseProposal(payload.proposal);
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
