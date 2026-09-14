import type { Routine, RoutineInput, RoutineOccurrence } from "../models";
import { addDays, getDateKey } from "./date";

export const MAX_ROUTINES = 500;
export const MAX_ROUTINE_OCCURRENCES = 20_000;
export const isMonth = (value: string) => /^(20\d{2}|2100)-(0[1-9]|1[0-2])$/.test(value);
export function isCalendarDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && getDateKey(new Date(`${value}T12:00:00`)) === value;
}

export function validateRoutine(input: RoutineInput): RoutineInput {
  const title = input.title.trim();
  if (!title || title.length > 200) throw new Error("루틴 이름은 1~200자로 입력해 주세요.");
  if (input.content.length > 100_000) throw new Error("내용은 100,000자 이하여야 합니다.");
  if (!isMonth(input.startMonth)) throw new Error("시작 월을 2000~2100년 사이에서 선택해 주세요.");
  if (!Number.isInteger(input.intervalMonths) || input.intervalMonths < 1 || input.intervalMonths > 24) throw new Error("반복 간격은 1~24개월입니다.");
  if (!Number.isInteger(input.dayOfMonth) || input.dayOfMonth < 1 || input.dayOfMonth > 31) throw new Error("날짜는 1~31일입니다.");
  if (!Number.isInteger(input.leadDays) || input.leadDays < 0 || input.leadDays > 30) throw new Error("미리 알림은 0~30일 전으로 정해 주세요.");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)) throw new Error("일정 시간을 확인해 주세요.");
  if (!["schedule", "remind"].includes(input.mode) || typeof input.isActive !== "boolean") throw new Error("루틴 설정을 확인해 주세요.");
  if (![input.projectId, input.taskTypeId].every((id) => /^[A-Za-z0-9._:-]{1,128}$/.test(id))) throw new Error("프로젝트와 종류를 선택해 주세요.");
  return { ...input, title, content: input.content.trim() };
}

export interface RoutineCycle {
  id: string;
  period: string;
  dueDate: string;
  notifyDate: string;
  needsAttention: boolean;
  record?: RoutineOccurrence;
}

export function cycleForMonth(routine: Routine, monthIndex: number): RoutineCycle {
  const year = Math.floor(monthIndex / 12);
  const month = monthIndex % 12;
  const lastDay = new Date(year, month + 1, 0).getDate();
  const due = new Date(year, month, Math.min(routine.dayOfMonth, lastDay), 12);
  const period = `${year}-${String(month + 1).padStart(2, "0")}`;
  return { id: `${routine.id}:${period}`, period, dueDate: getDateKey(due),
    notifyDate: getDateKey(addDays(due, -routine.leadDays)), needsAttention: false };
}

export function getRoutineCycle(routine: Routine, records: RoutineOccurrence[], today = getDateKey(new Date())): RoutineCycle {
  const [year, month] = routine.startMonth.split("-").map(Number);
  const anchor = year * 12 + month - 1;
  const [todayYear, todayMonth] = today.split("-").map(Number);
  const step = Math.max(0, Math.floor((todayYear * 12 + todayMonth - 1 - anchor) / routine.intervalMonths));
  // 직전 회차와 다음 회차를 함께 살펴, 안내일이 지난 가장 최근 회차만 제안한다.
  const candidates = [Math.max(0, step - 1), step, step + 1, step + 2]
    .filter((value, index, list) => list.indexOf(value) === index)
    .map((value) => cycleForMonth(routine, anchor + value * routine.intervalMonths));
  const latest = candidates.filter((cycle) => cycle.notifyDate <= today).at(-1);
  let cycle = latest ?? candidates[0];
  const record = latest ? records.find((item) => item.id === latest.id) : undefined;
  if (record && record.status !== "snoozed") {
    cycle = candidates.find((item) => item.period > cycle.period)!;
  } else if (record?.snoozedUntil) {
    cycle = { ...cycle, notifyDate: record.snoozedUntil, record };
  }
  return { ...cycle, needsAttention: routine.isActive && cycle.notifyDate <= today };
}

export function routineFrequency(routine: Routine): string {
  const interval = routine.intervalMonths === 1 ? "매월" : routine.intervalMonths === 12 ? "매년" : `${routine.intervalMonths}개월마다`;
  return `${interval} ${routine.dayOfMonth}일`;
}
