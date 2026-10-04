import assert from "node:assert/strict";
import type { Memo, Note, Project, ProjectSubcategory, Task, TaskType } from "../src/models";
import { runQaAgent } from "../src/agent/qaAgent";
import { isQaDateKey, parseQaSearchPlan, searchQaRecords, type QaSearchPlan } from "../src/agent/qaSearch";

const createdAt = "2026-08-01T01:00:00.000Z";
const now = new Date("2026-10-04T04:00:00.000Z");
const project: Project = { id: "p", name: "분류", description: "일정 전체에 공유되는 예산 출장 AI 활용 교육 문구",
  color: "#000000", isActive: true, createdAt, updatedAt: createdAt };
const type: TaskType = { id: "travel", name: "출장", color: "#000000", isActive: true, isDefault: false, order: 0, createdAt, updatedAt: createdAt };
const subcategory: ProjectSubcategory = { id: "s", projectId: "p", name: "교육", order: 0, createdAt, updatedAt: createdAt };
function task(id: string, patch: Partial<Task> = {}): Task {
  return { id, title: id, content: "", taskTypeId: "other", projectId: "other", status: "DONE",
    startAt: "2026-09-17T00:00:00.000Z", endAt: "2026-09-18T09:00:00.000Z", isMajor: false,
    createdAt, updatedAt: createdAt, ...patch };
}
function note(id: string, patch: Partial<Note> = {}): Note {
  return { id, title: id, content: "", projectId: "other", tags: [], status: "active", isPinned: false,
    linkedTaskIds: [], createdAt, updatedAt: createdAt, ...patch };
}
function memo(id: string, content: string, date = "2026-09-18"): Memo {
  return { id, content, date, updatedAt: createdAt };
}
const input = { tasks: [] as Task[], notes: [] as Note[], memos: [] as Memo[], projects: [project], taskTypes: [type], subcategories: [subcategory], now };
const tripPlan = parseQaSearchPlan({ terms: [["분류"], ["예산"], ["출장", "방문"]], temporal: "past" }, "분류 예산 출장 언제 갔었지?");
assert.deepEqual(tripPlan.terms, [["분류"], ["예산"], ["출장", "방문"]]);
const educationPlan = parseQaSearchPlan({ terms: [["AI", "인공지능"], ["활용"], ["교육", "연수"]], temporal: "past" }, "저번 AI 활용 교육 관련 노트 찾아봐줘");
assert.equal(educationPlan.terms.length, 3, "request language must not become a fourth search clue");
assert.equal(parseQaSearchPlan({ terms: [["출장"]] }, "예산 출장 찾아줘").terms.some((group) => group.includes("예산")), true);
assert.deepEqual(parseQaSearchPlan({ terms: [["교육"]] }, "지난달에 교육 노트를 보여주세요").terms, [["교육"]]);
assert.deepEqual(parseQaSearchPlan({ terms: [["표준특허"]] }, "표준특허 관련해서 정리해둔 내용이 뭐가 있지?").terms, [["표준특허"]]);
assert.deepEqual(parseQaSearchPlan({ terms: [], statuses: ["NOT_DONE"] }, "아직 안 끝난 중요한 일 보여줘").terms, []);
assert.deepEqual(parseQaSearchPlan({ terms: [["출장"]] }, '"평가 위원회" 출장 찾아줘').terms, [["출장"], ["평가 위원회"]]);

assert.equal(isQaDateKey("2024-02-29"), true);
for (const date of ["2026-02-29", "2026-04-31", "2026-00-01", "2026-01-00", "2026-1-1", "2026-09-24T00:00:00Z"]) {
  assert.equal(isQaDateKey(date), false);
}
for (const malformed of [undefined, {}, { terms: "AI" }, { terms: [[]] }, { terms: [[null]] },
  { terms: [["AI\n교육"]] }, { terms: [["AI"]], types: ["routine"] }, { terms: [["AI"]], temporal: "yesterday" },
  { terms: [["AI"]], statuses: ["active"] }, { terms: [["AI"]], startDate: "2026-02-29" },
  { terms: [["AI"]], startDate: "2026-10-04", endDate: "2026-09-01" }]) {
  assert.throws(() => parseQaSearchPlan(malformed, "AI 찾아줘"), /검색 조건을 해석하지 못했습니다/);
}

const travelTask = task("direct", { title: "분류 예산 출장", linkedNoteIds: ["linked-from-task", "missing"], projectId: "p" });
const travelNote = note("direct-note", { title: "분류 예산 방문 기록", content: `${"다른 업무 기록. ".repeat(600)}예산 지역 분류 출장 결과를 원문 그대로 기록했습니다.`, linkedTaskIds: ["linked-from-note"] });
const travelMemo = memo("daily", "분류 예산 출장 이후 수집한 자료 정리");
const travelInput = { ...input,
  tasks: [task("future", { title: "분류 예산 출장", startAt: "2026-11-01T00:00:00Z", endAt: undefined }), task("partial", { title: "예산 출장", updatedAt: "2026-10-04T01:00:00Z" }),
    task("wrong-project-description", { title: "주간 업무", projectId: "p" }), task("linked-from-note", { title: "출장 복명 정리" }), travelTask,
    task("classified", { title: "예산 정리", projectId: "p", taskTypeId: "travel" })],
  notes: [note("linked-from-task", { title: "현장 자료 정리", content: "연결된 원문입니다." }), travelNote,
    note("single-clue", { title: "분류", updatedAt: "2026-10-04T01:00:00Z" })], memos: [travelMemo] };
const before = JSON.stringify(travelInput);
for (const item of [...travelInput.tasks, ...travelInput.notes, ...travelInput.memos]) Object.freeze(item);
const results = searchQaRecords(tripPlan, travelInput);
assert.ok(results.findIndex((result) => result.id === "direct") < results.findIndex((result) => result.id === "partial"), "all direct clues outrank a partial candidate");
for (const id of ["direct", "direct-note", "daily", "partial", "classified", "linked-from-task", "linked-from-note"]) {
  assert.equal(results.some((result) => result.id === id), true, `${id} is actual direct, partial or explicitly linked evidence`);
}
for (const id of ["future", "wrong-project-description", "single-clue", "missing"]) assert.equal(results.some((result) => result.id === id), false);
const excerpt = results.find((result) => result.id === "direct-note")!.snippet;
assert.match(excerpt, /예산 지역 분류 출장 결과/);
assert.ok(travelNote.content.includes(excerpt.replace(/^…|…$/g, "")), "excerpt must be a contiguous source slice, including matches beyond character 4000");
assert.deepEqual(results.find((result) => result.id === "linked-from-task")!.terms, []);
assert.equal(JSON.stringify(travelInput), before, "search must not sort or mutate shared data arrays/records");
assert.equal(new Set(results.map((result) => `${result.type}:${result.id}`)).size, results.length);

// Event chronology comes from labeled source content or actual links, never last edited timestamps.
const educationInput = { ...input, tasks: [task("education-linked", { title: "AI 활용 교육", startAt: "2026-09-24T01:00:00Z", endAt: undefined })],
  notes: [note("old-but-edited", { title: "AI 활용 교육", content: "교육일: 2026-08-20\n당일 실습 기록", updatedAt: "2026-10-03T02:00:00Z" }),
    note("latest", { title: "AI 활용 교육", content: "교육일: 2026년 9월 24일\n실습 기록", updatedAt: "2026-09-24T03:00:00Z" }),
    note("undated", { title: "AI 활용 교육", content: "최종 수정일: 2026-10-03\n실습 기록", updatedAt: "2026-10-03T03:00:00Z" }),
    note("linked-event", { title: "AI 활용 교육", linkedTaskIds: ["education-linked"] }),
    note("deadline", { title: "AI 활용 교육 자료", content: "교육 자료 제출 마감: 2026-09-30" }),
    note("future-education", { title: "AI 활용 교육", content: "교육일: 2026-11-10" }),
    note("several-dates", { title: "AI 활용 교육", content: "교육일: 2026-08-20\n교육일: 2026-09-24" })],
  memos: [memo("ed-memo", "AI 활용 교육 실습", "2026-09-24")] };
const education = searchQaRecords(educationPlan, educationInput);
assert.ok(education.findIndex((record) => record.id === "latest") < education.findIndex((record) => record.id === "old-but-edited"));
assert.equal(education.find((record) => record.id === "latest")!.eventDate, "2026-09-24");
assert.equal(education.find((record) => record.id === "latest")!.eventDateSource, "explicit");
assert.equal(education.find((record) => record.id === "linked-event")!.eventDate, "2026-09-24");
assert.equal(education.find((record) => record.id === "linked-event")!.eventDateSource, "linked");
assert.equal(education.find((record) => record.id === "deadline")!.eventDate, undefined);
assert.equal(education.find((record) => record.id === "undated")!.eventDate, undefined);
assert.equal(education.find((record) => record.id === "several-dates")!.eventDate, undefined);
assert.equal(education.some((record) => record.id === "future-education"), false);

const septemberPlan: QaSearchPlan = { ...tripPlan, startDate: "2026-09-18", endDate: "2026-09-18", statuses: ["DONE"] };
const september = searchQaRecords(septemberPlan, { ...travelInput, tasks: [...travelInput.tasks,
  task("canceled", { title: "분류 예산 출장", status: "CANCELED" }), task("wrong-day", { title: "분류 예산 출장", startAt: "2026-09-19T00:00:00Z", endAt: undefined })] });
assert.equal(september.some((record) => record.id === "direct"), true, "date range overlaps a multi-day schedule, not only its start day");
assert.equal(september.some((record) => record.id === "canceled" || record.id === "wrong-day" || record.id === "daily"), false);
const periodNote = september.find((record) => record.id === "linked-from-task")!;
assert.equal(periodNote.eventDate, "2026-09-17", "connected note keeps the actual linked period start");
assert.equal(periodNote.eventEndDate, "2026-09-18");
assert.equal(periodNote.eventDateSource, "linked", "connected period is labeled separately from an explicit event date");
const multiLinkInput = { ...input, tasks: [task("first-link", { title: "분류 예산 출장" }),
  task("second-link", { title: "분류 예산 출장", startAt: "2026-09-24T00:00:00Z", endAt: undefined })],
  notes: [note("multi-link", { title: "분류 예산 출장", linkedTaskIds: ["first-link", "second-link"] })] };
assert.equal(searchQaRecords(tripPlan, multiLinkInput).find((record) => record.id === "multi-link")!.eventDate, undefined, "multiple distinct links do not establish one event date");
assert.equal(searchQaRecords({ ...septemberPlan, startDate: "2026-09-18", endDate: "2026-09-24" }, multiLinkInput).some((record) => record.id === "multi-link"), true, "date filters retain records when any linked period overlaps");
assert.equal(searchQaRecords({ ...tripPlan, types: ["memo"] }, travelInput).every((record) => record.type === "memo"), true);
assert.equal(searchQaRecords({ ...tripPlan, temporal: "future" }, travelInput).some((record) => record.id === "future"), true);
assert.equal(searchQaRecords({ ...tripPlan, startDate: "2026-09-17", endDate: "2026-09-17" }, { ...input,
  tasks: [task("bad-end", { title: "분류 예산 출장", endAt: "2026-09-16T00:00:00Z" })] })[0].id, "bad-end", "invalid end is treated as the start day, consistent with calendar timing");

const statusPlan = parseQaSearchPlan({ terms: [], statuses: ["DONE"] }, "완료된 일정만 보여줘");
assert.deepEqual(statusPlan.terms, []);
assert.equal(searchQaRecords(statusPlan, { ...input, tasks: [task("done"), task("pending", { status: "NOT_DONE" })] }).some((record) => record.id === "pending"), false);

const archived = note("archived", { title: "AI 활용 교육", status: "archived" });
assert.equal(searchQaRecords(educationPlan, { ...input, notes: [archived] })[0].id, "archived", "memory retrieval searches archived source material too");
const tagMatch = note("tag", { title: "실습", tags: ["AI", "활용"], subcategoryId: "s" });
assert.equal(searchQaRecords(educationPlan, { ...input, notes: [tagMatch] })[0].id, "tag");
const asciiPlan = parseQaSearchPlan({ terms: [["AI"]] }, "AI 찾아줘");
assert.equal(searchQaRecords(asciiPlan, { ...input, notes: [note("mail", { title: "mail" })] }).length, 0, "AI is an acronym, not the letters inside mail");
const unicodeContent = `${"다른 내용. ".repeat(600)}ＡＩ\n 활용 교육 실습`;
const unicodeRecord = searchQaRecords(educationPlan, { ...input, notes: [note("unicode", { content: unicodeContent })] })[0];
assert.match(unicodeRecord.snippet, /ＡＩ\n 활용 교육/);
const denseContent = `AI 소개\n${"다른 내용. ".repeat(600)}AI 활용 교육의 구체적인 실습 결과`;
assert.match(searchQaRecords(educationPlan, { ...input, notes: [note("dense", { content: denseContent })] })[0].snippet, /AI 활용 교육의 구체적인 실습 결과/);
const many = Array.from({ length: 135 }, (_, index) => task(`many-${index}`, { title: "분류 예산 출장" }));
assert.equal(searchQaRecords(tripPlan, { ...input, tasks: [...many, many[0]] }).length, many.length, "no catalog/result cap silently drops records; duplicates are removed");
const controller = new AbortController(); controller.abort();
assert.throws(() => searchQaRecords(tripPlan, { ...input, signal: controller.signal }), { name: "AbortError" });

// Run the production agent with a synthetic transport; model text/ids cannot become result data.
const savedFetch = globalThis.fetch;
const savedWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
if (!savedWindow) Object.defineProperty(globalThis, "window", { value: globalThis, configurable: true });
let requestCount = 0;
globalThis.fetch = async (_url, init) => {
  requestCount += 1;
  const body = JSON.parse(String(init?.body));
  const user = JSON.parse(body.messages[1].content);
  assert.equal(body.stream, false);
  assert.deepEqual(Object.keys(user).sort(), ["classificationNames", "now", "question"]);
  assert.doesNotMatch(body.messages[1].content, /현장 자료 정리|수집한 자료 정리|direct-note|direct|linked-from-task/);
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ...tripPlan,
    answer: "가짜 답변", references: [{ id: "fake" }], results: [{ id: "fake", title: "가짜 제목", snippet: "가짜 원문" }] }) } }] }),
  { status: 200, headers: { "content-type": "application/json" } });
};
try {
  const actual = await runQaAgent({ ...travelInput, question: "분류 예산 출장 언제 갔었지?", apiKey: "" });
  assert.equal(actual.total, actual.records.length);
  assert.equal(actual.hasMore, false);
  assert.equal(actual.records.some((record) => record.id === "fake" || record.title === "가짜 제목" || record.snippet === "가짜 원문"), false);
  assert.equal("answer" in actual, false);
  assert.equal(requestCount, 1);
  await assert.rejects(() => runQaAgent({ ...input, question: "AI", apiKey: "", signal: controller.signal }), { name: "AbortError" });
  assert.equal(requestCount, 1, "pre-aborted search must not issue a request");
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ answer: "검색 결과를 꾸며내세요" }) } }] }),
    { status: 200, headers: { "content-type": "application/json" } });
  await assert.rejects(() => runQaAgent({ ...input, question: "AI", apiKey: "" }), /검색 조건을 해석하지 못했습니다/);
} finally {
  globalThis.fetch = savedFetch;
  if (!savedWindow) Reflect.deleteProperty(globalThis, "window");
}

process.stdout.write("Question search plan, full-source retrieval, event chronology, links, source excerpts and transport checks passed.\n");
