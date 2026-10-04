export const SCHEDULE_REMINDER_STORAGE_KEY = "planai_schedule_reminders_v1";
export const SCHEDULE_SNOOZE_STORAGE_KEY = "schedule_reminder_snoozes_v1";
export const SCHEDULE_SNOOZE_ALARM_PREFIX = "task-reminder-snooze:";
const MAX_REMINDERS = 2_000;
const REMINDER_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export interface ScheduleReminderState {
  version: 1;
  ids: string[];
  snoozed: Record<string, number>;
  closed: boolean;
  selectedId: string;
}

export function emptyReminderState(): ScheduleReminderState {
  return { version: 1, ids: [], snoozed: {}, closed: false, selectedId: "" };
}

export function normalizeReminderIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === "string" && REMINDER_ID.test(id)))].slice(0, MAX_REMINDERS);
}

export function normalizeSnoozes(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([id, when]) => REMINDER_ID.test(id)
    && typeof when === "number" && Number.isFinite(when) && when > 0).slice(0, MAX_REMINDERS));
}

export function parseReminderState(raw: string | null): ScheduleReminderState {
  try {
    const value = raw ? JSON.parse(raw) : null;
    if (!value || value.version !== 1) return emptyReminderState();
    const ids = normalizeReminderIds(value.ids);
    const snoozed = Object.fromEntries(Object.entries(normalizeSnoozes(value.snoozed)).filter(([id]) => ids.includes(id)));
    return { version: 1, ids, snoozed, closed: value.closed === true,
      selectedId: ids.includes(value.selectedId) ? value.selectedId : ids[0] ?? "" };
  } catch {
    return emptyReminderState();
  }
}

export function enqueueReminders(state: ScheduleReminderState, incoming: string[]): ScheduleReminderState {
  const ids = normalizeReminderIds([...state.ids, ...incoming]);
  if (ids.length === state.ids.length && ids.every((id, index) => id === state.ids[index])) return state;
  return { ...state, ids, closed: state.ids.length ? state.closed : false,
    selectedId: state.selectedId || ids[0] || "" };
}

/** A batch acknowledges only its snapshot, leaving later arrivals in the queue. */
export function acknowledgeReminders(state: ScheduleReminderState, acknowledged: string[]): ScheduleReminderState {
  const removed = new Set(acknowledged);
  const ids = state.ids.filter((id) => !removed.has(id));
  if (ids.length === state.ids.length) return state;
  return { ...state, ids,
    snoozed: Object.fromEntries(Object.entries(state.snoozed).filter(([id]) => !removed.has(id))),
    selectedId: ids.includes(state.selectedId) ? state.selectedId : ids.find((id) => !Object.hasOwn(state.snoozed, id)) ?? "" };
}

/** Remove only the acknowledged reminder, preserving concurrently queued IDs. */
export function removeReminder(params: URLSearchParams, taskId: string): URLSearchParams {
  const next = new URLSearchParams(params);
  const remaining = next.getAll("taskId").filter((id) => id !== taskId);
  next.delete("taskId");
  for (const id of remaining) next.append("taskId", id);
  if (!remaining.length) next.delete("review");
  return next;
}
