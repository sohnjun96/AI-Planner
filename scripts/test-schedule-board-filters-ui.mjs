import { chromium, expect } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { mkdir } from "node:fs/promises";
import path from "node:path";

// Synthetic records in an isolated context; never use a user's browser profile or API.
const now = "2026-10-01T12:00:00+09:00";
const nowIso = new Date(now).toISOString();
const artifactDirectory = "artifacts/schedule-board-filters";
const fileUrl = pathToFileURL(path.resolve("dist-web/planai.html")).href;
const projects = [
  { id: "filter-alpha", name: "ALPHA 계획", color: "#2563eb", isActive: true },
  { id: "filter-beta", name: "BETA 운영", color: "#a855f7", isActive: false },
  { id: "project-lunch", name: "점심 약속", color: "#ea580c", isActive: true },
].map((project, order) => ({ ...project, order, createdAt: nowIso, updatedAt: nowIso }));
const taskTypes = [
  { id: "filter-meeting", name: "회의", color: "#2563eb", isActive: true },
  { id: "type-leave", name: "연가", color: "#16a34a", isActive: true },
  { id: "type-trip", name: "출장", color: "#1d4ed8", isActive: false },
  { id: "filter-meal", name: "식사", color: "#ea580c", isActive: true },
].map((type, order) => ({ ...type, order, isDefault: false, createdAt: nowIso, updatedAt: nowIso }));

function task(id, title, date, projectId, taskTypeId, status = "NOT_DONE", content = "") {
  return {
    id, title, content, projectId, taskTypeId, status,
    startAt: new Date(`${date}T09:00:00+09:00`).toISOString(),
    endAt: new Date(`${date}T10:00:00+09:00`).toISOString(),
    isMajor: false, createdAt: nowIso, updatedAt: nowIso,
    ...(status === "DONE" ? { completedAt: nowIso } : {}),
  };
}

const tasks = [
  task("filter-title", "ALPHA Proposal 검토", "2026-10-01", "filter-alpha", "filter-meeting", "NOT_DONE", "세부 RESILIENCE 체크"),
  task("filter-today-beta", "운영팀 일정", "2026-10-01", "filter-beta", "filter-meeting"),
  task("filter-leave", "휴가 신청", "2026-10-02", "filter-alpha", "type-leave"),
  task("filter-trip", "고객사 방문", "2026-10-02", "filter-beta", "type-trip"),
  task("filter-lunch", "(점심) 동료", "2026-10-02", "project-lunch", "filter-meal"),
  task("filter-done", "완료된 제안", "2026-10-15", "filter-beta", "filter-meeting", "DONE"),
  task("filter-hold", "보류 자료", "2026-10-08", "filter-alpha", "filter-meeting", "ON_HOLD"),
];
const allTitles = tasks.map((item) => item.title);

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: "Asia/Seoul" });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date(now));
  const errors = [];
  const attemptedNetwork = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await context.route(/^https?:/, (route) => {
    attemptedNetwork.push(route.request().url());
    return route.abort();
  });
  await page.goto(`${fileUrl}#/dashboard`);
  await expect(page.getByRole("heading", { name: "일정 보드", exact: true })).toBeVisible();

  async function seedFixture(seedProjects = projects, seedTypes = taskTypes) {
    await page.evaluate(async (seed) => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open("schedule-manager-db");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        await new Promise((resolve, reject) => {
          const transaction = db.transaction(["tasks", "projects", "taskTypes", "settings"], "readwrite");
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error ?? new Error("Fixture transaction aborted"));
          for (const key of ["tasks", "projects", "taskTypes"]) {
            const store = transaction.objectStore(key);
            store.clear();
            seed[key].forEach((item) => store.put(item));
          }
          const settings = transaction.objectStore("settings");
          const settingRequest = settings.get("default");
          settingRequest.onsuccess = () => settings.put({
            ...settingRequest.result, id: "default",
            autoBackupEnabled: false, notificationsEnabled: false,
            noteTaskSuggestionsEnabled: false, relatedNoteSuggestionsEnabled: false,
            weekStartsOn: "mon", showPastCompleted: true,
          });
        });
      } finally {
        db.close();
      }
      localStorage.setItem("ai-planner:dashboard-view-mode", "MONTH");
    }, { tasks, projects: seedProjects, taskTypes: seedTypes });
    // Native IndexedDB writes do not emit Dexie's live-query notifications.
    await page.reload();
    await expect(page.getByRole("heading", { name: "일정 보드", exact: true })).toBeVisible();
  }

  const board = page.locator(".dashboard-calendar-card");
  const trigger = board.getByRole("button", { name: "일정 보드 필터", exact: true });
  const dialog = page.getByRole("dialog", { name: "일정 보드 필터", exact: true });
  const selectedDay = page.locator(".dashboard-selected-day-card");
  const list = board.locator(".dashboard-list-view");
  const week = board.locator(".dashboard-week-view");
  const viewControls = board.getByRole("group", { name: "대시보드 일정 보기 방식", exact: true });
  const sorted = (values) => [...values].sort();

  async function expectTitles(container, expected) {
    await expect.poll(async () => sorted(await container.locator(".compact-task-title").allTextContents()))
      .toEqual(sorted(expected));
  }
  async function setView(name) {
    await viewControls.getByRole("button", { name, exact: true }).click();
    if (name === "목록" || name === "주간") {
      const container = name === "목록" ? list : week;
      await container.getByRole("group", { name: "상태별 필터", exact: true })
        .getByRole("button", { name: /^전체 / }).click();
    }
  }
  async function openFilter() {
    await trigger.click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("group", { name: "일정 종류", exact: true })).toBeVisible();
    await expect(dialog.getByRole("group", { name: "프로젝트 종류", exact: true })).toBeVisible();
    await expect(dialog.getByLabel("검색어", { exact: true })).toBeFocused();
  }
  async function closeWithEscape() {
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  }
  async function expectHeaderFilterState(count) {
    await expect(board.locator(".dashboard-board-filter-summary")).toHaveCount(0);
    await expect(board.getByRole("button", { name: "필터 초기화", exact: true })).toHaveCount(0);
    if (count > 0) {
      await expect(trigger).toHaveClass(/is-active/);
      await expect(trigger.locator(".dashboard-board-filter-count")).toHaveText(String(count));
      await expect(trigger).toHaveAttribute("aria-description", `필터 ${count}개 적용 중`);
      await expect(trigger).toHaveAccessibleDescription(`필터 ${count}개 적용 중`);
    } else {
      await expect(trigger).not.toHaveClass(/is-active/);
      await expect(trigger.locator(".dashboard-board-filter-count")).toHaveCount(0);
      await expect(trigger).toHaveAccessibleDescription("");
    }
  }
  async function applyFilter({ types = [], projectNames = [], keyword = "" } = {}) {
    await openFilter();
    await dialog.getByRole("button", { name: "초기화", exact: true }).click();
    for (const name of types) await dialog.getByRole("checkbox", { name, exact: true }).check();
    for (const name of projectNames) await dialog.getByRole("checkbox", { name, exact: true }).check();
    await dialog.getByLabel("검색어", { exact: true }).fill(keyword);
    await dialog.getByRole("button", { name: "필터 적용", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expectHeaderFilterState(Number(types.length > 0) + Number(projectNames.length > 0) + Number(keyword.trim().length > 0));
  }
  async function resetFilter() {
    await openFilter();
    await dialog.getByRole("button", { name: "초기화", exact: true }).click();
    await dialog.getByRole("button", { name: "필터 적용", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expectHeaderFilterState(0);
  }
  async function todaySnapshot() {
    return {
      summary: await page.locator(".dashboard-topbar").innerText(),
      tasks: await page.locator(".today-task-card").innerText(),
    };
  }
  async function assertMobileLayout(width) {
    const layout = await dialog.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return {
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        documentOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        dialogOverflow: element.scrollWidth > element.clientWidth + 1,
        outsideViewport: bounds.left < -1 || bounds.right > window.innerWidth + 1,
      };
    });
    if (layout.documentOverflow || layout.dialogOverflow || layout.outsideViewport) {
      throw new Error(`${width}px horizontal overflow: ${JSON.stringify(layout)}`);
    }
    const placement = await board.locator(".dashboard-calendar-header-actions").evaluate((element) => {
      const buttons = [...element.querySelectorAll("button")];
      const filter = buttons.find((button) => button.getAttribute("aria-label") === "일정 보드 필터").getBoundingClientRect();
      const ai = buttons.find((button) => button.textContent.trim() === "AI 일정 추가").getBoundingClientRect();
      return { isLeft: filter.right <= ai.left + 1, sameRow: Math.abs(filter.top - ai.top) < 2 };
    });
    expect(placement).toEqual({ isLeft: true, sameRow: true });
  }

  await seedFixture();
  await mkdir(artifactDirectory, { recursive: true });
  await expect(trigger).toBeVisible();
  await expectHeaderFilterState(0);
  const headerButtons = await board.locator(".dashboard-calendar-header-actions button").allTextContents();
  expect(headerButtons.findIndex((text) => text.includes("필터")))
    .toBeLessThan(headerButtons.findIndex((text) => text.trim() === "AI 일정 추가"));
  const baselineToday = await todaySnapshot();
  const tomorrowCell = board.locator('[data-calendar-date="2026-10-02"]');
  await expect(tomorrowCell).toHaveAccessibleName(/총 3건/);
  await expect(tomorrowCell.locator(".calendar-special-mark")).toHaveText(["연가", "출장", "점심"]);
  await expectTitles(selectedDay, ["ALPHA Proposal 검토", "운영팀 일정"]);

  await setView("목록");
  await expectTitles(list, allTitles);
  await openFilter();
  await dialog.getByRole("checkbox", { name: "회의", exact: true }).check();
  await dialog.getByLabel("검색어", { exact: true }).fill("draft must not apply");
  await expectTitles(list, allTitles);
  const focusables = dialog.locator("button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled])");
  await focusables.first().focus();
  await page.keyboard.press("Shift+Tab");
  await expect(focusables.last()).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(focusables.first()).toBeFocused();
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expectTitles(list, allTitles);
  await openFilter();
  await expect(dialog.getByRole("checkbox", { name: "회의", exact: true })).not.toBeChecked();
  await expect(dialog.getByLabel("검색어", { exact: true })).toHaveValue("");
  await dialog.getByRole("checkbox", { name: "연가", exact: true }).check();
  await closeWithEscape();
  await expectTitles(list, allTitles);
  await openFilter();
  await expect(dialog.getByRole("checkbox", { name: "연가", exact: true })).not.toBeChecked();
  await dialog.getByLabel("검색어", { exact: true }).fill("backdrop draft");
  await page.mouse.click(4, 4);
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expectTitles(list, allTitles);

  // OR within either selection group, AND between type, project and keyword.
  await applyFilter({ types: ["회의", "연가"], projectNames: ["ALPHA 계획", "BETA 운영"] });
  await expectTitles(list, ["ALPHA Proposal 검토", "운영팀 일정", "휴가 신청", "완료된 제안", "보류 자료"]);
  await applyFilter({ types: ["연가", "출장"], projectNames: ["ALPHA 계획"] });
  await expectTitles(list, ["휴가 신청"]);
  await applyFilter({ types: ["회의", "연가"], projectNames: ["ALPHA 계획", "BETA 운영"], keyword: "bEtA" });
  await expectTitles(list, ["운영팀 일정", "완료된 제안"]);
  await list.getByRole("group", { name: "상태별 필터", exact: true }).getByRole("button", { name: /^미완료 / }).click();
  await expectTitles(list, ["운영팀 일정"]);
  await list.getByRole("group", { name: "상태별 필터", exact: true }).getByRole("button", { name: /^전체 / }).click();
  await expectTitles(list, ["운영팀 일정", "완료된 제안"]);
  expect(await todaySnapshot()).toEqual(baselineToday);
  await resetFilter();
  await expectTitles(list, allTitles);

  // Empty selections mean all; keyword covers title, content and both category names.
  for (const [keyword, expected] of [
    [" pRoPoSaL ", ["ALPHA Proposal 검토"]],
    ["resILience", ["ALPHA Proposal 검토"]],
    ["bEtA", ["운영팀 일정", "고객사 방문", "완료된 제안"]],
    ["연가", ["휴가 신청"]],
  ]) {
    await applyFilter({ keyword });
    await expectTitles(list, expected);
    if (keyword.includes("pRoPoSaL")) {
      await expect(list.locator(".compact-conflict")).toHaveText("충돌");
      await expect(list.locator(".agenda-stat-grid .conflict")).toHaveText("충돌 1");
    }
  }
  await applyFilter({ types: ["연가"] });
  await setView("월간");
  await expect(tomorrowCell).toHaveAccessibleName(/총 1건/);
  await expect(tomorrowCell.locator(".calendar-special-mark")).toHaveText(["연가"]);
  await expect(tomorrowCell.locator(".calendar-event-line")).toHaveText(["휴가 신청"]);
  await expectTitles(selectedDay, []);
  await tomorrowCell.click();
  await expectTitles(selectedDay, ["휴가 신청"]);
  await expect(board.locator(".calendar-day-detail-item strong")).toHaveText(["휴가 신청"]);
  await setView("주간");
  await expectTitles(week, ["휴가 신청"]);
  await setView("목록");
  await expectTitles(list, ["휴가 신청"]);
  expect(await todaySnapshot()).toEqual(baselineToday);
  await page.screenshot({ path: `${artifactDirectory}/desktop-applied.png` });

  // Closing an edited form preserves an already-applied filter, and reopening restores it.
  await openFilter();
  await expect(dialog.getByRole("checkbox", { name: "연가", exact: true })).toBeChecked();
  await dialog.getByRole("button", { name: "초기화", exact: true }).click();
  await expect(dialog.getByRole("checkbox", { name: "연가", exact: true })).not.toBeChecked();
  await closeWithEscape();
  await expectTitles(list, ["휴가 신청"]);
  await openFilter();
  await expect(dialog.getByRole("checkbox", { name: "연가", exact: true })).toBeChecked();
  await dialog.getByRole("button", { name: "초기화", exact: true }).click();
  await dialog.getByRole("button", { name: "필터 적용", exact: true }).click();
  await expectHeaderFilterState(0);
  await expectTitles(list, allTitles);

  await applyFilter({ keyword: "no fixture matches this search" });
  await expectTitles(list, []);
  await expect(list).toContainText(/일정/);
  await expect(board).toContainText(/필터|조건/);
  await resetFilter();
  await expectTitles(list, allTitles);

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await openFilter();
    await assertMobileLayout(width);
    await page.screenshot({ path: `${artifactDirectory}/mobile-${width}.png` });
    await closeWithEscape();
  }

  const manyProjects = [...projects, ...Array.from({ length: 45 }, (_, index) => ({
    ...projects[0], id: `filter-long-project-${index}`, order: 100 + index,
    name: `긴 프로젝트 이름 ${String(index + 1).padStart(2, "0")} ${"모바일 줄바꿈 검증 ".repeat(5)}`,
  }))];
  const manyTypes = [...taskTypes, ...Array.from({ length: 35 }, (_, index) => ({
    ...taskTypes[0], id: `filter-long-type-${index}`, order: 100 + index,
    name: `일정 종류 ${String(index + 1).padStart(2, "0")} ${"긴 일정 종류 이름 ".repeat(4)}`,
  }))];
  await seedFixture(manyProjects, manyTypes);
  await setView("목록");
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await openFilter();
    await assertMobileLayout(width);
    const finalOption = dialog.getByRole("group", { name: "프로젝트 종류", exact: true }).getByRole("checkbox").last();
    await expect(finalOption).not.toBeInViewport();
    const hasScrollableAncestor = await finalOption.evaluate((element) => {
      for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
        if (ancestor.scrollHeight > ancestor.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(ancestor).overflowY)) return true;
        if (ancestor.getAttribute("role") === "dialog") break;
      }
      return false;
    });
    expect(hasScrollableAncestor).toBe(true);
    await finalOption.scrollIntoViewIfNeeded();
    await expect(finalOption).toBeInViewport();
    await finalOption.check();
    await assertMobileLayout(width);
    await page.screenshot({ path: `${artifactDirectory}/mobile-${width}-long-options.png` });
    await closeWithEscape();
  }
  if (errors.length) throw new Error(errors.join("\n"));
  if (attemptedNetwork.length) throw new Error(`Unexpected external requests: ${attemptedNetwork.join(", ")}`);
  console.log("Schedule board filters UI: multi-selection OR/AND, keyword fields, apply/cancel/Escape/backdrop, focus trap/return, month/week/list/details, status independence, TODAY scope, reset/empty state, 390px/320px and long-option scrolling passed.");
} finally {
  await browser.close();
}
