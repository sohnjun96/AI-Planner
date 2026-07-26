const ALARM_PAYLOAD_KEY = "schedule_alarm_payload_v1";
const TASK_ALARM_PREFIX = "task-reminder:";
const MAX_SCHEDULED_ALARMS = 500;

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
      notifyBeforeMinutes: Math.max(0, Math.min(1440, Math.floor(Number(settings.notifyBeforeMinutes ?? 5)))),
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

function getPlannerUrl(taskId) {
  const taskQuery = taskId ? `?taskId=${encodeURIComponent(taskId)}&review=1` : "";
  return chrome.runtime.getURL(`index.html#/dashboard${taskQuery}`);
}

function createPlannerWindow(taskId) {
  chrome.windows.create({
    url: getPlannerUrl(taskId),
    type: "normal",
    focused: true,
  });
}

function focusPlannerTab(tab, taskId) {
  if (typeof tab.id !== "number" || typeof tab.windowId !== "number") {
    createPlannerWindow(taskId);
    return;
  }

  chrome.tabs.update(tab.id, { active: true, url: getPlannerUrl(taskId) }, () => {
    if (chrome.runtime.lastError) {
      createPlannerWindow(taskId);
      return;
    }

    chrome.windows.get(tab.windowId, (targetWindow) => {
      if (chrome.runtime.lastError || !targetWindow) {
        createPlannerWindow(taskId);
        return;
      }

      const focusWindow = () => {
        chrome.windows.update(tab.windowId, { focused: true });
      };

      if (targetWindow.state === "minimized") {
        chrome.windows.update(tab.windowId, { state: "normal" }, () => {
          if (chrome.runtime.lastError) {
            createPlannerWindow(taskId);
            return;
          }
          focusWindow();
        });
        return;
      }

      focusWindow();
    });
  });
}

function showPlannerWindow(taskId) {
  chrome.tabs.query({ url: chrome.runtime.getURL("index.html*") }, (tabs) => {
    if (chrome.runtime.lastError) {
      createPlannerWindow(taskId);
      return;
    }

    const targetTab = tabs
      .filter((tab) => typeof tab.id === "number" && typeof tab.windowId === "number")
      .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0];

    if (!targetTab) {
      createPlannerWindow(taskId);
      return;
    }

    focusPlannerTab(targetTab, taskId);
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

    showPlannerWindow(task.id);
  });
});

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({
    url: chrome.runtime.getURL("index.html#/dashboard"),
  });
});
