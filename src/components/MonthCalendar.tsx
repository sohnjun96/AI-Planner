import { useMemo, useState } from "react";
import { addDays, addMonths, getDateKey, getMonthGridStart, startOfMonth } from "../utils/date";

interface MonthCalendarProps {
  selectedDate: string;
  weekStartsOn: "sun" | "mon";
  taskCountByDate: Record<string, number>;
  eventTitlesByDate?: Record<string, string[]>;
  onSelectDate: (date: string) => void;
}

const WEEK_LABELS: Record<"sun" | "mon", string[]> = {
  mon: ["\uC6D4", "\uD654", "\uC218", "\uBAA9", "\uAE08", "\uD1A0", "\uC77C"],
  sun: ["\uC77C", "\uC6D4", "\uD654", "\uC218", "\uBAA9", "\uAE08", "\uD1A0"],
};

export function MonthCalendar({
  selectedDate,
  weekStartsOn,
  taskCountByDate,
  eventTitlesByDate = {},
  onSelectDate,
}: MonthCalendarProps) {
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(new Date(selectedDate)));
  const selectedKey = getDateKey(selectedDate);
  const todayKey = getDateKey(new Date());

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

  return (
    <section className="panel calendar-panel">
      <div className="calendar-header">
        <button type="button" className="btn btn-soft" onClick={() => setVisibleMonth((prev) => addMonths(prev, -1))}>
          이전
        </button>
        <strong>{monthLabel}</strong>
        <button type="button" className="btn btn-soft" onClick={() => setVisibleMonth((prev) => addMonths(prev, 1))}>
          다음
        </button>
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
          const count = taskCountByDate[key] ?? 0;
          const events = eventTitlesByDate[key] ?? [];
          const firstEventTitle = events[0];
          const hiddenEventCount = Math.max(0, events.length - 1);

          return (
            <button
              key={key}
              type="button"
              className={`calendar-day ${selectedKey === key ? "selected" : ""} ${
                todayKey === key ? "today" : ""
              } ${isOtherMonth ? "muted" : ""}`}
              onClick={() => onSelectDate(key)}
            >
              <span>{date.getDate()}</span>
              {firstEventTitle ? (
                <span className="calendar-event-line" title={firstEventTitle}>
                  {firstEventTitle}
                </span>
              ) : null}
              {hiddenEventCount > 0 ? <span className="calendar-event-more">+{hiddenEventCount}</span> : null}
              {count > 0 ? <small>{count}</small> : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}
