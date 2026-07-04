import type { Note, Project, Task, TaskType } from "../models";
import { toIsoNow } from "../utils/date";
import {
  ToolCallCache,
  capToolResults,
  duplicateCallNotice,
  execCurrentDatetime,
  execGetNote,
  execGetTask,
  execSearchNotes,
  execSearchTasks,
  type SharedToolResult,
} from "./agentTools";
import {
  extractJsonText,
  isRecord,
  pickFirstString,
  requestJsonWithRetry,
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
  signal?: AbortSignal;
}

interface QaToolCall {
  tool: QaToolName;
  args: Record<string, unknown>;
}

type ToolExecutionResult = SharedToolResult;

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
2. Tools: search_notes { keyword?, projectId?, status?, limit? }, get_note { noteId }, search_tasks { keyword?, status?, date?, startDate?, endDate?, projectId?, limit? }, get_task { taskId }.
3. Only put ids that came from tool results in references. If you found nothing, say so honestly and return empty references.
4. No markdown fences, no text outside the JSON.
5. The current date/time is already provided as "now" in the payload — never call a tool for it.
6. Never repeat a tool call with the same arguments; earlier results stay available in toolResults.
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

function executeToolCall(call: QaToolCall, input: RunQaInput): ToolExecutionResult {
  const ctx = { tasks: input.tasks, projects: input.projects, taskTypes: input.taskTypes, notes: input.notes };

  if (call.tool === "current_datetime") {
    return execCurrentDatetime(call.tool, call.args);
  }
  if (call.tool === "get_note") {
    return execGetNote(call.tool, call.args, ctx);
  }
  if (call.tool === "get_task") {
    return execGetTask(call.tool, call.args, ctx);
  }
  if (call.tool === "search_notes") {
    return execSearchNotes(call.tool, call.args, ctx);
  }
  return execSearchTasks(call.tool, call.args, ctx);
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

  const callCache = new ToolCallCache();

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    let chars = 0;
    const writingLabel = toolCounts.size > 0 ? "답변 작성 중" : "질문 분석 중";
    const { payload, raw } = await requestJsonWithRetry({
      messages: buildMessages(input, capToolResults(accumulated)),
      endpoint: input.endpoint,
      apiKey: input.apiKey,
      model: input.model,
      signal: input.signal,
      onToken: input.onProgress
        ? (delta) => {
            chars += delta.length;
            input.onProgress?.({ phase: "writing", label: writingLabel, chars });
          }
        : undefined,
    });

    if (!payload) {
      return {
        answer: extractJsonText(raw).slice(0, 800) || "답변을 해석하지 못했습니다. 다시 시도해 주세요.",
        references: [],
        trace: toolCounts.size > 0 ? summarize(toolCounts) : undefined,
      };
    }

    const toolCalls = parseToolCalls(payload.toolCalls).slice(0, 4);
    if (toolCalls.length > 0) {
      const freshCalls = toolCalls.filter((call) => !callCache.has(call.tool, call.args));
      if (freshCalls.length === 0) {
        accumulated.push(duplicateCallNotice());
        continue;
      }
      for (const call of freshCalls) {
        callCache.add(call.tool, call.args);
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
