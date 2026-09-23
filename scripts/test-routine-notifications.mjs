import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const browser = await chromium.launch({ headless: true });
const outputDir = path.resolve("artifacts/routine-notifications");
await mkdir(outputDir, { recursive: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: "Asia/Seoul", reducedMotion: "reduce" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(/^https?:/, (route) => route.abort());
  await page.clock.install({ time: new Date("2026-09-22T10:00:00+09:00") });
  await page.goto(`${pathToFileURL(path.resolve("dist-web/planai.html")).href}#/projects`);
  await expect(page.locator("main")).toBeVisible();
  await page.waitForFunction(() => !document.querySelector(".loading-screen"));
  const labels = await page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("schedule-manager-db");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const read = (store) => new Promise((resolve, reject) => {
      const request = database.transaction(store).objectStore(store).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const [projects, types, settings] = await Promise.all([read("projects"), read("taskTypes"), read("settings")]);
    const project = projects.find((item) => item.isActive);
    const type = types.find((item) => item.isActive);
    const base = { content: "법인카드 영수증과 부서별 사용 내역을 취합해 회계 담당자에게 전달합니다.",
      projectId: project.id, taskTypeId: type.id, startMonth: "2026-09", intervalMonths: 1,
      dayOfMonth: 25, leadDays: 7, time: "14:30", mode: "schedule", isActive: true,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    const transaction = database.transaction(["routines", "settings"], "readwrite");
    for (const routine of [
      { ...base, id: "r-preview", title: "가. 월간 비용 정산" },
      { ...base, id: "r-edit", title: "나. 분기 장비 점검", time: "16:00" },
      { ...base, id: "r-remind", title: "다. 서류 확인", mode: "remind" },
      { ...base, id: "r-future", title: "아직 안내하지 않을 루틴", startMonth: "2026-10" },
      { ...base, id: "r-paused", title: "중지한 루틴", isActive: false },
    ]) transaction.objectStore("routines").put(routine);
    // The in-app card remains available when extension window activation is off.
    transaction.objectStore("settings").put({ ...settings[0], notificationsEnabled: false, timeFormat: "24h" });
    await new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); });
    database.close();
    localStorage.setItem("schedule_json_export_reminder_v1", JSON.stringify({ nextReminderAt: "2026-09-21T00:00:00Z" }));
    return { project: project.name, type: type.name };
  });
  await page.reload();
  const card = page.getByRole("region", { name: "나의 루틴 알림", exact: true });
  const backup = page.getByRole("region", { name: "백업이 필요합니다", exact: true });
  await expect(card.getByRole("heading", { name: "가. 월간 비용 정산" })).toBeVisible();
  await expect(card.locator("time")).toContainText("14:30");
  await expect(card.locator("time")).toHaveAttribute("datetime", "2026-09-25T05:30:00.000Z");
  await expect(card.locator(".routine-reminder-tags")).toContainText(labels.project);
  await expect(card.locator(".routine-reminder-tags")).toContainText(labels.type);
  await expect(card.locator(".routine-reminder-memo")).toContainText("법인카드 영수증");
  await expect(card.getByText("1 / 3", { exact: true })).toBeVisible();
  await expect(backup).toBeVisible();
  const cardBox = await card.boundingBox();
  const backupBox = await backup.boundingBox();
  assert(cardBox.y + cardBox.height <= backupBox.y, "routine and backup cards must not overlap");
  await page.screenshot({ path: path.join(outputDir, "desktop.png"), fullPage: true });
  await page.locator(".app-reminder-stack").screenshot({ path: path.join(outputDir, "notification-preview.png") });

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(card.getByRole("button", { name: "일정 만들기", exact: true })).toBeInViewport();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await page.screenshot({ path: path.join(outputDir, `mobile-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await card.getByRole("button", { name: "루틴 알림 접기" }).click();
  await expect(card).toHaveCount(0);
  await page.getByRole("link", { name: "노트", exact: true }).click();
  await expect(page.getByRole("button", { name: "루틴 알림 펼치기, 확인할 루틴 3건" })).toBeVisible();
  await page.getByRole("button", { name: "루틴 알림 펼치기, 확인할 루틴 3건" }).click();

  await card.getByRole("button", { name: "다음 루틴 알림" }).click();
  await expect(card.getByRole("heading", { name: "나. 분기 장비 점검" })).toBeVisible();
  await expect(card.getByRole("button", { name: "다음 루틴 알림" })).toBeFocused();
  await card.getByRole("button", { name: "수정 후 만들기" }).click();
  const dialog = page.getByRole("dialog", { name: "루틴에서 일정 만들기", exact: true });
  await expect(dialog.locator('input[name="title"]')).toHaveValue("나. 분기 장비 점검");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(card.getByRole("heading", { name: "나. 분기 장비 점검" })).toBeVisible();
  await card.getByRole("button", { name: "수정 후 만들기" }).click();
  await dialog.locator('input[name="title"]').fill("수정한 장비 점검");
  await dialog.getByRole("button", { name: "일정 추가", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(card.getByRole("heading", { name: "가. 월간 비용 정산" })).toBeVisible();
  await card.getByRole("button", { name: "일정 만들기", exact: true }).click();
  await expect(card.getByRole("heading", { name: "다. 서류 확인" })).toBeVisible();
  await expect(card.getByRole("button", { name: "일정 만들기", exact: true })).toHaveCount(0);
  await expect(card.locator("time")).not.toContainText("14:30");
  await card.getByRole("button", { name: "내일 다시 알림", exact: true }).click();
  await expect(card).toHaveCount(0);
  await page.reload();
  await expect(page.locator("main")).toBeVisible();
  await expect(card).toHaveCount(0);
  await page.clock.fastForward(24 * 60 * 60 * 1000);
  await expect(card.getByRole("heading", { name: "다. 서류 확인" })).toBeVisible();
  await card.getByRole("button", { name: "확인했어요", exact: true }).click();
  await expect(card).toHaveCount(0);

  const stored = await page.evaluate(async () => {
    const database = await new Promise((resolve) => { const r = indexedDB.open("schedule-manager-db"); r.onsuccess = () => resolve(r.result); });
    const read = (store) => new Promise((resolve) => { const r = database.transaction(store).objectStore(store).getAll(); r.onsuccess = () => resolve(r.result); });
    const result = { tasks: await read("tasks"), occurrences: await read("routineOccurrences") };
    database.close(); return result;
  });
  assert.equal(stored.tasks.length, 2, "only schedule-mode routines create tasks, once per cycle");
  assert(stored.tasks.some((task) => task.title === "수정한 장비 점검"));
  const created = stored.tasks.find((task) => task.title === "가. 월간 비용 정산");
  assert.equal(created.startAt, "2026-09-25T05:30:00.000Z");
  assert.equal(created.recurrencePattern, "NONE");
  assert.equal(stored.occurrences.find((item) => item.routineId === "r-remind").status, "acknowledged");
  assert.deepEqual(errors, []);
  console.log("Routine cards: cross-page display, summary, backup stacking, 390/320px layout, collapse, queue, edit/cancel/save, direct creation, snooze/reload/date rollover and acknowledgement passed.");
} finally { await browser.close(); }
