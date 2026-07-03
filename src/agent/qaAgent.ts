import { STATUS_LABELS } from "../constants";
import type { Note, Project, Task, TaskType } from "../models";
import { toIsoNow } from "../utils/date";
import {
  extractJsonText,
  isRecord,
  parseJsonObject,
  pickFirstString,
  requestLlmResponse,
  type LlmChatMessage,
} from "./agentUtils";

type QaToolName = "search_notes" | "get_note" | "search_tasks" | "get_task" | "current_datetime";

export interface QaReference {
  type: "note" | "task";
  id: string;
  title: string;
}

export interface QaProgress {
  phase: "tools" | "writing";
  label: string;
  chars?: number;
}

export interface QaResult {
  answer: string;
  references: QaReference[];
  trace?: string;
}

export interface RunQaInput {
  question: string;
  notes: Note[];
  tasks: Task[];
  projects: Project[];
  taskTypes: TaskType[];
  endpoint?: string;
  apiKey: string;
  model?: string;
  onProgress?: (info: QaProgress) => void;
}

interface QaToolCall {
  tool: QaToolName;
  args: Record<string, unknown>;
}

interface ToolExecutionResult {
  tool: QaToolName;
  args: Record<string, unknown>;
  result: unknown;
}

const MAX_TOOL_ROUNDS = 4;
const ALLOWED_TOOLS: QaToolName[] = ["search_notes", "get_note", "search_tasks", "get_task", "current_datetime"];

const TOOL_LABELS: Record<QaToolName, string> = {
  search_notes: "노트 검색",
  get_note: "노트 조회",
  search_tasks: "일정 검색",
  get_task: "일정 조회",
  current_datetime: "현재 시각 확인",
};

const SYSTEM_PROMPT = `
You answer questions about a Korean user's own notes and schedule (tasks).
Use the tools to find relevant notes and tasks before answering. Do not invent facts; rely only on tool results.
Answer in Korean, concise and specific. Cite the concrete notes/tasks you used as references.

Return exactly ONE JSON object with every key:
{
  "answer": "Korean answer in short Markdown",
  "references": [ { "type": "note" | "task", "id": "id from tool results", "title": "title" } ],
  "toolCalls": []
}

Rules:
1. To look things up, return toolCalls (and leave answer empty). Do not answer and call tools in the same response.
2. Tools: search_notes { keyword?, projectId?, status?, limit? }, get_note { noteId }, search_tasks { keyword?, status?, date?, startDate?, endDate?, projectId?, limit? }, get_task { taskId }, current_datetime {}.
3. Only put ids that came from tool results in references. If you found nothing, say so honestly and return empty references.
4. No markdown fences, no text outside the JSON.
`.trim();

function parseToolCalls(value: unknown): QaToolCall[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (!isRecord(item) || typeof item.tool !== "string" || !ALLOWED_TOOLS.includes(item.tool as QaToolName)) {
        return null;
      }
      return { tool: item.tool as QaToolName, args: isRecord(item.args) ? item.args : {} } satisfies QaToolCall;
    })
    .filter((item): item is QaToolCall => item !== null);
}

function normalizeSearchDate(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  const match = value.trim().match(/^(\d{4})[-/](\d{2})[-/](\d{2})$/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

function taskDateKey(task: Task): string {
  const parsed = new Date(task.startAt);
  if (Number.isNaN(parsed.getTime())) {
    return task.startAt.slice(0, 10);
  }
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
}

function executeToolCall(call: QaToolCall, input: RunQaInput): ToolExecutionResult {
  const projectMap = Object.fromEntries(input.projects.map((project) => [project.id, project]));
  const typeMap = Object.fromEntries(input.taskTypes.map((type) => [type.id, type]));

  if (call.tool === "current_datetime") {
    return { tool: call.tool, args: call.args, result: { now: toIsoNow() } };
  }

  if (call.tool === "get_note") {
    const note = input.notes.find((item) => item.id === call.args.noteId);
    return {
      tool: call.tool,
      args: call.args,
      result: note
        ? { id: note.id, title: note.title, content: note.content, projectName: projectMap[note.projectId]?.name ?? "", tags: note.tags, updatedAt: note.updatedAt }
        : { message: "노트를 찾지 못했습니다." },
    };
  }

  if (call.tool === "get_task") {
    const task = input.tasks.find((item) => item.id === call.args.taskId);
    return {
      tool: call.tool,
      args: call.args,
      result: task
        ? {
            id: task.id,
            title: task.title,
            content: task.content,
            startAt: task.startAt,
            status: STATUS_LABELS[task.status],
            projectName: projectMap[task.projectId]?.name ?? "",
            typeName: typeMap[task.taskTypeId]?.name ?? "",
          }
        : { message: "일정을 찾지 못했습니다." },
    };
  }

  const keyword = (typeof call.args.keyword === "string" ? call.args.keyword : "").trim().toLowerCase();
  const projectId = typeof call.args.projectId === "string" ? call.args.projectId : "";
  const limit = Math.max(1, Math.min(30, typeof call.args.limit === "number" ? Math.floor(call.args.limit) : 15));

  if (call.tool === "search_notes") {
    const filtered = input.notes
      .filter((note) => {
        if (projectId && note.projectId !== projectId) {
          return false;
        }
        if (!keyword) {
          return true;
        }
        return `${note.title} ${note.content} ${note.tags.join(" ")}`.toLowerCase().includes(keyword);
      })
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, limit)
      .map((note) => ({ id: note.id, title: note.title, snippet: note.content.slice(0, 200), projectName: projectMap[note.projectId]?.name ?? "" }));
    return { tool: call.tool, args: call.args, result: filtered };
  }

  // search_tasks
  const date = normalizeSearchDate(call.args.date);
  const startDate = normalizeSearchDate(call.args.startDate);
  const endDate = normalizeSearchDate(call.args.endDate);
  const status = typeof call.args.status === "string" ? call.args.status : "";
  const filtered = input.tasks
    .filter((task) => {
      const key = taskDateKey(task);
      if (projectId && task.projectId !== projectId) {
        return false;
      }
      if (status && STATUS_LABELS[task.status] !== status && task.status !== status) {
        return false;
      }
      if (date && key !== date) {
        return false;
      }
      if (startDate && key < startDate) {
        return false;
      }
      if (endDate && key > endDate) {
        return false;
      }
      if (!keyword) {
        return true;
      }
      return `${task.title} ${task.content}`.toLowerCase().includes(keyword);
    })
    .sort((a, b) => new Date(b.startAt).getTime() - new Date(a.startAt).getTime())
    .slice(0, limit)
    .map((task) => ({
      id: task.id,
      title: task.title,
      startAt: task.startAt,
      status: STATUS_LABELS[task.status],
      projectName: projectMap[task.projectId]?.name ?? "",
    }));
  return { tool: "search_tasks", args: call.args, result: filtered };
}

function buildMessages(input: RunQaInput, toolResults: ToolExecutionResult[]): LlmChatMessage[] {
  const payload = {
    now: toIsoNow(),
    question: input.question,
    knownProjects: input.projects.map((project) => ({ id: project.id, name: project.name })),
    toolResults,
  };
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: JSON.stringify(payload, null, 2) },
  ];
}

function summarize(counts: Map<string, number>): string {
  return Array.from(counts.entries())
    .map(([label, count]) => `${label} ${count}건`)
    .join(", ");
}

export async function runQaAgent(input: RunQaInput): Promise<QaResult> {
  const accumulated: ToolExecutionResult[] = [];
  const toolCounts = new Map<string, number>();
  const noteMap = Object.fromEntries(input.notes.map((note) => [note.id, note]));
  const taskMap = Object.fromEntries(input.tasks.map((task) => [task.id, task]));

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    let chars = 0;
    const raw = await requestLlmResponse({
      messages: buildMessages(input, accumulated),
      endpoint: input.endpoint,
      apiKey: input.apiKey,
      model: input.model,
      onToken: input.onProgress
        ? (delta) => {
            chars += delta.length;
            input.onProgress?.({ phase: "writing", label: "AI가 작성 중", chars });
          }
        : undefined,
    });

    const payload = parseJsonObject(raw);
    if (!payload) {
      return {
        answer: extractJsonText(raw).slice(0, 800) || "답변을 해석하지 못했습니다. 다시 시도해 주세요.",
        references: [],
        trace: toolCounts.size > 0 ? summarize(toolCounts) : undefined,
      };
    }

    const toolCalls = parseToolCalls(payload.toolCalls).slice(0, 4);
    if (toolCalls.length > 0) {
      for (const call of toolCalls) {
        accumulated.push(executeToolCall(call, input));
        const label = TOOL_LABELS[call.tool];
        toolCounts.set(label, (toolCounts.get(label) ?? 0) + 1);
      }
      input.onProgress?.({ phase: "tools", label: summarize(toolCounts) });
      continue;
    }

    const answer = pickFirstString(payload, ["answer", "response", "text"]) || "관련 정보를 찾지 못했습니다.";
    const referencesRaw = Array.isArray(payload.references) ? payload.references : [];
    const references: QaReference[] = [];
    for (const entry of referencesRaw) {
      if (!isRecord(entry)) {
        continue;
      }
      const id = pickFirstString(entry, ["id", "noteId", "taskId"]);
      const type = pickFirstString(entry, ["type"]);
      if (type === "note" && noteMap[id]) {
        references.push({ type: "note", id, title: noteMap[id].title });
      } else if (type === "task" && taskMap[id]) {
        references.push({ type: "task", id, title: taskMap[id].title });
      } else if (noteMap[id]) {
        references.push({ type: "note", id, title: noteMap[id].title });
      } else if (taskMap[id]) {
        references.push({ type: "task", id, title: taskMap[id].title });
      }
    }

    return { answer, references: references.slice(0, 8), trace: toolCounts.size > 0 ? summarize(toolCounts) : undefined };
  }

  return {
    answer: "관련 정보를 충분히 찾지 못했습니다. 질문을 조금 더 구체적으로 다시 물어봐 주세요.",
    references: [],
    trace: toolCounts.size > 0 ? summarize(toolCounts) : undefined,
  };
}
