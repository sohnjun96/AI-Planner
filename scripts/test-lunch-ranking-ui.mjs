import { chromium, expect } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { mkdir } from "node:fs/promises";
import path from "node:path";

// Use a fresh browser context and synthetic records; never open a user's browser profile.
const now = "2026-10-01T12:00:00+09:00";
const nowIso = new Date(now).toISOString();
const currentMonth = "2026-10-01T09:00:00+09:00";
const previousMonth = "2026-09-15T12:00:00+09:00";
const previousYear = "2025-12-15T12:00:00+09:00";
const longName = "최수정".repeat(8);
const tasks = [];

function addLunch(name, count, completedAt, status = "DONE") {
  for (let index = 0; index < count; index += 1) {
    tasks.push({
      id: `lunch-ranking-${tasks.length + 1}`,
      title: `(점심) ${name}`,
      content: "",
      projectId: "project-lunch",
      taskTypeId: "type-meal",
      status,
      isMajor: false,
      startAt: new Date(completedAt).toISOString(),
      completedAt: status === "DONE" ? new Date(completedAt).toISOString() : undefined,
      createdAt: new Date(completedAt).toISOString(),
      updatedAt: new Date(completedAt).toISOString(),
    });
  }
}

addLunch("태정", 2, currentMonth);
addLunch("박민수", 2, currentMonth);
addLunch("이서연", 1, currentMonth);
addLunch(longName, 1, currentMonth);
addLunch("김태정", 2, previousMonth);
addLunch("박민수", 1, previousMonth);
addLunch("서연", 1, previousMonth);
addLunch("조하늘", 5, previousYear);
addLunch("미완료메이트", 1, currentMonth, "NOT_DONE");
addLunch("취소메이트", 1, currentMonth, "CANCELED");

const candidates = [
  { name: "태정", count: 2 },
  { name: "김태정", count: 2 },
  { name: "박민수", count: 3 },
  { name: "이서연", count: 1 },
  { name: "서연", count: 1 },
  { name: longName, count: 1 },
  { name: "조하늘", count: 5 },
];
const groups = [
  { displayName: "김태정", aliases: ["김태정", "태정"], count: 4, confidence: 0.95 },
  { displayName: "박민수", aliases: ["박민수"], count: 3, confidence: 1 },
  { displayName: "이서연", aliases: ["이서연", "서연"], count: 2, confidence: 0.95 },
  { displayName: longName, aliases: [longName], count: 1, confidence: 1 },
  { displayName: "조하늘", aliases: ["조하늘"], count: 5, confidence: 1 },
];

function fingerprint(values) {
  const source = [...values]
    .sort((a, b) => a.name.localeCompare(b.name, "ko"))
    .map((candidate) => `${candidate.name}:${candidate.count}`)
    .join("|");
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${values.length}-${(hash >>> 0).toString(16)}`;
}

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
  const fileUrl = pathToFileURL(path.resolve("dist-web/planai.html")).href;
  await page.goto(`${fileUrl}#/dashboard`);
  await expect(page.getByRole("link", { name: "나의 기록", exact: true })).toBeVisible();

  async function seedArchive(seedTasks, seedGroups, sourceCandidates, lastError) {
    await page.evaluate(async (seed) => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open("schedule-manager-db");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        await new Promise((resolve, reject) => {
          const transaction = db.transaction(["tasks", "archiveInsightCaches", "settings"], "readwrite");
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error ?? new Error("Fixture transaction aborted"));
          const taskStore = transaction.objectStore("tasks");
          taskStore.clear();
          seed.tasks.forEach((task) => taskStore.put(task));
          transaction.objectStore("archiveInsightCaches").put({
            id: "lunch-mate:aliases:v2",
            sourceFingerprint: seed.sourceFingerprint,
            payload: JSON.stringify(seed.groups),
            lastAttemptedAt: seed.nowIso,
            lastError: seed.lastError,
            updatedAt: seed.nowIso,
          });
          const settings = transaction.objectStore("settings");
          const settingRequest = settings.get("default");
          settingRequest.onsuccess = () => settings.put({
            ...settingRequest.result,
            id: "default",
            autoBackupEnabled: false,
            notificationsEnabled: false,
            noteTaskSuggestionsEnabled: false,
            relatedNoteSuggestionsEnabled: false,
          });
        });
      } finally {
        db.close();
      }
    }, { tasks: seedTasks, groups: seedGroups, sourceFingerprint: fingerprint(sourceCandidates), nowIso, lastError });
    await page.goto(`${fileUrl}#/archive`);
    // Native IndexedDB fixture writes do not emit Dexie's live-query notifications.
    await page.reload();
    await expect(page.getByRole("heading", { name: "나의 기록", exact: true })).toBeVisible();
  }

  const trigger = page.getByRole("button", { name: "점심 메이트 랭킹 보기", exact: true });
  const dialog = page.getByRole("dialog", { name: "점심 메이트 랭킹", exact: true });
  const periodButtons = page.getByRole("group", { name: "기록 집계 기간", exact: true });
  async function openRanking() {
    await trigger.click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "닫기", exact: true })).toBeFocused();
  }
  async function expectRanking(expected) {
    const rows = dialog.locator(".lunch-ranking-row");
    await expect(rows).toHaveCount(expected.length);
    for (let index = 0; index < expected.length; index += 1) {
      await expect(rows.nth(index).locator(".lunch-ranking-person > strong")).toHaveText(expected[index].name);
      await expect(rows.nth(index).locator(".lunch-ranking-count")).toHaveText(`${expected[index].count}회`);
      await expect(rows.nth(index).locator(".lunch-ranking-position")).toHaveText(expected[index].rank);
    }
  }
  async function closeWithEscape() {
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  }

  await seedArchive(tasks, groups, candidates);
  await expect(trigger).toContainText("김태정");
  await expect(trigger).toContainText("함께 점심 먹은 횟수 : 4회");
  await expect(trigger).toHaveAccessibleDescription("김태정 함께 점심 먹은 횟수 : 4회");
  await openRanking();
  await expect(dialog).toContainText("올해 · 완료한 점심 기록 기준");
  await expectRanking([
    { name: "김태정", count: 4, rank: "1위" },
    { name: "박민수", count: 3, rank: "2위" },
    { name: "이서연", count: 2, rank: "3위" },
    { name: longName, count: 1, rank: "4위" },
  ]);
  await expect(dialog).toContainText("함께 집계한 이름: 김태정 · 태정");
  await expect(dialog.getByText("미완료메이트", { exact: true })).toHaveCount(0);
  await expect(dialog.getByText("취소메이트", { exact: true })).toHaveCount(0);
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "닫기", exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "닫기", exact: true })).toBeFocused();
  await mkdir("artifacts/lunch-ranking", { recursive: true });
  await page.screenshot({ path: "artifacts/lunch-ranking/desktop.png" });
  await closeWithEscape();

  await periodButtons.getByRole("button", { name: "이번 달", exact: true }).click();
  await expect(trigger).toContainText("김태정");
  await expect(trigger).toContainText("함께 점심 먹은 횟수 : 2회");
  await expect(trigger).toHaveAccessibleDescription("김태정 함께 점심 먹은 횟수 : 2회");
  await openRanking();
  await expect(dialog).toContainText("이번 달 · 완료한 점심 기록 기준");
  await expectRanking([
    { name: "김태정", count: 2, rank: "공동 1위" },
    { name: "박민수", count: 2, rank: "공동 1위" },
    { name: "이서연", count: 1, rank: "공동 3위" },
    { name: longName, count: 1, rank: "공동 3위" },
  ]);
  await expect(dialog).toContainText("함께 집계한 이름: 태정");
  await expect(dialog.getByText("조하늘", { exact: true })).toHaveCount(0);
  await closeWithEscape();

  await periodButtons.getByRole("button", { name: "전체", exact: true }).click();
  await openRanking();
  await expectRanking([
    { name: "조하늘", count: 5, rank: "1위" },
    { name: "김태정", count: 4, rank: "2위" },
    { name: "박민수", count: 3, rank: "3위" },
    { name: "이서연", count: 2, rank: "4위" },
    { name: longName, count: 1, rank: "5위" },
  ]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "artifacts/lunch-ranking/mobile.png" });
  const layout = await dialog.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return {
      documentOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      dialogOverflow: element.scrollWidth > element.clientWidth + 1,
      outsideViewport: bounds.left < -1 || bounds.right > window.innerWidth + 1,
      overflowingTitles: [...document.querySelectorAll(".archive-task-title-row strong")]
        .filter((title) => title.getBoundingClientRect().right > window.innerWidth + 1)
        .map((title) => title.textContent),
    };
  });
  if (layout.documentOverflow || layout.dialogOverflow || layout.outsideViewport) {
    throw new Error(`Mobile horizontal overflow: ${JSON.stringify(layout)}`);
  }
  await dialog.getByRole("button", { name: "닫기", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();

  const manyCandidates = Array.from({ length: 30 }, (_, index) => ({
    name: `테스트메이트${String(index + 1).padStart(2, "0")}`,
    count: 1,
  }));
  const manyGroups = manyCandidates.map((candidate) => ({
    displayName: candidate.name,
    aliases: [candidate.name],
    count: candidate.count,
    confidence: 1,
  }));
  const manyTasks = manyCandidates.map((candidate, index) => ({
    ...tasks[0],
    id: `lunch-ranking-scroll-${index + 1}`,
    title: `(점심) ${candidate.name}`,
  }));
  await seedArchive(manyTasks, manyGroups, manyCandidates);
  await openRanking();
  await expect(dialog.locator(".lunch-ranking-row")).toHaveCount(30);
  await expect(dialog.locator(".lunch-ranking-count")).toHaveText(Array(30).fill("1회"));
  await expect(dialog.locator(".lunch-ranking-position")).toHaveText(Array(30).fill("공동 1위"));
  if (!await dialog.evaluate((element) => element.scrollHeight > element.clientHeight)) {
    throw new Error("The long ranking must scroll within the mobile dialog");
  }
  const lastRow = dialog.locator(".lunch-ranking-row").last();
  await expect(lastRow).not.toBeInViewport();
  await lastRow.scrollIntoViewIfNeeded();
  await expect(lastRow).toBeInViewport();
  if (!await dialog.evaluate((element) => element.scrollTop > 0)) {
    throw new Error("Scrolling to the final companion must scroll the dialog");
  }
  await closeWithEscape();

  await page.setViewportSize({ width: 1440, height: 1000 });
  await seedArchive(tasks, groups, candidates, "request_failed");
  await openRanking();
  await expect(dialog.getByRole("alert")).toContainText("현재 집계된 랭킹은 계속 볼 수 있어요.");
  await expect(dialog.getByRole("button", { name: "AI 정리 다시 시도", exact: true })).toBeEnabled();
  await expect(dialog.locator(".lunch-ranking-row")).toHaveCount(4);
  await closeWithEscape();

  await seedArchive([], [], []);
  await expect(trigger).toContainText("아직 기록 없음");
  await expect(trigger).toHaveAccessibleDescription("아직 기록 없음 함께 점심 먹은 횟수 : 0회");
  await openRanking();
  await expect(dialog).toContainText("점심 메이트 0명");
  await expect(dialog.getByRole("heading", { name: "아직 점심 메이트 기록이 없습니다.", exact: true })).toBeVisible();
  await expect(dialog.locator(".lunch-ranking-row")).toHaveCount(0);
  await closeWithEscape();
  if (errors.length) throw new Error(errors.join("\n"));
  if (attemptedNetwork.length) throw new Error(`Unexpected network requests with a fresh cache: ${attemptedNetwork.join(", ")}`);
  console.log("Lunch ranking UI: complete ranking, period aliases/counts, tied ranks, focus/Escape, mobile/long-list scrolling, cached errors and empty state passed.");
} finally {
  await browser.close();
}
