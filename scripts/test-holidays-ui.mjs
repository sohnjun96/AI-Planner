import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Synthetic records in a fresh context; never use a user's browser profile or API.
const now = "2026-10-01T12:00:00+09:00";
const nowIso = new Date(now).toISOString();
const fileUrl = pathToFileURL(path.resolve("dist-web/planai.html")).href;
const artifactDirectory = "artifacts/holidays";
const projects = [{
  id: "holiday-project", name: "공휴일 표시 검증", color: "#2563eb", isActive: true,
  order: 0, createdAt: nowIso, updatedAt: nowIso,
}];
const taskTypes = [
  { id: "type-trip", name: "출장", color: "#1d4ed8" },
  { id: "holiday-meeting", name: "회의", color: "#2563eb" },
].map((type, order) => ({
  ...type, order, isActive: true, isDefault: false, createdAt: nowIso, updatedAt: nowIso,
}));
const tasks = [
  { id: "holiday-trip", title: "한글날 고객사 방문", date: "2026-10-09", taskTypeId: "type-trip" },
  { id: "holiday-meeting", title: "일반 근무일 회의", date: "2026-10-12", taskTypeId: "holiday-meeting" },
].map(({ date, ...task }) => ({
  ...task, content: "합성 테스트 일정", projectId: "holiday-project", status: "NOT_DONE",
  startAt: new Date(`${date}T09:00:00+09:00`).toISOString(),
  endAt: new Date(`${date}T10:00:00+09:00`).toISOString(),
  isMajor: false, createdAt: nowIso, updatedAt: nowIso,
}));

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 }, timezoneId: "Asia/Seoul",
  });
  const page = await context.newPage();
  const pageErrors = [];
  const attemptedNetwork = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await context.route(/^https?:/, (route) => {
    attemptedNetwork.push(route.request().url());
    return route.abort();
  });
  await page.clock.setFixedTime(new Date(now));
  await page.goto(`${fileUrl}#/dashboard`);
  await expect(page.getByRole("heading", { name: "일정 보드", exact: true })).toBeVisible();

  async function seedFixture(seedTasks = tasks) {
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
          const request = settings.get("default");
          request.onsuccess = () => settings.put({
            ...request.result, id: "default", autoBackupEnabled: false, notificationsEnabled: false,
            noteTaskSuggestionsEnabled: false, relatedNoteSuggestionsEnabled: false,
            weekStartsOn: "mon", showPastCompleted: true,
          });
        });
      } finally {
        db.close();
      }
      localStorage.setItem("ai-planner:dashboard-view-mode", "MONTH");
    }, { tasks: seedTasks, projects, taskTypes });
    // Native IndexedDB writes do not emit Dexie's live-query notifications.
    await page.reload();
    await expect(page.getByRole("heading", { name: "일정 보드", exact: true })).toBeVisible();
  }

  const board = page.locator(".dashboard-calendar-card");
  const selectedDay = page.locator(".dashboard-selected-day-card");
  const week = board.locator(".dashboard-week-view");
  const list = board.locator(".dashboard-list-view");
  const controls = board.getByRole("group", { name: "대시보드 일정 보기 방식", exact: true });
  const cell = (date) => board.locator(`[data-calendar-date="${date}"]`);

  async function setView(name) {
    await controls.getByRole("button", { name, exact: true }).click();
    if (name === "주간" || name === "목록") {
      const container = name === "주간" ? week : list;
      await container.getByRole("group", { name: "상태별 필터", exact: true })
        .getByRole("button", { name: /^전체 / }).click();
    }
  }

  async function expectHoliday(date, name, count = 0) {
    await expect(cell(date)).toHaveClass(/has-holiday/);
    const badge = cell(date).locator(".calendar-holiday-mark");
    await expect(badge).toHaveAttribute("title", name);
    await expect(badge.locator(".calendar-holiday-name")).toHaveText(name);
    await expect(badge).toBeVisible();
    if (page.viewportSize().width <= 640) {
      await expect(badge.locator(".calendar-holiday-name")).toBeHidden();
      await expect(badge.locator(".calendar-holiday-compact")).toBeVisible();
      await expect(badge.locator(".calendar-holiday-compact")).toHaveText("휴일");
    } else {
      await expect(badge.locator(".calendar-holiday-name")).toBeVisible();
      await expect(badge.locator(".calendar-holiday-compact")).toBeHidden();
    }
    await expect(cell(date)).toHaveAccessibleName(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    await expect(cell(date)).toHaveAccessibleName(count ? new RegExp(`총 ${count}건`) : /일정 없음/);
    await expect(cell(date).locator(".calendar-day-count")).toHaveCount(count ? 1 : 0);
    await expect(cell(date).locator(".calendar-event-line")).toHaveCount(count);
  }

  async function expectOctoberHolidays(tripCount = 1) {
    await expectHoliday("2026-10-03", "개천절");
    await expectHoliday("2026-10-05", "대체공휴일(개천절)");
    await expectHoliday("2026-10-09", "한글날", tripCount);
  }

  async function applyKeyword(keyword) {
    await board.getByRole("button", { name: "일정 보드 필터", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "일정 보드 필터", exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "초기화", exact: true }).click();
    await dialog.getByLabel("검색어", { exact: true }).fill(keyword);
    await dialog.getByRole("button", { name: "필터 적용", exact: true }).click();
    await expect(dialog).toHaveCount(0);
  }

  async function expectNoHolidayControls() {
    const controlName = /(?:공휴일|휴일)\s*(?:관리|설정|추가|삭제|해제|숨기기|복원)/;
    await expect(page.getByRole("button", { name: controlName })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: controlName })).toHaveCount(0);
    await expect(page.getByText("범례", { exact: true })).toHaveCount(0);
    await expect(page.locator(".holiday-legend, .calendar-legend, [aria-label='공휴일 범례']")).toHaveCount(0);
  }

  async function assertLayout(width, viewName) {
    const layout = await board.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return {
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        documentOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        boardOverflow: element.scrollWidth > element.clientWidth + 1,
        outsideViewport: bounds.left < -1 || bounds.right > window.innerWidth + 1,
      };
    });
    if (layout.documentOverflow || layout.boardOverflow || layout.outsideViewport) {
      throw new Error(`${width}px ${viewName} horizontal overflow: ${JSON.stringify(layout)}`);
    }
    if (viewName === "월간") {
      const badges = await board.locator(".calendar-holiday-mark").evaluateAll((elements) => elements.map((element) => {
        const badge = element.getBoundingClientRect();
        const button = element.closest("button").getBoundingClientRect();
        return {
          text: element.textContent,
          overflow: element.scrollWidth > element.clientWidth + 1,
          outsideCell: badge.left < button.left - 1 || badge.right > button.right + 1,
        };
      }));
      expect(badges.filter((badge) => badge.overflow || badge.outsideCell)).toEqual([]);
    }
  }

  async function storedTaskCount() {
    return page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open("schedule-manager-db");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        return await new Promise((resolve, reject) => {
          const request = db.transaction("tasks").objectStore("tasks").count();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      } finally {
        db.close();
      }
    });
  }

  await seedFixture();
  await mkdir(artifactDirectory, { recursive: true });
  await expectOctoberHolidays();
  await expect(cell("2026-10-09").locator(".calendar-special-mark.trip")).toHaveText("출장");
  await expect(board.locator(".calendar-kpi-row")).toContainText("총 2건");
  await expect(board.locator(".calendar-kpi-row")).toContainText("충돌 0건");
  await cell("2026-10-03").click();
  await expect(selectedDay.locator("header .calendar-holiday-label")).toHaveText("개천절");
  await expect(selectedDay.getByRole("button", { name: "전체 0", exact: true })).toBeVisible();
  await expect(selectedDay.locator(".compact-task-title")).toHaveCount(0);
  await expect(selectedDay).toContainText("이 날짜에 일정이 없습니다.");
  await expectNoHolidayControls();
  await cell("2026-10-03").click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /연가 설정/ })).toBeVisible();
  await expectNoHolidayControls();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);

  await cell("2026-10-09").click();
  await expect(selectedDay.locator("header .calendar-holiday-label")).toHaveText("한글날");
  await expect(selectedDay.locator(".compact-task-title")).toHaveText(["한글날 고객사 방문"]);
  await setView("주간");
  await expect(week.locator(".week-day-row.has-holiday .week-day-head .calendar-holiday-label"))
    .toHaveText(["대체공휴일(개천절)", "한글날"]);
  await expect(week.locator(".compact-task-title")).toHaveText(["한글날 고객사 방문"]);
  await setView("목록");
  await expect(list.locator(".dashboard-list-date-group.has-holiday header .calendar-holiday-label"))
    .toHaveText(["한글날"]);
  await expect(list.locator(".dashboard-list-date-group")).toHaveCount(2);

  // An empty task filter never hides date information or creates a holiday task.
  await applyKeyword("no synthetic task matches this query");
  await setView("월간");
  await expectOctoberHolidays(0);
  await expect(board.locator(".calendar-kpi-row")).toContainText("총 0건");
  await expect(selectedDay.locator("header .calendar-holiday-label")).toHaveText("한글날");
  await expect(selectedDay.getByRole("button", { name: "전체 0", exact: true })).toBeVisible();
  await setView("주간");
  await expect(week.locator(".week-day-row.has-holiday .calendar-holiday-label"))
    .toHaveText(["대체공휴일(개천절)", "한글날"]);
  await expect(week.locator(".compact-task-title")).toHaveCount(0);
  expect(await storedTaskCount()).toBe(tasks.length);
  await applyKeyword("");

  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    for (const viewName of ["월간", "주간", "목록"]) {
      await setView(viewName);
      await assertLayout(width, viewName);
      await expectNoHolidayControls();
      if (viewName === "월간") await expectOctoberHolidays();
      await page.screenshot({ path: `${artifactDirectory}/${width}-${viewName === "월간" ? "month" : viewName === "주간" ? "week" : "list"}.png` });
    }
  }

  // Years bundled with the app remain available without a server or API key.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await setView("월간");
  await board.locator(".calendar-month-label-button").click();
  await board.locator(".calendar-month-popover input[type='month']").fill("2030-01");
  await expect(cell("2030-01-01").locator(".calendar-holiday-mark"))
    .toHaveAttribute("title", /신정|1월\s*1일/);
  await expect(cell("2030-01-01").locator(".calendar-holiday-name")).toHaveText(/신정|1월\s*1일/);
  await expect(cell("2030-01-01")).toHaveAccessibleName(/일정 없음/);
  await cell("2030-01-01").click();
  await expect(selectedDay.locator("header .calendar-holiday-label")).toHaveText(/신정|1월\s*1일/);
  await expect(selectedDay.getByRole("button", { name: "전체 0", exact: true })).toBeVisible();
  expect(await storedTaskCount()).toBe(tasks.length);

  // A completely empty database also displays holidays without affecting totals.
  await seedFixture([]);
  await expectOctoberHolidays(0);
  await expect(board.locator(".calendar-kpi-row")).toContainText("총 0건");
  expect(await storedTaskCount()).toBe(0);
  if (pageErrors.length) throw new Error(pageErrors.join("\n"));
  if (attemptedNetwork.length) throw new Error(`Unexpected external requests: ${attemptedNetwork.join(", ")}`);
  console.log("Holidays UI: month/selected/week/list labels, trip coexistence, zero task totals/conflicts, empty filters/database, no management/menu/legend, 2030 offline data, 1440px/390px/320px layouts and zero page errors passed.");
} finally {
  await browser.close();
}
