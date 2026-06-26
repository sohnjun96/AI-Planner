import { useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { addDays, addMonths, getDateKey, getMonthGridStart, startOfMonth } from "../utils/date";

export type CalendarMarkerTone = "default" | "lunch" | "leave" | "trip";

export interface CalendarDayMarker {
  id: string;
  label: string;
  count: number;
  tone: CalendarMarkerTone;
  detailLabel?: string;
  cellClass?: string;
  priority?: number;
}

export interface CalendarDaySummary {
  total: number;
  done: number;
  canceled: number;
  pending: number;
  onHold: number;
  conflicts: number;
  major: number;
  lunch: number;
  markers: CalendarDayMarker[];
  titles: string[];
}

interface MonthCalendarProps {
  selectedDate: string;
  weekStartsOn: "sun" | "mon";
  daySummaryByDate: Record<string, CalendarDaySummary>;
  onSelectDate: (date: string) => void;
  onDropTaskToDate?: (taskId: string, dateKey: string) => Promise<void> | void;
  onCreateTaskAtDate?: (dateKey: string) => void;
  onDayContextMenu?: (event: MouseEvent<HTMLElement>, dateKey: string) => void;
  renderSelectedDateDetails?: (dateKey: string) => ReactNode;
}

const EMPTY_SUMMARY: CalendarDaySummary = {
  total: 0,
  done: 0,
  canceled: 0,
  pending: 0,
  onHold: 0,
  conflicts: 0,
  major: 0,
  lunch: 0,
  markers: [],
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

function sortCalendarMarkers(markers: CalendarDayMarker[]): CalendarDayMarker[] {
  return [...markers].sort((a, b) => {
    const priorityDiff = (a.priority ?? 100) - (b.priority ?? 100);
    if (priorityDiff !== 0) {
      return priorityDiff;
    }
    return a.label.localeCompare(b.label, "ko");
  });
}

function formatMarkerCount(marker: CalendarDayMarker, useDetail = false): string {
  const label = useDetail ? marker.detailLabel ?? marker.label : marker.label;
  return `${label}${marker.count > 1 ? ` ${marker.count}` : ""}`;
}

export function MonthCalendar({
  selectedDate,
  weekStartsOn,
  daySummaryByDate,
  onSelectDate,
  onDropTaskToDate,
  onCreateTaskAtDate,
  onDayContextMenu,
  renderSelectedDateDetails,
}: MonthCalendarProps) {
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(new Date(selectedDate)));
  const [dragOverDateKey, setDragOverDateKey] = useState<string | null>(null);
  const [isMonthPickerOpen, setIsMonthPickerOpen] = useState(false);

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

  const monthStats = useMemo(() => {
    let total = 0;
    let pending = 0;
    let onHold = 0;
    let done = 0;
    let canceled = 0;
    let conflicts = 0;

    const lastDay = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 0).getDate();
    for (let day = 1; day <= lastDay; day += 1) {
      const key = getDateKey(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), day));
      const summary = daySummaryByDate[key] ?? EMPTY_SUMMARY;
      total += summary.total;
      pending += summary.pending;
      onHold += summary.onHold;
      done += summary.done;
      canceled += summary.canceled;
      conflicts += summary.conflicts;
    }

    return { total, pending, onHold, done, canceled, conflicts };
  }, [daySummaryByDate, visibleMonth]);

  function moveSelectionByDays(daysToMove: number) {
    const next = addDays(new Date(selectedDate), daysToMove);
    setVisibleMonth(startOfMonth(next));
    onSelectDate(getDateKey(next));
  }

  function selectDate(date: Date) {
    setVisibleMonth(startOfMonth(date));
    onSelectDate(getDateKey(date));
  }

  function moveVisibleMonth(amount: number) {
    setVisibleMonth((prev) => addMonths(prev, amount));
    setIsMonthPickerOpen(false);
  }

  function handleMonthInputChange(value: string) {
    const parsed = parseMonthInputValue(value);
    if (!parsed) {
      return;
    }
    setVisibleMonth(parsed);
    onSelectDate(getDateKey(parsed));
    setIsMonthPickerOpen(false);
  }

  function handleSelectToday() {
    const today = new Date();
    setVisibleMonth(startOfMonth(today));
    onSelectDate(getDateKey(today));
    setIsMonthPickerOpen(false);
  }

  return (
    <section className="panel calendar-panel">
      <div className="calendar-header calendar-toolbar">
        <div className="calendar-nav-row">
          <button
            type="button"
            className="calendar-icon-button"
            aria-label="이전 달 보기"
            onClick={() => moveVisibleMonth(-1)}
          >
            ‹
          </button>
          <div className="calendar-month-control">
            <button
              type="button"
              className="calendar-month-label-button"
              aria-expanded={isMonthPickerOpen}
              aria-label={`${monthLabel} 월 이동 열기`}
              onClick={() => setIsMonthPickerOpen((prev) => !prev)}
            >
              {monthLabel}
            </button>
            {isMonthPickerOpen ? (
              <div className="calendar-month-popover" role="group" aria-label="월 이동">
                <input
                  type="month"
                  value={toMonthInputValue(visibleMonth)}
                  onChange={(event) => handleMonthInputChange(event.target.value)}
                />
                <button type="button" className="btn btn-soft" onClick={handleSelectToday}>
                  오늘
                </button>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="calendar-icon-button"
            aria-label="다음 달 보기"
            onClick={() => moveVisibleMonth(1)}
          >
            ›
          </button>
        </div>

        <div className="calendar-toolbar-actions">
          <button type="button" className="btn btn-soft" onClick={handleSelectToday}>
            오늘
          </button>
        </div>
      </div>

      <div className="calendar-kpi-row" role="status" aria-live="polite">
        <span className="not_done">총 {monthStats.total}건</span>
        <span className="not_done">미완료 {monthStats.pending}건</span>
        <span className="on_hold">보류 {monthStats.onHold}건</span>
        <span className="done">완료 {monthStats.done}건</span>
        <span className="canceled">취소 {monthStats.canceled}건</span>
        <span className="conflict">충돌 {monthStats.conflicts}건</span>
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
          const markers = sortCalendarMarkers(summary.markers ?? []);
          const topMarkers = markers.filter((marker) => marker.tone !== "lunch");
          const lunchMarkers = markers.filter((marker) => marker.tone === "lunch");
          const markerClassName = markers.map((marker) => marker.cellClass).filter(Boolean).join(" ");
          const density = getDensityLevel(summary.total);
          const completionBase = Math.max(0, summary.total - summary.canceled);
          const completionRatio = completionBase > 0 ? Math.round((summary.done / completionBase) * 100) : 0;
          const isWeekend = date.getDay() === 0 || date.getDay() === 6;
          const visibleTitleCount = summary.titles.length;
          const hiddenTitleCount = Math.max(0, visibleTitleCount - 3);

          const ariaLabel = [
            `${key}`,
            summary.total > 0 ? `총 ${summary.total}건` : "일정 없음",
            summary.pending > 0 ? `미완료 ${summary.pending}건` : "",
            summary.onHold > 0 ? `보류 ${summary.onHold}건` : "",
            summary.canceled > 0 ? `취소 ${summary.canceled}건` : "",
            summary.lunch > 0 ? `점심 ${summary.lunch}건` : "",
            ...markers.map((marker) => `${marker.detailLabel ?? marker.label} ${marker.count}건`),
            summary.conflicts > 0 ? `충돌 ${summary.conflicts}건` : "",
            "Enter로 선택, 더블클릭으로 일정 추가",
          ]
            .filter(Boolean)
            .join(", ");

          return (
            <div key={key} className={`calendar-day-slot ${selectedKey === key ? "selected" : ""}`}>
              <button
                type="button"
                className={`calendar-day density-${density} ${selectedKey === key ? "selected" : ""} ${
                  todayKey === key ? "today" : ""
                } ${isOtherMonth ? "muted" : ""} ${isWeekend ? "weekend" : ""} ${
                  dragOverDateKey === key ? "drag-target" : ""
                } ${markerClassName}`}
                onClick={() => selectDate(date)}
                onContextMenu={(event) => {
                  if (!onDayContextMenu) {
                    return;
                  }
                  event.preventDefault();
                  event.stopPropagation();
                  selectDate(date);
                  onDayContextMenu(event, key);
                }}
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
                  setVisibleMonth(startOfMonth(date));
                  void onDropTaskToDate(taskId, key);
                }}
                aria-label={ariaLabel}
              >
                <div className="calendar-day-top">
                  <span className="calendar-day-number">{date.getDate()}</span>
                  <div className="calendar-day-top-meta">
                    {topMarkers.map((marker) => (
                      <span key={marker.id} className={`calendar-special-mark ${marker.tone}`}>
                        {formatMarkerCount(marker)}
                      </span>
                    ))}
                    {summary.total > 0 ? <span className="calendar-day-count">{summary.total}건</span> : null}
                  </div>
                </div>

                <div className="calendar-progress" aria-hidden="true">
                  <span style={{ width: `${completionRatio}%` }} />
                </div>

                <div className="calendar-event-stack">
                  {summary.titles.slice(0, 3).map((title, index) => (
                    <span key={`${key}-title-${index}`} className="calendar-event-line" title={title}>
                      {title}
                    </span>
                  ))}
                  {hiddenTitleCount > 0 ? <span className="calendar-event-more">+{hiddenTitleCount}</span> : null}
                </div>

                <div className="calendar-indicators">
                  {lunchMarkers.map((marker) => (
                    <span key={marker.id} className={`calendar-special-mark ${marker.tone}`}>
                      {formatMarkerCount(marker)}
                    </span>
                  ))}
                  {summary.onHold > 0 ? <span className="calendar-indicator hold">보류 {summary.onHold}</span> : null}
                  {summary.major > 0 ? <span className="calendar-indicator major">중요 {summary.major}</span> : null}
                  {summary.conflicts > 0 ? <span className="calendar-indicator conflict">충돌 {summary.conflicts}</span> : null}
                </div>
              </button>
              {selectedKey === key && renderSelectedDateDetails ? (
                <div className="calendar-day-popover" onClick={(event) => event.stopPropagation()}>
                  {renderSelectedDateDetails(key)}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <p className="description-text">날짜를 더블클릭하면 해당 날짜에 일정을 추가하고, 일정 카드를 드래그하면 날짜를 이동할 수 있습니다.</p>
    </section>
  );
}
