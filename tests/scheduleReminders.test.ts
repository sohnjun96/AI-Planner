import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import {
  acknowledgeReminders,
  emptyReminderState,
  enqueueReminders,
  normalizeReminderIds,
  normalizeSnoozes,
  parseReminderState,
  removeReminder,
} from "../src/utils/reminderQueue";

const source = readFileSync("public/background.js", "utf8");
assert.equal(readFileSync("background.js", "utf8"), source, "Root and build worker must match");
const base = "chrome-extension://planner/index.html";
type Tab = { id: number; windowId: number; url?: string; pendingUrl?: string; lastAccessed?: number };
type Alarm = { name: string; scheduledTime: number };
interface HarnessOptions {
  consumeReviewLinks?: boolean;
  storage?: Record<string, unknown>;
  alarms?: Alarm[];
}
function harness(initial: Tab[] = [], failFocus = false, options: HarnessOptions = {}) {
  const tabs = initial.map((tab) => ({ ...tab }));
  const created: Tab[] = [];
  const focused: unknown[] = [];
  const consumedLinks: string[][] = [];
  const alarms = options.alarms?.map((alarm) => ({ ...alarm })) ?? [];
  const storage: Record<string, unknown> = {
    schedule_alarm_payload_v1: {
      settings: { notificationsEnabled: true },
      tasks: ["a", "b", "c"].map((id) => ({ id, startAt: "2026-09-12T10:00:00", status: "NOT_DONE" })),
    },
    ...options.storage,
  };
  const listeners: Record<string, (value?: unknown) => void> = {};
  const event = (name: string) => ({ addListener: (fn: (value?: unknown) => void) => { listeners[name] = fn; } });
  const context = vm.createContext({
    URLSearchParams, console, setTimeout, clearTimeout,
    chrome: {
      runtime: { getURL: (path: string) => `chrome-extension://planner/${path}`,
        onInstalled: event("installed"), onStartup: event("startup") },
      storage: { local: { get: async () => storage }, onChanged: event("changed") },
      alarms: {
        onAlarm: event("alarm"),
        getAll: async () => alarms.map((alarm) => ({ ...alarm })),
        clear: async (name: string) => {
          const index = alarms.findIndex((alarm) => alarm.name === name);
          if (index < 0) return false;
          alarms.splice(index, 1);
          return true;
        },
        create: async (name: string, value: { when: number }) => { alarms.push({ name, scheduledTime: value.when }); },
      },
      action: { onClicked: event("click") },
      tabs: {
        get: async (id: number) => {
          const tab = tabs.find((item) => item.id === id)!;
          if (tab.pendingUrl) {
            tab.url = tab.pendingUrl;
            delete tab.pendingUrl;
            if (options.consumeReviewLinks) {
              const params = new URLSearchParams(tab.url.split("?")[1]);
              if (params.get("review") === "1") {
                consumedLinks.push(params.getAll("taskId"));
                params.delete("taskId");
                params.delete("review");
                tab.url = `${tab.url.split("?")[0]}${params.size ? `?${params}` : ""}`;
              }
            }
          }
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
  return { tabs, created, focused, consumedLinks, alarms, storage, listeners, open, context };
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

const consumed = harness([], false, { consumeReviewLinks: true });
await Promise.all([consumed.open("a"), consumed.open("b"), consumed.open("c")]);
assert.equal(consumed.created.length, 1, "Consuming a review link during navigation must not create another tab");
assert.deepEqual(consumed.consumedLinks, [["a"], ["b"], ["c"]], "Every serialized delivery reaches the UI even when prior IDs have been consumed");
assert.deepEqual(ids(consumed.tabs[0]), []);
assert.equal(new URLSearchParams(consumed.tabs[0].url?.split("?")[1]).has("reminderBatch"), true,
  "A committed navigation retains the batch marker after review IDs have been consumed");
await consumed.open();
assert.equal(consumed.created.length, 1, "Toolbar activation reuses the tab after a consumed batch");
assert.deepEqual(consumed.consumedLinks, [["a"], ["b"], ["c"]], "Toolbar activation must not redeliver a consumed batch");

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

async function deliverAlarm(target: ReturnType<typeof harness>, name: string) {
  target.listeners.alarm({ name });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await vm.runInContext("plannerQueue", target.context);
}

const due = Date.now() - 1_000;
const activeSnooze = harness([], false, { storage: { schedule_reminder_snoozes_v1: { a: due } } });
await deliverAlarm(activeSnooze, "task-reminder-snooze:a");
assert.equal(activeSnooze.created.length, 1, "A due snooze alarm opens its active task");
assert.deepEqual(ids(activeSnooze.tabs[0]), ["a"]);
const pausedSnooze = harness([], false, { storage: {
  schedule_reminder_snoozes_v1: { a: due },
  schedule_alarm_payload_v1: {
    settings: { notificationsEnabled: true },
    tasks: [{ id: "a", startAt: "2026-09-12T10:00:00", status: "ON_HOLD" }],
  },
} });
await deliverAlarm(pausedSnooze, "task-reminder-snooze:a");
assert.equal(pausedSnooze.created.length, 1, "An on-hold schedule remains eligible for its saved snooze");

for (const invalidWhen of [undefined, null, false, "1234", Number.NaN, Infinity, 0, -1, Date.now() + 60_000]) {
  const invalidSnooze = harness([], false, { storage: { schedule_reminder_snoozes_v1: { a: invalidWhen } } });
  await deliverAlarm(invalidSnooze, "task-reminder-snooze:a");
  assert.equal(invalidSnooze.created.length, 0, `An invalid or future snooze timestamp must not deliver (${String(invalidWhen)})`);
}

const inheritedSnooze = harness([], false, {
  storage: { schedule_reminder_snoozes_v1: Object.create({ a: due }) as Record<string, number> },
});
await deliverAlarm(inheritedSnooze, "task-reminder-snooze:a");
assert.equal(inheritedSnooze.created.length, 0, "Inherited object properties must not be accepted as saved snoozes");

for (const status of ["DONE", "CANCELED"]) {
  const inactiveSnooze = harness([], false, { storage: {
    schedule_reminder_snoozes_v1: { a: due },
    schedule_alarm_payload_v1: {
      settings: { notificationsEnabled: true },
      tasks: [{ id: "a", startAt: "2026-09-12T10:00:00", status }],
    },
  } });
  await deliverAlarm(inactiveSnooze, "task-reminder-snooze:a");
  assert.equal(inactiveSnooze.created.length, 0, `${status} tasks must not be redelivered by an old snooze alarm`);
}

for (const payload of [
  { settings: { notificationsEnabled: false }, tasks: [{ id: "a", startAt: "2026-09-12T10:00:00", status: "NOT_DONE" }] },
  { settings: { notificationsEnabled: true }, tasks: [] },
  null,
]) {
  const unavailableSnooze = harness([], false, { storage: {
    schedule_reminder_snoozes_v1: { a: due },
    schedule_alarm_payload_v1: payload,
  } });
  await deliverAlarm(unavailableSnooze, "task-reminder-snooze:a");
  assert.equal(unavailableSnooze.created.length, 0, "Disabled notifications or a deleted/invalid task must prevent snooze delivery");
}

const invalidAlarmId = harness([], false, { storage: { schedule_reminder_snoozes_v1: { "bad/id": due } } });
await deliverAlarm(invalidAlarmId, "task-reminder-snooze:bad/id");
assert.equal(invalidAlarmId.created.length, 0, "Invalid alarm IDs must be rejected before opening a tab");

const separateAlarms = harness([], false, { alarms: [
  { name: "task-reminder:a", scheduledTime: due },
  { name: "task-reminder-snooze:a", scheduledTime: due },
  { name: "routine-reminder:example", scheduledTime: due },
] });
await vm.runInContext("reconcileAlarms({ settings: { notificationsEnabled: false }, tasks: [] })", separateAlarms.context);
assert.deepEqual(separateAlarms.alarms.map((alarm) => alarm.name), ["task-reminder-snooze:a", "routine-reminder:example"],
  "Normal schedule reconciliation must leave independently managed snooze and routine alarms intact");

assert.deepEqual(emptyReminderState(), { version: 1, ids: [], snoozed: {}, closed: false, selectedId: "" });
assert.notEqual(emptyReminderState().ids, emptyReminderState().ids, "Each empty queue owns its array");
assert.deepEqual(normalizeReminderIds(["a", "b", "a", "", "bad/id", "has space", 1, null, "x".repeat(129)]), ["a", "b"]);
assert.deepEqual(normalizeReminderIds(null), []);
assert.deepEqual(normalizeReminderIds({ a: true }), []);
const cappedIds = normalizeReminderIds(Array.from({ length: 2_100 }, (_, index) => `task-${index}`));
assert.equal(cappedIds.length, 2_000, "Persisted queues are bounded");
assert.equal(cappedIds.at(-1), "task-1999");
assert.deepEqual(normalizeSnoozes({ a: due, b: 0, c: -1, d: Number.NaN, e: Infinity, f: "1234", "bad/id": due }), { a: due });
assert.deepEqual(normalizeSnoozes([due]), {});
assert.deepEqual(normalizeSnoozes(null), {});
assert.equal(Object.keys(normalizeSnoozes(Object.fromEntries(
  Array.from({ length: 2_100 }, (_, index) => [`task-${index}`, due]),
))).length, 2_000, "Persisted snooze maps are bounded");

for (const raw of [null, "", "{", "null", "[]", "true", '{"version":2,"ids":["a"]}']) {
  assert.deepEqual(parseReminderState(raw), emptyReminderState(), "Invalid or unsupported persisted state safely starts an empty queue");
}
const parsed = parseReminderState(JSON.stringify({
  version: 1,
  ids: ["a", "b", "a", "bad/id", null],
  snoozed: { a: due, b: "1234", missing: due },
  closed: "true",
  selectedId: "missing",
}));
assert.deepEqual(parsed, { version: 1, ids: ["a", "b"], snoozed: { a: due }, closed: false, selectedId: "a" },
  "Restoration deduplicates IDs, drops orphan/invalid snoozes, and repairs selection without coercing closed state");
assert.equal(parseReminderState(JSON.stringify({ ...parsed, closed: true, selectedId: "b" })).selectedId, "b");
assert.equal(parseReminderState(JSON.stringify({ ...parsed, closed: true })).closed, true);

const initialQueue = enqueueReminders(emptyReminderState(), ["a", "b", "a"]);
assert.deepEqual(initialQueue.ids, ["a", "b"]);
assert.equal(initialQueue.selectedId, "a");
assert.equal(initialQueue.closed, false);
assert.equal(enqueueReminders(initialQueue, ["b", "a"]), initialQueue, "Duplicate deliveries do not recreate queue state");
const closedQueue = { ...initialQueue, selectedId: "b", closed: true };
const laterQueue = enqueueReminders(closedQueue, ["c", "a"]);
assert.deepEqual(laterQueue.ids, ["a", "b", "c"]);
assert.equal(laterQueue.selectedId, "b", "Later deliveries preserve the selected schedule");
assert.equal(laterQueue.closed, true, "Later deliveries do not reopen a dismissed popup");
assert.equal(enqueueReminders({ ...emptyReminderState(), closed: true }, ["a"]).closed, false,
  "The first reminder in an empty queue can open a new popup");

const snapshot = [...closedQueue.ids];
const snapshotWithArrivals = enqueueReminders({ ...closedQueue, snoozed: { a: due, d: due } }, ["c", "d"]);
const afterSnapshot = acknowledgeReminders(snapshotWithArrivals, snapshot);
assert.deepEqual(afterSnapshot.ids, ["c", "d"], "Acknowledge-all removes its snapshot while preserving later arrivals");
assert.deepEqual(afterSnapshot.snoozed, { d: due }, "Acknowledgement clears snoozes only for removed reminders");
assert.equal(afterSnapshot.selectedId, "c", "Selection advances to a remaining reminder that is not snoozed");
assert.equal(afterSnapshot.closed, true);
assert.equal(acknowledgeReminders(laterQueue, ["a"]).selectedId, "b", "Acknowledging another item preserves the selected schedule");
assert.equal(acknowledgeReminders(laterQueue, ["missing"]), laterQueue, "Acknowledging an absent ID does not recreate queue state");
assert.equal(acknowledgeReminders(laterQueue, []), laterQueue);
assert.equal(acknowledgeReminders({ ...initialQueue, snoozed: { b: due } }, ["a"]).selectedId, "",
  "A queue containing only snoozed reminders does not choose a hidden selection");
const prototypeNamedQueue = enqueueReminders(emptyReminderState(), ["a", "constructor", "toString", "__proto__"]);
assert.equal(acknowledgeReminders(prototypeNamedQueue, ["a"]).selectedId, "constructor",
  "Valid IDs matching object prototype names remain selectable unless they have an own snooze entry");

let params = new URLSearchParams("taskId=a&taskId=b&taskId=c&review=1");
params = removeReminder(params, "a");
assert.deepEqual(params.getAll("taskId"), ["b", "c"]);
assert.equal(params.get("review"), "1");
params = removeReminder(params, "b");
params = removeReminder(params, "c");
assert.equal(params.has("taskId"), false);
assert.equal(params.has("review"), false);
process.stdout.write("Schedule reminder regression checks passed.\n");
