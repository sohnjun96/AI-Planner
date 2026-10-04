import type { Memo, Note, Project, ProjectSubcategory, Task, TaskStatus, TaskType } from "../models";

export type QaRecordType = "task" | "note" | "memo";

export interface QaSearchRecord {
  type: QaRecordType;
  id: string;
  title: string;
  snippet: string;
  /** Only words found in this actual record, never model-generated claims. */
  terms: string[];
  /** Explicit event date or a linked schedule date; a note's updatedAt is not an event date. */
  eventDate?: string;
  eventEndDate?: string;
  eventDateSource?: "explicit" | "linked";
}

export interface QaSearchPlan {
  terms: string[][];
  types: QaRecordType[];
  temporal: "any" | "past" | "future";
  startDate?: string;
  endDate?: string;
  statuses: TaskStatus[];
}

export interface QaSearchInput {
  tasks: Task[];
  notes: Note[];
  memos?: Memo[];
  projects: Project[];
  taskTypes: TaskType[];
  subcategories?: ProjectSubcategory[];
  now?: Date;
  signal?: AbortSignal;
}

const RECORD_TYPES: QaRecordType[] = ["task", "note", "memo"];
const TASK_STATUSES: TaskStatus[] = ["NOT_DONE", "ON_HOLD", "DONE", "CANCELED"];
const INVALID_PLAN = "검색 조건을 해석하지 못했습니다. 질문을 조금 더 구체적으로 다시 입력해 주세요.";
const ALIASES = [["AI", "인공지능"], ["출장", "방문"], ["교육", "연수"]];

function folded(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/\s+/g, " ").trim();
}

export function isQaDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1900 || year > 9999 || month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function seoulDate(value: string | Date): string | undefined {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return undefined;
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function protectedQuestionClues(question: string): string[] {
  // Trust the model to remove request language. Only protect quoted literals and
  // the few ambiguous/alias clues for which replacing the user's words loses meaning.
  const quoted = [...question.matchAll(/["“‘']([^"”’'\r\n]{1,100})["”’']/g)].map((match) => match[1].trim());
  const words = question.replace(/[\p{P}\p{S}]/gu, " ").split(/\s+/)
    .map((word) => word.replace(/(?:에서|으로|에게|은|는|을|를|이|가|와|과|도|만|에)$/, ""));
  return [...new Set([...quoted, ...words.filter((word) => word === "분류" || word === "예산" ||
    ALIASES.some((aliases) => aliases.some((alias) => folded(alias) === folded(word))))])];
}

/** Reject malformed model fields before local lookup. Preserve exact user clues when a model omits them. */
export function parseQaSearchPlan(value: unknown, question: string): QaSearchPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(INVALID_PLAN);
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.terms) || raw.terms.length > 12) throw new Error(INVALID_PLAN);
  const groups: string[][] = [];
  for (const group of raw.terms) {
    if (!Array.isArray(group) || !group.length || group.length > 8) throw new Error(INVALID_PLAN);
    if (group.some((word) => typeof word !== "string" || !word.trim() || word.trim().length > 100 || /[\r\n]/.test(word) || word.includes("\0"))) {
      throw new Error(INVALID_PLAN);
    }
    const words = [...new Map((group as string[]).map((word) => [folded(word), word.trim()])).values()];
    if (!groups.some((other) => JSON.stringify(other.map(folded)) === JSON.stringify(words.map(folded)))) groups.push(words);
  }
  const types = raw.types == null ? RECORD_TYPES : raw.types;
  if (!Array.isArray(types) || !types.length || types.some((type) => !RECORD_TYPES.includes(type as QaRecordType))) throw new Error(INVALID_PLAN);
  const temporal = raw.temporal ?? "any";
  if (temporal !== "any" && temporal !== "past" && temporal !== "future") throw new Error(INVALID_PLAN);
  for (const field of ["startDate", "endDate"]) {
    if (raw[field] != null && !isQaDateKey(raw[field])) throw new Error(INVALID_PLAN);
  }
  const startDate = typeof raw.startDate === "string" ? raw.startDate : undefined;
  const endDate = typeof raw.endDate === "string" ? raw.endDate : undefined;
  if (startDate && endDate && startDate > endDate) throw new Error(INVALID_PLAN);
  const statuses = raw.statuses ?? [];
  if (!Array.isArray(statuses) || statuses.some((status) => !TASK_STATUSES.includes(status as TaskStatus))) throw new Error(INVALID_PLAN);

  // A model must not drop an ambiguous but literal clue such as 예산 or 분류.
  for (const clue of protectedQuestionClues(question)) {
    const family = ALIASES.find((aliases) => aliases.some((alias) => folded(alias) === folded(clue))) ?? [clue];
    if (!groups.some((group) => group.some((word) => family.some((alias) => folded(word).includes(folded(alias)))))) {
      groups.push(family);
    }
  }
  if (!groups.length && !startDate && !endDate && !statuses.length && temporal === "any") throw new Error(INVALID_PLAN);
  if (groups.length > 20) throw new Error(INVALID_PLAN);
  return { terms: groups, types: [...new Set(types)] as QaRecordType[], temporal, startDate, endDate, statuses: [...new Set(statuses)] as TaskStatus[] };
}

interface SearchDocument {
  type: QaRecordType;
  id: string;
  title: string;
  content: string;
  fields: Array<{ value: string; weight: number }>;
  task?: Task;
  note?: Note;
  eventDate?: string;
  endDate?: string;
  eventDateSource?: "explicit" | "linked";
  relatedTasks: Task[];
}

interface Match {
  document: SearchDocument;
  groups: number;
  score: number;
  words: string[];
  complete: boolean;
}

function explicitNoteDate(note: Note): string | undefined {
  // An unlabeled date in prose can be a deadline or a quoted document date. Require an event heading/label.
  const text = `${note.title}\n${note.content}`;
  const datePattern = /((?:19|20)\d{2})\s*[년.\-/]\s*(\d{1,2})\s*[월.\-/]\s*(\d{1,2})(?!\d)\s*일?/g;
  const dates: string[] = [];
  for (const match of text.matchAll(datePattern)) {
    const position = match.index ?? 0;
    const lineStart = text.lastIndexOf("\n", position) + 1;
    const lineEnd = text.indexOf("\n", position);
    const line = text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd);
    if (/(?:수정|업데이트|작성|제출|마감|기한|발행)/.test(line)) continue;
    const label = text.slice(lineStart, position).match(/(?:교육일|행사일|회의일|출장일|방문일|연수일|개최일|참석일|일시|일자)\s*[:：]?\s*$/);
    const eventTitle = lineStart === 0 && /(?:교육|행사|연수|회의|출장|방문)/.test(note.title);
    if (!label && !eventTitle) continue;
    const date = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
    if (isQaDateKey(date)) dates.push(date);
  }
  const unique = [...new Set(dates)];
  return unique.length === 1 ? unique[0] : undefined;
}

function taskPassesFilters(task: Task, plan: QaSearchPlan, today: string): boolean {
  if (plan.statuses.length && !plan.statuses.includes(task.status)) return false;
  const start = seoulDate(task.startAt);
  if (!start) return !plan.startDate && !plan.endDate && plan.temporal === "any";
  const suppliedEnd = seoulDate(task.endAt ?? task.startAt);
  const end = suppliedEnd && suppliedEnd >= start ? suppliedEnd : start;
  if (plan.startDate && end < plan.startDate) return false;
  if (plan.endDate && start > plan.endDate) return false;
  if (plan.temporal === "past" && start > today) return false;
  if (plan.temporal === "future" && end < today) return false;
  return true;
}

function passesFilters(document: SearchDocument, plan: QaSearchPlan, today: string): boolean {
  if (!plan.types.includes(document.type)) return false;
  if (document.task) return taskPassesFilters(document.task, plan, today);
  if (plan.statuses.length && !document.relatedTasks.some((task) => taskPassesFilters(task, plan, today))) return false;
  if (document.note && document.eventDateSource !== "explicit") {
    // Linked schedule dates are periods of related records, not proof of the note's event date.
    const compatible = document.relatedTasks.some((task) => taskPassesFilters(task, plan, today));
    if (plan.startDate || plan.endDate || plan.statuses.length || plan.temporal === "future") return compatible;
    if (plan.temporal === "past" && document.relatedTasks.length) return compatible;
    return true;
  }
  const date = document.eventDate;
  if (plan.startDate || plan.endDate) {
    if (!date || (plan.startDate && date < plan.startDate) || (plan.endDate && date > plan.endDate)) return false;
  }
  // Unknown event dates remain searchable for past-memory questions, without claiming when the event happened.
  if (date && plan.temporal === "past" && date > today) return false;
  if (plan.temporal === "future" && (!date || (document.endDate ?? date) < today)) return false;
  return true;
}

function matchDocument(document: SearchDocument, plan: QaSearchPlan): Match {
  const fields = document.fields.map((field) => ({ ...field, value: folded(field.value) }));
  const words: string[] = [];
  let groups = 0;
  let score = 0;
  for (const alternatives of plan.terms) {
    let weight = 0;
    for (const word of alternatives) {
      const found = fields.filter((field) => termPosition(field.value, folded(word)) >= 0);
      if (found.length) {
        words.push(word);
        weight = Math.max(weight, ...found.map((field) => field.weight));
      }
    }
    if (weight) { groups += 1; score += weight; }
  }
  const complete = groups === plan.terms.length;
  return { document, groups, score: score + (complete ? 10_000 : 0), words: [...new Set(words)], complete };
}

function termPosition(text: string, term: string, from = 0): number {
  const asciiWord = /^[a-z][a-z0-9]*$/.test(term);
  for (let position = text.indexOf(term, from); position >= 0; position = text.indexOf(term, position + 1)) {
    if (!asciiWord || (!/[a-z0-9]/.test(text[position - 1] ?? "") && !/[a-z0-9]/.test(text[position + term.length] ?? ""))) return position;
  }
  return -1;
}

function snippet(content: string, words: string[]): string {
  if (!content) return "";
  // Keep source characters intact. The snippet is an actual slice, not a generated summary.
  let haystack = "";
  const offsets: number[] = [];
  let originalOffset = 0;
  for (const character of content) {
    const normalized = character.normalize("NFKC").toLocaleLowerCase("ko-KR");
    for (const point of normalized) {
      const value = /\s/.test(point) ? " " : point;
      if (value === " " && haystack.endsWith(" ")) continue;
      haystack += value;
      for (let index = 0; index < value.length; index += 1) offsets.push(originalOffset);
    }
    originalOffset += character.length;
  }
  const hits: Array<{ word: string; position: number }> = [];
  for (const word of words) {
    const term = folded(word);
    let cursor = 0;
    for (let count = 0; count < 100; count += 1) {
      const position = termPosition(haystack, term, cursor);
      if (position < 0) break;
      hits.push({ word, position: offsets[position] });
      cursor = position + term.length;
    }
  }
  // Prefer a window containing several different clues over the first incidental mention.
  const positions = [...new Set(hits.map((hit) => hit.position))];
  let anchor = positions[0] ?? 0;
  let coverage = 0;
  for (const position of positions) {
    const count = new Set(hits.filter((hit) => hit.position >= position - 50 && hit.position < position + 190).map((hit) => hit.word)).size;
    if (count > coverage) { anchor = position; coverage = count; }
  }
  const start = Math.max(0, anchor - 50);
  const end = Math.min(content.length, start + 240);
  return `${start ? "…" : ""}${content.slice(start, end).trim()}${end < content.length ? "…" : ""}`;
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("검색이 취소되었습니다.", "AbortError");
}

/** Search all supplied records locally. Shared project descriptions are intentionally not search evidence. */
export function searchQaRecords(plan: QaSearchPlan, input: QaSearchInput): QaSearchRecord[] {
  assertNotAborted(input.signal);
  const today = seoulDate(input.now ?? new Date())!;
  const projectNames = new Map(input.projects.map((project) => [project.id, project.name]));
  const typeNames = new Map(input.taskTypes.map((type) => [type.id, type.name]));
  const subcategoryNames = new Map((input.subcategories ?? []).map((subcategory) => [subcategory.id, subcategory.name]));
  const tasksById = new Map(input.tasks.map((task) => [task.id, task]));
  const notesById = new Map(input.notes.map((note) => [note.id, note]));
  const noteTasks = new Map<string, Set<string>>();
  const taskNotes = new Map<string, Set<string>>();
  const connect = (taskId: string, noteId: string) => {
    if (!tasksById.has(taskId) || !notesById.has(noteId)) return;
    const tasks = noteTasks.get(noteId) ?? new Set<string>();
    tasks.add(taskId); noteTasks.set(noteId, tasks);
    const notes = taskNotes.get(taskId) ?? new Set<string>();
    notes.add(noteId); taskNotes.set(taskId, notes);
  };
  for (const task of input.tasks) for (const noteId of task.linkedNoteIds ?? []) connect(task.id, noteId);
  for (const note of input.notes) for (const taskId of note.linkedTaskIds ?? []) connect(taskId, note.id);

  const documents: SearchDocument[] = [];
  const seen = new Set<string>();
  const add = (document: SearchDocument) => {
    const key = `${document.type}:${document.id}`;
    if (!seen.has(key)) { seen.add(key); documents.push(document); }
  };
  for (const task of input.tasks) {
    const eventDate = seoulDate(task.startAt);
    const suppliedEnd = seoulDate(task.endAt ?? task.startAt);
    add({ type: "task", id: task.id, title: task.title, content: task.content, task, relatedTasks: [task],
      eventDate, endDate: suppliedEnd && eventDate && suppliedEnd >= eventDate ? suppliedEnd : eventDate,
      fields: [{ value: task.title, weight: 120 }, { value: task.content, weight: 70 },
        { value: typeNames.get(task.taskTypeId) ?? "", weight: 45 }, { value: projectNames.get(task.projectId) ?? "", weight: 40 }],
    });
  }
  for (const note of input.notes) {
    const relatedTasks = [...(noteTasks.get(note.id) ?? [])].map((id) => tasksById.get(id)!).filter(Boolean);
    const eligibleTasks = relatedTasks.filter((task) => taskPassesFilters(task, plan, today));
    const linkedRanges = new Map<string, { start: string; end: string }>();
    for (const task of eligibleTasks) {
      const start = seoulDate(task.startAt);
      if (!start) continue;
      const suppliedEnd = seoulDate(task.endAt ?? task.startAt);
      const end = suppliedEnd && suppliedEnd >= start ? suppliedEnd : start;
      linkedRanges.set(`${start}:${end}`, { start, end });
    }
    const explicitDate = explicitNoteDate(note);
    const linkedRange = linkedRanges.size === 1 ? [...linkedRanges.values()][0] : undefined;
    add({ type: "note", id: note.id, title: note.title, content: note.content, note, relatedTasks,
      eventDate: explicitDate ?? linkedRange?.start, endDate: explicitDate ?? linkedRange?.end,
      eventDateSource: explicitDate ? "explicit" : linkedRange ? "linked" : undefined,
      fields: [{ value: note.title, weight: 120 }, { value: note.content, weight: 70 }, { value: note.tags.join(" "), weight: 100 },
        { value: projectNames.get(note.projectId) ?? "", weight: 40 }, { value: subcategoryNames.get(note.subcategoryId ?? "") ?? "", weight: 45 }],
    });
  }
  for (const memo of input.memos ?? []) {
    add({ type: "memo", id: memo.id, title: `${memo.date} 메모`, content: memo.content, relatedTasks: [],
      eventDate: isQaDateKey(memo.date) ? memo.date : undefined, fields: [{ value: memo.content, weight: 70 }],
    });
  }

  const matches = new Map<string, Match>();
  const minimum = plan.terms.length <= 2 ? plan.terms.length : Math.ceil(plan.terms.length * 0.66);
  for (let index = 0; index < documents.length; index += 1) {
    if (index % 200 === 0) assertNotAborted(input.signal);
    const document = documents[index];
    if (!passesFilters(document, plan, today)) continue;
    const match = matchDocument(document, plan);
    if (match.groups >= minimum) matches.set(`${document.type}:${document.id}`, match);
  }

  // Include explicitly linked originals from either stored direction, after applying the same constraints.
  const documentsByKey = new Map(documents.map((document) => [`${document.type}:${document.id}`, document]));
  for (const match of [...matches.values()]) {
    if (!match.complete) continue;
    const linkedKeys = match.document.type === "task"
      ? [...(taskNotes.get(match.document.id) ?? [])].map((id) => `note:${id}`)
      : match.document.type === "note" ? [...(noteTasks.get(match.document.id) ?? [])].map((id) => `task:${id}`) : [];
    for (const key of linkedKeys) {
      if (matches.has(key)) continue;
      const document = documentsByKey.get(key);
      if (!document || !passesFilters(document, plan, today)) continue;
      const related = matchDocument(document, plan);
      related.score = Math.min(related.score, 9_000) + 500;
      matches.set(key, related);
    }
  }
  assertNotAborted(input.signal);
  return [...matches.values()].sort((left, right) =>
    right.score - left.score ||
    (plan.temporal === "future"
      ? (left.document.eventDate ?? "9999").localeCompare(right.document.eventDate ?? "9999")
      : (right.document.eventDate ?? "").localeCompare(left.document.eventDate ?? "")) ||
    left.document.title.localeCompare(right.document.title, "ko") || left.document.id.localeCompare(right.document.id),
  ).map(({ document, words }) => ({
    type: document.type, id: document.id, title: document.title,
    snippet: snippet(document.content, words), terms: words,
    ...(document.eventDate ? { eventDate: document.eventDate } : {}),
    ...(document.endDate && document.endDate !== document.eventDate ? { eventEndDate: document.endDate } : {}),
    ...(document.eventDateSource ? { eventDateSource: document.eventDateSource } : {}),
  }));
}
