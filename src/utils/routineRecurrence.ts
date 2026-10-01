import type { RoutineRecurrence } from "../models";

const DAY = 86_400_000;
const MIN_DATE = "2000-01-01";
const MAX_DATE = "2100-12-31";
const RULE_KEYS = new Set(["frequency", "interval", "startDate", "weekdays", "months", "monthMode", "monthDays", "ordinal", "ordinalWeekdays", "missingDate", "weekend", "excludeDates", "end"]);
const WEEKDAYS = ["월요일", "화요일", "수요일", "목요일", "금요일", "토요일", "일요일"];
const ORDINALS = { 1: "첫째", 2: "둘째", 3: "셋째", 4: "넷째", 5: "다섯째", "-1": "마지막" };

function calendarDay(value: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [year, month, date] = value.split("-").map(Number);
  const day = dayOf(year, month, date);
  return formatDay(day) === value ? day : undefined;
}

export function isRoutineDate(value: unknown): value is string {
  return typeof value === "string" && value >= MIN_DATE && value <= MAX_DATE && calendarDay(value) !== undefined;
}

function dayOf(year: number, month: number, date: number): number {
  const value = new Date(0);
  value.setUTCFullYear(year, month - 1, date);
  value.setUTCHours(0, 0, 0, 0);
  return value.getTime() / DAY;
}

function parts(day: number) {
  const date = new Date(day * DAY);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, date: date.getUTCDate() };
}

function formatDay(day: number): string {
  const value = parts(day);
  return `${String(value.year).padStart(4, "0")}-${String(value.month).padStart(2, "0")}-${String(value.date).padStart(2, "0")}`;
}

export function shiftRoutineDate(date: string, amount: number): string {
  const day = calendarDay(date);
  return day === undefined || !Number.isInteger(amount) ? "" : formatDay(day + amount);
}

function weekday(day: number): number {
  return ((new Date(day * DAY).getUTCDay() + 6) % 7) + 1;
}

function daysInMonth(year: number, month: number): number {
  return parts(dayOf(year, month + 1, 0)).date;
}

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function integer(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function selectedNumbers(value: unknown, min: number, max: number, cap: number, label: string): number[] {
  if (!Array.isArray(value) || value.length > cap || value.some(item => !integer(item, min, max))) throw new Error(`${label} 설정을 확인해 주세요.`);
  return [...new Set(value as number[])].sort((a, b) => a - b);
}

/** Validate unknown backup/form input and return an owned, whitelist-only rule. */
export function validateRoutineRecurrence(value: unknown): RoutineRecurrence {
  if (!object(value) || Object.keys(value).some(key => !RULE_KEYS.has(key))) throw new Error("반복 규칙 형식을 확인해 주세요.");
  const { frequency, interval, startDate, monthMode, ordinal, missingDate, weekend } = value;
  if (!["daily", "weekly", "monthly", "yearly"].includes(frequency as string)) throw new Error("반복 단위를 선택해 주세요.");
  if (!integer(interval, 1, 365)) throw new Error("반복 간격은 1~365 사이의 정수로 입력해 주세요.");
  if (!isRoutineDate(startDate)) throw new Error("시작일을 2000~2100년 사이의 올바른 날짜로 입력해 주세요.");
  const weekdays = selectedNumbers(value.weekdays, 1, 7, 7, "요일");
  const months = selectedNumbers(value.months, 1, 12, 12, "월");
  const ordinalWeekdays = selectedNumbers(value.ordinalWeekdays, 1, 7, 7, "요일");
  if (!["dates", "ordinal"].includes(monthMode as string)) throw new Error("날짜 또는 몇 번째 요일 반복을 선택해 주세요.");
  if (![1, 2, 3, 4, 5, -1].includes(ordinal as number)) throw new Error("몇 번째 요일인지 선택해 주세요.");
  if (!Array.isArray(value.monthDays) || value.monthDays.length > 32 || value.monthDays.some(day => day !== "last" && !integer(day, 1, 31))) throw new Error("반복 날짜는 1~31일 또는 말일로 선택해 주세요.");
  const numericDays = [...new Set(value.monthDays.filter((day): day is number => typeof day === "number"))].sort((a, b) => a - b);
  const monthDays: Array<number | "last"> = value.monthDays.includes("last") ? [...numericDays, "last"] : numericDays;
  if (!["clamp", "skip"].includes(missingDate as string)) throw new Error("없는 날짜의 처리 방법을 선택해 주세요.");
  if (!["none", "previous", "next"].includes(weekend as string)) throw new Error("주말의 처리 방법을 선택해 주세요.");
  if (frequency === "weekly" && !weekdays.length) throw new Error("반복할 요일을 하나 이상 선택해 주세요.");
  if (frequency === "yearly" && !months.length) throw new Error("반복할 월을 하나 이상 선택해 주세요.");
  if (frequency === "monthly" || frequency === "yearly") {
    if (monthMode === "dates" && !monthDays.length) throw new Error("반복할 날짜를 하나 이상 선택해 주세요.");
    if (monthMode === "ordinal" && !ordinalWeekdays.length) throw new Error("반복할 요일을 하나 이상 선택해 주세요.");
  }
  if (!Array.isArray(value.excludeDates) || value.excludeDates.length > 1000 || value.excludeDates.some(date => !isRoutineDate(date))) throw new Error("제외일은 2000~2100년의 날짜로 최대 1,000개까지 지정할 수 있습니다.");
  const excludeDates = [...new Set(value.excludeDates as string[])].sort();
  if (!object(value.end)) throw new Error("종료 조건을 선택해 주세요.");
  let end: RoutineRecurrence["end"];
  if (value.end.type === "never" && Object.keys(value.end).every(key => key === "type")) end = { type: "never" };
  else if (value.end.type === "date" && Object.keys(value.end).every(key => key === "type" || key === "date")) {
    if (!isRoutineDate(value.end.date) || value.end.date < startDate) throw new Error("종료일은 시작일 이후의 2000~2100년 날짜로 선택해 주세요.");
    end = { type: "date", date: value.end.date };
  } else if (value.end.type === "count" && Object.keys(value.end).every(key => key === "type" || key === "count")) {
    if (!integer(value.end.count, 1, 10_000)) throw new Error("종료 횟수는 1~10,000회로 입력해 주세요.");
    end = { type: "count", count: value.end.count };
  } else throw new Error("종료 조건 형식을 확인해 주세요.");
  return { frequency: frequency as RoutineRecurrence["frequency"], interval, startDate, weekdays, months,
    monthMode: monthMode as RoutineRecurrence["monthMode"], monthDays, ordinal: ordinal as RoutineRecurrence["ordinal"], ordinalWeekdays,
    missingDate: missingDate as RoutineRecurrence["missingDate"], weekend: weekend as RoutineRecurrence["weekend"], excludeDates, end };
}

export interface RoutineDateOccurrence {
  date: string;
  sourceDates: string[];
  adjusted: boolean;
}

function monthDates(rule: RoutineRecurrence, year: number, month: number): number[] {
  const last = daysInMonth(year, month);
  const values = new Set<number>();
  if (rule.monthMode === "dates") {
    for (const item of rule.monthDays) {
      if (item === "last") values.add(dayOf(year, month, last));
      else if (item <= last || rule.missingDate === "clamp") values.add(dayOf(year, month, Math.min(item, last)));
    }
  } else {
    for (const target of rule.ordinalWeekdays) {
      const date = rule.ordinal === -1 ? last - ((weekday(dayOf(year, month, last)) - target + 7) % 7)
        : 1 + ((target - weekday(dayOf(year, month, 1)) + 7) % 7) + (rule.ordinal - 1) * 7;
      if (date <= last) values.add(dayOf(year, month, date));
    }
  }
  return [...values].sort((a, b) => a - b);
}

/** Visit only active periods; reversal supports finding the latest past date. */
function* candidates(rule: RoutineRecurrence, from: number, through: number, reverse = false): Generator<number> {
  const start = calendarDay(rule.startDate)!;
  const anchor = parts(start), first = parts(from), last = parts(through);
  let low: number, high: number;
  if (rule.frequency === "daily") {
    low = Math.max(0, Math.ceil((from - start) / rule.interval));
    high = Math.floor((through - start) / rule.interval);
  } else if (rule.frequency === "weekly") {
    const monday = start - weekday(start) + 1;
    low = Math.max(0, Math.ceil(Math.floor((from - monday) / 7) / rule.interval));
    high = Math.floor(Math.floor((through - monday) / 7) / rule.interval);
  } else if (rule.frequency === "monthly") {
    const anchorMonth = anchor.year * 12 + anchor.month - 1;
    low = Math.max(0, Math.ceil((first.year * 12 + first.month - 1 - anchorMonth) / rule.interval));
    high = Math.floor((last.year * 12 + last.month - 1 - anchorMonth) / rule.interval);
  } else {
    low = Math.max(0, Math.ceil((first.year - anchor.year) / rule.interval));
    high = Math.floor((last.year - anchor.year) / rule.interval);
  }
  for (let step = reverse ? high : low; reverse ? step >= low : step <= high; step += reverse ? -1 : 1) {
    let dates: number[];
    if (rule.frequency === "daily") dates = [start + step * rule.interval];
    else if (rule.frequency === "weekly") {
      const monday = start - weekday(start) + 1 + step * rule.interval * 7;
      dates = rule.weekdays.map(day => monday + day - 1);
    } else if (rule.frequency === "monthly") {
      const index = anchor.year * 12 + anchor.month - 1 + step * rule.interval;
      dates = monthDates(rule, Math.floor(index / 12), index % 12 + 1);
    } else {
      const year = anchor.year + step * rule.interval;
      dates = rule.months.flatMap(month => monthDates(rule, year, month));
    }
    if (reverse) dates.reverse();
    for (const day of dates) if (day >= start && day >= from && day <= through) yield day;
  }
}

function moveWeekend(day: number, mode: RoutineRecurrence["weekend"]): number {
  const selected = weekday(day);
  if (selected < 6 || mode === "none") return day;
  return mode === "previous" ? day - (selected === 6 ? 1 : 2) : day + (selected === 6 ? 2 : 1);
}

function merge(results: Map<number, RoutineDateOccurrence>, day: number, source: number): void {
  const sourceDate = formatDay(source);
  const current = results.get(day);
  if (current) {
    if (!current.sourceDates.includes(sourceDate)) current.sourceDates.push(sourceDate);
    current.adjusted ||= day !== source;
  } else results.set(day, { date: formatDay(day), sourceDates: [sourceDate], adjusted: day !== source });
}

export function generateRoutineDates(input: RoutineRecurrence, options: { fromDate?: string; toDate?: string; limit?: number } = {}): RoutineDateOccurrence[] {
  const rule = validateRoutineRecurrence(input);
  const fromDate = options.fromDate ?? rule.startDate;
  const toDate = options.toDate ?? MAX_DATE;
  const limit = options.limit ?? 5;
  if (!isRoutineDate(fromDate) || !isRoutineDate(toDate) || !integer(limit, 1, 10_000)) return [];
  const start = calendarDay(rule.startDate)!;
  const from = Math.max(start, calendarDay(fromDate)!);
  let through = Math.min(calendarDay(toDate)!, rule.end.type === "date" ? calendarDay(rule.end.date)! : calendarDay(MAX_DATE)!);
  const simpleCount = rule.frequency === "daily" && rule.weekend === "none" && !rule.excludeDates.length && rule.end.type === "count";
  if (simpleCount && rule.end.type === "count") through = Math.min(through, start + (rule.end.count - 1) * rule.interval);
  if (from > through) return [];
  const count = rule.end.type === "count" ? rule.end.count : Infinity;
  const rawFrom = count === Infinity || simpleCount ? Math.max(start, from - 2) : start;
  const excludes = new Set(rule.excludeDates);
  const results = new Map<number, RoutineDateOccurrence>();
  let stopDate: number | undefined;
  let visibleCount = 0;
  for (const source of candidates(rule, rawFrom, Math.min(calendarDay(MAX_DATE)!, through + 2))) {
    if (stopDate !== undefined && source > stopDate + 2) break;
    const day = moveWeekend(source, rule.weekend);
    if (day < start || day > through || excludes.has(formatDay(day))) continue;
    const fresh = !results.has(day);
    if (fresh && day >= from) visibleCount += 1;
    merge(results, day, source);
    // Candidate dates and both weekend moves are nondecreasing. A new map
    // key therefore settles the next unique occurrence without re-sorting.
    if (fresh && visibleCount === limit) stopDate = Math.min(stopDate ?? Infinity, day);
    if (fresh && results.size === count) stopDate = Math.min(stopDate ?? Infinity, day);
  }
  return [...results.entries()].sort(([a], [b]) => a - b).slice(0, count)
    .filter(([day]) => day >= from).slice(0, limit)
    .map(([, item]) => ({ ...item, sourceDates: item.sourceDates.sort() }));
}

/** Latest actual date, without reviving any earlier overdue occurrence. */
export function getLatestRoutineDate(input: RoutineRecurrence, throughDate: string): RoutineDateOccurrence | undefined {
  const rule = validateRoutineRecurrence(input);
  if (!isRoutineDate(throughDate) || throughDate < rule.startDate) return undefined;
  if (rule.frequency === "daily" && rule.weekend === "none" && !rule.excludeDates.length && rule.end.type === "count") {
    const start = calendarDay(rule.startDate)!;
    const index = Math.min(rule.end.count - 1, Math.floor((calendarDay(throughDate)! - start) / rule.interval));
    const date = formatDay(start + index * rule.interval);
    return { date, sourceDates: [date], adjusted: false };
  }
  if (rule.end.type === "count") return generateRoutineDates(rule, { fromDate: rule.startDate, toDate: throughDate, limit: rule.end.count }).at(-1);
  const start = calendarDay(rule.startDate)!;
  const through = Math.min(calendarDay(throughDate)!, rule.end.type === "date" ? calendarDay(rule.end.date)! : calendarDay(MAX_DATE)!);
  const excludes = new Set(rule.excludeDates);
  const results = new Map<number, RoutineDateOccurrence>();
  let latest: number | undefined;
  for (const source of candidates(rule, start, Math.min(calendarDay(MAX_DATE)!, through + 2), true)) {
    if (latest !== undefined && source < latest - 2) break;
    const day = moveWeekend(source, rule.weekend);
    if (day < start || day > through || excludes.has(formatDay(day))) continue;
    merge(results, day, source);
    latest = Math.max(latest ?? -Infinity, day);
  }
  const item = latest === undefined ? undefined : results.get(latest);
  return item ? { ...item, sourceDates: item.sourceDates.sort() } : undefined;
}

export function summarizeRoutineRule(input: RoutineRecurrence): string {
  const rule = validateRoutineRecurrence(input);
  const pattern = rule.monthMode === "ordinal" ? `${ORDINALS[rule.ordinal]} ${rule.ordinalWeekdays.map(day => WEEKDAYS[day - 1]).join("·")}`
    : rule.monthDays.map(day => day === "last" ? "말일" : `${day}일`).join("·");
  let text: string;
  if (rule.frequency === "daily") text = rule.interval === 1 ? "매일" : `${rule.interval}일마다`;
  else if (rule.frequency === "weekly") text = `${rule.interval === 1 ? "매주" : `${rule.interval}주마다`} ${rule.weekdays.map(day => WEEKDAYS[day - 1]).join("·")}`;
  else if (rule.frequency === "monthly") text = `${rule.interval === 1 ? "매월" : `${rule.interval}개월마다`} ${pattern}`;
  else text = `${rule.interval === 1 ? "매년" : `${rule.interval}년마다`} ${rule.months.map(month => `${month}월`).join("·")} ${pattern}`;
  const details: string[] = [];
  if ((rule.frequency === "monthly" || rule.frequency === "yearly") && rule.monthMode === "dates" && rule.monthDays.some(day => typeof day === "number" && day > 28)) details.push(rule.missingDate === "clamp" ? "없는 날짜는 그달 말일" : "없는 날짜는 건너뜀");
  if ((rule.frequency === "monthly" || rule.frequency === "yearly") && rule.monthMode === "ordinal" && rule.ordinal === 5) details.push("다섯째 요일이 없는 달은 건너뜀");
  if (rule.weekend !== "none") details.push(rule.weekend === "previous" ? "주말은 앞 평일로 이동" : "주말은 다음 평일로 이동");
  if (rule.excludeDates.length) details.push(`제외일 ${rule.excludeDates.length}개`);
  if (rule.end.type === "date") details.push(`${rule.end.date}까지`);
  if (rule.end.type === "count") details.push(`총 ${rule.end.count}회 후 종료`);
  return [text, ...details].join(" · ");
}
