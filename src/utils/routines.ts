import type { Routine, RoutineInput, RoutineOccurrence, RoutineRecurrence } from "../models";
import { getDateKey } from "./date";
import { generateRoutineDates, getLatestRoutineDate, isRoutineDate, shiftRoutineDate, summarizeRoutineRule, validateRoutineRecurrence } from "./routineRecurrence";
import type { RoutineDateOccurrence } from "./routineRecurrence";
export { generateRoutineDates, summarizeRoutineRule, validateRoutineRecurrence } from "./routineRecurrence";

export const MAX_ROUTINES = 500;
export const MAX_ROUTINE_OCCURRENCES = 20_000;
export const isMonth = (value: unknown): value is string => typeof value === "string" && /^(20\d{2}|2100)-(0[1-9]|1[0-2])$/.test(value);
export const isCalendarDate = isRoutineDate;

export function createDefaultRoutineRule(date = getDateKey(new Date())): RoutineRecurrence {
  const startDate = isRoutineDate(date) ? date : "2026-10-01";
  const value = new Date(`${startDate}T00:00:00Z`);
  return { frequency: "monthly", interval: 1, startDate, weekdays: [((value.getUTCDay() + 6) % 7) + 1],
    months: [value.getUTCMonth() + 1], monthMode: "dates", monthDays: [value.getUTCDate()], ordinal: 1,
    ordinalWeekdays: [((value.getUTCDay() + 6) % 7) + 1], missingDate: "clamp", weekend: "none", excludeDates: [], end: { type: "never" } };
}

/** Recurrence is authoritative; monthly fields are read only for older data. */
export function getRoutineRule(routine: Routine | RoutineInput): RoutineRecurrence {
  if (routine.recurrence !== undefined) return validateRoutineRecurrence(routine.recurrence);
  if (!isMonth(routine.startMonth)) throw new Error("시작 월을 2000~2100년 사이에서 선택해 주세요.");
  if (!Number.isInteger(routine.intervalMonths) || routine.intervalMonths! < 1 || routine.intervalMonths! > 24) throw new Error("반복 간격은 1~24개월입니다.");
  if (!Number.isInteger(routine.dayOfMonth) || routine.dayOfMonth! < 1 || routine.dayOfMonth! > 31) throw new Error("날짜는 1~31일입니다.");
  return validateRoutineRecurrence({ ...createDefaultRoutineRule(`${routine.startMonth}-01`),
    interval: routine.intervalMonths, monthDays: [routine.dayOfMonth] });
}

export function validateRoutine(input: RoutineInput): RoutineInput {
  if (!input || typeof input.title !== "string" || typeof input.content !== "string") throw new Error("루틴 이름과 내용을 확인해 주세요.");
  const title = input.title.trim();
  if (!title || title.length > 200) throw new Error("루틴 이름은 1~200자로 입력해 주세요.");
  if (input.content.length > 100_000) throw new Error("내용은 100,000자 이하여야 합니다.");
  const recurrence = getRoutineRule(input);
  if (!Number.isInteger(input.leadDays) || input.leadDays < 0 || input.leadDays > 30) throw new Error("미리 알림은 0~30일 전으로 정해 주세요.");
  if (typeof input.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)) throw new Error("일정 시간을 확인해 주세요.");
  if (!["schedule", "remind", "auto"].includes(input.mode) || typeof input.isActive !== "boolean") throw new Error("루틴 설정을 확인해 주세요.");
  if (![input.projectId, input.taskTypeId].every(id => typeof id === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(id))) throw new Error("프로젝트와 종류를 선택해 주세요.");
  return { title, content: input.content.trim(), recurrence, projectId: input.projectId, taskTypeId: input.taskTypeId,
    time: input.time, leadDays: input.leadDays, mode: input.mode, isActive: input.isActive };
}

export interface RoutineCycle {
  id: string;
  period: string;
  dueDate: string;
  notifyDate: string;
  needsAttention: boolean;
  record?: RoutineOccurrence;
  ended?: boolean;
  sourceDates?: string[];
  adjusted?: boolean;
}

function cycleForDate(routine: Routine, item: RoutineDateOccurrence, today: string): RoutineCycle {
  const notifyDate = shiftRoutineDate(item.date, -routine.leadDays);
  return { id: `${routine.id}:${item.date}`, period: item.date, dueDate: item.date, notifyDate,
    sourceDates: item.sourceDates, adjusted: item.adjusted, needsAttention: routine.isActive && notifyDate <= today };
}

/** Retained for callers that need a legacy monthly date; IDs use actual dates. */
export function cycleForMonth(routine: Routine, monthIndex: number): RoutineCycle {
  const year = Math.floor(monthIndex / 12), month = monthIndex % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const rule = getRoutineRule(routine);
  const firstDay = rule.monthDays.find((day): day is number => typeof day === "number");
  const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(Math.min(routine.dayOfMonth ?? firstDay ?? lastDay, lastDay)).padStart(2, "0")}`;
  return cycleForDate(routine, { date, sourceDates: [date], adjusted: false }, "");
}

function recordMap(routine: Routine, records: RoutineOccurrence[]): Map<string, RoutineOccurrence> {
  const result = new Map<string, RoutineOccurrence>();
  for (const record of records) {
    if (record.routineId !== routine.id || !isRoutineDate(record.dueDate)) continue;
    const prior = result.get(record.dueDate);
    if (!prior || prior.updatedAt <= record.updatedAt) result.set(record.dueDate, record);
  }
  return result;
}

/** Includes today; handled and explicitly snoozed dates keep their stored state. */
export function getRoutinePreview(routine: Routine, records: RoutineOccurrence[], today = getDateKey(new Date()), limit = 5): RoutineCycle[] {
  if (!isRoutineDate(today) || !Number.isInteger(limit) || limit < 1 || limit > 1000) return [];
  const rule = getRoutineRule(routine);
  const stored = recordMap(routine, records);
  const preview: RoutineCycle[] = [];
  let fromDate = today;
  // Query small chunks, advancing from the last actual date. Count ends are
  // still evaluated from the original start by the pure recurrence engine.
  while (preview.length < limit) {
    const dates = generateRoutineDates(rule, { fromDate, limit: Math.min(1000, Math.max(5, limit - preview.length + 1)) });
    if (!dates.length) break;
    for (const item of dates) {
      if (!stored.has(item.date)) preview.push(cycleForDate(routine, item, today));
      if (preview.length >= limit) break;
    }
    const next = shiftRoutineDate(dates.at(-1)!.date, 1);
    if (!isRoutineDate(next)) break;
    fromDate = next;
  }
  return preview;
}

export function getRoutineCycle(routine: Routine, records: RoutineOccurrence[], today = getDateKey(new Date())): RoutineCycle {
  const ended: RoutineCycle = { id: "", period: "", dueDate: "", notifyDate: "", needsAttention: false, ended: true };
  if (!isRoutineDate(today)) return ended;
  const stored = recordMap(routine, records);
  // Explicit deferrals survive later periods and even edits to the rule.
  const matured = [...stored.values()].filter(record => record.status === "snoozed" && isRoutineDate(record.snoozedUntil) && record.snoozedUntil <= today)
    .sort((a, b) => a.snoozedUntil!.localeCompare(b.snoozedUntil!) || a.dueDate.localeCompare(b.dueDate));
  if (matured.length) {
    const record = matured[0];
    return { id: `${routine.id}:${record.dueDate}`, period: record.dueDate, dueDate: record.dueDate,
      notifyDate: record.snoozedUntil!, needsAttention: routine.isActive, record };
  }
  const rule = getRoutineRule(routine);
  const latest = getLatestRoutineDate(rule, today);
  // Only the latest actual past date is eligible. A handled latest date never
  // causes an older missed date to become active again.
  if (latest && !stored.has(latest.date)) return cycleForDate(routine, latest, today);
  const futureFrom = shiftRoutineDate(today, 1);
  const future = isRoutineDate(futureFrom) ? getRoutinePreview(routine, records, futureFrom, 1)[0] : undefined;
  if (future) return { ...future, needsAttention: routine.isActive && future.notifyDate <= today };
  const deferred = [...stored.values()].filter(record => record.status === "snoozed" && isRoutineDate(record.snoozedUntil) && record.snoozedUntil > today)
    .sort((a, b) => a.snoozedUntil!.localeCompare(b.snoozedUntil!) || a.dueDate.localeCompare(b.dueDate))[0];
  if (deferred) return { id: `${routine.id}:${deferred.dueDate}`, period: deferred.dueDate, dueDate: deferred.dueDate,
    notifyDate: deferred.snoozedUntil!, needsAttention: false, record: deferred };
  return ended;
}

export function routineFrequency(routine: Routine): string {
  return summarizeRoutineRule(getRoutineRule(routine));
}
