import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";

// Isolated synthetic fixture only. Every remote request is intercepted; no real API,
// browser profile, user record, credential, or model response is printed or saved.
const now = "2026-10-04T09:00:00+09:00";
const nowIso = new Date(now).toISOString();
const artifactDirectory = "artifacts/question-search-implementation-2026-10-04";
const fileUrl = pathToFileURL(path.resolve("dist-web/planai.html")).href;
const tripQuestion = "분류 예산 출장 언제 갔었지?";
const educationQuestion = "저번 AI 활용 교육 관련 노트 찾아봐줘";
const fakeModelText = "MODEL_INVENTED_ANSWER_MUST_NOT_RENDER";
const privateBodyMarker = "SYNTHETIC_LOCAL_BODY_MUST_NOT_BE_SENT";
const projects = [{ id: "qa-project", name: "합성 검증 프로젝트", color: "#7354bd", isActive: true, order: 0, createdAt: nowIso, updatedAt: nowIso }];
const taskTypes = [{ id: "qa-type", name: "합성 검증 일정", color: "#7354bd", isDefault: false, isActive: true, order: 0, createdAt: nowIso, updatedAt: nowIso }];
function task(id, title, content, date, endDate = date) {
  return { id, title, content, projectId: "qa-project", taskTypeId: "qa-type", status: "DONE", startAt: new Date(`${date}T09:00:00+09:00`).toISOString(), endAt: new Date(`${endDate}T17:00:00+09:00`).toISOString(), completedAt: new Date(`${endDate}T18:00:00+09:00`).toISOString(), isMajor: false, createdAt: nowIso, updatedAt: nowIso };
}
function note(id, title, content, updatedAt) {
  return { id, title, content, projectId: "qa-project", tags: [], status: "active", isPinned: false, linkedTaskIds: id.startsWith("qa-education-") ? ["qa-education-task"] : id === "qa-trip-note" ? ["qa-trip-task"] : [], createdAt: new Date("2026-09-01T09:00:00+09:00").toISOString(), updatedAt: new Date(updatedAt).toISOString() };
}
const tasks = [
  task("qa-trip-task", "분류 자료 확인 · 예산 출장", `분류 자료를 확인하기 위해 예산 현장에 출장한다. ${privateBodyMarker}`, "2026-09-17", "2026-09-18"),
  task("qa-education-task", "AI 활용 교육 일정", `AI 활용 교육에서 회의록 정리와 문서 요약을 실습한다. ${privateBodyMarker}`, "2026-09-24"),
  task("qa-unrelated-task", "무관한 대조 일정", "이 일정은 검색 조건과 일치하지 않는다.", "2026-09-22"),
];
const notes = [
  note("qa-trip-note", "예산 출장 후 분류 자료 정리", `9월 17일 예산 출장에서 분류 자료를 확인했다. 9월 18일 복귀했다. ${privateBodyMarker}`, "2026-09-19T09:00:00+09:00"),
  note("qa-education-note", "AI 활용 교육 — 실습 정리", `AI 활용 교육에서 회의록의 결정사항과 할 일을 구분하는 실습을 했다. ${privateBodyMarker}`, "2026-10-02T09:00:00+09:00"),
  note("qa-education-qa", "AI 활용 교육 — 질문 메모", `AI 활용 교육 질문: 목적과 결과 형식을 먼저 정하고 원문을 확인한다. ${privateBodyMarker}`, "2026-09-25T09:00:00+09:00"),
];
const archivedNote = { ...note("qa-archived-note", "보관 이동 검증 노트", `보관 이동 검증을 위한 실제 원문 내용이다. ${privateBodyMarker}`, now), status: "archived" };
const memos = [
  { id: "2026-09-18", date: "2026-09-18", content: `예산 출장에서 분류 자료 확인을 마쳤다. ${privateBodyMarker}`, updatedAt: new Date("2026-09-18T18:00:00+09:00").toISOString() },
  { id: "2026-09-24", date: "2026-09-24", content: `AI 활용 교육 실습을 마치고 질문을 정리했다. ${privateBodyMarker}`, updatedAt: new Date("2026-09-24T18:00:00+09:00").toISOString() },
];
const expectedIds = {
  trip: ["task:qa-trip-task", "note:qa-trip-note", "memo:2026-09-18"],
  education: ["task:qa-education-task", "note:qa-education-note", "note:qa-education-qa", "memo:2026-09-24"],
};
const plans = {
  trip: { terms: [["분류"], ["예산"], ["출장", "방문"]], types: ["task", "note", "memo"], temporal: "past" },
  education: { terms: [["AI", "인공지능"], ["활용"], ["교육", "강의"]], types: ["task", "note", "memo"], temporal: "past" },
  empty: { terms: [["절대로일치하지않는합성검색어"]], types: ["task", "note", "memo"], temporal: "any" },
  deletion: { terms: [["고유삭제항목"]], types: ["note"], temporal: "any" },
  archived: { terms: [["보관"], ["이동"], ["검증"]], types: ["note"], temporal: "any" },
};
const seededRecords = [...tasks, ...notes, ...memos, archivedNote];
const sorted = values => [...values].sort();
const report = { fixture: "synthetic-only", checks: [], runtimeErrors: [], mockedRequests: 0, abortedRequests: 0, screenshots: [] };
const pass = (name, detail) => report.checks.push({ name, passed: true, detail });
let mode = "trip";
let calls = 0;
let aborted = 0;
let releaseHeldRequest;
let requestPrivacyViolation = false;
let unmockedRequests = 0;

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1024, height: 900 }, timezoneId: "Asia/Seoul" });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date(now));
  page.on("pageerror", error => report.runtimeErrors.push(error.message));
  page.on("requestfailed", request => { if (request.url().endsWith("/chat/completions")) aborted += 1; });
  await context.route(/^https?:/, async route => {
    const request = route.request();
    if (!request.url().endsWith("/chat/completions") || request.method() !== "POST") {
      unmockedRequests += 1;
      await route.abort();
      return;
    }
    calls += 1;
    const body = request.postData() ?? "";
    if (body.includes(privateBodyMarker) || seededRecords.some(record => body.includes(record.id) || (record.title && body.includes(record.title)))) requestPrivacyViolation = true;
    if (mode === "error") {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { message: "synthetic unavailable" } }) });
      return;
    }
    if (mode === "hold") await new Promise(resolve => { releaseHeldRequest = resolve; });
    const plan = plans[mode] ?? plans.trip;
    const content = { ...plan, answer: fakeModelText, references: [{ type: "note", id: "model-fake-id", title: "MODEL_FAKE_TITLE_MUST_NOT_RENDER" }], results: [{ id: "model-fake-result", title: "MODEL_FAKE_RESULT_MUST_NOT_RENDER" }] };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }) }).catch(() => {});
  });
  await page.goto(`${fileUrl}#/dashboard`);
  await expect(page.getByRole("button", { name: "내 데이터에 질문", exact: true })).toBeVisible();
  await page.evaluate(async seed => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("schedule-manager-db");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise((resolve, reject) => {
        const tables = ["tasks", "notes", "memos", "projects", "taskTypes", "settings"];
        const transaction = db.transaction(tables, "readwrite");
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error ?? new Error("Synthetic fixture aborted"));
        for (const table of tables.filter(table => table !== "settings")) {
          const store = transaction.objectStore(table);
          store.clear();
          seed[table].forEach(record => store.put(record));
        }
        const settings = transaction.objectStore("settings");
        const current = settings.get("default");
        current.onsuccess = () => settings.put({ ...current.result, id: "default", llmModel: "synthetic-qa-test", rememberLlmApiKey: false, autoBackupEnabled: false, notificationsEnabled: false, noteTaskSuggestionsEnabled: false, relatedNoteSuggestionsEnabled: false, showPastCompleted: true, updatedAt: seed.nowIso });
      });
    } finally { db.close(); }
  }, { tasks, notes, memos, projects, taskTypes, nowIso });
  await page.reload();
  const trigger = page.getByRole("button", { name: "내 데이터에 질문", exact: true });
  const dialog = page.getByRole("dialog", { name: "기록 검색", exact: true });
  const list = dialog.getByRole("list", { name: "검색된 일정과 메모", exact: true });
  const original = dialog.getByRole("complementary", { name: "선택한 원문", exact: true });
  const input = dialog.getByLabel("질문", { exact: true });
  async function settleLayout() {
    await dialog.evaluate(async element => {
      await new Promise(resolve => requestAnimationFrame(resolve));
      const finiteAnimations = element.getAnimations({ subtree: true }).filter(animation => animation.effect?.getTiming().iterations !== Infinity);
      await Promise.allSettled(finiteAnimations.map(animation => animation.finished));
    });
  }
  async function modalWidth() { return (await dialog.boundingBox()).width; }
  async function openSearch() { await trigger.click(); await expect(dialog).toBeVisible(); await expect(input).toBeFocused(); }
  async function search(scenario, question = scenario === "education" ? educationQuestion : tripQuestion, keyboard = false, expected = expectedIds[scenario]) {
    mode = scenario;
    await input.fill(question);
    if (keyboard) await input.press("Enter");
    else await dialog.getByRole("button", { name: "검색", exact: true }).click();
    if (expected) await expect.poll(async () => sorted(await list.locator("[data-qa-record]").evaluateAll(rows => rows.map(row => row.dataset.qaRecord)))).toEqual(sorted(expected));
  }
  await mkdir(artifactDirectory, { recursive: true });
  await openSearch();
  await settleLayout();
  const compactWidth = await modalWidth();
  await expect(dialog.locator(".ask-examples")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: tripQuestion, exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: educationQuestion, exact: true })).toHaveCount(0);
  await search("trip");
  await expect(list).toBeVisible();
  await settleLayout();
  const resultWidth = await modalWidth();
  expect(resultWidth).toBeGreaterThan(compactWidth);
  await expect(input).toBeVisible();
  pass("compact to result expansion", "The initial question panel has a smaller footprint; a completed search visibly expands it while retaining the input and actual result list");
  await expect(dialog).not.toContainText(fakeModelText);
  await expect(dialog).not.toContainText("MODEL_FAKE_TITLE_MUST_NOT_RENDER");
  await expect(dialog).not.toContainText("MODEL_FAKE_RESULT_MUST_NOT_RENDER");
  await expect(dialog.locator(".ask-references, .ai-trace-line")).toHaveCount(0);
  await expect(list).toContainText("분류 자료 확인 · 예산 출장");
  await expect(list).toContainText("9월 17일 예산 출장에서 분류 자료를 확인했다.");
  await expect(list).toContainText("2026");
  await dialog.screenshot({ path: path.join(artifactDirectory, "desktop-trip.png") });
  report.screenshots.push("desktop-trip.png");
  pass("mixed local result list", "Trip query returns task, note and daily memo from local records; real dates/snippets displayed; model answer/id/title/result and previous summary UI absent");
  for (const id of expectedIds.trip) {
    const row = list.locator(`[data-qa-record="${id}"]`);
    await row.click();
    await expect(original).toBeVisible();
    await settleLayout();
    expect(await modalWidth()).toBeGreaterThan(resultWidth);
    const sourceControlsFit = await dialog.getByRole("button", { name: "원문 닫기", exact: true }).evaluate(button => {
      const bounds = button.getBoundingClientRect();
      const modal = button.closest('[role="dialog"]').getBoundingClientRect();
      return { viewportWidth: innerWidth, modalLeft: modal.left, modalRight: modal.right, buttonLeft: bounds.left, buttonRight: bounds.right, fit: bounds.left >= -1 && bounds.right <= innerWidth + 1 };
    });
    if (!sourceControlsFit.fit) {
      await writeFile(path.join(artifactDirectory, "source-layout.json"), JSON.stringify(sourceControlsFit, null, 2));
      await page.screenshot({ path: path.join(artifactDirectory, "source-layout.png") });
    }
    expect(sourceControlsFit.fit).toBe(true);
    await expect(list.locator("[data-qa-record]")).toHaveCount(3);
    const recordId = id.slice(id.indexOf(":") + 1);
    const record = seededRecords.find(record => record.id === recordId);
    await expect(original).toContainText(record.content.split(privateBodyMarker)[0].trim());
    await dialog.getByRole("button", { name: "원문 닫기", exact: true }).click();
    await expect(original).toHaveCount(0);
    await expect(row).toBeFocused();
    await settleLayout();
    expect(Math.abs(await modalWidth() - resultWidth)).toBeLessThanOrEqual(1);
  }
  pass("original and focus", "All trip record types open source in the dialog while preserving the list; closing original restores selected row focus");
  pass("original expansion and return", "Source selection gives the list and original more horizontal room; closing it returns to the results footprint after motion finishes");
  await search("education", educationQuestion, true);
  await expect(list.locator("[data-qa-record]")).toHaveCount(4);
  await expect(list).toContainText("AI 활용 교육 — 실습 정리");
  await expect(list).toContainText("실습");
  await expect(list.locator('[data-qa-record="note:qa-education-note"]')).toContainText(/연결 일정\s*2026\.09\.24/);
  await expect(list.locator('[data-qa-record="note:qa-education-note"]')).toContainText("수정 2026.10.02");
  await dialog.screenshot({ path: path.join(artifactDirectory, "desktop-education.png") });
  report.screenshots.push("desktop-education.png");
  pass("education and Enter", "Enter submits education query and returns one task, two notes and a daily memo");
  const beforeIme = calls;
  await input.fill(tripQuestion);
  await input.dispatchEvent("compositionstart");
  await input.dispatchEvent("keydown", { key: "Enter", code: "Enter", keyCode: 229, isComposing: true });
  await page.waitForTimeout(100);
  expect(calls).toBe(beforeIme);
  await input.dispatchEvent("compositionend");
  pass("IME", "Korean composition Enter does not send a search request");
  await search("empty", "없는 합성 기록 찾아줘");
  await expect(list.locator("[data-qa-record]")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "검색", exact: true })).toBeEnabled();
  pass("empty result", "No matching records produces zero rows and leaves search available");
  await search("error");
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "검색", exact: true })).toBeEnabled();
  pass("API error", "Synthetic API failure displays error and re-enables search");
  await search("trip");
  for (const width of [1024, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const scenario of ["trip", "education"]) {
      await search(scenario);
      await list.locator("[data-qa-record]").first().click();
      const layout = await dialog.evaluate(element => {
        const bounds = element.getBoundingClientRect();
        return { documentOverflow: document.documentElement.scrollWidth > innerWidth + 1, dialogOverflow: element.scrollWidth > element.clientWidth + 1, outsideViewport: bounds.left < -1 || bounds.right > innerWidth + 1 };
      });
      expect(layout).toEqual({ documentOverflow: false, dialogOverflow: false, outsideViewport: false });
      await dialog.getByRole("button", { name: "원문 닫기", exact: true }).click();
    }
    pass(`responsive ${width}px`, "Both result lists with original open fit viewport without horizontal overflow");
  }
  await list.locator('[data-qa-record="note:qa-education-note"]').click();
  await dialog.screenshot({ path: path.join(artifactDirectory, "mobile-original.png") });
  report.screenshots.push("mobile-original.png");
  await dialog.getByRole("button", { name: "원문 닫기", exact: true }).click();
  await page.setViewportSize({ width: 1024, height: 900 });
  await settleLayout();
  mode = "hold";
  const beforeStop = calls;
  const beforeStopAbort = aborted;
  await input.fill(tripQuestion);
  await dialog.getByRole("button", { name: "검색", exact: true }).click();
  await expect.poll(() => calls).toBe(beforeStop + 1);
  await settleLayout();
  expect(Math.abs(await modalWidth() - resultWidth)).toBeLessThanOrEqual(1);
  await dialog.getByRole("button", { name: "중단", exact: true }).click();
  await expect(input).toBeFocused();
  await expect(dialog.getByRole("button", { name: "검색", exact: true })).toBeEnabled();
  await expect.poll(() => aborted).toBeGreaterThan(beforeStopAbort);
  await settleLayout();
  expect(Math.abs(await modalWidth() - resultWidth)).toBeLessThanOrEqual(1);
  mode = "trip";
  releaseHeldRequest?.();
  pass("explicit stop", "A repeat search and its cancellation keep the expanded footprint; Stop aborts the request without closing the dialog and restores input focus");
  await search("trip");
  mode = "hold";
  const beforeHold = calls;
  const beforeAbort = aborted;
  await input.fill(tripQuestion);
  await dialog.getByRole("button", { name: "검색", exact: true }).click();
  await expect.poll(() => calls).toBe(beforeHold + 1);
  await dialog.getByRole("button", { name: "닫기", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect.poll(() => aborted).toBeGreaterThan(beforeAbort);
  mode = "trip";
  releaseHeldRequest?.();
  await openSearch();
  await settleLayout();
  expect(Math.abs(await modalWidth() - compactWidth)).toBeLessThanOrEqual(1);
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await search("trip");
  pass("close abort and reopen", "Closing during search aborts the request and restores header focus; reopening starts compact and permits a fresh search without stale error/result");

  await page.setViewportSize({ width: 1024, height: 900 });
  const tripNote = notes.find(record => record.id === "qa-trip-note");
  const noteLinkName = `원본 노트 열기: ${tripNote.title}`;
  const noteLink = list.getByRole("link", { name: noteLinkName, exact: true });
  await expect(noteLink).toHaveAttribute("href", /\/notes\?noteId=qa-trip-note$/);
  await list.locator('[data-qa-record="note:qa-trip-note"]').focus();
  await page.keyboard.press("Tab");
  await expect(noteLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel("노트 제목", { exact: true })).toHaveValue(tripNote.title);
  await expect(page.getByLabel("노트 제목", { exact: true })).toBeFocused();
  await expect(page.locator(".note-read-view")).toContainText(tripNote.content);
  pass("note row navigation by keyboard", "Tab reaches the native note link; Enter closes search and opens the actual local note title/content with title focus");

  const noteSearch = page.getByLabel("노트 검색", { exact: true });
  await noteSearch.fill("현재노트와절대로일치하지않는검색");
  await expect(page.locator(".notes-list")).toContainText("노트가 없습니다.");
  await openSearch();
  await search("trip");
  await list.getByRole("link", { name: noteLinkName, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(noteSearch).toHaveValue("");
  await expect(page.getByLabel("노트 제목", { exact: true })).toHaveValue(tripNote.title);
  await expect(page.getByLabel("노트 제목", { exact: true })).toBeFocused();
  await expect(page.locator(".note-read-view")).toContainText(tripNote.content);
  await expect(page.locator(".notes-list")).toContainText(tripNote.title);
  pass("same notes page clears search", "Opening the same source note from search clears a mismatching notes filter before selecting the real note");

  await openSearch();
  await search("trip");
  await list.getByRole("link", { name: noteLinkName, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel("노트 제목", { exact: true })).toBeFocused();
  pass("selected note restores focus", "Opening an already selected note again restores its title focus without relying on a selection change");

  await openSearch();
  await search("trip");
  await list.locator('[data-qa-record="task:qa-trip-task"]').click();
  const taskLink = original.getByRole("link", { name: "일정 열기", exact: true });
  const taskTarget = new URL((await taskLink.getAttribute("href")).replace(/^#/, ""), "https://synthetic.invalid");
  expect(taskTarget.pathname).toBe("/dashboard");
  expect(taskTarget.searchParams.get("taskId")).toBe("qa-trip-task");
  expect(taskTarget.searchParams.get("date")).toBe("2026-09-17");
  await taskLink.click();
  await expect(dialog).toHaveCount(0);
  const editForm = page.getByRole("form", { name: "일정 수정 폼", exact: true });
  await expect(editForm).toBeVisible();
  await expect(editForm.locator('[name="title"]')).toHaveValue(tasks[0].title);
  await expect(editForm.locator('[name="content"]')).toHaveValue(tasks[0].content);
  await expect(editForm.locator('[name="startDate"]')).toHaveValue("2026-09-17");
  await expect(editForm.locator('[name="endDate"]')).toHaveValue("2026-09-18");
  await page.getByRole("button", { name: "일정 수정 창 닫기", exact: true }).click();
  pass("task original navigation", "The original panel links to the actual task id/start date; dashboard opens its real edit form with original title/content and date range");

  const additionalTasks = Array.from({ length: 55 }, (_, index) => task(`qa-many-${String(index).padStart(3, "0")}`, `분류 예산 출장 확장 기록 ${index + 1}`, `분류 자료를 확인하는 예산 출장 추가 기록이다. ${privateBodyMarker}`, "2026-09-17"));
  const deletionNote = note("qa-delete-note", "고유삭제항목 검증 노트", `고유삭제항목 원문 확인용 합성 기록이다. ${privateBodyMarker}`, now);
  await page.evaluate(async fixture => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("schedule-manager-db");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise((resolve, reject) => {
        const transaction = db.transaction(["tasks", "notes"], "readwrite");
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
        fixture.tasks.forEach(record => transaction.objectStore("tasks").put(record));
        fixture.notes.forEach(record => transaction.objectStore("notes").put(record));
      });
    } finally { db.close(); }
  }, { tasks: additionalTasks, notes: [deletionNote, archivedNote] });
  await page.reload();
  await openSearch();
  for (const width of [1024, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await search("trip", tripQuestion, false, null);
    await expect(list.locator("[data-qa-record]")).toHaveCount(50);
    await dialog.getByRole("button", { name: "더 보기", exact: true }).click();
    await expect(list.locator("[data-qa-record]")).toHaveCount(58);
    const bottomRow = list.locator("[data-qa-record]").last();
    await bottomRow.click();
    const visible = await dialog.getByRole("button", { name: "원문 닫기", exact: true }).evaluate(button => {
      const bounds = button.getBoundingClientRect();
      const modal = button.closest('[role="dialog"]').getBoundingClientRect();
      return bounds.top >= modal.top - 1 && bounds.bottom <= modal.bottom + 1 && bounds.top >= -1 && bounds.bottom <= innerHeight + 1;
    });
    expect(visible).toBe(true);
    await dialog.getByRole("button", { name: "원문 닫기", exact: true }).click();
    await settleLayout();
    await expect(bottomRow).toBeFocused();
    const returnedRowVisible = await bottomRow.evaluate(row => {
      const bounds = row.getBoundingClientRect();
      const modal = row.closest('[role="dialog"]').getBoundingClientRect();
      return bounds.top >= modal.top - 1 && bounds.bottom <= modal.bottom + 1 && bounds.top >= -1 && bounds.bottom <= innerHeight + 1;
    });
    expect(returnedRowVisible).toBe(true);
    pass(`large list preview ${width}px`, "58 results paginate from 50; the original close control is visible and closing restores focus to a fully visible final row after layout motion finishes");
  }
  await page.setViewportSize({ width: 1024, height: 900 });
  await search("deletion", "고유삭제항목 찾아줘");
  await expect(list.locator("[data-qa-record]")).toHaveCount(1);
  await list.locator('[data-qa-record="note:qa-delete-note"]').click();
  await expect(original).toBeVisible();
  await settleLayout();
  const deletedSourceWidth = await modalWidth();
  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("schedule-manager-db");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise((resolve, reject) => {
        const transaction = db.transaction("notes", "readwrite");
        transaction.objectStore("notes").delete("qa-delete-note");
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
      });
    } finally { db.close(); }
    // Native fixture writes do not emit Dexie events. Notify the bundled Dexie
    // live queries through its storage-mutation event; do not edit the UI DOM.
    window.dispatchEvent(new CustomEvent("x-storagemutated-1", { detail: { all: { d: 1, from: -Infinity, to: [[]] } } }));
  });
  await expect(list.locator("[data-qa-record]")).toHaveCount(0);
  await expect(original).toContainText("삭제된 기록입니다.");
  await settleLayout();
  expect(Math.abs(await modalWidth() - deletedSourceWidth)).toBeLessThanOrEqual(1);
  await dialog.getByRole("button", { name: "원문 닫기", exact: true }).click();
  await expect(input).toBeFocused();
  pass("deleted selected result", "Deleting the last selected synthetic record updates live data, keeps deletion notice and original close control, and restores input focus on close");

  await page.setViewportSize({ width: 320, height: 900 });
  await search("archived", "보관 이동 검증 찾아줘", false, ["note:qa-archived-note"]);
  const archivedLink = list.getByRole("link", { name: `원본 노트 열기: ${archivedNote.title}`, exact: true });
  await list.locator('[data-qa-record="note:qa-archived-note"]').focus();
  await page.keyboard.press("Tab");
  await expect(archivedLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel("노트 제목", { exact: true })).toHaveValue(archivedNote.title);
  await expect(page.getByLabel("노트 제목", { exact: true })).toBeFocused();
  await expect(page.locator(".note-read-view")).toContainText(archivedNote.content);
  // The mobile detail view hides the list pane. Its heading still reflects the
  // selected archive filter; the back control intentionally returns to all notes.
  await expect(page.locator(".notes-list-head h2")).toHaveText("보관된 노트");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
  pass("archived note mobile navigation", "At 320px the real link is keyboard reachable; archived source opens in the archive filter with its original content and no horizontal overflow");

  const cleanFixture = {
    tasks: tasks.map(record => ({ ...record, content: record.content.replace(privateBodyMarker, "").trim() })),
    notes: notes.map(record => ({ ...record, content: record.content.replace(privateBodyMarker, "").trim() })),
    memos: memos.map(record => ({ ...record, content: record.content.replace(privateBodyMarker, "").trim() })),
  };
  await page.evaluate(async fixture => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("schedule-manager-db");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise((resolve, reject) => {
        const transaction = db.transaction(["tasks", "notes", "memos"], "readwrite");
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
        for (const table of ["tasks", "notes", "memos"]) {
          const store = transaction.objectStore(table);
          store.clear();
          fixture[table].forEach(record => store.put(record));
        }
      });
    } finally { db.close(); }
  }, cleanFixture);
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto(`${fileUrl}#/dashboard`);
  await page.reload();
  await openSearch();
  await settleLayout();
  await expect(dialog).not.toContainText(privateBodyMarker);
  await dialog.screenshot({ path: path.join(artifactDirectory, "docs-question-initial.png") });
  report.screenshots.push("docs-question-initial.png");
  await search("trip");
  await settleLayout();
  await expect(dialog).not.toContainText(privateBodyMarker);
  await dialog.screenshot({ path: path.join(artifactDirectory, "docs-question-search.png") });
  report.screenshots.push("docs-question-search.png");
  await list.locator('[data-qa-record="note:qa-trip-note"]').click();
  await settleLayout();
  await expect(original).toBeVisible();
  await dialog.screenshot({ path: path.join(artifactDirectory, "docs-question-original.png") });
  report.screenshots.push("docs-question-original.png");
  pass("documentation screenshot", "Initial, results and original states rendered by the actual app from a clean isolated DB fixture; no privacy marker or UI DOM substitution");

  await dialog.getByRole("button", { name: "닫기", exact: true }).click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openSearch();
  const reducedCompactWidth = await modalWidth();
  await search("trip");
  expect(await modalWidth()).toBeGreaterThan(reducedCompactWidth);
  const reducedMotionDisabled = await dialog.evaluate(element => {
    const modalStyle = getComputedStyle(element);
    const resultStyle = getComputedStyle(element.querySelector(".ask-result-layout"));
    return modalStyle.transitionDuration.split(",").every(duration => parseFloat(duration) === 0) && resultStyle.animationName === "none";
  });
  expect(reducedMotionDisabled).toBe(true);
  const reducedRow = list.locator('[data-qa-record="task:qa-trip-task"]');
  await reducedRow.click();
  await expect(original).toBeVisible();
  await dialog.getByRole("button", { name: "원문 닫기", exact: true }).click();
  await expect(reducedRow).toBeFocused();
  pass("reduced motion", "With the system preference enabled, results and source still open and close with focus intact, while panel transitions and result entrance animation are disabled");
  expect(requestPrivacyViolation).toBe(false);
  pass("request privacy", "Model requests contain no seeded source body, local record id, or record title");
  expect(report.runtimeErrors).toEqual([]);
  pass("runtime", "No page errors during search, row selection, errors, aborts or responsive checks");
  report.mockedRequests = calls;
  report.abortedRequests = aborted;
  report.blockedOtherRequests = unmockedRequests;
  await writeFile(path.join(artifactDirectory, "validation.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.checks.length, runtimeErrors: report.runtimeErrors.length, mockedRequests: calls, abortedRequests: aborted, screenshots: report.screenshots }));
} finally {
  releaseHeldRequest?.();
  await browser.close();
}
