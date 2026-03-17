import { useMemo, useState } from "react";
import { addDays, addMonths, getDateKey, getMonthGridStart, startOfMonth } from "../utils/date";

interface MonthCalendarProps {
  selectedDate: string;
  weekStartsOn: "sun" | "mon";
  taskCountByDate: Record<string, number>;
  eventTitlesByDate?: Record<string, string[]>;
  onSelectDate: (date: string) => void;
  onDropTaskToDate?: (taskId: string, dateKey: string) => Promise<void> | void;
}

const WEEK_LABELS: Record<"sun" | "mon", string[]> = {
  mon: ["월", "화", "수", "목", "금", "토", "일"],
  sun: ["일", "월", "화", "수", "목", "금", "토"],
};

export function MonthCalendar({
  selectedDate,
  weekStartsOn,
  taskCountByDate,
  eventTitlesByDate = {},
  onSelectDate,
  onDropTaskToDate,
}: MonthCalendarProps) {
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(new Date(selectedDate)));
  const [dragOverDateKey, setDragOverDateKey] = useState<string | null>(null);
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
        <button
          type="button"
          className="btn btn-soft"
          aria-label="이전 달 보기"
          onClick={() => setVisibleMonth((prev) => addMonths(prev, -1))}
        >
          이전
        </button>
        <strong>{monthLabel}</strong>
        <button
          type="button"
          className="btn btn-soft"
          aria-label="다음 달 보기"
          onClick={() => setVisibleMonth((prev) => addMonths(prev, 1))}
        >
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
              className={`calendar-day ${selectedKey === key ? "selected" : ""} ${todayKey === key ? "today" : ""} ${
                isOtherMonth ? "muted" : ""
              } ${dragOverDateKey === key ? "drag-target" : ""}`}
              onClick={() => onSelectDate(key)}
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
              aria-label={`${key} 선택, 일정 ${count}건`}
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
