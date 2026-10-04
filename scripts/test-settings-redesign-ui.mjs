import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";

// A fresh Chromium context contains only built-in defaults and this synthetic
// fixture. Every HTTP(S) request is blocked; no real API or user profile is used.
const fileUrl = pathToFileURL(path.resolve("dist-web/planai.html")).href;
const artifactDirectory = "artifacts/settings-inline-options-2026-10-05";
const now = "2026-10-05T09:00:00+09:00";
const nowIso = new Date(now).toISOString();
const sections = [
  ["environment", "환경"], ["schedule", "일정"], ["notes", "노트"],
  ["ai", "AI 연결"], ["data", "데이터·백업"], ["stats", "사용 현황"],
];
const modalCases = [
  ["schedule", "종류 관리", "일정 종류 관리"],
  ["schedule", "맞춤 규칙 편집", "AI 일정 맞춤 규칙"],
  ["notes", "AI 편집 기능 관리", "노트 AI 편집 기능"],
  ["data", "자동 백업 목록 보기", "자동 백업 목록"],
];
const report = { fixture: "synthetic-only", checks: [], runtimeErrors: [], blockedRemoteRequests: 0, screenshots: [] };
const pass = (name, detail) => report.checks.push({ name, passed: true, detail });
const browser = await chromium.launch({ headless: true });

try {
  await mkdir(artifactDirectory, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: "Asia/Seoul", acceptDownloads: true });
  await context.route(/^https?:/, async route => { report.blockedRemoteRequests += 1; await route.abort(); });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date(now));
  page.on("pageerror", error => report.runtimeErrors.push(error.message));
  await page.goto(`${fileUrl}#/settings`);
  const navigation = page.getByRole("navigation", { name: "설정 분류", exact: true });
  await expect(navigation).toBeVisible();
  const defaultType = await page.evaluate(async timestamp => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("schedule-manager-db");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const defaultType = await new Promise((resolve, reject) => {
        const request = db.transaction("taskTypes").objectStore("taskTypes").getAll();
        request.onsuccess = () => resolve(request.result.find(type => type.isDefault));
        request.onerror = () => reject(request.error);
      });
      await new Promise((resolve, reject) => {
        const tables = Array.from(db.objectStoreNames);
        const transaction = db.transaction(tables, "readwrite");
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error ?? new Error("Synthetic fixture aborted"));
        for (const table of tables.filter(table => !["settings", "taskTypes"].includes(table))) transaction.objectStore(table).clear();
        const settings = transaction.objectStore("settings");
        const current = settings.get("default");
        current.onsuccess = () => settings.put({
          ...current.result, id: "default", llmModel: "synthetic-settings-test", llmTemperature: 0.7,
          llmReasoningEffort: "default", llmGemmaThinkingEnabled: false, rememberLlmApiKey: false,
          autoBackupEnabled: false, notificationsEnabled: false, noteTaskSuggestionsEnabled: false,
          relatedNoteSuggestionsEnabled: false, showPastCompleted: false, weekStartsOn: "sun", timeFormat: "24h",
          noteAiActions: [{ id: "qa-note-action", label: "합성 기본 기능", prompt: "합성 검증용 원문을 정리하세요." }],
          updatedAt: timestamp,
        });
        transaction.objectStore("userContexts").put({ id: "user-context", markdown: "# 합성 검증 규칙\n검증 일정은 오전에 배치하세요.", rules: [], updatedAt: timestamp });
      });
      return { id: defaultType.id, name: defaultType.name };
    } finally { db.close(); }
  }, nowIso);
  await page.reload();
  const workspace = page.locator(".settings-workspace");
  const menu = id => navigation.getByRole("button", { name: sections.find(section => section[0] === id)[1], exact: true });
  async function navigate(id) {
    await menu(id).click();
    await expect(menu(id)).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => page.evaluate(() => new URLSearchParams(location.hash.split("?")[1]).get("section"))).toBe(id);
  }
  async function readRecord(table, id) {
    return page.evaluate(async ({ table, id }) => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open("schedule-manager-db");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        return await new Promise((resolve, reject) => {
          const store = db.transaction(table).objectStore(table);
          const request = id === undefined ? store.getAll() : store.get(id);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      } finally { db.close(); }
    }, { table, id });
  }
  const readSetting = () => readRecord("settings", "default");
  async function openModal(section, launcherName, title) {
    await navigate(section);
    const launcher = workspace.getByRole("button", { name: launcherName, exact: true });
    await launcher.click();
    const dialog = page.getByRole("dialog", { name: title, exact: true });
    await expect(dialog).toBeVisible();
    await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
    return { launcher, dialog };
  }
  async function dismiss(dialog, launcher) {
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    if (launcher) await expect(launcher).toBeFocused();
  }
  async function focusBoundary(dialog, boundary) {
    await dialog.evaluate((element, boundary) => {
      const focusable = [...element.querySelectorAll("a[href],button:not([disabled]),input:not([disabled]):not([type='hidden']),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex='-1'])")]
        .filter(control => control.getClientRects().length && !control.hasAttribute("hidden") && control.getAttribute("aria-hidden") !== "true");
      focusable[boundary === "first" ? 0 : focusable.length - 1].focus();
    }, boundary);
  }
  async function expectFocusBoundary(dialog, boundary) {
    expect(await dialog.evaluate((element, boundary) => {
      const focusable = [...element.querySelectorAll("a[href],button:not([disabled]),input:not([disabled]):not([type='hidden']),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex='-1'])")]
        .filter(control => control.getClientRects().length && !control.hasAttribute("hidden") && control.getAttribute("aria-hidden") !== "true");
      return document.activeElement === focusable[boundary === "first" ? 0 : focusable.length - 1];
    }, boundary)).toBe(true);
  }
  async function assertFits(dialog) {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    if (dialog) expect(await dialog.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      return bounds.left >= -1 && bounds.right <= innerWidth + 1 && element.scrollWidth <= element.clientWidth + 1;
    })).toBe(true);
    if (dialog) expect(await dialog.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      return [...element.querySelectorAll("input:not([type='hidden']),select,textarea,button,[role='button']")]
        .filter(control => control.getClientRects().length)
        .map(control => ({ name: control.getAttribute("aria-label") ?? control.textContent?.trim().slice(0, 60) ?? control.tagName, left: control.getBoundingClientRect().left, right: control.getBoundingClientRect().right }))
        .filter(control => control.left < bounds.left - 1 || control.right > bounds.right + 1);
    })).toEqual([]);
    if (dialog) expect(await dialog.evaluate(element => {
      return [...element.querySelectorAll(".settings-ai-modal-body,.settings-type-modal-body,.settings-type-layout,.ai-action-manager,.ai-action-row,.ai-action-fields")]
        .filter(container => container.getClientRects().length && container.scrollWidth > container.clientWidth + 1)
        .map(container => ({ className: container.className, scrollWidth: container.scrollWidth, clientWidth: container.clientWidth }));
    })).toEqual([]);
  }

  await expect(navigation.getByRole("button")).toHaveCount(sections.length);
  for (const [id] of sections) await navigate(id);
  pass("six categories", "All six category buttons select their canonical section and one category remains active");
  await navigate("environment");
  await expect(workspace.getByRole("combobox", { name: "주 시작 요일", exact: true })).toBeVisible();
  await expect(workspace.getByRole("combobox", { name: "시간 표시 형식", exact: true })).toBeVisible();
  await expect(workspace.getByLabel("지난 완료 업무를 기본으로 표시", { exact: true })).toHaveCount(0);
  await workspace.getByRole("combobox", { name: "주 시작 요일", exact: true }).selectOption("mon");
  await expect.poll(async () => (await readSetting()).weekStartsOn).toBe("mon");
  await navigate("schedule");
  const completedToggle = workspace.getByLabel("지난 완료 업무를 기본으로 표시", { exact: true });
  await expect(completedToggle).toBeVisible();
  await expect(workspace.getByLabel("일정 시작 전 플래나이 창 표시", { exact: true })).toBeVisible();
  await expect(workspace.getByLabel("플래나이 표시 시간(분 전)", { exact: true })).toBeVisible();
  await expect(workspace.getByLabel("자동 백업 사용", { exact: true })).toHaveCount(0);
  await completedToggle.click();
  await expect.poll(async () => (await readSetting()).showPastCompleted).toBe(true);
  await expect(completedToggle).toBeChecked();
  pass("environment and schedule settings", "Week start persists; past-completed visibility and window alerts belong to schedule while backup controls are absent");

  await navigate("notes");
  for (const [label, field] of [["관련 일정 자동 추천", "noteTaskSuggestionsEnabled"], ["관련 노트 자동 추천", "relatedNoteSuggestionsEnabled"]]) {
    await workspace.getByRole("checkbox", { name: label, exact: true }).click();
    await expect.poll(async () => (await readSetting())[field]).toBe(true);
    await expect(workspace.getByRole("checkbox", { name: label, exact: true })).toBeChecked();
  }
  pass("note suggestions", "Both local note recommendation toggles save immediately from the notes category");

  let { launcher, dialog } = await openModal(...modalCases[0]);
  await dialog.getByRole("button", { name: "새 종류 추가", exact: true }).click();
  await dialog.getByLabel("종류명", { exact: true }).fill("합성 설정 검증 종류");
  await dialog.getByRole("button", { name: "종류 생성", exact: true }).click();
  await expect.poll(async () => (await readRecord("taskTypes")).some(type => type.name === "합성 설정 검증 종류")).toBe(true);
  await dialog.getByRole("button", { name: "합성 설정 검증 종류 종류 선택", exact: true }).click();
  await dialog.getByLabel("종류명", { exact: true }).fill("합성 설정 수정 종류");
  await dialog.getByRole("button", { name: "저장", exact: true }).click();
  await expect.poll(async () => (await readRecord("taskTypes")).some(type => type.name === "합성 설정 수정 종류")).toBe(true);
  await dialog.getByRole("button", { name: `${defaultType.name} 종류 선택`, exact: true }).click();
  await expect(dialog.getByRole("button", { name: "삭제", exact: true })).toHaveCount(0);
  await dismiss(dialog, launcher);
  pass("type management", "Types can be created and edited inside the modal; built-in type deletion is unavailable");

  ({ launcher, dialog } = await openModal(...modalCases[1]));
  const rules = "# 합성 저장 검증 규칙\n회의 일정은 합성 검증 프로젝트로 분류하세요.";
  const initialRules = (await readRecord("userContexts", "user-context")).markdown;
  await dialog.getByRole("textbox", { name: "AI 일정 추가에 사용할 맞춤 규칙", exact: true }).fill(rules);
  expect((await readRecord("userContexts", "user-context")).markdown).toBe(initialRules);
  await dialog.getByRole("button", { name: "맞춤 규칙 저장", exact: true }).click();
  await expect.poll(async () => (await readRecord("userContexts", "user-context")).markdown).toBe(rules);
  await dismiss(dialog, launcher);
  ({ launcher, dialog } = await openModal(...modalCases[1]));
  await expect(dialog.getByRole("textbox", { name: "AI 일정 추가에 사용할 맞춤 규칙", exact: true })).toHaveValue(rules);
  await dismiss(dialog, launcher);
  pass("schedule rules", "Editing alone does not persist the rules; explicit save persists them and reopening retains the saved text");

  ({ launcher, dialog } = await openModal(...modalCases[2]));
  await dialog.getByRole("button", { name: "+ 기능 추가", exact: true }).click();
  await dialog.getByRole("textbox", { name: "기능 이름", exact: true }).last().fill("합성 새 편집 기능");
  await dialog.getByRole("textbox", { name: "프롬프트", exact: true }).last().fill("합성 원문을 세 문장으로 정리하세요.");
  expect((await readSetting()).noteAiActions).toHaveLength(1);
  await dialog.getByRole("button", { name: "저장", exact: true }).click();
  await expect.poll(async () => (await readSetting()).noteAiActions.at(-1)?.label).toBe("합성 새 편집 기능");
  await dismiss(dialog, launcher);
  ({ launcher, dialog } = await openModal(...modalCases[2]));
  await expect(dialog.getByRole("textbox", { name: "프롬프트", exact: true }).last()).toHaveValue("합성 원문을 세 문장으로 정리하세요.");
  await dismiss(dialog, launcher);
  pass("note AI actions", "New action label and prompt require explicit save and remain available when the modal reopens");

  await navigate("ai");
  const responseOptions = workspace.locator(".settings-card").filter({ has: page.getByRole("heading", { name: "공통 응답 옵션", exact: true }) });
  await expect(responseOptions).toBeVisible();
  await expect(workspace.getByRole("button", { name: "응답 옵션 편집", exact: true })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "응답 생성 옵션", exact: true })).toHaveCount(0);
  await expect(responseOptions.getByRole("checkbox", { name: /^Thinking 모드/ })).toHaveCount(0);
  await responseOptions.getByRole("spinbutton", { name: /^Temperature/ }).fill("1.1");
  await expect.poll(async () => (await readSetting()).llmTemperature).toBe(1.1);
  await expect(responseOptions.getByRole("spinbutton", { name: /^Temperature/ })).toHaveValue("1.1");
  await responseOptions.getByRole("combobox", { name: /^추론 강도/ }).selectOption("high");
  await expect.poll(async () => (await readSetting()).llmReasoningEffort).toBe("high");
  await expect(responseOptions.getByRole("combobox", { name: /^추론 강도/ })).toHaveValue("high");
  const model = workspace.getByRole("textbox", { name: /^LLM 모델명/ });
  await model.fill("gemma-4-26b-a4b-synthetic");
  await model.press("Enter");
  await expect.poll(async () => (await readSetting()).llmModel).toBe("gemma-4-26b-a4b-synthetic");
  await responseOptions.getByRole("checkbox", { name: /^Thinking 모드/ }).click();
  await expect.poll(async () => (await readSetting()).llmGemmaThinkingEnabled).toBe(true);
  await expect(responseOptions.getByRole("checkbox", { name: /^Thinking 모드/ })).toBeChecked();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  pass("AI response options", "Temperature and reasoning are visible inline and save immediately; Thinking appears inline for a supported model, without an options launcher or dialog");

  await navigate("data");
  await expect(workspace.locator(".settings-page-header").getByRole("button", { name: "백업 내보내기", exact: true })).toHaveCount(0);
  await expect(workspace.locator(".settings-page-header").getByText("백업 불러오기", { exact: true })).toHaveCount(0);
  await expect(workspace.getByLabel("자동 백업 사용", { exact: true })).toBeVisible();
  await expect(workspace.locator("label.file-upload").filter({ hasText: "백업 불러오기" })).toBeVisible();
  const downloadEvent = page.waitForEvent("download");
  await workspace.getByRole("button", { name: "백업 내보내기", exact: true }).click();
  const download = await downloadEvent;
  expect(await download.failure()).toBeNull();
  expect(download.suggestedFilename()).toMatch(/\.(json|zip)$/);
  ({ launcher, dialog } = await openModal(...modalCases[3]));
  await expect(dialog).toContainText("저장된 자동 백업이 없습니다.");
  await dismiss(dialog, launcher);
  pass("data and backup", "Export/import controls moved into data, synthetic export still downloads, and the backup list opens as a dialog");

  for (const [legacy, canonical, modalTitle] of [
    ["general", "environment"], ["notify", "schedule"], ["types", "schedule", "일정 종류 관리"],
    ["noteAi", "notes", "노트 AI 편집 기능"], ["context", "schedule", "AI 일정 맞춤 규칙"],
  ]) {
    await page.evaluate(legacy => { location.hash = `/settings?section=${legacy}`; }, legacy);
    await expect(menu(canonical)).toHaveAttribute("aria-pressed", "true");
    if (modalTitle) {
      const legacyDialog = page.getByRole("dialog", { name: modalTitle, exact: true });
      await expect(legacyDialog).toBeVisible();
      await dismiss(legacyDialog);
    }
  }
  await page.evaluate(() => { location.hash = "/types"; });
  await expect(menu("schedule")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("dialog", { name: "일정 종류 관리", exact: true })).toBeVisible();
  await dismiss(page.getByRole("dialog", { name: "일정 종류 관리", exact: true }));
  pass("legacy links", "Previous settings section links and the types route retain their intended category and open the relevant editor");

  await page.evaluate(() => { location.hash = "/settings?section=context"; });
  const linkedRulesDialog = page.getByRole("dialog", { name: "AI 일정 맞춤 규칙", exact: true });
  await expect(linkedRulesDialog).toBeVisible();
  await dismiss(linkedRulesDialog);
  await navigate("environment");
  await workspace.getByRole("button", { name: "도움말 · 단축키", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await page.goBack();
  await expect(linkedRulesDialog).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await dismiss(linkedRulesDialog);
  pass("history clears other dialogs", "Returning to a legacy rules link closes help and opens only the intended rules dialog");

  for (const modalCase of modalCases) {
    ({ launcher, dialog } = await openModal(...modalCase));
    await focusBoundary(dialog, "last");
    await page.keyboard.press("Tab");
    await expectFocusBoundary(dialog, "first");
    await page.keyboard.press("Shift+Tab");
    await expectFocusBoundary(dialog, "last");
    await dismiss(dialog, launcher);
  }
  pass("modal keyboard access", "Every modal wraps Tab/Shift+Tab, closes with Escape, and returns focus to its launcher");

  await page.reload();
  const persisted = await readSetting();
  expect(persisted).toMatchObject({ weekStartsOn: "mon", showPastCompleted: true, noteTaskSuggestionsEnabled: true, relatedNoteSuggestionsEnabled: true, llmModel: "gemma-4-26b-a4b-synthetic", llmTemperature: 1.1, llmReasoningEffort: "high", llmGemmaThinkingEnabled: true });
  expect(persisted.noteAiActions.at(-1).label).toBe("합성 새 편집 기능");
  // Existing startup migration may append required default preference rules.
  expect((await readRecord("userContexts", "user-context")).markdown).toContain(rules);
  await navigate("ai");
  await expect(responseOptions.getByRole("spinbutton", { name: /^Temperature/ })).toHaveValue("1.1");
  await expect(responseOptions.getByRole("combobox", { name: /^추론 강도/ })).toHaveValue("high");
  await expect(responseOptions.getByRole("checkbox", { name: /^Thinking 모드/ })).toBeChecked();
  await expect(workspace.getByRole("button", { name: "응답 옵션 편집", exact: true })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "응답 생성 옵션", exact: true })).toHaveCount(0);
  pass("persistence after reload", "Environment, schedule, recommendation, action, rule, and response-option changes survive reload");
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const [section] of sections) {
      await navigate(section);
      await assertFits();
    }
    for (const modalCase of modalCases) {
      ({ launcher, dialog } = await openModal(...modalCase));
      try { await assertFits(dialog); }
      catch (error) {
        report.layoutFailure = { width, title: modalCase[2] };
        await dialog.screenshot({ path: path.join(artifactDirectory, "layout-failure.png") });
        throw error;
      }
      if (width === 320 || width === 1440) {
        const name = `${width}-${modalCase[0]}-${modalCase[2]}.png`;
        await dialog.screenshot({ path: path.join(artifactDirectory, name) });
        report.screenshots.push(name);
      }
      await dismiss(dialog, launcher);
    }
    await navigate("schedule");
    const name = `${width}-schedule.png`;
    await page.screenshot({ path: path.join(artifactDirectory, name) });
    report.screenshots.push(name);
    pass(`responsive ${width}px`, "All six categories and all four management modals fit the viewport without horizontal overflow");
  }
  expect(report.runtimeErrors).toEqual([]);
  await writeFile(path.join(artifactDirectory, "report.json"), JSON.stringify(report, null, 2));
  console.log(`Settings redesign UI: ${report.checks.length} checks passed; synthetic fixtures only; all remote requests blocked.`);
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error);
  await writeFile(path.join(artifactDirectory, "report.json"), JSON.stringify(report, null, 2));
  throw error;
} finally {
  await browser.close();
}
