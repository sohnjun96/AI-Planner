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

function getPlannerUrl(taskId) {
  const query = taskId ? `?taskId=${encodeURIComponent(taskId)}&review=1` : "";
  return chrome.runtime.getURL(`index.html#/dashboard${query}`);
}

function openPlanner(taskId) {
  return chrome.tabs.create({ url: getPlannerUrl(taskId) });
}

chrome.runtime.onInstalled.addListener(() => {
  void Promise.all([lockStorageToTrustedContexts(), syncAlarmsFromStorage()])
    .catch((error) => console.error("초기 보안 설정에 실패했습니다.", error));
});

chrome.runtime.onStartup.addListener(() => {
  void Promise.all([lockStorageToTrustedContexts(), syncAlarmsFromStorage()])
    .catch((error) => console.error("시작 보안 설정에 실패했습니다.", error));
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[ALARM_PAYLOAD_KEY]) {
    queueAlarmSync(changes[ALARM_PAYLOAD_KEY].newValue);
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
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
