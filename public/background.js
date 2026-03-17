const ALARM_PAYLOAD_KEY = "schedule_alarm_payload_v1";
const TASK_ALARM_PREFIX = "task-reminder:";
const MAX_SCHEDULED_ALARMS = 500;

const NOTIFICATION_ICON =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAQAAAAAYLlVAAAA7ElEQVR4Ae3XQQrCMBAF0f3/p+uKkYwGQkWkiL0S8h0S2M8w0x4J5Xk5nB6r0s6m7hYJm8+9nKk5c4REREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREZ3YB8R3pT2s7+SQAAAABJRU5ErkJggg==";

function readAlarmPayload(callback) {
  chrome.storage.local.get([ALARM_PAYLOAD_KEY], (items) => {
    callback(items[ALARM_PAYLOAD_KEY]);
  });
}

function normalizePayload(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const taskList = Array.isArray(payload.tasks)
    ? payload.tasks.filter(
        (task) =>
          task &&
          typeof task.id === "string" &&
          typeof task.title === "string" &&
          typeof task.startAt === "string" &&
          typeof task.status === "string",
      )
    : [];

  const settings = payload.settings && typeof payload.settings === "object" ? payload.settings : {};

  return {
    settings: {
      notificationsEnabled: Boolean(settings.notificationsEnabled),
      notifyBeforeMinutes: Math.max(0, Math.min(1440, Math.floor(Number(settings.notifyBeforeMinutes ?? 30)))),
    },
    tasks: taskList,
  };
}

function clearTaskAlarms(callback) {
  chrome.alarms.getAll((alarms) => {
    const targets = alarms.filter((alarm) => alarm.name.startsWith(TASK_ALARM_PREFIX));
    if (targets.length === 0) {
      callback();
      return;
    }

    let remaining = targets.length;
    for (const alarm of targets) {
      chrome.alarms.clear(alarm.name, () => {
        remaining -= 1;
        if (remaining === 0) {
          callback();
        }
      });
    }
  });
}

function scheduleTaskAlarms(payload) {
  const normalized = normalizePayload(payload);
  if (!normalized) {
    return;
  }

  clearTaskAlarms(() => {
    if (!normalized.settings.notificationsEnabled) {
      return;
    }

    const now = Date.now();
    const offsetMs = normalized.settings.notifyBeforeMinutes * 60 * 1000;

    const upcoming = normalized.tasks
      .filter((task) => task.status !== "DONE")
      .map((task) => {
        const startAt = new Date(task.startAt).getTime();
        return {
          ...task,
          remindAt: Number.isFinite(startAt) ? startAt - offsetMs : NaN,
        };
      })
      .filter((task) => Number.isFinite(task.remindAt) && task.remindAt > now)
      .sort((a, b) => a.remindAt - b.remindAt)
      .slice(0, MAX_SCHEDULED_ALARMS);

    for (const task of upcoming) {
      chrome.alarms.create(`${TASK_ALARM_PREFIX}${task.id}`, {
        when: task.remindAt,
      });
    }
  });
}

function syncAlarmsFromStorage() {
  readAlarmPayload((payload) => {
    scheduleTaskAlarms(payload);
  });
}

chrome.runtime.onInstalled.addListener(() => {
  syncAlarmsFromStorage();
});

chrome.runtime.onStartup.addListener(() => {
  syncAlarmsFromStorage();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes[ALARM_PAYLOAD_KEY]) {
    return;
  }
  scheduleTaskAlarms(changes[ALARM_PAYLOAD_KEY].newValue);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (!alarm.name.startsWith(TASK_ALARM_PREFIX)) {
    return;
  }

  const taskId = alarm.name.slice(TASK_ALARM_PREFIX.length);
  readAlarmPayload((payload) => {
    const normalized = normalizePayload(payload);
    if (!normalized?.settings.notificationsEnabled) {
      return;
    }

    const task = normalized.tasks.find((item) => item.id === taskId);
    if (!task || task.status === "DONE") {
      return;
    }

    const startAt = new Date(task.startAt);
    const startLabel = Number.isFinite(startAt.getTime())
      ? startAt.toLocaleString("ko-KR", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })
      : task.startAt;

    chrome.notifications.create(`task-notification-${task.id}-${Date.now()}`, {
      type: "basic",
      iconUrl: NOTIFICATION_ICON,
      title: "업무 일정 알림",
      message: `${task.title}\n시작: ${startLabel}`,
      priority: 2,
    });
  });
});

chrome.notifications.onClicked.addListener(() => {
  chrome.tabs.create({
    url: chrome.runtime.getURL("index.html#/dashboard"),
  });
});

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({
    url: chrome.runtime.getURL("index.html#/dashboard"),
  });
});
