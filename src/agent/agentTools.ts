import { STATUS_LABELS } from "../constants";
import type { Note, Project, Task, TaskStatus, TaskType } from "../models";
import { toIsoNow } from "../utils/date";

/**
 * 세 에이전트(schedule/notes/qa)가 공유하는 읽기 전용 도구 실행기.
 * - 결과 크기 truncate (프롬프트 토큰 절약)
 * - 잘못된 인자에 대한 피드백 (모델 자기수정 유도)
 * - 날짜 검색 시 startAt 기준 정렬
 * - 동일 호출 중복 감지 캐시
 */

export interface SharedToolResult {
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
  result: unknown;
}

export interface AgentDataContext {
  tasks: Task[];
  projects: Project[];
  taskTypes: TaskType[];
  notes?: Note[];
}

const MAX_SEARCH_LIMIT = 30;
const DEFAULT_SEARCH_LIMIT = 15;
const TASK_CONTENT_PREVIEW = 160;
const TASK_CONTENT_FULL = 500;
const NOTE_SNIPPET_LENGTH = 200;
const NOTE_CONTENT_MAX = 4000;
const MAX_ACCUMULATED_RESULTS = 16;

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** 같은 도구+인자 호출을 감지해 중복 실행과 중복 프롬프트 전송을 막는다. */
export class ToolCallCache {
  private seen = new Set<string>();

  private key(tool: string, args: Record<string, unknown>): string {
    return `${tool}:${stableStringify(args)}`;
  }

  has(tool: string, args: Record<string, unknown>): boolean {
    return this.seen.has(this.key(tool, args));
  }

  add(tool: string, args: Record<string, unknown>): void {
    this.seen.add(this.key(tool, args));
  }
}

/** 라운드 전체가 중복 호출이었을 때 모델에게 알려 최종 결과 작성을 유도한다. */
export function duplicateCallNotice(): SharedToolResult {
  return {
    tool: "system_notice",
    args: {},
    ok: false,
    result: {
      notice:
        "직전 도구 호출은 이미 동일한 인자로 실행되어 생략했습니다. 기존 toolResults를 사용해 최종 결과를 작성하세요.",
    },
  };
}

/** 누적 도구 결과가 프롬프트를 무한정 키우지 않도록 오래된 항목을 정리한다. */
export function capToolResults(results: SharedToolResult[]): SharedToolResult[] {
  if (results.length <= MAX_ACCUMULATED_RESULTS) {
    return results;
  }
  const dropped = results.length - MAX_ACCUMULATED_RESULTS;
  return [
    {
      tool: "system_notice",
      args: {},
      ok: true,
      result: { notice: `이전 도구 결과 ${dropped}건은 프롬프트 길이 관리를 위해 생략되었습니다.` },
    },
    ...results.slice(dropped),
  ];
}

function normalizeSearchDate(value: unknown, field: string): { value: string; warning?: string } {
  if (typeof value !== "string" || !value.trim()) {
    return { value: "" };
  }
  const match = value.trim().match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (!match) {
    return { value: "", warning: `${field} 인자 "${value}"가 YYYY-MM-DD 형식이 아니어서 무시했습니다.` };
  }
  return { value: `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}` };
}

function taskDateKey(task: Task): string {
  const parsed = new Date(task.startAt);
  if (Number.isNaN(parsed.getTime())) {
    return task.startAt.slice(0, 10);
  }
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${parsed.getFullYear()}-${month}-${day}`;
}

const STATUS_ALIAS: Record<string, TaskStatus> = {
  not_done: "NOT_DONE",
  notdone: "NOT_DONE",
  todo: "NOT_DONE",
  pending: "NOT_DONE",
  in_progress: "NOT_DONE",
  미완료: "NOT_DONE",
  대기: "NOT_DONE",
  on_hold: "ON_HOLD",
  hold: "ON_HOLD",
  paused: "ON_HOLD",
  보류: "ON_HOLD",
  done: "DONE",
  complete: "DONE",
  completed: "DONE",
  완료: "DONE",
  canceled: "CANCELED",
  cancelled: "CANCELED",
  cancel: "CANCELED",
  취소: "CANCELED",
};

function normalizeStatusFilter(value: unknown): { status?: TaskStatus; warning?: string } {
  if (typeof value !== "string" || !value.trim()) {
    return {};
  }
  const raw = value.trim();
  const upper = raw.toUpperCase();
  if (upper === "NOT_DONE" || upper === "ON_HOLD" || upper === "DONE" || upper === "CANCELED") {
    return { status: upper as TaskStatus };
  }
  const alias = STATUS_ALIAS[raw.toLowerCase()];
  if (alias) {
    return { status: alias };
  }
  const labelEntry = (Object.entries(STATUS_LABELS) as Array<[TaskStatus, string]>).find(([, label]) => label === raw);
  if (labelEntry) {
    return { status: labelEntry[0] };
  }
  return { warning: `status 인자 "${raw}"를 해석하지 못해 무시했습니다.` };
}

function clampLimit(value: unknown): number {
  const raw = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : DEFAULT_SEARCH_LIMIT;
  return Math.max(1, Math.min(MAX_SEARCH_LIMIT, raw));
}

function toTaskSummary(task: Task, ctx: AgentDataContext, contentMax = TASK_CONTENT_PREVIEW) {
  const project = ctx.projects.find((item) => item.id === task.projectId);
  const taskType = ctx.taskTypes.find((item) => item.id === task.taskTypeId);
  return {
    id: task.id,
    title: task.title,
    content: clip(task.content, contentMax),
    status: task.status,
    statusLabel: STATUS_LABELS[task.status],
    startAt: task.startAt,
    endAt: task.endAt,
    projectId: task.projectId,
    projectName: project?.name ?? "",
    taskTypeId: task.taskTypeId,
    taskTypeName: taskType?.name ?? "",
    isMajor: task.isMajor,
    updatedAt: task.updatedAt,
  };
}

export function execCurrentDatetime(tool: string, args: Record<string, unknown>): SharedToolResult {
  return { tool, args, ok: true, result: { now: toIsoNow() } };
}

export function execSearchTasks(tool: string, args: Record<string, unknown>, ctx: AgentDataContext): SharedToolResult {
  const warnings: string[] = [];
  const keywordSource =
    typeof args.keyword === "string" ? args.keyword : typeof args.title === "string" ? args.title : "";
  const keyword = keywordSource.trim().toLowerCase();
  const date = normalizeSearchDate(args.date, "date");
  const startDate = normalizeSearchDate(args.startDate, "startDate");
  const endDate = normalizeSearchDate(args.endDate, "endDate");
  for (const parsed of [date, startDate, endDate]) {
    if (parsed.warning) {
      warnings.push(parsed.warning);
    }
  }
  const statusFilter = normalizeStatusFilter(args.status);
  if (statusFilter.warning) {
    warnings.push(statusFilter.warning);
  }
  const projectId = typeof args.projectId === "string" ? args.projectId : "";
  const limit = clampLimit(args.limit);
  const hasDateFilter = Boolean(date.value || startDate.value || endDate.value);

  const items = ctx.tasks
    .filter((task) => {
      const key = taskDateKey(task);
      if (projectId && task.projectId !== projectId) {
        return false;
      }
      if (statusFilter.status && task.status !== statusFilter.status) {
        return false;
      }
      if (date.value && key !== date.value) {
        return false;
      }
      if (startDate.value && key < startDate.value) {
        return false;
      }
      if (endDate.value && key > endDate.value) {
        return false;
      }
      if (!keyword) {
        return true;
      }
      const project = ctx.projects.find((item) => item.id === task.projectId);
      const taskType = ctx.taskTypes.find((item) => item.id === task.taskTypeId);
      const haystack = `${task.title} ${task.content} ${project?.name ?? ""} ${project?.description ?? ""} ${taskType?.name ?? ""}`.toLowerCase();
      return haystack.includes(keyword);
    })
    .sort(
      hasDateFilter
        ? // 날짜 기반 검색은 일정 시각 순으로 — "내일 회의"류 요청에서 정확한 후보가 상위로 온다.
          (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()
        : (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )
    .slice(0, limit)
    .map((task) => toTaskSummary(task, ctx));

  return { tool, args, ok: true, result: warnings.length > 0 ? { warnings, items } : items };
}

export function execGetTask(tool: string, args: Record<string, unknown>, ctx: AgentDataContext): SharedToolResult {
  const taskId = typeof args.taskId === "string" ? args.taskId.trim() : "";
  if (!taskId) {
    return { tool, args, ok: false, result: { error: "taskId 인자가 필요합니다." } };
  }
  const task = ctx.tasks.find((item) => item.id === taskId);
  if (!task) {
    return {
      tool,
      args,
      ok: false,
      result: { error: `taskId "${taskId}"에 해당하는 일정이 없습니다. search_tasks로 먼저 검색해 실제 id를 확인하세요.` },
    };
  }
  const project = ctx.projects.find((item) => item.id === task.projectId);
  return {
    tool,
    args,
    ok: true,
    result: { ...toTaskSummary(task, ctx, TASK_CONTENT_FULL), projectDescription: project?.description ?? "" },
  };
}

export function execSearchNotes(tool: string, args: Record<string, unknown>, ctx: AgentDataContext): SharedToolResult {
  const notes = ctx.notes ?? [];
  const warnings: string[] = [];
  const keyword = (typeof args.keyword === "string" ? args.keyword : "").trim().toLowerCase();
  const projectId = typeof args.projectId === "string" ? args.projectId : "";
  const tag = (typeof args.tag === "string" ? args.tag : "").trim().toLowerCase();
  const statusRaw = typeof args.status === "string" ? args.status.trim() : "";
  let status = "";
  if (statusRaw) {
    if (statusRaw === "draft" || statusRaw === "active" || statusRaw === "archived") {
      status = statusRaw;
    } else {
      warnings.push(`status 인자 "${statusRaw}"는 draft/active/archived 중 하나가 아니어서 무시했습니다.`);
    }
  }
  const limit = clampLimit(args.limit);

  const items = notes
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
      const project = ctx.projects.find((item) => item.id === note.projectId);
      const haystack = `${note.title} ${note.content} ${note.tags.join(" ")} ${project?.name ?? ""}`.toLowerCase();
      return haystack.includes(keyword);
    })
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, limit)
    .map((note) => ({
      id: note.id,
      title: note.title,
      snippet: clip(note.content, NOTE_SNIPPET_LENGTH),
      projectId: note.projectId,
      projectName: ctx.projects.find((item) => item.id === note.projectId)?.name ?? "",
      tags: note.tags,
      status: note.status,
      updatedAt: note.updatedAt,
    }));

  return { tool, args, ok: true, result: warnings.length > 0 ? { warnings, items } : items };
}

export function execGetNote(tool: string, args: Record<string, unknown>, ctx: AgentDataContext): SharedToolResult {
  const noteId = typeof args.noteId === "string" ? args.noteId.trim() : "";
  if (!noteId) {
    return { tool, args, ok: false, result: { error: "noteId 인자가 필요합니다." } };
  }
  const note = (ctx.notes ?? []).find((item) => item.id === noteId);
  if (!note) {
    return {
      tool,
      args,
      ok: false,
      result: { error: `noteId "${noteId}"에 해당하는 노트가 없습니다. search_notes로 먼저 검색해 실제 id를 확인하세요.` },
    };
  }
  return {
    tool,
    args,
    ok: true,
    result: {
      id: note.id,
      title: note.title,
      content: clip(note.content, NOTE_CONTENT_MAX),
      contentTruncated: note.content.length > NOTE_CONTENT_MAX,
      projectId: note.projectId,
      projectName: ctx.projects.find((item) => item.id === note.projectId)?.name ?? "",
      tags: note.tags,
      status: note.status,
      linkedTaskIds: note.linkedTaskIds,
      updatedAt: note.updatedAt,
    },
  };
}

export function execGetLinkedTasks(tool: string, args: Record<string, unknown>, ctx: AgentDataContext): SharedToolResult {
  const noteId = typeof args.noteId === "string" ? args.noteId.trim() : "";
  if (!noteId) {
    return { tool, args, ok: false, result: { error: "noteId 인자가 필요합니다." } };
  }
  const note = (ctx.notes ?? []).find((item) => item.id === noteId);
  if (!note) {
    return {
      tool,
      args,
      ok: false,
      result: { error: `noteId "${noteId}"에 해당하는 노트가 없습니다. search_notes로 먼저 검색하세요.` },
    };
  }
  const linkedIds = new Set(note.linkedTaskIds);
  const linkedTasks = ctx.tasks
    .filter((task) => linkedIds.has(task.id))
    .map((task) => ({
      id: task.id,
      title: task.title,
      startAt: task.startAt,
      status: task.status,
      statusLabel: STATUS_LABELS[task.status],
    }));
  return { tool, args, ok: true, result: linkedTasks };
}
