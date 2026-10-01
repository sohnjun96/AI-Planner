import assert from "node:assert/strict";
import { KOREAN_HOLIDAYS, KOREAN_HOLIDAY_COVERAGE } from "../src/data/koreanHolidays";
import { getKoreanHolidays, getKoreanHolidayLabel, isKoreanHolidayDate } from "../src/utils/holidays";

// Independently checked against KASI's 2026 calendar announcement.
assert.equal(getKoreanHolidayLabel("2026-10-03"), "개천절");
assert.match(getKoreanHolidayLabel("2026-10-05"), /대체공휴일/);
assert.equal(getKoreanHolidayLabel("2026-10-09"), "한글날");
assert.equal(isKoreanHolidayDate("2026-10-04"), false, "an ordinary Sunday is not an extra named holiday");
assert.equal(isKoreanHolidayDate("2026-10-12"), false, "mockup-only institution holidays must not reach the app");
assert.equal(isKoreanHolidayDate("2030-01-01"), true, "future holidays are bundled before an app update");
assert.equal(getKoreanHolidayLabel("2026-05-01"), "노동절");
assert.equal(getKoreanHolidayLabel("2026-07-17"), "제헌절");
assert.equal(getKoreanHolidayLabel("2026-06-03"), "전국동시지방선거일");
assert.equal(getKoreanHolidayLabel("2027-02-07"), "설날");
assert.equal(getKoreanHolidayLabel("2027-05-03"), "대체공휴일(노동절)");
assert.equal(getKoreanHolidayLabel("2027-07-19"), "대체공휴일(제헌절)");
assert.deepEqual(getKoreanHolidays("2028-10-03").map((holiday) => holiday.name), ["추석", "개천절"]);
assert.equal(getKoreanHolidayLabel("2028-10-03"), "추석, 개천절", "coincident holidays retain both names");
assert.equal(getKoreanHolidayLabel("2028-10-05"), "대체공휴일(추석·개천절)");
assert.equal(isKoreanHolidayDate("2028-10-06"), false, "overlap does not create an extra substitute holiday");
assert.equal(getKoreanHolidayLabel("2029-05-07"), "대체공휴일(어린이날)");
assert.equal(getKoreanHolidayLabel("2029-09-24"), "대체공휴일(추석)");
assert.equal(getKoreanHolidayLabel("2030-02-05"), "대체공휴일(설날)");
assert.equal(isKoreanHolidayDate("2026-09-28"), false, "Saturday alone does not substitute Chuseok");
assert.equal(isKoreanHolidayDate("2028-01-03"), false, "New Year's Day has no substitute holiday");
assert.equal(isKoreanHolidayDate("2027-06-07"), false, "Memorial Day has no substitute holiday");
assert.equal(KOREAN_HOLIDAY_COVERAGE.startYear, 2026);
assert.equal(KOREAN_HOLIDAY_COVERAGE.endYear, 2030);

for (const value of ["2026-10-02", "2025-10-03", "2031-01-01", "2026-02-30", "", "2026-10-03T00:00:00Z", "2026-10-03T00:00:00+09:00", " 2026-10-03"]) {
  assert.deepEqual(getKoreanHolidays(value), [], `only exact supported calendar date keys match: ${value}`);
  assert.equal(getKoreanHolidayLabel(value), "");
}

const identities = new Set<string>();
let previous = "";
for (const holiday of KOREAN_HOLIDAYS) {
  assert.match(holiday.date, /^20\d{2}-\d{2}-\d{2}$/);
  const parsed = new Date(`${holiday.date}T12:00:00Z`);
  assert.equal(parsed.toISOString().slice(0, 10), holiday.date, "no impossible calendar dates");
  const year = Number(holiday.date.slice(0, 4));
  assert.ok(year >= KOREAN_HOLIDAY_COVERAGE.startYear && year <= KOREAN_HOLIDAY_COVERAGE.endYear);
  assert.ok(holiday.date >= previous, "bundled dates stay in chronological order");
  previous = holiday.date;
  const identity = `${holiday.date}:${holiday.name}`;
  assert.equal(identities.has(identity), false, "same-day holidays must not be duplicated");
  identities.add(identity);
  assert.ok(holiday.name.trim().length > 0);
}
for (let year = 2026; year <= 2030; year += 1) {
  assert.equal(getKoreanHolidayLabel(`${year}-01-01`), "신정");
  assert.equal(getKoreanHolidayLabel(`${year}-06-06`), "현충일");
  assert.equal(getKoreanHolidayLabel(`${year}-12-25`), "성탄절");
}

const records = getKoreanHolidays("2026-10-09");
assert.ok(Object.isFrozen(records));
assert.ok(Object.isFrozen(records[0]));
assert.ok(Object.isFrozen(getKoreanHolidays("unknown")));
assert.equal(getKoreanHolidayLabel("2026-10-09"), "한글날");
console.info("Bundled Korean holiday dates, coverage, validation and date-only lookup checks passed.");
