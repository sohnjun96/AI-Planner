import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";

// Isolated browser profiles, synthetic records, and mocked LLM responses only.
// Neither an installed browser profile nor a real API credential is used.
const appUrl = process.env.PLANAI_ONBOARDING_TEST_URL || pathToFileURL(path.resolve("dist-web/planai.html")).href;
const appOrigin = new URL(appUrl).origin;
const output = "artifacts/onboarding-2026-10-21";
const syntheticKey = "synthetic-onboarding-token";
const projectName = "합성 안내 검증 프로젝트";
const projectDescription = "안내 검증용 회의와 설계 검토를 진행하는 업무입니다.";
const taskTitle = "합성 첫 일정 회의";
const selectedCases = process.argv[2]?.split("|");
const report = { source: appUrl, fixture: "synthetic-only", checks: [], runtimeErrors: [], remoteRequestsMocked: 0, scheduleRequests: 0 };
const browser = await chromium.launch({ headless: true });
await mkdir(output, { recursive: true });

async function records(page, table) {
  return page.evaluate(async table => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("schedule-manager-db");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const request = database.transaction(table).objectStore(table).getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally { database.close(); }
  }, table);
}

async function patchSetting(page, patch) {
  await page.evaluate(async patch => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("schedule-manager-db");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise((resolve, reject) => {
        const transaction = database.transaction("settings", "readwrite");
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
        const store = transaction.objectStore("settings");
        const request = store.get("default");
        request.onsuccess = () => store.put({ ...request.result, ...patch });
      });
    } finally { database.close(); }
  }, patch);
}

async function putRecords(page, table, values) {
  await page.evaluate(async ({ table, values }) => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("schedule-manager-db");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(table, "readwrite");
        for (const value of values) transaction.objectStore(table).put(value);
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
      });
    } finally { database.close(); }
  }, { table, values });
}

function existingTask(projectId = "project-general") {
  return { id: "synthetic-existing-task", title: "합성 기존 일정", content: "", projectId, taskTypeId: "type-meeting", startAt: "2026-10-22T10:00:00+09:00", status: "NOT_DONE", isMajor: false, createdAt: "2026-10-21T01:00:00.000Z", updatedAt: "2026-10-21T01:00:00.000Z" };
}

function existingProject(isActive = true) {
  return { id: "synthetic-existing-project", name: projectName, description: projectDescription, color: "#2563eb", isActive, createdAt: "2026-10-21T01:00:00.000Z", updatedAt: "2026-10-21T01:00:00.000Z" };
}

async function seedExistingUser(page, { key = false, project = false, task = false, guide = null, projectActive = true } = {}) {
  await page.evaluate(({ key, guide, syntheticKey }) => {
    if (key) localStorage.setItem("planai_llm_credential_v1", JSON.stringify({ version: 1, apiKey: syntheticKey, savedAt: "2026-10-21T01:00:00.000Z" }));
    else localStorage.removeItem("planai_llm_credential_v1");
    if (guide) localStorage.setItem("planai_onboarding_v1", JSON.stringify(guide));
    else localStorage.removeItem("planai_onboarding_v1");
  }, { key, guide, syntheticKey });
  await patchSetting(page, { rememberLlmApiKey: key });
  if (project) await putRecords(page, "projects", [existingProject(projectActive)]);
  if (task) await putRecords(page, "tasks", [existingTask(project ? existingProject().id : undefined)]);
  await page.reload();
  await expect(page.locator(".app-shell")).toBeVisible();
}

async function createPage(viewport = { width: 1440, height: 1000 }) {
  const context = await browser.newContext({ viewport, timezoneId: "Asia/Seoul" });
  const mock = { connectionStatus: 200, connectionCalls: 0, requestsIncludeProject: false };
  await context.route(/^https?:/, async route => {
    const request = route.request();
    const url = request.url();
    if (appOrigin !== "null" && new URL(url).origin === appOrigin) return route.continue();
    report.remoteRequestsMocked += 1;
    if (request.method() === "GET" && new URL(url).pathname.endsWith("/models")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: [{ id: "synthetic-model" }] }) });
    }
    const payload = request.postDataJSON();
    const messages = payload?.messages ?? [];
    const connection = messages.some(message => message.content === "연결 확인");
    const probe = messages.length === 1 && messages[0].content === "ping";
    if (connection) {
      mock.connectionCalls += 1;
      if (mock.connectionStatus !== 200) return route.fulfill({ status: mock.connectionStatus, contentType: "application/json", body: "{}" });
    }
    if (connection || probe) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content: "OK" } }] }) });
    }
    report.scheduleRequests += 1;
    mock.requestsIncludeProject = JSON.stringify(messages).includes(projectDescription);
    const result = mock.scheduleResult ?? {
      assistantMessage: "첫 일정 초안을 만들었습니다. 확인 후 반영해 주세요.",
      needsUserInput: false,
      userQuestion: "",
      toolCalls: [],
      contextSuggestions: [],
      proposal: { summary: "합성 첫 일정 추가", operations: [{ action: "create_task", title: taskTitle, content: "합성 안내 검증", taskTypeId: "type-meeting", projectId: projectName, status: "not_done", startAt: "2026-10-22T10:00:00+09:00", isMajor: false }] },
    };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }) });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(7000);
  page.on("pageerror", error => report.runtimeErrors.push(error.message));
  await page.addInitScript(() => {
    window.__onboardingTrace = [];
    let last;
    const record = reason => {
      const entry = { reason, route: location.hash, guide: localStorage.getItem("planai_onboarding_v1"), dialogs: [...document.querySelectorAll('[role="dialog"]')].filter(element => element.getClientRects().length).map(element => element.getAttribute("aria-label") || element.querySelector("h2")?.textContent) };
      const signature = JSON.stringify({ ...entry, reason: undefined });
      if (signature === last && reason === "ui") return;
      last = signature;
      window.__onboardingTrace.push(entry);
      if (window.__onboardingTrace.length > 100) window.__onboardingTrace.shift();
    };
    window.addEventListener("ai-planner:onboarding-project-created", () => record("project-created"));
    document.addEventListener("DOMContentLoaded", () => {
      new MutationObserver(() => record("ui")).observe(document.body, { childList: true, subtree: true });
      record("loaded");
    });
  });
  await page.clock.setFixedTime(new Date("2026-10-21T01:00:00.000Z"));
  await page.goto(`${appUrl.split("#")[0]}#/dashboard`);
  await expect(page.locator(".app-shell")).toBeVisible();
  await patchSetting(page, { autoBackupEnabled: false, notificationsEnabled: false, noteTaskSuggestionsEnabled: false, relatedNoteSuggestionsEnabled: false });
  return { context, page, mock };
}

const connectionDialog = page => page.getByRole("dialog", { name: "AI와 연결해 주세요", exact: true });

async function connect(page, remember = true) {
  const dialog = connectionDialog(page);
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("LLM API 키", { exact: true }).fill(syntheticKey);
  await dialog.getByLabel("이 브라우저에서 API 키 기억하기", { exact: true }).setChecked(remember);
  await dialog.getByRole("button", { name: "연결 확인", exact: true }).click();
  await expect(dialog.locator(".onboarding-connection-status.is-ok")).toBeVisible();
  return dialog;
}

async function readGuideState(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("planai_onboarding_v1") ?? "null"));
}

async function createProject(page, { expectGuideHint = true, openWithGuideButton = false, expectedStep = "schedule" } = {}) {
  const projectDialog = page.getByRole("dialog", { name: "프로젝트 설정", exact: true });
  if (openWithGuideButton) {
    const guide = page.locator('[data-onboarding-step="project"]');
    await expect(guide).toBeVisible();
    await guide.getByRole("button", { name: /^(프로젝트 만들기|프로젝트로 이동)$/ }).click();
  }
  await expect(projectDialog).toBeVisible();
  if (expectGuideHint) await expect(projectDialog).toContainText("AI가 일정 추가 시 알맞은 프로젝트로 자동 분류합니다.");
  await projectDialog.getByLabel("프로젝트명", { exact: true }).fill(projectName);
  await projectDialog.getByLabel("프로젝트 설명", { exact: true }).fill(projectDescription);
  await assertFits(page, projectDialog);
  await projectDialog.getByRole("button", { name: "프로젝트 생성", exact: true }).click();
  await expect(projectDialog).toHaveCount(0);
  await expect.poll(async () => (await records(page, "projects")).some(project => project.name === projectName && project.description === projectDescription)).toBe(true);
  await expect.poll(async () => (await readGuideState(page)).step).toBe(expectedStep);
}

async function finishFirstSchedule(page, mock, suffix) {
  const aiDialog = page.getByRole("dialog", { name: "AI 일정 추가", exact: true });
  if (!await aiDialog.isVisible()) {
    await page.locator('[data-onboarding-step="schedule"]').getByRole("button", { name: "첫 일정 입력하기", exact: true }).click();
  }
  await expect(aiDialog).toBeVisible();
  await expect.poll(() => page.evaluate(() => location.hash.split("?")[0])).toBe("#/dashboard");
  await assertFits(page, aiDialog);
  await aiDialog.getByRole("textbox", { name: "AI 요청", exact: true }).fill("내일 오전 10시 합성 첫 일정 회의 추가해 줘");
  await aiDialog.getByRole("button", { name: "초안 만들기", exact: true }).click();
  const apply = aiDialog.getByRole("button", { name: "선택 항목 반영 (1)", exact: true });
  await expect(apply).toBeVisible();
  expect((await records(page, "tasks")).length).toBe(0);
  expect((await readGuideState(page)).step).toBe("schedule");
  expect(mock.requestsIncludeProject).toBe(true);
  await page.screenshot({ path: `${output}/first-draft-${suffix}.png` });
  await apply.click();
  await expect(aiDialog).toBeHidden();
  await expect.poll(async () => (await records(page, "tasks")).length).toBe(1);
  const task = (await records(page, "tasks"))[0];
  const project = (await records(page, "projects")).find(project => project.name === projectName);
  expect(task.title).toBe(taskTitle);
  expect(task.projectId).toBe(project.id);
  const shortcut = page.locator('[data-onboarding-step="shortcut"]');
  await expect(shortcut).toBeVisible();
  await expect(shortcut).toContainText("오른쪽 아래");
  await expect(shortcut.locator("kbd")).toHaveText("A");
  await expect(page.getByRole("button", { name: "AI 일정 추가", exact: true })).toBeVisible();
  await assertFits(page, shortcut);
  expect(await shortcut.getByRole("button", { name: "안내 마치기", exact: true }).evaluate(button => {
    const bounds = button.getBoundingClientRect();
    return [0.15, 0.5, 0.85].every(yRatio => {
      const target = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height * yRatio);
      return target === button || button.contains(target);
    });
  })).toBe(true);
  await page.screenshot({ path: `${output}/shortcut-${suffix}.png` });
  await shortcut.getByRole("button", { name: "안내 마치기", exact: true }).click();
  await expect(shortcut).toHaveCount(0);
  await expect.poll(async () => (await readGuideState(page)).step).toBe("completed");
  await page.locator("#main-content").focus();
  await page.keyboard.press("a");
  await expect(aiDialog).toBeVisible();
  await page.getByRole("button", { name: "AI 일정 추가 닫기", exact: true }).click();
  await expect(aiDialog).toBeHidden();
  await page.getByRole("button", { name: "AI 일정 추가", exact: true }).click();
  await expect(aiDialog).toBeVisible();
  await page.getByRole("button", { name: "AI 일정 추가 닫기", exact: true }).click();
  await page.reload();
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(connectionDialog(page)).toHaveCount(0);
  await expect(page.locator("[data-onboarding-step]")).toHaveCount(0);
  return { savedTasks: 1, assignedToCreatedProject: true, projectDescriptionSent: true, completionPersists: true, shortcutAndOrbWork: true };
}

async function assertFits(page, dialog) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(await dialog.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return bounds.left >= -1 && bounds.right <= innerWidth + 1 && element.scrollWidth <= element.clientWidth + 1;
  })).toBe(true);
  expect(await dialog.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return [...element.querySelectorAll("input,select,textarea,button")]
      .filter(control => control.getClientRects().length)
      .filter(control => control.getBoundingClientRect().left < bounds.left - 1 || control.getBoundingClientRect().right > bounds.right + 1)
      .map(control => control.getAttribute("aria-label") || control.textContent?.trim() || control.tagName);
  })).toEqual([]);
}

async function expectFocusWrap(page, dialog) {
  const controls = dialog.locator("button:visible:not([disabled]),input:visible:not([disabled]),textarea:visible:not([disabled]),select:visible:not([disabled]),summary:visible");
  await controls.last().focus();
  await page.keyboard.press("Tab");
  await expect(controls.first()).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(controls.last()).toBeFocused();
}

async function test(name, callback, viewport) {
  if (selectedCases && !selectedCases.includes(name)) return;
  let context;
  let page;
  const errorsBefore = report.runtimeErrors.length;
  try {
    const app = await createPage(viewport);
    context = app.context;
    page = app.page;
    const detail = await callback(app.page, app.mock);
    expect(report.runtimeErrors.slice(errorsBefore)).toEqual([]);
    report.checks.push({ name, passed: true, ...detail });
  } catch (error) {
    report.checks.push({ name, passed: false, error: error.message, guide: page ? await readGuideState(page).catch(() => null) : null, url: page?.url(), alerts: page ? await page.locator('[role="alert"],.error-text').allTextContents().catch(() => []) : [], trace: page ? await page.evaluate(() => window.__onboardingTrace).catch(() => []) : [], projectForm: page ? await page.locator(".project-settings-card").evaluateAll(elements => elements.map(element => ({ name: element.querySelector('[name="projectName"]')?.value, description: element.querySelector("textarea")?.value }))).catch(() => []) : [], projectCount: page ? (await records(page, "projects").catch(() => [])).filter(project => project.name === projectName).length : 0 });
    if (page) await page.screenshot({ path: `${output}/failure-${name.replace(/[^a-z0-9]+/g, "-")}.png` }).catch(() => {});
  } finally {
    console.log(JSON.stringify(report.checks.at(-1)));
    await context?.close();
  }
}

try {
  await test("connection validation and retry", async (page, mock) => {
    const dialog = connectionDialog(page);
    await expect(dialog).toBeVisible();
    const keyInput = dialog.getByLabel("LLM API 키", { exact: true });
    await expect(keyInput).toHaveAttribute("type", "password");
    await expect(keyInput).toBeFocused();
    await expect(dialog.getByLabel("이 브라우저에서 API 키 기억하기", { exact: true })).not.toBeChecked();
    await dialog.getByRole("button", { name: "연결 확인", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("LLM API 키를 입력해 주세요.");
    expect(mock.connectionCalls).toBe(0);
    mock.connectionStatus = 401;
    await keyInput.fill(syntheticKey);
    await dialog.getByRole("button", { name: "연결 확인", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("401");
    await expect(dialog.getByRole("button", { name: "다음 단계로", exact: true })).toHaveCount(0);
    mock.connectionStatus = 200;
    await dialog.getByRole("button", { name: "연결 확인", exact: true }).click();
    await expect(dialog.locator(".onboarding-connection-status.is-ok")).toBeVisible();
    expect(mock.connectionCalls).toBe(2);
    expect((await records(page, "settings"))[0].llmApiKey).toBeUndefined();
    await keyInput.fill("synthetic-replaced-token");
    await expect(dialog.getByRole("button", { name: "다음 단계로", exact: true })).toHaveCount(0);
    await expect(dialog.locator(".onboarding-connection-status.is-ok")).toHaveCount(0);
    await assertFits(page, dialog);
    await expectFocusWrap(page, dialog);
    await page.screenshot({ path: `${output}/connection-desktop.png` });
    return { checks: "empty key, failed request, retry, secret excluded from IndexedDB, changed key invalidates validation, focus wrap" };
  });

  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    await test(`first schedule flow ${viewport.width}`, async (page, mock) => {
      const dialog = await connect(page);
      await assertFits(page, dialog);
      await page.screenshot({ path: `${output}/connection-${viewport.width}.png` });
      await dialog.getByRole("button", { name: "다음 단계로", exact: true }).click();
      await createProject(page);
      return finishFirstSchedule(page, mock, String(viewport.width));
    }, viewport);
  }

  await test("pause and resume", async page => {
    const dialog = connectionDialog(page);
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "나중에 하기", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(async () => (await readGuideState(page)).paused).toBe(true);
    await page.reload();
    await expect(page.locator(".app-shell")).toBeVisible();
    await expect(dialog).toHaveCount(0);
    await page.locator("#main-content").focus();
    await page.keyboard.press("?");
    const help = page.getByRole("dialog", { name: "단축키와 사용법", exact: true });
    await expect(help).toBeVisible();
    await help.getByRole("button", { name: "처음 사용 안내", exact: true }).click();
    await expect(help).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await expect.poll(async () => (await readGuideState(page)).paused).toBe(false);
    await dialog.getByRole("button", { name: "나중에 하기", exact: true }).click();
    await page.getByRole("button", { name: "도움말", exact: true }).click();
    await expect(help).toBeVisible();
    await help.getByRole("button", { name: "닫기", exact: true }).click();
    await expect(help).toHaveCount(0);
    return { pausedAfterReload: true, helpResumesGuide: true, footerHelpWorks: true };
  });

  await test("session key asks again and resumes project", async page => {
    const dialog = await connect(page, false);
    await dialog.getByRole("button", { name: "다음 단계로", exact: true }).click();
    await expect.poll(async () => (await readGuideState(page)).step).toBe("project");
    await page.reload();
    await expect(dialog).toBeVisible();
    expect(await readGuideState(page)).toMatchObject({ step: "connection", afterConnection: "project", paused: false });
    expect(await dialog.getByLabel("LLM API 키", { exact: true }).inputValue()).toBe("");
    await connect(page, false);
    await dialog.getByRole("button", { name: "다음 단계로", exact: true }).click();
    await expect.poll(async () => (await readGuideState(page)).step).toBe("project");
    return { unrememberedKeyExcluded: true, previousStageRestored: true };
  });

  await test("session key asks again and resumes schedule", async page => {
    const dialog = await connect(page, false);
    await dialog.getByRole("button", { name: "다음 단계로", exact: true }).click();
    await createProject(page);
    await expect(page.getByRole("dialog", { name: "AI 일정 추가", exact: true })).toBeVisible();
    await page.reload();
    await expect(dialog).toBeVisible();
    expect(await readGuideState(page)).toMatchObject({ step: "connection", afterConnection: "schedule", paused: false });
    await connect(page, false);
    await dialog.getByRole("button", { name: "다음 단계로", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "AI 일정 추가", exact: true })).toBeVisible();
    expect(await readGuideState(page)).toMatchObject({ step: "schedule", paused: false });
    expect((await records(page, "projects")).filter(project => project.name === projectName).length).toBe(1);
    await expect(page.getByRole("dialog", { name: "프로젝트 설정", exact: true })).toHaveCount(0);
    return { scheduleRestoredAfterKeyReentry: true, projectCreationNotRepeated: true };
  });

  await test("cancelling forms preserves guide stage", async page => {
    const dialog = await connect(page);
    await dialog.getByRole("button", { name: "다음 단계로", exact: true }).click();
    const projectDialog = page.getByRole("dialog", { name: "프로젝트 설정", exact: true });
    await expect(projectDialog).toBeVisible();
    await projectDialog.getByRole("button", { name: "닫기", exact: true }).click();
    await expect(projectDialog).toHaveCount(0);
    expect(await readGuideState(page)).toMatchObject({ step: "project", paused: false });
    expect((await records(page, "projects")).some(project => project.name === projectName)).toBe(false);
    await createProject(page, { openWithGuideButton: true });
    const aiDialog = page.getByRole("dialog", { name: "AI 일정 추가", exact: true });
    await expect(aiDialog).toBeVisible();
    await page.getByRole("button", { name: "AI 일정 추가 닫기", exact: true }).click();
    await expect(aiDialog).toBeHidden();
    expect(await readGuideState(page)).toMatchObject({ step: "schedule", paused: false });
    expect((await records(page, "tasks")).length).toBe(0);
    await page.locator('[data-onboarding-step="schedule"]').getByRole("button", { name: "첫 일정 입력하기", exact: true }).click();
    await expect(aiDialog).toBeVisible();
    return { cancelledProjectDoesNotAdvance: true, closedScheduleDoesNotComplete: true, scheduleCanReopen: true };
  });

  await test("configured key bypasses connection", async page => {
    await seedExistingUser(page, { key: true });
    await expect(page.locator('[data-onboarding-step="project"]')).toBeVisible();
    await expect(connectionDialog(page)).toHaveCount(0);
    expect((await records(page, "projects")).map(project => project.id).sort()).toEqual(["project-general", "project-lunch"]);
    expect(await readGuideState(page)).toMatchObject({ step: "project", paused: false });
    return { restoredCredentialSkipsConnection: true, builtInProjectsDoNotSkipProjectStep: true };
  });

  const existingSetups = [
    { name: "key project and task show shortcut once", key: true, project: true, task: true, first: "shortcut", afterConnection: "shortcut" },
    { name: "key and project skip to first schedule", key: true, project: true, task: false, first: "schedule", afterConnection: "schedule" },
    { name: "project and task need only key then shortcut", key: false, project: true, task: true, first: "connection", afterConnection: "shortcut" },
    { name: "key and task still need project then shortcut", key: true, project: false, task: true, first: "project", afterConnection: "project" },
    { name: "existing project skips project after key entry", key: false, project: true, task: false, first: "connection", afterConnection: "schedule" },
    { name: "existing task needs key and project then shortcut", key: false, project: false, task: true, first: "connection", afterConnection: "project" },
    { name: "inactive custom project also skips project step", key: true, project: true, projectActive: false, task: true, first: "shortcut", afterConnection: "shortcut" },
  ];
  for (const setup of existingSetups) {
    await test(setup.name, async page => {
      await seedExistingUser(page, setup);
      await expect.poll(async () => (await readGuideState(page)).step).toBe(setup.first);
      if (setup.first === "connection") {
        const dialog = await connect(page);
        await dialog.getByRole("button", { name: "다음 단계로", exact: true }).click();
      }
      await expect.poll(async () => (await readGuideState(page)).step).toBe(setup.afterConnection);
      let finalStep = setup.afterConnection;
      if (finalStep === "project") {
        finalStep = setup.task ? "shortcut" : "schedule";
        await createProject(page, { expectedStep: finalStep });
      }
      if (finalStep === "schedule") {
        await expect(page.getByRole("dialog", { name: "AI 일정 추가", exact: true })).toBeVisible();
        await expect(page.getByRole("dialog", { name: "프로젝트 설정", exact: true })).toHaveCount(0);
      } else {
        const shortcut = page.locator('[data-onboarding-step="shortcut"]');
        await expect(shortcut).toBeVisible();
        await expect(shortcut.locator("kbd")).toHaveText("A");
        await expect(page.getByRole("dialog", { name: "AI 일정 추가", exact: true })).toBeHidden();
        await expect(page.getByRole("dialog", { name: "프로젝트 설정", exact: true })).toHaveCount(0);
        if (setup.name === "key project and task show shortcut once") await page.screenshot({ path: `${output}/existing-user-shortcut.png` });
        await shortcut.getByRole("button", { name: "안내 마치기", exact: true }).click();
        await expect.poll(async () => (await readGuideState(page)).step).toBe("completed");
        await page.reload();
        await expect(page.locator(".app-shell")).toBeVisible();
        await expect(page.locator("[data-onboarding-step]")).toHaveCount(0);
        await expect(connectionDialog(page)).toHaveCount(0);
      }
      return { initialStep: setup.first, nextStep: setup.afterConnection, finalStep, existingDataSkipped: true, shortcutShownOnce: finalStep === "shortcut" };
    });
  }

  for (const guide of [{ step: "completed", paused: false }, { step: "project", paused: true }]) {
    await test(`saved ${guide.step} record is respected`, async page => {
      await seedExistingUser(page, { guide });
      expect(await readGuideState(page)).toEqual(guide);
      await expect(page.locator("[data-onboarding-step]")).toHaveCount(0);
      await expect(connectionDialog(page)).toHaveCount(0);
      return { savedStatePreserved: true, noAutomaticRestart: true };
    });
  }

  await test("ordinary project creation advances active project guide", async page => {
    const dialog = await connect(page);
    await dialog.getByRole("button", { name: "다음 단계로", exact: true }).click();
    const projectDialog = page.getByRole("dialog", { name: "프로젝트 설정", exact: true });
    await expect(projectDialog).toBeVisible();
    await projectDialog.getByRole("button", { name: "닫기", exact: true }).click();
    await page.getByRole("button", { name: "새 프로젝트", exact: true }).click();
    await createProject(page, { expectGuideHint: false });
    await expect(page.getByRole("dialog", { name: "AI 일정 추가", exact: true })).toBeVisible();
    expect(await readGuideState(page)).toMatchObject({ step: "schedule", paused: false });
    return { ordinaryCreationAlsoAdvances: true };
  });

  for (const scenario of ["task", "project"]) {
    await test(`deep link ${scenario} dialog precedes connection guide`, async page => {
      if (scenario === "task") await putRecords(page, "tasks", [existingTask()]);
      const target = new URL(appUrl.split("#")[0]);
      target.search = `onboarding-scenario=${scenario}`;
      target.hash = scenario === "task" ? "/dashboard?taskId=synthetic-existing-task" : "/projects?setup=project";
      await page.goto(target.href);
      const editingDialog = page.getByRole("dialog", { name: scenario === "task" ? "일정 수정" : "프로젝트 설정", exact: true });
      await expect(editingDialog).toBeVisible();
      await expect(connectionDialog(page)).toHaveCount(0);
      await expect(page.locator('[role="dialog"]:visible')).toHaveCount(1);
      await editingDialog.getByRole("button", { name: scenario === "task" ? "일정 수정 창 닫기" : "닫기", exact: true }).click();
      await expect(editingDialog).toHaveCount(0);
      await expect(connectionDialog(page)).toBeVisible();
      await expect(page.locator('[role="dialog"]:visible')).toHaveCount(1);
      return { linkedDialogPreserved: true, guideWaitsForDialogClose: true };
    });
  }

  await test("deleted API key is requested before first schedule", async page => {
    const dialog = await connect(page);
    await dialog.getByRole("button", { name: "다음 단계로", exact: true }).click();
    const projectDialog = page.getByRole("dialog", { name: "프로젝트 설정", exact: true });
    await expect(projectDialog).toBeVisible();
    await projectDialog.getByRole("button", { name: "닫기", exact: true }).click();
    await page.evaluate(() => { location.hash = "/settings?section=ai"; });
    await page.getByRole("button", { name: "메모리·저장소에서 키 삭제", exact: true }).click();
    await expect(page.getByText("메모리와 브라우저 저장소에서 API 키를 삭제했습니다.", { exact: true })).toBeVisible();
    await page.evaluate(() => { location.hash = "/projects"; });
    await page.getByRole("button", { name: "새 프로젝트", exact: true }).click();
    await projectDialog.getByLabel("프로젝트명", { exact: true }).fill(projectName);
    await projectDialog.getByLabel("프로젝트 설명", { exact: true }).fill(projectDescription);
    await projectDialog.getByRole("button", { name: "프로젝트 생성", exact: true }).click();
    await expect(projectDialog).toHaveCount(0);
    await expect(dialog).toBeVisible();
    expect(await readGuideState(page)).toMatchObject({ step: "connection", afterConnection: "schedule", paused: false });
    await expect(page.getByRole("dialog", { name: "AI 일정 추가", exact: true })).toBeHidden();
    return { projectSaved: true, removedKeyRequiredBeforeSchedule: true };
  });

  await test("saved schedule stage skips when task already exists", async page => {
    const dialog = await connect(page);
    await dialog.getByRole("button", { name: "다음 단계로", exact: true }).click();
    await createProject(page);
    const project = (await records(page, "projects")).find(project => project.name === projectName);
    await putRecords(page, "tasks", [existingTask(project.id)]);
    await expect.poll(async () => (await records(page, "tasks")).length).toBe(1);
    // Native fixture writes do not emit Dexie's cross-query notifications.
    await page.reload();
    await expect(page.locator('[data-onboarding-step="shortcut"]')).toBeVisible();
    await expect(page.getByRole("dialog", { name: "AI 일정 추가", exact: true })).toBeHidden();
    expect(await readGuideState(page)).toMatchObject({ step: "shortcut", paused: false });
    expect((await records(page, "tasks"))[0].title).toBe("합성 기존 일정");
    return { existingTaskPreserved: true, completedScheduleStageSkipped: true };
  });
} finally {
  await browser.close();
  await writeFile(`${output}/report${selectedCases ? "-selected" : ""}.json`, `${JSON.stringify(report, null, 2)}\n`);
}

if (report.checks.some(check => !check.passed) || report.runtimeErrors.length) process.exitCode = 1;
