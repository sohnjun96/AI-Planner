import { KOREAN_HOLIDAYS, type KoreanHoliday } from "../data/koreanHolidays";

const EMPTY_HOLIDAYS: readonly KoreanHoliday[] = Object.freeze([]);
const holidaysByDate = new Map<string, readonly KoreanHoliday[]>();

for (const holiday of KOREAN_HOLIDAYS) {
  const entries = holidaysByDate.get(holiday.date) ?? EMPTY_HOLIDAYS;
  holidaysByDate.set(holiday.date, Object.freeze([...entries, Object.freeze({ ...holiday })]));
}

/** Calendar dates stay as YYYY-MM-DD keys; UTC conversion can shift a holiday. */
export function getKoreanHolidays(dateKey: string): readonly KoreanHoliday[] {
  return holidaysByDate.get(dateKey) ?? EMPTY_HOLIDAYS;
}

export function getKoreanHolidayLabel(dateKey: string): string {
  return [...new Set(getKoreanHolidays(dateKey).map((holiday) => holiday.name))].join(", ");
}

export function isKoreanHolidayDate(dateKey: string): boolean {
  return getKoreanHolidays(dateKey).length > 0;
}
