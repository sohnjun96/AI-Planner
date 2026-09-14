import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import path from "node:path";

const extension = path.resolve("dist");
const context = await chromium.launchPersistentContext("", {
  channel: "chromium", headless: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  const base = worker.url().replace(/\/background\.js$/, "/index.html");
  const page = await context.newPage();
  await page.goto(`${base}#/dashboard`);
  await page.waitForFunction(() => document.querySelector("main") && !document.querySelector(".loading-screen"));
  await worker.evaluate(async () => {
    await chrome.storage.local.set({ schedule_routine_payload_v1: { enabled: true, items: [{ id: "routine:test:2026-09:2026-09-12", when: Date.now() + 60_000 }] } });
    await queueRoutineSync();
  });
  await expect.poll(() => worker.evaluate(async () => (await chrome.alarms.getAll()).filter((item) => item.name.startsWith("routine-reminder:")).length)).toBe(1);
  const pageCount = context.pages().length;
  await worker.evaluate('showRoutineReminder("routine-reminder:routine:test:2026-09:2026-09-12")');
  await expect(page.getByRole("heading", { name: "나의 루틴", exact: true })).toBeVisible();
  assert.equal(context.pages().length, pageCount, "기존 탭 재사용");
  await page.getByRole("link", { name: "대시보드", exact: true }).click();
  await worker.evaluate('showRoutineReminder("routine-reminder:routine:test:2026-09:2026-09-12")');
  await expect(page).toHaveURL(/#\/dashboard/);
  await worker.evaluate(async () => {
    await chrome.storage.local.set({ schedule_routine_payload_v1: { enabled: true, items: [{ id: "routine:test:2026-09:2026-09-15", when: Date.now() + 86_400_000 }] } });
    await queueRoutineSync();
  });
  await expect.poll(() => worker.evaluate(async () => (await chrome.alarms.getAll()).filter((item) => item.name.startsWith("routine-reminder:")).map((item) => item.name))).toEqual(["routine-reminder:routine:test:2026-09:2026-09-15"]);
  await worker.evaluate(async () => { await chrome.alarms.clearAll(); await queueRoutineSync(); });
  await expect.poll(() => worker.evaluate(async () => (await chrome.alarms.getAll()).length)).toBe(1);
  await worker.evaluate(async () => { await chrome.storage.local.set({ schedule_routine_payload_v1: { enabled: false, items: [] } }); await queueRoutineSync(); });
  await expect.poll(() => worker.evaluate(async () => (await chrome.alarms.getAll()).length)).toBe(0);
  console.log("Routine extension: alarm scheduling, existing tab routing, duplicate suppression, snooze replacement, restart sync and disabling passed.");
} finally { await context.close(); }
