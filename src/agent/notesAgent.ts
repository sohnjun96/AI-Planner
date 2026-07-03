import type { Note, Project, Task, TaskType } from "../models";
import { toIsoNow } from "../utils/date";
import {
  extractJsonText,
  isRecord,
  parseJsonObject,
  pickFirstString,
  pickFirstStringArray,
  requestLlmResponse,
  type LlmChatMessage,
} from "./agentUtils";

export type NotesAgentMode = "edit" | "inline_edit" | "summarize" | "merge" | "search";

type NotesAgentToolName =
  | "search_notes"
  | "get_note"
  | "list_note_versions"
  | "get_linked_tasks"
  | "current_datetime";

interface NotesAgentToolCall {
  tool: NotesAgentToolName;
  args: Record<string, unknown>;
}

interface ToolExecutionResult {
  tool: NotesAgentToolName;
  args: Record<string, unknown>;
  ok: boolean;
  result: unknown;
}

export interface RunNotesAgentInput {
  mode: NotesAgentMode;
  userMessage: string;
  /** 편집/인라인 편집 대상 노트 */
  activeNote?: { id: string; title: string; content: string; projectId: string };
  /** 인라인 편집 시 선택된 텍스트 */
  selectedText?: string;
  /** 요약/병합 대상 노트들 */
  targetNotes?: Array<{ id: string; title: string; content: string }>;
  /** 검색 도구가 사용할 전체 노트 코퍼스 */
  notes: Note[];
  tasks: Task[];
  projects: Project[];
  taskTypes: TaskType[];
  endpoint?: string;
  apiKey: string;
  model?: string;
}

export interface NotesAgentResult {
  assistantMessage: string;
  /** edit/summarize/merge 결과 — diff 뷰나 미리보기에 사용 */
  proposedTitle?: string;
  proposedContent?: string;
  /** inline_edit 결과 — 선택 영역을 대체할 텍스트 */
  replacementText?: string;
  /** search 결과 */
  matchedNoteIds?: string[];
}

const MAX_TOOL_ROUNDS = 4;

const ALLOWED_TOOLS: NotesAgentToolName[] = [
  "search_notes",
  "get_note",
  "list_note_versions",
  "get_linked_tasks",
  "current_datetime",
];

const BASE_RULES = `
You are the note assistant for a Korean task and note manager.
Return exactly one valid JSON object. No markdown fences. No text before or after the JSON.
All user-facing text values (assistantMessage, proposedTitle, proposedContent, replacementText) must be Korean.
Note content is Markdown. Preserve Markdown structure (headings, lists, checklists) in your output.

Root schema (always include every key):
{
  "assistantMessage": "short Korean message",
  "toolCalls": [],
  "proposedTitle": "",
  "proposedContent": "",
  "replacementText": "",
  "matchedNoteIds": []
}

Rules:
1. If you need to inspect other notes, versions, or linked tasks before answering, return toolCalls and leave the result fields empty.
2. If toolCalls is not empty, do not include a final result in the same response.
3. Use only these tools: search_notes, get_note, list_note_versions, get_linked_tasks, current_datetime.
4. search_notes args: { "keyword"?: string, "projectId"?: string, "tag"?: string, "status"?: "draft"|"active"|"archived", "limit"?: number }
5. get_note args: { "noteId": string }
6. get_linked_tasks args: { "noteId": string }
7. Do not invent note ids. Use ids returned from tools or provided in the payload.
`.trim();

const MODE_INSTRUCTIONS: Record<NotesAgentMode, string> = {
  edit: `
Task: Rewrite the active note according to the user's request.
Put the full revised Markdown in proposedContent. If the title should change, put it in proposedTitle (otherwise leave it empty).
Keep everything the user did not ask to change. Do not drop existing content unless explicitly requested.
`.trim(),
  inline_edit: `
Task: Rewrite ONLY the selected text according to the user's request.
Put the replacement Markdown for the selection in replacementText. Leave proposedContent empty.
Do not include surrounding text. Keep it concise and consistent with the note's tone.
`.trim(),
  summarize: `
Task: Summarize the target notes into one cohesive Korean Markdown summary.
Put the summary in proposedContent. Use headings and bullet points. Reference each note's key points.
`.trim(),
  merge: `
Task: Merge the target notes into a single cohesive Markdown note without losing important information.
Put the merged content in proposedContent and a suitable title in proposedTitle.
Remove duplicates, organize by topic, and keep all checklists and action items.
`.trim(),
  search: `
Task: Find notes matching the user's request using search_notes/get_note, then return matchedNoteIds (most relevant first) and a short Korean assistantMessage describing what you found.
Leave proposedContent and replacementText empty.
`.trim(),
};

function parseToolCalls(value: unknown): NotesAgentToolCall[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (!isRecord(item) || typeof item.tool !== "string") {
        return null;
      }
      if (!ALLOWED_TOOLS.includes(item.tool as NotesAgentToolName)) {
        return null;
      }
      return {
        tool: item.tool as NotesAgentToolName,
        args: isRecord(item.args) ? item.args : {},
      } satisfies NotesAgentToolCall;
    })
    .filter((item): item is NotesAgentToolCall => item !== null);
}

function executeToolCall(
  call: NotesAgentToolCall,
  notes: Note[],
  tasks: Task[],
  projects: Project[],
): ToolExecutionResult {
  const projectMap = Object.fromEntries(projects.map((project) => [project.id, project]));

  if (call.tool === "current_datetime") {
    return { tool: call.tool, args: call.args, ok: true, result: { now: toIsoNow() } };
  }

  if (call.tool === "get_note") {
    const noteId = typeof call.args.noteId === "string" ? call.args.noteId : "";
    const note = notes.find((item) => item.id === noteId);
    return {
      tool: call.tool,
      args: call.args,
      ok: Boolean(note),
      result: note
        ? {
            id: note.id,
            title: note.title,
            content: note.content,
            projectId: note.projectId,
            projectName: projectMap[note.projectId]?.name ?? "",
            tags: note.tags,
            status: note.status,
            linkedTaskIds: note.linkedTaskIds,
            updatedAt: note.updatedAt,
          }
        : { message: "노트를 찾지 못했습니다." },
    };
  }

  if (call.tool === "get_linked_tasks") {
    const noteId = typeof call.args.noteId === "string" ? call.args.noteId : "";
    const note = notes.find((item) => item.id === noteId);
    const linkedIds = new Set(note?.linkedTaskIds ?? []);
    const linkedTasks = tasks
      .filter((task) => linkedIds.has(task.id))
      .map((task) => ({ id: task.id, title: task.title, startAt: task.startAt, status: task.status }));
    return { tool: call.tool, args: call.args, ok: true, result: linkedTasks };
  }

  if (call.tool === "list_note_versions") {
    // 버전 히스토리는 UI 레이어에서 관리하므로 에이전트에는 요약 정보만 제공한다.
    return {
      tool: call.tool,
      args: call.args,
      ok: true,
      result: { message: "버전 정보는 편집 화면의 히스토리 패널에서 확인할 수 있습니다." },
    };
  }

  // search_notes
  const keyword = (typeof call.args.keyword === "string" ? call.args.keyword : "").trim().toLowerCase();
  const projectId = typeof call.args.projectId === "string" ? call.args.projectId : "";
  const tag = (typeof call.args.tag === "string" ? call.args.tag : "").trim().toLowerCase();
  const status = typeof call.args.status === "string" ? call.args.status : "";
  const limitRaw = typeof call.args.limit === "number" ? call.args.limit : 20;
  const limit = Math.max(1, Math.min(50, Math.floor(limitRaw)));

  const filtered = notes
    .filter((note) => {
      if (projectId && note.projectId !== projectId) {
        return false;
      }
      if (status && note.status !== status) {
        return false;
      }
      if (tag && !note.tags.some((item) => item.toLowerCase() === tag)) {
        return false;
      }
      if (!keyword) {
        return true;
      }
      const projectName = projectMap[note.projectId]?.name ?? "";
      const haystack = `${note.title} ${note.content} ${note.tags.join(" ")} ${projectName}`.toLowerCase();
      return haystack.includes(keyword);
    })
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, limit)
    .map((note) => ({
      id: note.id,
      title: note.title,
      snippet: note.content.slice(0, 160),
      projectId: note.projectId,
      projectName: projectMap[note.projectId]?.name ?? "",
      tags: note.tags,
      status: note.status,
      updatedAt: note.updatedAt,
    }));

  return { tool: "search_notes", args: call.args, ok: true, result: filtered };
}

function buildPromptMessages(input: RunNotesAgentInput, toolResults: ToolExecutionResult[]): LlmChatMessage[] {
  const projectMap = Object.fromEntries(input.projects.map((project) => [project.id, project]));
  const activeNote = input.activeNote
    ? {
        id: input.activeNote.id,
        title: input.activeNote.title,
        content: input.activeNote.content,
        projectId: input.activeNote.projectId,
        projectName: projectMap[input.activeNote.projectId]?.name ?? "",
      }
    : undefined;

  const userPayload = {
    now: toIsoNow(),
    mode: input.mode,
    userRequest: input.userMessage,
    activeNote,
    selectedText: input.selectedText,
    targetNotes: input.targetNotes,
    knownProjects: input.projects.map((project) => ({ id: project.id, name: project.name })),
    toolResults,
  };

  const systemPrompt = `${BASE_RULES}\n\nCurrent mode instructions:\n${MODE_INSTRUCTIONS[input.mode]}`;

  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: JSON.stringify(userPayload, null, 2) },
  ];
}

function buildResult(mode: NotesAgentMode, payload: Record<string, unknown>): NotesAgentResult {
  const assistantMessage =
    typeof payload.assistantMessage === "string" && payload.assistantMessage.trim()
      ? payload.assistantMessage.trim()
      : "요청을 처리했습니다.";

  const proposedTitle = pickFirstString(payload, ["proposedTitle", "title"]) || undefined;
  const proposedContent = pickFirstString(payload, ["proposedContent", "content"]) || undefined;
  const replacementText = pickFirstString(payload, ["replacementText", "replacement"]) || undefined;
  const matchedNoteIds = pickFirstStringArray(payload, ["matchedNoteIds", "noteIds", "ids"], 20);

  const result: NotesAgentResult = { assistantMessage };
  if (mode === "inline_edit") {
    result.replacementText = replacementText;
  } else if (mode === "search") {
    result.matchedNoteIds = matchedNoteIds;
  } else {
    result.proposedTitle = proposedTitle;
    result.proposedContent = proposedContent;
  }
  return result;
}

export async function runNotesAgent(input: RunNotesAgentInput): Promise<NotesAgentResult> {
  const accumulatedToolResults: ToolExecutionResult[] = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const messages = buildPromptMessages(input, accumulatedToolResults);
    const raw = await requestLlmResponse({
      messages,
      endpoint: input.endpoint,
      apiKey: input.apiKey,
      model: input.model,
    });

    const payload = parseJsonObject(raw);
    if (!payload) {
      // JSON 파싱 실패 시 원문을 assistantMessage로 노출 (크래시 방지)
      return {
        assistantMessage: extractJsonText(raw).slice(0, 500) || "AI 응답을 해석하지 못했습니다. 다시 시도해 주세요.",
      };
    }

    const toolCalls = parseToolCalls(payload.toolCalls).slice(0, 4);
    if (toolCalls.length > 0) {
      const roundResults = toolCalls.map((call) =>
        executeToolCall(call, input.notes, input.tasks, input.projects),
      );
      accumulatedToolResults.push(...roundResults);
      continue;
    }

    return buildResult(input.mode, payload);
  }

  // 루프 초과 시 throw 대신 안내 메시지 반환
  return {
    assistantMessage: "노트 정보를 조회했지만 결과를 완성하지 못했습니다. 요청을 조금 더 구체적으로 다시 입력해 주세요.",
  };
}

/**
 * 노트 내용 기반 관련 일정 추천 (LLM 없이 로컬 점수 계산).
 * 설계 문서의 점수 규칙을 그대로 구현한다.
 */
export function suggestTasksForNote(params: {
  noteTitle: string;
  noteContent: string;
  noteProjectId: string;
  noteCreatedAt: string;
  tasks: Task[];
  excludeTaskIds: string[];
  dateWindowDays: number;
  limit: number;
}): Array<{ taskId: string; score: number; reason: string }> {
  const excluded = new Set(params.excludeTaskIds);
  const keywords = extractKeywords(`${params.noteTitle} ${params.noteContent}`);
  const noteTime = new Date(params.noteCreatedAt).getTime();
  const windowMs = params.dateWindowDays * 24 * 60 * 60 * 1000;

  const scored = params.tasks
    .filter((task) => !excluded.has(task.id))
    .map((task) => {
      let score = 0;
      const reasons: string[] = [];
      const title = task.title.toLowerCase();
      const content = task.content.toLowerCase();

      for (const keyword of keywords) {
        if (title.includes(keyword)) {
          score += 2;
        } else if (content.includes(keyword)) {
          score += 1;
        }
      }
      if (keywords.some((keyword) => title.includes(keyword) || content.includes(keyword))) {
        reasons.push("키워드 일치");
      }

      if (params.noteProjectId && task.projectId === params.noteProjectId) {
        score += 3;
        reasons.push("같은 프로젝트");
      }

      const taskTime = new Date(task.startAt).getTime();
      if (Number.isFinite(taskTime) && Number.isFinite(noteTime) && Math.abs(taskTime - noteTime) <= windowMs) {
        score += 2;
        reasons.push("비슷한 날짜");
      }

      return { taskId: task.id, score, reason: reasons.join(", ") || "관련 가능성" };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, params.limit);

  return scored;
}

/**
 * 관련 노트 자동 탐색 (LLM 없이 로컬 점수 계산).
 * 키워드 겹침 + 같은 프로젝트 + 공통 태그 기준.
 */
export function suggestRelatedNotes(params: {
  note: { id: string; title: string; content: string; projectId: string; tags: string[] };
  notes: Note[];
  limit: number;
}): Array<{ noteId: string; score: number; reason: string }> {
  const keywords = extractKeywords(`${params.note.title} ${params.note.content}`);
  const tagSet = new Set(params.note.tags.map((tag) => tag.toLowerCase()));

  return params.notes
    .filter((note) => note.id !== params.note.id)
    .map((note) => {
      let score = 0;
      const reasons: string[] = [];
      const haystack = `${note.title} ${note.content}`.toLowerCase();

      let matched = 0;
      for (const keyword of keywords) {
        if (haystack.includes(keyword)) {
          matched += 1;
        }
      }
      if (matched > 0) {
        score += Math.min(6, matched);
        reasons.push("키워드");
      }
      if (note.projectId === params.note.projectId) {
        score += 2;
        reasons.push("같은 프로젝트");
      }
      if (note.tags.some((tag) => tagSet.has(tag.toLowerCase()))) {
        score += 2;
        reasons.push("공통 태그");
      }

      return { noteId: note.id, score, reason: reasons.join(", ") };
    })
    .filter((item) => item.score >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, params.limit);
}

const STOP_TOKENS = new Set([
  "그리고",
  "하지만",
  "그래서",
  "이것",
  "저것",
  "그것",
  "해서",
  "관련",
  "노트",
  "메모",
  "the",
  "and",
  "for",
  "with",
  "this",
  "that",
]);

function extractKeywords(text: string): string[] {
  const normalized = text
    .toLowerCase()
    .replace(/[#*`\-[\]()]/g, " ")
    .replace(/[.,!?;:"'\n\r]/g, " ");
  const tokens = normalized
    .split(/\s+/)
    .map((token) => token.replace(/(은|는|이|가|을|를|의|에|에서|으로|와|과|도|만)$/u, ""))
    .filter((token) => token.length >= 2 && !STOP_TOKENS.has(token));
  return Array.from(new Set(tokens)).slice(0, 20);
}
