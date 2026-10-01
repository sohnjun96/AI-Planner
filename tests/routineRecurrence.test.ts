import assert from "node:assert/strict";
import type { RoutineRecurrence } from "../src/models";
import { generateRoutineDates, getLatestRoutineDate, isRoutineDate, summarizeRoutineRule, validateRoutineRecurrence } from "../src/utils/routineRecurrence";

const base: RoutineRecurrence = { frequency: "monthly", interval: 1, startDate: "2026-10-01",
  weekdays: [1, 3, 5], months: [2], monthMode: "dates", monthDays: [1], ordinal: -1,
  ordinalWeekdays: [5], missingDate: "clamp", weekend: "none", excludeDates: [], end: { type: "never" } };
const dates = (change: Partial<RoutineRecurrence> = {}, options: Parameters<typeof generateRoutineDates>[1] = {}) =>
  generateRoutineDates({ ...base, ...change }, { fromDate: "2026-10-01", ...options }).map(item => item.date);
let passed = 0;
function check(label: string, run: () => void) { run(); passed += 1; void label; }

check("weekly selected weekdays", () => assert.deepEqual(dates({ frequency: "weekly" }), ["2026-10-02", "2026-10-05", "2026-10-07", "2026-10-09", "2026-10-12"]));
check("fortnight anchors to start week Monday", () => assert.deepEqual(dates({ frequency: "weekly", interval: 2, weekdays: [1, 5] }), ["2026-10-02", "2026-10-12", "2026-10-16", "2026-10-26", "2026-10-30"]));
check("fortnight stays anchored when preview begins later", () => assert.deepEqual(dates({ frequency: "weekly", interval: 2, weekdays: [1, 5] }, { fromDate: "2026-10-13" }), ["2026-10-16", "2026-10-26", "2026-10-30", "2026-11-09", "2026-11-13"]));
check("week begins Monday and Sunday is 7", () => assert.deepEqual(dates({ frequency: "weekly", interval: 2, weekdays: [7] }), ["2026-10-04", "2026-10-18", "2026-11-01", "2026-11-15", "2026-11-29"]));
check("multiple month dates", () => assert.deepEqual(dates({ monthDays: [15, 1, 1] }), ["2026-10-01", "2026-10-15", "2026-11-01", "2026-11-15", "2026-12-01"]));
check("monthly interval anchored to start month", () => assert.deepEqual(dates({ startDate: "2026-09-15", interval: 3, monthDays: [1, 15] }), ["2026-12-01", "2026-12-15", "2027-03-01", "2027-03-15", "2027-06-01"]));
check("31st clamps to month end", () => assert.deepEqual(dates({ monthDays: [31] }), ["2026-10-31", "2026-11-30", "2026-12-31", "2027-01-31", "2027-02-28"]));
check("31st skips short months", () => assert.deepEqual(dates({ monthDays: [31], missingDate: "skip" }), ["2026-10-31", "2026-12-31", "2027-01-31", "2027-03-31", "2027-05-31"]));
check("last day and 31st merge", () => assert.deepEqual(dates({ monthDays: [31, "last"] }), ["2026-10-31", "2026-11-30", "2026-12-31", "2027-01-31", "2027-02-28"]));
check("several missing dates clamp to one occurrence", () => assert.deepEqual(dates({ startDate: "2026-02-01", monthDays: [29, 30, 31, "last"] }, { fromDate: "2026-02-01", limit: 1 }), ["2026-02-28"]));
check("last Friday", () => assert.deepEqual(dates({ monthMode: "ordinal", ordinal: -1, ordinalWeekdays: [5] }), ["2026-10-30", "2026-11-27", "2026-12-25", "2027-01-29", "2027-02-26"]));
check("fifth Monday skips missing months", () => assert.deepEqual(dates({ monthMode: "ordinal", ordinal: 5, ordinalWeekdays: [1] }), ["2026-11-30", "2027-03-29", "2027-05-31", "2027-08-30", "2027-11-29"]));
check("multiple ordinal weekdays", () => assert.deepEqual(dates({ monthMode: "ordinal", ordinal: 1, ordinalWeekdays: [1, 5] }), ["2026-10-02", "2026-10-05", "2026-11-02", "2026-11-06", "2026-12-04"]));
check("yearly leap day skips non-leap years", () => assert.deepEqual(dates({ frequency: "yearly", startDate: "2025-01-01", monthDays: [29], missingDate: "skip" }, { toDate: "2036-10-01" }), ["2028-02-29", "2032-02-29", "2036-02-29"]));
check("yearly leap day clamps non-leap years", () => assert.deepEqual(dates({ frequency: "yearly", startDate: "2025-01-01", monthDays: [29] }), ["2027-02-28", "2028-02-29", "2029-02-28", "2030-02-28", "2031-02-28"]));
check("yearly selected months with anchored interval", () => assert.deepEqual(dates({ frequency: "yearly", interval: 2, startDate: "2025-10-01", months: [10, 1, 4] }), ["2027-01-01", "2027-04-01", "2027-10-01", "2029-01-01", "2029-04-01"]));
check("daily interval preserves original anchor", () => assert.deepEqual(dates({ frequency: "daily", startDate: "2026-09-29", interval: 3 }), ["2026-10-02", "2026-10-05", "2026-10-08", "2026-10-11", "2026-10-14"]));
check("weekends move backward and merge with Friday", () => {
  const list = generateRoutineDates({ ...base, frequency: "daily", weekend: "previous" });
  assert.deepEqual(list.map(item => item.date), ["2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06", "2026-10-07"]);
  assert.deepEqual(list[1], { date: "2026-10-02", sourceDates: ["2026-10-02", "2026-10-03", "2026-10-04"], adjusted: true });
});
check("weekends move forward and merge with Monday", () => {
  const list = generateRoutineDates({ ...base, frequency: "daily", weekend: "next" });
  assert.deepEqual(list.map(item => item.date), ["2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06", "2026-10-07"]);
  assert.deepEqual(list[2], { date: "2026-10-05", sourceDates: ["2026-10-03", "2026-10-04", "2026-10-05"], adjusted: true });
});
check("explicit exclusion applies after weekend moving", () => assert.deepEqual(dates({ frequency: "daily", weekend: "next", excludeDates: ["2026-10-05"] }), ["2026-10-01", "2026-10-02", "2026-10-06", "2026-10-07", "2026-10-08"]));
check("moved date before start is discarded", () => assert.deepEqual(dates({ frequency: "weekly", startDate: "2026-10-03", weekdays: [6], weekend: "previous" }), ["2026-10-09", "2026-10-16", "2026-10-23", "2026-10-30", "2026-11-06"]));
check("inclusive date end rejects movement after end", () => assert.deepEqual(dates({ frequency: "daily", weekend: "next", end: { type: "date", date: "2026-10-04" } }), ["2026-10-01", "2026-10-02"]));
check("source after end may move to valid inclusive end", () => {
  const list = generateRoutineDates({ ...base, frequency: "daily", weekend: "previous", end: { type: "date", date: "2026-10-02" } });
  assert.deepEqual(list.map(item => item.date), ["2026-10-01", "2026-10-02"]);
  assert.deepEqual(list[1].sourceDates, ["2026-10-02", "2026-10-03", "2026-10-04"]);
});
check("count end is evaluated after moving merging excluding", () => {
  const list = generateRoutineDates({ ...base, frequency: "daily", weekend: "previous", excludeDates: ["2026-10-01"], end: { type: "count", count: 2 } });
  assert.deepEqual(list.map(item => item.date), ["2026-10-02", "2026-10-05"]);
  assert.deepEqual(list[0].sourceDates, ["2026-10-02", "2026-10-03", "2026-10-04"]);
});
check("count total includes past occurrences before preview", () => assert.deepEqual(dates({ frequency: "daily", end: { type: "count", count: 3 } }, { fromDate: "2026-10-03" }), ["2026-10-03"]));
check("expired count has no future occurrences", () => assert.deepEqual(dates({ frequency: "daily", startDate: "2000-01-01", end: { type: "count", count: 30 } }), []));
check("old start does not truncate future preview", () => assert.deepEqual(dates({ frequency: "yearly", startDate: "2000-01-01", monthDays: [29], missingDate: "skip" }, { toDate: "2036-10-01" }), ["2028-02-29", "2032-02-29", "2036-02-29"]));
check("count reflects one merged monthly date per month", () => assert.deepEqual(dates({ monthDays: [31, "last"], end: { type: "count", count: 2 } }), ["2026-10-31", "2026-11-30"]));
check("future start is inclusive", () => assert.deepEqual(dates({ frequency: "daily", startDate: "2027-01-01" }, { limit: 2 }), ["2027-01-01", "2027-01-02"]));
check("preview before start is safe", () => assert.deepEqual(dates({ frequency: "daily" }, { fromDate: "2000-01-01", limit: 2 }), ["2026-10-01", "2026-10-02"]));
check("owned normalized rule", () => { const rule = validateRoutineRecurrence(base); assert.deepEqual(rule, base); assert.notEqual(rule.monthDays, base.monthDays); });
check("invalid leap date rejected", () => assert.throws(() => validateRoutineRecurrence({ ...base, startDate: "2026-02-29" })));
check("missing weekdays rejected", () => assert.throws(() => validateRoutineRecurrence({ ...base, frequency: "weekly", weekdays: [] })));
check("zero interval rejected", () => assert.throws(() => validateRoutineRecurrence({ ...base, interval: 0 })));
check("end before start rejected", () => assert.throws(() => validateRoutineRecurrence({ ...base, end: { type: "date", date: "2026-09-01" } })));
check("invalid excluded date rejected", () => assert.throws(() => validateRoutineRecurrence({ ...base, excludeDates: ["2026-04-31"] })));
check("invalid rule throws before calculating preview", () => assert.throws(() => generateRoutineDates({ ...base, interval: -1 })));
check("zero preview limit gives empty array", () => assert.deepEqual(generateRoutineDates(base, { limit: 0 }), []));
check("Korean rule summary", () => assert.equal(summarizeRoutineRule({ ...base, frequency: "weekly", interval: 2, weekdays: [5, 1], end: { type: "count", count: 10 } }), "2주마다 월요일·금요일 · 총 10회 후 종료"));

check("last supported day truncates preview", () => assert.deepEqual(dates({ frequency: "daily", startDate: "2100-12-30" }), ["2100-12-30", "2100-12-31"]));
check("2100 is not leap year", () => assert.equal(isRoutineDate("2100-02-29"), false));
check("2000 is leap year", () => assert.equal(isRoutineDate("2000-02-29"), true));
check("date range rejected", () => { for (const startDate of ["1999-12-31", "2101-01-01"]) assert.throws(() => validateRoutineRecurrence({ ...base, startDate })); });
check("interval cap rejected", () => assert.throws(() => validateRoutineRecurrence({ ...base, interval: 366 })));
check("count cap rejected", () => assert.throws(() => validateRoutineRecurrence({ ...base, end: { type: "count", count: 10_001 } })));
check("array caps rejected", () => { assert.throws(() => validateRoutineRecurrence({ ...base, weekdays: Array(8).fill(1) })); assert.throws(() => validateRoutineRecurrence({ ...base, monthDays: Array(33).fill(1) })); });
check("exclude cap rejected", () => assert.throws(() => validateRoutineRecurrence({ ...base, excludeDates: Array(1001).fill("2026-10-01") })));
check("unknown rule/end keys rejected", () => { assert.throws(() => validateRoutineRecurrence({ ...base, weekday: [1] })); assert.throws(() => validateRoutineRecurrence({ ...base, end: { type: "never", count: 2 } })); });
check("latest seeks original interval backward", () => assert.equal(getLatestRoutineDate({ ...base, frequency: "weekly", interval: 2, weekdays: [1, 5] }, "2026-10-25")?.date, "2026-10-16"));
check("latest date follows exclusion and weekend adjustment", () => assert.equal(getLatestRoutineDate({ ...base, frequency: "daily", weekend: "next", excludeDates: ["2026-10-05"] }, "2026-10-05")?.date, "2026-10-02"));
check("latest count end remembers expired final occurrence", () => assert.equal(getLatestRoutineDate({ ...base, frequency: "daily", end: { type: "count", count: 3 } }, "2027-01-01")?.date, "2026-10-03"));
check("large past count is exact", () => {
  const rule: RoutineRecurrence = { ...base, frequency: "daily", startDate: "2000-01-01", end: { type: "count", count: 10_000 } };
  assert.equal(getLatestRoutineDate(rule, "2100-01-01")?.date, "2027-05-18");
  assert.deepEqual(generateRoutineDates(rule, { fromDate: "2027-05-17", limit: 5 }).map(item => item.date), ["2027-05-17", "2027-05-18"]);
});
check("simple count seeks original interval from later preview", () => {
  const rule: RoutineRecurrence = { ...base, frequency: "daily", startDate: "2000-01-01", interval: 3, end: { type: "count", count: 4 } };
  assert.deepEqual(generateRoutineDates(rule, { fromDate: "2000-01-05" }), [
    { date: "2000-01-07", sourceDates: ["2000-01-07"], adjusted: false },
    { date: "2000-01-10", sourceDates: ["2000-01-10"], adjusted: false },
  ]);
  assert.deepEqual(generateRoutineDates(rule, { fromDate: "2000-01-11" }), []);
  assert.deepEqual(getLatestRoutineDate(rule, "2000-01-09"), { date: "2000-01-07", sourceDates: ["2000-01-07"], adjusted: false });
  assert.equal(getLatestRoutineDate(rule, "2100-12-31")?.date, "2000-01-10");
});
check("simple count respects requested upper bound and supported range", () => {
  const rule: RoutineRecurrence = { ...base, frequency: "daily", startDate: "2100-12-28", interval: 2, end: { type: "count", count: 10_000 } };
  assert.deepEqual(generateRoutineDates(rule, { toDate: "2100-12-29" }).map(item => item.date), ["2100-12-28"]);
  assert.deepEqual(generateRoutineDates(rule).map(item => item.date), ["2100-12-28", "2100-12-30"]);
  assert.equal(getLatestRoutineDate(rule, "2100-12-31")?.date, "2100-12-30");
});
check("count of one preserves start occurrence without replay", () => {
  const rule: RoutineRecurrence = { ...base, frequency: "daily", interval: 365, end: { type: "count", count: 1 } };
  assert.deepEqual(generateRoutineDates(rule), [{ date: "2026-10-01", sourceDates: ["2026-10-01"], adjusted: false }]);
  assert.deepEqual(generateRoutineDates(rule, { fromDate: "2026-10-02" }), []);
  assert.equal(getLatestRoutineDate(rule, "2026-10-01")?.date, "2026-10-01");
});

process.stdout.write(`Routine recurrence: ${passed} calendar and boundary checks passed.\n`);
