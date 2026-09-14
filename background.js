const ALARM_PAYLOAD_KEY = "schedule_alarm_payload_v1";
const TASK_ALARM_PREFIX = "task-reminder:";
const MAX_PAYLOAD_TASKS = 2_000;
const MAX_SCHEDULED_ALARMS = 400;
const ALARM_BATCH_SIZE = 25;
const SYNC_DEBOUNCE_MS = 300;
const VALID_STATUSES = new Set(["NOT_DONE", "ON_HOLD", "DONE", "CANCELED"]);

async function storageGet(key) {
  const items = await chrome.storage.local.get([key]);
  return items[key];
}

function alarmGetAll() {
  return chrome.alarms.getAll();
}

async function alarmClear(name) {
  await chrome.alarms.clear(name);
}

function alarmCreate(name, when) {
  return chrome.alarms.create(name, { when });
}

function normalizePayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  const rawSettings = payload.settings && typeof payload.settings === "object" ? payload.settings : {};
  const tasks = [];
  const rawTasks = Array.isArray(payload.tasks) ? payload.tasks.slice(0, MAX_PAYLOAD_TASKS) : [];

  for (const task of rawTasks) {
    if (
      !task ||
      typeof task !== "object" ||
      typeof task.id !== "string" ||
      !/^[A-Za-z0-9._:-]{1,128}$/.test(task.id) ||
      typeof task.startAt !== "string" ||
      task.startAt.length > 40 ||
      !VALID_STATUSES.has(task.status)
    ) continue;
    tasks.push({ id: task.id, startAt: task.startAt, status: task.status });
  }

  return {
    settings: {
      notificationsEnabled: rawSettings.notificationsEnabled === true,
      notifyBeforeMinutes: Math.max(0, Math.min(1_440, Math.floor(Number(rawSettings.notifyBeforeMinutes) || 0))),
    },
    tasks,
  };
}

function buildDesiredAlarms(payload) {
  const normalized = normalizePayload(payload);
  const desired = new Map();
  if (!normalized?.settings.notificationsEnabled) return desired;

  const now = Date.now();
  const offsetMs = normalized.settings.notifyBeforeMinutes * 60_000;
  const upcoming = [];
  for (const task of normalized.tasks) {
    if (task.status === "DONE" || task.status === "CANCELED") continue;
    const startAt = new Date(task.startAt).getTime();
    const when = startAt - offsetMs;
    if (Number.isFinite(when) && when > now) upcoming.push({ id: task.id, when });
  }

  upcoming.sort((left, right) => left.when - right.when);
  for (const task of upcoming.slice(0, MAX_SCHEDULED_ALARMS)) {
    desired.set(`${TASK_ALARM_PREFIX}${task.id}`, task.when);
  }
  return desired;
}

async function runInBatches(items, operation) {
  for (let offset = 0; offset < items.length; offset += ALARM_BATCH_SIZE) {
    await Promise.all(items.slice(offset, offset + ALARM_BATCH_SIZE).map(operation));
  }
}

async function reconcileAlarms(payload) {
  const desired = buildDesiredAlarms(payload);
  const existing = (await alarmGetAll()).filter((alarm) => alarm.name.startsWith(TASK_ALARM_PREFIX));
  const existingByName = new Map(existing.map((alarm) => [alarm.name, alarm]));
  const namesToClear = existing
    .filter((alarm) => {
      const desiredTime = desired.get(alarm.name);
      return desiredTime === undefined || Math.abs((alarm.scheduledTime ?? 0) - desiredTime) > 1_000;
    })
    .map((alarm) => alarm.name);

  await runInBatches(namesToClear, alarmClear);
  const toCreate = [...desired].filter(([name, when]) => {
    const current = existingByName.get(name);
    return !current || Math.abs((current.scheduledTime ?? 0) - when) > 1_000;
  });
  await runInBatches(toCreate, ([name, when]) => alarmCreate(name, when));
}

let pendingPayload;
let debounceTimer;
let syncQueue = Promise.resolve();

function queueAlarmSync(payload) {
  pendingPayload = payload;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    const nextPayload = pendingPayload;
    pendingPayload = undefined;
    syncQueue = syncQueue
      .catch(() => undefined)
      .then(() => reconcileAlarms(nextPayload))
      .catch((error) => console.error("알람 동기화에 실패했습니다.", error));
  }, SYNC_DEBOUNCE_MS);
}

async function syncAlarmsFromStorage() {
  queueAlarmSync(await storageGet(ALARM_PAYLOAD_KEY));
}

async function lockStorageToTrustedContexts() {
  if (!chrome.storage.local.setAccessLevel) return;
  await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
}

function getPlannerUrl(taskId, currentUrl = "") {
  const params = new URLSearchParams(currentUrl.split("?")[1] || "");
  const ids = params.get("review") === "1" ? params.getAll("taskId") : [];
  if (taskId && !ids.includes(taskId)) ids.push(taskId);
  const query = new URLSearchParams();
  for (const id of ids) query.append("taskId", id);
  if (ids.length) query.set("review", "1");
  return chrome.runtime.getURL(`index.html#/dashboard${ids.length ? `?${query}` : ""}`);
}

// Serialize discovery and creation as well as URL updates. Simultaneous alarms
// must not all observe an absent tab or overwrite each other's reminder IDs.
let plannerQueue = Promise.resolve();
let plannerTabId;

async function waitForPlannerNavigation(tabId, url) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.url === url && tab.status !== "loading") return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("플래너 탭의 알림 이동을 완료하지 못했습니다.");
}

async function showPlanner(taskId, routine = false) {
  const plannerBase = chrome.runtime.getURL("index.html");
  const tabs = await chrome.tabs.query({ url: `${plannerBase}*` });
  const target = tabs
    .filter((tab) => {
      const url = tab.pendingUrl || tab.url || "";
      return typeof tab.id === "number" && (url === plannerBase || url.startsWith(`${plannerBase}#`));
    })
    .sort((a, b) => Number(b.id === plannerTabId) - Number(a.id === plannerTabId)
      || (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0];

  let tab;
  const url = routine ? chrome.runtime.getURL("index.html#/routines") : getPlannerUrl(taskId, target?.pendingUrl || target?.url);
  if (target) {
    // An activation failure is surfaced, not converted into another window.
    tab = await chrome.tabs.update(target.id, {
      active: true,
      ...(taskId || routine ? { url } : {}),
    });
  } else {
    tab = await chrome.tabs.create({ url, active: true });
  }
  plannerTabId = tab.id;
  // tabs.update resolves before navigation commits. Wait for the actual URL so
  // the next alarm reads the complete queue rather than the previous URL.
  if (taskId || routine || !target) await waitForPlannerNavigation(tab.id, url);
  const window = await chrome.windows.get(tab.windowId);
  await chrome.windows.update(tab.windowId, {
    focused: true,
    ...(window.state === "minimized" ? { state: "normal" } : {}),
  });
}

function openPlanner(taskId, routine = false) {
  plannerQueue = plannerQueue.catch(() => undefined).then(() => showPlanner(taskId, routine));
  return plannerQueue;
}

chrome.runtime.onInstalled.addListener(() => {
  void Promise.all([lockStorageToTrustedContexts(), syncAlarmsFromStorage(), queueRoutineSync()])
    .catch((error) => console.error("초기 보안 설정에 실패했습니다.", error));
});

chrome.runtime.onStartup.addListener(() => {
  void Promise.all([lockStorageToTrustedContexts(), syncAlarmsFromStorage(), queueRoutineSync()])
    .catch((error) => console.error("시작 보안 설정에 실패했습니다.", error));
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[ROUTINE_PAYLOAD_KEY]) {
    void queueRoutineSync().catch((error) => console.error("루틴 알림 동기화 실패", error));
  }
  if (areaName === "local" && changes[ALARM_PAYLOAD_KEY]) {
    queueAlarmSync(changes[ALARM_PAYLOAD_KEY].newValue);
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name.startsWith(ROUTINE_ALARM_PREFIX)) {
    void showRoutineReminder(alarm.name).catch((error) => console.error("루틴 알림 실패", error));
    return;
  }
  if (!alarm.name.startsWith(TASK_ALARM_PREFIX)) return;
  const taskId = alarm.name.slice(TASK_ALARM_PREFIX.length);
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(taskId)) return;

  void storageGet(ALARM_PAYLOAD_KEY)
    .then((payload) => {
      const normalized = normalizePayload(payload);
      const task = normalized?.tasks.find((item) => item.id === taskId);
      if (normalized?.settings.notificationsEnabled && task && task.status !== "DONE" && task.status !== "CANCELED") {
        return openPlanner(taskId);
      }
      return undefined;
    })
    .catch((error) => console.error("알람 대상을 확인하지 못했습니다.", error));
});

chrome.action.onClicked.addListener(() => {
  void openPlanner().catch((error) => console.error("플래너 탭을 열지 못했습니다.", error));
});

// 루틴 알림에는 업무 제목/본문을 저장하지 않고 회차 ID와 안내 시각만 전달한다.
const ROUTINE_PAYLOAD_KEY = "schedule_routine_payload_v1";
const ROUTINE_DELIVERED_KEY = "schedule_routine_delivered_v1";
const ROUTINE_ALARM_PREFIX = "routine-reminder:";
function normalizeRoutinePayload(value) {
  return { enabled: value?.enabled === true, items: (Array.isArray(value?.items) ? value.items : []).slice(0, 500)
    .filter((item) => item && typeof item.id === "string" && /^[A-Za-z0-9._:-]{1,180}$/.test(item.id) && typeof item.when === "number" && Number.isFinite(item.when) && item.when > 0)
    .map((item) => ({ id: item.id, when: item.when })) };
}
function normalizeDelivered(value) {
  return Array.isArray(value) ? value.filter((id) => typeof id === "string" && /^[A-Za-z0-9._:-]{1,180}$/.test(id)).slice(-2000) : [];
}
let routineSyncQueue = Promise.resolve();
function queueRoutineSync() {
  routineSyncQueue = routineSyncQueue.catch(() => undefined).then(async () => {
    const payload = normalizeRoutinePayload(await storageGet(ROUTINE_PAYLOAD_KEY));
    const delivered = new Set(normalizeDelivered(await storageGet(ROUTINE_DELIVERED_KEY)));
    const wanted = new Map((payload.enabled ? payload.items : []).filter((item) => !delivered.has(item.id))
      .sort((a, b) => a.when - b.when).slice(0, 80).map((item) => [`${ROUTINE_ALARM_PREFIX}${item.id}`, Math.max(Date.now() + 1_000, item.when)]));
    const alarms = (await alarmGetAll()).filter((alarm) => alarm.name.startsWith(ROUTINE_ALARM_PREFIX));
    await runInBatches(alarms.filter((alarm) => !wanted.has(alarm.name)), (alarm) => alarmClear(alarm.name));
    const existing = new Map(alarms.map((alarm) => [alarm.name, alarm]));
    await runInBatches([...wanted], ([name, when]) => existing.has(name) ? Promise.resolve() : alarmCreate(name, when));
  });
  return routineSyncQueue;
}
let routineDeliveryQueue = Promise.resolve();
function showRoutineReminder(name) {
  routineDeliveryQueue = routineDeliveryQueue.catch(() => undefined).then(async () => {
    const id = name.slice(ROUTINE_ALARM_PREFIX.length);
    const payload = normalizeRoutinePayload(await storageGet(ROUTINE_PAYLOAD_KEY));
    const delivered = normalizeDelivered(await storageGet(ROUTINE_DELIVERED_KEY));
    if (!payload.enabled || !payload.items.some((item) => item.id === id) || delivered.includes(id)) return;
    await openPlanner(undefined, true);
    await chrome.storage.local.set({ [ROUTINE_DELIVERED_KEY]: [...delivered, id].slice(-2000) });
    await queueRoutineSync();
  });
  return routineDeliveryQueue;
}
