import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createBuildDefines, loadBuildProfile } from "./build-profile-config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "artifacts/routine-auto-schedule-2026-10-04");
const bundle = await build({ absWorkingDir: root, entryPoints: ["tests/routineAutoSchedule.browser.ts"], bundle: true,
  platform: "browser", format: "iife", globalName: "regression", write: false,
  define: { "process.env.NODE_ENV": '"production"', ...createBuildDefines(loadBuildProfile(root, "internal")) }, logLevel: "silent" });
const server = createServer((request, response) => {
  response.setHeader("Content-Type", request.url === "/test.js" ? "text/javascript; charset=utf-8" : "text/html; charset=utf-8");
  response.end(request.url === "/test.js" ? bundle.outputFiles[0].text : '<!doctype html><meta charset="utf-8"><script src="/test.js"></script>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const transactionPage = await browser.newPage({ timezoneId: "Asia/Seoul" });
  await transactionPage.clock.setFixedTime(new Date("2026-10-01T03:00:00Z"));
  await transactionPage.goto(`http://127.0.0.1:${server.address().port}`);
  console.log(await transactionPage.evaluate(() => window.regression.runTests()));
  await transactionPage.close();

  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, timezoneId: "Asia/Seoul" });
  await page.clock.install({ time: new Date("2026-10-01T03:00:00Z") });
  await page.route(/^https?:/, route => route.abort());
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${pathToFileURL(path.join(root, "dist-web/planai.html")).href}#/routines`);
  await expect(page.getByRole("heading", { name: "나의 루틴", exact: true })).toBeVisible();
  async function readData() {
    return page.evaluate(async () => {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open("schedule-manager-db"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      try {
        const read = store => new Promise((resolve, reject) => {
          const request = database.transaction(store).objectStore(store).getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
        });
        return { tasks: await read("tasks"), routines: await read("routines"), occurrences: await read("routineOccurrences") };
      } finally { database.close(); }
    });
  }
  // Automatic creation remains enabled when extension window activation is disabled.
  await page.evaluate(async () => {
    const database = await new Promise(resolve => { const request = indexedDB.open("schedule-manager-db"); request.onsuccess = () => resolve(request.result); });
    const settings = await new Promise(resolve => { const request = database.transaction("settings").objectStore("settings").getAll(); request.onsuccess = () => resolve(request.result); });
    const transaction = database.transaction("settings", "readwrite");
    transaction.objectStore("settings").put({ ...settings[0], notificationsEnabled: false });
    await new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); });
    database.close();
  });
  await page.reload();
  await page.getByRole("button", { name: "+ 루틴 추가", exact: true }).click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("어떤 일을 챙길까요?").fill("자동 영수증 취합");
  await modal.getByRole("radio", { name: "매월", exact: true }).check();
  await modal.getByRole("checkbox", { name: "매월 1일", exact: true }).uncheck();
  await modal.getByRole("checkbox", { name: "매월 8일", exact: true }).check();
  await modal.locator("summary").filter({ hasText: "알림과 연결" }).click();
  await expect(modal.getByRole("option", { name: "일정 자동으로 만들기", exact: true })).toHaveCount(1);
  await modal.getByLabel("안내 방식", { exact: true }).selectOption("auto");
  await modal.getByLabel("미리 알림", { exact: true }).selectOption("7");
  await expect(modal.locator(".routine-preview-notify")).toContainText("자동");
  await modal.locator("summary").filter({ hasText: "프로젝트·일정 설정" }).click();
  await expect(modal.getByRole("combobox", { name: "일정 종류", exact: true })).toBeVisible();
  await modal.locator('input[type="time"]').fill("16:45");
  await modal.locator("summary").filter({ hasText: "함께 기억할 내용" }).click();
  await modal.getByRole("textbox", { name: "메모", exact: true }).fill("영수증을 자동 일정으로 준비");
  await mkdir(output, { recursive: true });
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `automatic editor overflow at ${width}px`);
    await page.screenshot({ path: path.join(output, `editor-${width}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await modal.getByRole("button", { name: "루틴 등록", exact: true }).click();
  await expect(modal).toHaveCount(0);
  await expect.poll(async () => (await readData()).tasks.length).toBe(1);
  const stored = await readData();
  assert.equal(stored.routines[0].mode, "auto");
  assert.equal(stored.tasks[0].title, "자동 영수증 취합");
  assert.equal(stored.tasks[0].content, "영수증을 자동 일정으로 준비");
  assert.equal(stored.tasks[0].startAt, "2026-10-08T07:45:00.000Z");
  assert.equal(stored.occurrences[0].status, "created");
  assert.equal(stored.occurrences[0].taskId, stored.tasks[0].id);
  await page.getByRole("button", { name: "자동 영수증 취합 상세", exact: true }).click();
  await expect(page.locator(".routine-history li")).toContainText("일정 생성");
  await page.getByRole("button", { name: "자동 영수증 취합 수정", exact: true }).click();
  await modal.locator("summary").filter({ hasText: "알림과 연결" }).click();
  await expect(modal.getByLabel("안내 방식", { exact: true })).toHaveValue("auto");
  await page.keyboard.press("Escape");
  await expect(modal).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "자동 영수증 취합", exact: true })).toBeVisible();
  assert.equal((await readData()).tasks.length, 1, "reload does not create another task");

  // Nonautomatic and paused routines are preserved; date rollover works from another app page.
  await page.evaluate(async () => {
    const database = await new Promise(resolve => { const request = indexedDB.open("schedule-manager-db"); request.onsuccess = () => resolve(request.result); });
    const routines = await new Promise(resolve => { const request = database.transaction("routines").objectStore("routines").getAll(); request.onsuccess = () => resolve(request.result); });
    const base = routines[0];
    const transaction = database.transaction("routines", "readwrite");
    for (const [id, mode, isActive, day] of [["auto-next-day", "auto", true, 2], ["auto-paused", "auto", false, 1], ["ask-only", "schedule", true, 1], ["remind-only", "remind", true, 1]]) {
      transaction.objectStore("routines").put({ ...base, id, title: id, mode, isActive, leadDays: 0, recurrence: { ...base.recurrence, monthDays: [day] } });
    }
    await new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); });
    database.close();
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "auto-next-day", exact: true })).toBeVisible();
  assert.equal((await readData()).tasks.length, 1);
  await page.getByRole("link", { name: "프로젝트", exact: true }).click();
  await page.clock.fastForward(24 * 60 * 60 * 1000);
  await expect.poll(async () => (await readData()).tasks.length).toBe(2);
  const rolled = await readData();
  assert.equal(rolled.tasks.filter(task => task.title === "auto-next-day").length, 1);
  assert.equal(rolled.occurrences.filter(record => ["auto-paused", "ask-only", "remind-only"].includes(record.routineId)).length, 0);
  await page.reload();
  await expect(page.locator("main")).toBeVisible();
  assert.equal((await readData()).tasks.length, 2);
  assert.deepEqual(errors, []);
  console.log("Routine automatic UI: option, preview, task settings, creation with window alerts off, edit/reload/history, cross-page date rollover, other modes and 320/390px layouts passed.");
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
