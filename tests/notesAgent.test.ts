import assert from "node:assert/strict";
import { classifyNoteWithAi, runNotesAgent, type RunNotesAgentInput } from "../src/agent/notesAgent";
import { DEFAULT_LLM_CHAT_COMPLETIONS_URL, LLM_MAX_TOTAL_PROMPT_CHARS } from "../src/constants";
import type { Project, ProjectSubcategory } from "../src/models";

const originalFetch = globalThis.fetch;
const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });

type SentPayload = { userRequest: string; targetNotes?: Array<{ id: string; title: string; content: string }>; [key: string]: unknown };
const requests: SentPayload[] = [];
const base: RunNotesAgentInput = {
  mode: "summarize",
  userMessage: "모든 내용을 요약해줘",
  notes: [], tasks: [], projects: [], taskTypes: [],
  endpoint: DEFAULT_LLM_CHAT_COMPLETIONS_URL,
  apiKey: "test-key",
};
function mockResponder(reply: (payload: SentPayload, index: number) => Record<string, unknown>): void {
  requests.length = 0;
  globalThis.fetch = (async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
    // 이스케이프된 JSON 문자열과 시스템 프롬프트도 실제 LLM 한도에 포함한다.
    assert.ok(body.messages.reduce((sum, message) => sum + message.content.length, 0) <= LLM_MAX_TOTAL_PROMPT_CHARS);
    const payload = JSON.parse(body.messages[1].content) as SentPayload;
    requests.push(payload);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply(payload, requests.length)) } }] }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

try {
  const beyondOldLimit = `${"원문 ".repeat(5_000)}끝부분의 중요한 결정`;
  mockResponder(() => ({ assistantMessage: "완료", proposedContent: "전체 요약", proposedTitle: "요약" }));
  const directResult = await runNotesAgent({ ...base, targetNotes: [{ id: "note-long", title: "긴 노트", content: beyondOldLimit }] });
  assert.equal(directResult.proposedContent, "전체 요약");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].targetNotes?.[0].content, beyondOldLimit);
  assert.ok(requests[0].targetNotes?.[0].content.endsWith("끝부분의 중요한 결정"));

  const tail = "끝부분의 최종 결정";
  const escapedText = 'A😀\n"\\'.repeat(83_000);
  const fullNote = escapedText + "끝".repeat(500_000 - escapedText.length - tail.length) + tail;
  assert.equal(fullNote.length, 500_000);
  const progressLabels: string[] = [];
  mockResponder((_payload, index) => ({ assistantMessage: "완료", proposedContent: `요약 ${index}`, proposedTitle: "전체 요약" }));
  const chunkedResult = await runNotesAgent({
    ...base,
    targetNotes: [{ id: "note-500k", title: "500k 노트", content: fullNote }],
    onProgress: (progress) => progressLabels.push(progress.label),
  });
  const partRequests = requests.filter((request) => request.targetNotes?.[0]?.id === "note-500k");
  assert.ok(partRequests.length > 1);
  assert.equal(partRequests.flatMap((request) => request.targetNotes ?? []).map((note) => note.content).join(""), fullNote);
  for (const request of partRequests) {
    for (const note of request.targetNotes ?? []) {
      assert.equal(/[\uD800-\uDBFF]$/.test(note.content), false, "분할 끝에서 서로게이트 쌍을 끊지 않아야 한다.");
      assert.equal(/^[\uDC00-\uDFFF]/.test(note.content), false, "분할 시작에서 서로게이트 쌍을 끊지 않아야 한다.");
    }
  }
  assert.ok(requests.at(-1)?.targetNotes?.every((note) => note.id.startsWith("summary-")));
  assert.ok(chunkedResult.proposedContent);
  assert.match(chunkedResult.trace ?? "", /전체 요약 후 통합/);
  assert.ok(progressLabels.includes("전체 구간 요약 통합 중"));

  mockResponder(() => ({ proposedContent: "호출하면 안 됨" }));
  await assert.rejects(runNotesAgent({ ...base, mode: "merge", targetNotes: [{ id: "note-500k", title: "긴 노트", content: fullNote }] }), /통합 요청이 AI 입력 한도.*잘라 보내지 않았습니다/);
  assert.equal(requests.length, 0, "긴 통합 요청은 원문 손실 없이 명확히 거부한다.");
  await assert.rejects(runNotesAgent({ ...base, mode: "edit", activeNote: { id: "note-500k", title: "긴 노트", content: fullNote, projectId: "p" } }), /편집 요청이 AI 입력 한도/);
  assert.equal(requests.length, 0);

  mockResponder((_payload, index) => ({ proposedContent: index === 2 ? "" : "부분 요약" }));
  await assert.rejects(runNotesAgent({ ...base, targetNotes: [{ id: "note-500k", title: "긴 노트", content: fullNote }] }), /2번째 구간.*전체 요약을 저장하지 않았습니다/);
  assert.equal(requests.length, 2, "구간 실패 후 불완전한 통합 결과를 생성하지 않는다.");

  const abortController = new AbortController();
  mockResponder(() => { abortController.abort(); return { proposedContent: "부분 요약" }; });
  await assert.rejects(runNotesAgent({ ...base, signal: abortController.signal, targetNotes: [{ id: "note-500k", title: "긴 노트", content: fullNote }] }), (error: unknown) => error instanceof Error && error.name === "AbortError");
  assert.equal(requests.length, 1, "취소 후 다음 구간을 요청하지 않는다.");

  mockResponder(() => ({ proposedContent: "호출하면 안 됨" }));
  await assert.rejects(runNotesAgent({ ...base, userMessage: "요".repeat(LLM_MAX_TOTAL_PROMPT_CHARS), targetNotes: [] }), /요약 요청문.*한도/);
  assert.equal(requests.length, 0);

  mockResponder(() => ({ assistantMessage: "선택 삭제", replacementText: "" }));
  const deleteSelection = await runNotesAgent({ ...base, mode: "inline_edit", selectedText: "삭제할 문장" });
  assert.equal(deleteSelection.replacementText, "");
  mockResponder(() => ({ replacementText: " 앞뒤 공백 " }));
  const whitespaceSelection = await runNotesAgent({ ...base, mode: "inline_edit", selectedText: "문장" });
  assert.equal(whitespaceSelection.replacementText, " 앞뒤 공백 ");

  const project = (id: string, isActive: boolean): Project => ({ id, name: id, color: "#2563eb", isActive, createdAt: "2026-10-05T00:00:00Z", updatedAt: "2026-10-05T00:00:00Z" });
  const subcategory = (id: string, projectId: string): ProjectSubcategory => ({ id, projectId, name: id, order: 0, createdAt: "2026-10-05T00:00:00Z", updatedAt: "2026-10-05T00:00:00Z" });
  mockResponder((payload) => {
    assert.deepEqual((payload.availableSubcategories as Array<{ id: string }>).map((sub) => sub.id), ["sub-current", "sub-other"]);
    return { projectId: "project-other", subcategoryId: "sub-other", confidence: "high", reason: "다른 프로젝트의 세부 항목에 해당" };
  });
  const classification = await classifyNoteWithAi({
    note: { id: "note-classify", title: "분류 대상", content: "다른 프로젝트의 내용", projectId: "project-current" },
    projects: [project("project-current", true), project("project-other", true), project("project-archived", false)],
    subcategories: [subcategory("sub-current", "project-current"), subcategory("sub-other", "project-other"), subcategory("sub-archived", "project-archived")],
    endpoint: DEFAULT_LLM_CHAT_COMPLETIONS_URL, apiKey: "test-key",
  });
  assert.equal(classification.projectId, "project-other");
  assert.equal(classification.subcategoryId, "sub-other");
} finally {
  globalThis.fetch = originalFetch;
  if (originalWindowDescriptor) Object.defineProperty(globalThis, "window", originalWindowDescriptor);
  else Reflect.deleteProperty(globalThis, "window");
}

process.stdout.write("Notes agent full-source, chunked summary, classification, and cancellation checks passed.\n");
