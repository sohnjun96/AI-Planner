import { emptyReminderState, normalizeSnoozes, SCHEDULE_REMINDER_STORAGE_KEY, SCHEDULE_SNOOZE_ALARM_PREFIX, SCHEDULE_SNOOZE_STORAGE_KEY } from "./reminderQueue";

interface ReminderChromeApi {
  storage?: { local?: {
    get: (keys: string[]) => Promise<Record<string, unknown>>;
    set: (items: Record<string, unknown>) => Promise<void>;
  } };
  alarms?: {
    create: (name: string, info: { when: number }) => Promise<void> | void;
    clear: (name: string) => Promise<boolean>;
  };
}

function extensionApi() {
  return (globalThis as typeof globalThis & { chrome?: ReminderChromeApi }).chrome;
}

// Serialize writes so simultaneous acknowledgements cannot replace another snooze.
let updates = Promise.resolve();
export function scheduleReminderSnooze(id: string, when: number): Promise<void> {
  const operation = updates.catch(() => undefined).then(async () => {
    const api = extensionApi();
    if (!api?.storage?.local || !api.alarms) return;
    const stored = await api.storage.local.get([SCHEDULE_SNOOZE_STORAGE_KEY]);
    const previous = normalizeSnoozes(stored[SCHEDULE_SNOOZE_STORAGE_KEY]);
    await api.storage.local.set({ [SCHEDULE_SNOOZE_STORAGE_KEY]: { ...previous, [id]: when } });
    try {
      await api.alarms.create(`${SCHEDULE_SNOOZE_ALARM_PREFIX}${id}`, { when });
    } catch (error) {
      await api.storage.local.set({ [SCHEDULE_SNOOZE_STORAGE_KEY]: previous });
      throw error;
    }
  });
  updates = operation;
  return operation;
}

export function clearReminderSnoozes(ids: string[]): Promise<void> {
  if (!ids.length) return Promise.resolve();
  const operation = updates.catch(() => undefined).then(async () => {
    const api = extensionApi();
    if (!api?.storage?.local || !api.alarms) return;
    await clearStoredSnoozes(api, ids);
  });
  updates = operation;
  return operation;
}

async function clearStoredSnoozes(api: ReminderChromeApi, ids?: string[]): Promise<void> {
  const stored = await api.storage!.local!.get([SCHEDULE_SNOOZE_STORAGE_KEY]);
  const previous = normalizeSnoozes(stored[SCHEDULE_SNOOZE_STORAGE_KEY]);
  const removed = new Set(ids ?? Object.keys(previous));
  await api.storage!.local!.set({ [SCHEDULE_SNOOZE_STORAGE_KEY]: Object.fromEntries(
    Object.entries(previous).filter(([id]) => !removed.has(id)),
  ) });
  await Promise.all([...removed].map((id) => api.alarms!.clear(`${SCHEDULE_SNOOZE_ALARM_PREFIX}${id}`)));
}

export async function resetScheduleReminders(): Promise<void> {
  try { window.localStorage.setItem(SCHEDULE_REMINDER_STORAGE_KEY, JSON.stringify(emptyReminderState())); }
  catch { /* The mounted queue is also reset when storage is unavailable. */ }
  window.dispatchEvent(new Event("ai-planner:data-restored"));
  const operation = updates.catch(() => undefined).then(async () => {
    const api = extensionApi();
    if (api?.storage?.local && api.alarms) await clearStoredSnoozes(api);
  });
  updates = operation;
  await operation;
}
