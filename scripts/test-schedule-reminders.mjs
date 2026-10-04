import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium, expect } from "@playwright/test";

// Real extension permissions and alarms; never touches the user's profile/data.
const profile = await mkdtemp(path.join(os.tmpdir(), "planai-reminder-test-"));
const artifactRoot = path.resolve("artifacts/schedule-reminder-inbox-2026-10-05");
await mkdir(artifactRoot, { recursive: true });
const outputDir = await mkdtemp(path.join(artifactRoot, "run-"));
const key = "planai_schedule_reminders_v1";
const snoozeKey = "schedule_reminder_snoozes_v1";
const manyIds = Array.from({ length: 22 }, (_, index) => "alarm-many-" + index);
const longTitle = "다수의 일정 알림이 쌓였을 때 긴 제목과 프로젝트 정보를 확인하는 일정 ".repeat(5);
const errors = [];
let context;

async function ready(page) {
  await page.waitForFunction(() => document.querySelector("main") && !document.querySelector(".loading-screen"));
  await expect(page.locator(".top-nav-reminders")).toBeVisible();
}
async function state(page) {
  return page.evaluate((storageKey) => JSON.parse(localStorage.getItem(storageKey) || "null"), key);
}
async function readTask(page, id) {
  return page.evaluate(async (taskId) => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open("schedule-manager-db"); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const r = db.transaction("tasks").objectStore("tasks").get(taskId);
        r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
      });
    } finally { db.close(); }
  }, id);
}
async function count(page, expected) {
  await expect(page.locator(".top-nav-reminders")).toContainText(String(expected));
  await expect(page.locator(".top-nav-reminders")).toHaveAttribute("aria-controls", "schedule-reminder-dialog");
}
async function select(page, id, title = id) {
  const item = page.locator('[data-reminder-task-id="' + id + '"]');
  // A single reminder can use the original detail-only modal without a list.
  if (await item.count()) await item.click();
  await expect(page.locator("#reminder-review-title")).toHaveText(title);
}
async function close(page) {
  await page.getByRole("button", { name: "일정 알림 닫기", exact: true }).click();
  await expect(page.locator("#schedule-reminder-dialog")).toHaveCount(0);
  await expect.poll(async () => (await state(page)).closed).toBe(true);
}
function unchanged(before, after) {
  assert.equal(after.startAt, before.startAt, "알림 처리 후 시작 시각 보존");
  assert.equal(after.endAt, before.endAt, "알림 처리 후 종료 시각 보존");
  assert.equal(after.content, before.content, "기존 메모 보존");
}
function period(task) {
  const format = (value) => new Intl.DateTimeFormat("ko-KR", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Seoul",
  }).format(new Date(value));
  return format(task.startAt) + (task.endAt ? " ~ " + format(task.endAt) : "");
}

try {
  const extension = path.resolve("dist");
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: true, timezoneId: "Asia/Seoul", reducedMotion: "reduce",
    viewport: { width: 1440, height: 1000 },
    args: ["--disable-extensions-except=" + extension, "--load-extension=" + extension],
  });
  await context.route(/^https?:/, (route) => route.abort());
  context.on("page", (page) => page.on("pageerror", (error) => errors.push(error.message)));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  const base = worker.url().replace(/\/background\.js$/, "/index.html");
  let page = await context.newPage();
  await page.goto(base + "#/dashboard");
  await ready(page);
  await page.evaluate(async ({ ids, title }) => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open("schedule-manager-db"); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
    const read = (store) => new Promise((resolve, reject) => {
      const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
    const [projects, types, settings] = await Promise.all([read("projects"), read("taskTypes"), read("settings")]);
    const now = Date.now();
    const tx = db.transaction(["tasks", "settings"], "readwrite");
    tx.objectStore("tasks").clear();
    for (const [index, id] of ["alarm-a", "alarm-b", "alarm-c", "alarm-d", "alarm-e", ...ids].entries()) {
      const startMinutes = id === "alarm-d" ? -30 : 30 + index;
      tx.objectStore("tasks").put({ id, title: id === ids[0] ? title : id,
        content: "원본 메모 " + id + "\n두 번째 메모 줄",
        projectId: projects.find((item) => item.isActive).id, taskTypeId: types.find((item) => item.isActive).id,
        startAt: new Date(now + startMinutes * 60_000).toISOString(), endAt: new Date(now + (startMinutes + 90) * 60_000).toISOString(),
        status: "NOT_DONE", isMajor: false, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() });
    }
    tx.objectStore("settings").put({ ...settings[0], notificationsEnabled: true, notifyBeforeMinutes: 5, timeFormat: "24h" });
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    db.close();
    localStorage.setItem("schedule_json_export_reminder_v1", JSON.stringify({ nextReminderAt: new Date(now + 365 * 86_400_000).toISOString() }));
  }, { ids: manyIds, title: longTitle });
  await page.reload();
  await ready(page);

  const initialPages = context.pages().length;
  await worker.evaluate('Promise.all([openPlanner("alarm-a"), openPlanner("alarm-b"), openPlanner("alarm-c"), openPlanner("alarm-a")])');
  assert.equal(context.pages().length, initialPages, "동시·중복 알림은 기존 한 탭을 재사용");
  await expect(page.locator("#schedule-reminder-dialog")).toBeVisible();
  await expect(page.locator("[data-reminder-task-id]")).toHaveCount(3);
  await expect(page.locator("#reminder-review-title")).toHaveText("alarm-a");
  await count(page, 3);
  await select(page, "alarm-b");
  await worker.evaluate('openPlanner("alarm-d")');
  await expect(page.locator("[data-reminder-task-id]")).toHaveCount(4);
  await expect(page.locator("#reminder-review-title")).toHaveText("alarm-b");
  await page.screenshot({ path: path.join(outputDir, "desktop-inbox.png"), fullPage: false });
  await close(page);
  await count(page, 4);
  assert.deepEqual(new Set((await state(page)).ids), new Set(["alarm-a", "alarm-b", "alarm-c", "alarm-d"]));
  await worker.evaluate('openPlanner("alarm-e")');
  await count(page, 5);
  await expect(page.locator("#schedule-reminder-dialog")).toHaveCount(0);
  assert.equal((await state(page)).closed, true, "새 알림이 와도 닫힌 팝업은 다시 열리지 않음");
  await page.locator(".top-nav-reminders").click();
  await expect(page.locator("#reminder-review-title")).toHaveText("alarm-b");
  await page.keyboard.press("Escape");
  await expect(page.locator("#schedule-reminder-dialog")).toHaveCount(0);
  await expect(page.locator(".top-nav-reminders")).toBeFocused();

  for (const route of ["notes", "routines", "settings"]) {
    await page.goto(base + "#/" + route);
    await ready(page);
    await count(page, 5);
    await expect(page.locator("#schedule-reminder-dialog")).toHaveCount(0);
    await page.locator(".top-nav-reminders").click();
    await expect(page.locator("#reminder-review-title")).toHaveText("alarm-b");
    await expect(page.locator("[data-reminder-task-id]")).toHaveCount(5);
    await page.keyboard.press("Escape");
    await expect(page.locator(".top-nav-reminders")).toBeFocused();
  }
  await page.reload();
  await ready(page);
  await expect(page.locator("#schedule-reminder-dialog")).toHaveCount(0);
  await count(page, 5);
  await page.locator(".top-nav-reminders").click();
  await page.reload();
  await ready(page);
  await expect(page.locator("#reminder-review-title")).toHaveText("alarm-b");
  await expect(page.locator("[data-reminder-task-id]")).toHaveCount(5);

  const beforeComplete = await readTask(page, "alarm-b");
  await page.getByRole("button", { name: "완료하기", exact: true }).click();
  await expect(page.locator('[data-reminder-task-id="alarm-b"]')).toHaveCount(0);
  const completed = await readTask(page, "alarm-b");
  assert.equal(completed.status, "DONE"); unchanged(beforeComplete, completed);
  await count(page, 4);
  await select(page, "alarm-c");
  const beforeCancel = await readTask(page, "alarm-c");
  await page.getByRole("button", { name: "추가 작업", exact: true }).click();
  await page.getByRole("button", { name: "일정 취소", exact: true }).click();
  await expect(page.locator('[data-reminder-task-id="alarm-c"]')).toHaveCount(0);
  const canceled = await readTask(page, "alarm-c");
  assert.equal(canceled.status, "CANCELED"); unchanged(beforeCancel, canceled);
  await count(page, 3);

  for (const [days, label] of [[1, "내일로 연기"], [3, "3일 뒤로 연기"], [7, "일주일 뒤로 연기"]]) {
    await select(page, "alarm-a");
    const before = await readTask(page, "alarm-a");
    await expect(page.getByRole("button", { name: label, exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "추가 작업", exact: true }).click();
    await page.getByRole("button", { name: "일정 날짜 변경", exact: true }).click();
    await expect(page.getByRole("group", { name: "일정 날짜 변경 기간", exact: true }).getByRole("button")).toHaveCount(3);
    if (days === 1) {
      for (const [width, height] of [[390, 844], [320, 640]]) {
        await page.setViewportSize({ width, height });
        for (const option of ["내일로 연기", "3일 뒤로 연기", "일주일 뒤로 연기"]) {
          const button = page.getByRole("button", { name: option, exact: true });
          await button.scrollIntoViewIfNeeded();
          await expect(button).toBeInViewport();
          assert.equal(await button.evaluate((element) => {
            const box = element.getBoundingClientRect();
            const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
            return hit === element || element.contains(hit);
          }), true, width + "px 날짜 옵션을 토스트나 다른 요소가 가리지 않음");
        }
        assert.equal(await page.locator("#schedule-reminder-dialog").evaluate((dialog) => dialog.scrollWidth > dialog.clientWidth + 1), false);
        await page.screenshot({ path: path.join(outputDir, "mobile-date-options-" + width + ".png"), fullPage: false });
      }
    }
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(page.locator('[data-reminder-task-id="alarm-a"]')).toHaveCount(0);
    const after = await readTask(page, "alarm-a");
    const expected = new Date(before.startAt); expected.setDate(expected.getDate() + days);
    assert.equal(after.startAt, expected.toISOString()); assert.equal(after.status, before.status);
    assert.equal(after.content, before.content + (before.content ? "\n\n" : "") + "[일정 연기] " + period(before) + " → " + period(after));
    assert.equal(new Date(after.endAt) - new Date(after.startAt), new Date(before.endAt) - new Date(before.startAt));
    await expect.poll(() => worker.evaluate(async () => (await chrome.alarms.get("task-reminder:alarm-a"))?.scheduledTime)).toBe(new Date(after.startAt).getTime() - 5 * 60_000);
    await expect(page.locator('[data-reminder-task-id="alarm-d"]')).toBeVisible();
    await expect(page.locator('[data-reminder-task-id="alarm-e"]')).toBeVisible();
    if (days !== 7) {
      await worker.evaluate('openPlanner("alarm-a")');
      await expect(page.locator('[data-reminder-task-id="alarm-a"]')).toBeVisible();
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });

  // A snooze changes only reminder delivery, and survives a page reload.
  await select(page, "alarm-d");
  const beforeSnooze = await readTask(page, "alarm-d");
  const snoozedAt = Date.now();
  await page.getByRole("button", { name: "30분 후 다시 알림", exact: true }).click();
  await expect(page.locator('[data-reminder-task-id="alarm-d"]')).toHaveCount(0);
  const afterSnooze = await readTask(page, "alarm-d");
  unchanged(beforeSnooze, afterSnooze); assert.equal(afterSnooze.status, beforeSnooze.status);
  await count(page, 1);
  const storedSnooze = await state(page);
  assert(storedSnooze.ids.includes("alarm-d"));
  assert(storedSnooze.snoozed["alarm-d"] >= snoozedAt + 1_790_000);
  assert(storedSnooze.snoozed["alarm-d"] <= Date.now() + 1_810_000);
  await expect.poll(() => worker.evaluate(async () => (await chrome.alarms.get("task-reminder-snooze:alarm-d"))?.scheduledTime)).toBe(storedSnooze.snoozed["alarm-d"]);
  await page.reload(); await ready(page);
  await count(page, 1);
  await expect(page.locator('[data-reminder-task-id="alarm-d"]')).toHaveCount(0);
  await expect(page.locator("#reminder-review-title")).toHaveText("alarm-e");
  await page.screenshot({ path: path.join(outputDir, "single-reminder.png"), fullPage: false });

  // Process the past schedule's UI snooze expiry before the worker fires. A
  // freshly written payload must retain it even after the UI removes snoozed[id].
  const expiryBoundary = Date.now();
  await page.evaluate(({ storageKey, when }) => {
    const current = JSON.parse(localStorage.getItem(storageKey));
    current.snoozed["alarm-d"] = when;
    localStorage.setItem(storageKey, JSON.stringify(current));
  }, { storageKey: key, when: expiryBoundary - 1_000 });
  await page.reload(); await ready(page);
  await expect.poll(async () => (await state(page)).snoozed["alarm-d"]).toBeUndefined();
  await count(page, 2);
  await expect.poll(() => worker.evaluate(async (boundary) => {
    const payload = (await chrome.storage.local.get("schedule_alarm_payload_v1")).schedule_alarm_payload_v1;
    return Date.parse(payload?.updatedAt) >= boundary && payload?.tasks.some((task) => task.id === "alarm-d");
  }, expiryBoundary)).toBe(true);

  // Advance only the disposable worker alarm and close the UI; its real alarm
  // callback must create the planner tab, rather than an in-page timer doing so.
  const fireAt = Date.now() + 3_000;
  await worker.evaluate(async ({ storageKey, when }) => {
    const stored = (await chrome.storage.local.get(storageKey))[storageKey] || {};
    await chrome.storage.local.set({ [storageKey]: { ...stored, "alarm-d": when } });
    await chrome.alarms.create("task-reminder-snooze:alarm-d", { when });
  }, { storageKey: snoozeKey, when: fireAt });
  await page.close();
  await expect.poll(() => context.pages().filter((item) => item.url().startsWith(base)).length, { timeout: 20_000 }).toBe(1);
  page = context.pages().find((item) => item.url().startsWith(base));
  await ready(page);
  await expect(page.locator('[data-reminder-task-id="alarm-d"]')).toBeVisible();
  await count(page, 2);
  unchanged(beforeSnooze, await readTask(page, "alarm-d"));
  await expect.poll(async () => (await state(page)).snoozed["alarm-d"]).toBeUndefined();

  const beforeAck = await readTask(page, "alarm-e");
  await select(page, "alarm-e");
  await page.getByRole("button", { name: "알림만 확인", exact: true }).click();
  await expect(page.locator('[data-reminder-task-id="alarm-e"]')).toHaveCount(0);
  const acknowledged = await readTask(page, "alarm-e");
  unchanged(beforeAck, acknowledged); assert.equal(acknowledged.status, beforeAck.status);
  await count(page, 1);
  await page.getByRole("button", { name: "알림만 확인", exact: true }).click();
  await expect(page.locator("#schedule-reminder-dialog")).toHaveCount(0);
  assert.deepEqual((await state(page)).ids, []);

  await page.close();
  await worker.evaluate('Promise.all([openPlanner("alarm-a"), openPlanner("alarm-e"), openPlanner("alarm-a")])');
  await expect.poll(() => context.pages().filter((item) => item.url().startsWith(base)).length).toBe(1);
  page = context.pages().find((item) => item.url().startsWith(base));
  await ready(page);
  await expect(page.locator("[data-reminder-task-id]")).toHaveCount(2);
  assert.deepEqual(new Set((await state(page)).ids), new Set(["alarm-a", "alarm-e"]));
  await worker.evaluate(async (ids) => Promise.all(ids.map((id) => openPlanner(id))), manyIds);
  await expect(page.locator("[data-reminder-task-id]")).toHaveCount(24);
  await count(page, 24); await select(page, manyIds[0], longTitle);

  for (const [width, height] of [[390, 844], [320, 640]]) {
    await page.setViewportSize({ width, height });
    await expect(page.getByRole("button", { name: "완료하기", exact: true })).toBeInViewport();
    await expect(page.getByRole("button", { name: "30분 후 다시 알림", exact: true })).toBeInViewport();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, width + "px 문서 가로 넘침 없음");
    assert.equal(await page.locator("#schedule-reminder-dialog").evaluate((dialog) => dialog.scrollWidth > dialog.clientWidth + 1), false, width + "px 팝업 가로 넘침 없음");
    const list = page.locator(".reminder-review-list");
    assert.equal(await list.evaluate((element) => element.scrollHeight > element.clientHeight + 1 && ["auto", "scroll"].includes(getComputedStyle(element).overflowY)), true, width + "px 목록 내부 스크롤");
    await list.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect(page.locator('[data-reminder-task-id="' + manyIds.at(-1) + '"]')).toBeInViewport();
    await expect(page.getByRole("button", { name: "완료하기", exact: true })).toBeInViewport();
    await page.screenshot({ path: path.join(outputDir, "mobile-inbox-" + width + ".png"), fullPage: false });
    await list.evaluate((element) => { element.scrollTop = 0; });
  }
  await close(page); await page.locator(".top-nav-reminders").click();
  await expect(page.locator("#reminder-review-title")).toHaveText(longTitle);
  const lastFocusIndex = await page.locator("#schedule-reminder-dialog").evaluate((dialog) => {
    const focusable = [...dialog.querySelectorAll("button, [href], input, select, textarea, [tabindex]")]
      .filter((element) => element.tabIndex >= 0 && !element.disabled && element.getClientRects().length > 0);
    focusable.forEach((element, index) => element.setAttribute("data-test-focus-index", String(index)));
    focusable.at(-1).focus(); return focusable.length - 1;
  });
  await page.keyboard.press("Tab");
  await expect(page.locator('[data-test-focus-index="0"]')).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.locator('[data-test-focus-index="' + lastFocusIndex + '"]')).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("#schedule-reminder-dialog")).toHaveCount(0);
  await expect(page.locator(".top-nav-reminders")).toBeFocused(); await count(page, 24);
  for (const width of [1024, 1280, 320]) {
    await page.setViewportSize({ width, height: width === 320 ? 640 : 900 });
    const header = await page.locator(".app-top-nav").evaluate((element) => {
      const bounds = (selector) => {
        const { x, y, width: boxWidth, height } = element.querySelector(selector).getBoundingClientRect();
        return { x, y, right: x + boxWidth, bottom: y + height };
      };
      const actions = element.querySelector(".top-nav-actions");
      return { brand: bounds(".top-nav-brand"), actions: bounds(".top-nav-actions"),
        overflow: element.scrollWidth > element.clientWidth + 1,
        actionsOverflow: actions.scrollWidth > actions.clientWidth + 1 };
    });
    assert.equal(header.overflow, false, width + "px 헤더 가로 넘침 없음");
    assert.equal(header.actionsOverflow, false, width + "px 헤더 버튼 영역 가로 넘침 없음");
    assert(header.actions.right <= width + 1 && header.actions.x >= 0, width + "px 헤더 버튼이 화면 안에 위치");
    const overlaps = header.brand.x < header.actions.right && header.brand.right > header.actions.x
      && header.brand.y < header.actions.bottom && header.brand.bottom > header.actions.y;
    assert.equal(overlaps, false, width + "px 브랜드와 헤더 버튼이 겹치지 않음");
    await expect(page.locator(".top-nav-reminders")).toBeInViewport();
    await page.screenshot({ path: path.join(outputDir, "header-" + width + ".png"), fullPage: false });
  }
  assert.deepEqual(errors, [], "UI 예외 없음");
  console.log("Schedule inbox: concurrent delivery, retained selection/close/reload, global routes, status/date/memo preservation, real snooze alarm and 320/390px layout/focus checks passed. Screenshots: " + outputDir);
} finally {
  await context?.close();
  // Validate the mkdtemp boundary before recursively removing the test profile.
  if (path.dirname(profile) === path.resolve(os.tmpdir()) && path.basename(profile).startsWith("planai-reminder-test-")) {
    await rm(profile, { recursive: true, force: true });
  }
}
