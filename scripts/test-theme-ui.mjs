import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { skipFirstRunGuide } from "./ui-fixtures.mjs";

// This suite uses a fresh browser context, local synthetic records, and no API.
// Run after building dist-web/planai.html: node scripts/test-theme-ui.mjs
const fileUrl = pathToFileURL(path.resolve("dist-web/planai.html")).href;
const artifactDirectory = "artifacts/theme-ui";
const now = "2026-10-21T12:00:00+09:00";
const timestamp = new Date(now).toISOString();
const report = { fixture: "isolated synthetic records only", checks: [], runtimeErrors: [], blockedRemoteRequests: 0 };
const browser = await chromium.launch({ headless: true });
let context;
let failure;

function pass(name, detail) { report.checks.push({ name, passed: true, detail }); }
function radio(page, value) { return page.locator(`input[type="radio"][name="themeMode"][value="${value}"]`); }
async function theme(page, value) { await expect(page.locator("html")).toHaveAttribute("data-theme", value); }
async function navigate(page, route) {
  await page.evaluate(route => { location.hash = `#/${route}`; }, route);
}
async function openSettings(page) {
  await navigate(page, "settings?section=environment");
  await expect(radio(page, "system")).toHaveCount(1);
}
async function setTheme(page, value) {
  await openSettings(page);
  // The controlled radio changes after the asynchronous IndexedDB save.
  await radio(page, value).click();
  await expect(radio(page, value)).toBeChecked();
  await expect.poll(() => storedTheme(page)).toBe(value);
}
async function storedTheme(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("schedule-manager-db");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction("settings").objectStore("settings").get("default");
        request.onsuccess = () => resolve(request.result?.themeMode);
        request.onerror = () => reject(request.error);
      });
    } finally { db.close(); }
  });
}
async function patchStoredTheme(page, value) {
  await page.evaluate(async value => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("schedule-manager-db");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise((resolve, reject) => {
        const transaction = db.transaction("settings", "readwrite");
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
        const store = transaction.objectStore("settings");
        const request = store.get("default");
        request.onsuccess = () => {
          const setting = { ...request.result };
          if (value === null) delete setting.themeMode;
          else setting.themeMode = value;
          store.put(setting);
        };
      });
    } finally { db.close(); }
  }, value);
  // Raw IndexedDB fixture writes do not emit Dexie live-query notifications.
  await page.reload();
}

// Composite translucent backgrounds over their actual ancestor surfaces. This
// catches a pale schedule tint left on a dark screen without relying on a hex.
async function paint(locator) {
  return locator.evaluate(element => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const painter = canvas.getContext("2d", { willReadFrequently: true });
    const parse = color => {
      painter.clearRect(0, 0, 1, 1);
      painter.fillStyle = color;
      painter.fillRect(0, 0, 1, 1);
      return [...painter.getImageData(0, 0, 1, 1).data].map((value, index) => index === 3 ? value / 255 : value);
    };
    const over = (foreground, background) => foreground.slice(0, 3).map((channel, index) => channel * foreground[3] + background[index] * (1 - foreground[3]));
    const ancestors = [];
    for (let node = element; node; node = node.parentElement) ancestors.push(node);
    let background = [255, 255, 255];
    for (const node of ancestors.reverse()) background = over(parse(getComputedStyle(node).backgroundColor), background);
    const foreground = over(parse(getComputedStyle(element).color), background);
    const luminance = rgb => rgb.map(channel => {
      const normalized = channel / 255;
      return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
    const backgroundLuminance = luminance(background);
    const foregroundLuminance = luminance(foreground);
    const backgroundImage = getComputedStyle(element).backgroundImage;
    const imageColors = backgroundImage.match(/(?:rgba?|color)\([^)]*\)/g) ?? [];
    return {
      background: background.map(Math.round), foreground: foreground.map(Math.round), backgroundLuminance,
      contrast: (Math.max(backgroundLuminance, foregroundLuminance) + 0.05) / (Math.min(backgroundLuminance, foregroundLuminance) + 0.05),
      backgroundImage, gradientStopLuminances: imageColors.map(color => luminance(over(parse(color), background))),
    };
  });
}
async function assertDarkSurface(locator) {
  await expect(locator).toBeVisible();
  const colors = await paint(locator);
  expect(colors.backgroundLuminance).toBeLessThan(0.2);
  for (const stop of colors.gradientStopLuminances) expect(stop).toBeLessThan(0.2);
  expect(colors.contrast).toBeGreaterThanOrEqual(4.5);
  return colors;
}
async function assertNoOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}
async function capture(page, name) {
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: `${artifactDirectory}/${name}.png`, fullPage: true, animations: "disabled" });
}
async function seedFixture(page) {
  await page.evaluate(async timestamp => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("schedule-manager-db");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise((resolve, reject) => {
        const tables = [...db.objectStoreNames];
        const transaction = db.transaction(tables, "readwrite");
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error ?? new Error("Synthetic fixture aborted"));
        for (const name of tables) if (name !== "settings") transaction.objectStore(name).clear();
        const settings = transaction.objectStore("settings");
        const request = settings.get("default");
        request.onsuccess = () => settings.put({
          ...request.result, themeMode: "system", autoBackupEnabled: false, notificationsEnabled: false,
          noteTaskSuggestionsEnabled: false, relatedNoteSuggestionsEnabled: false,
          llmEndpoint: "", llmApiKey: "", llmModel: "synthetic-theme-test", updatedAt: timestamp,
        });
        const projects = [
          { id: "theme-blue", name: "합성 파랑 프로젝트", color: "#2563eb" },
          { id: "theme-purple", name: "합성 보라 프로젝트", color: "#a855f7" },
          { id: "theme-yellow", name: "합성 밝은 프로젝트", color: "#ffff00" },
          { id: "theme-black", name: "합성 검정 프로젝트", color: "#000000" },
        ];
        projects.forEach((project, order) => transaction.objectStore("projects").put({ ...project, order, isActive: true, createdAt: timestamp, updatedAt: timestamp }));
        transaction.objectStore("taskTypes").put({ id: "theme-meeting", name: "합성 회의", color: "#2563eb", order: 0, isActive: true, isDefault: true, createdAt: timestamp, updatedAt: timestamp });
        projects.forEach((project, index) => transaction.objectStore("tasks").put({
          id: `theme-task-${index}`, title: `합성 ${["파랑", "보라", "밝은", "검정"][index]} 일정`, content: "다크모드 검증용 합성 일정",
          projectId: project.id, taskTypeId: "theme-meeting", status: "NOT_DONE", isMajor: false,
          startAt: new Date(`2026-10-21T${String(9 + index * 2).padStart(2, "0")}:00:00+09:00`).toISOString(),
          endAt: new Date(`2026-10-21T${String(10 + index * 2).padStart(2, "0")}:00:00+09:00`).toISOString(),
          createdAt: timestamp, updatedAt: timestamp,
        }));
        ["leave", "trip"].forEach((kind, index) => {
          const taskTypeId = `type-${kind}`;
          transaction.objectStore("taskTypes").put({ id: taskTypeId, name: index === 0 ? "연가" : "출장", color: "#2563eb", order: index + 1, isActive: true, isDefault: false, createdAt: timestamp, updatedAt: timestamp });
          transaction.objectStore("tasks").put({
            id: `theme-${kind}`, title: `합성 ${index === 0 ? "연가" : "출장"}`, content: "합성 특수 일정",
            projectId: "theme-blue", taskTypeId, status: "NOT_DONE", isMajor: false,
            startAt: new Date(`2026-10-${22 + index}T09:00:00+09:00`).toISOString(),
            endAt: new Date(`2026-10-${22 + index}T10:00:00+09:00`).toISOString(), createdAt: timestamp, updatedAt: timestamp,
          });
        });
        transaction.objectStore("notes").put({
          id: "theme-note", projectId: "theme-blue", title: "합성 테마 노트",
          content: "# 합성 테마 노트\n\n밝은 글자와 어두운 배경을 확인합니다.\n\n- [ ] 일정 색상 유지\n\n```js\nconst theme = 'dark';\n```",
          tags: [], status: "active", isPinned: false, linkedTaskIds: [], sortOrder: 0,
          createdAt: timestamp, updatedAt: timestamp, aiClassifiedAt: timestamp,
        });
      });
    } finally { db.close(); }
    localStorage.setItem("ai-planner:dashboard-view-mode", "MONTH");
  }, timestamp);
  await page.reload();
}

try {
  await mkdir(artifactDirectory, { recursive: true });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark", timezoneId: "Asia/Seoul" });
  await skipFirstRunGuide(context);
  await context.route(/^https?:/, async route => { report.blockedRemoteRequests += 1; await route.abort(); });
  const page = await context.newPage();
  page.on("pageerror", error => report.runtimeErrors.push(error.message));
  await page.clock.setFixedTime(new Date(now));
  await page.goto(`${fileUrl}#/settings?section=environment`);
  await expect(radio(page, "system")).toBeChecked();
  await theme(page, "dark");
  for (const label of ["시스템 설정", "라이트", "다크"]) await expect(page.getByText(label, { exact: true })).toBeVisible();
  await page.emulateMedia({ colorScheme: "light" });
  await theme(page, "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await theme(page, "dark");
  pass("new-user system theme", "The default follows the browser/Windows color-scheme and responds to media changes while open");

  await seedFixture(page);
  await setTheme(page, "light");
  await theme(page, "light");
  await page.emulateMedia({ colorScheme: "light" });
  await page.emulateMedia({ colorScheme: "dark" });
  await theme(page, "light");
  await page.reload();
  await expect(radio(page, "light")).toBeChecked();
  await theme(page, "light");
  await setTheme(page, "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await theme(page, "dark");
  await page.reload();
  await expect(radio(page, "dark")).toBeChecked();
  await theme(page, "dark");
  pass("manual theme persists", "Light/dark override the system, save in IndexedDB, and survive reload");

  for (const value of [null, "unrecognized-theme"]) {
    await patchStoredTheme(page, value);
    await expect(radio(page, "system")).toBeChecked();
    await theme(page, "light");
    await page.emulateMedia({ colorScheme: "dark" });
    await theme(page, "dark");
    await page.emulateMedia({ colorScheme: "light" });
  }
  pass("legacy and invalid setting fallback", "A missing or invalid stored theme safely uses the system preference");

  await setTheme(page, "dark");
  const other = await context.newPage();
  other.on("pageerror", error => report.runtimeErrors.push(error.message));
  await other.goto(`${fileUrl}#/settings?section=environment`);
  await theme(other, "dark");
  await setTheme(page, "light");
  await theme(other, "light");
  await expect(radio(other, "light")).toBeChecked();
  await setTheme(other, "dark");
  await theme(page, "dark");
  await expect(radio(page, "dark")).toBeChecked();
  await other.close();
  pass("two-tab synchronization", "Changing the saved theme in either tab updates the other open tab");

  await setTheme(page, "light");
  await navigate(page, "dashboard");
  await page.locator('.calendar-day[data-calendar-date="2026-10-21"]').click();
  const cards = page.locator(".calendar-day-detail-item.project-tinted");
  await expect(cards).toHaveCount(4);
  const lightCards = await Promise.all([0, 1, 2, 3].map(index => paint(cards.nth(index).locator("strong"))));
  const specialCells = [".calendar-day.has-marker-leave", ".calendar-day.has-marker-trip", ".calendar-day.has-holiday"];
  const lightCells = await Promise.all(specialCells.map(selector => paint(page.locator(selector).first())));
  await capture(page, "dashboard-light");
  await setTheme(page, "dark");
  await navigate(page, "dashboard");
  await page.locator('.calendar-day[data-calendar-date="2026-10-21"]').click();
  await expect(cards).toHaveCount(4);
  // Check the gradient's stops too: a background-color-only override leaves
  // the old opaque white image above the dark surface and obscures the title.
  const calendarPaint = await assertDarkSurface(page.locator(".dashboard-calendar-card"));
  await assertDarkSurface(page.locator(".dashboard-calendar-card").getByRole("heading", { name: "일정 보드", exact: true }));
  const darkCards = await Promise.all([0, 1, 2, 3].map(index => assertDarkSurface(cards.nth(index).locator("strong"))));
  darkCards.forEach((colors, index) => expect(colors.backgroundLuminance).toBeLessThan(lightCards[index].backgroundLuminance));
  expect(darkCards[0].background).not.toEqual(darkCards[1].background);
  const projectLabels = page.locator(".dashboard-selected-day-card .compact-project");
  await expect(projectLabels).toHaveCount(4);
  const labelPaints = await Promise.all([0, 1, 2, 3].map(index => assertDarkSurface(projectLabels.nth(index))));
  await capture(page, "dashboard-dark");
  pass("colored dashboard schedules", { light: lightCards, dark: darkCards, calendar: calendarPaint, projectLabels: labelPaints, detail: "Blue, purple, yellow, and black project tints darken; distinct colors and title/project-label contrast at least 4.5:1 remain" });
  const darkCells = await Promise.all(specialCells.map(selector => paint(page.locator(selector).first())));
  darkCells.forEach((colors, index) => {
    expect(colors.backgroundLuminance).toBeLessThan(lightCells[index].backgroundLuminance);
    expect(colors.backgroundLuminance).toBeLessThan(0.2);
    for (const stop of colors.gradientStopLuminances) expect(stop).toBeLessThan(0.2);
  });
  pass("leave, trip, and holiday cells", { light: lightCells, dark: darkCells });

  await navigate(page, "settings?section=schedule");
  await page.getByRole("button", { name: "종류 관리", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "일정 종류 관리", exact: true });
  const modalPaint = await assertDarkSurface(dialog);
  await capture(page, "settings-modal-dark");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  pass("dark settings modal", modalPaint);

  await navigate(page, "notes");
  await page.getByRole("button", { name: "합성 테마 노트 노트 선택", exact: true }).click();
  const live = page.locator(".note-mdx-content");
  await expect(live).toBeVisible();
  const livePaint = await assertDarkSurface(live.locator("p").first());
  await page.getByRole("button", { name: "원문", exact: true }).click();
  const source = page.locator(".cm-content[contenteditable=true]").last();
  const sourcePaint = await assertDarkSurface(source);
  await capture(page, "note-source-dark");
  pass("dark note editors", { live: livePaint, source: sourcePaint });

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await openSettings(page);
    await theme(page, "dark");
    for (const value of ["system", "light", "dark"]) await expect(radio(page, value)).toBeVisible();
    await assertNoOverflow(page);
    await capture(page, `settings-dark-${width}`);
    await navigate(page, "dashboard");
    await expect(page.getByRole("heading", { name: "일정 보드", exact: true })).toBeVisible();
    await assertNoOverflow(page);
    await capture(page, `dashboard-dark-${width}`);
  }
  pass("mobile theme controls and dashboard", "390px and 320px screens show the theme controls and dashboard without horizontal page overflow");
  expect(report.runtimeErrors).toEqual([]);
} catch (error) {
  failure = error;
  report.checks.push({ name: "theme regression", passed: false, error: error.message });
} finally {
  await context?.close();
  await browser.close();
  await writeFile(`${artifactDirectory}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
if (failure) throw failure;
