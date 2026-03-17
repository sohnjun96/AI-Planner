import { useEffect, useMemo, useState } from "react";
import { addDays, addMonths, getDateKey, getMonthGridStart, startOfMonth } from "../utils/date";

export interface CalendarDaySummary {
  total: number;
  done: number;
  pending: number;
  onHold: number;
  conflicts: number;
  major: number;
  titles: string[];
}

interface MonthCalendarProps {
  selectedDate: string;
  weekStartsOn: "sun" | "mon";
  daySummaryByDate: Record<string, CalendarDaySummary>;
  onSelectDate: (date: string) => void;
  onDropTaskToDate?: (taskId: string, dateKey: string) => Promise<void> | void;
  onCreateTaskAtDate?: (dateKey: string) => void;
}

const EMPTY_SUMMARY: CalendarDaySummary = {
  total: 0,
  done: 0,
  pending: 0,
  onHold: 0,
  conflicts: 0,
  major: 0,
  titles: [],
};

const WEEK_LABELS: Record<"sun" | "mon", string[]> = {
  mon: ["월", "화", "수", "목", "금", "토", "일"],
  sun: ["일", "월", "화", "수", "목", "금", "토"],
};

function toMonthInputValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function parseMonthInputValue(value: string): Date | null {
  const [yearRaw, monthRaw] = value.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }
  return new Date(year, month - 1, 1);
}

function getDensityLevel(total: number): number {
  if (total <= 0) {
    return 0;
  }
  if (total <= 2) {
    return 1;
  }
  if (total <= 4) {
    return 2;
  }
  if (total <= 7) {
    return 3;
  }
  return 4;
}

export function MonthCalendar({
  selectedDate,
  weekStartsOn,
  daySummaryByDate,
  onSelectDate,
  onDropTaskToDate,
  onCreateTaskAtDate,
}: MonthCalendarProps) {
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(new Date(selectedDate)));
  const [dragOverDateKey, setDragOverDateKey] = useState<string | null>(null);

  const selectedKey = getDateKey(selectedDate);
  const todayKey = getDateKey(new Date());

  useEffect(() => {
    const selected = new Date(selectedDate);
    if (!Number.isFinite(selected.getTime())) {
      return;
    }

    if (
      selected.getFullYear() !== visibleMonth.getFullYear() ||
      selected.getMonth() !== visibleMonth.getMonth()
    ) {
      setVisibleMonth(startOfMonth(selected));
    }
  }, [selectedDate, visibleMonth]);

  const days = useMemo(() => {
    const start = getMonthGridStart(visibleMonth, weekStartsOn);
    return Array.from({ length: 42 }, (_, index) => addDays(start, index));
  }, [visibleMonth, weekStartsOn]);

  const monthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat("ko-KR", {
        year: "numeric",
        month: "long",
      }).format(visibleMonth),
    [visibleMonth],
  );

  const monthStats = useMemo(() => {
    let total = 0;
    let pending = 0;
    let done = 0;
    let conflicts = 0;

    const lastDay = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 0).getDate();
    for (let day = 1; day <= lastDay; day += 1) {
      const key = getDateKey(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), day));
      const summary = daySummaryByDate[key] ?? EMPTY_SUMMARY;
      total += summary.total;
      pending += summary.pending;
      done += summary.done;
      conflicts += summary.conflicts;
    }

    return { total, pending, done, conflicts };
  }, [daySummaryByDate, visibleMonth]);

  function moveSelectionByDays(daysToMove: number) {
    const next = addDays(new Date(selectedDate), daysToMove);
    onSelectDate(getDateKey(next));
  }

  function handleMonthInputChange(value: string) {
    const parsed = parseMonthInputValue(value);
    if (!parsed) {
      return;
    }
    setVisibleMonth(parsed);
    onSelectDate(getDateKey(parsed));
  }

  function handleSelectToday() {
    const today = new Date();
    setVisibleMonth(startOfMonth(today));
    onSelectDate(getDateKey(today));
  }

  return (
    <section className="panel calendar-panel">
      <div className="calendar-header calendar-toolbar">
        <div className="calendar-nav-row">
          <button
            type="button"
            className="btn btn-soft"
            aria-label="이전 달 보기"
            onClick={() => setVisibleMonth((prev) => addMonths(prev, -1))}
          >
            이전 달
          </button>
          <strong>{monthLabel}</strong>
          <button
            type="button"
            className="btn btn-soft"
            aria-label="다음 달 보기"
            onClick={() => setVisibleMonth((prev) => addMonths(prev, 1))}
          >
            다음 달
          </button>
        </div>

        <div className="calendar-toolbar-actions">
          <button type="button" className="btn btn-soft" onClick={handleSelectToday}>
            오늘
          </button>
          <label className="calendar-month-input">
            월 이동
            <input
              type="month"
              value={toMonthInputValue(visibleMonth)}
              onChange={(event) => handleMonthInputChange(event.target.value)}
            />
          </label>
        </div>
      </div>

      <div className="calendar-kpi-row" role="status" aria-live="polite">
        <span>총 {monthStats.total}건</span>
        <span>미완료 {monthStats.pending}건</span>
        <span>완료 {monthStats.done}건</span>
        <span>충돌 {monthStats.conflicts}건</span>
      </div>

      <div className="calendar-weekdays">
        {WEEK_LABELS[weekStartsOn].map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>

      <div className="calendar-grid">
        {days.map((date) => {
          const key = getDateKey(date);
          const isOtherMonth = date.getMonth() !== visibleMonth.getMonth();
          const summary = daySummaryByDate[key] ?? EMPTY_SUMMARY;
          const density = getDensityLevel(summary.total);
          const completionRatio = summary.total > 0 ? Math.round((summary.done / summary.total) * 100) : 0;
          const isWeekend = date.getDay() === 0 || date.getDay() === 6;

          const ariaLabel = [
            `${key}`,
            summary.total > 0 ? `총 ${summary.total}건` : "일정 없음",
            summary.pending > 0 ? `미완료 ${summary.pending}건` : "",
            summary.conflicts > 0 ? `충돌 ${summary.conflicts}건` : "",
            "Enter로 선택, 더블클릭으로 일정 추가",
          ]
            .filter(Boolean)
            .join(", ");

          return (
            <button
              key={key}
              type="button"
              className={`calendar-day density-${density} ${selectedKey === key ? "selected" : ""} ${
                todayKey === key ? "today" : ""
              } ${isOtherMonth ? "muted" : ""} ${isWeekend ? "weekend" : ""} ${
                dragOverDateKey === key ? "drag-target" : ""
              }`}
              onClick={() => onSelectDate(key)}
              onDoubleClick={() => {
                onCreateTaskAtDate?.(key);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  moveSelectionByDays(-1);
                } else if (event.key === "ArrowRight") {
                  event.preventDefault();
                  moveSelectionByDays(1);
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  moveSelectionByDays(-7);
                } else if (event.key === "ArrowDown") {
                  event.preventDefault();
                  moveSelectionByDays(7);
                } else if (event.key === "Home") {
                  event.preventDefault();
                  handleSelectToday();
                }
              }}
              onDragOver={(event) => {
                if (!onDropTaskToDate) {
                  return;
                }
                const taskId =
                  event.dataTransfer?.getData("application/x-task-id") ?? event.dataTransfer?.getData("text/plain");
                if (!taskId) {
                  return;
                }
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                if (dragOverDateKey !== key) {
                  setDragOverDateKey(key);
                }
              }}
              onDragLeave={() => {
                if (dragOverDateKey === key) {
                  setDragOverDateKey(null);
                }
              }}
              onDrop={(event) => {
                if (!onDropTaskToDate) {
                  return;
                }
                const taskId =
                  event.dataTransfer?.getData("application/x-task-id") ?? event.dataTransfer?.getData("text/plain");
                if (!taskId) {
                  return;
                }
                event.preventDefault();
                setDragOverDateKey(null);
                void onDropTaskToDate(taskId, key);
              }}
              aria-label={ariaLabel}
            >
              <div className="calendar-day-top">
                <span className="calendar-day-number">{date.getDate()}</span>
                {summary.total > 0 ? <span className="calendar-day-count">{summary.total}건</span> : null}
              </div>

              <div className="calendar-progress" aria-hidden="true">
                <span style={{ width: `${completionRatio}%` }} />
              </div>

              <div className="calendar-event-stack">
                {summary.titles.slice(0, 2).map((title, index) => (
                  <span key={`${key}-title-${index}`} className="calendar-event-line" title={title}>
                    {title}
                  </span>
                ))}
                {summary.total > 2 ? <span className="calendar-event-more">+{summary.total - 2}</span> : null}
              </div>

              <div className="calendar-indicators">
                {summary.pending > 0 ? <span className="calendar-indicator pending">미완료 {summary.pending}</span> : null}
                {summary.major > 0 ? <span className="calendar-indicator major">중요 {summary.major}</span> : null}
                {summary.conflicts > 0 ? <span className="calendar-indicator conflict">충돌 {summary.conflicts}</span> : null}
              </div>
            </button>
          );
        })}
      </div>

      <p className="description-text">팁: 날짜 더블클릭으로 해당 날짜 일정 등록, 드래그로 날짜 이동, 방향키로 날짜 이동</p>
    </section>
  );
}
