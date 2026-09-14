import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium, expect } from "@playwright/test";

// Test the built extension with its actual minimal permissions and isolated data.
const extension = path.resolve("dist");
const profile = await mkdtemp(path.join(os.tmpdir(), "planai-reminder-test-"));
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  const origin = new URL(worker.url()).origin;
  // URL.origin is "null" for some non-standard schemes in Node.
  const base = `${origin === "null" ? worker.url().replace(/\/background\.js$/, "") : origin}/index.html`;
  let page = await context.newPage();
  await page.goto(`${base}#/dashboard`);
  await page.waitForFunction(() => !document.querySelector(".loading-screen") && document.querySelector("main"));
  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("schedule-manager-db");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction("tasks", "readwrite");
      const now = new Date().toISOString();
      for (const id of ["alarm-a", "alarm-b", "alarm-c"]) {
        tx.objectStore("tasks").put({ id, title: id, content: "", projectId: "project-general", taskTypeId: "type-etc",
          startAt: now, endAt: new Date(new Date(now).getTime() + 90 * 60_000).toISOString(),
          status: "NOT_DONE", isMajor: false, createdAt: now, updatedAt: now });
      }
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
  await page.reload();
  await page.waitForFunction(() => !document.querySelector(".loading-screen") && document.querySelector("main"));
  const initialPages = context.pages().length;
  await worker.evaluate('Promise.all([openPlanner("alarm-a"), openPlanner("alarm-b"), openPlanner("alarm-c")])');
  assert.equal(context.pages().length, initialPages, "Existing planner reused with declared permissions");
  await expect(page.locator("#reminder-review-title")).toHaveText("alarm-a");
  await page.getByRole("button", { name: "일정 검토 닫기" }).click();
  await expect(page.locator("#reminder-review-title")).toHaveText("alarm-b");
  await page.getByRole("button", { name: "완료하기", exact: true }).click();
  await expect(page.locator("#reminder-review-title")).toHaveText("alarm-c");
  await page.getByRole("button", { name: "일정 검토 닫기" }).click();
  await expect(page.locator("#reminder-review-title")).toHaveCount(0);
  assert.equal(new URLSearchParams(page.url().split("?")[1]).has("taskId"), false);

  await page.close();
  await worker.evaluate('Promise.all([openPlanner("alarm-a"), openPlanner("alarm-c"), openPlanner("alarm-a")])');
  await expect.poll(() => context.pages().filter((item) => item.url().startsWith(base)).length).toBe(1);
  const planners = context.pages().filter((item) => item.url().startsWith(base));
  assert.equal(planners.length, 1, "Closed planner creates exactly one tab for concurrent reminders");
  page = planners[0];
  await expect(page.locator("#reminder-review-title")).toHaveText("alarm-a");
  await page.getByRole("button", { name: "일정 검토 닫기" }).click();
  await expect(page.locator("#reminder-review-title")).toHaveText("alarm-c");
  for (const [days, label] of [[1, "내일로 연기"], [3, "3일 뒤로 연기"], [7, "일주일 뒤로 연기"]]) {
    const before = await page.evaluate(async () => {
      const db = await new Promise((resolve) => { const r = indexedDB.open("schedule-manager-db"); r.onsuccess = () => resolve(r.result); });
      const task = await new Promise((resolve) => { const r = db.transaction("tasks").objectStore("tasks").get("alarm-c"); r.onsuccess = () => resolve(r.result); });
      db.close(); return task;
    });
    await expect(page.getByRole("button", { name: "보류하기", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: label, exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "연기하기" }).click();
    await expect(page.getByRole("group", { name: "일정 연기 기간" }).getByRole("button")).toHaveCount(3);
    if (days === 1) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: "artifacts/reminder-postpone-20260911.png" });
    }
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(page.locator("#reminder-review-title")).toHaveCount(0);
    const after = await page.evaluate(async () => {
      const db = await new Promise((resolve) => { const r = indexedDB.open("schedule-manager-db"); r.onsuccess = () => resolve(r.result); });
      const task = await new Promise((resolve) => { const r = db.transaction("tasks").objectStore("tasks").get("alarm-c"); r.onsuccess = () => resolve(r.result); });
      db.close(); return task;
    });
    const expected = new Date(before.startAt);
    expected.setDate(expected.getDate() + days);
    assert.equal(after.startAt, expected.toISOString());
    assert.equal(after.status, before.status);
    const format = (value) => new Intl.DateTimeFormat("ko-KR", {
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(new Date(value));
    const period = (task) => `${format(task.startAt)}${task.endAt ? ` ~ ${format(task.endAt)}` : ""}`;
    assert.equal(after.content, `${before.content}${before.content ? "\n\n" : ""}[일정 연기] ${period(before)} → ${period(after)}`);
    if (before.endAt) assert.equal(new Date(after.endAt) - new Date(after.startAt), new Date(before.endAt) - new Date(before.startAt));
    await expect.poll(async () => worker.evaluate(async () => (await chrome.alarms.get("task-reminder:alarm-c"))?.scheduledTime)).toBe(new Date(after.startAt).getTime() - 5 * 60_000);
    await worker.evaluate('openPlanner("alarm-c")');
    await expect(page.locator("#reminder-review-title")).toHaveText("alarm-c");
  }
  console.log("Built extension: tab reuse, concurrent creation, reminder order, status update and all postpone options with rescheduled alarms passed.");
} finally {
  await context?.close();
  if (path.dirname(profile) === path.resolve(os.tmpdir()) && path.basename(profile).startsWith("planai-reminder-test-")) {
    await rm(profile, { recursive: true, force: true });
  }
}
