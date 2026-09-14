import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { removeReminder } from "../src/utils/reminderQueue";

const source = readFileSync("public/background.js", "utf8");
assert.equal(readFileSync("background.js", "utf8"), source, "Root and build worker must match");
const base = "chrome-extension://planner/index.html";
type Tab = { id: number; windowId: number; url?: string; pendingUrl?: string; lastAccessed?: number };
function harness(initial: Tab[] = [], failFocus = false) {
  const tabs = initial.map((tab) => ({ ...tab }));
  const created: Tab[] = [];
  const focused: unknown[] = [];
  const listeners: Record<string, (value?: unknown) => void> = {};
  const event = (name: string) => ({ addListener: (fn: (value?: unknown) => void) => { listeners[name] = fn; } });
  const context = vm.createContext({
    URLSearchParams, console, setTimeout, clearTimeout,
    chrome: {
      runtime: { getURL: (path: string) => `chrome-extension://planner/${path}`,
        onInstalled: event("installed"), onStartup: event("startup") },
      storage: { local: { get: async () => ({ schedule_alarm_payload_v1: {
        settings: { notificationsEnabled: true },
        tasks: ["a", "b", "c"].map((id) => ({ id, startAt: "2026-09-12T10:00:00", status: "NOT_DONE" })),
      } }) }, onChanged: event("changed") },
      alarms: { onAlarm: event("alarm") }, action: { onClicked: event("click") },
      tabs: {
        get: async (id: number) => {
          const tab = tabs.find((item) => item.id === id)!;
          if (tab.pendingUrl) { tab.url = tab.pendingUrl; delete tab.pendingUrl; }
          return { ...tab, status: "complete" };
        },
        query: async () => { await new Promise((resolve) => setTimeout(resolve, 1)); return tabs.map((tab) => ({ ...tab })); },
        create: async ({ url }: { url: string }) => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          const tab = { id: 100 + created.length, windowId: 1, pendingUrl: url };
          tabs.push(tab); created.push(tab); return { ...tab };
        },
        update: async (id: number, change: { url?: string }) => {
          const tab = tabs.find((item) => item.id === id)!;
          if (change.url) tab.pendingUrl = change.url;
          return { ...tab };
        },
      },
      windows: {
        get: async () => ({ state: "minimized" }),
        update: async (id: number, change: unknown) => {
          if (failFocus) throw new Error("Focus unavailable");
          focused.push({ id, change: structuredClone(change) });
        },
      },
    },
  });
  vm.runInContext(source, context);
  const open = (id?: string): Promise<void> => vm.runInContext(`openPlanner(${JSON.stringify(id)})`, context);
  return { tabs, created, focused, listeners, open, context };
}
const ids = (tab: Tab) => new URLSearchParams((tab.pendingUrl || tab.url || "").split("?")[1]).getAll("taskId");
const existing = harness([{ id: 7, windowId: 3, url: `${base}#/notes` }, { id: 8, windowId: 4 }]);
await Promise.all([existing.open("a"), existing.open("b"), existing.open("c")]);
assert.equal(existing.created.length, 0);
assert.deepEqual(ids(existing.tabs[0]), ["a", "b", "c"]);
assert.deepEqual(existing.focused[0], { id: 3, change: { focused: true, state: "normal" } });

const empty = harness();
await Promise.all([empty.open("a"), empty.open("b"), empty.open("a"), empty.open("c")]);
assert.equal(empty.created.length, 1, "Concurrent alarms create only one tab, even before navigation commits");
assert.deepEqual(ids(empty.tabs[0]), ["a", "b", "c"]);
await empty.open();
assert.deepEqual(ids(empty.tabs[0]), ["a", "b", "c"], "Toolbar click preserves reminders");
empty.tabs[0].url = `${base}#/dashboard?taskId=b&taskId=c&review=1`;
delete empty.tabs[0].pendingUrl;
await empty.open("a");
assert.deepEqual(ids(empty.tabs[0]), ["b", "c", "a"], "Acknowledged IDs may be scheduled again");

const failed = harness([{ id: 7, windowId: 3, url: base }], true);
await assert.rejects(failed.open("a"), /Focus unavailable/);
await assert.rejects(failed.open("b"), /Focus unavailable/);
assert.equal(failed.created.length, 0, "Focus errors must never spawn duplicate windows");
assert.deepEqual(ids(failed.tabs[0]), ["a", "b"]);

const events = harness();
events.listeners.alarm({ name: "task-reminder:a" });
events.listeners.alarm({ name: "task-reminder:b" });
await new Promise((resolve) => setTimeout(resolve, 0));
await vm.runInContext("plannerQueue", events.context);
assert.equal(events.created.length, 1);
assert.deepEqual(ids(events.tabs[0]), ["a", "b"]);

let params = new URLSearchParams("taskId=a&taskId=b&taskId=c&review=1");
params = removeReminder(params, "a");
assert.deepEqual(params.getAll("taskId"), ["b", "c"]);
assert.equal(params.get("review"), "1");
params = removeReminder(params, "b");
params = removeReminder(params, "c");
assert.equal(params.has("taskId"), false);
assert.equal(params.has("review"), false);
process.stdout.write("Schedule reminder regression checks passed.\n");
